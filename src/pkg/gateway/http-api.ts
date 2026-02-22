import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  answerQuestion,
  cancelQuestion,
  getQuestionByKey,
  listBrokerState,
  listQuestions,
  readQuestionState,
  submitQuestion
} from "../hitl/broker.js";

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
  { name: "runtime__get_agent_runs", description: "List recent agent runs with status/timing counters." },
  { name: "runtime__get_agent_events", description: "Read recent agent orchestration timeline events." },
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
const FAVICON_SVG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../assets/clarity-github-avatar.svg"
);
const FAVICON_PNG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../assets/clarity-github-avatar.png"
);
const DEFAULT_HITL_EVENT_KIND = "agent.hitl_input";
const HITL_MAX_MESSAGE_CHARS = parsePositiveIntegerEnv(process.env.CLARITY_HITL_MAX_MESSAGE_CHARS, 2000);

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

function bytes(res: ServerResponse, status: number, body: Buffer, type: string): void {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.end(body);
}

function summarize(record: Awaited<ReturnType<ServiceManager["list"]>>[number]) {
  const inferredType = inferServiceType(record);
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
    serviceType: inferredType,
    agent: inferredType === "agent" ? (record.manifest.metadata.agent ?? null) : null,
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

function inferServiceType(record: Awaited<ReturnType<ServiceManager["list"]>>[number]): "mcp" | "agent" {
  const explicit = record.manifest.metadata.serviceType;
  return explicit === "agent" ? "agent" : "mcp";
}

function extractRecentCalls(events: Array<{ kind: string; at: string; message: string; data?: unknown }>, limit: number): Array<{ at: string; message: string; data?: unknown }> {
  const calls = events
    .filter((event) => event.kind === "mcp.tool_called")
    .map((event) => ({
      at: event.at,
      message: event.message,
      data: event.data
    }));
  return calls.slice(Math.max(0, calls.length - Math.max(1, limit)));
}

function parseLimit(value: string | null, fallback: number, min = 1, max = 2000): number {
  const parsed = Number(value ?? `${fallback}`);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getField(data: Record<string, unknown>, key: string): unknown {
  if (data[key] !== undefined) {
    return data[key];
  }
  const snake = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  return data[snake];
}

function findAgentRun(manager: ServiceManager, runId: string): ReturnType<ServiceManager["getAgentRuns"]>[number] | null {
  const target = runId.trim();
  if (!target) {
    return null;
  }
  const runs = manager.getAgentRuns(2000);
  for (const run of runs) {
    if (run.runId === target) {
      return run;
    }
  }
  return null;
}

function isTerminalAgentRunStatus(status: unknown): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "completed" || normalized === "failed" || normalized === "cancelled";
}

function sanitizeHitlMessage(input: string, maxChars: number): {
  message: string;
  originalLength: number;
  storedLength: number;
  truncated: boolean;
  redacted: boolean;
} {
  const originalLength = input.length;
  let next = input;

  const redactRules: Array<{ pattern: RegExp; replace: string }> = [
    { pattern: /\b(bearer)\s+[A-Za-z0-9._-]+/gi, replace: "$1 [REDACTED]" },
    { pattern: /\b(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi, replace: "$1=[REDACTED]" },
    { pattern: /\bsk-[A-Za-z0-9]{8,}\b/g, replace: "sk-[REDACTED]" }
  ];
  let redacted = false;
  for (const rule of redactRules) {
    const replaced = next.replace(rule.pattern, rule.replace);
    if (replaced !== next) {
      redacted = true;
      next = replaced;
    }
  }

  const truncated = next.length > maxChars;
  if (truncated) {
    next = next.slice(0, maxChars);
  }

  return {
    message: next,
    originalLength,
    storedLength: next.length,
    truncated,
    redacted
  };
}

function validateAgentRunCreatedPayload(payload: Record<string, unknown>): string | null {
  const triggerRaw = nonEmptyString(getField(payload, "trigger") ?? getField(payload, "triggerType") ?? getField(payload, "source"));
  if (!triggerRaw) {
    return null;
  }
  const trigger = triggerRaw.toLowerCase();
  const allowed = new Set(["timer", "event", "api", "a2a"]);
  if (!allowed.has(trigger)) {
    return "invalid trigger: expected one of timer|event|api|a2a";
  }
  const triggerContext = asObject(payload.triggerContext ?? payload.trigger_context);
  const hasField = (key: string): boolean => {
    const value = getField(triggerContext, key) ?? getField(payload, key);
    return nonEmptyString(value) !== null;
  };
  const requiredByTrigger: Record<string, string[]> = {
    timer: ["scheduleId", "scheduleExpr", "firedAt"],
    event: ["eventType", "eventId", "correlationId", "producer"],
    api: ["route", "method", "requestId", "caller"],
    a2a: ["parentRunId", "fromAgentId", "handoffReason"]
  };
  const missing = requiredByTrigger[trigger].filter((key) => !hasField(key));
  if (missing.length > 0) {
    return `missing trigger context for ${trigger}: ${missing.join(", ")}`;
  }
  return null;
}

async function validateDeclaredServiceTrigger(
  manager: ServiceManager,
  serviceId: string | undefined,
  payload: Record<string, unknown>
): Promise<string | null> {
  const sid = nonEmptyString(serviceId);
  if (!sid) {
    return null;
  }
  const service = await manager.get(sid);
  if (!service) {
    return `service not found: ${sid}`;
  }
  const serviceType = service.manifest.metadata.serviceType === "agent" ? "agent" : "mcp";
  if (serviceType !== "agent") {
    return `service is not an agent: ${sid}`;
  }
  const declared = service.manifest.metadata.agent?.triggers ?? [];
  if (!Array.isArray(declared) || declared.length === 0) {
    return `agent service has no declared triggers: ${sid}`;
  }
  const triggerRaw = nonEmptyString(getField(payload, "trigger") ?? getField(payload, "triggerType") ?? getField(payload, "source"));
  if (!triggerRaw) {
    return `trigger is required for agent.run_created when service_id is set (${sid})`;
  }
  const trigger = triggerRaw.toLowerCase();
  if (!declared.includes(trigger as "timer" | "event" | "api" | "a2a")) {
    return `trigger '${trigger}' is not declared by agent ${sid}; declared: ${declared.join(", ")}`;
  }
  return null;
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
    if (method === "GET" && url.pathname === "/favicon.svg") {
      const favicon = await readFile(FAVICON_SVG_PATH, "utf8");
      text(res, 200, favicon, "image/svg+xml; charset=utf-8");
      return;
    }

    if (method === "GET" && (url.pathname === "/favicon.ico" || url.pathname === "/favicon.png" || url.pathname === "/apple-touch-icon.png")) {
      const favicon = await readFile(FAVICON_PNG_PATH);
      bytes(res, 200, favicon, "image/png");
      return;
    }

    if (method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
      text(res, 200, renderStatusPage(), "text/html; charset=utf-8");
      return;
    }

    if (
      url.pathname.startsWith("/api/")
      || url.pathname === "/mcp"
      || url.pathname === "/questions"
      || url.pathname.startsWith("/questions/")
      || url.pathname === "/answer"
      || url.pathname === "/cancel"
      || url.pathname === "/events"
    ) {
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

    if (method === "GET" && url.pathname === "/questions") {
      const items = await listQuestions({
        env: process.env,
        cwd: process.cwd()
      });
      json(res, 200, items
        .filter((item) => !item.answered)
        .map((item) => ({
          key: item.key,
          question: item.question,
          timestamp: item.timestamp,
          ...(item.pid !== undefined ? { pid: item.pid } : {}),
          ageSeconds: item.ageSeconds
        })));
      return;
    }

    const questionByKeyMatch = url.pathname.match(/^\/questions\/([^/]+)$/);
    if (method === "GET" && questionByKeyMatch) {
      const key = decodeURIComponent(questionByKeyMatch[1]);
      json(res, 200, await readQuestionState(key, {
        env: process.env,
        cwd: process.cwd()
      }));
      return;
    }

    if (method === "POST" && url.pathname === "/questions") {
      const body = await readJsonBody(req) as {
        key?: unknown;
        question?: unknown;
        timestamp?: unknown;
        pid?: unknown;
      };
      const key = nonEmptyString(body.key);
      const question = nonEmptyString(body.question);
      if (!key || !question) {
        json(res, 400, { error: "expected { key, question }" });
        return;
      }
      const out = await submitQuestion({
        key,
        question,
        ...(typeof body.timestamp === "number" && Number.isFinite(body.timestamp) ? { timestamp: body.timestamp } : {}),
        ...(typeof body.pid === "number" && Number.isFinite(body.pid) ? { pid: body.pid } : {})
      }, {
        env: process.env,
        cwd: process.cwd()
      });
      json(res, 200, out);
      return;
    }

    if (method === "POST" && url.pathname === "/answer") {
      const body = await readJsonBody(req) as {
        key?: unknown;
        response?: unknown;
      };
      const key = nonEmptyString(body.key);
      if (!key || typeof body.response !== "string") {
        json(res, 400, { error: "expected { key, response }" });
        return;
      }
      const exists = await getQuestionByKey(key, {
        env: process.env,
        cwd: process.cwd()
      });
      if (!exists) {
        json(res, 404, { error: `question not found: ${key}` });
        return;
      }
      const out = await answerQuestion(key, body.response, {
        env: process.env,
        cwd: process.cwd()
      });
      json(res, 200, out);
      return;
    }

    if (method === "POST" && url.pathname === "/cancel") {
      const body = await readJsonBody(req) as {
        key?: unknown;
      };
      const key = nonEmptyString(body.key);
      if (!key) {
        json(res, 400, { error: "expected { key }" });
        return;
      }
      json(res, 200, await cancelQuestion(key, {
        env: process.env,
        cwd: process.cwd()
      }));
      return;
    }

    if (method === "GET" && url.pathname === "/events") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream; charset=utf-8");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");

      const writeEvent = (event: unknown): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      let previous = await listBrokerState({
        env: process.env,
        cwd: process.cwd()
      });

      const initial = await listQuestions({
        env: process.env,
        cwd: process.cwd()
      });
      for (const question of initial.filter((item) => !item.answered)) {
        writeEvent({
          type: "new_question",
          key: question.key,
          timestamp: question.timestamp
        });
      }

      const interval = setInterval(async () => {
        try {
          const current = await listBrokerState({
            env: process.env,
            cwd: process.cwd()
          });
          for (const [safeKey, row] of current.entries()) {
            const prev = previous.get(safeKey);
            if (!prev) {
              writeEvent({
                type: "new_question",
                key: row.key
              });
              if (row.answered) {
                writeEvent({
                  type: "answered",
                  key: row.key
                });
              }
              continue;
            }
            if (!prev.answered && row.answered) {
              writeEvent({
                type: "answered",
                key: row.key
              });
            }
            if (row.questionMtimeMs > prev.questionMtimeMs) {
              writeEvent({
                type: "new_question",
                key: row.key
              });
            }
          }
          previous = current;
        } catch {
          // Keep SSE stream alive even if one poll iteration fails.
        }
      }, 1000);

      const keepAlive = setInterval(() => {
        res.write(": ping\n\n");
      }, 15000);

      req.on("close", () => {
        clearInterval(interval);
        clearInterval(keepAlive);
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
      const agentRuns = manager.getAgentRuns(500);
      const listen = req.headers.host && req.headers.host.length > 0 ? req.headers.host : "localhost:4707";
      const summary = {
        total: services.length,
        mcpServices: services.filter((s) => s.serviceType === "mcp").length,
        agentServices: services.filter((s) => s.serviceType === "agent").length,
        running: services.filter((s) => s.lifecycle === "RUNNING").length,
        runningMcp: services.filter((s) => s.lifecycle === "RUNNING" && s.serviceType === "mcp").length,
        runningAgent: services.filter((s) => s.lifecycle === "RUNNING" && s.serviceType === "agent").length,
        degraded: services.filter((s) => s.health === "DEGRADED").length,
        stopped: services.filter((s) => s.lifecycle === "STOPPED" || s.lifecycle === "REGISTERED").length,
        quarantined: services.filter((s) => s.lifecycle === "QUARANTINED").length,
        local: services.filter((s) => s.originType === "local_wasm" && s.serviceType === "mcp").length,
        remote: services.filter((s) => s.originType === "remote_mcp" && s.serviceType === "mcp").length
      };
      const agentSummary = {
        totalRuns: agentRuns.length,
        running: agentRuns.filter((run) => run.status === "running").length,
        waiting: agentRuns.filter((run) => run.status === "waiting").length,
        completed: agentRuns.filter((run) => run.status === "completed").length,
        failed: agentRuns.filter((run) => run.status === "failed").length,
        cancelled: agentRuns.filter((run) => run.status === "cancelled").length
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
        agents: agentSummary,
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
      const limit = parseLimit(url.searchParams.get("limit"), 200);
      json(res, 200, {
        items: manager.getRecentEvents(limit)
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/agents/events") {
      const limit = parseLimit(url.searchParams.get("limit"), 200);
      json(res, 200, { items: manager.getRecentAgentEvents(limit) });
      return;
    }

    const agentRunEventsMatch = url.pathname.match(/^\/api\/agents\/runs\/([^/]+)\/events$/);
    if (method === "GET" && agentRunEventsMatch) {
      const runId = decodeURIComponent(agentRunEventsMatch[1]);
      const limit = parseLimit(url.searchParams.get("limit"), 200);
      json(res, 200, {
        runId,
        items: manager.getAgentRunEvents(runId, limit)
      });
      return;
    }

    const agentRunHitlMatch = url.pathname.match(/^\/api\/agents\/runs\/([^/]+)\/hitl$/);
    if (method === "POST" && agentRunHitlMatch) {
      const runId = decodeURIComponent(agentRunHitlMatch[1]).trim();
      if (!runId) {
        json(res, 400, { error: "runId is required" });
        return;
      }
      const body = await readJsonBody(req) as {
        message?: unknown;
        text?: unknown;
        input?: unknown;
        service_id?: unknown;
        serviceId?: unknown;
        agent?: unknown;
        kind?: unknown;
      };
      const message = nonEmptyString(body.message) ?? nonEmptyString(body.text) ?? nonEmptyString(body.input);
      if (!message) {
        json(res, 400, { error: "expected non-empty message (or text/input)" });
        return;
      }
      const kind = nonEmptyString(body.kind) ?? DEFAULT_HITL_EVENT_KIND;
      if (!kind.startsWith("agent.")) {
        json(res, 400, { error: "expected kind to start with 'agent.'" });
        return;
      }
      const run = findAgentRun(manager, runId);
      if (run && isTerminalAgentRunStatus(run.status)) {
        json(res, 409, {
          error: `run is terminal and no longer accepts HITL input: ${runId}`,
          runId,
          status: run.status
        });
        return;
      }

      const sanitized = sanitizeHitlMessage(message, HITL_MAX_MESSAGE_CHARS);
      const serviceId = nonEmptyString(body.serviceId) ?? nonEmptyString(body.service_id) ?? run?.serviceId;
      const agent = nonEmptyString(body.agent) ?? run?.agent;
      manager.recordRuntimeEvent({
        kind,
        level: "info",
        message: `HITL input received (${runId})`,
        serviceId,
        data: {
          runId,
          ...(serviceId ? { serviceId } : {}),
          ...(agent ? { agent } : {}),
          message: sanitized.message,
          messageOriginalLength: sanitized.originalLength,
          messageStoredLength: sanitized.storedLength,
          messageTruncated: sanitized.truncated,
          messageRedacted: sanitized.redacted,
          source: "gateway_ui",
          channel: "virtual_cli",
          submittedAt: new Date().toISOString()
        }
      });
      json(res, 200, {
        ok: true,
        runId,
        kind,
        message_truncated: sanitized.truncated,
        message_redacted: sanitized.redacted,
        ...(serviceId ? { serviceId } : {}),
        ...(agent ? { agent } : {})
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/agents/runs") {
      const limit = parseLimit(url.searchParams.get("limit"), 100);
      json(res, 200, { items: manager.getAgentRuns(limit) });
      return;
    }

    if (method === "POST" && url.pathname === "/api/agents/events") {
      const body = await readJsonBody(req) as {
        kind?: unknown;
        level?: unknown;
        message?: unknown;
        service_id?: unknown;
        run_id?: unknown;
        runId?: unknown;
        step_id?: unknown;
        stepId?: unknown;
        agent?: unknown;
        data?: unknown;
      };
      const kind = typeof body.kind === "string" ? body.kind.trim() : "";
      if (!kind.startsWith("agent.")) {
        json(res, 400, { error: "expected kind to start with 'agent.'" });
        return;
      }
      const level = body.level === "warn" || body.level === "error" ? body.level : "info";
      const payload = typeof body.data === "object" && body.data ? body.data as Record<string, unknown> : {};
      const runId = typeof body.runId === "string"
        ? body.runId
        : (typeof body.run_id === "string" ? body.run_id : undefined);
      const stepId = typeof body.stepId === "string"
        ? body.stepId
        : (typeof body.step_id === "string" ? body.step_id : undefined);
      const agent = typeof body.agent === "string" ? body.agent : undefined;
      const data = {
        ...payload,
        ...(runId ? { runId } : {}),
        ...(stepId ? { stepId } : {}),
        ...(agent ? { agent } : {})
      };
      if (kind === "agent.run_created") {
        const validationError = validateAgentRunCreatedPayload(data);
        if (validationError) {
          json(res, 400, { error: validationError });
          return;
        }
      }
      const message = typeof body.message === "string" && body.message.trim().length > 0
        ? body.message
        : `${kind}${runId ? ` (${runId})` : ""}`;
      const serviceId = typeof body.service_id === "string"
        ? body.service_id
        : (typeof (data as { serviceId?: unknown }).serviceId === "string"
          ? String((data as { serviceId: unknown }).serviceId)
          : (typeof (data as { service_id?: unknown }).service_id === "string"
            ? String((data as { service_id: unknown }).service_id)
            : undefined));
      if (kind === "agent.run_created") {
        const triggerDeclarationError = await validateDeclaredServiceTrigger(manager, serviceId, data);
        if (triggerDeclarationError) {
          json(res, 400, { error: triggerDeclarationError });
          return;
        }
      }
      manager.recordRuntimeEvent({
        kind,
        level,
        message,
        serviceId,
        data
      });
      json(res, 200, { ok: true });
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
      const limit = parseLimit(url.searchParams.get("limit"), 200);
      json(res, 200, {
        serviceId: id,
        lines: await manager.tailLogs(id, limit)
      });
      return;
    }

    const serviceEventsMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/events$/);
    if (method === "GET" && serviceEventsMatch) {
      const id = decodeURIComponent(serviceEventsMatch[1]);
      const limit = parseLimit(url.searchParams.get("limit"), 200);
      json(res, 200, {
        serviceId: id,
        items: manager.getServiceEvents(id, limit)
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

      const logLimit = parseLimit(url.searchParams.get("log_limit"), 50);
      const eventLimit = parseLimit(url.searchParams.get("event_limit"), 100);
      const callLimit = parseLimit(url.searchParams.get("call_limit"), 20);
      const logs = await manager.tailLogs(id, logLimit);
      const events = manager.getServiceEvents(id, eventLimit);
      const recentCalls = extractRecentCalls(events, callLimit);

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
