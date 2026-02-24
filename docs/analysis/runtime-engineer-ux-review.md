# Runtime Engineer UX Review (Desktop Dense Mode)

Date: 2026-02-22  
Persona: Runtime engineer  
Primary workflows: service recovery, agent run debugging, testing  
Constraints: desktop-only, keep current visual style, dense/power-user UI

## Findings

### UX-RE-01 (P0): Mixed HITL mental model was error-prone

- Problem:
  - One mixed control handled two different interaction models:
    - run event injection
    - broker queue question/answer
- User impact:
  - High risk of sending the wrong action to the wrong backend path.
- Fix shipped:
  - Split into explicit side-by-side panes in the same workbench:
    - `Run Input (Event Stream)` (`POST /api/agents/runs/:runId/hitl`)
    - `Broker Queue (Questions/Answers)` (`GET /questions`, `POST /answer`, `POST /cancel`)
- Code:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`

### UX-RE-02 (P1): Debugging lacked fast narrowing controls

- Problem:
  - Agent table had no dense filter controls for status/trigger/HITL capability.
- User impact:
  - Slower root-cause isolation during failures and testing runs.
- Fix shipped:
  - Added filter strip:
    - free-text query
    - status filter
    - trigger filter
    - HITL-capable toggle
    - clear action
- Code:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`

### UX-RE-03 (P1): Recovery controls should avoid accidental churn

- Problem:
  - A direct `Restart` action increases accidental disruption risk during live debugging.
- User impact:
  - Unintended restart can erase transient state and hide root-cause signals.
- Decision:
  - Keep explicit `Start` and `Stop`; do not expose one-click restart in the table.
- Code:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`

## Validation

- Build:
  - `npm run build` passed.
- Tests:
  - `npm test` passed.
- Added UI render tests:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/tests/status-page.test.ts`

## Remaining UX Decisions

1. HITL speed vs safety policy:
   - current default favors safety guardrails (terminal run input disabled and server-side 409).
2. Advanced debugging density:
   - optional next step is per-run timeline filtering by event kind and trigger context keys.
