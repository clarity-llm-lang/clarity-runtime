#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { access, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { normalizeNamespace } from "../pkg/security/namespace.js";
import type { MCPServiceManifest } from "../types/contracts.js";

const program = new Command();

const DEFAULT_DAEMON_URL = process.env.CLARITYD_URL ?? "http://localhost:4707";

function requestHeaders(authToken: string | undefined, headers?: HeadersInit): Headers {
  const out = new Headers(headers);
  if (!out.has("content-type")) {
    out.set("content-type", "application/json");
  }
  if (authToken) {
    out.set("x-clarity-token", authToken);
  }
  return out;
}

async function api<T>(baseUrl: string, pathname: string, authToken: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: requestHeaders(authToken, init?.headers)
  });

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(parsed.error ?? `${res.status} ${res.statusText}`);
  }
  return parsed as T;
}

function localManifest(input: {
  sourceFile: string;
  module: string;
  wasmPath: string;
  entry: string;
  displayName?: string;
}): MCPServiceManifest {
  return {
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: input.sourceFile,
      module: input.module,
      displayName: input.displayName
    },
    spec: {
      origin: {
        type: "local_wasm",
        wasmPath: input.wasmPath,
        entry: input.entry
      },
      enabled: true,
      autostart: true,
      restartPolicy: {
        mode: "on-failure",
        maxRestarts: 5,
        windowSeconds: 60
      },
      policyRef: "default",
      toolNamespace: normalizeNamespace(input.module)
    }
  };
}

function remoteManifest(input: {
  endpoint: string;
  module: string;
  displayName?: string;
  timeoutMs?: number;
  allowedTools?: string[];
  authRef?: string;
  maxPayloadBytes?: number;
  maxConcurrency?: number;
}): MCPServiceManifest {
  return {
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: input.endpoint,
      module: input.module,
      displayName: input.displayName
    },
    spec: {
      origin: {
        type: "remote_mcp",
        endpoint: input.endpoint,
        transport: "streamable_http",
        ...(input.authRef ? { authRef: input.authRef } : {}),
        ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.allowedTools && input.allowedTools.length > 0 ? { allowedTools: input.allowedTools } : {}),
        ...(typeof input.maxPayloadBytes === "number" ? { maxPayloadBytes: input.maxPayloadBytes } : {}),
        ...(typeof input.maxConcurrency === "number" ? { maxConcurrency: input.maxConcurrency } : {})
      },
      enabled: true,
      autostart: true,
      restartPolicy: {
        mode: "on-failure",
        maxRestarts: 5,
        windowSeconds: 60
      },
      policyRef: "default",
      toolNamespace: normalizeNamespace(input.module)
    }
  };
}

