import { access, readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type {
  InterfaceSnapshot,
  MCPServiceManifest,
  RemoteMcpOrigin,
  ServiceRecord
} from "../../types/contracts.js";
import { deriveInterfaceRevision, deriveServiceId } from "../registry/ids.js";
import { ServiceRegistry } from "../registry/registry.js";
import { normalizeNamespace } from "../security/namespace.js";
import { resolveRemoteAuthHeaders, resolveRemoteAuthSecret } from "../security/remote-auth.js";

function nowIso(): string {
  return new Date().toISOString();
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as Record<string, unknown>;
}

function extractListResult<T>(value: unknown, key: string): T[] {
  const obj = asObject(value);
  const raw = obj[key];
  if (Array.isArray(raw)) {
    return raw as T[];
  }
  return [];
}

interface WasmMarshalRecordField {
  name: string;
  type: WasmMarshalType;
}

type WasmMarshalType =
  | { kind: "Int64" }
  | { kind: "Float64" }
  | { kind: "Bool" }
  | { kind: "String" }
  | { kind: "Timestamp" }
  | { kind: "List"; element: WasmMarshalType }
  | { kind: "Record"; fields: WasmMarshalRecordField[] }
  | { kind: "Option"; inner: WasmMarshalType }
  | { kind: "Result"; ok: WasmMarshalType; err: WasmMarshalType };

function parseFunctionArgs(args: unknown): unknown[] {
  const payload = asObject(args);
  const raw = payload.args;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw;
}

function parseFunctionExpectString(args: unknown): boolean {
  const payload = asObject(args);
  return payload.expectStringResult === true || payload.expect_string_result === true;
}

function parseFunctionAllowStringArgs(args: unknown): boolean {
  const payload = asObject(args);
  return payload.allowStringArgs === true || payload.allow_string_args === true;
}

function parseFunctionArgTypes(args: unknown): Array<WasmMarshalType | undefined> | undefined {
  const payload = asObject(args);
  const raw = payload.argTypes ?? payload.arg_types;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const parsed = raw.map((item) => parseWasmMarshalType(item));
  return parsed.some((item) => item !== undefined) ? parsed : undefined;
}

function parseFunctionResultType(args: unknown): WasmMarshalType | undefined {
  const payload = asObject(args);
  return parseWasmMarshalType(payload.resultType ?? payload.result_type);
}

function parseAllowedHosts(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const hosts = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0) return null;
  return new Set(hosts);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseRatio(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return undefined;
  }
  return parsed;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asNonEmptyString(item))
    .filter((item): item is string => item !== undefined);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

const TIMER_EXPR_RE = /^every\s+(\d+)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i;

interface ParsedTimerSchedule {
  intervalMs: number;
}

function parseTimerScheduleExpr(expr: string): ParsedTimerSchedule | null {
  const match = TIMER_EXPR_RE.exec(expr.trim());
  if (!match) {
    return null;
  }
  const every = Number.parseInt(match[1], 10);
  if (!Number.isInteger(every) || every <= 0) {
    return null;
  }
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "ms" || unit === "millisecond" || unit === "milliseconds"
      ? 1
      : unit === "s" || unit === "sec" || unit === "secs" || unit === "second" || unit === "seconds"
        ? 1_000
        : unit === "m" || unit === "min" || unit === "mins" || unit === "minute" || unit === "minutes"
          ? 60_000
          : 3_600_000;
  const intervalMs = every * multiplier;
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000 || intervalMs > 86_400_000) {
    return null;
  }
  return { intervalMs };
}

const LOCAL_WASM_UNSUPPORTED_IMPORTS = new Set([
  "a2a_discover",
  "a2a_submit",
  "a2a_poll",
  "a2a_cancel",
  "mcp_connect",
  "mcp_list_tools",
  "mcp_call_tool",
  "mcp_disconnect"
]);

const DEFAULT_TELEMETRY_PATH = path.resolve(process.cwd(), ".clarity/runtime/telemetry.json");

interface TelemetryFile {
  version: 1;
  updatedAt: string;
  events: AuditEvent[];
  logs: Record<string, string[]>;
}

const AUDIT_EVENT_ALLOWLIST = new Set([
  "mcp.tool_called",
  "mcp.trace_span",
  "mcp.cost_ledger",
  "mcp.budget_exceeded"
]);

