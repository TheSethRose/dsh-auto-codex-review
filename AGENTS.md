# AGENTS.md

## Scope

Standalone ESM JavaScript fork of DSH Auto review. Preserve the upstream policy, Session snapshot filtering, and pending-action identity checks. `upstream/` is an unmodified MIT baseline from DSH 0.2.0-rc.2; do not edit it.

## Commands

- `npm ci`: install locked dependencies and build.
- `npm run build`: esbuild bundles `src/index.js` into ignored `lib/index.js`; external packages remain external.
- `npm test`: existing Node test suites, using experimental module mocks for the external reviewer transport.
- `npm run check`: build plus keyless tests.
- `npm pack --dry-run`: inspect release payload.
- `npm run test:live`: opt-in ChatGPT-authenticated synthetic request; uses `DSH_CODEX_PATH` or `codex`, never executes the proposed action.

## Implementation

`client.js` is the hand-written Web companion that rewrites the two shipped `permission.access` Auto strings; it must stay guarded and reversible. `src/index.js` owns the Cordis gate and retained policy/snapshot code. `src/codex.js` owns config validation and isolated CLI lifecycle. `src/gateway.js` owns fixed request reconstruction and preventive SSE validation. Named plugin exports, no default export. Update source rather than generated `lib/`. Keep package.json and package-lock.json consistent.

## Security invariants

Reviewer model is always `codex-auto-review`; never fall back to the main agent, API keys, or another model. Endpoint, no-tool request, and closed decision protocol are fixed, not deployment options. Never forward tool-bearing events to the CLI or authorize incomplete streams. Failures, timeouts, cancellation, and invalid responses fail closed; downstream denial remains final. CLI process groups and gateway handlers must settle during teardown.

Do not read, log, commit, or publish login storage, bearer tokens, account routing, private prompts, or CLI stderr. Keep tests synthetic. Do not enable hooks, MCP, shells, plugins, project instructions, or user config in the reviewer process. Auto is not a sandbox: preserve the documented outer run_code/direct-Node-effects limitation. Do not promise free billing from fixed-model access.

## Change discipline

Keep this a focused upstream derivative, not a rewrite or broader test project. Run relevant existing checks after behavior changes, update affected README facts, and inspect the final package before publishing. Do not install into or modify a user DSH profile without explicit authorization.
