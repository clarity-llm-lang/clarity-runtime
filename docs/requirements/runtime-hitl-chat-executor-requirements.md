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

## Provider/Mode Requirements

1. Runtime must support a deterministic fallback mode for local/dev operation:
   - `echo` mode returns `Echo: <input>` without external dependencies.
2. Runtime must support an `auto` mode that can use OpenAI Responses API when:
   - agent metadata declares OpenAI provider intent (`allowedLlmProviders` or `llmProviders` includes `openai`)
   - OpenAI API key is configured.
3. Runtime must support a `disabled` mode that preserves existing ingest-only behavior.
4. Mode can be configured globally and overridden per agent:
   - global default: `CLARITY_HITL_CHAT_MODE`
   - per-agent override: `metadata.agent.chat.mode`
5. Provider/model/key selection can be configured per agent:
   - `metadata.agent.chat.provider`
   - `metadata.agent.chat.model`
   - `metadata.agent.chat.apiKeyEnv`
   - `metadata.agent.chat.timeoutMs`
6. OpenAI global defaults remain available:
   - `auto` (default)
   - `echo`
   - `disabled`
   - `CLARITY_HITL_OPENAI_MODEL` (default `gpt-4.1-mini`)
   - `CLARITY_HITL_OPENAI_TIMEOUT_MS` (default `20000`)
   - API key from `OPENAI_API_KEY` (or `CLARITY_HITL_OPENAI_API_KEY`)

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
