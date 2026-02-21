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
- `GET /api/events`: server-sent events stream for live audit updates.
- `GET /api/services/:id`: full service record.
- `GET /api/services/:id/interface`: interface snapshot.
- `GET /api/services/:id/logs?limit=200`: logs.
- `GET /api/services/:id/events?limit=200`: service-specific audit/events.
- `GET /api/services/:id/details?log_limit=50&event_limit=100&call_limit=20`: aggregated service details (summary, interface, logs, events, recent calls).
- `POST /api/services/apply`: apply manifest.
- `POST /api/services/:id/start|stop|restart|introspect|unquarantine`.
- `POST /api/bootstrap`: write Codex/Claude client registration.
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
- `runtime__get_audit`
- `runtime__clarity_help`
- `runtime__clarity_sources`
- `runtime__clarity_project_structure`
- `runtime__ensure_compiler`
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
- `remote_mcp.authRef`: optional auth reference resolved from environment secret key.
- `remote_mcp.maxPayloadBytes`: optional per-service request/response payload limit.
- `remote_mcp.maxConcurrency`: optional per-service in-flight request limit.

## CLI
- `clarityctl add <service>`
- `clarityctl add-all [dir] [--recursive]`
- `clarityctl add-remote --endpoint ... --module ... [--timeout-ms ...] [--allow-tools ...] [--max-payload-bytes ...] [--max-concurrency ...]`
- Legacy compatibility: `clarityctl add-local ...`, `clarityctl start-source ...`
- `clarityctl list|status|start|stop|restart|introspect|details|logs|bootstrap|doctor` (`doctor` checks daemon, compiler, workspace)
- `clarityctl gateway serve --stdio`

## Planned Next
- Add auth secret backend/provider model for remote services.
- Merge and release native `clarityc start` compiler command.
