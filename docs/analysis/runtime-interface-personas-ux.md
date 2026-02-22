# Runtime Interface Analysis: Personas, Subtypes, and UX Gaps

Date: 2026-02-22

## Scope

This analysis covers the runtime control-plane interface in:

- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts`
- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/mcp-router.ts`
- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/supervisor/service-manager.ts`
- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`
- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/hitl/broker.ts`
- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/types/contracts.ts`
- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/schemas/mcp-service-v1.schema.json`

It also includes a live runtime snapshot from `runtime__status_summary`, `runtime__list_services`, and `runtime__get_agent_runs` captured on 2026-02-22.

## Runnable Service and Run Subtypes

### Service subtypes

The runtime supports a two-axis service model:

1. `serviceType`: `mcp` or `agent`.
2. `origin.type`: `local_wasm` or `remote_mcp`.

Evidence:

- `serviceType` and `origin` contracts in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/types/contracts.ts:1`.
- Manifest schema in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/schemas/mcp-service-v1.schema.json:24`.

### Agent trigger subtypes

Agent descriptors can declare trigger subtypes:

- `timer`
- `event`
- `api`
- `a2a`

Evidence:

- Descriptor contract in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/types/contracts.ts:21`.
- Validation in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/rpc/manifest.ts:41`.
- Trigger-context validation for `agent.run_created` in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts:189`.

### Run status subtypes

Run summaries support:

- `queued`, `running`, `waiting`, `completed`, `failed`, `cancelled`

Evidence:

- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/supervisor/service-manager.ts:103`.

## Persona Model

### Persona 1: Runtime Operator (service lifecycle owner)

Primary interface:

- `clarityctl list|start|stop|restart|introspect|details`
- `runtime__status_summary`, `runtime__list_services`, `runtime__get_service`
- Status page `MCP` tab

Benefits:

- One control plane for local and remote service lifecycle.
- Deterministic service IDs reduce naming drift.
- Built-in quarantine/unquarantine flow exists.

Drawbacks:

- Lifecycle enum advertises states (`STARTING`, `STOPPING`, `CRASHED`) that are not materially used in state transitions.
- Health enum advertises `TIMEOUT`, `UNAUTHORIZED`, `UNREACHABLE`, but most runtime paths use only `UNKNOWN`, `HEALTHY`, `DEGRADED`.

Evidence:

- Enum definitions in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/types/contracts.ts:4`.
- Start/stop paths in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/supervisor/service-manager.ts:284`.

### Persona 2: Local Service Developer (Clarity/WASM producer)

Primary interface:

- `clarityctl add`, `clarityctl add-all`
- `runtime__register_local`
- Status page service details

Benefits:

- Fast compile-register-start path.
- Auto tool discovery for exported WASM functions.
- Uniform namespacing of tools.

Drawbacks:

- Local interface is function-centric only; resources/prompts are always empty for local services.
- Agent and MCP execution semantics are almost identical in runtime internals; `serviceType=agent` mainly changes metadata and UI grouping.

Evidence:

- Local interface snapshot generation in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/supervisor/service-manager.ts:495`.
- Service type mostly used for summary/validation in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts:130`.

### Persona 3: Remote Integrator (external MCP owner)

Primary interface:

- `clarityctl add-remote`
- `runtime__register_remote`, `runtime__register_via_url`
- Remote policy controls: timeout, allowlist, payload, concurrency, authRef

Benefits:

- Policy knobs are clear and applied at gateway boundaries.
- AuthRef support covers env/file/header patterns.

Drawbacks:

- Schema allows `streamable_http` and `sse_http`, but registration helpers hardcode `streamable_http`.
- Local/remote summary cards currently count only MCP services, excluding agent services, which can hide real remote agent footprint.

Evidence:

- Schema transport enum in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/schemas/mcp-service-v1.schema.json:105`.
- Hardcoded transport in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/mcp-router.ts:1548`.
- Summary counts in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts:539`.

### Persona 4: Agent Orchestrator Designer

Primary interface:

- Agent descriptor (`role`, `objective`, `triggers`, dependencies, handoff targets)
- `POST /api/agents/events`
- `runtime__get_agent_runs`, `runtime__get_agent_events`
- Status page `Agents` tab

Benefits:

- Trigger contracts and run summaries are concrete.
- A2A lineage fields (`parentRunId`, `fromAgentId`) are first-class.
- Run/event APIs are easy to query.

