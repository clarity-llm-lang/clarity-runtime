import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type BootstrapTransport = "stdio" | "http";

export interface BootstrapOptions {
  transport: BootstrapTransport;
  command?: string;
  args?: string[];
  endpoint?: string;
}

const AGENTS_MANAGED_START = "<!-- clarity-runtime:managed:clarity-defaults:start -->";
const AGENTS_MANAGED_END = "<!-- clarity-runtime:managed:clarity-defaults:end -->";

function buildAgentsManagedBlock(): string {
  return [
    AGENTS_MANAGED_START,
    "## Clarity Runtime Defaults",
    "- Default language for this workspace: Clarity.",
    "- If the user explicitly requests another language, follow that request.",
    "- Prefer Clarity-native scaffold/build/test flows before cross-language alternatives.",
    AGENTS_MANAGED_END,
    ""
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertManagedAgentsBlock(content: string): string {
  const managedBlock = buildAgentsManagedBlock();
  const pattern = new RegExp(`${escapeRegExp(AGENTS_MANAGED_START)}[\\s\\S]*?${escapeRegExp(AGENTS_MANAGED_END)}\\n?`, "m");
  if (pattern.test(content)) {
    const next = content.replace(pattern, managedBlock);
    return next.endsWith("\n") ? next : `${next}\n`;
  }
  const base = content.trimEnd();
  if (base.length === 0) {
    return managedBlock;
  }
  return `${base}\n\n${managedBlock}`;
}

export async function upsertWorkspaceAgentsDefaults(workspaceRoot = process.cwd()): Promise<{ updated: boolean; path: string }> {
  const agentsPath = path.join(workspaceRoot, "AGENTS.md");
  const content = await readFile(agentsPath, "utf8").catch(() => "");
  const next = upsertManagedAgentsBlock(content);
  if (next === content) {
    return { updated: false, path: agentsPath };
  }
  await mkdir(path.dirname(agentsPath), { recursive: true });
  await writeFile(agentsPath, next, "utf8");
  return { updated: true, path: agentsPath };
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
  const escapedServerName = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp(`(?:^|\\n)\\[mcp_servers\\.${escapedServerName}\\][\\s\\S]*?(?=\\n\\[|$)`, "g");
  const hadBlock = keyPattern.test(content);
  if (hadBlock) {
    content = content.replace(keyPattern, "");
  }
  const base = content.trimEnd();
  const separator = base.length > 0 ? "\n\n" : "";
  await writeFile(filePath, `${base}${separator}${block}`, "utf8");
}

async function removeTomlMcp(filePath: string, serverName: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return false;
  }

  const escapedServerName = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp(`(?:^|\\n)\\[mcp_servers\\.${escapedServerName}\\][\\s\\S]*?(?=\\n\\[|$)`, "g");
  const next = content.replace(keyPattern, "");
  if (next === content) {
    return false;
  }

  const normalized = next.replace(/\n{3,}/g, "\n\n").trimEnd();
  await writeFile(filePath, normalized.length > 0 ? `${normalized}\n` : "", "utf8");
  return true;
}

export async function bootstrapCodex(options: BootstrapOptions): Promise<{ updated: boolean; path: string }> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  await upsertTomlMcp(configPath, "clarity_gateway", options);
  return { updated: true, path: configPath };
}

export async function unbootstrapCodex(): Promise<{ updated: boolean; path: string }> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  const updated = await removeTomlMcp(configPath, "clarity_gateway");
  return { updated, path: configPath };
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

export async function unbootstrapClaude(): Promise<{ updated: boolean; path: string }> {
  const configPath = path.join(os.homedir(), ".claude.json");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return { updated: false, path: configPath };
  }

  const mcpServers = (data.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (!Object.prototype.hasOwnProperty.call(mcpServers, "clarity_gateway")) {
    return { updated: false, path: configPath };
  }
  delete mcpServers.clarity_gateway;
  if (Object.keys(mcpServers).length > 0) {
    data.mcpServers = mcpServers;
  } else {
    delete data.mcpServers;
  }
  await writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { updated: true, path: configPath };
}

export interface BootstrapClientStatus {
  client: "codex" | "claude";
  path: string;
  present?: boolean;
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
    const blockPattern = /\[mcp_servers\.clarity_gateway\][\s\S]*?(?=\n\[|$)/g;
    const blocks = [...content.matchAll(blockPattern)].map((m) => m[0]);
    const block = blocks.length > 0 ? blocks[blocks.length - 1] : "";
    const endpoint = block.match(/^\s*(?:url|endpoint)\s*=\s*"([^"]+)"/m)?.[1];
    const transportRaw = block.match(/^\s*transport\s*=\s*"([^"]+)"/m)?.[1]?.trim().toLowerCase();
    const transport =
      endpoint || transportRaw === "http" || transportRaw === "https" || transportRaw === "streamable_http"
        ? ("http" as const)
        : block.length > 0
          ? ("stdio" as const)
          : undefined;
    const command = block.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
    const argsRaw = block.match(/^\s*args\s*=\s*\[([^\]]*)\]/m)?.[1];
    const args = parseTomlStringArray(argsRaw);
    return {
      client: "codex",
      path: configPath,
      present: true,
      configured: block.length > 0,
      ...(transport ? { transport } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(command ? { command } : {}),
      ...(args.length > 0 ? { args } : {})
    };
  } catch {
    const present = await access(configPath).then(() => true).catch(() => false);
    return {
      client: "codex",
      path: configPath,
      present,
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
      present: true,
      configured: !!entry,
      ...(transport ? { transport } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(command ? { command } : {}),
      ...(args.length > 0 ? { args } : {})
    };
  } catch {
    const present = await access(configPath).then(() => true).catch(() => false);
    return {
      client: "claude",
      path: configPath,
      present,
      configured: false
    };
  }
}

export async function bootstrapStatus(): Promise<{ clients: BootstrapClientStatus[] }> {
  const [codex, claude] = await Promise.all([codexBootstrapStatus(), claudeBootstrapStatus()]);
  return { clients: [codex, claude] };
}
