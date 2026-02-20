import type {
  InterfaceSnapshot,
  MCPServiceManifest,
  ServiceRecord
} from "../../types/contracts.js";
import { deriveInterfaceRevision } from "../registry/ids.js";
import { ServiceRegistry } from "../registry/registry.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class ServiceManager {
  private readonly registry: ServiceRegistry;
  private readonly starts = new Map<string, number>();
  private readonly logs = new Map<string, string[]>();
  private pidCounter = 49000;

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
  }

  async applyManifest(manifest: MCPServiceManifest): Promise<ServiceRecord> {
    const record = await this.registry.upsert(manifest);
    this.appendLog(manifest.metadata.serviceId!, `Manifest applied (${manifest.spec.origin.type})`);
    return record;
  }

  async list(): Promise<ServiceRecord[]> {
    return this.registry.list();
  }

  async get(serviceId: string): Promise<ServiceRecord | undefined> {
    return this.registry.get(serviceId);
  }

  async start(serviceId: string): Promise<ServiceRecord> {
    const existing = await this.registry.get(serviceId);
    if (!existing) {
      throw new Error(`service not found: ${serviceId}`);
    }

    const startedAt = Date.now();
    this.starts.set(serviceId, startedAt);

    const updated = await this.registry.update(serviceId, (current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        lifecycle: "RUNNING",
        health: "HEALTHY",
        pid: ++this.pidCounter,
        uptimeSeconds: 0,
        lastHeartbeatAt: nowIso(),
        lastError: undefined
      }
    }));

    this.appendLog(serviceId, "Service started");
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
    this.appendLog(serviceId, "Service stopped");
    return updated;
  }

  async restart(serviceId: string): Promise<ServiceRecord> {
    await this.stop(serviceId);
    return this.registry.update(serviceId, (current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        restartCount: current.runtime.restartCount + 1
      }
    })).then(() => this.start(serviceId));
  }

  async remove(serviceId: string): Promise<boolean> {
    this.starts.delete(serviceId);
    this.logs.delete(serviceId);
    return this.registry.remove(serviceId);
  }

  async refreshInterface(serviceId: string): Promise<InterfaceSnapshot> {
    const service = await this.registry.get(serviceId);
    if (!service) {
      throw new Error(`service not found: ${serviceId}`);
    }

    const namespace = service.manifest.spec.toolNamespace ?? service.manifest.metadata.module.toLowerCase();
    const snapshot: InterfaceSnapshot = {
      interfaceRevision: deriveInterfaceRevision(`${serviceId}:${Date.now()}`),
      introspectedAt: nowIso(),
      tools: [
        {
          name: `${namespace}__health_check`,
          description: "Synthetic v1 placeholder tool exposed by gateway",
          inputSchema: {
            type: "object",
            properties: {
              verbose: { type: "boolean" }
            },
            additionalProperties: false
          }
        }
      ],
      resources: [],
      prompts: []
    };

    await this.registry.update(serviceId, (current) => ({
      ...current,
      interfaceSnapshot: snapshot
    }));

    this.appendLog(serviceId, "Interface snapshot refreshed");
    return snapshot;
  }

  async tailLogs(serviceId: string, limit = 200): Promise<string[]> {
    const lines = this.logs.get(serviceId) ?? [];
    return lines.slice(Math.max(0, lines.length - limit));
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

  private appendLog(serviceId: string, line: string): void {
    const current = this.logs.get(serviceId) ?? [];
    current.push(`[${nowIso()}] ${line}`);
    this.logs.set(serviceId, current);
  }
}
