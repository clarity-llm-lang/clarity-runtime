import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { McpRouter } from "../pkg/gateway/mcp-router.js";
import { ServiceRegistry } from "../pkg/registry/registry.js";
import { ServiceManager } from "../pkg/supervisor/service-manager.js";

async function callBootstrapTool(router: McpRouter, args: Record<string, unknown>) {
  const response = await router.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "clarity__bootstrap_app",
      arguments: args
    }
  });

  if (!response) {
    throw new Error("missing JSON-RPC response");
  }
  return response;
}

test("clarity__bootstrap_app is idempotent on retry with same project", async () => {
  const workspaceTmp = await mkdtemp(path.join(process.cwd(), ".tmp-bootstrap-idempotent-"));
  const registryPath = path.join(workspaceTmp, "registry.json");
  const telemetryPath = path.join(workspaceTmp, "telemetry.json");
  const compilerPath = path.join(workspaceTmp, "fake-compiler.sh");

  await writeFile(
    compilerPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "clarityc fake-1.0.0"
  exit 0
fi
if [ "$1" = "compile" ]; then
  out="$4"
  mkdir -p "$(dirname "$out")"
  echo "wasm-bytes" > "$out"
  exit 0
fi
echo "unsupported args" >&2
exit 1
`,
    "utf8"
  );
  await chmod(compilerPath, 0o755);

  const registry = new ServiceRegistry(registryPath);
  await registry.init();
  const manager = new ServiceManager(registry, telemetryPath);
  await manager.init();
  const router = new McpRouter(manager);

  try {
    const first = await callBootstrapTool(router, {
      project_name: "retry-app",
      module_name: "RetryApp",
      dir: workspaceTmp,
      compiler_bin: compilerPath,
      register_service: false
    });
    assert.ok("result" in first);
    const firstPayload = JSON.parse((first.result as { content: Array<{ text: string }> }).content[0]!.text) as {
      files_written: string[];
      idempotent: boolean;
    };
    assert.ok(firstPayload.files_written.length > 0);
    assert.equal(firstPayload.idempotent, false);

    const second = await callBootstrapTool(router, {
      project_name: "retry-app",
      module_name: "RetryApp",
      dir: workspaceTmp,
      compiler_bin: compilerPath,
      register_service: false
    });
    assert.ok("result" in second);
    const secondPayload = JSON.parse((second.result as { content: Array<{ text: string }> }).content[0]!.text) as {
      files_written: string[];
      idempotent: boolean;
    };
    assert.equal(secondPayload.files_written.length, 0);
    assert.equal(secondPayload.idempotent, true);
  } finally {
    await manager.shutdown();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});

test("clarity__bootstrap_app rolls back files when compile fails", async () => {
  const workspaceTmp = await mkdtemp(path.join(process.cwd(), ".tmp-bootstrap-rollback-"));
  const registryPath = path.join(workspaceTmp, "registry.json");
  const telemetryPath = path.join(workspaceTmp, "telemetry.json");
  const compilerPath = path.join(workspaceTmp, "fake-compiler-fail.sh");

  await writeFile(
    compilerPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "clarityc fake-1.0.0"
  exit 0
fi
if [ "$1" = "compile" ]; then
  echo "compile failed on purpose" >&2
  exit 2
fi
echo "unsupported args" >&2
exit 1
`,
    "utf8"
  );
  await chmod(compilerPath, 0o755);

  const registry = new ServiceRegistry(registryPath);
  await registry.init();
  const manager = new ServiceManager(registry, telemetryPath);
  await manager.init();
  const router = new McpRouter(manager);

  try {
    const response = await callBootstrapTool(router, {
      project_name: "fail-app",
      module_name: "FailApp",
      dir: workspaceTmp,
      compiler_bin: compilerPath,
      register_service: false
    });
    assert.ok("error" in response);
    const errorMsg = String((response.error as { message?: string }).message ?? "");
    assert.match(errorMsg, /bootstrap failed:/i);
    assert.match(errorMsg, /rollback files=ok/i);

    const sourcePath = path.join(workspaceTmp, "fail-app", "src", "main.clarity");
    await assert.rejects(() => access(sourcePath));
  } finally {
    await manager.shutdown();
    await rm(workspaceTmp, { recursive: true, force: true });
  }
});
