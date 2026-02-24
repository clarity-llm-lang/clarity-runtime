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

async function collectSseEvents(
  baseUrl: string,
  pathname: string,
  targetCount: number,
  options: {
    timeoutMs?: number;
    onOpen?: () => Promise<void>;
  } = {}
): Promise<Array<Record<string, unknown>>> {
  const controller = new AbortController();
  const timeoutMs = Math.max(200, options.timeoutMs ?? 2000);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      accept: "text/event-stream"
    },
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  const body = response.body;
  if (!body) {
    throw new Error("missing SSE response body");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const out: Array<Record<string, unknown>> = [];
  let buffer = "";
  let dataLines: string[] = [];

  const flush = (): void => {
    if (dataLines.length === 0) {
      return;
    }
    const payload = dataLines.join("\n");
    dataLines = [];
    try {
      const event = JSON.parse(payload) as unknown;
      if (event && typeof event === "object") {
        out.push(event as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed JSON events.
    }
  };

  try {
    if (options.onOpen) {
      await options.onOpen();
    }
    while (out.length < targetCount) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length === 0) {
          flush();
          if (out.length >= targetCount) {
            controller.abort();
            break;
          }
          continue;
        }
        if (line.startsWith(":")) {
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
  } catch (error) {
    const isAbortError =
      error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError";
    if (!(isAbortError && controller.signal.aborted)) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    reader.releaseLock();
  }

  if (timedOut && out.length < targetCount) {
    assert.fail(`timed out waiting for ${targetCount} SSE events (received ${out.length})`);
  }

  return out;
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
      kind: "agent.waiting",
      level: "info",
      message: "Waiting for approval",
      data: { runId: "run-1", agent: "planner", reason: "needs human approval" }
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
    assert.equal(run1?.trigger, "a2a");
    assert.equal(run1?.waitingReason, undefined);

    const run2 = runs.find((run) => run.runId === "run-2");
    assert.ok(run2);
    assert.equal(run2?.status, "failed");
    assert.equal(run2?.failureReason, "timeout");
    assert.equal(run2?.trigger, "unknown");
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

    const hitl = await jsonRequest(runtime.baseUrl, "/api/agents/runs/run-http-1/hitl", {
      method: "POST",
      body: JSON.stringify({
        message: `token=abc123 bearer sk-abcdef1234567890 ${"x".repeat(2600)}`
      })
    });
    assert.equal(hitl.status, 200);
    const hitlBody = asObject(hitl.body);
    assert.equal(Boolean(hitlBody.ok), true);
    assert.equal(Boolean(hitlBody.message_truncated), true);
    assert.equal(Boolean(hitlBody.message_redacted), true);

    const runEventsAfterHitl = await jsonRequest(runtime.baseUrl, "/api/agents/runs/run-http-1/events?limit=30");
    assert.equal(runEventsAfterHitl.status, 200);
    const hitlItems = asObject(runEventsAfterHitl.body).items as Array<Record<string, unknown>>;
    const latestHitl = hitlItems.find((item) => String(item.kind) === "agent.hitl_input");
    assert.ok(latestHitl);
    const latestHitlData = asObject(latestHitl?.data);
    assert.equal(typeof latestHitlData.message, "string");
    assert.ok(String(latestHitlData.message).length <= 2000);
    assert.match(String(latestHitlData.message), /\[REDACTED\]/);
    assert.equal(Boolean(latestHitlData.messageTruncated), true);
    assert.equal(Boolean(latestHitlData.messageRedacted), true);

    const completeRun = await jsonRequest(runtime.baseUrl, "/api/agents/events", {
      method: "POST",
      body: JSON.stringify({
        kind: "agent.run_completed",
        message: "Run completed",
        runId: "run-http-1",
        agent: "coordinator"
      })
    });
    assert.equal(completeRun.status, 200);

    const hitlAfterCompletion = await jsonRequest(runtime.baseUrl, "/api/agents/runs/run-http-1/hitl", {
      method: "POST",
      body: JSON.stringify({
        message: "approve after completion"
      })
    });
    assert.equal(hitlAfterCompletion.status, 409);
    assert.equal(String(asObject(hitlAfterCompletion.body).status), "completed");
  } finally {
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("run-scoped agent events stream replays history and streams live updates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-run-stream-http-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const startRun = await jsonRequest(runtime.baseUrl, "/api/agents/events", {
      method: "POST",
      body: JSON.stringify({
        kind: "agent.run_started",
        message: "Run started",
        runId: "run-stream-1",
        agent: "coordinator"
      })
    });
    assert.equal(startRun.status, 200);

    const streamEvents = await collectSseEvents(
      runtime.baseUrl,
      "/api/agents/runs/run-stream-1/events/stream?limit=20",
      2,
      {
        onOpen: async () => {
          const wrongRunEvent = await jsonRequest(runtime.baseUrl, "/api/agents/events", {
            method: "POST",
            body: JSON.stringify({
              kind: "agent.step_started",
              message: "Other run step",
              runId: "run-other-1",
              stepId: "x",
              agent: "coordinator"
            })
          });
          assert.equal(wrongRunEvent.status, 200);

          const sameRunEvent = await jsonRequest(runtime.baseUrl, "/api/agents/events", {
            method: "POST",
            body: JSON.stringify({
              kind: "agent.step_started",
              message: "Current run step",
              runId: "run-stream-1",
              stepId: "a",
              agent: "coordinator"
            })
          });
          assert.equal(sameRunEvent.status, 200);
        }
      }
    );

    assert.equal(streamEvents.length, 2);
    assert.equal(String(streamEvents[0]?.kind), "agent.run_started");
    assert.equal(String(streamEvents[1]?.kind), "agent.step_started");

    const firstData = asObject(streamEvents[0]?.data);
    const secondData = asObject(streamEvents[1]?.data);
    assert.equal(String(firstData.runId), "run-stream-1");
    assert.equal(String(secondData.runId), "run-stream-1");
  } finally {
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("agent registry endpoint returns only registered agent services", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-registry-http-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const applyMcp = await jsonRequest(runtime.baseUrl, "/api/services/apply", {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          apiVersion: "clarity.runtime/v1",
          kind: "MCPService",
          metadata: {
            sourceFile: path.join(root, "mcp-source.clarity"),
            module: "McpSource",
            serviceType: "mcp"
          },
          spec: {
            origin: {
              type: "local_wasm",
              wasmPath: path.join(root, "mcp.wasm"),
              entry: "main"
            },
            enabled: true,
            autostart: false,
            restartPolicy: {
              mode: "never",
              maxRestarts: 0,
              windowSeconds: 60
            },
            policyRef: "default"
          }
        }
      })
    });
    assert.equal(applyMcp.status, 200);

    const applyAgent = await jsonRequest(runtime.baseUrl, "/api/services/apply", {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          apiVersion: "clarity.runtime/v1",
          kind: "MCPService",
          metadata: {
            sourceFile: path.join(root, "agent-source.clarity"),
            module: "AgentSource",
            serviceType: "agent",
            agent: {
              agentId: "planner_agent",
              name: "Planner Agent",
              role: "planner",
              objective: "Plan and hand off tasks",
              triggers: ["timer", "a2a"],
              a2a: {
                protocol: "clarity.a2a.v1",
                acceptedMessageKinds: ["handoff.request", "handoff.accepted", "handoff.rejected", "handoff.completed"],
                emitsMessageKinds: ["handoff.request", "handoff.accepted", "handoff.rejected", "handoff.completed"]
              },
              handoffTargets: ["writer_agent"]
            }
          },
          spec: {
            origin: {
              type: "local_wasm",
              wasmPath: path.join(root, "agent.wasm"),
              entry: "main"
            },
            enabled: true,
            autostart: false,
            restartPolicy: {
              mode: "never",
              maxRestarts: 0,
              windowSeconds: 60
            },
            policyRef: "default"
          }
        }
      })
    });
    assert.equal(applyAgent.status, 200);

    const registryRes = await jsonRequest(runtime.baseUrl, "/api/agents/registry");
    assert.equal(registryRes.status, 200);
    const body = asObject(registryRes.body);
    const items = body.items as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(items));
    assert.equal(Number(body.count), 1);
    assert.equal(items.length, 1);
    assert.equal(String(items[0]?.serviceType), "agent");
    assert.equal(String(asObject(items[0]?.agent).agentId), "planner_agent");
    assert.deepEqual(asObject(items[0]?.agent).triggers, ["timer", "a2a"]);
  } finally {
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a2a capabilities endpoint lists only compliant a2a-enabled agents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-a2a-capabilities-http-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const applyAgent = await jsonRequest(runtime.baseUrl, "/api/services/apply", {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          apiVersion: "clarity.runtime/v1",
          kind: "MCPService",
          metadata: {
            sourceFile: path.join(root, "a2a-agent-source.clarity"),
            module: "A2AAgentSource",
            serviceType: "agent",
            agent: {
              agentId: "writer_agent",
              name: "Writer Agent",
              role: "writer",
              objective: "Receive handoff and produce outputs",
              triggers: ["a2a"],
              a2a: {
                protocol: "clarity.a2a.v1",
                acceptedMessageKinds: ["handoff.request", "handoff.accepted", "handoff.rejected", "handoff.completed"],
                emitsMessageKinds: ["handoff.request", "handoff.accepted", "handoff.rejected", "handoff.completed"]
              }
            }
          },
          spec: {
            origin: {
              type: "local_wasm",
              wasmPath: path.join(root, "a2a-agent.wasm"),
              entry: "main"
            },
            enabled: true,
            autostart: false,
            restartPolicy: {
              mode: "never",
              maxRestarts: 0,
              windowSeconds: 60
            },
            policyRef: "default"
          }
        }
      })
    });
    assert.equal(applyAgent.status, 200);

    const caps = await jsonRequest(runtime.baseUrl, "/api/a2a/capabilities");
    assert.equal(caps.status, 200);
    const body = asObject(caps.body);
    assert.equal(String(body.protocol), "clarity.a2a.v1");
    assert.equal(String(body.ingestPath), "/api/a2a/messages");
    assert.equal(Number(body.count), 1);
    const items = body.items as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(items));
    assert.equal(items.length, 1);
    assert.equal(String(items[0]?.agentId), "writer_agent");
    assert.equal(Boolean(items[0]?.compliant), true);
  } finally {
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a2a messages endpoint validates envelope and emits canonical agent events", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-a2a-messages-http-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const applySource = await jsonRequest(runtime.baseUrl, "/api/services/apply", {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          apiVersion: "clarity.runtime/v1",
          kind: "MCPService",
          metadata: {
            sourceFile: path.join(root, "source-agent-source.clarity"),
            module: "SourceAgent",
            serviceType: "agent",
            agent: {
              agentId: "planner_agent",
              name: "Planner Agent",
              role: "planner",
              objective: "Create handoff requests",
              triggers: ["a2a"],
              a2a: {
                protocol: "clarity.a2a.v1",
                acceptedMessageKinds: ["handoff.request", "handoff.accepted", "handoff.rejected", "handoff.completed"],
                emitsMessageKinds: ["handoff.request", "handoff.accepted", "handoff.rejected", "handoff.completed"]
              }
            }
          },
          spec: {
            origin: {
              type: "local_wasm",
              wasmPath: path.join(root, "source-agent.wasm"),
              entry: "main"
            },
            enabled: true,
            autostart: false,
            restartPolicy: {
              mode: "never",
              maxRestarts: 0,
              windowSeconds: 60
            },
            policyRef: "default"
          }
        }
      })
    });
    assert.equal(applySource.status, 200);
    const sourceServiceId = String(
      asObject(
        asObject(
          asObject(asObject(applySource.body).service).manifest
        ).metadata
      ).serviceId || ""
    );
    assert.ok(sourceServiceId.length > 0);

    const applyTarget = await jsonRequest(runtime.baseUrl, "/api/services/apply", {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          apiVersion: "clarity.runtime/v1",
          kind: "MCPService",
          metadata: {
            sourceFile: path.join(root, "target-agent-source.clarity"),
            module: "TargetAgent",
            serviceType: "agent",
            agent: {
              agentId: "writer_agent",
              name: "Writer Agent",
              role: "writer",
              objective: "Receive handoff",
              triggers: ["a2a"],
              a2a: {
                protocol: "clarity.a2a.v1",
                acceptedMessageKinds: ["handoff.request", "handoff.accepted", "handoff.rejected", "handoff.completed"],
                emitsMessageKinds: ["handoff.request", "handoff.accepted", "handoff.rejected", "handoff.completed"]
              }
            }
          },
          spec: {
            origin: {
              type: "local_wasm",
              wasmPath: path.join(root, "target-agent.wasm"),
              entry: "main"
            },
            enabled: true,
            autostart: false,
            restartPolicy: {
              mode: "never",
              maxRestarts: 0,
              windowSeconds: 60
            },
            policyRef: "default"
          }
        }
      })
    });
    assert.equal(applyTarget.status, 200);
    const targetServiceId = String(
      asObject(
        asObject(
          asObject(asObject(applyTarget.body).service).manifest
        ).metadata
      ).serviceId || ""
    );
    assert.ok(targetServiceId.length > 0);

    const postA2A = await jsonRequest(runtime.baseUrl, "/api/a2a/messages", {
      method: "POST",
      body: JSON.stringify({
        protocol: "clarity.a2a.v1",
        kind: "handoff.request",
        messageId: "msg-1",
        sentAt: "2026-02-24T12:00:00.000Z",
        from: {
          agentId: "planner_agent",
          serviceId: sourceServiceId
        },
        to: {
          agentId: "writer_agent",
          serviceId: targetServiceId
        },
        context: {
          runId: "run-a2a-1",
          parentRunId: "run-parent-1",
          handoffReason: "compose-release-notes",
          correlationId: "corr-1"
        },
        payload: {
          ticket: "REL-1"
        }
      })
    });
    assert.equal(postA2A.status, 202);
    assert.equal(Boolean(asObject(postA2A.body).ok), true);

    const runs = await jsonRequest(runtime.baseUrl, "/api/agents/runs?limit=30");
    assert.equal(runs.status, 200);
    const runItems = asObject(runs.body).items as Array<Record<string, unknown>>;
    const run = runItems.find((item) => String(item.runId) === "run-a2a-1");
    assert.ok(run);
    assert.equal(String(run?.trigger), "a2a");
    assert.equal(String(run?.parentRunId), "run-parent-1");
    assert.equal(String(run?.fromAgentId), "planner_agent");

    const runEvents = await jsonRequest(runtime.baseUrl, "/api/agents/runs/run-a2a-1/events?limit=40");
    assert.equal(runEvents.status, 200);
    const eventItems = asObject(runEvents.body).items as Array<Record<string, unknown>>;
    assert.ok(eventItems.some((item) => String(item.kind) === "agent.run_created"));
    assert.ok(eventItems.some((item) => String(item.kind) === "agent.handoff"));

    const duplicateA2A = await jsonRequest(runtime.baseUrl, "/api/a2a/messages", {
      method: "POST",
      body: JSON.stringify({
        protocol: "clarity.a2a.v1",
        kind: "handoff.request",
        messageId: "msg-1",
        sentAt: "2026-02-24T12:00:01.000Z",
        from: {
          agentId: "planner_agent",
          serviceId: sourceServiceId
        },
        to: {
          agentId: "writer_agent",
          serviceId: targetServiceId
        },
        context: {
          runId: "run-a2a-1",
          parentRunId: "run-parent-1",
          handoffReason: "compose-release-notes"
        }
      })
    });
    assert.equal(duplicateA2A.status, 409);
  } finally {
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("agent.run_created validates trigger context contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-trigger-validation-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const bad = await jsonRequest(runtime.baseUrl, "/api/agents/events", {
      method: "POST",
      body: JSON.stringify({
        kind: "agent.run_created",
        message: "Missing trigger context",
        runId: "run-trigger-bad",
        agent: "planner",
        data: {
          trigger: "api",
          route: "/api/agents/start"
        }
      })
    });
    assert.equal(bad.status, 400);

    const good = await jsonRequest(runtime.baseUrl, "/api/agents/events", {
      method: "POST",
      body: JSON.stringify({
        kind: "agent.run_created",
        message: "Valid trigger context",
        runId: "run-trigger-good",
        agent: "planner",
        data: {
          trigger: "api",
          route: "/api/agents/start",
          method: "POST",
          requestId: "req-1",
          caller: "ui"
        }
      })
    });
    assert.equal(good.status, 200);

    const runs = await jsonRequest(runtime.baseUrl, "/api/agents/runs?limit=20");
    assert.equal(runs.status, 200);
    const runItems = asObject(runs.body).items as Array<Record<string, unknown>>;
    const found = runItems.find((item) => String(item.runId) === "run-trigger-good");
    assert.ok(found);
    assert.equal(String(found?.trigger), "api");
  } finally {
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("HITL broker endpoints support question-answer lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-hitl-broker-http-"));
  const registry = new ServiceRegistry(path.join(root, "registry.json"));
  await registry.init();
  const manager = new ServiceManager(registry, path.join(root, "telemetry.json"));
  await manager.init();
  const authConfig: AuthConfig = {
    enforceLoopbackWhenNoToken: true
  };
  const prevHitlDir = process.env.CLARITY_HITL_DIR;
  process.env.CLARITY_HITL_DIR = path.join(root, "hitl");
  const runtime = await startServer((req, res) => handleHttp(manager, req, res, authConfig));

  try {
    const create = await jsonRequest(runtime.baseUrl, "/questions", {
      method: "POST",
      body: JSON.stringify({
        key: "review-step-3",
        question: "Does this summary look correct?",
        timestamp: Date.now()
      })
    });
    assert.equal(create.status, 200);

    const listPending = await jsonRequest(runtime.baseUrl, "/questions");
    assert.equal(listPending.status, 200);
    const pending = listPending.body as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(pending));
    assert.ok(pending.some((row) => String(row.key) === "review-step-3"));

    const pendingState = await jsonRequest(runtime.baseUrl, "/questions/review-step-3");
    assert.equal(pendingState.status, 200);
    assert.equal(String(asObject(pendingState.body).status), "pending");

    const answer = await jsonRequest(runtime.baseUrl, "/answer", {
      method: "POST",
      body: JSON.stringify({
        key: "review-step-3",
        response: "Looks good, proceed"
      })
    });
    assert.equal(answer.status, 200);

    const answeredState = await jsonRequest(runtime.baseUrl, "/questions/review-step-3");
    assert.equal(answeredState.status, 200);
    assert.equal(String(asObject(answeredState.body).status), "answered");
    assert.equal(String(asObject(answeredState.body).response), "Looks good, proceed");

    const cancel = await jsonRequest(runtime.baseUrl, "/cancel", {
      method: "POST",
      body: JSON.stringify({
        key: "review-step-3"
      })
    });
    assert.equal(cancel.status, 200);

    const missingState = await jsonRequest(runtime.baseUrl, "/questions/review-step-3");
    assert.equal(missingState.status, 200);
    assert.equal(String(asObject(missingState.body).status), "missing");
  } finally {
    if (prevHitlDir === undefined) {
      delete process.env.CLARITY_HITL_DIR;
    } else {
      process.env.CLARITY_HITL_DIR = prevHitlDir;
    }
    await manager.shutdown();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
