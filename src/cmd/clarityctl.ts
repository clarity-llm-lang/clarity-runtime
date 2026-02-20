#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { MCPServiceManifest } from "../types/contracts.js";

const program = new Command();

const DEFAULT_DAEMON_URL = process.env.CLARITYD_URL ?? "http://localhost:4707";

async function api<T>(baseUrl: string, pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
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
      toolNamespace: input.module.toLowerCase()
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
      toolNamespace: input.module.toLowerCase()
    }
  };
}

async function runStdioGateway(baseUrl: string): Promise<void> {
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

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(message)
    });

    const raw = await response.text();
    if (!raw.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      process.stdout.write(`${JSON.stringify(parsed)}\n`);
    } catch {
      continue;
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

function resolveSourceAndModule(serviceInput: string, explicitModule?: string): { sourceFile: string; moduleName: string } {
  const resolvedInput = path.resolve(serviceInput);
  const hasClarityExtension = path.extname(resolvedInput) === ".clarity";
  const sourceFile = hasClarityExtension ? resolvedInput : `${resolvedInput}.clarity`;
  const moduleName = explicitModule ?? path.basename(sourceFile, path.extname(sourceFile));
  return { sourceFile, moduleName };
}

async function compileRegisterStartIntrospect(input: {
  daemonUrl: string;
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

  const applyOut = await api<{ service: unknown }>(input.daemonUrl, "/api/services/apply", {
    method: "POST",
    body: JSON.stringify({ manifest })
  });

  const serviceId = extractServiceId(applyOut);
  await api<Record<string, unknown>>(input.daemonUrl, `/api/services/${encodeURIComponent(serviceId)}/start`, {
    method: "POST"
  });
  await api<Record<string, unknown>>(input.daemonUrl, `/api/services/${encodeURIComponent(serviceId)}/introspect`, {
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
  .option("--daemon-url <url>", "Clarity daemon base URL", DEFAULT_DAEMON_URL);

program
  .command("list")
  .action(async () => {
    const opts = program.opts<{ daemonUrl: string }>();
    const out = await api<{ items: Array<Record<string, unknown>> }>(opts.daemonUrl, "/api/services");
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

program
  .command("status")
  .action(async () => {
    const opts = program.opts<{ daemonUrl: string }>();
    const out = await api<Record<string, unknown>>(opts.daemonUrl, "/api/status");
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
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
    const { sourceFile, moduleName } = resolveSourceAndModule(String(service), opts.module);
    const out = await compileRegisterStartIntrospect({
      daemonUrl: daemon,
      sourceFile,
      moduleName,
      wasmPath: opts.wasm,
      entry: opts.entry,
      displayName: opts.name,
      compilerBin: opts.compilerBin
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...out }, null, 2)}\n`);
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
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
    process.stderr.write("warning: `add-local` is legacy; prefer `add <service>`.\n");
    const manifest = localManifest({
      sourceFile: path.resolve(opts.source),
      module: opts.module,
      wasmPath: path.resolve(opts.wasm),
      entry: opts.entry,
      displayName: opts.name
    });

    const out = await api<{ service: unknown }>(daemon, "/api/services/apply", {
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
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
    process.stderr.write("warning: `start-source` is legacy; prefer `add <service>`.\n");
    const sourceFile = path.resolve(opts.source);
    const moduleName = opts.module ?? path.basename(sourceFile, path.extname(sourceFile));
    const out = await compileRegisterStartIntrospect({
      daemonUrl: daemon,
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
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
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

    const out = await api<{ service: unknown }>(daemon, "/api/services/apply", {
      method: "POST",
      body: JSON.stringify({ manifest })
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

for (const action of ["start", "stop", "restart", "introspect"] as const) {
  program
    .command(`${action} <serviceId>`)
    .action(async (serviceId) => {
      const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
      const out = await api<Record<string, unknown>>(daemon, `/api/services/${encodeURIComponent(serviceId)}/${action}`, {
        method: "POST"
      });
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    });
}

program
  .command("logs <serviceId>")
  .option("--limit <n>", "Number of lines", "200")
  .action(async (serviceId, opts) => {
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
    const limit = Number(opts.limit);
    const out = await api<{ lines: string[] }>(daemon, `/api/services/${encodeURIComponent(serviceId)}/logs?limit=${Number.isFinite(limit) ? limit : 200}`);
    process.stdout.write(`${out.lines.join("\n")}\n`);
  });

program
  .command("bootstrap")
  .option("--clients <items>", "Comma separated clients", "codex,claude")
  .action(async (opts) => {
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
    const clients = String(opts.clients)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const out = await api<Record<string, unknown>>(daemon, "/api/bootstrap", {
      method: "POST",
      body: JSON.stringify({ clients })
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  });

program
  .command("doctor")
  .action(async () => {
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
    const out = await api<Record<string, unknown>>(daemon, "/api/status");
    process.stdout.write(`${JSON.stringify({ ok: true, checks: [{ name: "daemon", status: "pass" }], status: out }, null, 2)}\n`);
  });

const gateway = program.command("gateway");
gateway
  .command("serve")
  .option("--stdio", "Run stdio bridge mode")
  .action(async (opts) => {
    if (!opts.stdio) {
      throw new Error("Only --stdio mode is currently supported");
    }

    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
    await runStdioGateway(daemon);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
