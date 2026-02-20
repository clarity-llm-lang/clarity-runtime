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
- `GET /api/services/:id`: full service record.
- `GET /api/services/:id/interface`: interface snapshot.
- `GET /api/services/:id/logs?limit=200`: logs.
- `POST /api/services/apply`: apply manifest.
- `POST /api/services/:id/start|stop|restart|introspect`.
- `POST /api/bootstrap`: write Codex/Claude client registration.

## Built-in MCP Control Tools
- `runtime__status_summary`
- `runtime__list_services`
- `runtime__get_service`
- `runtime__get_logs`
- `runtime__start_service`
- `runtime__stop_service`
- `runtime__restart_service`
- `runtime__refresh_interface`

## Manifest
- JSON schema file: `schemas/mcp-service-v1.schema.json`.
- `apiVersion`: `clarity.runtime/v1`.
- `kind`: `MCPService`.
- `origin.type`: `local_wasm` or `remote_mcp`.

## CLI
- `clarityctl add-local --source ... --module ... --wasm ...`
- `clarityctl add-remote --endpoint ... --module ...`
- `clarityctl list|status|start|stop|restart|introspect|logs|bootstrap|doctor`
- `clarityctl gateway serve --stdio`

## Planned Next
- Add policy enforcement and auth secret backend for remote services.
- Add local WASM MCP execution engine.
- Add compiler hook so `clarityc start` calls daemon apply/start directly.
