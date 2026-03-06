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

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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

function parseMcpToolPayload(body: unknown): Record<string, unknown> {
  const result = asObject(asObject(body).result);
  const content = Array.isArray(result.content) ? result.content : [];
  const first = content[0];
  if (!first || typeof first !== "object") {
    return {};
  }
  const text = String((first as { text?: unknown }).text ?? "");
  if (!text) {
    return {};
  }
  try {
    return asObject(JSON.parse(text));
  } catch {
    return {};
  }
}

test("gateway exposes trace spans and run cost ledger for MCP tool calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-gateway-trace-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const call = await jsonRequest(runtime.baseUrl, "/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "runtime__status_summary",
          arguments: {
            run_id: "run-trace-1",
            provider: "openai",
            model: "gpt-4o-mini"
          }
        }
      })
    });
    assert.equal(call.status, 200);
    assert.ok(asObject(call.body).result);
    const statusPayload = parseMcpToolPayload(call.body);
    assert.equal(Number(statusPayload.local_mcp), 0);
    assert.equal(Number(statusPayload.remote_mcp), 0);
    assert.equal(Number(statusPayload.local_agent), 0);
    assert.equal(Number(statusPayload.remote_agent), 0);
    assert.equal(Number(statusPayload.local), 0);
    assert.equal(Number(statusPayload.remote), 0);

    const httpStatus = await jsonRequest(runtime.baseUrl, "/api/status");
    assert.equal(httpStatus.status, 200);
    const httpSummary = asObject(asObject(httpStatus.body).summary);
    assert.equal(Number(httpSummary.localMcp), 0);
    assert.equal(Number(httpSummary.remoteMcp), 0);
    assert.equal(Number(httpSummary.localAgent), 0);
    assert.equal(Number(httpSummary.remoteAgent), 0);
    assert.equal(Number(httpSummary.local), 0);
    assert.equal(Number(httpSummary.remote), 0);

    const traces = await jsonRequest(runtime.baseUrl, "/api/traces?run_id=run-trace-1&limit=50");
    assert.equal(traces.status, 200);
    const traceItems = asObject(traces.body).items as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(traceItems));
    assert.ok(traceItems.length > 0);
    assert.ok(traceItems.some((item) => String(item.spanKind) === "mcp.tools/call"));

    const costs = await jsonRequest(runtime.baseUrl, "/api/costs/runs?run_id=run-trace-1&limit=20");
    assert.equal(costs.status, 200);
    const costItems = asObject(costs.body).items as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(costItems));
    assert.ok(costItems.length > 0);
    assert.equal(String(costItems[0]?.runId), "run-trace-1");
    assert.ok(Number(costItems[0]?.totalToolCalls) >= 1);
  } finally {
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("gateway enforces max tool-call budget per run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-gateway-budget-"));
  const prevBudget = process.env.CLARITY_BUDGET_MAX_TOOL_CALLS_PER_RUN;
  process.env.CLARITY_BUDGET_MAX_TOOL_CALLS_PER_RUN = "1";
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const first = await jsonRequest(runtime.baseUrl, "/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "runtime__status_summary",
          arguments: {
            run_id: "run-budget-1"
          }
        }
      })
    });
    assert.equal(first.status, 200);
    assert.ok(asObject(first.body).result);

    const second = await jsonRequest(runtime.baseUrl, "/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "runtime__status_summary",
          arguments: {
            run_id: "run-budget-1"
          }
        }
      })
    });
    assert.equal(second.status, 200);
    const secondError = asObject(second.body).error;
    assert.ok(secondError && typeof secondError === "object");
    assert.equal(Number(asObject(secondError).code), -32002);

    const costs = await jsonRequest(runtime.baseUrl, "/api/costs/runs?run_id=run-budget-1&limit=20");
    assert.equal(costs.status, 200);
    const costItems = asObject(costs.body).items as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(costItems));
    assert.ok(costItems.length > 0);
    assert.match(String(costItems[0]?.blockedReason || ""), /max tool calls per run exceeded/);
  } finally {
    if (prevBudget === undefined) {
      delete process.env.CLARITY_BUDGET_MAX_TOOL_CALLS_PER_RUN;
    } else {
      process.env.CLARITY_BUDGET_MAX_TOOL_CALLS_PER_RUN = prevBudget;
    }
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
