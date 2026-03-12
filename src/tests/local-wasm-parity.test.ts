import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { MCPServiceManifest } from "../types/contracts.js";
import { ServiceRegistry } from "../pkg/registry/registry.js";
import { ServiceManager } from "../pkg/supervisor/service-manager.js";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function extractTextResponse(value: unknown): string {
  const content = asObject(value).content;
  if (!Array.isArray(content) || content.length === 0) {
    return "";
  }
  return String(asObject(content[0]).text ?? "");
}

const EMPTY_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const UNSUPPORTED_IMPORT_WASM = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x02, 0x13, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x0b, 0x6d, 0x63, 0x70, 0x5f, 0x63, 0x6f, 0x6e, 0x6e, 0x65, 0x63, 0x74, 0x00, 0x00
]);
const STRUCTURED_MARSHAL_WASM = Buffer.from(
  "AGFzbQEAAAABHwRgAn9/AX9gBX9/f39/AX9gBn9/f39/fwF/YAF/AX8CFQEDZW52DXN0cmluZ19jb25jYXQAAAMEAwECAwUFAQEBgAIGBgF/AEEwCwdGBQZtZW1vcnkCAAxyZWNlaXZlX2NoYXQAAQhvbl90aW1lcgACEW1hcnNoYWxfcm91bmR0cmlwAAMLX19oZWFwX2Jhc2UDAApVAyEAQQAgBCgCAEEUIAQoAhRBFCAEKAIYEAAQABAAEAAQAAssAEEcIAUoAgBBFCAFKAIMQRQgBSgCCEEUIAUoAhQQABAAEAAQABAAEAAQAAsEACAACws4AwBBAAsRDQAAAG1hcnNoYWwtY2hhdDoAQRQLBQEAAAA6AEEcCxIOAAAAbWFyc2hhbC10aW1lcjo=",
  "base64"
);

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}

