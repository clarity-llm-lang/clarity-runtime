<p align="center">
  <img src="assets/clarity-runtime-banner.svg" alt="Clarity Runtime" width="860">
</p>

<p align="center">
  <strong>A unified MCP control plane for local and remote services.</strong>
</p>

---

Clarity Runtime is a lightweight runtime + gateway for running, registering, and operating MCP services from one place.

It is designed to pair with Clarity compiler workflows so service onboarding can become one command:

```bash
clarityc start server.clarity
```

---

## Why Clarity Runtime?

MCP operations are usually fragmented:
- every client needs separate MCP wiring
- local and remote servers are managed differently
- there is no shared status surface for health, logs, and interface visibility

Clarity Runtime centralizes this into one control plane daemon (`clarityd`) and one operator CLI (`clarityctl`).

### What this gives you

- Single gateway endpoint for agent clients
- Deterministic service identity (no required manual naming)
- Persistent service registry and lifecycle management
- Interface snapshots (tools/resources/prompts) per service
- Status page for operations and debugging
- One-time client bootstrap hooks for Codex and Claude

---

## Architecture

```text
               +----------------------+
               |     clarityctl       |
               | add/start/stop/etc.  |
               +----------+-----------+
                          |
                          v
+-------------------------+--------------------------+
|                     clarityd                       |
|  registry | lifecycle supervisor | interface cache |
+-------------------------+--------------------------+
                          |
                  +-------+--------+
                  |   MCP Gateway  |
                  +-------+--------+
                          |
           +--------------+--------------+
           |                             |
           v                             v
   Local Clarity MCPs             Remote MCP Services
   (compiled to WASM)             (HTTP transports)
```

---

## Install + Start

```bash
# 1) Install and build once
npm install
npm run build

# 2) Start the runtime
npx clarityd

# 3) Add a local service from source (mcp1 -> ./mcp1.clarity)
npx clarityctl add mcp1

# Optional: add all .clarity services in a folder
npx clarityctl add-all ./examples --recursive

# 4) Inspect + wire clients once
npx clarityctl list
npx clarityctl bootstrap --clients codex,claude
```

