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

# Optional: require auth token for all API/MCP calls
# export CLARITYD_AUTH_TOKEN=your-token
# npx clarityd --auth-token your-token

# 3) Add a local service from source (mcp1 -> ./mcp1.clarity)
npx clarityctl add mcp1

# Optional: add all .clarity services in a folder
npx clarityctl add-all ./examples --recursive

# 4) Inspect + wire clients once
npx clarityctl list
npx clarityctl bootstrap --clients codex,claude
```

Open the control layer: [http://localhost:4707/status](http://localhost:4707/status)

Bootstrap is not automatic by default. Run `clarityctl bootstrap --clients codex,claude` once, or use the status page "Client Bootstrap Config" section to configure and verify paths.

`clarityctl add <name>` compiles `<name>.clarity` to `.clarity/build/<name>.wasm`, then registers and starts it.

For local development (without build artifacts), you can still use:

```bash
npm run dev:daemon
npm run dev:ctl -- list
```

When auth is enabled, pass `--auth-token <token>` to `clarityctl` (or set `CLARITYD_AUTH_TOKEN`/`CLARITY_API_TOKEN` in the environment).

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
clarityctl remove <service_id> [--cleanup-artifacts]
clarityctl details <service_id> [--log-limit <n>] [--event-limit <n>] [--call-limit <n>]
clarityctl logs <service_id>
clarityctl auth providers
clarityctl auth validate <auth_ref>
clarityctl auth list-secrets
clarityctl auth set-secret <auth_ref> <secret>
clarityctl auth delete-secret <auth_ref>
clarityctl bootstrap --clients codex,claude
clarityctl doctor
```

`clarityctl doctor` now validates daemon connectivity, compiler availability, and local build workspace readiness.

Quality commands:

```bash
npm run lint
npm run format
npm run test
npm run test:coverage
```

Legacy compatibility commands (still supported):

```bash
clarityctl add-local --source <file.clarity> --module <name> --wasm <file.wasm>
clarityctl start-source --source <file.clarity> [--module <name>] [--wasm <file.wasm>]
```

---

## Current Status

Implemented for v0.9 baseline:

- service contracts and manifest schema (`clarity.runtime/v1`)
- persistent registry (`.clarity/runtime/registry.json`)
- daemon HTTP API and status page
- add/list/start/stop/restart/introspect/remove flows
- gateway `/mcp` JSON-RPC endpoint (`initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`)
- built-in runtime control MCP tools (`runtime__status_summary`, `runtime__list_services`, `runtime__get_service`, `runtime__get_logs`, `runtime__start_service`, `runtime__stop_service`, `runtime__restart_service`, `runtime__refresh_interface`, `runtime__unquarantine_service`, `runtime__remove_service`, `runtime__get_audit`, `runtime__validate_auth_ref`, `runtime__auth_provider_health`, `runtime__list_auth_secrets`, `runtime__set_auth_secret`, `runtime__delete_auth_secret`)
- built-in Clarity-assist MCP tools (`runtime__clarity_help`, `runtime__clarity_sources`, `runtime__clarity_project_structure`, `runtime__ensure_compiler`, `runtime__bootstrap_clarity_app`) for default-language guidance, source discovery, app scaffolding, compiler readiness/install checks, and one-call bootstrap
- gated MCP self-provisioning tools (`runtime__register_local`, `runtime__register_remote`, `runtime__register_via_url`, `runtime__apply_manifest`) protected by `CLARITY_ENABLE_MCP_PROVISIONING=1`
- stdio bridge mode via `clarityctl gateway serve --stdio`
- compiler-assisted onboarding via `clarityctl add <service>` (compile + register + start + introspect)
- local function execution tools for local services (`<namespace>__fn__<exported_function>`)
- baseline remote policy controls (timeout + allowed-tools + payload-size + concurrency manifest policy + optional host allowlist)
- bootstrap writers for Codex/Claude config files
- durable runtime telemetry store (`.clarity/runtime/telemetry.json`) for events + service logs across daemon restarts
- deprovision endpoint/tooling with optional local artifact cleanup
- end-to-end runtime integration tests covering API/MCP registration/call/remove lifecycle

Not implemented yet:

- direct native `clarityc start` command in the compiler repo (runtime side is ready via `clarityctl add`; compiler integration should make runtime an explicit requirement)
- remote auth/policy isolation hardening for stricter multi-tenant trust boundaries