async function runStdioGateway(baseUrl: string, authToken: string | undefined): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      // Ignore malformed JSON from upstream client and keep stream alive.
      continue;
    }

    const maybeId =
      message
      && typeof message === "object"
      && "id" in message
      ? (message as { id?: string | number | null }).id
      : undefined;

    try {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: requestHeaders(authToken),
        body: JSON.stringify(message)
      });

      const raw = await response.text();
      if (!raw.trim()) {
        continue;
      }

      const parsed = JSON.parse(raw);
      process.stdout.write(`${JSON.stringify(parsed)}\n`);
    } catch (error) {
      if (maybeId === undefined) {
        continue;
      }
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: maybeId,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error)
          }
        })}\n`
      );
    }
  }
}

async function runCompiler(compilerBin: string, sourceFile: string, wasmPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(compilerBin, ["compile", sourceFile, "-o", wasmPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `compiler exited with code ${code ?? "unknown"}`));
    });
  });
}

async function checkCompiler(compilerBin: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(compilerBin, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve((stdout || stderr).trim());
          return;
        }
        reject(new Error(stderr.trim() || `compiler exited with code ${code ?? "unknown"}`));
      });
    });
    return { ok: true, output };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function collectClarityFiles(rootDir: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        out.push(...(await collectClarityFiles(fullPath, true)));
      }
      continue;
    }
    if (entry.isFile() && path.extname(entry.name) === ".clarity") {
      out.push(fullPath);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function resolveSourceAndModule(serviceInput: string, explicitModule?: string): { sourceFile: string; moduleName: string } {
  const resolvedInput = path.resolve(serviceInput);
  const hasClarityExtension = path.extname(resolvedInput) === ".clarity";
  const sourceFile = hasClarityExtension ? resolvedInput : `${resolvedInput}.clarity`;
  const moduleName = explicitModule ?? path.basename(sourceFile, path.extname(sourceFile));
  return { sourceFile, moduleName };
}

async function compileRegisterStartIntrospect(input: {
  daemonUrl: string;
  authToken?: string;
  sourceFile: string;
  moduleName: string;
  wasmPath?: string;
  entry: string;
  displayName?: string;
  compilerBin: string;
}): Promise<{ serviceId: string; sourceFile: string; wasmPath: string; module: string }> {
  const wasmPath = input.wasmPath
    ? path.resolve(input.wasmPath)
    : path.resolve(process.cwd(), ".clarity", "build", `${input.moduleName}.wasm`);

  await mkdir(path.dirname(wasmPath), { recursive: true });
  await runCompiler(input.compilerBin, input.sourceFile, wasmPath);

  const manifest = localManifest({
    sourceFile: input.sourceFile,
    module: input.moduleName,
    wasmPath,
    entry: input.entry,
    displayName: input.displayName
  });

  const applyOut = await api<{ service: unknown }>(input.daemonUrl, "/api/services/apply", input.authToken, {
    method: "POST",
    body: JSON.stringify({ manifest })
  });

  const serviceId = extractServiceId(applyOut);
  await api<Record<string, unknown>>(input.daemonUrl, `/api/services/${encodeURIComponent(serviceId)}/start`, input.authToken, {
    method: "POST"
  });
  await api<Record<string, unknown>>(input.daemonUrl, `/api/services/${encodeURIComponent(serviceId)}/introspect`, input.authToken, {
    method: "POST"
  });

  return {
    serviceId,
    sourceFile: input.sourceFile,
    wasmPath,
    module: input.moduleName
  };
}

function extractServiceId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("unexpected API response shape");
  }
  const out = payload as {
    service?: {
      manifest?: {
        metadata?: {
          serviceId?: string;
        };
      };
    };
  };

  const serviceId = out.service?.manifest?.metadata?.serviceId;
  if (!serviceId) {
    throw new Error("serviceId missing from API response");
  }
  return serviceId;
}

program
  .name("clarityctl")
  .description("Clarity runtime control CLI")
  .option("--daemon-url <url>", "Clarity daemon base URL", DEFAULT_DAEMON_URL)
  .option("--auth-token <token>", "Runtime auth token", process.env.CLARITYD_AUTH_TOKEN ?? process.env.CLARITY_API_TOKEN);

function runtimeOpts(): { daemonUrl: string; authToken?: string } {
  return program.opts<{ daemonUrl: string; authToken?: string }>();
}

program
  .command("list")
  .action(async () => {
    const opts = runtimeOpts();
    const out = await api<{ items: Array<Record<string, unknown>> }>(opts.daemonUrl, "/api/services", opts.authToken);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

program
  .command("status")
  .action(async () => {
    const opts = runtimeOpts();
    const out = await api<Record<string, unknown>>(opts.daemonUrl, "/api/status", opts.authToken);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

program
  .command("add <service>")
  .description("Compile, register, and start a local Clarity service from <service>.clarity (or explicit path)")
  .option("--module <name>", "Module name (defaults to source file base name)")
  .option("--wasm <file>", "Compiled wasm output path")
  .option("--entry <name>", "MCP entry function", "mcp_main")
  .option("--name <display>", "Optional display name")
  .option("--compiler-bin <bin>", "Compiler binary", process.env.CLARITYC_BIN ?? "clarityc")
  .action(async (service, opts) => {
    const runtime = runtimeOpts();
    const { sourceFile, moduleName } = resolveSourceAndModule(String(service), opts.module);
    const out = await compileRegisterStartIntrospect({
      daemonUrl: runtime.daemonUrl,
      authToken: runtime.authToken,
      sourceFile,
      moduleName,
      wasmPath: opts.wasm,
      entry: opts.entry,
      displayName: opts.name,
      compilerBin: opts.compilerBin
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...out }, null, 2)}\n`);
  });

