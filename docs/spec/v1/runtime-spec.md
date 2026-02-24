# Clarity Runtime v1 Spec

## Control Plane
- `clarityd`: daemon with HTTP API and status UI.
- `clarityctl`: operator CLI.
- Single gateway endpoint intended for Codex/Claude bootstrap.

## Service Identity
- `service_id` is deterministic: `svc_<12 hex chars from sha256(source|module|artifactOrEndpoint)>`.
- `display_name` is optional UI metadata.

## Lifecycle States
- `REGISTERED`, `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, `CRASHED`, `QUARANTINED`.

## Health States
- `UNKNOWN`, `HEALTHY`, `DEGRADED`, `TIMEOUT`, `UNAUTHORIZED`, `UNREACHABLE`.

## HTTP API
- `GET /status`: status page UI.
- `GET /mcp`: gateway metadata.
- `POST /mcp`: MCP JSON-RPC endpoint.
- `GET /api/status`: full runtime summary.
- `GET /api/services`: service summaries.
- `GET /api/audit?limit=200`: recent audit/event records.
- `GET /api/agents/registry`: registered agent services (agent metadata + runtime state only).
- `GET /api/a2a/capabilities`: compliant A2A-enabled agent services and protocol profile.
- `GET /api/agents/runs?limit=100`: summarized agent runs (status/counters/timestamps).
- `GET /api/agents/events?limit=200`: recent `agent.*` timeline events.
- `GET /api/agents/runs/:runId/events?limit=200`: events for one agent run.
- `GET /api/agents/runs/:runId/events/stream?limit=200`: server-sent events stream for one run (initial replay + live `agent.*` updates for matching `runId`).
- `POST /api/a2a/messages`: ingest one formal A2A envelope (`clarity.a2a.v1`) and normalize into canonical `agent.*` events.
- `POST /api/agents/runs/:runId/hitl`: append human input as `agent.hitl_input` for non-terminal runs (`409` when run is completed/failed/cancelled). Input is sanitized/redacted and bounded by `CLARITY_HITL_MAX_MESSAGE_CHARS` (default `2000`).
- `POST /api/agents/events`: ingest one `agent.*` event from orchestration clients.
- `GET /api/traces?limit=200&run_id=&trace_id=`: recent gateway trace spans (`agent_turn -> mcp.tools/call -> service.execute -> result`).
- `GET /api/costs/runs?limit=200&run_id=`: per-run cost ledger and budget status.
- `GET /api/events`: server-sent events stream for live audit updates.
- `GET /api/services/:id`: full service record.
- `GET /api/services/:id/interface`: interface snapshot.
- `GET /api/services/:id/logs?limit=200`: logs.
- `GET /api/services/:id/events?limit=200`: service-specific audit/events.
- `GET /api/services/:id/details?log_limit=50&event_limit=100&call_limit=20`: aggregated service details (summary, interface, logs, events, recent calls).
- `POST /api/services/apply`: apply manifest.
- `POST /api/services/:id/start|stop|restart|introspect|unquarantine`.
- `POST /api/bootstrap`: write Codex/Claude client registration (`transport=stdio|http`; `endpoint` required for http). Optional `update_agents_md=true` upserts an idempotent managed Clarity-defaults block in workspace `AGENTS.md`.
- `DELETE /api/bootstrap`: remove Codex/Claude `clarity_gateway` registration.
- `GET /api/bootstrap/status`: read Codex/Claude bootstrap configuration status and file paths.

## Built-in MCP Control Tools
- `runtime__status_summary`
- `runtime__list_services`
- `runtime__get_service`
- `runtime__get_logs`
- `runtime__start_service`
- `runtime__stop_service`
- `runtime__restart_service`
- `runtime__refresh_interface`
- `runtime__unquarantine_service`
- `runtime__remove_service`
- `runtime__get_audit`
- `runtime__get_agent_runs`
- `runtime__get_agent_events`
- `runtime__get_traces`
- `runtime__get_cost_ledger`
- `runtime__validate_auth_ref`
- `runtime__auth_provider_health`
- `runtime__list_auth_secrets`
- `runtime__set_auth_secret`
- `runtime__delete_auth_secret`
- `clarity__help`
- `clarity__sources`
- `clarity__project_structure`
- `clarity__ensure_compiler`
- `clarity__bootstrap_app`
- `runtime__register_local` (requires `CLARITY_ENABLE_MCP_PROVISIONING=1`)
- `runtime__register_remote` (requires `CLARITY_ENABLE_MCP_PROVISIONING=1`)
- `runtime__register_via_url` (requires `CLARITY_ENABLE_MCP_PROVISIONING=1`)
- `runtime__apply_manifest` (requires `CLARITY_ENABLE_MCP_PROVISIONING=1`)

## Local Service Tooling
- Local services expose built-in tools: `health_check`, `describe_service`.
- Local services also expose discovered function tools: `fn__<exported_function>`.
- Gateway namespaced exposure format: `<toolNamespace>__fn__<exported_function>`.
- Current execution path for `fn__*` tools is direct in-process wasm execution in `clarityd`.

## Manifest
- JSON schema file: `schemas/mcp-service-v1.schema.json`.
- `apiVersion`: `clarity.runtime/v1`.
- `kind`: `MCPService`.
- `origin.type`: `local_wasm` or `remote_mcp`.
- `remote_mcp.timeoutMs`: optional per-service timeout.
- `remote_mcp.allowedTools`: optional per-service tool allowlist.
- `remote_mcp.authRef`: optional auth reference with provider syntax.
  - Legacy env form: `<name>` -> `CLARITY_REMOTE_AUTH_<NAME_SANITIZED>`
  - Env form: `env:<ENV_VAR>`
  - File form: `file:<relative/path>` (resolved under `CLARITY_REMOTE_AUTH_FILE_ROOT` or `.clarity/secrets`)
  - Header form: `header_env:<Header-Name>:<ENV_VAR>`
- `remote_mcp.maxPayloadBytes`: optional per-service request/response payload limit.
- `remote_mcp.maxConcurrency`: optional per-service in-flight request limit.

## CLI
- `clarityctl add <service>`
- `clarityctl add-all [dir] [--recursive]`
- `clarityctl add-remote --endpoint ... --module ... [--timeout-ms ...] [--allow-tools ...] [--max-payload-bytes ...] [--max-concurrency ...]`
- Legacy compatibility: `clarityctl add-local ...`, `clarityctl start-source ...`
- `clarityctl list|status|start|stop|restart|introspect|details|logs|bootstrap|bootstrap-remove|doctor` (`bootstrap` supports stdio/http client config plus optional `--update-agents-md`; `bootstrap-remove` removes client registrations; `doctor` checks daemon, compiler, workspace)
- `clarityctl gateway serve --stdio`

## Tracing, Cost, and Budgets
- Gateway assigns/propagates `session_id`, `trace_id`, and `run_id` for MCP `tools/call`.
- Span phases recorded per tool call:
  - `agent_turn`
  - `mcp.tools/call`
  - `service.execute`
  - `result`
- Cost ledger tracks per run:
  - bytes/tokens in/out (tokens optional when unavailable)
  - provider/model (when present in payload/result)
  - computed USD cost via local pricing table
  - latency and retries
- Pricing table sources:
  - `CLARITY_PRICING_TABLE_PATH` (JSON file)
  - `CLARITY_PRICING_TABLE_JSON` (inline JSON)
  - fallback default byte-cost table
- Budget controls:
  - `CLARITY_BUDGET_MAX_TOOL_CALLS_PER_RUN` (default `64`)
  - `CLARITY_BUDGET_MAX_TOTAL_TOKENS_PER_RUN` (default `200000`)
  - `CLARITY_BUDGET_MAX_TOTAL_COST_USD` (default `20`)
- Remote retry controls:
  - `CLARITY_REMOTE_RETRY_MAX` (default `0`)
  - `CLARITY_REMOTE_RETRY_BACKOFF_MS` (default `150`)
- Service circuit-breaker controls (tool error-rate quarantine):
  - `CLARITY_TOOL_CIRCUIT_WINDOW_SECONDS` (default `60`)
  - `CLARITY_TOOL_CIRCUIT_MIN_CALLS` (default `8`)
  - `CLARITY_TOOL_CIRCUIT_ERROR_RATE` (default `0.6`)

## Formal A2A Contract
- Protocol id: `clarity.a2a.v1`.
- Agents that declare trigger `a2a` must declare `metadata.agent.a2a` in manifest.
- Envelope requirements for `POST /api/a2a/messages`:
  - `protocol`, `kind`, `messageId`, `sentAt`
  - `from.agentId`, `to.agentId`
  - `context.runId`, `context.parentRunId`, `context.handoffReason`
- Accepted `kind` values:
  - `handoff.request`
  - `handoff.accepted`
  - `handoff.rejected`
  - `handoff.completed`
- Runtime behavior:
  - target agent service is resolved and validated as `a2a`-enabled
  - duplicate `messageId` is rejected (`409`)
  - envelope is normalized into canonical `agent.run_created` (when run is new), `agent.handoff`, and optional `agent.run_started`
  - terminal runs reject new A2A envelopes (`409`)
- Size control:
  - `CLARITY_A2A_MAX_MESSAGE_BYTES` (default `65536`)

## Planned Next
- Add stricter auth isolation controls for remote services.
- Integrate language-side orchestration (`std/a2a`, `std/mcp`) with runtime agent event ingestion APIs.
