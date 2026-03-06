import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "../pkg/rpc/manifest.js";

test("validateManifest accepts valid local_wasm manifest", () => {
  const manifest = validateManifest({
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/sample.clarity",
      module: "Sample",
      serviceType: "mcp"
    },
    spec: {
      origin: {
        type: "local_wasm",
        wasmPath: "/tmp/sample.wasm",
        entry: "mcp_main"
      },
      enabled: true,
      autostart: true,
      restartPolicy: {
        mode: "on-failure",
        maxRestarts: 5,
        windowSeconds: 60
      },
      policyRef: "default",
      toolNamespace: "sample"
    }
  });

  assert.equal(manifest.kind, "MCPService");
});

test("validateManifest rejects remote endpoint traversal/invalid URL", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "bad",
          module: "Bad",
          serviceType: "mcp"
        },
        spec: {
          origin: {
            type: "remote_mcp",
            endpoint: "file:///etc/passwd",
            transport: "streamable_http"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /valid http\(s\) URL/
  );
});

test("validateManifest accepts explicit metadata.serviceType=agent", () => {
  const manifest = validateManifest({
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/agent.clarity",
      module: "AgentSample",
      serviceType: "agent",
        agent: {
          agentId: "agent-sample",
          name: "Agent Sample",
          role: "coordinator",
          objective: "Coordinate downstream tools",
          triggers: ["api"],
          hitl: true,
          llmProviders: ["openai"],
          chat: {
            mode: "auto",
            provider: "openai",
            handlerTool: "fn__receive_chat",
            model: "gpt-4.1-mini",
            apiKeyEnv: "OPENAI_API_KEY",
            timeoutMs: 15000,
            historyEnabled: true,
            historyMaxTurns: 32,
            historyMaxChars: 16000
          }
        }
      },
    spec: {
      origin: {
        type: "local_wasm",
        wasmPath: "/tmp/agent.wasm",
        entry: "mcp_main"
      },
      enabled: true,
      autostart: true,
      restartPolicy: {
        mode: "on-failure",
        maxRestarts: 5,
        windowSeconds: 60
      },
      policyRef: "default"
    }
  });

  assert.equal(manifest.metadata.serviceType, "agent");
  assert.equal(manifest.metadata.agent?.agentId, "agent-sample");
  assert.equal(manifest.metadata.agent?.llmProviders?.[0], "openai");
  assert.equal(manifest.metadata.agent?.hitl, true);
  assert.equal(manifest.metadata.agent?.chat?.provider, "openai");
  assert.equal(manifest.metadata.agent?.chat?.handlerTool, "fn__receive_chat");
  assert.equal(manifest.metadata.agent?.chat?.historyEnabled, true);
  assert.equal(manifest.metadata.agent?.chat?.historyMaxTurns, 32);
  assert.equal(manifest.metadata.agent?.chat?.historyMaxChars, 16000);
});

test("validateManifest accepts metadata.agent.a2a profile when trigger includes a2a", () => {
  const manifest = validateManifest({
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/agent-a2a.clarity",
      module: "AgentA2A",
      serviceType: "agent",
      agent: {
        agentId: "agent-a2a",
        name: "Agent A2A",
        role: "worker",
        objective: "Receive A2A handoff",
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
        wasmPath: "/tmp/agent-a2a.wasm",
        entry: "mcp_main"
      },
      enabled: true,
      autostart: true,
      restartPolicy: {
        mode: "on-failure",
        maxRestarts: 5,
        windowSeconds: 60
      },
      policyRef: "default"
    }
  });

  assert.equal(manifest.metadata.serviceType, "agent");
  assert.equal(manifest.metadata.agent?.a2a?.protocol, "clarity.a2a.v1");
});

test("validateManifest accepts metadata.agent.chat.provider=anthropic", () => {
  const manifest = validateManifest({
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/agent-anthropic.clarity",
      module: "AgentAnthropic",
      serviceType: "agent",
      agent: {
        agentId: "agent-anthropic",
        name: "Agent Anthropic",
        role: "assistant",
        objective: "Validate anthropic chat provider metadata",
        triggers: ["api"],
        chat: {
          provider: "anthropic",
          model: "claude-3-7-sonnet"
        }
      }
    },
    spec: {
      origin: {
        type: "local_wasm",
        wasmPath: "/tmp/agent-anthropic.wasm",
        entry: "mcp_main"
      },
      enabled: true,
      autostart: false,
      restartPolicy: {
        mode: "on-failure",
        maxRestarts: 5,
        windowSeconds: 60
      },
      policyRef: "default"
    }
  });

  assert.equal(manifest.metadata.agent?.chat?.provider, "anthropic");
});

test("validateManifest rejects metadata.serviceType=agent without metadata.agent", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent.clarity",
          module: "AgentSample",
          serviceType: "agent"
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent.wasm",
            entry: "mcp_main"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /metadata\.agent/
  );
});

test("validateManifest rejects metadata.serviceType=agent without metadata.agent.triggers", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent.clarity",
          module: "AgentSample",
          serviceType: "agent",
          agent: {
            agentId: "agent-sample",
            name: "Agent Sample",
            role: "coordinator",
            objective: "Coordinate downstream tools"
          }
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent.wasm",
            entry: "mcp_main"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /metadata\.agent\.triggers/
  );
});

test("validateManifest rejects a2a trigger without metadata.agent.a2a profile", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent-a2a.clarity",
          module: "AgentA2A",
          serviceType: "agent",
          agent: {
            agentId: "agent-a2a",
            name: "Agent A2A",
            role: "worker",
            objective: "Receive A2A handoff",
            triggers: ["a2a"]
          }
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent-a2a.wasm",
            entry: "mcp_main"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /metadata\.agent\.a2a/
  );
});