program
  .command("add-all [dir]")
  .description("Compile, register, and start all .clarity files in a directory")
  .option("--recursive", "Recurse into subdirectories")
  .option("--entry <name>", "MCP entry function", "mcp_main")
  .option("--compiler-bin <bin>", "Compiler binary", process.env.CLARITYC_BIN ?? "clarityc")
  .action(async (dir, opts) => {
    const runtime = runtimeOpts();
    const rootDir = path.resolve(dir ?? ".");
    const files = await collectClarityFiles(rootDir, Boolean(opts.recursive));
    if (files.length === 0) {
      process.stdout.write(`${JSON.stringify({ ok: true, added: 0, services: [], note: "no .clarity files found" }, null, 2)}\n`);
      return;
    }

    const services: Array<{ serviceId: string; sourceFile: string; wasmPath: string; module: string }> = [];
    for (const sourceFile of files) {
      const moduleName = path.basename(sourceFile, path.extname(sourceFile));
      const result = await compileRegisterStartIntrospect({
        daemonUrl: runtime.daemonUrl,
        authToken: runtime.authToken,
        sourceFile,
        moduleName,
        entry: opts.entry,
        compilerBin: opts.compilerBin
      });
      services.push(result);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          rootDir,
          scanned: files.length,
          added: services.length,
          services
        },
        null,
        2
      )}\n`
    );
  });

// Backward-compatible command: register a precompiled local wasm service.
program
  .command("add-local")
  .requiredOption("--source <file>", "Clarity source file path")
  .requiredOption("--module <name>", "Module name")
  .requiredOption("--wasm <file>", "Compiled wasm path")
  .option("--entry <name>", "MCP entry function", "mcp_main")
  .option("--name <display>", "Optional display name")
  .action(async (opts) => {
    const runtime = runtimeOpts();
    process.stderr.write("warning: `add-local` is legacy; prefer `add <service>`.\n");
    const manifest = localManifest({
      sourceFile: path.resolve(opts.source),
      module: opts.module,
      wasmPath: path.resolve(opts.wasm),
      entry: opts.entry,
      displayName: opts.name
    });

    const out = await api<{ service: unknown }>(runtime.daemonUrl, "/api/services/apply", runtime.authToken, {
      method: "POST",
      body: JSON.stringify({ manifest })
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

// Backward-compatible command: compile/register/start from explicit source options.
program
  .command("start-source")
  .requiredOption("--source <file>", "Clarity source file path")
  .option("--module <name>", "Module name (defaults to source file base name)")
  .option("--wasm <file>", "Compiled wasm output path")
  .option("--entry <name>", "MCP entry function", "mcp_main")
  .option("--name <display>", "Optional display name")
  .option("--compiler-bin <bin>", "Compiler binary", process.env.CLARITYC_BIN ?? "clarityc")
  .action(async (opts) => {
    const runtime = runtimeOpts();
    process.stderr.write("warning: `start-source` is legacy; prefer `add <service>`.\n");
    const sourceFile = path.resolve(opts.source);
    const moduleName = opts.module ?? path.basename(sourceFile, path.extname(sourceFile));
    const out = await compileRegisterStartIntrospect({
      daemonUrl: runtime.daemonUrl,
      authToken: runtime.authToken,
      sourceFile,
      moduleName,
      wasmPath: opts.wasm,
      entry: opts.entry,
      displayName: opts.name,
      compilerBin: opts.compilerBin
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...out }, null, 2)}\n`);
  });

