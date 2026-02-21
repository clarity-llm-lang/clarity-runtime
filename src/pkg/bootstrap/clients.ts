import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function upsertTomlMcp(filePath: string, serverName: string, command: string, args: string[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    content = "";
  }

  const block = `[mcp_servers.${serverName}]\ncommand = \"${command}\"\nargs = [${args.map((a) => `\"${a}\"`).join(", ")}]\n`;
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

export async function bootstrapCodex(command: string, args: string[]): Promise<{ updated: boolean; path: string }> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  await upsertTomlMcp(configPath, "clarity_gateway", command, args);
  return { updated: true, path: configPath };
}

export async function bootstrapClaude(command: string, args: string[]): Promise<{ updated: boolean; path: string }> {
  const configPath = path.join(os.homedir(), ".claude.json");
  await mkdir(path.dirname(configPath), { recursive: true });

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    data = {};
  }

  const mcpServers = (data.mcpServers as Record<string, unknown> | undefined) ?? {};
  mcpServers.clarity_gateway = {
    command,
    args
  };
  data.mcpServers = mcpServers;

  await writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { updated: true, path: configPath };
}

export interface BootstrapClientStatus {
  client: "codex" | "claude";
  path: string;
  configured: boolean;
  command?: string;
  args?: string[];
}

export async function codexBootstrapStatus(): Promise<BootstrapClientStatus> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  try {
    const content = await readFile(configPath, "utf8");
    const blockPattern = /\[mcp_servers\.clarity_gateway\][\s\S]*?(?=\n\[|$)/m;
    const block = content.match(blockPattern)?.[0] ?? "";
    const command = block.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
    const argsRaw = block.match(/^\s*args\s*=\s*\[([^\]]*)\]/m)?.[1];
    const args = argsRaw
      ? argsRaw.split(",").map((v) => v.trim().replace(/^"|"$/g, "")).filter(Boolean)
      : [];
    return {
      client: "codex",
      path: configPath,
      configured: block.length > 0,
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
    const command = typeof entry?.command === "string" ? entry.command : undefined;
    const args = Array.isArray(entry?.args) ? entry.args.filter((v): v is string => typeof v === "string") : [];
    return {
      client: "claude",
      path: configPath,
      configured: !!entry,
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
