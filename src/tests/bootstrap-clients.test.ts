import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bootstrapCodex,
  codexBootstrapStatus,
  unbootstrapClaude,
  unbootstrapCodex,
  upsertWorkspaceAgentsDefaults
} from "../pkg/bootstrap/clients.js";

test("bootstrapCodex replaces existing clarity_gateway blocks with a single updated block", async () => {
  const originalHome = process.env.HOME;
  const tmpHome = await mkdtemp(path.join(os.tmpdir(), "clarity-bootstrap-home-"));
  process.env.HOME = tmpHome;

  try {
    const codexDir = path.join(tmpHome, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      configPath,
      [
        'model = "gpt-5.3-codex"',
        "",
        "[mcp_servers.clarity_gateway]",
        'command = "clarityctl"',
        'args = ["gateway", "serve", "--stdio"]',
        "",
        "[mcp_servers.other]",
        'url = "http://example.com/mcp"',
        "",
        "[mcp_servers.clarity_gateway]",
        'url = "http://old.local/mcp"'
      ].join("\n"),
      "utf8"
    );

    await bootstrapCodex({ transport: "http", endpoint: "http://localhost:4707/mcp" });

    const content = await readFile(configPath, "utf8");
    const matches = content.match(/\[mcp_servers\.clarity_gateway\]/g) ?? [];
    assert.equal(matches.length, 1);
    assert.match(content, /\[mcp_servers\.clarity_gateway\]\nurl = "http:\/\/localhost:4707\/mcp"/);
    assert.match(content, /\[mcp_servers\.other\]\nurl = "http:\/\/example.com\/mcp"/);

  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tmpHome, { recursive: true, force: true });
  }
});

test("unbootstrapCodex and unbootstrapClaude remove clarity_gateway while preserving other config", async () => {
  const originalHome = process.env.HOME;
  const tmpHome = await mkdtemp(path.join(os.tmpdir(), "clarity-unbootstrap-home-"));
  process.env.HOME = tmpHome;

  try {
    const codexDir = path.join(tmpHome, ".codex");
    const codexConfigPath = path.join(codexDir, "config.toml");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      codexConfigPath,
      [
        'model = "gpt-5.3-codex"',
        "",
        "[mcp_servers.clarity_gateway]",
        'url = "http://localhost:4707/mcp"',
        "",
        "[mcp_servers.keep_me]",
        'url = "http://example.com/mcp"'
      ].join("\n"),
      "utf8"
    );

    const claudeConfigPath = path.join(tmpHome, ".claude.json");
    await writeFile(
      claudeConfigPath,
      `${JSON.stringify({
        mcpServers: {
          clarity_gateway: { transport: "http", url: "http://localhost:4707/mcp" },
          keep_me: { command: "foo", args: ["bar"] }
        },
        theme: "light"
      }, null, 2)}\n`,
      "utf8"
    );

    const codexOut = await unbootstrapCodex();
    const claudeOut = await unbootstrapClaude();
    assert.equal(codexOut.updated, true);
    assert.equal(claudeOut.updated, true);

    const codexContent = await readFile(codexConfigPath, "utf8");
    assert.doesNotMatch(codexContent, /\[mcp_servers\.clarity_gateway\]/);
    assert.match(codexContent, /\[mcp_servers\.keep_me\]/);

    const claudeContent = JSON.parse(await readFile(claudeConfigPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
      theme?: string;
    };
    assert.equal(claudeContent.theme, "light");
    assert.ok(claudeContent.mcpServers);
    assert.ok(!Object.prototype.hasOwnProperty.call(claudeContent.mcpServers, "clarity_gateway"));
    assert.ok(Object.prototype.hasOwnProperty.call(claudeContent.mcpServers, "keep_me"));
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tmpHome, { recursive: true, force: true });
  }
});

test("codexBootstrapStatus uses the latest clarity_gateway block and accepts endpoint key", async () => {
  const originalHome = process.env.HOME;
  const tmpHome = await mkdtemp(path.join(os.tmpdir(), "clarity-status-home-"));
  process.env.HOME = tmpHome;

  try {
    const codexDir = path.join(tmpHome, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      configPath,
      [
        "[mcp_servers.clarity_gateway]",
        'command = "clarityctl"',
        'args = ["gateway", "serve", "--stdio"]',
        "",
        "[mcp_servers.clarity_gateway]",
        'transport = "streamable_http"',
        'endpoint = "http://127.0.0.1:4707/mcp"'
      ].join("\n"),
      "utf8"
    );

    const status = await codexBootstrapStatus();
    assert.equal(status.configured, true);
    assert.equal(status.transport, "http");
    assert.equal(status.endpoint, "http://127.0.0.1:4707/mcp");
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tmpHome, { recursive: true, force: true });
  }
});

test("upsertWorkspaceAgentsDefaults is idempotent and preserves non-managed AGENTS.md content", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "clarity-agents-md-"));
  const agentsPath = path.join(tmpRoot, "AGENTS.md");
  try {
    await writeFile(
      agentsPath,
      ["# Team Instructions", "", "- Keep existing conventions.", "", "## Notes", "- Do not remove."].join("\n"),
      "utf8"
    );

    const first = await upsertWorkspaceAgentsDefaults(tmpRoot);
    assert.equal(first.updated, true);
    const afterFirst = await readFile(agentsPath, "utf8");
    assert.match(afterFirst, /# Team Instructions/);
    assert.match(afterFirst, /Keep existing conventions/);
    assert.match(afterFirst, /clarity-runtime:managed:clarity-defaults:start/);
    assert.match(afterFirst, /Default language for this workspace: Clarity/);

    const second = await upsertWorkspaceAgentsDefaults(tmpRoot);
    assert.equal(second.updated, false);
    const afterSecond = await readFile(agentsPath, "utf8");
    assert.equal(afterSecond, afterFirst);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
