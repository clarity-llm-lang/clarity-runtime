import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServiceManager } from "../supervisor/service-manager.js";
import { renderStatusPage } from "../../web/status-page.js";
import { isJsonRpcRequest, failure, type JsonRpcRequest } from "./mcp-jsonrpc.js";
import { McpRouter } from "./mcp-router.js";

const SYSTEM_TOOLS = [
  "runtime__status_summary",
  "runtime__list_services",
  "runtime__get_service",
  "runtime__get_logs",
  "runtime__start_service",
  "runtime__stop_service",
  "runtime__restart_service",
  "runtime__refresh_interface",
  "runtime__unquarantine_service",
  "runtime__get_audit",
  "runtime__clarity_help",
  "runtime__clarity_sources",
  "runtime__clarity_project_structure",
  "runtime__register_local",
  "runtime__register_remote",
  "runtime__register_via_url",
  "runtime__apply_manifest"
] as const;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function text(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function summarize(record: Awaited<ReturnType<ServiceManager["list"]>>[number]) {
  const origin = record.manifest.spec.origin;
  const remotePolicy = origin.type === "remote_mcp"
    ? {
        timeoutMs: origin.timeoutMs,
        allowedTools: origin.allowedTools ?? [],
        maxPayloadBytes: origin.maxPayloadBytes,
        maxConcurrency: origin.maxConcurrency
      }
    : null;

  return {
    serviceId: record.manifest.metadata.serviceId,
    displayName: record.manifest.metadata.displayName,
    sourceFile: record.manifest.metadata.sourceFile,
    module: record.manifest.metadata.module,
    originType: record.manifest.spec.origin.type,
    lifecycle: record.runtime.lifecycle,
    health: record.runtime.health,
    uptimeSeconds: record.runtime.uptimeSeconds,
    restartCount: record.runtime.restartCount,
    policy: {
      restart: record.manifest.spec.restartPolicy,
      remote: remotePolicy
    },
    interface: record.interfaceSnapshot
      ? {
          interfaceRevision: record.interfaceSnapshot.interfaceRevision,
          introspectedAt: record.interfaceSnapshot.introspectedAt,
          tools: record.interfaceSnapshot.tools.length,
          resources: record.interfaceSnapshot.resources.length,
          prompts: record.interfaceSnapshot.prompts.length
        }
      : null
  };
}

function extractRecentCalls(events: Array<{ kind: string; at: string; message: string; data?: unknown }>, limit: number): Array<{ at: string; message: string; data?: unknown }> {
  const calls = events
    .filter((event) => event.kind === "service.tool_called")
    .map((event) => ({
      at: event.at,
      message: event.message,
      data: event.data
    }));
  return calls.slice(Math.max(0, calls.length - Math.max(1, limit)));
}

export async function handleHttp(manager: ServiceManager, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const mcpRouter = new McpRouter(manager);

  try {
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
      text(res, 200, renderStatusPage(), "text/html; charset=utf-8");
      return;
    }

    if (method === "GET" && url.pathname === "/api/events") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream; charset=utf-8");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");

      const writeEvent = (event: unknown): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      for (const event of manager.getRecentEvents(100)) {
        writeEvent(event);
      }

      const unsubscribe = manager.subscribeEvents((event) => {
        writeEvent(event);
      });

      const keepAlive = setInterval(() => {
        res.write(": ping\n\n");
      }, 15000);

      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }

    if (url.pathname === "/mcp" && method === "GET") {
      json(res, 200, {
        name: "clarity-runtime gateway",
        protocol: "jsonrpc-2.0",
        supportedMethods: ["initialize", "ping", "tools/list", "tools/call", "resources/list", "prompts/list"]
      });
      return;
    }

    if (url.pathname === "/mcp" && method === "POST") {
      const message = await readJson(req);
      if (!isJsonRpcRequest(message)) {
        json(res, 400, failure(null, -32600, "invalid JSON-RPC request"));
        return;
      }

      const response = await mcpRouter.handle(message as JsonRpcRequest);
      if (!response) {
        res.statusCode = 202;
        res.end();
        return;
      }

      json(res, 200, response);
      return;
    }

    if (method === "GET" && url.pathname === "/api/status") {
      const services = (await manager.list()).map(summarize);
      const listen = req.headers.host && req.headers.host.length > 0 ? req.headers.host : "localhost:4707";
      const summary = {
        total: services.length,
        running: services.filter((s) => s.lifecycle === "RUNNING").length,
        degraded: services.filter((s) => s.health === "DEGRADED").length,
        stopped: services.filter((s) => s.lifecycle === "STOPPED" || s.lifecycle === "REGISTERED").length,
        quarantined: services.filter((s) => s.lifecycle === "QUARANTINED").length,
        local: services.filter((s) => s.originType === "local_wasm").length,
        remote: services.filter((s) => s.originType === "remote_mcp").length
      };

      json(res, 200, {
        runtime: {
          version: "0.1.0",
          pid: process.pid,
          uptimeSeconds: Math.floor(process.uptime())
        },
        gateway: {
          listen,
          mcpPath: "/mcp",
          healthy: true
        },
        systemTools: {
          count: SYSTEM_TOOLS.length,
          items: SYSTEM_TOOLS
        },
        summary,
        services,
        lastUpdated: new Date().toISOString()
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/services") {
      json(res, 200, { items: (await manager.list()).map(summarize) });
      return;
    }

    if (method === "GET" && url.pathname === "/api/audit") {
      const limit = Number(url.searchParams.get("limit") ?? "200");
      json(res, 200, {
        items: manager.getRecentEvents(Number.isFinite(limit) ? limit : 200)
      });
      return;
    }

    const serviceMatch = url.pathname.match(/^\/api\/services\/([^/]+)$/);
    if (method === "GET" && serviceMatch) {
      const id = decodeURIComponent(serviceMatch[1]);
      const service = await manager.get(id);
      if (!service) {
        json(res, 404, { error: `service not found: ${id}` });
        return;
      }
      json(res, 200, { service });
      return;
    }

    const interfaceMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/interface$/);
    if (method === "GET" && interfaceMatch) {
      const id = decodeURIComponent(interfaceMatch[1]);
      const service = await manager.get(id);
      if (!service) {
        json(res, 404, { error: `service not found: ${id}` });
        return;
      }
      json(res, 200, {
        serviceId: id,
        ...(service.interfaceSnapshot ?? {
          interfaceRevision: null,
          introspectedAt: null,
          tools: [],
          resources: [],
          prompts: []
        })
      });
      return;
    }

    const logsMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/logs$/);
    if (method === "GET" && logsMatch) {
      const id = decodeURIComponent(logsMatch[1]);
      const limit = Number(url.searchParams.get("limit") ?? "200");
      json(res, 200, {
        serviceId: id,
        lines: await manager.tailLogs(id, Number.isFinite(limit) ? limit : 200)
      });
      return;
    }

    const serviceEventsMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/events$/);
    if (method === "GET" && serviceEventsMatch) {
      const id = decodeURIComponent(serviceEventsMatch[1]);
      const limit = Number(url.searchParams.get("limit") ?? "200");
      json(res, 200, {
        serviceId: id,
        items: manager.getServiceEvents(id, Number.isFinite(limit) ? limit : 200)
      });
      return;
    }

    const serviceDetailsMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/details$/);
    if (method === "GET" && serviceDetailsMatch) {
      const id = decodeURIComponent(serviceDetailsMatch[1]);
      const service = await manager.get(id);
      if (!service) {
        json(res, 404, { error: `service not found: ${id}` });
        return;
      }

      const logLimit = Number(url.searchParams.get("log_limit") ?? "50");
      const eventLimit = Number(url.searchParams.get("event_limit") ?? "100");
      const callLimit = Number(url.searchParams.get("call_limit") ?? "20");
      const logs = await manager.tailLogs(id, Number.isFinite(logLimit) ? logLimit : 50);
      const events = manager.getServiceEvents(id, Number.isFinite(eventLimit) ? eventLimit : 100);
      const recentCalls = extractRecentCalls(events, Number.isFinite(callLimit) ? callLimit : 20);

      json(res, 200, {
        serviceId: id,
        summary: summarize(service),
        service,
        interface: service.interfaceSnapshot ?? {
          interfaceRevision: null,
          introspectedAt: null,
          tools: [],
          resources: [],
          prompts: []
        },
        logs,
        events,
        recentCalls
      });
      return;
    }

    const actionMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/(start|stop|restart|introspect|unquarantine)$/);
    if (method === "POST" && actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];

      if (action === "start") {
        json(res, 200, { service: await manager.start(id) });
        return;
      }
      if (action === "stop") {
        json(res, 200, { service: await manager.stop(id) });
        return;
      }
      if (action === "restart") {
        json(res, 200, { service: await manager.restart(id) });
        return;
      }
      if (action === "introspect") {
        json(res, 200, { interface: await manager.refreshInterface(id) });
        return;
      }
      if (action === "unquarantine") {
        json(res, 200, { service: await manager.unquarantine(id) });
        return;
      }
    }

    if (method === "POST" && url.pathname === "/api/services/apply") {
      const body = await readJson(req);
      if (!body || typeof body !== "object" || !("manifest" in body)) {
        json(res, 400, { error: "expected { manifest }" });
        return;
      }
      const manifest = (body as { manifest: unknown }).manifest;
      json(res, 200, { service: await manager.applyManifest(manifest as never) });
      return;
    }

    text(res, 404, "Not found\n");
  } catch (error) {
    json(res, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
