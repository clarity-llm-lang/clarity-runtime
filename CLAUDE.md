# Clarity Runtime Project

## What is this

Clarity Runtime (`clarityd`) is the daemon and gateway that runs, registers, and operates MCP services, agent runs, and Clarity applications. This repo also contains `clarityctl` (the control plane CLI) and the web status dashboard.

## Workspace boundary

This repo is one of three projects in the Clarity workspace:

| Repo | Responsibility |
|------|---------------|
| `LLM-lang` | Language definition, compiler, standard library |
| `LLM-runtime` ← **this repo** | Daemon, MCP gateway, service registry, agent run tracking, web UI |
| `LLM-cli` | Operator CLI (`clarity-agent`) for interactive agent sessions |

### What LLM-runtime owns
- **`clarityd`** — daemon process: service registry, lifecycle supervisor, MCP gateway, HTTP API
- **MCP gateway** — routes tool calls from agent clients to registered services
- **Service registry** — persistent identity, provisioning, health, interface snapshots
- **Agent run tracking** — `agent.*` event log, run timelines, `/api/agents/*` API
- **A2A agent cards** — advertise Clarity agents as A2A-compatible services
- **HITL broker** — question/answer file protocol, operator HTTP API
- **Web status dashboard** — React UI for health, logs, interface visibility
- **`clarityctl`** — control-plane management CLI (start/stop/list/remove services)
- **Bootstrap flows** — `clarity__bootstrap_app`, onboarding hooks for Codex and Claude clients
- **Auth / secret providers** — `env:`, `file:`, `header_env:` authRef resolution, policy controls
- **Observability** — durable audit log, retention, pagination, export

### What LLM-runtime does NOT own
- The Clarity language, compiler, or standard library → `LLM-lang`
- Built-in functions, effects, or language-level primitives → `LLM-lang`
- The `clarityc` CLI → `LLM-lang`
- The operator interactive chat CLI (`clarity-agent runtime-chat`, etc.) → `LLM-cli`

### Implementation language policy
- Runtime and control-plane code is TypeScript (Node.js).
- All **application logic scaffolded by or running inside the runtime** (agent step functions, skill implementations, service code) must be native Clarity.
- `LLM-cli` production implementation must be native Clarity so language capability is validated by real usage.

## Cross-repo language requirements

When runtime or CLI work is blocked by a missing language, compiler, or runtime capability, add an entry to:

```
../LLM-lang/docs/runtime-cli-language-requirements.md
```

This is the canonical intake registry. Keep entries concise; link to the local requirement doc in `docs/requirements/` for details. Do not file issues in `LLM-lang` directly — use the registry file so language work is prioritised against the full backlog.

Current open items (summary):

| ID | Priority | Summary |
|----|----------|---------|
| `RUNTIME-HITL-CLARITY-001` | P1 | Replace TypeScript chat executor with native Clarity orchestration |
| `LANG-RUNTIME-A2A-001` | P1 | Emit `agent.*` events from `std/a2a` / `std/mcp` at language level |
| `LANG-RUNTIME-CLI-EOF-001` | P1 | Deterministic `read_line()` / EOF for menu-style CLI loops |
| `LANG-RUNTIME-ENTRY-001` | P2 | Keep `clarityc start` compiler/runtime contract stable |
| `RQ-LANG-CLI-TTY-003` | P1 | `tty_read_key()` reliable on macOS terminals |

## Project structure

```
src/
  cmd/          — clarityctl command handlers
  pkg/
    bootstrap/  — service bootstrap and onboarding flows
    gateway/    — MCP gateway / tool call routing
    hitl/       — HITL broker (question/answer file protocol + HTTP API)
    http/       — HTTP API server and route handlers
    registry/   — service registry (identity, lifecycle, interface snapshots)
    rpc/        — JSON-RPC and SSE client/server primitives
    security/   — auth provider resolution, policy enforcement
    supervisor/ — process lifecycle (start/stop/health)
  types/        — shared TypeScript types
  web/          — React status dashboard
tests/          — integration tests
docs/
  requirements/ — cross-repo requirement specs
  roadmap/      — layered delivery plan
  spec/         — protocol and API specs
```

## Workflow rules

### Language requirement intake
- When runtime work finds a language gap, add an entry to `../LLM-lang/docs/runtime-cli-language-requirements.md` in the same change where the gap is discovered.
- Reference the local requirement doc path in the `Source` column.

### Test discipline
- Run `npm test` before every commit.
- All tests must pass before pushing.
- Add integration tests for every new API route or daemon behaviour.

### Trunk-based development
1. Work on a short-lived feature branch.
2. Commit with a clear message.
3. Push and create a PR after each major task.
4. Merge promptly.

### Documentation
After every implementation task, check and update:
- `README.md` — high-level status and quickstart
- `docs/requirements/` — mark requirements as done when closed
- `docs/roadmap/` — update layer status

## Key runtime contracts

### `clarityc start` contract (Layer 6)
Runtime invokes `clarityc start <file.clarity>` to boot a Clarity service. The contract:
- `clarityc start` must print `READY` to stdout when the service is listening.
- Runtime captures the port from the process output.
- Contract must remain stable — changes require coordinated update in both repos.

### MCP tool naming
Tools served by the gateway use the Clarity export name verbatim. `skill`-annotated functions (when implemented in `LLM-lang`) will be auto-exposed without extra configuration.

### Event schema
All `agent.*` events follow the schema in `docs/spec/`. Events emitted by `std/a2a` and `std/mcp` at the language level must be compatible with the same schema (tracked as `LANG-RUNTIME-A2A-001`).
