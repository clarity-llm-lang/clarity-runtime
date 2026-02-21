import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { ServiceRegistry } from "../pkg/registry/registry.js";
import { ServiceManager } from "../pkg/supervisor/service-manager.js";
import type { MCPServiceManifest } from "../types/contracts.js";

function manifestFor(root: string): MCPServiceManifest {
  return {
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/audit.clarity",
      module: "AuditSvc"
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
      toolNamespace: "auditsvc"
    }
  };
}

test("audit policy can disable lifecycle events while retaining mcp tool events", async () => {
  const prev = process.env.CLARITY_AUDIT_INCLUDE_LIFECYCLE;
  process.env.CLARITY_AUDIT_INCLUDE_LIFECYCLE = "0";
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-audit-policy-"));

  try {
    const registry = new ServiceRegistry(path.join(root, "registry.json"));
    await registry.init();
    const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
    await manager.init();
    const applied = await manager.applyManifest(manifestFor(root));
    await manager.start(applied.manifest.metadata.serviceId!);
    manager.recordRuntimeEvent({
      kind: "mcp.tool_called",
      serviceId: applied.manifest.metadata.serviceId!,
      level: "info",
      message: "MCP tool called: clarity__sources"
    });

    const events = manager.getRecentEvents(200);
    assert.ok(events.some((e) => e.kind === "mcp.tool_called"));
    assert.ok(!events.some((e) => e.kind.startsWith("service.")));
    await manager.shutdown();
  } finally {
    if (prev === undefined) {
      delete process.env.CLARITY_AUDIT_INCLUDE_LIFECYCLE;
    } else {
      process.env.CLARITY_AUDIT_INCLUDE_LIFECYCLE = prev;
    }
    await rm(root, { recursive: true, force: true });
  }
});
