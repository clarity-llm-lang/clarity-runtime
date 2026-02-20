import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MCPServiceManifest, RegistryFile, ServiceRecord } from "../../types/contracts.js";

const DEFAULT_REGISTRY_PATH = path.resolve(process.cwd(), ".clarity/runtime/registry.json");

function nowIso(): string {
  return new Date().toISOString();
}

function createEmptyRegistry(): RegistryFile {
  return {
    version: 1,
    updatedAt: nowIso(),
    services: []
  };
}

export class ServiceRegistry {
  private readonly filePath: string;

  constructor(filePath = DEFAULT_REGISTRY_PATH) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await this.write(createEmptyRegistry());
    }
  }

  async list(): Promise<ServiceRecord[]> {
    const data = await this.read();
    return data.services;
  }

  async get(serviceId: string): Promise<ServiceRecord | undefined> {
    const data = await this.read();
    return data.services.find((s) => s.manifest.metadata.serviceId === serviceId);
  }

  async upsert(manifest: MCPServiceManifest): Promise<ServiceRecord> {
    const data = await this.read();
    const now = nowIso();
    const id = manifest.metadata.serviceId;
    if (!id) {
      throw new Error("manifest.metadata.serviceId is required before upsert");
    }

    const index = data.services.findIndex((s) => s.manifest.metadata.serviceId === id);

    if (index >= 0) {
      const prev = data.services[index];
      const merged: ServiceRecord = {
        ...prev,
        manifest: {
          ...manifest,
          metadata: {
            ...manifest.metadata,
            createdAt: prev.manifest.metadata.createdAt ?? now,
            updatedAt: now
          }
        },
        runtime: {
          ...prev.runtime,
          enabled: manifest.spec.enabled,
          autostart: manifest.spec.autostart
        }
      };
      data.services[index] = merged;
      data.updatedAt = now;
      await this.write(data);
      return merged;
    }

    const record: ServiceRecord = {
      manifest: {
        ...manifest,
        metadata: {
          ...manifest.metadata,
          createdAt: now,
          updatedAt: now
        }
      },
      runtime: {
        lifecycle: "REGISTERED",
        health: "UNKNOWN",
        enabled: manifest.spec.enabled,
        autostart: manifest.spec.autostart,
        uptimeSeconds: 0,
        restartCount: 0
      }
    };

    data.services.push(record);
    data.updatedAt = now;
    await this.write(data);
    return record;
  }

  async update(serviceId: string, updater: (current: ServiceRecord) => ServiceRecord): Promise<ServiceRecord> {
    const data = await this.read();
    const index = data.services.findIndex((s) => s.manifest.metadata.serviceId === serviceId);
    if (index < 0) {
      throw new Error(`service not found: ${serviceId}`);
    }

    const updated = updater(data.services[index]);
    updated.manifest.metadata.updatedAt = nowIso();
    data.services[index] = updated;
    data.updatedAt = nowIso();
    await this.write(data);
    return updated;
  }

  async remove(serviceId: string): Promise<boolean> {
    const data = await this.read();
    const before = data.services.length;
    data.services = data.services.filter((s) => s.manifest.metadata.serviceId !== serviceId);
    const removed = data.services.length !== before;
    if (removed) {
      data.updatedAt = nowIso();
      await this.write(data);
    }
    return removed;
  }

  private async read(): Promise<RegistryFile> {
    await this.init();
    const raw = await readFile(this.filePath, "utf8");
    return JSON.parse(raw) as RegistryFile;
  }

  private async write(file: RegistryFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}
