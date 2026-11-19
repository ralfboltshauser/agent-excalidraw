# Embedded canvas code review

Reviewed 2026-11-19 against the working tree based on `373754a029c703590b8aa072bc6ff15623559972`. The implementation is uncommitted and the parent is continuing host verification; this report describes the source read during this review.

## Result

**No actionable correctness, privacy or maintainability defects found in the requested scope.** No severity-ranked findings or reproducible defect triggers to report. This is a bounded code review, not acceptance of every embedded milestone or host.

Read the embedded implementation plan, milestone follow-up, implementation log, verification ledger and E0 consumer report. Reviewed `src/shared/presentation.ts`, `src/main/canvas-presentation.ts`, the presentation-related main/controller diffs, `src/cli/mcp-apps.ts`, `src/cli/mcp.ts`, all `src/embedded/*`, `scripts/build-embedded.mjs`, build/package integration, and the presentation/MCP/viewer tests and added Electron integration journeys.

## Specific conclusions

- **Document lifetime:** `src/main/canvas-presentation.ts:36–50, 89–105, 144–150` checks scope, active document, epoch and expiry, including after asynchronous work and on chunk reads. `src/renderer/controller.ts:646–653, 1025–1035, 1366–1376` independently checks renderer identity and revision. Main activation/rebind/close paths change epoch or clear the active document. I found no route that follows a newly active document through an old binding.
- **Saved status and freshness:** `src/main/canvas-presentation.ts:106–122, 153–157` separates pixel revision from dirty/saving/title state and excludes observation time from state identity. `src/embedded/session.ts:74–95` commits a frame token only after successful assembly/decode/commit; busy replies do not acknowledge undelivered pixels. The parent's transfer-retry/cache-expiry correction is present and its regression test passes.
- **Immutability and bounds:** `src/main/canvas-presentation.ts:73–82, 94–101, 129–151` retains bounded immutable byte buffers, validates ranges and image budgets, and refuses publication after a changed capture. Scope binding limits, idle/hard expiry, asset expiry, two retained captures and the global byte cap have focused tests. `src/embedded/protocol.ts` validates identity, exact chunk metadata/base64 lengths, PNG dimensions and SHA-256 before decoding; the session serializes reads and rejects late generations.
- **Model/app boundary:** `src/cli/mcp-apps.ts:27–40, 48–78` negotiates Apps support, declares app-only reads, keeps successful read bytes out of text/image blocks, returns binding metadata without the runtime scope, and serves one static resource with empty network-domain allowlists. `src/cli/mcp.ts` declares the existing domain tools model-only for Apps clients. These declarations require host enforcement; they do not make the host or provider unable to retain app data. The viewer does not send messages or update model context automatically.
- **Packaging:** `src/cli/mcp-apps.ts:26` resolves the resource relative to the bundled CLI module. `scripts/build-embedded.mjs:6–17` bundles the browser entry and inlines CSS/JS without source maps; line 13 uses replacement callbacks, so replacement-string `$` interpretation cannot corrupt the bundle. Build integration includes the viewer in license discovery, and package allowlists include `dist/embedded`. The installed launcher uses Electron as its Node runtime (`src/main/integrations.ts:57–66`). Source inspection found no new dependency on external Node in that route.

## Validation performed

Ran only the focused non-GUI tests:

```sh
node --import tsx --test tests/presentation.test.ts tests/mcp-apps.test.ts tests/embedded-ui.test.ts
```

Result: **24 passed, 0 failed, 1 skipped**. The skipped case is the opt-in browser/SDK journey. Also ran `git diff --check` over the requested implementation paths; it reported no whitespace errors. No application code, build output or host configuration was changed by this review.

## Limits and validation suggestions

No GUI, build, packaging, configuration or host-provider operation was run, and no other agent was started. The reported actual T3 E0 app-only read and full real-stdio/native-editor/viewer pipeline passes are parent evidence, not independently repeated here.

For the parent's remaining validation, bind results to the exact packaged bytes: exercise the installed launcher with external Node absent and a cwd outside the repository, read the embedded resource through real stdio, and check that the resulting HTML loads without separate assets. This review establishes the source wiring, not final artifact completeness.

Continue the already planned host checks for old-card refusal after adapter/app restart and close/reopen, and for hidden/remounted cards and interrupted transfers. The module tests establish deterministic contracts; they do not establish host visibility enforcement, retained-history behavior, actual provider transcript routing or long-duration memory/latency behavior. None of these unrun lanes is asserted here as a defect.
