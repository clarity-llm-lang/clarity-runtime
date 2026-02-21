import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "../pkg/rpc/manifest.js";

test("validateManifest accepts valid local_wasm manifest", () => {
  const manifest = validateManifest({
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/sample.clarity",
      module: "Sample"
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
          module: "Bad"
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
