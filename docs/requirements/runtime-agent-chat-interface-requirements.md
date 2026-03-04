# Runtime HITL Chat Executor Requirements

Status: Draft  
Owner: `LLM-runtime`  
Related: `LLM-cli` runtime-chat bridge (`docs/runtime-agent-chat-spec.md` in `LLM-cli`)

## Problem

`POST /api/agents/runs/:runId/messages` records run-scoped chat input, but a response depends on additional `agent.*` events being produced for the same run. Without a runtime-side executor loop, CLI users can send input but do not see replies.

## Goal

When runtime receives run-scoped chat input, it must enqueue asynchronous processing and emit response events so operator clients can continue an interactive session on one run timeline.

## Functional Requirements

1. `POST /api/agents/runs/:runId/messages` must enqueue runtime chat execution for `role=user` after input is persisted.
2. Execution must preserve request latency: endpoint returns immediately (`200`) while processing continues asynchronously.
3. Runtime must emit canonical run events for each processed message:
   - `agent.step_started`
   - optional `agent.llm_called` (when an LLM provider is used)
   - `agent.chat.assistant_message` with reply text in `data.message`
   - `agent.step_completed` with response text in `data.message`
   - `agent.waiting` with `data.waitingReason="awaiting operator input"` for the next turn
4. All emitted events must include `data.runId` so `/api/agents/runs/:runId/events*` and CLI filtering remain compatible.
5. Processing must be serialized per run (`runId`) to keep response order deterministic.
6. Runtime must keep the run non-terminal between turns (do not auto-complete after each reply).

## Dispatch/Mode Requirements

1. Runtime must support a deterministic fallback mode for local/dev operation:
   - `echo` mode returns `Echo: <input>` without external dependencies.
2. Runtime must support an `auto` mode that dispatches to an agent-owned handler tool:
   - default handler for local wasm agents: `fn__receive_chat`
   - default handler for remote MCP agents: `receive_chat`
   - per-agent override: `metadata.agent.chat.handlerTool`
3. Runtime must not perform provider HTTP calls directly in `auto` mode; provider access belongs to the agent implementation.
4. Runtime must support a `disabled` mode that preserves ingest-only behavior.
5. Mode can be configured globally and overridden per agent:
   - global default: `CLARITY_HITL_CHAT_MODE` (`auto` default, `echo`, `disabled`)
   - per-agent override: `metadata.agent.chat.mode`
6. Provider/model/key settings may still be declared per agent for agent-owned execution:
   - `metadata.agent.chat.provider`
   - `metadata.agent.chat.model`
   - `metadata.agent.chat.apiKeyEnv`
   - `metadata.agent.chat.timeoutMs`

## Non-Goals (This Increment)

1. Full language-native orchestration in Clarity for chat processing.
2. Generic string marshalling for all local wasm exported function calls.
3. Persisted conversation memory beyond the current run event timeline.

## Acceptance Criteria

1. A run started via API trigger receives `agent.chat.user_message` and then emits response events from runtime executor.
2. `runtime-chat` in `LLM-cli` displays assistant output without external manual event scripts.
3. Existing `/api/agents/runs/:runId/hitl` contract remains backward compatible and remains HITL-specific.
4. Automated tests cover the new async event emission path.

## Backlog

- `RUNTIME-HITL-CLARITY-001`: Replace TypeScript runtime chat executor with native Clarity orchestration once language/runtime primitives are ready.
