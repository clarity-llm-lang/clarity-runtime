import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServiceManager } from "../supervisor/service-manager.js";
import { renderStatusPage } from "../../web/status-page.js";
import { isJsonRpcRequest, failure, type JsonRpcRequest } from "./mcp-jsonrpc.js";
import { McpRouter } from "./mcp-router.js";
import { HttpBodyError, readJsonBody } from "../http/body.js";
import { validateManifest } from "../rpc/manifest.js";
import { authorizeRequest, type AuthConfig } from "../security/auth.js";
import {
  deleteRemoteAuthSecret,
  getRemoteAuthProviderHealth,
  listRemoteAuthFileSecrets,
  upsertRemoteAuthSecret,
  validateRemoteAuthRef
} from "../security/remote-auth.js";

const CLARITY_SYSTEM_TOOLS = [
  { name: "clarity__help", description: "Clarity-first guidance and workflow hints for LLM usage." },
  { name: "clarity__sources", description: "List .clarity files in workspace and optionally include excerpts." },
  { name: "clarity__project_structure", description: "Return recommended Clarity app structure with templates." },
  { name: "clarity__ensure_compiler", description: "Check/install clarityc with install-policy gates." },
  { name: "clarity__bootstrap_app", description: "Scaffold/build/register a Clarity app with rollback semantics." }
] as const;

const RUNTIME_SYSTEM_TOOLS = [
  { name: "runtime__status_summary", description: "Summarize service and health counts." },
  { name: "runtime__list_services", description: "List all registered services." },
  { name: "runtime__get_service", description: "Fetch complete details for one service." },
  { name: "runtime__get_logs", description: "Fetch recent logs for one service." },
  { name: "runtime__start_service", description: "Start a stopped service." },
  { name: "runtime__stop_service", description: "Stop a running service." },
  { name: "runtime__restart_service", description: "Restart a service." },
  { name: "runtime__refresh_interface", description: "Refresh tool/resource/prompt snapshot for service." },
  { name: "runtime__unquarantine_service", description: "Clear quarantine so a service can start again." },
  { name: "runtime__remove_service", description: "Deprovision service with optional artifact cleanup." },
  { name: "runtime__get_audit", description: "Read recent runtime audit events." },
  { name: "runtime__validate_auth_ref", description: "Validate authRef and return redacted diagnostics." },
  { name: "runtime__auth_provider_health", description: "Report remote auth provider/file-root health." },
  { name: "runtime__list_auth_secrets", description: "List file-backed secret handles (no secret values)." },
  { name: "runtime__set_auth_secret", description: "Create/rotate file-backed auth secret." },
  { name: "runtime__delete_auth_secret", description: "Delete file-backed auth secret." },
  { name: "runtime__register_local", description: "Register local wasm service via MCP." },
  { name: "runtime__register_remote", description: "Register remote MCP service via MCP." },
  { name: "runtime__register_via_url", description: "Quick-register remote service from URL via MCP." },
  { name: "runtime__apply_manifest", description: "Apply full service manifest via MCP." }
] as const;

const SYSTEM_TOOLS = [...RUNTIME_SYSTEM_TOOLS, ...CLARITY_SYSTEM_TOOLS].map((t) => t.name);

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

