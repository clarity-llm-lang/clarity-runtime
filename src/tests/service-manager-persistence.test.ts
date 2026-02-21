import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { ServiceRegistry } from "../pkg/registry/registry.js";
import { ServiceManager } from "../pkg/supervisor/service-manager.js";
import type { MCPServiceManifest } from "../types/contracts.js";

test("ServiceManager persists audit events and logs across restarts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-runtime-persist-"));
  const registryPath = path.join(root, "registry.json");
  const telemetryPath = path.join(root, "telemetry.json");

  let manager1: ServiceManager | undefined;
  let manager2: ServiceManager | undefined;
  try {
    const registry1 = new ServiceRegistry(registryPath);
    await registry1.init();
    manager1 = new ServiceManager(registry1, telemetryPath);
    await manager1.init();

    const manifest: MCPServiceManifest = {
      apiVersion: "clarity.runtime/v1",
      kind: "MCPService",
      metadata: {
        sourceFile: "/tmp/sample.clarity",
        module: "SamplePersist"
      },
      spec: {
        origin: {
          type: "local_wasm",
          wasmPath: path.join(root, "missing.wasm"),
          entry: "mcp_main"
        },
        enabled: true,
        autostart: true,
        restartPolicy: {
          mode: "on-failure",
          maxRestarts: 5,
          windowSeconds: 60
        },
        policyRef: "default",
        toolNamespace: "samplepersist"
      }
    };

    const applied = await manager1.applyManifest(manifest);
    const serviceId = applied.manifest.metadata.serviceId!;
    await manager1.start(serviceId);

    const beforeEvents = manager1.getRecentEvents(200);
    const beforeLogs = await manager1.tailLogs(serviceId, 200);
    assert.ok(beforeEvents.length > 0);
    assert.ok(beforeLogs.length > 0);
    await manager1.shutdown();

    const registry2 = new ServiceRegistry(registryPath);
    await registry2.init();
    manager2 = new ServiceManager(registry2, telemetryPath);
    await manager2.init();

    const afterEvents = manager2.getRecentEvents(200);
    const afterLogs = await manager2.tailLogs(serviceId, 200);
    assert.ok(afterEvents.length >= beforeEvents.length);
    assert.ok(afterLogs.length >= beforeLogs.length);
    assert.ok(afterEvents.some((event) => event.kind === "service.manifest_applied"));
  } finally {
    if (manager1) {
      await manager1.shutdown();
    }
    if (manager2) {
      await manager2.shutdown();
    }
    await rm(root, { recursive: true, force: true });
  }
});
