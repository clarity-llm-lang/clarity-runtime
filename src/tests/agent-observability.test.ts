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

test("ServiceManager summarizes agent runs from durable events", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-summary-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();

  try {
    manager.recordRuntimeEvent({
      kind: "agent.run_created",
      level: "info",
      message: "Run created",
      data: { runId: "run-1", agent: "planner" }
    });
    manager.recordRuntimeEvent({
      kind: "agent.run_started",
      level: "info",
      message: "Run started",
      data: { runId: "run-1", agent: "planner" }
    });
    manager.recordRuntimeEvent({
      kind: "agent.step_started",
      level: "info",
      message: "Step 1",
      data: { runId: "run-1", stepId: "s1", agent: "planner" }
    });
    manager.recordRuntimeEvent({
      kind: "agent.tool_called",
      level: "info",
      message: "Called clarity__sources",
      data: { runId: "run-1", stepId: "s1", agent: "planner" }
    });
    manager.recordRuntimeEvent({
      kind: "agent.handoff",
      level: "info",
      message: "Handoff to writer",
      data: { runId: "run-1", agent: "planner", to: "writer" }
    });
    manager.recordRuntimeEvent({
      kind: "agent.run_completed",
      level: "info",
      message: "Run completed",
      data: { runId: "run-1", agent: "planner" }
    });

    manager.recordRuntimeEvent({
      kind: "agent.run_started",
      level: "info",
      message: "Run started",
      data: { runId: "run-2", agent: "reviewer" }
    });
    manager.recordRuntimeEvent({
      kind: "agent.run_failed",
      level: "error",
      message: "Run failed",
      data: { runId: "run-2", agent: "reviewer", error: "timeout" }
    });

    const events = manager.getRecentAgentEvents(20);
    assert.ok(events.length >= 8);
    assert.ok(events.every((event) => event.kind.startsWith("agent.")));

    const runs = manager.getAgentRuns(10);
    const run1 = runs.find((run) => run.runId === "run-1");
    assert.ok(run1);
    assert.equal(run1?.status, "completed");
    assert.equal(run1?.stepCount, 1);
    assert.equal(run1?.toolCallCount, 1);
    assert.equal(run1?.handoffCount, 1);

    const run2 = runs.find((run) => run.runId === "run-2");
    assert.ok(run2);
    assert.equal(run2?.status, "failed");
    assert.equal(run2?.failureReason, "timeout");
  } finally {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("agent HTTP endpoints accept events and return run timeline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-http-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const ingest = await jsonRequest(runtime.baseUrl, "/api/agents/events", {
      method: "POST",
      body: JSON.stringify({
        kind: "agent.run_started",
        message: "Runtime started run",
        run_id: "run-http-1",
        agent: "coordinator"
      })
    });
    assert.equal(ingest.status, 200);
    assert.equal(Boolean(asObject(ingest.body).ok), true);

    const ingestStep = await jsonRequest(runtime.baseUrl, "/api/agents/events", {
      method: "POST",
      body: JSON.stringify({
        kind: "agent.step_started",
        message: "Step A",
        runId: "run-http-1",
        stepId: "a",
        agent: "coordinator"
      })
    });
    assert.equal(ingestStep.status, 200);

    const runs = await jsonRequest(runtime.baseUrl, "/api/agents/runs?limit=20");
    assert.equal(runs.status, 200);
    const runItems = asObject(runs.body).items as Array<Record<string, unknown>>;
    assert.ok(runItems.some((item) => String(item.runId) === "run-http-1"));

    const runEvents = await jsonRequest(runtime.baseUrl, "/api/agents/runs/run-http-1/events?limit=20");
    assert.equal(runEvents.status, 200);
    const eventItems = asObject(runEvents.body).items as Array<Record<string, unknown>>;
    assert.ok(eventItems.length >= 2);
    assert.ok(eventItems.every((item) => String(item.kind).startsWith("agent.")));
  } finally {
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