export async function handleHttp(
  manager: ServiceManager,
  req: IncomingMessage,
  res: ServerResponse,
  authConfig: AuthConfig
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const mcpRouter = new McpRouter(manager);

  try {
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
      text(res, 200, renderStatusPage(), "text/html; charset=utf-8");
      return;
    }

    if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") {
      const auth = authorizeRequest(req, url, authConfig);
      if (!auth.ok) {
        if (auth.status === 401) {
          res.setHeader("www-authenticate", "Bearer");
        }
        json(res, auth.status, { error: auth.error ?? "unauthorized" });
        return;
      }
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
      const message = await readJsonBody(req);
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
          items: SYSTEM_TOOLS,
          runtime: {
            count: RUNTIME_SYSTEM_TOOLS.length,
            items: RUNTIME_SYSTEM_TOOLS
          },
          clarity: {
            count: CLARITY_SYSTEM_TOOLS.length,
            items: CLARITY_SYSTEM_TOOLS
          }
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

    if (method === "GET" && url.pathname === "/api/security/auth/providers") {
      json(res, 200, await getRemoteAuthProviderHealth({
        env: process.env,
        cwd: process.cwd()
      }));
      return;
    }

    if (method === "GET" && url.pathname === "/api/security/auth/secrets") {
      const items = await listRemoteAuthFileSecrets({
        env: process.env,
        cwd: process.cwd()
      });
      json(res, 200, { count: items.length, items });
      return;
    }

    if (method === "POST" && url.pathname === "/api/security/auth/secrets") {
      if ((process.env.CLARITY_ENABLE_MCP_PROVISIONING ?? "").trim() !== "1") {
        json(res, 403, { error: "auth secret writes are disabled (set CLARITY_ENABLE_MCP_PROVISIONING=1)" });
        return;
      }
      const body = await readJsonBody(req);
      const authRef = typeof (body as { auth_ref?: unknown }).auth_ref === "string"
        ? ((body as { auth_ref: string }).auth_ref)
        : "";
      const secret = typeof (body as { secret?: unknown }).secret === "string"
        ? ((body as { secret: string }).secret)
        : "";
      if (!authRef || !secret) {
        json(res, 400, { error: "expected { auth_ref, secret }" });
        return;
      }
      const out = await upsertRemoteAuthSecret(authRef, secret, {
        env: process.env,
        cwd: process.cwd()
      });
      manager.recordRuntimeEvent({
        kind: "security.auth_secret_upserted",
        level: "info",
        message: "Remote auth secret updated",
        data: {
          authRef: out.authRef,
          provider: out.provider,
          path: out.path
        }
      });
      json(res, 200, out);
      return;
    }

    if (method === "DELETE" && url.pathname === "/api/security/auth/secrets") {
      if ((process.env.CLARITY_ENABLE_MCP_PROVISIONING ?? "").trim() !== "1") {
        json(res, 403, { error: "auth secret deletes are disabled (set CLARITY_ENABLE_MCP_PROVISIONING=1)" });
        return;
      }
      const body = await readJsonBody(req);
      const authRef = typeof (body as { auth_ref?: unknown }).auth_ref === "string"
        ? ((body as { auth_ref: string }).auth_ref)
        : "";
      if (!authRef) {
        json(res, 400, { error: "expected { auth_ref }" });
        return;
      }
      const out = await deleteRemoteAuthSecret(authRef, {
        env: process.env,
        cwd: process.cwd()
      });
      manager.recordRuntimeEvent({
        kind: "security.auth_secret_deleted",
        level: "info",
        message: "Remote auth secret deleted",
        data: {
          authRef: out.authRef,
          provider: out.provider,
          path: out.path,
          deleted: out.deleted
        }
      });
      json(res, 200, out);
      return;
    }

    if (method === "GET" && url.pathname === "/api/security/auth/validate") {
      const authRef = url.searchParams.get("auth_ref") ?? "";
      if (!authRef) {
        json(res, 400, { error: "query parameter 'auth_ref' is required" });
        return;
      }
      const out = await validateRemoteAuthRef(authRef, {
        env: process.env,
        cwd: process.cwd()
      });
      manager.recordRuntimeEvent({
        kind: "security.auth_ref_validated",
        level: out.valid ? "info" : "warn",
        message: out.valid ? "Remote authRef validated" : "Remote authRef validation failed",
        data: {
          authRef,
          provider: out.provider,
          valid: out.valid
        }
      });
      json(res, 200, out);
      return;
    }

    if (method === "POST" && url.pathname === "/api/security/auth/validate") {
      const body = await readJsonBody(req);
      const authRef = typeof (body as { auth_ref?: unknown }).auth_ref === "string"
        ? ((body as { auth_ref: string }).auth_ref)
        : "";
      if (!authRef) {
        json(res, 400, { error: "expected { auth_ref }" });
        return;
      }
      const out = await validateRemoteAuthRef(authRef, {
        env: process.env,
        cwd: process.cwd()
      });
      manager.recordRuntimeEvent({
        kind: "security.auth_ref_validated",
        level: out.valid ? "info" : "warn",
        message: out.valid ? "Remote authRef validated" : "Remote authRef validation failed",
        data: {
          authRef,
          provider: out.provider,
          valid: out.valid
        }
      });
      json(res, 200, out);
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

    if (method === "DELETE" && serviceMatch) {
      const id = decodeURIComponent(serviceMatch[1]);
      const body = await readJsonBody(req);
      const cleanupArtifacts = typeof (body as { cleanup_artifacts?: unknown }).cleanup_artifacts === "boolean"
        ? ((body as { cleanup_artifacts: boolean }).cleanup_artifacts)
        : false;
      const out = await manager.remove(id, { cleanupArtifacts });
      if (!out.removed) {
        json(res, 404, { error: `service not found: ${id}` });
        return;
      }
      json(res, 200, out);
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
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object" || !("manifest" in body)) {
        json(res, 400, { error: "expected { manifest }" });
        return;
      }
      const manifest = validateManifest((body as { manifest: unknown }).manifest);
      json(res, 200, { service: await manager.applyManifest(manifest) });
      return;
    }

    text(res, 404, "Not found\n");
  } catch (error) {
    if (error instanceof HttpBodyError) {
      json(res, error.status, { error: error.message });
      return;
    }
    json(res, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
