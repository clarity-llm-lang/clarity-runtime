# Runtime UX Implementation Backlog

Date: 2026-02-22  
Source analysis: `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/docs/analysis/runtime-interface-personas-ux.md`

## Delivery Approach

- Ship in three waves: `P0` correctness, `P1` structure, `P2` quality.
- Every backlog item must include:
  - API contract update (if applicable)
  - UI behavior update (if applicable)
  - tests in `/src/tests/*`
  - doc update in `/README.md` or `/docs/spec/v1/runtime-spec.md`

## P0: Correctness and Trust

### UX-001: Enforce HITL run-state guardrails

- Priority: `P0`
- Problem:
  - HITL input can be posted to completed runs.
- Scope:
  - Reject `POST /api/agents/runs/:runId/hitl` when run status is terminal (`completed|failed|cancelled`).
  - Return `409` with clear error body.
  - Disable direct-mode send button in UI for terminal runs.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/tests/agent-observability.test.ts`
- Acceptance:
  - Sending HITL to completed run returns `409`.
  - UI shows disabled state and explanatory text.

### UX-002: Normalize HITL event-kind semantics

- Priority: `P0`
- Problem:
  - Direct-mode UI sends `agent.human_message`; backend defaults to `agent.hitl_input`.
- Scope:
  - Define canonical kind: `agent.hitl_input`.
  - UI direct mode sends canonical kind by default.
  - Keep backward compatibility for reads of older kinds.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/docs/spec/v1/runtime-spec.md`
- Acceptance:
  - New HITL events in timeline are canonical.
  - Existing historic data still renders.

### UX-003: Clear waiting metadata on terminal transitions

- Priority: `P0`
- Problem:
  - `waitingReason` can persist on completed runs.
- Scope:
  - On `agent.run_completed`, `agent.run_failed`, `agent.run_cancelled`, clear waiting-specific fields.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/supervisor/service-manager.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/tests/agent-observability.test.ts`
- Acceptance:
  - Completed/failed/cancelled runs never report stale waiting reason.

### UX-004: Add HITL payload hygiene limits

- Priority: `P0`
- Problem:
  - Raw payloads can be large/noisy/sensitive.
- Scope:
  - Add max message length for `/api/agents/runs/:runId/hitl` (e.g. 2k chars).
  - Persist full message only when under limit; otherwise truncate with metadata.
  - Optional redaction pass for common secret patterns.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/tests/agent-observability.test.ts`
- Acceptance:
  - Oversized messages rejected or safely truncated by policy.
  - Audit remains readable and bounded.

## P1: Information Architecture

### UX-005: Split HITL UI into explicit modes with separate panels

- Priority: `P1`
- Problem:
  - Direct run input and broker Q/A are merged in one control.
- Scope:
  - Replace single "Virtual CLI" with two labeled panes:
    - `Run Input (event stream)`
    - `Broker Queue (questions/answers)`
  - Keep quick switch but with clear conceptual separation.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`
- Acceptance:
  - No ambiguity which backend endpoint each pane uses.
  - Operator can complete core tasks without mode confusion.

### UX-006: Replace heuristic HITL support detection with explicit capability

- Priority: `P1`
- Problem:
  - HITL support is inferred from free text and weak heuristics.
- Scope:
  - Add optional explicit field in agent descriptor (e.g. `hitl: boolean` or capability list).
  - Update schema, validation, and UI gating.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/schemas/mcp-service-v1.schema.json`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/types/contracts.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/rpc/manifest.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`
- Acceptance:
  - HITL button availability is deterministic and metadata-driven.

### UX-007: Fix summary counting semantics for local/remote split

- Priority: `P1`
- Problem:
  - Local/remote counts exclude agent services.
- Scope:
  - Expose:
    - `local_mcp`, `remote_mcp`
    - `local_agent`, `remote_agent`
  - Keep aggregate compatibility fields.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/mcp-router.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`
- Acceptance:
  - UI and API summaries represent all service types consistently.

## P2: Quality and Discoverability

### UX-008: Add transport select for remote registration helpers

- Priority: `P2`
- Problem:
  - Schema supports `sse_http`, registration helpers force `streamable_http`.
- Scope:
  - Add transport argument in CLI/MCP register tools and preserve current default.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/mcp-router.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/cmd/clarityctl.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/docs/spec/v1/runtime-spec.md`
- Acceptance:
  - Registering remote services can use either supported transport.

### UX-009: Resolve lifecycle/health contract mismatch

- Priority: `P2`
- Problem:
  - Enums advertise states not emitted in behavior.
- Scope:
  - Option A: implement richer states (`STARTING`, `STOPPING`, etc.).
  - Option B: simplify exposed contract to actual states.
  - Choose one and align code/docs/tests.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/types/contracts.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/supervisor/service-manager.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/docs/spec/v1/runtime-spec.md`
- Acceptance:
  - No dead states in public contract.

### UX-010: Improve run-to-service linking determinism in UI

- Priority: `P2`
- Problem:
  - Current service matching for runs is heuristic.
- Scope:
  - Prefer strict `serviceId` first.
  - Show ambiguity warning instead of silent auto-match when multiple candidates.
- Files:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`
- Acceptance:
  - No incorrect service/run linkage without an explicit warning.

## Proposed Sprint Plan

### Sprint 1 (fast hardening)

- UX-001, UX-002, UX-003, UX-004

### Sprint 2 (IA improvements)

- UX-005, UX-006, UX-007

### Sprint 3 (alignment polish)

- UX-008, UX-009, UX-010

## Done Definition for This Backlog

- All changed behaviors covered by tests.
- Status-page interactions validated manually on desktop/mobile.
- Changelog-level notes updated in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/README.md`.
- Any breaking behavior clearly called out in docs/spec.