Drawbacks:

- Run-to-service linking uses heuristic matching by service id/display/module/agent names; can mis-attach in naming collisions.
- `waitingReason` can remain on completed runs because it is set on waiting events but not cleared on completion transitions.

Evidence:

- Run matching heuristics in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts:1598`.
- Waiting reason set in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/supervisor/service-manager.ts:766`.
- Completion transitions in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/supervisor/service-manager.ts:803`.

### Persona 5: Human Approver / HITL Operator

Primary interface:

- Direct mode: `POST /api/agents/runs/:runId/hitl`
- Broker mode: `/questions`, `/answer`, `/cancel`
- Status page "Virtual CLI (HITL)"

Benefits:

- Two interaction modes exist, so teams can choose direct event injection or a broker queue.
- UI includes run context, key inference, and event stream feedback.

Drawbacks:

- Two different HITL models are combined in one control, with no explicit conceptual boundary for operators.
- Event kind semantics are inconsistent (`agent.hitl_input` default vs UI sending `agent.human_message`).
- UI can send HITL messages to completed runs; there is no strong run-state gating.
- Raw operator message text is stored in runtime events, creating potential sensitive-data exposure and noisy audit trails.

Evidence:

- HITL endpoint behavior in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts:612`.
- UI direct mode send kind in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts:1240`.
- UI input gating in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts:1075`.
- Broker file-based state in `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/hitl/broker.ts:70`.

## Benefits (Cross-cutting)

- Unified control-plane surface across HTTP API, MCP tools, CLI, and UI.
- Strong manifest contract and deterministic identity.
- Good baseline observability: service events, agent runs, per-run timelines.
- Useful policy baseline for remote services and compiler bootstrap.

## Drawbacks and Missing Features (Cross-cutting)

1. Service semantics gap:
`agent` is mostly declarative metadata. There is limited runtime behavior differentiation beyond validation and reporting.

2. State model mismatch:
State enums imply richer lifecycle/health granularity than currently emitted.

3. HITL architecture split:
Direct run-event injection and file-backed broker are separate systems shown as one UX control.

4. Inconsistent summary model:
Local/remote counts exclude agent services in multiple summaries.

5. Weak governance for human input:
No strict schema/size/redaction policy for HITL payloads before persistence.

6. Transport capability underexposed:
`sse_http` exists in schema but is not selectable in the register flows.

## Strange Design Decisions (with UX Impact)

1. HITL dual-channel design in one panel:
The same UI component drives `/api/agents/runs/:runId/hitl` and `/questions` broker paths. This increases cognitive load and makes operator intent ambiguous.

2. Kind mismatch in direct mode:
Backend default kind is `agent.hitl_input`, while direct UI sends `agent.human_message`. The user-facing hint and backend defaults are not aligned.

3. Post-completion human input accepted:
Completed runs still accept human messages and those messages appear in the run timeline after completion, which can confuse audit interpretation.

4. Waiting reason persistence:
Completed runs can still display `waitingReason`, producing contradictory state in run summaries.

5. Heuristic HITL availability:
The UI infers HITL support from free-text metadata fields, which is brittle and can create false positives.

## Live Snapshot Highlights (2026-02-22)

- Runtime status returned `total=3`, all are `agent` services, all `RUNNING`.
- Active topology is one coordinator plus two worker agents (local WASM).
- Recent runs show timer root runs and A2A worker runs as expected.
- Completed runs still carry `waitingReason="awaiting HITL decision"` in summaries.
- One sampled run recorded `agent.human_message` after `agent.run_completed`.

## UX Designer Handoff: Priority Recommendations

### P0 (Correctness + trust)

1. Enforce run-state guardrails for HITL input.
2. Normalize HITL event kind contract to one canonical kind.
3. Clear `waitingReason` on completion/failure/cancel transitions.
4. Add message size and redaction policy for HITL payload persistence.

### P1 (Information architecture)

1. Split HITL UI into two explicit products:
`Run Input` and `Broker Queue`.
2. Replace heuristic HITL detection with explicit capability metadata in agent descriptor.
3. Make summary cards include local/remote split for both MCP and agent service types.

### P2 (Operator usability)

1. Show declarative vs observed trigger data side-by-side with mismatch warnings.
2. Add contextual validation and inline guidance when posting agent events.
3. Add timeline filtering by run state, trigger, and event kind in UI.

