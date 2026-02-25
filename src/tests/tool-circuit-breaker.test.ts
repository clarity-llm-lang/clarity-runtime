import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import type { MCPServiceManifest } from "../types/contracts.js";
import { ServiceRegistry } from "../pkg/registry/registry.js";
import { ServiceManager } from "../pkg/supervisor/service-manager.js";

test("tool-call circuit breaker quarantines service when error rate spikes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-tool-cb-"));
  const prevWindow = process.env.CLARITY_TOOL_CIRCUIT_WINDOW_SECONDS;
  const prevMinCalls = process.env.CLARITY_TOOL_CIRCUIT_MIN_CALLS;
  const prevErrorRate = process.env.CLARITY_TOOL_CIRCUIT_ERROR_RATE;
  process.env.CLARITY_TOOL_CIRCUIT_WINDOW_SECONDS = "120";
  process.env.CLARITY_TOOL_CIRCUIT_MIN_CALLS = "2";
  process.env.CLARITY_TOOL_CIRCUIT_ERROR_RATE = "0.5";

  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();

  try {
    const manifest: MCPServiceManifest = {
      apiVersion: "clarity.runtime/v1",
      kind: "MCPService",
      metadata: {
        sourceFile: path.join(root, "cb.clarity"),
        module: "CircuitBreaker",
        serviceType: "mcp"
      },
      spec: {
        origin: {
          type: "local_wasm",
          wasmPath: path.join(root, "cb.wasm"),
          entry: "mcp_main"
        },
        enabled: true,
        autostart: false,
        restartPolicy: {
          mode: "on-failure",
          maxRestarts: 5,
          windowSeconds: 60
        },
        policyRef: "default"
      }
    };

    const applied = await manager.applyManifest(manifest);
    const serviceId = applied.manifest.metadata.serviceId!;
    await registry.update(serviceId, (current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        lifecycle: "RUNNING",
        health: "HEALTHY",
        pid: 12345
      }
    }));

    await assert.rejects(
      manager.callTool(serviceId, "unsupported_local_tool", {}),
      /unsupported local tool/
    );
    await assert.rejects(
      manager.callTool(serviceId, "unsupported_local_tool", {}),
      /unsupported local tool/
    );

    const latest = await manager.get(serviceId);
    assert.ok(latest);
    assert.equal(latest?.runtime.lifecycle, "QUARANTINED");
    assert.equal(latest?.runtime.health, "DEGRADED");

    const events = manager.getRecentEvents(50);
    assert.ok(events.some((event) => event.kind === "service.quarantined"));
  } finally {
    if (prevWindow === undefined) {
      delete process.env.CLARITY_TOOL_CIRCUIT_WINDOW_SECONDS;
    } else {
      process.env.CLARITY_TOOL_CIRCUIT_WINDOW_SECONDS = prevWindow;
    }
    if (prevMinCalls === undefined) {
      delete process.env.CLARITY_TOOL_CIRCUIT_MIN_CALLS;
    } else {
      process.env.CLARITY_TOOL_CIRCUIT_MIN_CALLS = prevMinCalls;
    }
    if (prevErrorRate === undefined) {
      delete process.env.CLARITY_TOOL_CIRCUIT_ERROR_RATE;
    } else {
      process.env.CLARITY_TOOL_CIRCUIT_ERROR_RATE = prevErrorRate;
    }
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
