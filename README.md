<p align="center">
  <img src="assets/clarity-runtime-banner.svg" alt="Clarity Runtime" width="860">
</p>

# Clarity Runtime

**One local control plane for every MCP server you use.**

Clarity Runtime is a lightweight runtime + gateway for running, registering, and operating MCP services from a single place. It is built for a future where MCP services are compiled from Clarity, started with one command, and immediately visible to local coding agents.

## Why This Exists

Most MCP workflows today are fragmented:
- each client needs separate config
- local and remote servers are managed differently
- there is no shared status surface for health, logs, and interface visibility

Clarity Runtime solves this with a single daemon and gateway.

## What You Get

- Single control plane daemon (`clarityd`)
- Single operator CLI (`clarityctl`)
- Single status page (`/status`) with registered services and interfaces
- Deterministic service identity (no required manual naming)
- Local + remote MCP registration model
- Codex + Claude bootstrap hooks (one-time client wiring)

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

## Demo Flow

```bash
npm install
npm run dev:daemon
```

In another terminal:

```bash
npm run dev:ctl -- add-local --source ./examples/sample.clarity --module Sample --wasm ./examples/sample.wasm
npm run dev:ctl -- add-remote --endpoint https://example.com/mcp --module ExternalDocs
npm run dev:ctl -- list
npm run dev:ctl -- bootstrap --clients codex,claude
```

Open the control layer:

- [http://127.0.0.1:4707/status](http://127.0.0.1:4707/status)

## Getting Started in 60 Seconds

```bash
# 1) Start the runtime
npm install && npm run dev:daemon

# 2) Register one local MCP service
npm run dev:ctl -- add-local --source ./examples/sample.clarity --module Sample --wasm ./examples/sample.wasm

# 3) Start it and inspect interface
npm run dev:ctl -- start <service_id>
npm run dev:ctl -- introspect <service_id>

# 4) Open control plane UI
open http://127.0.0.1:4707/status
```

## Current State (v1 Scaffold)

Implemented now:
- service contracts and manifest schema (`clarity.runtime/v1`)
- persistent registry (`.clarity/runtime/registry.json`)
- daemon HTTP API and status page
- add/list/start/stop/restart/introspect flows
- bootstrap writers for Codex/Claude config files

Not implemented yet:
- real MCP transport on `/mcp`
- real stdio bridge for agent clients
- direct `clarityc start` compiler integration
- remote auth/policy hardening and isolation

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

## Roadmap

- [ ] Implement real MCP gateway transport (`/mcp`, streamable HTTP)
- [ ] Implement stdio gateway process for local clients
- [ ] Wire compiler path: `clarityc start <file.clarity>`
- [ ] Add policy engine (timeouts, allowlists, concurrency, payload limits)
- [ ] Add remote auth providers and secret references
- [ ] Add quarantine/recovery and richer health diagnostics
- [ ] Add interface diffing and audit/event timeline

## Contributing

1. Fork this repository.
2. Create a branch from `main`.
3. Make changes with tests/docs where relevant.
4. Open a PR describing behavior changes and rationale.

For larger architecture changes, open an issue first to align on the control-plane contract.

## Social Preview

Use the themed Open Graph card:

- `assets/clarity-runtime-og-card.svg`

In GitHub: repository `Settings` -> `General` -> `Social preview` -> `Upload an image`.

## Spec

- Runtime spec: `docs/spec/v1/runtime-spec.md`
- Manifest schema: `schemas/mcp-service-v1.schema.json`

## Vision

`clarityc start server.clarity` should be enough.

Compile, register, start, expose, and operate MCP services from one runtime without per-server client setup churn.