test("local_wasm start rejects unsupported std/mcp and std/a2a imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-runtime-local-wasm-unsupported-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();

  try {
    const wasmPath = path.join(root, "unsupported-imports.wasm");
    await writeFile(wasmPath, UNSUPPORTED_IMPORT_WASM);

    const manifest: MCPServiceManifest = {
      apiVersion: "clarity.runtime/v1",
      kind: "MCPService",
      metadata: {
        sourceFile: "/tmp/unsupported-imports.clarity",
        module: "UnsupportedImports",
        serviceType: "agent",
        agent: {
          agentId: "unsupported-imports-agent",
          name: "Unsupported Imports Agent",
          role: "worker",
          objective: "Validate unsupported import rejection",
          triggers: ["api"]
        }
      },
      spec: {
        origin: {
          type: "local_wasm",
          wasmPath,
          entry: "mcp_main"
        },
        enabled: true,
        autostart: false,
        restartPolicy: {
          mode: "never",
          maxRestarts: 0,
          windowSeconds: 60
        },
        policyRef: "default"
      }
    };

    const applied = await manager.applyManifest(manifest);
    const serviceId = applied.manifest.metadata.serviceId!;
    const started = await manager.start(serviceId);

    assert.equal(started.runtime.lifecycle, "STOPPED");
    assert.equal(started.runtime.health, "DEGRADED");
    assert.match(String(started.runtime.lastError ?? ""), /unsupported host imports/i);
    assert.match(String(started.runtime.lastError ?? ""), /env\.mcp_connect/);
  } finally {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("timer schedules emit canonical trigger context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-runtime-local-wasm-timer-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();

  try {
    const wasmPath = path.join(root, "timer-agent.wasm");
    await writeFile(wasmPath, EMPTY_WASM);

    const manifest: MCPServiceManifest = {
      apiVersion: "clarity.runtime/v1",
      kind: "MCPService",
      metadata: {
        sourceFile: "/tmp/timer-agent.clarity",
        module: "TimerAgent",
        serviceType: "agent",
        agent: {
          agentId: "timer-agent",
          name: "Timer Agent",
          role: "coordinator",
          objective: "Execute periodic runs",
          triggers: ["timer"],
          timer: {
            serial: true,
            schedules: [
              {
                scheduleId: "every_second",
                scheduleExpr: "every 1 s",
                enabled: true
              }
            ]
          }
        }
      },
      spec: {
        origin: {
          type: "local_wasm",
          wasmPath,
          entry: "mcp_main"
        },
        enabled: true,
        autostart: false,
        restartPolicy: {
          mode: "never",
          maxRestarts: 0,
          windowSeconds: 60
        },
        policyRef: "default"
      }
    };

    const applied = await manager.applyManifest(manifest);
    const serviceId = applied.manifest.metadata.serviceId!;
    const started = await manager.start(serviceId);
    assert.equal(started.runtime.lifecycle, "RUNNING");

    const observed = await waitFor(() => {
      return manager.getRecentEvents(400).some((event) => {
        if (event.kind !== "agent.run_created") {
          return false;
        }
        const data = asObject(event.data);
        return String(data.serviceId ?? data.service_id ?? "") === serviceId && String(data.trigger) === "timer";
      });
    }, 4_000);
    assert.equal(observed, true);

    const timerRunCreated = manager.getRecentEvents(400).find((event) => {
      if (event.kind !== "agent.run_created") {
        return false;
      }
      const data = asObject(event.data);
      return String(data.serviceId ?? data.service_id ?? "") === serviceId && String(data.trigger) === "timer";
    });
    assert.ok(timerRunCreated);
    const payload = asObject(timerRunCreated?.data);
    const triggerContext = asObject(payload.triggerContext);
    assert.equal(String(triggerContext.scheduleId), "every_second");
    assert.equal(String(triggerContext.scheduleExpr), "every 1 s");
    assert.ok(String(triggerContext.firedAt).length > 0);

    const runs = manager.getAgentRuns(100);
    const timerRun = runs.find((run) => run.serviceId === serviceId && run.trigger === "timer");
    assert.ok(timerRun);
    assert.equal(String(asObject(timerRun?.triggerContext).scheduleId), "every_second");
  } finally {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("local_wasm fn tools support typed record/list marshalling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-runtime-local-wasm-marshal-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();

  try {
    const wasmPath = path.join(root, "marshal-agent.wasm");
    await writeFile(wasmPath, STRUCTURED_MARSHAL_WASM);

    const manifest: MCPServiceManifest = {
      apiVersion: "clarity.runtime/v1",
      kind: "MCPService",
      metadata: {
        sourceFile: "/tmp/marshal-agent.clarity",
        module: "MarshalAgent",
        serviceType: "agent",
        agent: {
          agentId: "marshal-agent",
          name: "Marshal Agent",
          role: "worker",
          objective: "Validate typed wasm marshalling",
          triggers: ["api"]
        }
      },
      spec: {
        origin: {
          type: "local_wasm",
          wasmPath,
          entry: "main"
        },
        enabled: true,
        autostart: false,
        restartPolicy: {
          mode: "never",
          maxRestarts: 0,
          windowSeconds: 60
        },
        policyRef: "default"
      }
    };

    const applied = await manager.applyManifest(manifest);
    const serviceId = applied.manifest.metadata.serviceId!;
    const started = await manager.start(serviceId);
    assert.equal(started.runtime.lifecycle, "RUNNING");

    const marshalType = {
      kind: "Record",
      fields: [
        { name: "name", type: { kind: "String" } },
        { name: "values", type: { kind: "List", element: { kind: "Int64" } } },
        { name: "tags", type: { kind: "List", element: { kind: "String" } } },
        { name: "ok", type: { kind: "Bool" } }
      ]
    };

    const roundtrip = await manager.callTool(serviceId, "fn__marshal_roundtrip", {
      args: [
        {
          name: "payload-1",
          values: [3, 7],
          tags: ["alpha", "beta"],
          ok: true
        }
      ],
      argTypes: [marshalType],
      resultType: marshalType
    });
    const roundtripText = extractTextResponse(roundtrip);
    assert.ok(roundtripText.length > 0);
    const decoded = asObject(JSON.parse(roundtripText));
    assert.equal(String(decoded.name), "payload-1");
    assert.deepEqual(decoded.values, ["3", "7"]);
    assert.deepEqual(decoded.tags, ["alpha", "beta"]);
    assert.equal(decoded.ok, true);

    const timerCall = await manager.callTool(serviceId, "fn__on_timer", {
      args: [
        "run-local-1",
        "every_second",
        "every 1 s",
        "2026-03-08T12:00:00.000Z",
        "{}",
        {
          runId: "run-local-1",
          agent: "marshal-agent",
          trigger: "timer",
          scheduleId: "every_second",
          scheduleExpr: "every 1 s",
          firedAt: "2026-03-08T12:00:00.000Z"
        }
      ],
      argTypes: [
        { kind: "String" },
        { kind: "String" },
        { kind: "String" },
        { kind: "String" },
        { kind: "String" },
        {
          kind: "Record",
          fields: [
            { name: "runId", type: { kind: "String" } },
            { name: "agent", type: { kind: "String" } },
            { name: "trigger", type: { kind: "String" } },
            { name: "scheduleId", type: { kind: "String" } },
            { name: "scheduleExpr", type: { kind: "String" } },
            { name: "firedAt", type: { kind: "String" } }
          ]
        }
      ],
      expectStringResult: true
    });
    assert.equal(
      extractTextResponse(timerCall),
      "marshal-timer:run-local-1:every_second:timer:2026-03-08T12:00:00.000Z"
    );
  } finally {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