function includeLifecycleAudit(env = process.env): boolean {
  const raw = (env.CLARITY_AUDIT_INCLUDE_LIFECYCLE ?? "1").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export interface AuditEvent {
  seq: number;
  at: string;
  kind: string;
  serviceId?: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

export interface ToolCallContext {
  traceId?: string;
  runId?: string;
  sessionId?: string;
  localEnvOverrides?: Record<string, string>;
  spanId?: string;
  retries?: number;
  requestBytes?: number;
  responseBytes?: number;
  provider?: string;
  model?: string;
  latencyMs?: number;
}

export type AgentRunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type AgentTriggerType = "timer" | "event" | "api" | "a2a" | "unknown";

export interface AgentRunSummary {
  runId: string;
  agent: string;
  serviceId?: string;
  trigger: AgentTriggerType;
  triggerContext?: Record<string, unknown>;
  causationId?: string;
  correlationId?: string;
  parentRunId?: string;
  fromAgentId?: string;
  status: AgentRunStatus;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  waitingReason?: string;
  failureReason?: string;
  stepCount: number;
  handoffCount: number;
  toolCallCount: number;
  llmCallCount: number;
  eventCount: number;
  currentStepId?: string;
  lastEventKind?: string;
  lastEventMessage?: string;
}

export interface ServiceManagerOptions {
  hitlChatMode?: "auto" | "echo" | "disabled";
}

interface WorkerValue {
  kind: "undefined" | "string" | "number" | "boolean" | "bigint";
  value?: string | number | boolean;
}

interface ResolvedRuntimeChatConfig {
  mode: "auto" | "echo" | "disabled";
  strategy: "agent_tool" | "echo";
  handlerTool: string;
  historyEnabled: boolean;
  historyMaxTurns: number;
  historyMaxChars: number;
}

interface RuntimeChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface RuntimeChatHistorySnapshot {
  messages: RuntimeChatMessage[];
  totalMessages: number;
  truncated: boolean;
  maxTurns: number;
  maxChars: number;
}

interface RuntimeChatContextEnvelopeV1 {
  version: "context.v1";
  task: {
    runId: string;
    sessionId: string;
    serviceId: string;
    agent: string;
    objective?: string;
    role?: string;
  };
  instructions: {
    allowedMcpTools: string[];
    allowedLlmProviders: string[];
  };
  userContext: {
    latestMessage: string;
    trigger: AgentTriggerType;
    triggerContext: Record<string, unknown>;
  };
  retrieval: {
    items: Array<Record<string, unknown>>;
    count: number;
  };
  conversation: {
    messages: RuntimeChatMessage[];
    totalMessages: number;
    truncated: boolean;
  };
  runtimeState: {
    status?: AgentRunStatus;
    waitingReason?: string;
    eventCount?: number;
    lastEventKind?: string;
  };
  policy: {
    mode: "auto" | "echo" | "disabled";
    strategy: "agent_tool" | "echo";
    handlerTool: string;
    historyEnabled: boolean;
    historyMaxTurns: number;
    historyMaxChars: number;
  };
  budget: {
    historyCharsUsed: number;
    historyCharsMax: number;
    historyCharsRemaining: number;
  };
  provenance: {
    generatedAt: string;
    source: "runtime_hitl_executor";
  };
}

const WASM_STRING_TYPE: WasmMarshalType = { kind: "String" };
const WASM_INT64_TYPE: WasmMarshalType = { kind: "Int64" };
const WASM_BOOL_TYPE: WasmMarshalType = { kind: "Bool" };

const RUNTIME_CHAT_MESSAGE_MARSHAL_TYPE: WasmMarshalType = {
  kind: "Record",
  fields: [
    { name: "role", type: WASM_STRING_TYPE },
    { name: "content", type: WASM_STRING_TYPE }
  ]
};

const RUNTIME_CHAT_HISTORY_MARSHAL_TYPE: WasmMarshalType = {
  kind: "Record",
  fields: [
    { name: "totalMessages", type: WASM_INT64_TYPE },
    { name: "usedMessages", type: WASM_INT64_TYPE },
    { name: "truncated", type: WASM_BOOL_TYPE },
    { name: "maxTurns", type: WASM_INT64_TYPE },
    { name: "maxChars", type: WASM_INT64_TYPE }
  ]
};

const RUNTIME_CHAT_STRUCTURED_CONTEXT_MARSHAL_TYPE: WasmMarshalType = {
  kind: "Record",
  fields: [
    { name: "runId", type: WASM_STRING_TYPE },
    { name: "sessionId", type: WASM_STRING_TYPE },
    { name: "serviceId", type: WASM_STRING_TYPE },
    { name: "agent", type: WASM_STRING_TYPE },
    { name: "contextVersion", type: WASM_STRING_TYPE },
    { name: "latestMessage", type: WASM_STRING_TYPE },
    { name: "trigger", type: WASM_STRING_TYPE },
    {
      name: "messages",
      type: {
        kind: "List",
        element: RUNTIME_CHAT_MESSAGE_MARSHAL_TYPE
      }
    },
    { name: "history", type: RUNTIME_CHAT_HISTORY_MARSHAL_TYPE },
    { name: "contextJson", type: WASM_STRING_TYPE }
  ]
};

const TIMER_STRUCTURED_CONTEXT_MARSHAL_TYPE: WasmMarshalType = {
  kind: "Record",
  fields: [
    { name: "runId", type: WASM_STRING_TYPE },
    { name: "agent", type: WASM_STRING_TYPE },
    { name: "trigger", type: WASM_STRING_TYPE },
    { name: "scheduleId", type: WASM_STRING_TYPE },
    { name: "scheduleExpr", type: WASM_STRING_TYPE },
    { name: "firedAt", type: WASM_STRING_TYPE }
  ]
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseWasmMarshalType(input: unknown): WasmMarshalType | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const obj = asObject(input);
  const kindRaw = asNonEmptyString(obj.kind ?? obj.type)?.toLowerCase();
  if (!kindRaw) {
    return undefined;
  }
  if (kindRaw === "int64") {
    return { kind: "Int64" };
  }
  if (kindRaw === "float64") {
    return { kind: "Float64" };
  }
  if (kindRaw === "bool" || kindRaw === "boolean") {
    return { kind: "Bool" };
  }
  if (kindRaw === "string") {
    return { kind: "String" };
  }
  if (kindRaw === "timestamp") {
    return { kind: "Timestamp" };
  }
  if (kindRaw === "list") {
    const element = parseWasmMarshalType(obj.element);
    if (!element) {
      return undefined;
    }
    return {
      kind: "List",
      element
    };
  }
  if (kindRaw === "record") {
    const fieldsRaw = Array.isArray(obj.fields) ? obj.fields : [];
    if (fieldsRaw.length === 0) {
      return undefined;
    }
    const fields: WasmMarshalRecordField[] = [];
    for (const entry of fieldsRaw) {
      const fieldObj = asObject(entry);
      const name = asNonEmptyString(fieldObj.name);
      const type = parseWasmMarshalType(fieldObj.type);
      if (!name || !type) {
        return undefined;
      }
      fields.push({ name, type });
    }
    return {
      kind: "Record",
      fields
    };
  }
  if (kindRaw === "option") {
    const inner = parseWasmMarshalType(obj.inner);
    if (!inner) {
      return undefined;
    }
    return {
      kind: "Option",
      inner
    };
  }
  if (kindRaw === "result") {
    const ok = parseWasmMarshalType(obj.ok);
    const err = parseWasmMarshalType(obj.err);
    if (!ok || !err) {
      return undefined;
    }
    return {
      kind: "Result",
      ok,
      err
    };
  }
  return undefined;
}

function normalizeTrigger(value: unknown): AgentTriggerType {
  const trigger = String(value ?? "").trim().toLowerCase();
  if (trigger === "timer" || trigger === "event" || trigger === "api" || trigger === "a2a") {
    return trigger;
  }
  return "unknown";
}

function pickTriggerContext(trigger: AgentTriggerType, payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const base = asObject(payload.triggerContext ?? payload.trigger_context);
  const out: Record<string, unknown> = { ...base };
  const keysets: Record<Exclude<AgentTriggerType, "unknown">, string[]> = {
    timer: ["scheduleId", "scheduleExpr", "firedAt"],
    event: ["eventType", "eventId", "correlationId", "producer"],
    api: ["route", "method", "requestId", "caller"],
    a2a: ["parentRunId", "fromAgentId", "handoffReason"]
  };
  const keys = trigger === "unknown" ? [] : keysets[trigger];
  for (const key of keys) {
    const camel = payload[key];
    const snake = payload[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`) as keyof typeof payload];
    if (camel !== undefined && out[key] === undefined) {
      out[key] = camel;
    } else if (snake !== undefined && out[key] === undefined) {
      out[key] = snake;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

type WorkerResponse =
  | {
      ok: true;
      value: WorkerValue;
    }
  | {
      ok: false;
      errorType: "TypeError" | "RuntimeError" | "MissingFunction";
      message: string;
    };

export class ServiceManager {
  private readonly registry: ServiceRegistry;
  private readonly telemetryPath: string;
  private readonly starts = new Map<string, number>();
  private readonly logs = new Map<string, string[]>();
  private readonly remoteInitialized = new Set<string>();
  private readonly remoteInFlight = new Map<string, number>();
  private readonly localModuleCache = new Map<string, WebAssembly.Module>();
  private readonly timerIntervals = new Map<string, NodeJS.Timeout>();
  private readonly timerRunChains = new Map<string, Promise<void>>();
  private readonly startFailures = new Map<string, number[]>();
  private readonly toolCallOutcomes = new Map<string, Array<{ at: number; ok: boolean }>>();
  private readonly events: AuditEvent[] = [];
  private readonly eventSubscribers = new Set<(event: AuditEvent) => void>();
  private readonly lifecycleAuditEnabled: boolean;
  private readonly hitlChatMode: "auto" | "echo" | "disabled";
  private readonly hitlRunChains = new Map<string, Promise<void>>();
  private telemetryWriteQueue: Promise<void> = Promise.resolve();
  private telemetryLoaded = false;
  private eventSeq = 1;
  private remoteRequestCounter = 1;
  private pidCounter = 49000;

  constructor(
    registry: ServiceRegistry,
    telemetryPath = DEFAULT_TELEMETRY_PATH,
    options: ServiceManagerOptions = {}
  ) {
    this.registry = registry;
    this.telemetryPath = telemetryPath;
    this.lifecycleAuditEnabled = includeLifecycleAudit();
    const modeRaw = (options.hitlChatMode ?? process.env.CLARITY_HITL_CHAT_MODE ?? "auto")
      .trim()
      .toLowerCase();
    this.hitlChatMode = (modeRaw === "disabled" || modeRaw === "echo") ? modeRaw : "auto";
  }

  async init(): Promise<void> {
    if (this.telemetryLoaded) {
      return;
    }
    await this.loadTelemetry();
    const records = await this.registry.list();
    for (const record of records) {
      const serviceId = record.manifest.metadata.serviceId!;
      if (record.runtime.lifecycle === "RUNNING") {
        this.syncTimerSchedulesForService(record);
      } else {
        this.clearTimerSchedulesForService(serviceId);
      }
    }
    this.telemetryLoaded = true;
  }

  async applyManifest(manifest: MCPServiceManifest): Promise<ServiceRecord> {
    await this.init();
    manifest.spec.toolNamespace = normalizeNamespace(manifest.spec.toolNamespace ?? manifest.metadata.module);
    manifest.metadata.serviceId =
      manifest.metadata.serviceId
      ?? deriveServiceId({
        sourceFile: manifest.metadata.sourceFile,
        module: manifest.metadata.module,
        artifactOrEndpoint:
          manifest.spec.origin.type === "local_wasm"
            ? manifest.spec.origin.wasmPath
            : manifest.spec.origin.endpoint
      });
    const record = await this.registry.upsert(manifest);
    this.appendLog(manifest.metadata.serviceId!, `Manifest applied (${manifest.spec.origin.type})`);
    this.emitEvent({
      kind: "service.manifest_applied",
      serviceId: manifest.metadata.serviceId,
      level: "info",
      message: `Manifest applied for ${manifest.metadata.serviceId}`,
      data: {
        origin: manifest.spec.origin.type,
        module: manifest.metadata.module
      }
    });
    if (record.runtime.lifecycle === "RUNNING") {
      this.syncTimerSchedulesForService(record);
    } else {
      this.clearTimerSchedulesForService(manifest.metadata.serviceId!);
    }
    return record;
  }

  async list(): Promise<ServiceRecord[]> {
    await this.init();
    const records = await this.registry.list();
    return records.map((record) => this.withLiveRuntime(record));
  }

  async get(serviceId: string): Promise<ServiceRecord | undefined> {
    await this.init();
    const record = await this.registry.get(serviceId);
    return record ? this.withLiveRuntime(record) : undefined;
  }

  async unquarantine(serviceId: string): Promise<ServiceRecord> {
    await this.init();
    const current = await this.registry.get(serviceId);
    if (!current) {
      throw new Error(`service not found: ${serviceId}`);
    }
    const updated = await this.registry.update(serviceId, (record) => ({
      ...record,
      runtime: {
        ...record.runtime,
        lifecycle: "STOPPED",
        health: "UNKNOWN",
        lastError: undefined,
        pid: undefined
      }
    }));
    this.startFailures.delete(serviceId);
    this.toolCallOutcomes.delete(serviceId);
    this.clearTimerSchedulesForService(serviceId);
    this.emitEvent({
      kind: "service.unquarantined",
      serviceId,
      level: "info",
      message: `Service unquarantined: ${serviceId}`
    });
    return updated;
  }

  async start(serviceId: string): Promise<ServiceRecord> {
    await this.init();
    const existing = await this.registry.get(serviceId);
    if (!existing) {
      throw new Error(`service not found: ${serviceId}`);
    }
    if (existing.runtime.lifecycle === "QUARANTINED") {
      throw new Error(`service is quarantined: ${serviceId} (use unquarantine first)`);
    }

    let health: ServiceRecord["runtime"]["health"] = "HEALTHY";
    let lastError: string | undefined;

    if (existing.manifest.spec.origin.type === "local_wasm") {
      try {
        await access(existing.manifest.spec.origin.wasmPath);
      } catch {
        health = "DEGRADED";
        lastError = `wasm artifact missing: ${existing.manifest.spec.origin.wasmPath}`;
      }
      if (!lastError) {
        try {
          await this.assertLocalWasmImportSupport(existing);
        } catch (error) {
          health = "DEGRADED";
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (existing.manifest.spec.origin.type === "remote_mcp") {
      try {
        this.enforceRemoteHostPolicy(existing.manifest.spec.origin);
        await this.ensureRemoteInitialized(serviceId, existing.manifest.spec.origin);
      } catch (error) {
        health = "DEGRADED";
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    const startFailed = !!lastError;
    const quarantined = await this.shouldQuarantine(existing, startFailed);
    const updated = await this.registry.update(serviceId, (current) => {
      const nextLifecycle = quarantined ? "QUARANTINED" : (startFailed ? "STOPPED" : "RUNNING");
      return {
        ...current,
        runtime: {
          ...current.runtime,
          lifecycle: nextLifecycle,
          health,
          pid: nextLifecycle === "RUNNING" ? ++this.pidCounter : undefined,
          uptimeSeconds: 0,
          lastHeartbeatAt: nowIso(),
          lastError
        }
      };
    });

    this.appendLog(
      serviceId,
      quarantined
        ? "Service quarantined after repeated failures"
        : (startFailed ? "Service start failed" : "Service started")
    );
    if (lastError) {
      this.appendLog(serviceId, `Start warning: ${lastError}`);
      this.emitEvent({
        kind: "service.start_warning",
        serviceId,
        level: "warn",
        message: `Service start warning for ${serviceId}`,
        data: { error: lastError }
      });
    }
    if (quarantined) {
      this.starts.delete(serviceId);
      this.clearTimerSchedulesForService(serviceId);
      this.emitEvent({
        kind: "service.quarantined",
        serviceId,
        level: "error",
        message: `Service quarantined: ${serviceId}`,
        data: { reason: lastError ?? "start failure threshold exceeded" }
      });
    } else if (startFailed) {
      this.starts.delete(serviceId);
      this.clearTimerSchedulesForService(serviceId);
      this.emitEvent({
        kind: "service.start_failed",
        serviceId,
        level: "error",
        message: `Service start failed: ${serviceId}`,
        data: { reason: lastError }
      });
    } else {
      this.starts.set(serviceId, Date.now());
      this.syncTimerSchedulesForService(updated);
      this.emitEvent({
        kind: "service.started",
        serviceId,
        level: "info",
        message: `Service started: ${serviceId}`
      });
    }

    return updated;
  }

  async stop(serviceId: string): Promise<ServiceRecord> {
    await this.init();
    const updated = await this.registry.update(serviceId, (current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        lifecycle: "STOPPED",
        health: "UNKNOWN",
        pid: undefined,
        uptimeSeconds: 0,
        lastHeartbeatAt: nowIso()
      }
    }));
    this.starts.delete(serviceId);
    this.clearTimerSchedulesForService(serviceId);
    this.remoteInitialized.delete(serviceId);
    this.toolCallOutcomes.delete(serviceId);
    this.appendLog(serviceId, "Service stopped");
    this.emitEvent({
      kind: "service.stopped",
      serviceId,
      level: "info",
      message: `Service stopped: ${serviceId}`
    });
    return updated;
  }

  async restart(serviceId: string): Promise<ServiceRecord> {
    await this.init();
    await this.stop(serviceId);
    await this.registry.update(serviceId, (current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        restartCount: current.runtime.restartCount + 1
      }
    }));
    const updated = await this.start(serviceId);
    this.emitEvent({
      kind: "service.restarted",
      serviceId,
      level: "info",
      message: `Service restarted: ${serviceId}`
    });
    return updated;
  }

  async remove(serviceId: string, options?: { cleanupArtifacts?: boolean }): Promise<{ removed: boolean; artifactRemoved: boolean; serviceId: string }> {
    await this.init();
    const current = await this.registry.get(serviceId);
    if (!current) {
      return { removed: false, artifactRemoved: false, serviceId };
    }

    let artifactRemoved = false;
    if (options?.cleanupArtifacts && current.manifest.spec.origin.type === "local_wasm") {
      try {
        await rm(current.manifest.spec.origin.wasmPath, { force: true });
        artifactRemoved = true;
      } catch {
        artifactRemoved = false;
      }
    }

    this.starts.delete(serviceId);
    this.clearTimerSchedulesForService(serviceId);
    this.logs.delete(serviceId);
    this.remoteInitialized.delete(serviceId);
    this.remoteInFlight.delete(serviceId);
    this.startFailures.delete(serviceId);
    this.toolCallOutcomes.delete(serviceId);
    this.localModuleCache.delete(serviceId);
    const removed = await this.registry.remove(serviceId);
    if (removed) {
      this.emitEvent({
        kind: "service.removed",
        serviceId,
        level: "info",
        message: `Service removed: ${serviceId}`,
        data: {
          cleanupArtifacts: !!options?.cleanupArtifacts,
          artifactRemoved
        }
      });
    }
    return { removed, artifactRemoved, serviceId };
  }

  async refreshInterface(serviceId: string): Promise<InterfaceSnapshot> {
    await this.init();
    const service = await this.registry.get(serviceId);
    if (!service) {
      throw new Error(`service not found: ${serviceId}`);
    }

    let snapshot: InterfaceSnapshot;

    if (service.manifest.spec.origin.type === "remote_mcp") {
      this.enforceRemoteHostPolicy(service.manifest.spec.origin);
      await this.ensureRemoteInitialized(serviceId, service.manifest.spec.origin);
      const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
        this.remoteRequest(serviceId, service.manifest.spec.origin, "tools/list", {}),
        this.remoteRequest(serviceId, service.manifest.spec.origin, "resources/list", {}).catch(() => ({ resources: [] })),
        this.remoteRequest(serviceId, service.manifest.spec.origin, "prompts/list", {}).catch(() => ({ prompts: [] }))
      ]);

      snapshot = {
        interfaceRevision: deriveInterfaceRevision(`${serviceId}:${JSON.stringify(toolsResult)}:${Date.now()}`),
        introspectedAt: nowIso(),
        tools: extractListResult<{ name: string; description?: string; inputSchema?: unknown }>(toolsResult, "tools"),
        resources: extractListResult<{ uri: string; name?: string; description?: string }>(resourcesResult, "resources"),
        prompts: extractListResult<{
          name: string;
          description?: string;
          arguments?: Array<{ name: string; required?: boolean; description?: string }>;
        }>(promptsResult, "prompts")
      };
    } else {
      const namespace = service.manifest.spec.toolNamespace ?? service.manifest.metadata.module.toLowerCase();
      const localFunctions = await this.discoverLocalFunctions(service.manifest.spec.origin.wasmPath);
      snapshot = {
        interfaceRevision: deriveInterfaceRevision(`${serviceId}:${Date.now()}`),
        introspectedAt: nowIso(),
        tools: [
          {
            name: "health_check",
            description: `Health probe for ${namespace}`,
            inputSchema: {
              type: "object",
              properties: {
                verbose: { type: "boolean" }
              },
              additionalProperties: false
            }
          },
          {
            name: "describe_service",
            description: "Returns runtime metadata for this local service",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          },
          ...localFunctions.map((fn) => ({
            name: `fn__${fn}`,
            description: `Invoke local exported function '${fn}' in-process`,
            inputSchema: {
              type: "object",
              properties: {
                args: {
                  type: "array",
                  items: {
                    anyOf: [
                      { type: "string" },
                      { type: "number" },
                      { type: "boolean" },
                      { type: "object" },
                      { type: "array" }
                    ]
                  }
                },
                argTypes: {
                  type: "array",
                  items: { type: "object" }
                },
                resultType: {
                  type: "object"
                }
              },
              additionalProperties: false
            }
          }))
        ],
        resources: [],
        prompts: []
      };
    }

    await this.registry.update(serviceId, (current) => ({
      ...current,
      interfaceSnapshot: snapshot,
      runtime: {
        ...current.runtime,
        lastHeartbeatAt: nowIso(),
        health: current.runtime.lifecycle === "RUNNING" ? "HEALTHY" : current.runtime.health,
        lastError: undefined
      }
    }));

    this.appendLog(serviceId, "Interface snapshot refreshed");
    this.emitEvent({
      kind: "service.interface_refreshed",
      serviceId,
      level: "info",
      message: `Interface refreshed for ${serviceId}`,
      data: { revision: snapshot.interfaceRevision }
    });
    return snapshot;
  }

  async callTool(serviceId: string, toolName: string, args: unknown, context?: ToolCallContext): Promise<unknown> {
    await this.init();
    const service = await this.registry.get(serviceId);
    if (!service) {
      throw new Error(`service not found: ${serviceId}`);
    }

    if (service.runtime.lifecycle !== "RUNNING") {
      throw new Error(`service is not running: ${serviceId}`);
    }

    const startedAt = Date.now();
    try {
      if (service.manifest.spec.origin.type === "remote_mcp") {
        this.enforceRemoteHostPolicy(service.manifest.spec.origin);
        if (
          Array.isArray(service.manifest.spec.origin.allowedTools)
          && service.manifest.spec.origin.allowedTools.length > 0
          && !service.manifest.spec.origin.allowedTools.includes(toolName)
        ) {
          throw new Error(`tool '${toolName}' is not allowed by remote policy`);
        }
        const result = await this.remoteRequest(
          serviceId,
          service.manifest.spec.origin,
          "tools/call",
          {
            name: toolName,
            arguments: args ?? {}
          },
          context
        );
        this.appendLog(serviceId, `tools/call ${toolName}`);
        this.emitEvent({
          kind: "service.tool_called",
          serviceId,
          level: "info",
          message: `Remote tool called: ${toolName}`,
        });
        if (context) {
          context.latencyMs = Math.max(0, Date.now() - startedAt);
          if (context.retries === undefined) {
            context.retries = 0;
          }
        }
        this.recordToolCallOutcome(serviceId, true);
        return result;
      }

      if (toolName === "health_check") {
        this.appendLog(serviceId, "tools/call health_check");
        if (context) {
          context.requestBytes = byteLength(JSON.stringify(args ?? {}));
          context.responseBytes = byteLength(JSON.stringify({ health: service.runtime.health }));
          context.retries = 0;
          context.latencyMs = Math.max(0, Date.now() - startedAt);
        }
        this.recordToolCallOutcome(serviceId, true);
        return {
          content: [
            {
              type: "text",
              text: `Service ${serviceId} is running with health=${service.runtime.health}`
            }
          ]
        };
      }

      if (toolName === "describe_service") {
        this.appendLog(serviceId, "tools/call describe_service");
        const text = JSON.stringify(
          {
            serviceId,
            module: service.manifest.metadata.module,
            sourceFile: service.manifest.metadata.sourceFile,
            wasmPath: service.manifest.spec.origin.wasmPath,
            entry: service.manifest.spec.origin.entry,
            runtime: service.runtime
          },
          null,
          2
        );
        if (context) {
          context.requestBytes = byteLength(JSON.stringify(args ?? {}));
          context.responseBytes = byteLength(text);
          context.retries = 0;
          context.latencyMs = Math.max(0, Date.now() - startedAt);
        }
        this.recordToolCallOutcome(serviceId, true);
        return {
          content: [
            {
              type: "text",
              text
            }
          ]
        };
      }

      if (toolName.startsWith("fn__")) {
        const functionName = toolName.slice("fn__".length);
        const argsList = parseFunctionArgs(args);
        const argTypes = parseFunctionArgTypes(args);
        const resultType = parseFunctionResultType(args);
        const output = await this.runLocalFunction(service, functionName, argsList, {
          expectStringResult: parseFunctionExpectString(args),
          allowStringArgs: parseFunctionAllowStringArgs(args),
          argTypes,
          resultType,
          envOverrides: context?.localEnvOverrides
        });
        this.appendLog(serviceId, `tools/call ${toolName}(${JSON.stringify(argsList)})`);
        this.emitEvent({
          kind: "service.tool_called",
          serviceId,
          level: "info",
          message: `Local function tool called: ${toolName}`
        });
        if (context) {
          context.requestBytes = byteLength(JSON.stringify(argsList));
          context.responseBytes = byteLength(output);
          context.retries = 0;
          context.latencyMs = Math.max(0, Date.now() - startedAt);
        }
        this.recordToolCallOutcome(serviceId, true);
        return {
          content: [
            {
              type: "text",
              text: output
            }
          ]
        };
      }

      throw new Error(`unsupported local tool: ${toolName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (context) {
        context.latencyMs = Math.max(0, Date.now() - startedAt);
        if (context.retries === undefined) {
          context.retries = 0;
        }
      }
      this.recordToolCallOutcome(serviceId, false);
      await this.maybeQuarantineOnToolErrorRate(serviceId, message);
      throw error;
    }
  }

  async tailLogs(serviceId: string, limit = 200): Promise<string[]> {
    const lines = this.logs.get(serviceId) ?? [];
    return lines.slice(Math.max(0, lines.length - limit));
  }

  getRecentEvents(limit = 200): AuditEvent[] {
    return this.events.slice(Math.max(0, this.events.length - limit));
  }

  getServiceEvents(serviceId: string, limit = 200): AuditEvent[] {
    const filtered = this.events.filter((event) => event.serviceId === serviceId);
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  getRecentAgentEvents(limit = 200): AuditEvent[] {
    const filtered = this.events.filter((event) => event.kind.startsWith("agent."));
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  getAgentRunEvents(runId: string, limit = 200): AuditEvent[] {
    const normalized = runId.trim();
    if (!normalized) {
      return [];
    }
    const filtered = this.events.filter((event) => {
      if (!event.kind.startsWith("agent.")) {
        return false;
      }
      const payload = asObject(event.data);
      const eventRunId = String(payload.runId ?? payload.run_id ?? "");
      return eventRunId === normalized;
    });
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  getAgentRuns(limit = 100): AgentRunSummary[] {
    type MutableRun = AgentRunSummary & { seenStepIds: Set<string> };
    const runs = new Map<string, MutableRun>();
    for (const event of this.events) {
      if (!event.kind.startsWith("agent.")) {
        continue;
      }
      const payload = asObject(event.data);
      const runId = String(payload.runId ?? payload.run_id ?? "").trim();
      if (!runId) {
        continue;
      }
      const agent = String(payload.agent ?? payload.agent_name ?? "unknown").trim() || "unknown";
      const current = runs.get(runId) ?? {
        runId,
        agent,
        serviceId: event.serviceId,
        trigger: "unknown" as AgentRunSummary["trigger"],
        triggerContext: undefined,
        causationId: undefined,
        correlationId: undefined,
        parentRunId: undefined,
        fromAgentId: undefined,
        status: "queued" as AgentRunStatus,
        startedAt: undefined,
        updatedAt: event.at,
        completedAt: undefined,
        waitingReason: undefined,
        failureReason: undefined,
        stepCount: 0,
        handoffCount: 0,
        toolCallCount: 0,
        llmCallCount: 0,
        eventCount: 0,
        currentStepId: undefined,
        lastEventKind: undefined,
        lastEventMessage: undefined,
        seenStepIds: new Set<string>()
      };
      current.agent = agent;
      current.causationId = asNonEmptyString(payload.causationId ?? payload.causation_id) ?? current.causationId;
      current.correlationId = asNonEmptyString(payload.correlationId ?? payload.correlation_id) ?? current.correlationId;
      current.parentRunId = asNonEmptyString(payload.parentRunId ?? payload.parent_run_id) ?? current.parentRunId;
      current.fromAgentId = asNonEmptyString(payload.fromAgentId ?? payload.from_agent_id ?? payload.from) ?? current.fromAgentId;
      if (event.serviceId && event.serviceId.trim().length > 0) {
        current.serviceId = event.serviceId.trim();
      } else {
        const payloadServiceId = String(payload.serviceId ?? payload.service_id ?? "").trim();
        if (payloadServiceId) {
          current.serviceId = payloadServiceId;
        }
      }
      current.updatedAt = event.at;
      current.eventCount += 1;
      current.lastEventKind = event.kind;
      current.lastEventMessage = event.message;

      const terminal = current.status === "completed" || current.status === "failed" || current.status === "cancelled";

      if (event.kind === "agent.run_created") {
        if (!terminal) {
          current.trigger = normalizeTrigger(payload.trigger ?? payload.triggerType ?? payload.trigger_type ?? payload.source);
          current.triggerContext = pickTriggerContext(current.trigger, payload) ?? current.triggerContext;
          current.status = "queued";
        }
      } else if (event.kind === "agent.run_started") {
        if (!terminal) {
          current.status = "running";
          current.startedAt ??= event.at;
          current.waitingReason = undefined;
          current.failureReason = undefined;
        }
      } else if (event.kind === "agent.waiting") {
        if (!terminal) {
          current.status = "waiting";
          const reason = String(payload.reason ?? payload.waitingReason ?? "").trim();
          if (reason) {
            current.waitingReason = reason;
          }
        }
      } else if (event.kind === "agent.step_started") {
        const stepId = String(payload.stepId ?? payload.step_id ?? "").trim();
        current.currentStepId = stepId || current.currentStepId;
        if (stepId.length > 0) {
          if (!current.seenStepIds.has(stepId)) {
            current.stepCount += 1;
            current.seenStepIds.add(stepId);
          }
        } else {
          current.stepCount += 1;
        }
      } else if (event.kind === "agent.step_completed") {
        const stepId = String(payload.stepId ?? payload.step_id ?? "").trim();
        if (stepId && current.currentStepId === stepId) {
          current.currentStepId = undefined;
        }
      } else if (event.kind === "agent.handoff") {
        if (current.trigger === "unknown") {
          current.trigger = "a2a";
        }
        if (!current.parentRunId) {
          current.parentRunId = asNonEmptyString(payload.parentRunId ?? payload.parent_run_id) ?? current.parentRunId;
        }
        if (!current.fromAgentId) {
          current.fromAgentId = asNonEmptyString(payload.fromAgentId ?? payload.from_agent_id ?? payload.from) ?? current.fromAgentId;
        }
        current.handoffCount += 1;
      } else if (event.kind === "agent.tool_called") {
        current.toolCallCount += 1;
      } else if (event.kind === "agent.llm_called") {
        current.llmCallCount += 1;
      } else if (event.kind === "agent.run_completed") {
        current.status = "completed";
        current.completedAt = event.at;
        current.currentStepId = undefined;
        current.waitingReason = undefined;
        current.failureReason = undefined;
      } else if (event.kind === "agent.run_failed") {
        current.status = "failed";
        current.completedAt = event.at;
        current.currentStepId = undefined;
        current.waitingReason = undefined;
        const failure = String(payload.error ?? payload.reason ?? "").trim();
        current.failureReason = failure || event.message;
      } else if (event.kind === "agent.run_cancelled") {
        current.status = "cancelled";
        current.completedAt = event.at;
        current.currentStepId = undefined;
        current.waitingReason = undefined;
        current.failureReason = undefined;
      }

      runs.set(runId, current);
    }

    return [...runs.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, limit))
      .map((run) => ({
        runId: run.runId,
        agent: run.agent,
        serviceId: run.serviceId,
        trigger: run.trigger,
        triggerContext: run.triggerContext,
        causationId: run.causationId,
        correlationId: run.correlationId,
        parentRunId: run.parentRunId,
        fromAgentId: run.fromAgentId,
        status: run.status,
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt,
        waitingReason: run.waitingReason,
        failureReason: run.failureReason,
        stepCount: run.stepCount,
        handoffCount: run.handoffCount,
        toolCallCount: run.toolCallCount,
        llmCallCount: run.llmCallCount,
        eventCount: run.eventCount,
        currentStepId: run.currentStepId,
        lastEventKind: run.lastEventKind,
        lastEventMessage: run.lastEventMessage
      }));
  }

  subscribeEvents(listener: (event: AuditEvent) => void): () => void {
    this.eventSubscribers.add(listener);
    return () => {
      this.eventSubscribers.delete(listener);
    };
  }

  recordRuntimeEvent(input: {
    kind: string;
    level: "info" | "warn" | "error";
    message: string;
    serviceId?: string;
    data?: unknown;
  }): void {
    this.emitEvent(input);
  }

  queueRuntimeChatMessage(input: {
    runId: string;
    message: string;
    serviceId?: string;
    agent?: string;
  }): boolean {
    return this.queueRuntimeInput(input, { allowDisabledMode: false });
  }

  queueRuntimeHitlInput(input: {
    runId: string;
    message: string;
    serviceId?: string;
    agent?: string;
  }): boolean {
    return this.queueRuntimeInput(input, { allowDisabledMode: true });
  }

  private queueRuntimeInput(
    input: {
      runId: string;
      message: string;
      serviceId?: string;
      agent?: string;
    },
    options: {
      allowDisabledMode: boolean;
    }
  ): boolean {
    const runId = input.runId.trim();
    if (!runId) {
      return false;
    }
    const previous = this.hitlRunChains.get(runId) ?? Promise.resolve();
    const next = previous
      .catch(() => {
        // Ignore previous failures for this run and continue processing new inputs.
      })
      .then(async () => {
        await this.processRuntimeHitlInput(input, options);
      })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.emitEvent({
          kind: "agent.waiting",
          serviceId: input.serviceId,
          level: "warn",
          message: `Awaiting operator input after runtime chat error (${runId})`,
          data: {
            runId,
            ...(input.serviceId ? { serviceId: input.serviceId } : {}),
            ...(input.agent ? { agent: input.agent } : {}),
            reason,
            waitingReason: reason
          }
        });
      });
    this.hitlRunChains.set(runId, next);
    void next.finally(() => {
      if (this.hitlRunChains.get(runId) === next) {
        this.hitlRunChains.delete(runId);
      }
    });
    return true;
  }

  async shutdown(): Promise<void> {
    for (const timer of this.timerIntervals.values()) {
      clearInterval(timer);
    }
    this.timerIntervals.clear();
    if (this.hitlRunChains.size > 0) {
      await Promise.allSettled([...this.hitlRunChains.values()]);
    }
    if (this.timerRunChains.size > 0) {
      await Promise.allSettled([...this.timerRunChains.values()]);
    }
    await this.telemetryWriteQueue;
  }

  async tickUptimes(): Promise<void> {
    await this.init();
    const all = await this.registry.list();
    const running = new Set(
      all
        .filter((s) => s.runtime.lifecycle === "RUNNING")
        .map((s) => s.manifest.metadata.serviceId!)
    );

    for (const tracked of [...this.starts.keys()]) {
      if (!running.has(tracked)) {
        this.starts.delete(tracked);
      }
    }
  }

  private clearTimerSchedulesForService(serviceId: string): void {
    const prefix = `${serviceId}:`;
    for (const [key, timer] of this.timerIntervals.entries()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      clearInterval(timer);
      this.timerIntervals.delete(key);
    }
    for (const key of [...this.timerRunChains.keys()]) {
      if (key.startsWith(prefix)) {
        this.timerRunChains.delete(key);
      }
    }
  }

  private syncTimerSchedulesForService(service: ServiceRecord): void {
    const serviceId = service.manifest.metadata.serviceId!;
    this.clearTimerSchedulesForService(serviceId);
    if (service.runtime.lifecycle !== "RUNNING") {
      return;
    }
    const schedules = this.resolveTimerSchedules(service);
    for (const schedule of schedules) {
      const key = `${serviceId}:${schedule.scheduleId}`;
      const interval = setInterval(() => {
        this.queueTimerScheduleRun(serviceId, schedule);
      }, schedule.intervalMs);
      this.timerIntervals.set(key, interval);
    }
  }

  private resolveTimerSchedules(service: ServiceRecord): Array<{
    scheduleId: string;
    scheduleExpr: string;
    intervalMs: number;
    serial: boolean;
    handlerTool?: string;
  }> {
    const agent = asObject(service.manifest.metadata.agent);
    const triggers = asStringArray(agent.triggers);
    if (!triggers.includes("timer")) {
      return [];
    }
    const timer = asObject(agent.timer);
    const schedules = Array.isArray(timer.schedules) ? timer.schedules : [];
    const serial = timer.serial === false ? false : true;
    const handlerTool = asNonEmptyString(timer.handlerTool);
    const out: Array<{
      scheduleId: string;
      scheduleExpr: string;
      intervalMs: number;
      serial: boolean;
      handlerTool?: string;
    }> = [];
    for (const row of schedules) {
      const entry = asObject(row);
      const enabled = entry.enabled === false ? false : true;
      if (!enabled) {
        continue;
      }
      const scheduleId = asNonEmptyString(entry.scheduleId);
      const scheduleExpr = asNonEmptyString(entry.scheduleExpr);
      if (!scheduleId || !scheduleExpr) {
        continue;
      }
      const parsed = parseTimerScheduleExpr(scheduleExpr);
      if (!parsed) {
        continue;
      }
      out.push({
        scheduleId,
        scheduleExpr,
        intervalMs: parsed.intervalMs,
        serial,
        ...(handlerTool ? { handlerTool } : {})
      });
    }
    return out;
  }

  private queueTimerScheduleRun(
    serviceId: string,
    schedule: {
      scheduleId: string;
      scheduleExpr: string;
      intervalMs: number;
      serial: boolean;
      handlerTool?: string;
    }
  ): void {
    const key = `${serviceId}:${schedule.scheduleId}`;
    if (!schedule.serial) {
      const run = this.executeTimerScheduleRun(serviceId, schedule).catch(() => {});
      this.timerRunChains.set(key, run);
      return;
    }
    const chain = this.timerRunChains.get(key) ?? Promise.resolve();
    const next = chain
      .catch(() => {})
      .then(() => this.executeTimerScheduleRun(serviceId, schedule));
    this.timerRunChains.set(key, next);
  }

  private async executeTimerScheduleRun(
    serviceId: string,
    schedule: {
      scheduleId: string;
      scheduleExpr: string;
      intervalMs: number;
      serial: boolean;
      handlerTool?: string;
    }
  ): Promise<void> {
    const service = await this.registry.get(serviceId);
    if (!service || service.runtime.lifecycle !== "RUNNING") {
      return;
    }
    const agentMeta = asObject(service.manifest.metadata.agent);
    const agentId =
      asNonEmptyString(agentMeta.agentId)
      ?? asNonEmptyString(agentMeta.name)
      ?? asNonEmptyString(service.manifest.metadata.module)
      ?? "unknown-agent";
    const firedAt = nowIso();
    const runId = `timer_${serviceId}_${schedule.scheduleId}_${Date.now()}`;
    const triggerContext = {
      scheduleId: schedule.scheduleId,
      scheduleExpr: schedule.scheduleExpr,
      firedAt
    };

    this.emitEvent({
      kind: "agent.run_created",
      serviceId,
      level: "info",
      message: `Timer schedule fired: ${schedule.scheduleId}`,
      data: {
        runId,
        run_id: runId,
        serviceId,
        service_id: serviceId,
        agent: agentId,
        trigger: "timer",
        triggerContext,
        scheduleId: schedule.scheduleId,
        scheduleExpr: schedule.scheduleExpr,
        firedAt
      }
    });
    this.emitEvent({
      kind: "agent.run_started",
      serviceId,
      level: "info",
      message: `Timer run started: ${runId}`,
      data: {
        runId,
        run_id: runId,
        serviceId,
        service_id: serviceId,
        agent: agentId
      }
    });

    const defaultHandler = service.manifest.spec.origin.type === "local_wasm" ? "fn__on_timer" : "on_timer";
    const handlerTool = schedule.handlerTool ?? defaultHandler;
    const hasHandler = (service.interfaceSnapshot?.tools ?? []).some((tool) => tool.name === handlerTool);
    if (!hasHandler && !schedule.handlerTool) {
      this.emitEvent({
        kind: "agent.run_completed",
        serviceId,
        level: "info",
        message: `Timer run completed (no handler): ${runId}`,
        data: {
          runId,
          run_id: runId,
          serviceId,
          service_id: serviceId,
          agent: agentId,
          trigger: "timer",
          triggerContext
        }
      });
      return;
    }

    const stepId = `timer_step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.emitEvent({
      kind: "agent.step_started",
      serviceId,
      level: "info",
      message: `Timer step started: ${handlerTool}`,
      data: {
        runId,
        run_id: runId,
        serviceId,
        service_id: serviceId,
        agent: agentId,
        stepId,
        step_id: stepId,
        trigger: "timer",
        triggerContext,
        handlerTool
      }
    });

    try {
      await this.callTool(
        serviceId,
        handlerTool,
        this.buildTimerToolArgs({
          service,
          runId,
          scheduleId: schedule.scheduleId,
          scheduleExpr: schedule.scheduleExpr,
          firedAt,
          agent: agentId
        }),
        {
          runId,
          sessionId: runId
        }
      );
      this.emitEvent({
        kind: "agent.step_completed",
        serviceId,
        level: "info",
        message: `Timer step completed: ${handlerTool}`,
        data: {
          runId,
          run_id: runId,
          serviceId,
          service_id: serviceId,
          agent: agentId,
          stepId,
          step_id: stepId
        }
      });
      this.emitEvent({
        kind: "agent.run_completed",
        serviceId,
        level: "info",
        message: `Timer run completed: ${runId}`,
        data: {
          runId,
          run_id: runId,
          serviceId,
          service_id: serviceId,
          agent: agentId,
          trigger: "timer",
          triggerContext
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent({
        kind: "agent.run_failed",
        serviceId,
        level: "error",
        message: `Timer run failed: ${runId}`,
        data: {
          runId,
          run_id: runId,
          serviceId,
          service_id: serviceId,
          agent: agentId,
          trigger: "timer",
          triggerContext,
          error: message
        }
      });
    }
  }

  private buildTimerToolArgs(input: {
    service: ServiceRecord;
    runId: string;
    scheduleId: string;
    scheduleExpr: string;
    firedAt: string;
    agent: string;
  }): unknown {
    const triggerContext = {
      scheduleId: input.scheduleId,
      scheduleExpr: input.scheduleExpr,
      firedAt: input.firedAt
    };
    if (input.service.manifest.spec.origin.type === "local_wasm") {
      const legacyPayload = {
        runId: input.runId,
        agent: input.agent,
        trigger: "timer",
        triggerContext
      };
      const structuredPayload = {
        runId: input.runId,
        agent: input.agent,
        trigger: "timer",
        scheduleId: input.scheduleId,
        scheduleExpr: input.scheduleExpr,
        firedAt: input.firedAt
      };
      return {
        args: [
          input.runId,
          input.scheduleId,
          input.scheduleExpr,
          input.firedAt,
          JSON.stringify(legacyPayload),
          structuredPayload
        ],
        argTypes: [
          WASM_STRING_TYPE,
          WASM_STRING_TYPE,
          WASM_STRING_TYPE,
          WASM_STRING_TYPE,
          WASM_STRING_TYPE,
          TIMER_STRUCTURED_CONTEXT_MARSHAL_TYPE
        ],
        allowStringArgs: true,
        expectStringResult: true
      };
    }
    return {
      runId: input.runId,
      agent: input.agent,
      trigger: "timer",
      triggerContext,
      scheduleId: input.scheduleId,
      scheduleExpr: input.scheduleExpr,
      firedAt: input.firedAt
    };
  }

  private withLiveRuntime(record: ServiceRecord): ServiceRecord {
    const serviceId = record.manifest.metadata.serviceId!;
    if (record.runtime.lifecycle !== "RUNNING") {
      return record;
    }

    const started = this.starts.get(serviceId);
    if (!started) {
      return {
        ...record,
        runtime: {
          ...record.runtime,
          uptimeSeconds: 0
        }
      };
    }

    return {
      ...record,
      runtime: {
        ...record.runtime,
        uptimeSeconds: Math.max(0, Math.floor((Date.now() - started) / 1000))
      }
    };
  }

  private async ensureRemoteInitialized(serviceId: string, origin: RemoteMcpOrigin): Promise<void> {
    if (this.remoteInitialized.has(serviceId)) {
      return;
    }

    await this.remoteRequest(
      serviceId,
      origin,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "clarity-runtime",
          version: "0.1.0"
        }
      }
    );

    await this.remoteNotify(serviceId, origin.endpoint, "notifications/initialized", {});
    this.remoteInitialized.add(serviceId);
    this.appendLog(serviceId, "Remote MCP initialized");
  }

  private async remoteNotify(serviceId: string, endpoint: string, method: string, params: unknown): Promise<void> {
    try {
      const service = await this.registry.get(serviceId);
      const headers = await this.resolveRemoteHeaders(service?.manifest.spec.origin.type === "remote_mcp" ? service.manifest.spec.origin : undefined);
      const payload = {
        jsonrpc: "2.0",
        method,
        params
      };

      await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
    } catch (error) {
      this.appendLog(serviceId, `Notification failed (${method}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async remoteRequest(
    serviceId: string,
    origin: RemoteMcpOrigin | string,
    method: string,
    params: unknown,
    context?: ToolCallContext
  ): Promise<unknown> {
    const endpoint = typeof origin === "string" ? origin : origin.endpoint;
    const timeoutMs =
      typeof origin === "string"
        ? Number(process.env.CLARITY_REMOTE_DEFAULT_TIMEOUT_MS ?? "20000")
        : (origin.timeoutMs ?? Number(process.env.CLARITY_REMOTE_DEFAULT_TIMEOUT_MS ?? "20000"));
    const maxPayloadBytes =
      typeof origin === "string"
        ? (parsePositiveInteger(process.env.CLARITY_REMOTE_MAX_PAYLOAD_BYTES) ?? 1_048_576)
        : (asPositiveInteger(origin.maxPayloadBytes) ?? parsePositiveInteger(process.env.CLARITY_REMOTE_MAX_PAYLOAD_BYTES) ?? 1_048_576);
    const maxConcurrency =
      typeof origin === "string"
        ? (parsePositiveInteger(process.env.CLARITY_REMOTE_MAX_CONCURRENCY) ?? 8)
        : (asPositiveInteger(origin.maxConcurrency) ?? parsePositiveInteger(process.env.CLARITY_REMOTE_MAX_CONCURRENCY) ?? 8);
    const retryMax = parsePositiveInteger(process.env.CLARITY_REMOTE_RETRY_MAX) ?? 0;
    const retryBackoffMs = parsePositiveInteger(process.env.CLARITY_REMOTE_RETRY_BACKOFF_MS) ?? 150;
    const requestId = `${serviceId}-${this.remoteRequestCounter++}`;
    const headers = await this.resolveRemoteHeaders(typeof origin === "string" ? undefined : origin);
    const inFlight = this.remoteInFlight.get(serviceId) ?? 0;
    if (inFlight >= maxConcurrency) {
      throw new Error(`remote concurrency limit reached (${inFlight}/${maxConcurrency})`);
    }
    this.remoteInFlight.set(serviceId, inFlight + 1);

    const requestBody = JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method,
      params
    });
    const requestBytes = byteLength(requestBody);
    if (requestBytes > maxPayloadBytes) {
      this.remoteInFlight.set(serviceId, inFlight);
      throw new Error(`remote request payload too large (${requestBytes} > ${maxPayloadBytes} bytes)`);
    }

    if (context) {
      context.requestBytes = requestBytes;
    }

    const attemptHeaders = {
      ...headers,
      ...(context?.sessionId ? { "x-clarity-session-id": context.sessionId } : {}),
      ...(context?.traceId ? { "x-clarity-trace-id": context.traceId } : {}),
      ...(context?.runId ? { "x-clarity-run-id": context.runId } : {}),
      ...(context?.spanId ? { "x-clarity-span-id": context.spanId } : {})
    };

    let attempt = 0;
    let finalError: unknown = null;
    try {
      while (attempt <= retryMax) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20_000);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: attemptHeaders,
            body: requestBody,
            signal: controller.signal
          });

          const contentLength = Number(response.headers.get("content-length") ?? "");
          if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
            throw new Error(`remote response payload too large (${contentLength} > ${maxPayloadBytes} bytes)`);
          }

          const raw = await response.text();
          const responseBytes = byteLength(raw);
          if (responseBytes > maxPayloadBytes) {
            throw new Error(`remote response payload too large (${responseBytes} > ${maxPayloadBytes} bytes)`);
          }
          if (!response.ok) {
            throw new Error(`remote ${response.status}: ${raw.slice(0, 200)}`);
          }

          const parsed = raw ? JSON.parse(raw) : {};
          const obj = asObject(parsed);
          if (obj.error) {
            const err = asObject(obj.error);
            const message = typeof err.message === "string" ? err.message : "remote RPC error";
            throw new Error(message);
          }
          if (context) {
            context.responseBytes = responseBytes;
            context.retries = attempt;
          }
          if (!("result" in obj)) {
            return {};
          }

          return obj.result;
        } catch (error) {
          finalError = error;
          const message = error instanceof Error ? error.message : String(error);
          const retryable = attempt < retryMax && this.isRetryableRemoteError(message);
          if (!retryable) {
            break;
          }
          attempt += 1;
          await new Promise<void>((resolve) => setTimeout(resolve, retryBackoffMs * attempt));
          continue;
        } finally {
          clearTimeout(timeout);
        }
      }

      const message = finalError instanceof Error ? finalError.message : String(finalError);
      await this.registry.update(serviceId, (current) => ({
        ...current,
        runtime: {
          ...current.runtime,
          health: "DEGRADED",
          lastError: message
        }
      }));
      this.appendLog(serviceId, `Remote request failed (${method}): ${message}`);
      this.emitEvent({
        kind: "service.remote_error",
        serviceId,
        level: "error",
        message: `Remote request failed: ${method}`,
        data: {
          error: message,
          retries: attempt
        }
      });
      if (context) {
        context.retries = attempt;
      }
      throw (finalError ?? new Error("remote request failed"));
    } finally {
      const current = this.remoteInFlight.get(serviceId) ?? 1;
      if (current <= 1) {
        this.remoteInFlight.delete(serviceId);
      } else {
        this.remoteInFlight.set(serviceId, current - 1);
      }
    }
  }

  private isRetryableRemoteError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("abort")
      || normalized.includes("timed out")
      || normalized.includes("fetch failed")
      || normalized.includes("econn")
      || normalized.includes("enotfound")
      || /^remote 5\d\d:/.test(normalized)
    );
  }

  private enforceRemoteHostPolicy(origin: RemoteMcpOrigin): void {
    const allowedHosts = parseAllowedHosts(process.env.CLARITY_REMOTE_ALLOWED_HOSTS);
    if (!allowedHosts) {
      return;
    }

    const url = new URL(origin.endpoint);
    if (!allowedHosts.has(url.hostname.toLowerCase())) {
      throw new Error(`remote endpoint host '${url.hostname}' is not in CLARITY_REMOTE_ALLOWED_HOSTS`);
    }
  }

  private async resolveRemoteHeaders(origin: RemoteMcpOrigin | undefined): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };

    if (!origin?.authRef) {
      return headers;
    }

    const authHeaders = await resolveRemoteAuthHeaders(origin.authRef, {
      env: process.env,
      cwd: process.cwd()
    });
    return { ...headers, ...authHeaders };
  }

  private async discoverLocalFunctions(wasmPath: string): Promise<string[]> {
    try {
      const module = await this.loadLocalModule(wasmPath);
      const exports = WebAssembly.Module.exports(module);
      return exports
        .filter((item) => item.kind === "function")
        .map((item) => item.name)
        .filter((name) => !name.startsWith("__"))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  private async assertLocalWasmImportSupport(service: ServiceRecord): Promise<void> {
    if (service.manifest.spec.origin.type !== "local_wasm") {
      return;
    }
    const module = await this.loadLocalModule(service.manifest.spec.origin.wasmPath);
    const unsupported = WebAssembly.Module.imports(module)
      .filter((item) => item.module === "env" && LOCAL_WASM_UNSUPPORTED_IMPORTS.has(item.name))
      .map((item) => `env.${item.name}`);
    if (unsupported.length === 0) {
      return;
    }
    throw new Error(
      `local_wasm unsupported host imports: ${unsupported.join(", ")}. `
      + "Use remote_mcp execution for std/a2a or std/mcp, or remove these imports."
    );
  }

  private async resolveLocalExecutionEnv(
    service: ServiceRecord,
    overrides?: Record<string, string>
  ): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (service.manifest.spec.origin.type !== "local_wasm") {
      return {
        ...env,
        ...(overrides ?? {})
      };
    }
    const originEnv = Array.isArray(service.manifest.spec.origin.env) ? service.manifest.spec.origin.env : [];
    for (const entry of originEnv) {
      const name = asNonEmptyString(entry.name);
      if (!name) {
        continue;
      }
      if (asNonEmptyString(entry.secretRef)) {
        const secretRef = asNonEmptyString(entry.secretRef)!;
        try {
          const value = await resolveRemoteAuthSecret(secretRef, {
            env: process.env,
            cwd: process.cwd()
          });
          env[name] = value;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`failed to resolve local_wasm env '${name}' from secretRef '${secretRef}': ${message}`, {
            cause: error
          });
        }
        continue;
      }
      env[name] = entry.value ?? "";
    }
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        env[key] = value;
      }
    }
    return env;
  }

  private async runLocalFunction(
    service: ServiceRecord,
    functionName: string,
    argsList: unknown[],
    options?: {
      expectStringResult?: boolean;
      allowStringArgs?: boolean;
      argTypes?: Array<WasmMarshalType | undefined>;
      resultType?: WasmMarshalType;
      envOverrides?: Record<string, string>;
    }
  ): Promise<string> {
    if (service.manifest.spec.origin.type !== "local_wasm") {
      throw new Error("local function execution requires local_wasm origin");
    }

    const wasmPath = service.manifest.spec.origin.wasmPath;
    const timeoutMs = parsePositiveInteger(process.env.CLARITY_LOCAL_FN_TIMEOUT_MS) ?? 2_000;
    const hasTypedArgs = Array.isArray(options?.argTypes) && options.argTypes.some((item) => item !== undefined);
    const args = hasTypedArgs ? [argsList] : this.resolveWasmArgs(argsList, options?.allowStringArgs === true);
    const localEnv = await this.resolveLocalExecutionEnv(service, options?.envOverrides);
    let lastTypeError: Error | null = null;

    for (const candidate of args) {
      const workerResult = await this.runLocalFunctionInWorker(
        wasmPath,
        functionName,
        candidate,
        timeoutMs,
        options?.expectStringResult === true,
        hasTypedArgs ? options?.argTypes : undefined,
        options?.resultType,
        localEnv
      );
      if (workerResult.ok) {
        return this.formatWorkerResult(workerResult.value);
      }

      if (workerResult.errorType === "TypeError") {
        lastTypeError = new Error(workerResult.message);
        continue;
      }

      if (workerResult.errorType === "MissingFunction") {
        throw new Error(`exported function not found: ${functionName}`);
      }

      throw new Error(workerResult.message);
    }

    if (lastTypeError) {
      throw new Error(`failed to coerce function arguments for '${functionName}': ${lastTypeError.message}`);
    }

    throw new Error(`local function call failed for '${functionName}'`);
  }

  private async runLocalFunctionInWorker(
    wasmPath: string,
    functionName: string,
    args: unknown[],
    timeoutMs: number,
    expectStringResult: boolean,
    argTypes: Array<WasmMarshalType | undefined> | undefined,
    resultType: WasmMarshalType | undefined,
    workerEnv: NodeJS.ProcessEnv
  ): Promise<WorkerResponse> {
    const workerUrl = new URL("./local-wasm-worker.js", import.meta.url);

    return new Promise<WorkerResponse>((resolve, reject) => {
      const worker = new Worker(workerUrl, {
        env: workerEnv,
        workerData: {
          wasmPath,
          functionName,
          args,
          expectStringResult,
          argTypes,
          resultType
        }
      });

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker.terminate().catch(() => {});
        resolve({
          ok: false,
          errorType: "RuntimeError",
          message: `local function execution timed out after ${timeoutMs}ms`
        });
      }, timeoutMs);

      const finish = (handler: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        handler();
      };

      worker.once("message", (message: WorkerResponse) => {
        finish(() => {
          resolve(message);
        });
      });

      worker.once("error", (error) => {
        finish(() => {
          reject(error);
        });
      });

      worker.once("exit", (code) => {
        if (settled) return;
        finish(() => {
          reject(new Error(`worker exited before reply (code=${code})`));
        });
      });
    });
  }

  private async loadLocalModule(wasmPath: string): Promise<WebAssembly.Module> {
    const cached = this.localModuleCache.get(wasmPath);
    if (cached) {
      return cached;
    }

    const bytes = await readFile(wasmPath);
    const module = await WebAssembly.compile(bytes);
    this.localModuleCache.set(wasmPath, module);
    return module;
  }

  private resolveWasmArgs(args: unknown[], allowStringArgs = false): Array<Array<number | bigint | string>> {
    const perArg: Array<Array<number | bigint | string>> = args.map((arg) => {
      if (typeof arg === "bigint") {
        const asNumber = Number(arg);
        return Number.isSafeInteger(asNumber) ? [arg, asNumber] : [arg];
      }

      if (typeof arg === "number") {
        if (Number.isInteger(arg)) {
          return [BigInt(arg), arg];
        }
        return [arg];
      }

      if (typeof arg === "boolean") {
        return [arg ? 1 : 0];
      }

      if (typeof arg === "string") {
        if (allowStringArgs) {
          const out: Array<number | bigint | string> = [arg];
          if (/^-?\d+$/.test(arg)) {
            const asNumber = Number(arg);
            out.push(BigInt(arg));
            if (Number.isSafeInteger(asNumber)) {
              out.push(asNumber);
            }
            return out;
          }
          if (/^-?\d+\.\d+$/.test(arg)) {
            out.push(Number(arg));
            return out;
          }
          return out;
        }
        if (/^-?\d+$/.test(arg)) {
          const asNumber = Number(arg);
          return Number.isSafeInteger(asNumber) ? [BigInt(arg), asNumber] : [BigInt(arg)];
        }
        if (/^-?\d+\.\d+$/.test(arg)) {
          return [Number(arg)];
        }
        throw new Error(`unsupported string argument '${arg}' for in-process wasm call`);
      }

      throw new Error(`unsupported argument type '${typeof arg}' for in-process wasm call`);
    });

    if (perArg.length === 0) {
      return [[]];
    }

    const combinations: Array<Array<number | bigint | string>> = [];
    const current: Array<number | bigint | string> = [];

    const walk = (index: number): void => {
      if (index === perArg.length) {
        combinations.push([...current]);
        return;
      }
      for (const option of perArg[index]) {
        current.push(option);
        walk(index + 1);
        current.pop();
      }
    };

    walk(0);
    return combinations;
  }

  private formatWorkerResult(value: WorkerValue): string {
    if (value.kind === "undefined") {
      return "(no output)";
    }
    if (value.kind === "bigint") {
      return String(value.value ?? "0");
    }
    if (value.kind === "number" || value.kind === "boolean") {
      return String(value.value);
    }
    if (value.kind === "string") {
      return String(value.value ?? "");
    }
    return "(unsupported output)";
  }

  private appendLog(serviceId: string, line: string): void {
    const current = this.logs.get(serviceId) ?? [];
    current.push(`[${nowIso()}] ${line}`);
    if (current.length > 2000) {
      current.shift();
    }
    this.logs.set(serviceId, current);
    void this.persistTelemetry();
  }

  private emitEvent(input: {
    kind: string;
    serviceId?: string;
    level: "info" | "warn" | "error";
    message: string;
    data?: unknown;
  }): void {
    const allowLifecycle = this.lifecycleAuditEnabled && input.kind.startsWith("service.");
    const allowAgent = input.kind.startsWith("agent.");
    if (!AUDIT_EVENT_ALLOWLIST.has(input.kind) && !allowLifecycle && !allowAgent) {
      return;
    }
    const event: AuditEvent = {
      seq: this.eventSeq++,
      at: nowIso(),
      kind: input.kind,
      serviceId: input.serviceId,
      level: input.level,
      message: input.message,
      data: input.data
    };
    this.events.push(event);
    if (this.events.length > 2000) {
      this.events.shift();
    }
    void this.persistTelemetry();
    for (const subscriber of this.eventSubscribers) {
      try {
        subscriber(event);
      } catch {
        // Swallow subscriber errors.
      }
    }
  }

  private async resolveRuntimeInputServiceId(
    explicitServiceId: string | undefined,
    preferredAgent: string | undefined
  ): Promise<string | undefined> {
    const directServiceId = asNonEmptyString(explicitServiceId);
    if (directServiceId) {
      return directServiceId;
    }

    const preferred = asNonEmptyString(preferredAgent)?.toLowerCase();
    if (!preferred) {
      return undefined;
    }

    const records = await this.registry.list();
    const matches = records.filter((record) => {
      const meta = asObject(record.manifest.metadata.agent);
      const agentId = asNonEmptyString(meta.agentId)?.toLowerCase();
      const agentName = asNonEmptyString(meta.name)?.toLowerCase();
      const moduleName = asNonEmptyString(record.manifest.metadata.module)?.toLowerCase();
      return agentId === preferred || agentName === preferred || moduleName === preferred;
    });

    if (matches.length === 0) {
      return undefined;
    }

    const running = matches.find((record) => record.runtime.lifecycle === "RUNNING");
    return running?.manifest.metadata.serviceId ?? matches[0].manifest.metadata.serviceId;
  }

  private async processRuntimeHitlInput(
    input: {
      runId: string;
      message: string;
      serviceId?: string;
      agent?: string;
    },
    options: {
      allowDisabledMode: boolean;
    }
  ): Promise<void> {
    await this.init();
    const runId = input.runId.trim();
    const operatorMessage = input.message.trim();
    if (!runId || !operatorMessage) {
      return;
    }

    const runSummary = this.getAgentRuns(2000).find((row) => row.runId === runId);
    const requestedAgent = asNonEmptyString(input.agent) ?? asNonEmptyString(runSummary?.agent);
    const serviceId = await this.resolveRuntimeInputServiceId(
      asNonEmptyString(input.serviceId) ?? runSummary?.serviceId,
      requestedAgent
    );
    const service = serviceId ? await this.registry.get(serviceId) : undefined;
    const agentMetadata = asObject(service?.manifest.metadata.agent);
    const agent =
      requestedAgent
      ?? asNonEmptyString(agentMetadata.agentId)
      ?? asNonEmptyString(agentMetadata.name)
      ?? "unknown-agent";
    const stepId = `runtime_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let runtimeChat = this.resolveRuntimeHitlConfig(service);
    const history = runtimeChat.historyEnabled
      ? this.buildRuntimeChatHistory(runId, runtimeChat.historyMaxTurns, runtimeChat.historyMaxChars)
      : {
          messages: [],
          totalMessages: 0,
          truncated: false,
          maxTurns: runtimeChat.historyMaxTurns,
          maxChars: runtimeChat.historyMaxChars
        };
    const contextEnvelope = this.buildRuntimeChatContextEnvelopeV1({
      runId,
      sessionId: asNonEmptyString(asObject(runSummary?.triggerContext).sessionId ?? asObject(runSummary?.triggerContext).session_id) ?? runId,
      serviceId: serviceId ?? "",
      agent,
      operatorMessage,
      runSummary,
      agentMetadata,
      history,
      runtimeChat
    });

    if (runtimeChat.mode === "disabled") {
      if (options.allowDisabledMode) {
        runtimeChat = {
          ...runtimeChat,
          mode: "auto",
          strategy: "agent_tool"
        };
      } else {
        this.emitEvent({
          kind: "agent.waiting",
          serviceId,
          level: "warn",
          message: `Runtime chat disabled for agent (${runId})`,
          data: {
            runId,
            ...(serviceId ? { serviceId } : {}),
            agent,
            reason: "runtime chat disabled by agent configuration",
            waitingReason: "runtime chat disabled by agent configuration",
            source: "runtime_hitl_executor"
          }
        });
        return;
      }
    }

    this.emitEvent({
      kind: "agent.step_started",
      serviceId,
      level: "info",
      message: `Runtime chat processing started (${runId})`,
      data: {
        runId,
        ...(serviceId ? { serviceId } : {}),
        agent,
        stepId,
        mode: runtimeChat.mode,
        strategy: runtimeChat.strategy,
        handlerTool: runtimeChat.handlerTool,
        source: "runtime_hitl_executor",
        inputLength: operatorMessage.length,
        historyEnabled: runtimeChat.historyEnabled,
        historyMessages: history.messages.length,
        historyTruncated: history.truncated
      }
    });

    try {
      const provider = runtimeChat.strategy === "agent_tool" ? "agent" : "echo";
      let reply = "";
      let usedHistory = false;
      if (runtimeChat.strategy === "agent_tool") {
        if (!serviceId) {
          throw new Error("runtime chat dispatch requires serviceId on run or request");
        }
        const triggerContext = asObject(runSummary?.triggerContext);
        const sessionId = asNonEmptyString(triggerContext.sessionId ?? triggerContext.session_id) ?? runId;
        this.emitEvent({
          kind: "agent.tool_called",
          serviceId,
          level: "info",
          message: `Runtime chat dispatched to agent tool (${runtimeChat.handlerTool})`,
          data: {
            runId,
            serviceId,
            agent,
            stepId,
            tool: runtimeChat.handlerTool,
            sessionId,
            historyEnabled: runtimeChat.historyEnabled,
            historyMessages: history.messages.length
          }
        });
        const toolDispatch = await this.callRuntimeChatTool(
          serviceId,
          runtimeChat,
          operatorMessage,
          sessionId,
          runId,
          history,
          agent,
          contextEnvelope
        );
        usedHistory = toolDispatch.usedHistory;
        const toolResult = toolDispatch.result;
        const candidateReply = this.extractRuntimeChatReply(toolResult);
        if (!candidateReply) {
          throw new Error(`agent chat tool returned no reply text: ${runtimeChat.handlerTool}`);
        }
        reply = candidateReply;
      } else {
        reply = `Echo: ${operatorMessage}`;
      }

      this.emitEvent({
        kind: "agent.chat.assistant_message",
        serviceId,
        level: "info",
        message: `Assistant message emitted (${runId})`,
        data: {
          runId,
          ...(serviceId ? { serviceId } : {}),
          agent,
          role: "assistant",
          message: reply,
          provider,
          ...(runtimeChat.strategy === "agent_tool" ? { handlerTool: runtimeChat.handlerTool } : {}),
          ...(runtimeChat.strategy === "agent_tool" ? { historyUsed: usedHistory } : {}),
          source: "runtime_hitl_executor"
        }
      });

      this.emitEvent({
        kind: "agent.step_completed",
        serviceId,
        level: "info",
        message: `Runtime chat response ready (${runId})`,
        data: {
          runId,
          ...(serviceId ? { serviceId } : {}),
          agent,
          stepId,
          provider,
          ...(runtimeChat.strategy === "agent_tool" ? { handlerTool: runtimeChat.handlerTool } : {}),
          ...(runtimeChat.strategy === "agent_tool" ? { historyUsed: usedHistory } : {}),
          message: reply
        }
      });

      this.emitEvent({
        kind: "agent.waiting",
        serviceId,
        level: "info",
        message: `Awaiting next operator input (${runId})`,
        data: {
          runId,
          ...(serviceId ? { serviceId } : {}),
          agent,
          reason: "awaiting operator input",
          waitingReason: "awaiting operator input",
          source: "runtime_hitl_executor"
        }
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.emitEvent({
        kind: "agent.step_completed",
        serviceId,
        level: "error",
        message: `Runtime chat response failed (${runId})`,
        data: {
          runId,
          ...(serviceId ? { serviceId } : {}),
          agent,
          stepId,
          error: reason
        }
      });
      this.emitEvent({
        kind: "agent.waiting",
        serviceId,
        level: "warn",
        message: `Awaiting operator input after response error (${runId})`,
        data: {
          runId,
          ...(serviceId ? { serviceId } : {}),
          agent,
          reason,
          waitingReason: reason,
          source: "runtime_hitl_executor"
        }
      });
    }
  }

  private resolveRuntimeHitlConfig(service?: ServiceRecord): ResolvedRuntimeChatConfig {
    const agent = asObject(service?.manifest.metadata.agent);
    const chat = asObject(agent.chat);
    const modeRaw = asNonEmptyString(chat.mode)?.toLowerCase();
    const mode = (modeRaw === "echo" || modeRaw === "disabled" || modeRaw === "auto")
      ? modeRaw
      : this.hitlChatMode;
    const defaultTool = service?.manifest.spec.origin.type === "remote_mcp" ? "receive_chat" : "fn__receive_chat";
    const handlerTool = asNonEmptyString(chat.handlerTool ?? chat.handler_tool) ?? defaultTool;
    const strategy = mode === "echo" ? "echo" : "agent_tool";
    const historyEnabledRaw = chat.historyEnabled ?? chat.history_enabled;
    const historyEnabled = typeof historyEnabledRaw === "boolean" ? historyEnabledRaw : true;
    const historyMaxTurnsRaw = asPositiveInteger(chat.historyMaxTurns ?? chat.history_max_turns) ?? 24;
    const historyMaxCharsRaw = asPositiveInteger(chat.historyMaxChars ?? chat.history_max_chars) ?? 12000;
    const historyMaxTurns = Math.max(1, Math.min(200, historyMaxTurnsRaw));
    const historyMaxChars = Math.max(256, Math.min(200000, historyMaxCharsRaw));
    return {
      mode,
      strategy,
      handlerTool,
      historyEnabled,
      historyMaxTurns,
      historyMaxChars
    };
  }

  private buildRuntimeChatHistory(
    runId: string,
    maxTurns: number,
    maxChars: number
  ): RuntimeChatHistorySnapshot {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return {
        messages: [],
        totalMessages: 0,
        truncated: false,
        maxTurns,
        maxChars
      };
    }
    const all: RuntimeChatMessage[] = [];
    for (const event of this.events) {
      if (
        event.kind !== "agent.chat.user_message"
        && event.kind !== "agent.chat.assistant_message"
        && event.kind !== "agent.chat.system_message"
      ) {
        continue;
      }
      const payload = asObject(event.data);
      const eventRunId = String(payload.runId ?? payload.run_id ?? "").trim();
      if (eventRunId !== normalizedRunId) {
        continue;
      }
      const roleRaw = asNonEmptyString(payload.role)?.toLowerCase();
      const role: RuntimeChatMessage["role"] =
        roleRaw === "assistant" || roleRaw === "system" || roleRaw === "user"
          ? roleRaw
          : (
              event.kind === "agent.chat.assistant_message"
                ? "assistant"
                : event.kind === "agent.chat.system_message"
                  ? "system"
                  : "user"
            );
      const content = asNonEmptyString(payload.message ?? payload.text);
      if (!content) {
        continue;
      }
      all.push({
        role,
        content
      });
    }

    const boundedByTurns = all.slice(Math.max(0, all.length - Math.max(1, maxTurns)));
    const boundedByChars: RuntimeChatMessage[] = [];
    let totalChars = 0;
    let truncated = boundedByTurns.length !== all.length;
    for (let index = boundedByTurns.length - 1; index >= 0; index -= 1) {
      const item = boundedByTurns[index];
      const itemChars = item.content.length;
      const nextChars = totalChars + itemChars;
      if (boundedByChars.length > 0 && nextChars > maxChars) {
        truncated = true;
        break;
      }
      if (boundedByChars.length === 0 && nextChars > maxChars) {
        const start = Math.max(0, itemChars - maxChars);
        boundedByChars.push({
          role: item.role,
          content: item.content.slice(start)
        });
        truncated = true;
        break;
      }
      boundedByChars.push(item);
      totalChars = nextChars;
    }
    boundedByChars.reverse();

    return {
      messages: boundedByChars,
      totalMessages: all.length,
      truncated,
      maxTurns,
      maxChars
    };
  }

  private extractRetrievalItemsFromTriggerContext(triggerContext: Record<string, unknown>): Array<Record<string, unknown>> {
    const candidates = [
      triggerContext.retrieval,
      triggerContext.rag,
      triggerContext.context,
      triggerContext.retrievalItems,
      triggerContext.retrievedDocuments
    ];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }
      const out = candidate
        .map((item) => {
          if (item && typeof item === "object") {
            return item as Record<string, unknown>;
          }
          if (typeof item === "string") {
            return { content: item };
          }
          return null;
        })
        .filter((item): item is Record<string, unknown> => item !== null);
      if (out.length > 0) {
        return out;
      }
    }
    return [];
  }

  private buildRuntimeChatContextEnvelopeV1(input: {
    runId: string;
    sessionId: string;
    serviceId: string;
    agent: string;
    operatorMessage: string;
    runSummary?: AgentRunSummary;
    agentMetadata: Record<string, unknown>;
    history: RuntimeChatHistorySnapshot;
    runtimeChat: ResolvedRuntimeChatConfig;
  }): RuntimeChatContextEnvelopeV1 {
    const triggerContext = asObject(input.runSummary?.triggerContext);
    const retrievalItems = this.extractRetrievalItemsFromTriggerContext(triggerContext);
    const historyCharsUsed = input.history.messages.reduce((sum, row) => sum + row.content.length, 0);
    return {
      version: "context.v1",
      task: {
        runId: input.runId,
        sessionId: input.sessionId,
        serviceId: input.serviceId,
        agent: input.agent,
        objective: asNonEmptyString(input.agentMetadata.objective),
        role: asNonEmptyString(input.agentMetadata.role)
      },
      instructions: {
        allowedMcpTools: asStringArray(input.agentMetadata.allowedMcpTools ?? input.agentMetadata.allowed_mcp_tools),
        allowedLlmProviders: asStringArray(input.agentMetadata.allowedLlmProviders ?? input.agentMetadata.allowed_llm_providers)
      },
      userContext: {
        latestMessage: input.operatorMessage,
        trigger: input.runSummary?.trigger ?? "unknown",
        triggerContext
      },
      retrieval: {
        items: retrievalItems,
        count: retrievalItems.length
      },
      conversation: {
        messages: input.history.messages,
        totalMessages: input.history.totalMessages,
        truncated: input.history.truncated
      },
      runtimeState: {
        status: input.runSummary?.status,
        waitingReason: input.runSummary?.waitingReason,
        eventCount: input.runSummary?.eventCount,
        lastEventKind: input.runSummary?.lastEventKind
      },
      policy: {
        mode: input.runtimeChat.mode,
        strategy: input.runtimeChat.strategy,
        handlerTool: input.runtimeChat.handlerTool,
        historyEnabled: input.runtimeChat.historyEnabled,
        historyMaxTurns: input.runtimeChat.historyMaxTurns,
        historyMaxChars: input.runtimeChat.historyMaxChars
      },
      budget: {
        historyCharsUsed,
        historyCharsMax: input.runtimeChat.historyMaxChars,
        historyCharsRemaining: Math.max(0, input.runtimeChat.historyMaxChars - historyCharsUsed)
      },
      provenance: {
        generatedAt: nowIso(),
        source: "runtime_hitl_executor"
      }
    };
  }

  private async resolveRuntimeChatEnvOverrides(serviceId: string): Promise<Record<string, string> | undefined> {
    const service = await this.registry.get(serviceId);
    if (!service || service.manifest.spec.origin.type !== "local_wasm") {
      return undefined;
    }
    const chat = asObject(asObject(service.manifest.metadata.agent).chat);
    const apiKeyEnv = asNonEmptyString(chat.apiKeyEnv ?? chat.api_key_env);
    if (!apiKeyEnv) {
      return undefined;
    }
    return {
      CLARITY_RUNTIME_CHAT_API_KEY_ENV: apiKeyEnv
    };
  }

  private async callRuntimeChatTool(
    serviceId: string,
    runtimeChat: ResolvedRuntimeChatConfig,
    message: string,
    sessionId: string,
    runId: string,
    history: RuntimeChatHistorySnapshot,
    agent: string,
    contextEnvelope: RuntimeChatContextEnvelopeV1
  ): Promise<{ result: unknown; usedHistory: boolean }> {
    const usedHistory = runtimeChat.historyEnabled;
    const localEnvOverrides = await this.resolveRuntimeChatEnvOverrides(serviceId);
    const result = await this.callTool(
      serviceId,
      runtimeChat.handlerTool,
      this.buildRuntimeChatToolArgs({
        handlerTool: runtimeChat.handlerTool,
        message,
        sessionId,
        runId,
        history,
        serviceId,
        agent,
        contextEnvelope
      }),
      {
        runId,
        sessionId,
        ...(localEnvOverrides ? { localEnvOverrides } : {})
      }
    );
    return {
      result,
      usedHistory
    };
  }

  private buildRuntimeChatToolArgs(
    options: {
      handlerTool: string;
      message: string;
      sessionId: string;
      runId: string;
      history: RuntimeChatHistorySnapshot;
      serviceId: string;
      agent: string;
      contextEnvelope: RuntimeChatContextEnvelopeV1;
    }
  ): unknown {
    const {
      handlerTool,
      message,
      sessionId,
      runId,
      history,
      serviceId,
      agent,
      contextEnvelope
    } = options;
    if (handlerTool.startsWith("fn__")) {
      const legacyPayload = {
        runId,
        sessionId,
        serviceId,
        agent,
        messages: history.messages,
        history: {
          totalMessages: history.totalMessages,
          usedMessages: history.messages.length,
          truncated: history.truncated,
          maxTurns: history.maxTurns,
          maxChars: history.maxChars
        },
        contextVersion: contextEnvelope.version,
        context: contextEnvelope
      };
      const structuredPayload = {
        runId,
        sessionId,
        serviceId,
        agent,
        contextVersion: contextEnvelope.version,
        latestMessage: message,
        trigger: contextEnvelope.userContext.trigger,
        messages: history.messages,
        history: {
          totalMessages: history.totalMessages,
          usedMessages: history.messages.length,
          truncated: history.truncated,
          maxTurns: history.maxTurns,
          maxChars: history.maxChars
        },
        contextJson: JSON.stringify(contextEnvelope)
      };
      const args = [
        message,
        sessionId,
        runId,
        JSON.stringify(legacyPayload),
        structuredPayload
      ];
      return {
        args,
        argTypes: [
          WASM_STRING_TYPE,
          WASM_STRING_TYPE,
          WASM_STRING_TYPE,
          WASM_STRING_TYPE,
          RUNTIME_CHAT_STRUCTURED_CONTEXT_MARSHAL_TYPE
        ],
        expectStringResult: true,
        allowStringArgs: true
      };
    }
    return {
      message,
      sessionId,
      runId,
      messages: history.messages,
      history: {
        totalMessages: history.totalMessages,
        usedMessages: history.messages.length,
        truncated: history.truncated,
        maxTurns: history.maxTurns,
        maxChars: history.maxChars
      },
      contextVersion: contextEnvelope.version,
      context: contextEnvelope
    };
  }

  private extractRuntimeChatReply(result: unknown): string | undefined {
    const root = asObject(result);
    const direct = asNonEmptyString(root.reply ?? root.message ?? root.text ?? root.output_text);
    if (direct) {
      return direct;
    }
    const content = Array.isArray(root.content) ? (root.content as unknown[]) : [];
    for (const item of content) {
      const text = asNonEmptyString(asObject(item).text);
      if (text) {
        return text;
      }
    }
    return undefined;
  }

  private async loadTelemetry(): Promise<void> {
    await mkdir(path.dirname(this.telemetryPath), { recursive: true });
    try {
      const raw = await readFile(this.telemetryPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TelemetryFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.events) || !parsed.logs || typeof parsed.logs !== "object") {
        throw new Error("telemetry shape validation failed");
      }

      this.events.splice(0, this.events.length, ...parsed.events);
      this.logs.clear();
      for (const [serviceId, lines] of Object.entries(parsed.logs)) {
        if (Array.isArray(lines)) {
          this.logs.set(serviceId, lines.map((line) => String(line)));
        }
      }
      const lastSeq = this.events.length > 0 ? this.events[this.events.length - 1].seq : 0;
      this.eventSeq = Math.max(1, lastSeq + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/ENOENT/.test(message)) {
        process.stderr.write(`telemetry reset after parse failure: ${message}\n`);
      }
      await this.writeTelemetry();
    }
  }

  private async persistTelemetry(): Promise<void> {
    this.telemetryWriteQueue = this.telemetryWriteQueue.then(async () => {
      await this.writeTelemetry();
    }).catch((error) => {
      process.stderr.write(`telemetry persist failed: ${error instanceof Error ? error.message : String(error)}\n`);
    });
    await this.telemetryWriteQueue;
  }

  private async writeTelemetry(): Promise<void> {
    const payload: TelemetryFile = {
      version: 1,
      updatedAt: nowIso(),
      events: this.events,
      logs: Object.fromEntries(this.logs.entries())
    };
    await mkdir(path.dirname(this.telemetryPath), { recursive: true });
    const tempPath = `${this.telemetryPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(tempPath, this.telemetryPath);
  }

  private recordToolCallOutcome(serviceId: string, ok: boolean): void {
    const windowSeconds = parsePositiveInteger(process.env.CLARITY_TOOL_CIRCUIT_WINDOW_SECONDS) ?? 60;
    const now = Date.now();
    const windowStart = now - Math.max(1, windowSeconds) * 1000;
    const history = (this.toolCallOutcomes.get(serviceId) ?? []).filter((item) => item.at >= windowStart);
    history.push({ at: now, ok });
    this.toolCallOutcomes.set(serviceId, history);
  }

  private async maybeQuarantineOnToolErrorRate(serviceId: string, reason: string): Promise<void> {
    const minCalls = parsePositiveInteger(process.env.CLARITY_TOOL_CIRCUIT_MIN_CALLS) ?? 8;
    const threshold = parseRatio(process.env.CLARITY_TOOL_CIRCUIT_ERROR_RATE) ?? 0.6;
    const history = this.toolCallOutcomes.get(serviceId) ?? [];
    if (history.length < minCalls) {
      return;
    }
    const failures = history.filter((item) => !item.ok).length;
    const failureRate = failures / history.length;
    if (failureRate < threshold) {
      return;
    }
    const current = await this.registry.get(serviceId);
    if (!current || current.runtime.lifecycle === "QUARANTINED") {
      return;
    }
    await this.registry.update(serviceId, (record) => ({
      ...record,
      runtime: {
        ...record.runtime,
        lifecycle: "QUARANTINED",
        health: "DEGRADED",
        lastError: `tool error-rate circuit breaker: ${reason}`,
        pid: undefined
      }
    }));
    this.starts.delete(serviceId);
    this.clearTimerSchedulesForService(serviceId);
    this.remoteInitialized.delete(serviceId);
    this.appendLog(
      serviceId,
      `Service quarantined by tool-call circuit breaker (error_rate=${failureRate.toFixed(2)}, failures=${failures}, calls=${history.length})`
    );
    this.emitEvent({
      kind: "service.quarantined",
      serviceId,
      level: "error",
      message: `Service quarantined: ${serviceId}`,
      data: {
        reason: "tool error-rate circuit breaker",
        failureRate,
        failures,
        calls: history.length
      }
    });
  }

  private async shouldQuarantine(service: ServiceRecord, failedStart: boolean): Promise<boolean> {
    const serviceId = service.manifest.metadata.serviceId!;
    if (!failedStart) {
      this.startFailures.delete(serviceId);
      this.toolCallOutcomes.delete(serviceId);
      return false;
    }

    const policy = service.manifest.spec.restartPolicy;
    if (policy.mode === "never" || policy.maxRestarts <= 0) {
      return false;
    }

    const now = Date.now();
    const windowStart = now - Math.max(1, policy.windowSeconds) * 1000;
    const history = (this.startFailures.get(serviceId) ?? []).filter((ts) => ts >= windowStart);
    history.push(now);
    this.startFailures.set(serviceId, history);
    return history.length >= policy.maxRestarts;
  }
}