---

## Roadmap

- [x] Runtime-side compiler path (`clarityctl add <service>`)
- [ ] Native compiler command (`clarityc start <file.clarity>`) in `LLM-lang`
- [x] Add policy engine baseline (timeouts, allowlists, concurrency, payload limits)
- [ ] Complete remote auth/policy isolation hardening (provider backend + validation + file-secret lifecycle landed)
- [x] Add MCP self-provisioning tools (LLM can register/install services via MCP with approval + policy gates)
- [x] Add quarantine/recovery and richer health diagnostics
- [x] Add interface diffing and audit/event timeline

## Progress Snapshot

| Area                           | Status          | Notes                                                                                                                                                                                                                               |
| ------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry + lifecycle           | Done            | Persistent service records, start/stop/restart, health state                                                                                                                                                                        |
| Gateway MCP transport          | Done            | `/mcp` JSON-RPC with list/call routing                                                                                                                                                                                              |
| Runtime as MCP control plane   | Done            | `runtime__*` tools for status, service ops, logs, audit, quarantine recovery                                                                                                                                                        |
| Stdio gateway bridge           | Done            | `clarityctl gateway serve --stdio` forwards to daemon gateway                                                                                                                                                                       |
| Remote MCP proxying            | Done (baseline) | Initialize/introspect/tool forwarding                                                                                                                                                                                               |
| Compiler-driven onboarding     | In progress     | Runtime side done; native `clarityc start` implemented in `LLM-lang` branch and pending merge                                                                                                                                       |
| Local function execution       | Done (baseline) | `<namespace>__fn__*` tools discovered from wasm exports and executed via compiler runtime                                                                                                                                           |
| In-process WASM host execution | Done            | Local function tools execute directly via wasm instantiate/call in runtime                                                                                                                                                          |
| Auth/policy hardening          | In progress     | Timeout/allowed-tools/payload-size/concurrency/host-allowlist baseline implemented; auth provider backend (`legacy env`, `env`, `file`, `header_env`) + validation/secret lifecycle tools added; isolation policy hardening pending |
| MCP self-provisioning          | Done (gated)    | `runtime__register_local`, `runtime__register_remote`, `runtime__apply_manifest` behind `CLARITY_ENABLE_MCP_PROVISIONING=1`                                                                                                         |
| Durable audit/log persistence  | Done            | Events + service logs persisted to `.clarity/runtime/telemetry.json` and reloaded on daemon boot                                                                                                                                    |
| Deprovision + cleanup          | Done            | `DELETE /api/services/:id` and `clarityctl remove` with optional local artifact cleanup                                                                                                                                             |
| Runtime integration tests      | Done (baseline) | End-to-end API/MCP tests for register/start/introspect/call/remove                                                                                                                                                                  |

---

## Spec

- Runtime spec: `docs/spec/v1/runtime-spec.md`
- Manifest schema: `schemas/mcp-service-v1.schema.json`
- Layered requirements: `docs/requirements/layered-runtime-requirements.md`

## Remote Policy Knobs

- `add-remote --timeout-ms <ms>`: set per-service remote request timeout.
- `add-remote --allow-tools <tool_a,tool_b>`: restrict callable remote tools.
- `add-remote --max-payload-bytes <bytes>`: set max request/response payload bytes per remote service.
- `add-remote --max-concurrency <n>`: set max concurrent in-flight remote requests per service.
- `add-remote --auth-ref <ref>`: remote auth reference (supports `legacy-name`, `env:ENV_VAR`, `file:relative/path`, `header_env:Header-Name:ENV_VAR`).
- `CLARITY_REMOTE_ALLOWED_HOSTS=host1,host2`: optional global remote host allowlist.
- `CLARITY_REMOTE_DEFAULT_TIMEOUT_MS=20000`: default timeout when manifest timeout is not set.
- `CLARITY_REMOTE_MAX_PAYLOAD_BYTES=1048576`: default max request/response payload bytes when manifest value is not set.
- `CLARITY_REMOTE_MAX_CONCURRENCY=8`: default max in-flight remote requests per service when manifest value is not set.
- `CLARITY_REMOTE_AUTH_FILE_ROOT=/absolute/path`: optional root directory for `file:` auth refs (defaults to `.clarity/secrets` under workspace).
- `CLARITY_ENABLE_MCP_PROVISIONING=1`: enable runtime MCP self-provisioning tools (`runtime__register_*`, `runtime__apply_manifest`).
- `CLARITY_ENABLE_COMPILER_INSTALL=1`: allow `runtime__ensure_compiler` to execute install commands.
- `CLARITY_COMPILER_INSTALL_ALLOWLIST=brew,apt-get`: optional installer command allowlist for `runtime__ensure_compiler`.

