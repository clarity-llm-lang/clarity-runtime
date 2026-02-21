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
import { resolveRemoteAuthHeaders } from "../security/remote-auth.js";

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

function parseFunctionArgs(args: unknown): unknown[] {
  const payload = asObject(args);
  const raw = payload.args;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw;
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

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

const DEFAULT_TELEMETRY_PATH = path.resolve(process.cwd(), ".clarity/runtime/telemetry.json");

interface TelemetryFile {
  version: 1;
  updatedAt: string;
  events: AuditEvent[];
  logs: Record<string, string[]>;
}

const AUDIT_EVENT_ALLOWLIST = new Set([
  "mcp.tool_called"
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

export type AgentRunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export interface AgentRunSummary {
  runId: string;
  agent: string;
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

interface WorkerValue {
  kind: "undefined" | "string" | "number" | "boolean" | "bigint";
  value?: string | number | boolean;
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
  private readonly startFailures = new Map<string, number[]>();
  private readonly events: AuditEvent[] = [];
  private readonly eventSubscribers = new Set<(event: AuditEvent) => void>();
  private readonly lifecycleAuditEnabled: boolean;
  private telemetryWriteQueue: Promise<void> = Promise.resolve();
  private telemetryLoaded = false;
  private eventSeq = 1;
  private remoteRequestCounter = 1;
  private pidCounter = 49000;

  constructor(registry: ServiceRegistry, telemetryPath = DEFAULT_TELEMETRY_PATH) {
    this.registry = registry;
    this.telemetryPath = telemetryPath;
    this.lifecycleAuditEnabled = includeLifecycleAudit();
  }

  async init(): Promise<void> {
    if (this.telemetryLoaded) {
      return;
    }
    await this.loadTelemetry();
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
      this.emitEvent({
        kind: "service.quarantined",
        serviceId,
        level: "error",
        message: `Service quarantined: ${serviceId}`,
        data: { reason: lastError ?? "start failure threshold exceeded" }
      });
    } else if (startFailed) {
      this.starts.delete(serviceId);
      this.emitEvent({
        kind: "service.start_failed",
        serviceId,
        level: "error",
        message: `Service start failed: ${serviceId}`,
        data: { reason: lastError }
      });
    } else {
      this.starts.set(serviceId, Date.now());
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
    this.remoteInitialized.delete(serviceId);
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
    this.logs.delete(serviceId);
    this.remoteInitialized.delete(serviceId);
    this.remoteInFlight.delete(serviceId);
    this.startFailures.delete(serviceId);
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
                      { type: "boolean" }
                    ]
                  }
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

  async callTool(serviceId: string, toolName: string, args: unknown): Promise<unknown> {
    await this.init();
    const service = await this.registry.get(serviceId);
    if (!service) {
      throw new Error(`service not found: ${serviceId}`);
    }

    if (service.runtime.lifecycle !== "RUNNING") {
      throw new Error(`service is not running: ${serviceId}`);
    }

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
        }
      );
      this.appendLog(serviceId, `tools/call ${toolName}`);
      this.emitEvent({
        kind: "service.tool_called",
        serviceId,
        level: "info",
        message: `Remote tool called: ${toolName}`,
      });
      return result;
    }

    if (toolName === "health_check") {
      this.appendLog(serviceId, "tools/call health_check");
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
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
            )
          }
        ]
      };
    }

    if (toolName.startsWith("fn__")) {
      const functionName = toolName.slice("fn__".length);
      const argsList = parseFunctionArgs(args);
      const output = await this.runLocalFunction(service, functionName, argsList);
      this.appendLog(serviceId, `tools/call ${toolName}(${JSON.stringify(argsList)})`);
      this.emitEvent({
        kind: "service.tool_called",
        serviceId,
        level: "info",
        message: `Local function tool called: ${toolName}`
      });
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
      current.updatedAt = event.at;
      current.eventCount += 1;
      current.lastEventKind = event.kind;
      current.lastEventMessage = event.message;

      if (event.kind === "agent.run_created") {
        current.status = "queued";
      } else if (event.kind === "agent.run_started") {
        current.status = "running";
        current.startedAt ??= event.at;
      } else if (event.kind === "agent.waiting") {
        current.status = "waiting";
        const reason = String(payload.reason ?? payload.waitingReason ?? "").trim();
        if (reason) {
          current.waitingReason = reason;
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
        current.handoffCount += 1;
      } else if (event.kind === "agent.tool_called") {
        current.toolCallCount += 1;
      } else if (event.kind === "agent.llm_called") {
        current.llmCallCount += 1;
      } else if (event.kind === "agent.run_completed") {
        current.status = "completed";
        current.completedAt = event.at;
        current.currentStepId = undefined;
      } else if (event.kind === "agent.run_failed") {
        current.status = "failed";
        current.completedAt = event.at;
        current.currentStepId = undefined;
        const failure = String(payload.error ?? payload.reason ?? "").trim();
        current.failureReason = failure || event.message;
      } else if (event.kind === "agent.run_cancelled") {
        current.status = "cancelled";
        current.completedAt = event.at;
        current.currentStepId = undefined;
      }

      runs.set(runId, current);
    }

    return [...runs.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, limit))
      .map((run) => ({
        runId: run.runId,
        agent: run.agent,
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

  async shutdown(): Promise<void> {
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

  private async remoteRequest(serviceId: string, origin: RemoteMcpOrigin | string, method: string, params: unknown): Promise<unknown> {
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
    const requestId = `${serviceId}-${this.remoteRequestCounter++}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20_000);

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

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
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
      if (!("result" in obj)) {
        return {};
      }

      return obj.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
        data: { error: message }
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      const current = this.remoteInFlight.get(serviceId) ?? 1;
      if (current <= 1) {
        this.remoteInFlight.delete(serviceId);
      } else {
        this.remoteInFlight.set(serviceId, current - 1);
      }
    }
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

  private async runLocalFunction(
    service: ServiceRecord,
    functionName: string,
    argsList: unknown[]
  ): Promise<string> {
    if (service.manifest.spec.origin.type !== "local_wasm") {
      throw new Error("local function execution requires local_wasm origin");
    }

    const wasmPath = service.manifest.spec.origin.wasmPath;
    const timeoutMs = parsePositiveInteger(process.env.CLARITY_LOCAL_FN_TIMEOUT_MS) ?? 2_000;
    const args = this.resolveWasmArgs(argsList);
    let lastTypeError: Error | null = null;

    for (const candidate of args) {
      const workerResult = await this.runLocalFunctionInWorker(wasmPath, functionName, candidate, timeoutMs);
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
    args: Array<number | bigint>,
    timeoutMs: number
  ): Promise<WorkerResponse> {
    const workerUrl = new URL("./local-wasm-worker.js", import.meta.url);

    return new Promise<WorkerResponse>((resolve, reject) => {
      const worker = new Worker(workerUrl, {
        workerData: {
          wasmPath,
          functionName,
          args
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

  private resolveWasmArgs(args: unknown[]): Array<Array<number | bigint>> {
    const perArg: Array<Array<number | bigint>> = args.map((arg) => {
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

    const combinations: Array<Array<number | bigint>> = [];
    const current: Array<number | bigint> = [];

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

  private async shouldQuarantine(service: ServiceRecord, failedStart: boolean): Promise<boolean> {
    const serviceId = service.manifest.metadata.serviceId!;
    if (!failedStart) {
      this.startFailures.delete(serviceId);
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
