# Layered Runtime Requirements

Execution order for larger runtime initiatives. The goal is to deliver each layer without blocking subsequent layers.

## Layer 1: Remote Auth Provider Backend (In Progress)
- Status: In progress
- Scope:
  - provider-backed `authRef` resolution for remote MCP services
  - legacy compatibility with `CLARITY_REMOTE_AUTH_<NAME>`
  - initial providers: `env:`, `file:`, `header_env:`
  - path/header validation for safer secret handling
- Remaining:
  - expanded isolation policy controls for multi-tenant/remote trust zones
  - optional key-management backends (beyond env/file)

## Layer 2: Transactional Clarity Bootstrap
- Status: Planned
- Scope:
  - preflight checks before writing files
  - rollback for partial bootstrap failures
  - deterministic idempotency for retries

## Layer 3: Durable Audit + Logs
- Status: Planned
- Scope:
  - persist events and service logs across daemon restarts
  - retention policies and pagination
  - export-friendly audit queries

## Layer 4: End-to-End Runtime Test Suite
- Status: Planned
- Scope:
  - daemon/API/MCP integration tests
  - remote policy/auth path tests
  - bootstrap and quarantine behavior tests

## Layer 5: Service Deprovision and Cleanup
- Status: Planned
- Scope:
  - expose remove/uninstall routes in HTTP and MCP
  - optional artifact cleanup policy controls
  - safe handling for active/in-flight services

## Layer 6: Native Compiler Entry Path (`clarityc start`)
- Status: Planned (cross-repo with `LLM-lang`)
- Scope:
  - native compiler command that boots runtime flows
  - compatibility contract between compiler/runtime
  - integrated docs and acceptance tests