## Security Defaults

- If `CLARITYD_AUTH_TOKEN` is set, all `/api/*` and `/mcp` requests require that token via `Authorization: Bearer <token>` or `x-clarity-token`.
- If no token is set, runtime APIs are limited to loopback callers only.
- Status UI accepts `?token=<token>` for local browser sessions when token auth is enabled.

## Audit And Events

- `GET /api/audit?limit=200`: latest runtime audit/events.
- `GET /api/events`: SSE stream for live runtime events.
- Status page now includes an audit timeline and `Unquarantine` action for quarantined services.
- Telemetry persists across daemon restarts in `.clarity/runtime/telemetry.json`.
- Auth lifecycle/validation APIs:
  - `GET /api/security/auth/providers`
  - `GET|POST /api/security/auth/validate`
  - `GET /api/security/auth/secrets`
  - `POST /api/security/auth/secrets` (requires `CLARITY_ENABLE_MCP_PROVISIONING=1`)
  - `DELETE /api/security/auth/secrets` (requires `CLARITY_ENABLE_MCP_PROVISIONING=1`)
- Service deprovision API:
  - `DELETE /api/services/:serviceId` with optional body `{ "cleanup_artifacts": true }`

## CI/CD And GitHub

- PR CI: `.github/workflows/build.yml` (branch naming + build + lint + format + test).
- Snapshot packaging on every merge/push to `main`: `.github/workflows/snapshot.yml` (includes coverage gate and uploads snapshot artifact).
- Tagged release pipeline: `.github/workflows/release.yml` (build, test, coverage, package, checksums, GitHub Release assets).
- Automated versioning/changelog PRs: `.github/workflows/release-please.yml` (`.release-please-*.json` config).
- Security gates:
  - `.github/workflows/dependency-review.yml`
  - `.github/workflows/codeql.yml`
  - `.github/workflows/secret-scan.yml`
- Repo automation:
  - Dependabot: `.github/dependabot.yml`
  - CODEOWNERS: `.github/CODEOWNERS`
  - PR/Issue templates: `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/*`
  - Label sync + path labeling: `.github/workflows/labels-sync.yml`, `.github/workflows/labeler.yml`, `.github/labeler.yml`
  - Optional project auto-add: `.github/workflows/project-automation.yml` (set `GH_PROJECT_URL` variable and `ADD_TO_PROJECT_PAT` secret)

### Required GitHub Settings (Manual)

- Protect `main`:
  - Require pull requests before merge
  - Require status checks to pass before merge
  - Require branches to be up to date before merge
  - Require linear history
- Merge strategy:
  - Enable squash merge
  - Disable merge commits
- Optional hardening:
  - Restrict who can push to `main`
  - Require review from Code Owners

You can apply a baseline branch-protection policy with:

```bash
./scripts/github/apply-branch-protection.sh <owner> <repo>
```

### Commit/Release Convention

- Use conventional commit prefixes so release automation can infer version bumps:
  - `feat: ...`
  - `fix: ...`
  - `chore: ...`
  - `docs: ...`
  - `refactor: ...`
- Use `BREAKING CHANGE:` in commit bodies for major bumps.

## Contributing

This repo uses trunk-based development:

1. Keep `main` releasable at all times.
2. Branch from `main`, keep branches short-lived, and merge back quickly.
3. Name every branch by the expected outcome (not implementation details):
   - `result/<outcome-kebab-case>`
   - `hotfix/<outcome-kebab-case>`
   - `codex/<outcome-kebab-case>`
   - (automation exception) `dependabot/*`
4. Open a PR to `main` with behavior/rationale notes.
5. Ensure CI is green (`.github/workflows/build.yml`: branch-name check + build + lint + format + test).

For larger architecture changes, open an issue first to align on the control-plane contract.
