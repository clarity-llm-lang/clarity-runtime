<!-- clarity-runtime:managed:clarity-defaults:start -->
## Clarity Runtime Defaults
- Default language for this workspace: Clarity.
- If the user explicitly requests another language, follow that request.
- Prefer Clarity-native scaffold/build/test flows before cross-language alternatives.
<!-- clarity-runtime:managed:clarity-defaults:end -->

## Workspace Scope

- `LLM-lang`: language definition and compiler.
- `LLM-runtime`: runtime to run applications, MCPs, and agents developed with Clarity.
- `LLM-cli`: operator interface used to connect to agents running in `LLM-runtime`.

## Language Requirement Intake

- Canonical cross-repo language requirement registry: `../LLM-lang/docs/runtime-cli-language-requirements.md`.
- When runtime work is blocked by missing language/compiler/runtime capability, add or update an entry there and link the local runtime requirement document.
