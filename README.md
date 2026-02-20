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

## Getting Started in 60 Seconds

```bash
# 1) Start the runtime
npm install && npm run dev:daemon

# 2) Register local and remote MCP services
npm run dev:ctl -- add-local --source ./examples/sample.clarity --module Sample --wasm ./examples/sample.wasm
npm run dev:ctl -- add-remote --endpoint https://example.com/mcp --module ExternalDocs

# 3) Inspect + wire clients once
npm run dev:ctl -- list
npm run dev:ctl -- bootstrap --clients codex,claude
```

Open the control layer: [http://127.0.0.1:4707/status](http://127.0.0.1:4707/status)

---

## CLI

```bash
clarityctl add-local --source <file.clarity> --module <name> --wasm <file.wasm>
clarityctl add-remote --endpoint <url> --module <name>
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

---

## Current Status

Implemented in v1 scaffold:
- service contracts and manifest schema (`clarity.runtime/v1`)
- persistent registry (`.clarity/runtime/registry.json`)
- daemon HTTP API and status page
- add/list/start/stop/restart/introspect flows
- gateway `/mcp` JSON-RPC endpoint (`initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`)
- built-in runtime control MCP tools (`runtime__status_summary`, `runtime__list_services`, `runtime__get_service`, `runtime__get_logs`, `runtime__start_service`, `runtime__stop_service`, `runtime__restart_service`, `runtime__refresh_interface`)
- stdio bridge mode via `clarityctl gateway serve --stdio`
- bootstrap writers for Codex/Claude config files

Not implemented yet:
- direct `clarityc start` compiler integration
- remote auth/policy hardening and isolation
- local WASM MCP execution engine (currently local services expose runtime tools and remote services are fully proxied)

---

## Roadmap

- [ ] Wire compiler path: `clarityc start <file.clarity>`
- [ ] Add policy engine (timeouts, allowlists, concurrency, payload limits)
- [ ] Add remote auth providers and secret references
- [ ] Add quarantine/recovery and richer health diagnostics
- [ ] Add interface diffing and audit/event timeline

---

## Spec

- Runtime spec: `docs/spec/v1/runtime-spec.md`
- Manifest schema: `schemas/mcp-service-v1.schema.json`

## Social Preview

Use: `assets/clarity-runtime-og-card.png`

In GitHub: repository `Settings` -> `General` -> `Social preview` -> `Upload an image`.

## Contributing

1. Fork this repository.
2. Create a branch from `main`.
3. Make changes with tests/docs where relevant.
4. Open a PR describing behavior changes and rationale.

For larger architecture changes, open an issue first to align on the control-plane contract.
