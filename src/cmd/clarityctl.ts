#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import readline from "node:readline";
import type { MCPServiceManifest } from "../types/contracts.js";

const program = new Command();

const DEFAULT_DAEMON_URL = process.env.CLARITYD_URL ?? "http://127.0.0.1:4707";

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
        transport: "streamable_http"
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
  .command("add-local")
  .requiredOption("--source <file>", "Clarity source file path")
  .requiredOption("--module <name>", "Module name")
  .requiredOption("--wasm <file>", "Compiled wasm path")
  .option("--entry <name>", "MCP entry function", "mcp_main")
  .option("--name <display>", "Optional display name")
  .action(async (opts) => {
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
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

program
  .command("add-remote")
  .requiredOption("--endpoint <url>", "Remote MCP URL")
  .requiredOption("--module <name>", "Logical module name")
  .option("--name <display>", "Optional display name")
  .action(async (opts) => {
    const daemon = program.opts<{ daemonUrl: string }>().daemonUrl;
    const manifest = remoteManifest({
      endpoint: opts.endpoint,
      module: opts.module,
      displayName: opts.name
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