test("validateManifest rejects invalid metadata.serviceType", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/invalid.clarity",
          module: "Invalid",
          serviceType: "tool"
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/invalid.wasm",
            entry: "mcp_main"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /metadata\.serviceType/
  );
});

test("validateManifest rejects invalid metadata.agent.chat.apiKeyEnv", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent-invalid-chat.clarity",
          module: "AgentInvalidChat",
          serviceType: "agent",
          agent: {
            agentId: "agent-invalid-chat",
            name: "Agent Invalid Chat",
            role: "assistant",
            objective: "Validate chat config",
            triggers: ["api"],
            chat: {
              apiKeyEnv: "OPENAI API KEY"
            }
          }
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent-invalid-chat.wasm",
            entry: "mcp_main"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /metadata\.agent\.chat\.apiKeyEnv/
  );
});

test("validateManifest rejects empty metadata.agent.chat.handlerTool", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent-invalid-chat-handler.clarity",
          module: "AgentInvalidChatHandler",
          serviceType: "agent",
          agent: {
            agentId: "agent-invalid-chat-handler",
            name: "Agent Invalid Chat Handler",
            role: "assistant",
            objective: "Validate chat handler config",
            triggers: ["api"],
            chat: {
              handlerTool: "   "
            }
          }
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent-invalid-chat-handler.wasm",
            entry: "mcp_main"
          },
          enabled: true,
          autostart: true,
          restartPolicy: {
            mode: "on-failure",
            maxRestarts: 5,
            windowSeconds: 60
          },
          policyRef: "default"
        }
      }),
    /metadata\.agent\.chat\.handlerTool/
  );
});

test("validateManifest rejects invalid metadata.agent.chat.historyMaxTurns", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent-invalid-chat-history.clarity",
          module: "AgentInvalidChatHistory",
          serviceType: "agent",
          agent: {
            agentId: "agent-invalid-chat-history",
            name: "Agent Invalid Chat History",
            role: "assistant",
            objective: "Validate history limits",
            triggers: ["api"],
            chat: {
              historyMaxTurns: 0
            }
          }
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent-invalid-chat-history.wasm",
            entry: "mcp_main"
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
      }),
    /metadata\.agent\.chat\.historyMaxTurns/
  );
});

test("validateManifest rejects invalid metadata.agent.hitl", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent-invalid-hitl.clarity",
          module: "AgentInvalidHitl",
          serviceType: "agent",
          agent: {
            agentId: "agent-invalid-hitl",
            name: "Agent Invalid Hitl",
            role: "assistant",
            objective: "Validate hitl flag",
            triggers: ["api"],
            hitl: "yes"
          }
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent-invalid-hitl.wasm",
            entry: "mcp_main"
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
      }),
    /metadata\.agent\.hitl/
  );
});

test("validateManifest accepts metadata.agent.timer schedules when trigger includes timer", () => {
  const manifest = validateManifest({
    apiVersion: "clarity.runtime/v1",
    kind: "MCPService",
    metadata: {
      sourceFile: "/tmp/agent-timer.clarity",
      module: "AgentTimer",
      serviceType: "agent",
      agent: {
        agentId: "agent-timer",
        name: "Agent Timer",
        role: "coordinator",
        objective: "Run periodic workflows",
        triggers: ["timer"],
        timer: {
          serial: true,
          schedules: [
            {
              scheduleId: "every_five_min",
              scheduleExpr: "every 5 min",
              enabled: true
            }
          ]
        }
      }
    },
    spec: {
      origin: {
        type: "local_wasm",
        wasmPath: "/tmp/agent-timer.wasm",
        entry: "mcp_main"
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
  });

  assert.equal(manifest.metadata.agent?.timer?.schedules?.[0]?.scheduleId, "every_five_min");
});

test("validateManifest rejects timer trigger without metadata.agent.timer", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent-invalid-timer.clarity",
          module: "AgentInvalidTimer",
          serviceType: "agent",
          agent: {
            agentId: "agent-invalid-timer",
            name: "Agent Invalid Timer",
            role: "coordinator",
            objective: "Validate timer requirements",
            triggers: ["timer"]
          }
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent-invalid-timer.wasm",
            entry: "mcp_main"
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
      }),
    /metadata\.agent\.timer/
  );
});

test("validateManifest rejects invalid metadata.agent.timer.scheduleExpr", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/agent-invalid-timer-expr.clarity",
          module: "AgentInvalidTimerExpr",
          serviceType: "agent",
          agent: {
            agentId: "agent-invalid-timer-expr",
            name: "Agent Invalid Timer Expr",
            role: "coordinator",
            objective: "Validate timer schedule expression",
            triggers: ["timer"],
            timer: {
              schedules: [
                {
                  scheduleId: "bad",
                  scheduleExpr: "*/5 * * * *"
                }
              ]
            }
          }
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/agent-invalid-timer-expr.wasm",
            entry: "mcp_main"
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
      }),
    /metadata\.agent\.timer\.schedules\[0\]\.scheduleExpr/
  );
});

test("validateManifest rejects local_wasm env entries without value or secretRef", () => {
  assert.throws(
    () =>
      validateManifest({
        apiVersion: "clarity.runtime/v1",
        kind: "MCPService",
        metadata: {
          sourceFile: "/tmp/local-env-invalid.clarity",
          module: "LocalEnvInvalid",
          serviceType: "mcp"
        },
        spec: {
          origin: {
            type: "local_wasm",
            wasmPath: "/tmp/local-env-invalid.wasm",
            entry: "mcp_main",
            env: [
              {
                name: "OPENAI_API_KEY"
              }
            ]
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
      }),
    /local_wasm origin\.env\[0\] must define value or secretRef/
  );
});
