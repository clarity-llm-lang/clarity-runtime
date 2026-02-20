import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServiceManager } from "../supervisor/service-manager.js";
import { renderStatusPage } from "../../web/status-page.js";
import { isJsonRpcRequest, failure, type JsonRpcRequest } from "./mcp-jsonrpc.js";
import { McpRouter } from "./mcp-router.js";

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

export async function handleHttp(manager: ServiceManager, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const mcpRouter = new McpRouter(manager);

  try {
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
      text(res, 200, renderStatusPage(), "text/html; charset=utf-8");
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
      const summary = {
        total: services.length,
        running: services.filter((s) => s.lifecycle === "RUNNING").length,
        degraded: services.filter((s) => s.health === "DEGRADED").length,
        stopped: services.filter((s) => s.lifecycle === "STOPPED" || s.lifecycle === "REGISTERED").length,
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
          listen: "localhost:4707",
          mcpPath: "/mcp",
          healthy: true
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

    const actionMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/(start|stop|restart|introspect)$/);
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