program
  .command("add-remote")
  .requiredOption("--endpoint <url>", "Remote MCP URL")
  .requiredOption("--module <name>", "Logical module name")
  .option("--name <display>", "Optional display name")
  .option("--auth-ref <name>", "Auth secret reference name (resolved from env)")
  .option("--timeout-ms <ms>", "Remote request timeout in milliseconds")
  .option("--allow-tools <items>", "Comma-separated remote tool allowlist (optional)")
  .option("--max-payload-bytes <bytes>", "Max response/request payload bytes for this remote service")
  .option("--max-concurrency <n>", "Max concurrent in-flight remote requests for this service")
  .action(async (opts) => {
    const runtime = runtimeOpts();
    const timeoutMs = opts.timeoutMs !== undefined ? Number(opts.timeoutMs) : undefined;
    const maxPayloadBytes = opts.maxPayloadBytes !== undefined ? Number(opts.maxPayloadBytes) : undefined;
    const maxConcurrency = opts.maxConcurrency !== undefined ? Number(opts.maxConcurrency) : undefined;
    const allowedTools = opts.allowTools
      ? String(opts.allowTools).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const manifest = remoteManifest({
      endpoint: opts.endpoint,
      module: opts.module,
      displayName: opts.name,
      authRef: opts.authRef,
      timeoutMs: Number.isFinite(timeoutMs as number) && (timeoutMs as number) > 0 ? timeoutMs : undefined,
      allowedTools,
      maxPayloadBytes: Number.isFinite(maxPayloadBytes as number) && (maxPayloadBytes as number) >= 1024 ? maxPayloadBytes : undefined,
      maxConcurrency: Number.isFinite(maxConcurrency as number) && (maxConcurrency as number) > 0 ? maxConcurrency : undefined
    });

    const out = await api<{ service: unknown }>(runtime.daemonUrl, "/api/services/apply", runtime.authToken, {
      method: "POST",
      body: JSON.stringify({ manifest })
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

for (const action of ["start", "stop", "restart", "introspect"] as const) {
  program
    .command(`${action} <serviceId>`)
    .action(async (serviceId) => {
      const runtime = runtimeOpts();
      const out = await api<Record<string, unknown>>(
        runtime.daemonUrl,
        `/api/services/${encodeURIComponent(serviceId)}/${action}`,
        runtime.authToken,
        {
          method: "POST"
        }
      );
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    });
}

program
  .command("remove <serviceId>")
  .option("--cleanup-artifacts", "Delete local wasm artifact when removing local service")
  .action(async (serviceId, opts) => {
    const runtime = runtimeOpts();
    const out = await api<Record<string, unknown>>(
      runtime.daemonUrl,
      `/api/services/${encodeURIComponent(serviceId)}`,
      runtime.authToken,
      {
        method: "DELETE",
        body: JSON.stringify({
          cleanup_artifacts: Boolean(opts.cleanupArtifacts)
        })
      }
    );
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

program
  .command("details <serviceId>")
  .option("--log-limit <n>", "Recent log lines", "50")
  .option("--event-limit <n>", "Recent events", "100")
  .option("--call-limit <n>", "Recent tool calls", "20")
  .action(async (serviceId, opts) => {
    const runtime = runtimeOpts();
    const logLimit = Number(opts.logLimit);
    const eventLimit = Number(opts.eventLimit);
    const callLimit = Number(opts.callLimit);
    const qs = new URLSearchParams({
      log_limit: String(Number.isFinite(logLimit) ? logLimit : 50),
      event_limit: String(Number.isFinite(eventLimit) ? eventLimit : 100),
      call_limit: String(Number.isFinite(callLimit) ? callLimit : 20)
    });
    const out = await api<Record<string, unknown>>(
      runtime.daemonUrl,
      `/api/services/${encodeURIComponent(serviceId)}/details?${qs.toString()}`,
      runtime.authToken
    );
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

program
  .command("logs <serviceId>")
  .option("--limit <n>", "Number of lines", "200")
  .action(async (serviceId, opts) => {
    const runtime = runtimeOpts();
    const limit = Number(opts.limit);
    const out = await api<{ lines: string[] }>(
      runtime.daemonUrl,
      `/api/services/${encodeURIComponent(serviceId)}/logs?limit=${Number.isFinite(limit) ? limit : 200}`,
      runtime.authToken
    );
    process.stdout.write(`${out.lines.join("\n")}\n`);
  });

const authCmd = program.command("auth").description("Remote auth provider and secret lifecycle operations");

authCmd
  .command("providers")
  .action(async () => {
    const runtime = runtimeOpts();
    const out = await api<Record<string, unknown>>(runtime.daemonUrl, "/api/security/auth/providers", runtime.authToken);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

authCmd
  .command("validate <authRef>")
  .action(async (authRef) => {
    const runtime = runtimeOpts();
    const out = await api<Record<string, unknown>>(runtime.daemonUrl, "/api/security/auth/validate", runtime.authToken, {
      method: "POST",
      body: JSON.stringify({ auth_ref: authRef })
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

authCmd
  .command("list-secrets")
  .action(async () => {
    const runtime = runtimeOpts();
    const out = await api<Record<string, unknown>>(runtime.daemonUrl, "/api/security/auth/secrets", runtime.authToken);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

authCmd
  .command("set-secret <authRef> <secret>")
  .action(async (authRef, secret) => {
    const runtime = runtimeOpts();
    const out = await api<Record<string, unknown>>(runtime.daemonUrl, "/api/security/auth/secrets", runtime.authToken, {
      method: "POST",
      body: JSON.stringify({ auth_ref: authRef, secret })
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

authCmd
  .command("delete-secret <authRef>")
  .action(async (authRef) => {
    const runtime = runtimeOpts();
    const out = await api<Record<string, unknown>>(runtime.daemonUrl, "/api/security/auth/secrets", runtime.authToken, {
      method: "DELETE",
      body: JSON.stringify({ auth_ref: authRef })
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

program
  .command("bootstrap")
  .option("--clients <items>", "Comma separated clients", "codex,claude")
  .action(async (opts) => {
    const runtime = runtimeOpts();
    const clients = String(opts.clients)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const out = await api<Record<string, unknown>>(runtime.daemonUrl, "/api/bootstrap", runtime.authToken, {
      method: "POST",
      body: JSON.stringify({ clients })
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

program
  .command("doctor")
  .option("--compiler-bin <bin>", "Compiler binary", process.env.CLARITYC_BIN ?? "clarityc")
  .action(async (opts) => {
    const runtime = runtimeOpts();
    const checks: Array<{ name: string; status: "pass" | "fail"; detail?: string }> = [];
    let statusOut: Record<string, unknown> | undefined;

    try {
      statusOut = await api<Record<string, unknown>>(runtime.daemonUrl, "/api/status", runtime.authToken);
      checks.push({ name: "daemon", status: "pass", detail: `reachable at ${runtime.daemonUrl}` });
    } catch (error) {
      checks.push({
        name: "daemon",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error)
      });
    }

    const compiler = await checkCompiler(opts.compilerBin);
    if (compiler.ok) {
      checks.push({ name: "compiler", status: "pass", detail: compiler.output || "compiler available" });
    } else {
      checks.push({ name: "compiler", status: "fail", detail: compiler.error });
    }

    const buildDir = path.resolve(process.cwd(), ".clarity", "build");
    try {
      await mkdir(buildDir, { recursive: true });
      await access(buildDir);
      checks.push({ name: "workspace", status: "pass", detail: `build dir ready: ${buildDir}` });
    } catch (error) {
      checks.push({
        name: "workspace",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error)
      });
    }

    const ok = checks.every((check) => check.status === "pass");
    process.stdout.write(`${JSON.stringify({ ok, checks, ...(statusOut ? { status: statusOut } : {}) }, null, 2)}\n`);
    if (!ok) {
      process.exitCode = 1;
    }
  });

const gateway = program.command("gateway");
gateway
  .command("serve")
  .option("--stdio", "Run stdio bridge mode")
  .action(async (opts) => {
    if (!opts.stdio) {
      throw new Error("Only --stdio mode is currently supported");
    }

    const runtime = runtimeOpts();
    await runStdioGateway(runtime.daemonUrl, runtime.authToken);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
