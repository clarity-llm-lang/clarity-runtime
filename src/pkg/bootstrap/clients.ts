import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type BootstrapTransport = "stdio" | "http";

export interface BootstrapOptions {
  transport: BootstrapTransport;
  command?: string;
  args?: string[];
  endpoint?: string;
}

function parseTomlStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function buildTomlMcpBlock(serverName: string, options: BootstrapOptions): string {
  const lines = [`[mcp_servers.${serverName}]`];
  if (options.transport === "http") {
    lines.push(`url = "${options.endpoint}"`);
  } else {
    const args = options.args ?? [];
    lines.push(`command = "${options.command}"`);
    lines.push(`args = [${args.map((a) => `"${a}"`).join(", ")}]`);
  }
  return `${lines.join("\n")}\n`;
}

async function upsertTomlMcp(filePath: string, serverName: string, options: BootstrapOptions): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    content = "";
  }

  const block = buildTomlMcpBlock(serverName, options);
  const keyPattern = new RegExp(`\\[mcp_servers\\.${serverName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\][\\s\\S]*?(?=\\n\\[|$)`, "m");

  if (keyPattern.test(content)) {
    content = content.replace(keyPattern, block.trimEnd());
  } else {
    if (content.length && !content.endsWith("\n")) {
      content += "\n";
    }
    content += `\n${block}`;
  }

  await writeFile(filePath, content.trimStart() + "\n", "utf8");
}

export async function bootstrapCodex(options: BootstrapOptions): Promise<{ updated: boolean; path: string }> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  await upsertTomlMcp(configPath, "clarity_gateway", options);
  return { updated: true, path: configPath };
}

export async function bootstrapClaude(options: BootstrapOptions): Promise<{ updated: boolean; path: string }> {
  const configPath = path.join(os.homedir(), ".claude.json");
  await mkdir(path.dirname(configPath), { recursive: true });

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    data = {};
  }

  const mcpServers = (data.mcpServers as Record<string, unknown> | undefined) ?? {};
  mcpServers.clarity_gateway =
    options.transport === "http"
      ? {
          transport: "http",
          url: options.endpoint
        }
      : {
          command: options.command,
          args: options.args ?? []
        };
  data.mcpServers = mcpServers;

  await writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { updated: true, path: configPath };
}

export interface BootstrapClientStatus {
  client: "codex" | "claude";
  path: string;
  configured: boolean;
  transport?: BootstrapTransport;
  endpoint?: string;
  command?: string;
  args?: string[];
}

export async function codexBootstrapStatus(): Promise<BootstrapClientStatus> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  try {
    const content = await readFile(configPath, "utf8");
    const blockPattern = /\[mcp_servers\.clarity_gateway\][\s\S]*?(?=\n\[|$)/m;
    const block = content.match(blockPattern)?.[0] ?? "";
    const endpoint = block.match(/^\s*url\s*=\s*"([^"]+)"/m)?.[1];
    const command = block.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
    const argsRaw = block.match(/^\s*args\s*=\s*\[([^\]]*)\]/m)?.[1];
    const args = parseTomlStringArray(argsRaw);
    return {
      client: "codex",
      path: configPath,
      configured: block.length > 0,
      ...(endpoint ? { transport: "http" as const, endpoint } : {}),
      ...(!endpoint ? { transport: "stdio" as const } : {}),
      ...(command ? { command } : {}),
      ...(args.length > 0 ? { args } : {})
    };
  } catch {
    return {
      client: "codex",
      path: configPath,
      configured: false
    };
  }
}

export async function claudeBootstrapStatus(): Promise<BootstrapClientStatus> {
  const configPath = path.join(os.homedir(), ".claude.json");
  try {
    const data = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    const mcpServers = (data.mcpServers as Record<string, unknown> | undefined) ?? {};
    const entry = mcpServers.clarity_gateway as Record<string, unknown> | undefined;
    const endpoint = typeof entry?.url === "string" ? entry.url : undefined;
    const transport =
      endpoint || entry?.transport === "http"
        ? ("http" as const)
        : entry
          ? ("stdio" as const)
          : undefined;
    const command = typeof entry?.command === "string" ? entry.command : undefined;
    const args = Array.isArray(entry?.args) ? entry.args.filter((v): v is string => typeof v === "string") : [];
    return {
      client: "claude",
      path: configPath,
      configured: !!entry,
      ...(transport ? { transport } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(command ? { command } : {}),
      ...(args.length > 0 ? { args } : {})
    };
  } catch {
    return {
      client: "claude",
      path: configPath,
      configured: false
    };
  }
}

export async function bootstrapStatus(): Promise<{ clients: BootstrapClientStatus[] }> {
  const [codex, claude] = await Promise.all([codexBootstrapStatus(), claudeBootstrapStatus()]);
  return { clients: [codex, claude] };
}
