import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function upsertTomlMcp(filePath: string, serverName: string, command: string, args: string[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let content = "";
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

  let data: Record<string, unknown> = {};
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
