# UX Review Brief: Runtime Control Plane

Date: 2026-02-22  
Audience: UX/Product Designer  
Requester: Runtime team

## Objective

Review the runtime control-plane UX for:

- Service operations (MCP + Agents tabs)
- Agent run observability
- HITL interactions
- Bootstrap configuration clarity

The goal is to validate whether the current UX communicates the value clearly and safely, and to identify high-impact design changes that improve operator confidence and speed.

## Product Context

Current surfaces:

- Status UI: `/status`
- API + MCP tools: runtime control tools and agent observability tools
- Key code surface:
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/web/status-page.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/http-api.ts`
  - `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/src/pkg/gateway/mcp-router.ts`

Reference analysis:

- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/docs/analysis/runtime-interface-personas-ux.md`
- `/Users/erikaxelsson/namnlös mapp 2/LLM-runtime/docs/analysis/runtime-ux-implementation-backlog.md`

## Core Personas To Evaluate

1. Runtime Operator:
   - Starts/stops services, checks health, handles quarantine.
2. Agent Orchestrator Designer:
   - Reads run traces, checks trigger behavior, evaluates dependencies.
3. HITL Operator:
   - Responds to pending human-review steps quickly and correctly.

## Review Questions

### A. Information Architecture

1. Is the split between `MCP`, `Agents`, and `Client Config` understandable?
2. Are system services vs user services mentally clear?
3. Are state, health, and policy concepts understandable without reading docs?

### B. HITL UX (Critical)

1. Does the current "Virtual CLI" clearly communicate two separate models:
   - run event input
   - broker queue Q/A
2. Is it clear what happens when the user presses Send in each mode?
3. Is the operator protected from unsafe/invalid actions (e.g. posting to completed runs)?
4. Is wording consistent (`hitl_input` vs `human_message`)?

### C. Run Observability

1. Is it easy to answer:
   - What triggered this run?
   - Where is it waiting/failing?
   - What happened before/after handoff?
2. Are flow and timeline views aligned or contradictory?

### D. Decision Support

1. Can users make confident operational decisions from one screen?
2. Which fields are noisy and should be hidden or collapsed?
3. Which missing cues cause hesitation or errors?

## Tasks For The Designer

1. Perform a heuristic review on current UI.
2. Propose IA improvements for tabs/panels.
3. Redesign HITL interactions (mandatory).
4. Propose improved run detail hierarchy (trigger, status, flow, timeline, decisions).
5. Provide mobile behavior notes for critical workflows.

## Required Deliverables

1. Prioritized findings list (`P0`, `P1`, `P2`).
2. Annotated wireframes (low or mid fidelity is fine).
3. Copy/content recommendations for labels/help text/tooltips.
4. Interaction rules (enabled/disabled states, errors, confirmations).
5. Final implementation notes mapped to components/sections.

## Output Format (Please Follow)

Use this structure in the review response:

1. Findings:
   - `ID`
   - `Priority`
   - `Problem`
   - `User impact`
   - `Recommendation`
2. Proposed IA:
   - tab/panel map
   - navigation model
3. HITL redesign:
   - mode model
   - decision states
   - error/guardrail behavior
4. Copy updates:
   - before
   - after
5. Open questions:
   - assumptions needing product decisions

## Implementation Handoff Rules

I (engineering) will receive this UX review and implement the accepted changes directly.

To make implementation unambiguous, include for each recommendation:

- target UI area (by visible section title)
- state transition rules
- validation or error conditions
- if behavior changes API expectations

## Acceptance Criteria For This UX Review

- The review explicitly addresses HITL design decisions.
- Recommendations reduce ambiguity in at least:
  - run state interpretation
  - HITL action intent
  - service summary understanding
- Recommendations are implementation-ready enough to map into backlog items.

