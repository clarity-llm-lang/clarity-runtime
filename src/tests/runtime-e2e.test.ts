import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { handleHttp } from "../pkg/gateway/http-api.js";
import { ServiceRegistry } from "../pkg/registry/registry.js";
import { ServiceManager } from "../pkg/supervisor/service-manager.js";
import type { AuthConfig } from "../pkg/security/auth.js";

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve server address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function jsonRequest(baseUrl: string, pathname: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  return { status: res.status, body };
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as Record<string, unknown>;
}

test("runtime e2e API + MCP flow supports remote registration and deprovision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-runtime-e2e-"));
  const registryPath = path.join(root, "registry.json");
  const telemetryPath = path.join(root, "telemetry.json");
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };

  const remote = await startServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/mcp") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };

    const write = (value: unknown): void => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(`${JSON.stringify(value)}\n`);
    };

    if (!payload.id) {
      res.statusCode = 202;
      res.end();
      return;
    }

    if (payload.method === "initialize") {
      write({ jsonrpc: "2.0", id: payload.id, result: { protocolVersion: "2025-11-05", serverInfo: { name: "mock-remote", version: "1.0.0" }, capabilities: {} } });
      return;
    }
    if (payload.method === "tools/list") {
      write({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo input text",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                additionalProperties: false
              }
            }
          ]
        }
      });
      return;
    }
    if (payload.method === "resources/list") {
      write({ jsonrpc: "2.0", id: payload.id, result: { resources: [] } });
      return;
    }
    if (payload.method === "prompts/list") {
      write({ jsonrpc: "2.0", id: payload.id, result: { prompts: [] } });
      return;
    }
    if (payload.method === "tools/call") {
      const name = String(payload.params?.name ?? "");
      if (name !== "echo") {
        write({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "tool not found" } });
        return;
      }
      const args = asObject(payload.params?.arguments);
      write({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          content: [{ type: "text", text: `echo:${String(args.text ?? "")}` }]
        }
      });
      return;
    }

    write({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "method not found" } });
  });

  const registry = new ServiceRegistry(registryPath);
  await registry.init();
  const manager = new ServiceManager(registry, telemetryPath);
  await manager.init();
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const applyRes = await jsonRequest(runtime.baseUrl, "/api/services/apply", {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          apiVersion: "clarity.runtime/v1",
          kind: "MCPService",
          metadata: {
            sourceFile: `${remote.baseUrl}/mcp`,
            module: "EchoSvc"
          },
          spec: {
            origin: {
              type: "remote_mcp",
              endpoint: `${remote.baseUrl}/mcp`,
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
            toolNamespace: "echosvc"
          }
        }
      })
    });
    assert.equal(applyRes.status, 200);
    const appliedService = asObject(asObject(applyRes.body).service);
    const serviceId = String(asObject(appliedService.manifest).metadata ? asObject(asObject(appliedService.manifest).metadata).serviceId : "");
    assert.ok(serviceId.length > 0);

    const startRes = await jsonRequest(runtime.baseUrl, `/api/services/${encodeURIComponent(serviceId)}/start`, { method: "POST" });
    assert.equal(startRes.status, 200);
    const introspectRes = await jsonRequest(runtime.baseUrl, `/api/services/${encodeURIComponent(serviceId)}/introspect`, { method: "POST" });
    assert.equal(introspectRes.status, 200);

    const toolsListRes = await jsonRequest(runtime.baseUrl, "/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    assert.equal(toolsListRes.status, 200);
    const toolNames = (asObject(asObject(toolsListRes.body).result).tools as Array<Record<string, unknown>>).map((tool) => String(tool.name));
    assert.ok(toolNames.includes("echosvc__echo"));

    const callRes = await jsonRequest(runtime.baseUrl, "/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "echosvc__echo",
          arguments: { text: "hi" }
        }
      })
    });
    assert.equal(callRes.status, 200);
    const callContent = asObject(asObject(callRes.body).result).content as Array<Record<string, unknown>>;
    assert.equal(String(callContent[0].text), "echo:hi");

    const removeRes = await jsonRequest(runtime.baseUrl, `/api/services/${encodeURIComponent(serviceId)}`, {
      method: "DELETE",
      body: JSON.stringify({ cleanup_artifacts: false })
    });
    assert.equal(removeRes.status, 200);
    assert.equal(Boolean(asObject(removeRes.body).removed), true);

    const lookupRes = await jsonRequest(runtime.baseUrl, `/api/services/${encodeURIComponent(serviceId)}`);
    assert.equal(lookupRes.status, 404);
  } finally {
    await manager.shutdown();
    await runtime.close();
    await remote.close();
    await rm(root, { recursive: true, force: true });
  }
});
