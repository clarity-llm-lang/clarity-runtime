# Local Wasm Agent Parity Requirements

Status: Implemented (baseline)  
Owner: `LLM-runtime`  
Related:
- `docs/spec/v1/runtime-spec.md`
- `docs/requirements/runtime-agent-chat-interface-requirements.md`
- `LLM-lang/std/context.clarity`

## Problem

The runtime manifest/spec now advertises richer agent capabilities for chat, A2A, HITL, secrets, and timer-triggered execution, but the current `local_wasm` worker host only exposes string helpers plus `call_model` / `call_model_system`.

As a result, runtime-managed local wasm agents cannot cleanly use the language/runtime features that already exist on the Clarity side:

1. `std/context` and `std/json` cannot run because JSON host imports are missing.
2. `std/hitl` cannot run because `hitl_ask` is missing.
3. `get_secret()` cannot run, and per-agent `secretRef` env injection is not applied.
4. `std/a2a` and `std/mcp` are not usable from local wasm agents.
5. Timer triggers are declarative only; there is no runtime schedule contract for “every 5 min”.

This forces agent implementations to stay inside a narrow string-only subset and weakens the value of the stricter agent contract.

## Goal

Bring `local_wasm` execution up to the minimum capability level needed for strict-contract agents to use the standard library features that the runtime already documents and the language already ships.

## Functional Requirements

### 1. JSON / Context Host Import Support

`local_wasm` must expose the JSON host imports needed by `std/json` and `std/context`, including at least:

- `json_get`
- `json_get_nested`
- `json_array_length`
- `json_array_get`
- `json_keys`
- `json_escape_string`

This allows `fn__receive_chat(..., context_json)` handlers to consume `context.v1` through `std/context` instead of raw prompt stuffing.

### 2. Secret Support For Local Wasm Agents

Runtime must support agent-owned secrets for `local_wasm` services by:

1. resolving `spec.origin.env[].secretRef`
2. injecting resolved env vars only into the target service execution context
3. exposing `get_secret()` to local wasm agents
4. honoring `metadata.agent.chat.apiKeyEnv` for runtime chat model calls

The current fallback to process-wide `OPENAI_API_KEY` / `OPENAI_API_KEY_FILE` is acceptable only as backward compatibility.

### 3. HITL Support For Local Wasm Agents

Runtime must expose the host import(s) required by `std/hitl`, including `hitl_ask`, so that agents marked with `metadata.agent.hitl=true` can actually execute built-in HITL flows instead of only advertising UI capability.

### 4. A2A / MCP Support For Local Wasm Agents

Runtime must either:

1. expose the host imports required by `std/a2a` and `std/mcp` to local wasm services, including observability hooks into the existing `agent.*` event model, or
2. reject manifests / builds that rely on unsupported local-wasm imports with a deterministic actionable error.

Silent contract drift between manifest metadata and executable local-wasm capability is not acceptable.

### 5. Declarative Timer Schedule Contract

Runtime must define and execute a manifest-level timer schedule contract for agent services.

Minimum scope:

- machine-readable schedule metadata on the agent/service manifest
- runtime-owned scheduler loop
- canonical timer trigger context with `scheduleId`, `scheduleExpr`, and `firedAt`
- serialized execution guarantees per target run/agent where needed

Without this, `metadata.agent.triggers=["timer"]` is descriptive only.

### 6. Service Interface Refresh Consistency

After `POST /api/services/:serviceId/introspect`, the registry/listing surfaces must reflect the refreshed interface metadata.

At minimum, `GET /api/services` must not continue returning stale `interfaceRevision`, `introspectedAt`, or outdated tool counts for a service that has been successfully re-introspected.

### 7. Structured Local Export Marshalling

Runtime-managed local wasm `fn__*` calls must support typed argument/result marshalling so runtime-owned handlers can accept structured payloads without parsing raw JSON strings:

- call payload may provide `argTypes` descriptors (for example `Record`, `List`, `Option`, `Result`) to marshal nested arguments into wasm memory using Clarity ABI layouts.
- call payload may provide `resultType` to decode structured wasm return values back to host JSON/text deterministically.
- runtime-owned local chat and timer dispatch must pass a structured context argument in addition to legacy JSON arguments to preserve backward compatibility for existing handlers.

## Non-Goals

1. Replacing `remote_mcp` execution.
2. Full native Clarity orchestration inside runtime for every trigger type.
3. Multi-tenant secret-management backends beyond the existing env/file model in this increment.

## Acceptance Criteria

1. A local wasm chat agent can import and use `std/context` without `unsupported host import` failures.
2. A local wasm agent can use `get_secret()` and receive a per-service key via `spec.origin.env[].secretRef`.
3. A local wasm agent can use `std/hitl` through runtime-managed HITL execution.
4. A local wasm agent can either use `std/a2a` / `std/mcp`, or runtime rejects unsupported imports at registration/start with an actionable error.
5. A coordinator agent can declare a 5-minute timer schedule in manifest metadata and runtime executes it without an external shell loop.
6. `GET /api/services` reflects fresh interface metadata immediately after successful introspection.
7. Runtime-managed local wasm handlers can consume typed structured context arguments (chat/timer) and runtime can decode structured local export return values via `resultType`.
