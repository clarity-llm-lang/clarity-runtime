import path from "node:path";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import type { ServiceManager } from "../supervisor/service-manager.js";
import type { MCPServiceManifest } from "../../types/contracts.js";
import { validateManifest } from "../rpc/manifest.js";
import { normalizeNamespace } from "../security/namespace.js";
import { failure, success, type JsonRpcRequest, type JsonRpcResponse } from "./mcp-jsonrpc.js";

interface RoutedTool {
  serviceId: string;
  remoteToolName: string;
}

interface RuntimeToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
}

const RUNTIME_TOOLS: RuntimeToolDef[] = [
  {
    name: "runtime__status_summary",
    description: "Summarize the runtime: total/running/degraded/stopped plus local/remote counts.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "runtime__list_services",
    description: "List all registered services with lifecycle, health, and interface counts.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "runtime__get_service",
    description: "Get full details for a specific service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__get_logs",
    description: "Fetch recent logs for a specific service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 1000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__start_service",
    description: "Start a registered service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__stop_service",
    description: "Stop a running service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__restart_service",
    description: "Restart a service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__refresh_interface",
    description: "Refresh cached MCP interface snapshot for a service.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__unquarantine_service",
    description: "Clear quarantine state for a service so it can be started again.",
    inputSchema: {
      type: "object",
      required: ["service_id"],
      properties: {
        service_id: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__get_audit",
    description: "Return recent runtime audit/events (latest first in returned slice order).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 2000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__clarity_help",
    description: "Return Clarity-oriented guidance for LLM usage in this runtime workspace.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__clarity_sources",
    description: "List workspace .clarity files and optionally include short source excerpts.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        recursive: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        include_excerpt: { type: "boolean" },
        excerpt_chars: { type: "integer", minimum: 64, maximum: 8000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__clarity_project_structure",
    description: "Return a recommended Clarity application file structure with starter templates.",
    inputSchema: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        module_name: { type: "string" },
        include_templates: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__ensure_compiler",
    description: "Check Clarity compiler availability and optionally install it via a gated command.",
    inputSchema: {
      type: "object",
      properties: {
        compiler_bin: { type: "string" },
        auto_install: { type: "boolean" },
        install_command: { type: "array", items: { type: "string" } },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 600 }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__apply_manifest",
    description: "Apply a full MCPService manifest. Provisioning gate required.",
    inputSchema: {
      type: "object",
      required: ["manifest"],
      properties: {
        manifest: { type: "object" },
        start_now: { type: "boolean" },
        introspect: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__register_local",
    description: "Register a local wasm MCP service. Provisioning gate required.",
    inputSchema: {
      type: "object",
      required: ["wasm_path"],
      properties: {
        wasm_path: { type: "string" },
        source_file: { type: "string" },
        module: { type: "string" },
        display_name: { type: "string" },
        entry: { type: "string" },
        tool_namespace: { type: "string" },
        autostart: { type: "boolean" },
        enabled: { type: "boolean" },
        start_now: { type: "boolean" },
        introspect: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__register_remote",
    description: "Register a remote MCP service endpoint. Provisioning gate required.",
    inputSchema: {
      type: "object",
      required: ["endpoint"],
      properties: {
        endpoint: { type: "string" },
        module: { type: "string" },
        display_name: { type: "string" },
        auth_ref: { type: "string" },
        timeout_ms: { type: "integer", minimum: 1 },
        max_payload_bytes: { type: "integer", minimum: 1024 },
        max_concurrency: { type: "integer", minimum: 1 },
        allowed_tools: { type: "array", items: { type: "string" } },
        tool_namespace: { type: "string" },
        autostart: { type: "boolean" },
        enabled: { type: "boolean" },
        start_now: { type: "boolean" },
        introspect: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "runtime__register_via_url",
    description: "Register a remote MCP service from a URL (minimal onboarding). Provisioning gate required.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        module: { type: "string" },
        display_name: { type: "string" },
        auth_ref: { type: "string" },
        timeout_ms: { type: "integer", minimum: 1 },
        max_payload_bytes: { type: "integer", minimum: 1024 },
        max_concurrency: { type: "integer", minimum: 1 },
        allowed_tools: { type: "array", items: { type: "string" } },
        tool_namespace: { type: "string" },
        autostart: { type: "boolean" },
        enabled: { type: "boolean" },
        start_now: { type: "boolean" },
        introspect: { type: "boolean" }
      },
      additionalProperties: false
    }
  }
];

function namespaceFor(service: Awaited<ReturnType<ServiceManager["list"]>>[number]): string {
  return normalizeNamespace(service.manifest.spec.toolNamespace ?? service.manifest.metadata.module);
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as Record<string, unknown>;
}

function asString(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function asInteger(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isInteger(input)) {
    return undefined;
  }
  return input;
}

function asIntegerMin(input: unknown, min: number): number | undefined {
  const value = asInteger(input);
  if (value === undefined || value < min) {
    return undefined;
  }
  return value;
}

function asBoolean(input: unknown): boolean | undefined {
  if (typeof input !== "boolean") {
    return undefined;
  }
  return input;
}

function asStringList(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const out = input.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out : undefined;
}

function inferModuleFromPath(wasmPath: string): string {
  const base = path.basename(wasmPath, path.extname(wasmPath));
  return base.length > 0 ? base : "local_service";
}

function inferModuleFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const tail = url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname;
    return tail || "remote_service";
  } catch {
    return "remote_service";
  }
}

function parseAllowedHosts(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const hosts = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? new Set(hosts) : null;
}

function assertProvisioningEnabled(): void {
  const value = (process.env.CLARITY_ENABLE_MCP_PROVISIONING ?? "").toLowerCase();
  if (!(value === "1" || value === "true" || value === "yes")) {
    throw new Error("MCP provisioning is disabled. Set CLARITY_ENABLE_MCP_PROVISIONING=1 to enable runtime__register_* tools.");
  }
}

function parseAllowedInstallerCommands(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const entries = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return entries.length > 0 ? new Set(entries) : null;
}

function assertCompilerInstallEnabled(command: string): void {
  const enabled = (process.env.CLARITY_ENABLE_COMPILER_INSTALL ?? "").toLowerCase();
  if (!(enabled === "1" || enabled === "true" || enabled === "yes")) {
    throw new Error("compiler install is disabled. Set CLARITY_ENABLE_COMPILER_INSTALL=1 to enable runtime__ensure_compiler auto-install.");
  }
  const allowed = parseAllowedInstallerCommands(process.env.CLARITY_COMPILER_INSTALL_ALLOWLIST);
  if (!allowed) return;
  if (!allowed.has(command.toLowerCase())) {
    throw new Error(`install command '${command}' is not in CLARITY_COMPILER_INSTALL_ALLOWLIST`);
  }
}

function assertRemoteHostAllowed(endpoint: string): void {
  const allowedHosts = parseAllowedHosts(process.env.CLARITY_REMOTE_ALLOWED_HOSTS);
  if (!allowedHosts) return;
  const host = new URL(endpoint).hostname.toLowerCase();
  if (!allowedHosts.has(host)) {
    throw new Error(`remote endpoint host '${host}' is not in CLARITY_REMOTE_ALLOWED_HOSTS`);
  }
}

function contentJson(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function isSubPathOfWorkspace(targetPath: string): boolean {
  const workspace = path.resolve(process.cwd());
  const target = path.resolve(targetPath);
  return target === workspace || target.startsWith(`${workspace}${path.sep}`);
}

function resolveWorkspacePath(inputPath: string | undefined, fallback = "."): string {
  const resolved = path.resolve(inputPath ?? fallback);
  if (!isSubPathOfWorkspace(resolved)) {
    throw new Error("path must be inside the current workspace");
  }
  return resolved;
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      child.kill("SIGTERM");
      reject(new Error(`command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      resolve({
        code: code ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

async function walkClarityFiles(rootDir: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        out.push(...(await walkClarityFiles(fullPath, true)));
      }
      continue;
    }
    if (entry.isFile() && path.extname(entry.name) === ".clarity") {
      out.push(fullPath);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function summarizeService(record: Awaited<ReturnType<ServiceManager["list"]>>[number]) {
  return {
    service_id: record.manifest.metadata.serviceId,
    display_name: record.manifest.metadata.displayName,
    source_file: record.manifest.metadata.sourceFile,
    module: record.manifest.metadata.module,
    origin_type: record.manifest.spec.origin.type,
    lifecycle: record.runtime.lifecycle,
    health: record.runtime.health,
    uptime_seconds: record.runtime.uptimeSeconds,
    restart_count: record.runtime.restartCount,
    interface: record.interfaceSnapshot
      ? {
          revision: record.interfaceSnapshot.interfaceRevision,
          introspected_at: record.interfaceSnapshot.introspectedAt,
          tools: record.interfaceSnapshot.tools.length,
          resources: record.interfaceSnapshot.resources.length,
          prompts: record.interfaceSnapshot.prompts.length
        }
      : null
  };
}

export class McpRouter {
  constructor(private readonly manager: ServiceManager) {}

  async handle(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = message.id ?? null;

    if (message.method === "initialize") {
      return success(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: "clarity-runtime",
          version: "0.1.0"
        }
      });
    }

    if (message.method === "notifications/initialized") {
      return null;
    }

    if (message.method === "ping") {
      return success(id, {});
    }

    if (message.method === "tools/list") {
      const tools = await this.aggregateTools();
      return success(id, { tools });
    }

    if (message.method === "resources/list") {
      const resources = await this.aggregateResources();
      return success(id, { resources });
    }

    if (message.method === "prompts/list") {
      const prompts = await this.aggregatePrompts();
      return success(id, { prompts });
    }

    if (message.method === "tools/call") {
      const params = (message.params ?? {}) as { name?: string; arguments?: unknown };
      if (!params.name) {
        return failure(id, -32602, "tools/call requires params.name");
      }

      try {
        if (params.name.startsWith("runtime__")) {
          const result = await this.handleRuntimeToolCall(params.name, params.arguments ?? {});
          return success(id, result);
        }

        const routed = await this.resolveTool(params.name);
        if (!routed) {
          return failure(id, -32602, `unknown tool: ${params.name}`);
        }

        const result = await this.manager.callTool(routed.serviceId, routed.remoteToolName, params.arguments ?? {});
        return success(id, result);
      } catch (error) {
        return failure(
          id,
          -32000,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return failure(id, -32601, `method not found: ${message.method}`);
  }

  private async handleRuntimeToolCall(name: string, args: unknown): Promise<unknown> {
    const payload = asObject(args);

    if (name === "runtime__status_summary") {
      const services = await this.manager.list();
      return contentJson({
        total: services.length,
        running: services.filter((s) => s.runtime.lifecycle === "RUNNING").length,
        degraded: services.filter((s) => s.runtime.health === "DEGRADED").length,
        stopped: services.filter((s) => s.runtime.lifecycle === "STOPPED" || s.runtime.lifecycle === "REGISTERED").length,
        quarantined: services.filter((s) => s.runtime.lifecycle === "QUARANTINED").length,
        local: services.filter((s) => s.manifest.spec.origin.type === "local_wasm").length,
        remote: services.filter((s) => s.manifest.spec.origin.type === "remote_mcp").length
      });
    }

    if (name === "runtime__list_services") {
      const services = await this.manager.list();
      return contentJson({
        services: services.map(summarizeService)
      });
    }

    if (name === "runtime__get_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__get_service requires service_id");
      const service = await this.manager.get(serviceId);
      if (!service) throw new Error(`service not found: ${serviceId}`);
      return contentJson({ service });
    }

    if (name === "runtime__get_logs") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__get_logs requires service_id");
      const limit = asInteger(payload.limit) ?? 200;
      return contentJson({
        service_id: serviceId,
        lines: await this.manager.tailLogs(serviceId, limit)
      });
    }

    if (name === "runtime__start_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__start_service requires service_id");
      const service = await this.manager.start(serviceId);
      return contentJson({ service: summarizeService(service) });
    }

    if (name === "runtime__stop_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__stop_service requires service_id");
      const service = await this.manager.stop(serviceId);
      return contentJson({ service: summarizeService(service) });
    }

    if (name === "runtime__restart_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__restart_service requires service_id");
      const service = await this.manager.restart(serviceId);
      return contentJson({ service: summarizeService(service) });
    }

    if (name === "runtime__refresh_interface") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__refresh_interface requires service_id");
      const snapshot = await this.manager.refreshInterface(serviceId);
      return contentJson({
        service_id: serviceId,
        interface: snapshot
      });
    }

    if (name === "runtime__unquarantine_service") {
      const serviceId = asString(payload.service_id);
      if (!serviceId) throw new Error("runtime__unquarantine_service requires service_id");
      const service = await this.manager.unquarantine(serviceId);
      return contentJson({ service: summarizeService(service) });
    }

    if (name === "runtime__get_audit") {
      const limit = asInteger(payload.limit) ?? 200;
      return contentJson({
        items: this.manager.getRecentEvents(limit)
      });
    }

    if (name === "runtime__clarity_help") {
      const topic = (asString(payload.topic) ?? "overview").toLowerCase();
      const help = {
        overview: {
          goal: "Help the LLM work with Clarity sources while runtime executes compiled wasm artifacts.",
          default_language: "clarity",
          workflow: [
            "Default to writing new application logic in Clarity when no language is explicitly requested.",
            "Use runtime__clarity_sources to inspect real .clarity files in this workspace.",
            "Use runtime__clarity_project_structure before scaffolding a new app to get canonical layout + starter files.",
            "Use runtime__ensure_compiler to verify/install clarityc before compile/register flows.",
            "Use `clarityctl add <service>` (or add-all) to compile/register/start services.",
            "Use runtime__list_services + runtime__get_service to understand live wiring."
          ],
          important: [
            "Authoring source is .clarity.",
            "Execution artifact is .wasm (built under .clarity/build by default).",
            "Runtime tool names are namespaced as <namespace>__<tool>."
          ]
        },
        prompts: {
          prompt_templates: [
            "Explain this file's MCP surface and expected tools.",
            "Refactor this .clarity module for clearer tool boundaries.",
            "Generate tests/examples for these exported functions."
          ]
        },
        onboarding: {
          commands: [
            "runtime__ensure_compiler",
            "runtime__clarity_project_structure",
            "clarityctl add <service>",
            "clarityctl add-all ./examples --recursive",
            "clarityctl list",
            "clarityctl introspect <service_id>"
          ]
        },
        default_language: {
          language: "clarity",
          policy: "When a user asks for a new app/module without naming a language, author in Clarity first.",
          exceptions: [
            "If user explicitly requests another language.",
            "If task is runtime/infra glue that clearly belongs in TypeScript or shell."
          ]
        }
      } as const;

      return contentJson({
        topic,
        ...(("overview" in help && (help as Record<string, unknown>)[topic]) ? { details: (help as Record<string, unknown>)[topic] } : { details: help.overview }),
        all_topics: Object.keys(help)
      });
    }

    if (name === "runtime__clarity_project_structure") {
      const projectName = asString(payload.project_name) ?? "my-clarity-app";
      const moduleName = asString(payload.module_name) ?? "App";
      const includeTemplates = asBoolean(payload.include_templates) ?? true;

      const files: Array<{ path: string; purpose: string; template?: string }> = [
        {
          path: `${projectName}/src/main.clarity`,
          purpose: "Primary Clarity module exported by the application."
        },
        {
          path: `${projectName}/README.md`,
          purpose: "Project usage, runbook, and MCP tool examples."
        },
        {
          path: `${projectName}/clarity.toml`,
          purpose: "Project metadata and build/runtime configuration."
        },
        {
          path: `${projectName}/tests/smoke.md`,
          purpose: "Simple manual/agent smoke tests for expected tool behavior."
        }
      ];

      if (includeTemplates) {
        files[0].template = [
          `module ${moduleName} {`,
          "  // Deterministic pseudo-random roll from seed in [1, 10].",
          "  export fn roll(seed: int) -> int {",
          "    let next = (seed * 1103515245 + 12345) % 2147483647;",
          "    return (next % 10) + 1;",
          "  }",
          "}"
        ].join("\n");
        files[1].template = [
          `# ${projectName}`,
          "",
          "Minimal Clarity MCP application.",
          "",
          "## Example",
          "",
          "Use the exported tool/function:",
          "- `roll(seed: int) -> int`"
        ].join("\n");
        files[2].template = [
          `name = "${projectName}"`,
          `module = "${moduleName}"`,
          "",
          "[build]",
          'entry = "mcp_main"',
          'out_dir = ".clarity/build"'
        ].join("\n");
        files[3].template = [
          "# Smoke test",
          "",
          "1. Build and register the service.",
          "2. Call `roll(42)` and verify result is within 1..10.",
          "3. Call `roll(42)` again and verify deterministic output."
        ].join("\n");
      }

      return contentJson({
        project_name: projectName,
        module_name: moduleName,
        guidance: [
          "Keep source under src/ and expose a small stable public function/tool surface.",
          "Document expected inputs/outputs in README before expanding tool count.",
          "Add at least one deterministic smoke test scenario."
        ],
        tree: [
          `${projectName}/`,
          "  src/",
          "    main.clarity",
          "  tests/",
          "    smoke.md",
          "  clarity.toml",
          "  README.md"
        ],
        files
      });
    }

    if (name === "runtime__ensure_compiler") {
      const compilerBin = asString(payload.compiler_bin) ?? process.env.CLARITYC_BIN ?? "clarityc";
      const autoInstall = asBoolean(payload.auto_install) ?? false;
      const timeoutSeconds = asIntegerMin(payload.timeout_seconds, 1) ?? 120;
      const timeoutMs = timeoutSeconds * 1000;
      const installCommandFromArgs = asStringList(payload.install_command);

      const checkBefore = await runCommand(compilerBin, ["--version"], timeoutMs).catch((error) => ({
        code: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error)
      }));

      if (checkBefore.code === 0) {
        return contentJson({
          compiler_bin: compilerBin,
          available: true,
          installed: false,
          version: checkBefore.stdout || checkBefore.stderr
        });
      }

      if (!autoInstall) {
        return contentJson({
          compiler_bin: compilerBin,
          available: false,
          installed: false,
          error: checkBefore.stderr || "compiler check failed",
          next_steps: [
            "Re-run with auto_install=true and install_command=[...] if you want runtime to install the compiler.",
            "Or install clarityc manually and re-run runtime__ensure_compiler."
          ]
        });
      }

      const installTokens = installCommandFromArgs
        ?? asStringList((process.env.CLARITY_COMPILER_INSTALL_CMD ?? "").split(" ").filter(Boolean));
      if (!installTokens || installTokens.length === 0) {
        throw new Error("auto_install requested but no install_command provided and CLARITY_COMPILER_INSTALL_CMD is empty");
      }
      const installCmd = installTokens[0]!;
      const installArgs = installTokens.slice(1);
      assertCompilerInstallEnabled(installCmd);

      const installResult = await runCommand(installCmd, installArgs, timeoutMs);
      if (installResult.code !== 0) {
        return contentJson({
          compiler_bin: compilerBin,
          available: false,
          installed: false,
          install: {
            command: [installCmd, ...installArgs],
            exit_code: installResult.code,
            stdout: installResult.stdout,
            stderr: installResult.stderr
          },
          error: "install command failed"
        });
      }

      const checkAfter = await runCommand(compilerBin, ["--version"], timeoutMs).catch((error) => ({
        code: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error)
      }));
      return contentJson({
        compiler_bin: compilerBin,
        available: checkAfter.code === 0,
        installed: true,
        install: {
          command: [installCmd, ...installArgs],
          exit_code: installResult.code
        },
        version: checkAfter.stdout || checkAfter.stderr,
        verification: checkAfter.code === 0 ? "compiler available after install" : "install ran but compiler check still failed"
      });
    }

    if (name === "runtime__clarity_sources") {
      const dir = resolveWorkspacePath(asString(payload.dir), ".");
      const recursive = asBoolean(payload.recursive) ?? true;
      const limit = asInteger(payload.limit) ?? 50;
      const includeExcerpt = asBoolean(payload.include_excerpt) ?? false;
      const excerptChars = asIntegerMin(payload.excerpt_chars, 64) ?? 512;
      const files = await walkClarityFiles(dir, recursive);
      const selected = files.slice(0, Math.max(1, Math.min(limit, 200)));
      const workspace = path.resolve(process.cwd());

      const items = await Promise.all(
        selected.map(async (filePath) => {
          const relative = path.relative(workspace, filePath);
          if (!includeExcerpt) {
            return {
              file: relative,
              module: path.basename(filePath, ".clarity")
            };
          }

          const raw = await readFile(filePath, "utf8");
          return {
            file: relative,
            module: path.basename(filePath, ".clarity"),
            excerpt: raw.slice(0, excerptChars)
          };
        })
      );

      return contentJson({
        workspace,
        dir: path.relative(workspace, dir) || ".",
        total_found: files.length,
        returned: items.length,
        items
      });
    }

    if (name === "runtime__apply_manifest") {
      assertProvisioningEnabled();
      const manifest = validateManifest(payload.manifest);
      const service = await this.manager.applyManifest(manifest);
      const serviceId = service.manifest.metadata.serviceId!;
      const startNow = asBoolean(payload.start_now) ?? true;
      const introspect = asBoolean(payload.introspect) ?? true;

      if (startNow) {
        await this.manager.start(serviceId);
      }
      if (introspect) {
        await this.manager.refreshInterface(serviceId);
      }

      const latest = await this.manager.get(serviceId);
      if (!latest) {
        throw new Error(`service not found after apply: ${serviceId}`);
      }
      return contentJson({
        service: summarizeService(latest),
        applied: true,
        started: startNow,
        introspected: introspect
      });
    }

    if (name === "runtime__register_local") {
      assertProvisioningEnabled();
      const wasmPath = asString(payload.wasm_path);
      if (!wasmPath) throw new Error("runtime__register_local requires wasm_path");

      const module = asString(payload.module) ?? inferModuleFromPath(wasmPath);
      const namespace = normalizeNamespace(asString(payload.tool_namespace) ?? module);
      const sourceFile = asString(payload.source_file) ?? wasmPath;
      const manifest: MCPServiceManifest = {
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile,
          module,
          ...(asString(payload.display_name) ? { displayName: asString(payload.display_name) } : {})
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath,
            entry: asString(payload.entry) ?? "mcp_main"
          },
          enabled: asBoolean(payload.enabled) ?? true,
          autostart: asBoolean(payload.autostart) ?? true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default",
          toolNamespace: namespace
        }
      };

      const service = await this.manager.applyManifest(manifest);
      const serviceId = service.manifest.metadata.serviceId!;
      const startNow = asBoolean(payload.start_now) ?? true;
      const introspect = asBoolean(payload.introspect) ?? true;

      if (startNow) {
        await this.manager.start(serviceId);
      }
      if (introspect) {
        await this.manager.refreshInterface(serviceId);
      }

      const latest = await this.manager.get(serviceId);
      if (!latest) {
        throw new Error(`service not found after register: ${serviceId}`);
      }
      return contentJson({
        service: summarizeService(latest),
        created: true,
        started: startNow,
        introspected: introspect
      });
    }

    if (name === "runtime__register_remote") {
      assertProvisioningEnabled();
      const endpoint = asString(payload.endpoint);
      if (!endpoint) throw new Error("runtime__register_remote requires endpoint");
      assertRemoteHostAllowed(endpoint);

      const module = asString(payload.module) ?? inferModuleFromEndpoint(endpoint);
      const namespace = normalizeNamespace(asString(payload.tool_namespace) ?? module);
      const timeoutMs = asIntegerMin(payload.timeout_ms, 1);
      const maxPayloadBytes = asIntegerMin(payload.max_payload_bytes, 1024);
      const maxConcurrency = asIntegerMin(payload.max_concurrency, 1);
      const manifest: MCPServiceManifest = {
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: endpoint,
          module,
          ...(asString(payload.display_name) ? { displayName: asString(payload.display_name) } : {})
        },
        spec: {
          origin: {
            type: "remote_mcp",
            endpoint,
            transport: "streamable_http",
            ...(asString(payload.auth_ref) ? { authRef: asString(payload.auth_ref) } : {}),
            ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
            ...(typeof maxPayloadBytes === "number" ? { maxPayloadBytes } : {}),
            ...(typeof maxConcurrency === "number" ? { maxConcurrency } : {}),
            ...(asStringList(payload.allowed_tools) ? { allowedTools: asStringList(payload.allowed_tools) } : {})
          },
          enabled: asBoolean(payload.enabled) ?? true,
          autostart: asBoolean(payload.autostart) ?? true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default",
          toolNamespace: namespace
        }
      };

      const service = await this.manager.applyManifest(manifest);
      const serviceId = service.manifest.metadata.serviceId!;
      const startNow = asBoolean(payload.start_now) ?? true;
      const introspect = asBoolean(payload.introspect) ?? true;

      if (startNow) {
        await this.manager.start(serviceId);
      }
      if (introspect) {
        await this.manager.refreshInterface(serviceId);
      }

      const latest = await this.manager.get(serviceId);
      if (!latest) {
        throw new Error(`service not found after register: ${serviceId}`);
      }
      return contentJson({
        service: summarizeService(latest),
        created: true,
        started: startNow,
        introspected: introspect
      });
    }

    if (name === "runtime__register_via_url") {
      assertProvisioningEnabled();
      const endpoint = asString(payload.url);
      if (!endpoint) throw new Error("runtime__register_via_url requires url");
      assertRemoteHostAllowed(endpoint);

      const module = asString(payload.module) ?? inferModuleFromEndpoint(endpoint);
      const namespace = normalizeNamespace(asString(payload.tool_namespace) ?? module);
      const timeoutMs = asIntegerMin(payload.timeout_ms, 1);
      const maxPayloadBytes = asIntegerMin(payload.max_payload_bytes, 1024);
      const maxConcurrency = asIntegerMin(payload.max_concurrency, 1);
      const manifest: MCPServiceManifest = {
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: endpoint,
          module,
          ...(asString(payload.display_name) ? { displayName: asString(payload.display_name) } : {})
        },
        spec: {
          origin: {
            type: "remote_mcp",
            endpoint,
            transport: "streamable_http",
            ...(asString(payload.auth_ref) ? { authRef: asString(payload.auth_ref) } : {}),
            ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
            ...(typeof maxPayloadBytes === "number" ? { maxPayloadBytes } : {}),
            ...(typeof maxConcurrency === "number" ? { maxConcurrency } : {}),
            ...(asStringList(payload.allowed_tools) ? { allowedTools: asStringList(payload.allowed_tools) } : {})
          },
          enabled: asBoolean(payload.enabled) ?? true,
          autostart: asBoolean(payload.autostart) ?? true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default",
          toolNamespace: namespace
        }
      };

      const service = await this.manager.applyManifest(manifest);
      const serviceId = service.manifest.metadata.serviceId!;
      const startNow = asBoolean(payload.start_now) ?? true;
      const introspect = asBoolean(payload.introspect) ?? true;

      if (startNow) {
        await this.manager.start(serviceId);
      }
      if (introspect) {
        await this.manager.refreshInterface(serviceId);
      }

      const latest = await this.manager.get(serviceId);
      if (!latest) {
        throw new Error(`service not found after register: ${serviceId}`);
      }
      return contentJson({
        service: summarizeService(latest),
        created: true,
        started: startNow,
        introspected: introspect
      });
    }

    throw new Error(`unknown runtime tool: ${name}`);
  }

  private async aggregateTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const services = await this.runningServices();
    const out: Array<{ name: string; description?: string; inputSchema?: unknown }> = [...RUNTIME_TOOLS];

    for (const service of services) {
      const snapshot = await this.ensureInterface(service.manifest.metadata.serviceId!);
      const namespace = namespaceFor(service);
      for (const tool of snapshot.tools) {
        out.push({
          name: `${namespace}__${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema
        });
      }
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async aggregateResources(): Promise<Array<{ uri: string; name?: string; description?: string }>> {
    const services = await this.runningServices();
    const out: Array<{ uri: string; name?: string; description?: string }> = [];

    for (const service of services) {
      const snapshot = await this.ensureInterface(service.manifest.metadata.serviceId!);
      out.push(...snapshot.resources);
    }

    return out;
  }

  private async aggregatePrompts(): Promise<Array<{ name: string; description?: string; arguments?: unknown[] }>> {
    const services = await this.runningServices();
    const out: Array<{ name: string; description?: string; arguments?: unknown[] }> = [];

    for (const service of services) {
      const snapshot = await this.ensureInterface(service.manifest.metadata.serviceId!);
      const namespace = namespaceFor(service);
      for (const prompt of snapshot.prompts) {
        out.push({
          name: `${namespace}__${prompt.name}`,
          description: prompt.description,
          arguments: prompt.arguments
        });
      }
    }

    return out;
  }

  private async resolveTool(exposedName: string): Promise<RoutedTool | null> {
    const services = await this.runningServices();

    for (const service of services) {
      const serviceId = service.manifest.metadata.serviceId!;
      const namespace = namespaceFor(service);
      const snapshot = await this.ensureInterface(serviceId);

      for (const tool of snapshot.tools) {
        const candidate = `${namespace}__${tool.name}`;
        if (candidate === exposedName) {
          return {
            serviceId,
            remoteToolName: tool.name
          };
        }
      }
    }

    return null;
  }

  private async ensureInterface(serviceId: string) {
    const current = await this.manager.get(serviceId);
    if (current?.interfaceSnapshot) {
      return current.interfaceSnapshot;
    }
    return this.manager.refreshInterface(serviceId);
  }

  private async runningServices() {
    const all = await this.manager.list();
    return all.filter((s) => s.runtime.lifecycle === "RUNNING" && s.runtime.enabled);
  }
}
