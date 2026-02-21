import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "../pkg/rpc/manifest.js";

test("validateManifest accepts valid local_wasm manifest", () => {
  const manifest = validateManifest({
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/sample.clarity",
      module: "Sample",
      serviceType: "mcp"
    },
    spec: {
      origin: {
        type: "local_wasm",
        wasmPath: "/tmp/sample.wasm",
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
      toolNamespace: "sample"
    }
  });

  assert.equal(manifest.kind, "MCPService");
});

test("validateManifest rejects remote endpoint traversal/invalid URL", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "bad",
          module: "Bad",
          serviceType: "mcp"
        },
        spec: {
          origin: {
            type: "remote_mcp",
            endpoint: "file:///etc/passwd",
            transport: "streamable_http"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /valid http\(s\) URL/
  );
});

test("validateManifest accepts explicit metadata.serviceType=agent", () => {
  const manifest = validateManifest({
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/agent.clarity",
      module: "AgentSample",
      serviceType: "agent",
      agent: {
        agentId: "agent-sample",
        name: "Agent Sample",
        role: "coordinator",
        objective: "Coordinate downstream tools"
      }
    },
    spec: {
      origin: {
        type: "local_wasm",
        wasmPath: "/tmp/agent.wasm",
        entry: "mcp_main"
      },
      enabled: true,
      autostart: true,
      restartPolicy: {
        mode: "on-failure",
        maxRestarts: 5,
        windowSeconds: 60
      },
      policyRef: "default"
    }
  });

  assert.equal(manifest.metadata.serviceType, "agent");
  assert.equal(manifest.metadata.agent?.agentId, "agent-sample");
});

test("validateManifest rejects metadata.serviceType=agent without metadata.agent", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent.clarity",
          module: "AgentSample",
          serviceType: "agent"
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent.wasm",
            entry: "mcp_main"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /metadata\.agent/
  );
});

test("validateManifest rejects invalid metadata.serviceType", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/invalid.clarity",
          module: "Invalid",
          serviceType: "tool"
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/invalid.wasm",
            entry: "mcp_main"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /metadata\.serviceType/
  );
});