Open the control layer: [http://localhost:4707/status](http://localhost:4707/status)

`clarityctl add <name>` compiles `<name>.clarity` to `.clarity/build/<name>.wasm`, then registers and starts it.

For local development (without build artifacts), you can still use:

```bash
npm run dev:daemon
npm run dev:ctl -- list
```

---

## CLI

```bash
clarityctl add <service_or_source_path>
clarityctl add-all [dir] [--recursive]
clarityctl add-remote --endpoint <url> --module <name> [--auth-ref <name>] [--timeout-ms <ms>] [--allow-tools <a,b,c>] [--max-payload-bytes <bytes>] [--max-concurrency <n>]
clarityctl list
clarityctl status
clarityctl start <service_id>
clarityctl stop <service_id>
clarityctl restart <service_id>
clarityctl introspect <service_id>
clarityctl logs <service_id>
clarityctl bootstrap --clients codex,claude
clarityctl doctor
```

`clarityctl doctor` now validates daemon connectivity, compiler availability, and local build workspace readiness.

Legacy compatibility commands (still supported):

```bash
clarityctl add-local --source <file.clarity> --module <name> --wasm <file.wasm>
clarityctl start-source --source <file.clarity> [--module <name>] [--wasm <file.wasm>]
```

---

## Current Status

Implemented in v1 scaffold:
- service contracts and manifest schema (`clarity.runtime/v1`)
- persistent registry (`.clarity/runtime/registry.json`)
- daemon HTTP API and status page
- add/list/start/stop/restart/introspect flows
- gateway `/mcp` JSON-RPC endpoint (`initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`)
- built-in runtime control MCP tools (`runtime__status_summary`, `runtime__list_services`, `runtime__get_service`, `runtime__get_logs`, `runtime__start_service`, `runtime__stop_service`, `runtime__restart_service`, `runtime__refresh_interface`, `runtime__unquarantine_service`, `runtime__get_audit`)
- built-in Clarity-assist MCP tools (`runtime__clarity_help`, `runtime__clarity_sources`) for language/task guidance and workspace source discovery
- gated MCP self-provisioning tools (`runtime__register_local`, `runtime__register_remote`, `runtime__register_via_url`, `runtime__apply_manifest`) protected by `CLARITY_ENABLE_MCP_PROVISIONING=1`
- stdio bridge mode via `clarityctl gateway serve --stdio`
- compiler-assisted onboarding via `clarityctl add <service>` (compile + register + start + introspect)
- local function execution tools for local services (`<namespace>__fn__<exported_function>`)
- baseline remote policy controls (timeout + allowed-tools + payload-size + concurrency manifest policy + optional host allowlist)
- bootstrap writers for Codex/Claude config files

Not implemented yet:
- direct native `clarityc start` command in the compiler repo (runtime side is ready via `clarityctl add`; compiler integration should make runtime an explicit requirement)
- remote auth/policy hardening and isolation

---

## Roadmap

- [x] Runtime-side compiler path (`clarityctl add <service>`)
- [ ] Native compiler command (`clarityc start <file.clarity>`) in `LLM-lang`
- [x] Add policy engine baseline (timeouts, allowlists, concurrency, payload limits)
- [ ] Add remote auth providers and secret references
- [x] Add MCP self-provisioning tools (LLM can register/install services via MCP with approval + policy gates)
- [x] Add quarantine/recovery and richer health diagnostics
- [x] Add interface diffing and audit/event timeline

## Progress Snapshot

| Area | Status | Notes |
|------|--------|-------|
| Registry + lifecycle | Done | Persistent service records, start/stop/restart, health state |
| Gateway MCP transport | Done | `/mcp` JSON-RPC with list/call routing |
| Runtime as MCP control plane | Done | `runtime__*` tools for status, service ops, logs, audit, quarantine recovery |
| Stdio gateway bridge | Done | `clarityctl gateway serve --stdio` forwards to daemon gateway |
| Remote MCP proxying | Done (baseline) | Initialize/introspect/tool forwarding |
| Compiler-driven onboarding | In progress | Runtime side done; native `clarityc start` implemented in `LLM-lang` branch and pending merge |
| Local function execution | Done (baseline) | `<namespace>__fn__*` tools discovered from wasm exports and executed via compiler runtime |
| In-process WASM host execution | Done | Local function tools execute directly via wasm instantiate/call in runtime |
| Auth/policy hardening | In progress | Timeout/allowed-tools/payload-size/concurrency/host-allowlist baseline implemented; auth provider model still pending |
| MCP self-provisioning | Done (gated) | `runtime__register_local`, `runtime__register_remote`, `runtime__apply_manifest` behind `CLARITY_ENABLE_MCP_PROVISIONING=1` |

---

## Spec

- Runtime spec: `docs/spec/v1/runtime-spec.md`
- Manifest schema: `schemas/mcp-service-v1.schema.json`

## Remote Policy Knobs

- `add-remote --timeout-ms <ms>`: set per-service remote request timeout.
- `add-remote --allow-tools <tool_a,tool_b>`: restrict callable remote tools.
- `add-remote --max-payload-bytes <bytes>`: set max request/response payload bytes per remote service.
- `add-remote --max-concurrency <n>`: set max concurrent in-flight remote requests per service.
- `add-remote --auth-ref <name>`: resolve bearer secret from `CLARITY_REMOTE_AUTH_<NAME>`.
- `CLARITY_REMOTE_ALLOWED_HOSTS=host1,host2`: optional global remote host allowlist.
- `CLARITY_REMOTE_DEFAULT_TIMEOUT_MS=20000`: default timeout when manifest timeout is not set.
- `CLARITY_REMOTE_MAX_PAYLOAD_BYTES=1048576`: default max request/response payload bytes when manifest value is not set.
- `CLARITY_REMOTE_MAX_CONCURRENCY=8`: default max in-flight remote requests per service when manifest value is not set.
- `CLARITY_ENABLE_MCP_PROVISIONING=1`: enable runtime MCP self-provisioning tools (`runtime__register_*`, `runtime__apply_manifest`).

## Audit And Events

- `GET /api/audit?limit=200`: latest runtime audit/events.
- `GET /api/events`: SSE stream for live runtime events.
- Status page now includes an audit timeline and `Unquarantine` action for quarantined services.

## Contributing

1. Fork this repository.
2. Create a branch from `main`.
3. Make changes with tests/docs where relevant.
4. Open a PR describing behavior changes and rationale.

For larger architecture changes, open an issue first to align on the control-plane contract.
