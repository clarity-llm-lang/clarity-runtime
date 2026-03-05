# Changelog

## [0.8.1](https://github.com/clarity-llm-lang/clarity-runtime/compare/v0.8.0...v0.8.1) (2026-03-05)


### Bug Fixes

* **runtime:** keep HITL active when chat mode disabled ([715bc47](https://github.com/clarity-llm-lang/clarity-runtime/commit/715bc47a41cfbec04b282c614ae8e3c86ffdb959))

## [0.8.0](https://github.com/clarity-llm-lang/clarity-runtime/compare/v0.7.0...v0.8.0) (2026-03-05)


### Features

* add per-agent runtime chat configuration ([e13cb7c](https://github.com/clarity-llm-lang/clarity-runtime/commit/e13cb7c2e5657e8a973e14f16ce2a6577ad53812))
* add per-agent runtime chat configuration ([36d9f8c](https://github.com/clarity-llm-lang/clarity-runtime/commit/36d9f8c0b0190b229f429e5219404177bac0416c))
* add runtime HITL chat executor for run-scoped replies ([d20e32f](https://github.com/clarity-llm-lang/clarity-runtime/commit/d20e32ff6c7b243660356509aaa448ce62923931))
* add runtime HITL chat executor for run-scoped replies ([61cb618](https://github.com/clarity-llm-lang/clarity-runtime/commit/61cb6189dd01127337b537c998d13af8a1750eb7))


### Bug Fixes

* **ci:** regenerate valid package-lock for npm ci ([15fe3de](https://github.com/clarity-llm-lang/clarity-runtime/commit/15fe3de0e7752c5c1c9e1993ff9327ab5cf4d473))
* enable local wasm chat handlers for runtime chat ([1281275](https://github.com/clarity-llm-lang/clarity-runtime/commit/1281275c6137e11c5300cb398f8e8c5aaecd5d45))
* resolve merge regressions in runtime gateway ([a84d0c4](https://github.com/clarity-llm-lang/clarity-runtime/commit/a84d0c4b8bd0aac357f05112620dd5022f12a489))

## [0.7.0](https://github.com/clarity-llm-lang/clarity-runtime/compare/v0.6.0...v0.7.0) (2026-02-25)


### Features

* add run-scoped agent events SSE stream ([9a0044c](https://github.com/clarity-llm-lang/clarity-runtime/commit/9a0044c53cd17209073ea8a8338a0c52f58e810b))
* add run-scoped agent events SSE stream ([78f13ba](https://github.com/clarity-llm-lang/clarity-runtime/commit/78f13ba1efa3097540b0cebee64b5adfae93b42c))
* add run-scoped agent events SSE stream ([ec7ad9d](https://github.com/clarity-llm-lang/clarity-runtime/commit/ec7ad9de12b35ca216bec557a1c421e7ec1fa90b))
* add run-scoped agent events SSE stream ([7988d63](https://github.com/clarity-llm-lang/clarity-runtime/commit/7988d63eb278b753ecf9fcd62683d585faa74637))


### Bug Fixes

* make gateway compile against current mcp router api ([be99ec4](https://github.com/clarity-llm-lang/clarity-runtime/commit/be99ec49e8d81853342ea055a4e16ed593aa2659))
* resolve runtime build type errors in gateway ([0e1cb90](https://github.com/clarity-llm-lang/clarity-runtime/commit/0e1cb90fb43bbb41c33caa54e2e9575191ecfd36))
* restore snapshot build on main ([612aa15](https://github.com/clarity-llm-lang/clarity-runtime/commit/612aa155baabb5b1a15f6e61fd5afe7e763a6a86))

## [0.6.0](https://github.com/clarity-llm-lang/clarity-runtime/compare/v0.5.0...v0.6.0) (2026-02-24)


### Features

* **agents:** enforce trigger context and unify runs in agent UX ([80a9552](https://github.com/clarity-llm-lang/clarity-runtime/commit/80a95525fd7b635451282d939b65f28e29fe2891))
* **agents:** require declared triggers and enforce run trigger policy ([74aab63](https://github.com/clarity-llm-lang/clarity-runtime/commit/74aab63af1680686ddb1fe7f28143f6694fac0b2))
* **runtime:** enforce explicit agent service descriptors ([6daeeb5](https://github.com/clarity-llm-lang/clarity-runtime/commit/6daeeb58ad72faf593eecd837316fc8100726609))
* **runtime:** enforce explicit agent service descriptors ([5b677e0](https://github.com/clarity-llm-lang/clarity-runtime/commit/5b677e04d7d7babcf90d0ac609d4d530cfa4ff49))
* separate agent services from mcp services ([16983c1](https://github.com/clarity-llm-lang/clarity-runtime/commit/16983c10344d331e4ee2a728c557f7144e2b6f79))
* **ui:** clarify a2a box with agentId and orchestrator ids ([8286398](https://github.com/clarity-llm-lang/clarity-runtime/commit/82863987445e91fcac1e36c574852ced55df6439))
* **ui:** generate agent-specific standard flow from metadata and runs ([bc976ce](https://github.com/clarity-llm-lang/clarity-runtime/commit/bc976ce71939135fc33ef7fda901382b76d18d49))
* **ui:** render observed trigger interfaces and simplify agent runs column ([bbf44c1](https://github.com/clarity-llm-lang/clarity-runtime/commit/bbf44c19657f2ae5210c1a7aa18b3d969512ef7e))
* **ui:** show agent dependencies and visual flow strip ([53a6fc5](https://github.com/clarity-llm-lang/clarity-runtime/commit/53a6fc56d8dd9ced344c8acb6dad74770030bf15))
* **ui:** show dependency status and deep-link services ([29dfdfa](https://github.com/clarity-llm-lang/clarity-runtime/commit/29dfdfae6df1f23e37fe43cfc20318d3964f79bd))


### Bug Fixes

* **agents:** remove call trigger and enforce timer|event|api|a2a ([b28df47](https://github.com/clarity-llm-lang/clarity-runtime/commit/b28df47e6aa8705216ce4cdbaceb4a14b977048d))
* **ui:** escape agent flow newline in embedded script ([dd61d84](https://github.com/clarity-llm-lang/clarity-runtime/commit/dd61d8480d021d9d78e26c5179f37b085d532d85))

## [0.5.0](https://github.com/clarity-llm-lang/clarity-runtime/compare/v0.4.0...v0.5.0) (2026-02-21)


### Features

* add v0.9 agent observability and roadmap ([f0ae79f](https://github.com/clarity-llm-lang/clarity-runtime/commit/f0ae79f49173b309a9ade23f7bac8c3467676803))
* audit only mcp tool calls and suppress secret lifecycle logs ([4d4090d](https://github.com/clarity-llm-lang/clarity-runtime/commit/4d4090d10b86e8217034db51afa697edc714b8bf))
* finalize runtime v0.9 UI and docs updates ([9d5a10b](https://github.com/clarity-llm-lang/clarity-runtime/commit/9d5a10b2fc5643bdc5e0ebf6baf881fca5d8795b))


### Bug Fixes

* add bootstrap panel minimize toggle ([b4ecf60](https://github.com/clarity-llm-lang/clarity-runtime/commit/b4ecf603d8eac2d2152ed79c6e324cfeb17f5914))

## [0.4.0](https://github.com/clarity-llm-lang/clarity-runtime/compare/v0.3.0...v0.4.0) (2026-02-21)


### Features

* split runtime vs clarity tools and harden bootstrap ([9607d48](https://github.com/clarity-llm-lang/clarity-runtime/commit/9607d4813e981e7225df6839637396dda06af282))

## [0.3.0](https://github.com/clarity-llm-lang/clarity-runtime/compare/v0.2.0...v0.3.0) (2026-02-21)


### Features

* implement v0.9 runtime durability and deprovisioning ([fcf2142](https://github.com/clarity-llm-lang/clarity-runtime/commit/fcf2142a75e6b286c92be5936bf143c5c8103107))
* implement v0.9 runtime durability and deprovisioning ([554794b](https://github.com/clarity-llm-lang/clarity-runtime/commit/554794b494670a6194d7035d2d91295b6c12ccc5))

## [0.2.0](https://github.com/clarity-llm-lang/clarity-runtime/compare/v0.1.0...v0.2.0) (2026-02-21)


### Features

* expand runtime control plane with audit and provisioning ([3229a5a](https://github.com/clarity-llm-lang/clarity-runtime/commit/3229a5ae87abd7389feb7bd4619449b7a7e4ec69))


### Bug Fixes

* repair malformed package-lock for release-please ([f8680d9](https://github.com/clarity-llm-lang/clarity-runtime/commit/f8680d95ad400e497e0c6a0c16d4f36891de65fc))
