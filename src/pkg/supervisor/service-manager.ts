import { access, readFile } from "node:fs/promises";
import type {
  InterfaceSnapshot,
  MCPServiceManifest,
  RemoteMcpOrigin,
  ServiceRecord
} from "../../types/contracts.js";
import { deriveInterfaceRevision, deriveServiceId } from "../registry/ids.js";
import { ServiceRegistry } from "../registry/registry.js";

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

function envKeyForAuthRef(authRef: string): string {
  return `CLARITY_REMOTE_AUTH_${authRef.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
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

export interface AuditEvent {
  seq: number;
  at: string;
  kind: string;
  serviceId?: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

export class ServiceManager {
  private readonly registry: ServiceRegistry;
  private readonly starts = new Map<string, number>();
  private readonly logs = new Map<string, string[]>();
  private readonly remoteInitialized = new Set<string>();
  private readonly remoteInFlight = new Map<string, number>();
  private readonly localModuleCache = new Map<string, WebAssembly.Module>();
  private readonly startFailures = new Map<string, number[]>();
  private readonly events: AuditEvent[] = [];
  private readonly eventSubscribers = new Set<(event: AuditEvent) => void>();
  private eventSeq = 1;
  private remoteRequestCounter = 1;
  private pidCounter = 49000;

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
  }

  async applyManifest(manifest: MCPServiceManifest): Promise<ServiceRecord> {
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
    return this.registry.list();
  }

  async get(serviceId: string): Promise<ServiceRecord | undefined> {
    return this.registry.get(serviceId);
  }

  async unquarantine(serviceId: string): Promise<ServiceRecord> {
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
    const existing = await this.registry.get(serviceId);
    if (!existing) {
      throw new Error(`service not found: ${serviceId}`);
    }
    if (existing.runtime.lifecycle === "QUARANTINED") {
      throw new Error(`service is quarantined: ${serviceId} (use unquarantine first)`);
    }

    const startedAt = Date.now();
    this.starts.set(serviceId, startedAt);

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

    const quarantined = await this.shouldQuarantine(existing, !!lastError);
    const updated = await this.registry.update(serviceId, (current) => {
      const nextLifecycle = quarantined ? "QUARANTINED" : "RUNNING";
      return {
        ...current,
        runtime: {
          ...current.runtime,
          lifecycle: nextLifecycle,
          health,
          pid: quarantined ? undefined : ++this.pidCounter,
          uptimeSeconds: 0,
          lastHeartbeatAt: nowIso(),
          lastError
        }
      };
    });

    this.appendLog(serviceId, quarantined ? "Service quarantined after repeated failures" : "Service started");
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
    } else {
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

  async remove(serviceId: string): Promise<boolean> {
    this.starts.delete(serviceId);
    this.logs.delete(serviceId);
    this.remoteInitialized.delete(serviceId);
    this.remoteInFlight.delete(serviceId);
    const removed = await this.registry.remove(serviceId);
    if (removed) {
      this.emitEvent({
        kind: "service.removed",
        serviceId,
        level: "info",
        message: `Service removed: ${serviceId}`
      });
    }
    return removed;
  }

  async refreshInterface(serviceId: string): Promise<InterfaceSnapshot> {
    const service = await this.registry.get(serviceId);
    if (!service) {
      throw new Error(`service not found: ${serviceId}`);
    }

    let snapshot: InterfaceSnapshot;

    if (service.manifest.spec.origin.type === "remote_mcp") {
      this.enforceRemoteHostPolicy(service.manifest.spec.origin);
      await this.ensureRemoteInitialized(serviceId, service.manifest.spec.origin);
      const endpoint = service.manifest.spec.origin.endpoint;

      const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
        this.remoteRequest(serviceId, endpoint, "tools/list", {}),
        this.remoteRequest(serviceId, endpoint, "resources/list", {}).catch(() => ({ resources: [] })),
        this.remoteRequest(serviceId, endpoint, "prompts/list", {}).catch(() => ({ prompts: [] }))
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

  subscribeEvents(listener: (event: AuditEvent) => void): () => void {
    this.eventSubscribers.add(listener);
    return () => {
      this.eventSubscribers.delete(listener);
    };
  }

  async tickUptimes(): Promise<void> {
    const all = await this.registry.list();
    await Promise.all(
      all
        .filter((s) => s.runtime.lifecycle === "RUNNING")
        .map((s) => {
          const id = s.manifest.metadata.serviceId!;
          const started = this.starts.get(id);
          const uptimeSeconds = started ? Math.floor((Date.now() - started) / 1000) : 0;

          return this.registry.update(id, (current) => ({
            ...current,
            runtime: {
              ...current.runtime,
              uptimeSeconds,
              lastHeartbeatAt: nowIso()
            }
          }));
        })
    );
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
      const headers = this.resolveRemoteHeaders(service?.manifest.spec.origin.type === "remote_mcp" ? service.manifest.spec.origin : undefined);
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

    const headers = this.resolveRemoteHeaders(typeof origin === "string" ? undefined : origin);
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

  private resolveRemoteHeaders(origin: RemoteMcpOrigin | undefined): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };

    if (!origin?.authRef) {
      return headers;
    }

    const envKey = envKeyForAuthRef(origin.authRef);
    const secret = process.env[envKey];
    if (!secret) {
      throw new Error(`missing remote auth secret in env '${envKey}'`);
    }

    if (secret.startsWith("Bearer ")) {
      headers.Authorization = secret;
      return headers;
    }

    headers.Authorization = `Bearer ${secret}`;
    return headers;
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
    const module = await this.loadLocalModule(wasmPath);

    const inertModule = new Proxy(
      {},
      {
        get: () => () => 0
      }
    );
    const imports = new Proxy(
      {},
      {
        get: () => inertModule
      }
    ) as WebAssembly.Imports;

    const instance = await WebAssembly.instantiate(module, imports);
    const fn = instance.exports[functionName];
    if (typeof fn !== "function") {
      throw new Error(`exported function not found: ${functionName}`);
    }

    const args = this.resolveWasmArgs(argsList);
    let result: unknown;
    let lastTypeError: Error | null = null;

    for (const candidate of args) {
      try {
        result = (fn as Function)(...candidate);
        lastTypeError = null;
        break;
      } catch (error) {
        if (error instanceof TypeError) {
          lastTypeError = error;
          continue;
        }
        throw error;
      }
    }

    if (lastTypeError) {
      throw new Error(`failed to coerce function arguments for '${functionName}': ${lastTypeError.message}`);
    }

    return this.formatWasmResult(result);
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

  private formatWasmResult(value: unknown): string {
    if (value === undefined) {
      return "(no output)";
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value === "string") {
      return value;
    }

    return JSON.stringify(value);
  }

  private appendLog(serviceId: string, line: string): void {
    const current = this.logs.get(serviceId) ?? [];
    current.push(`[${nowIso()}] ${line}`);
    this.logs.set(serviceId, current);
  }

  private emitEvent(input: {
    kind: string;
    serviceId?: string;
    level: "info" | "warn" | "error";
    message: string;
    data?: unknown;
  }): void {
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
    for (const subscriber of this.eventSubscribers) {
      try {
        subscriber(event);
      } catch {
        // Swallow subscriber errors.
      }
    }
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
