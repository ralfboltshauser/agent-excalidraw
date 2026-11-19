# Verification ledger

Updated 2026-11-19. Results below describe observed builds and fixtures, not universal guarantees or user acceptance. Public source: https://github.com/ralfboltshauser/agent-excalidraw.

Release scope: **macOS first**, explicitly directed by Ralf. Windows/Linux remain future targets; their incomplete signing/distribution gates do not block the Mac release. Native CI results stay visible.

## Current evidence

- macOS arm64 reference host: Apple M2 Max, 64 GB, Darwin 25.5. Typecheck and **50 file/CLI/installer tests** passed after dependency updates. Installer failure tests use real temporary files with explicit mocked download/signature seams; they do not establish Gatekeeper acceptance.
- **23 real Electron source journeys passed together** after the workflow expansion. A final export-preview presentation fix receives a targeted rerun; the complete suite is also required against the final packaged build.
- Screenshots were inspected for welcome, light/dark library, editor, file/location, settings, agents, help, search, export, read-only, recovery, missing-file/Locate, integration disconnect and cleanup. Exact captured export bytes, native Trash and real image resources are checked independently of screenshots.
- The earlier packaged Mac arm64 baseline passed nine journeys. Its 282 MB archive had no node_modules, retained notices, and the verified OFL-derived fallback font. A later source pass is not a pass for a new package; final package/offline/performance runs remain pending below.
- Independent CLI consumer completed a real create/refine/view/save/reopen workflow. A fresh packaged-CLI audit confirmed all21 MCP schemas match the CLI and real stdio status works, including Node22.23.5. Isolated skill preview/install/reinstall/uninstall preserved real global integrations. [Consumer report](../verification/consumer-trial.md).
- Native CI at `f1db3b3`: **Windows x64 and Mac Intel source/package nine-journey lanes passed**. Mac arm64 was cancelled; Linux stopped before testing because its lazily downloaded sandbox helper was absent. The workflow now explicitly downloads the pinned Electron runtime before configuring its official sandbox helper. The next commit must actually run these lanes.
- Latest dependency audit reports **zero known advisories** in the locked tree. Updated esbuild and overridden KaTeX/minimatch are validated by build/module/native tests; this is not a universal security guarantee. Their primary advisories are [esbuild](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr), [KaTeX](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7) and [minimatch](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249).

## Milestone status

| Gate | Observed | Still required before acceptance |
|---|---|---|
| M0 Product design | Implementation authorized against32flows; actual product screens inspected | User visual acceptance remains distinct |
| M1 Editor/platform proof | Live SDK, stale checks, native batch Undo/Redo, human gestures, pending-cancel, stale-load and joint background/shape batches pass on Mac source | Final Mac architecture/package runs; remaining IME/crop edge coverage; future OS results tracked separately |
| M2 Files/recovery | Real bytes/reopen, PNG resources, source conflicts, crash recovery, read-only copies, accurate close/quit, deleted-content filtering and uncertain publication tests | Remaining slow/failing-write and filesystem evidence; arbitrary network drives are not guaranteed |
| M3 Daily manual UX | Library/create/open/rename/star/search, keyboard quick switch, recency, folder new/refresh/removal, Locate and actual Trash covered | Physical shortcuts, Finder association/reveal and final packaged walkthrough |
| M4 CLI agent workflow | Independent CLI loop, stable IDs, epoch refusal, co-editing, Stop, session isolation and exact captured render/export verified | Five-task quality trial; final package consumer workflow |
| M5 Setup/MCP | Real CLI/MCP parity; isolated GUI setup/removal, owned symlinks across homes, Node22 consumer verified | Final packaged ASAR launcher/global discovery; trusted release bootstrap |
| M6 Quality/performance | Expanded screenshots inspected; export preview/scale/captured bytes, windowed10k library and targeted UX corrections | Full performance/memory run, five design tasks and remaining accessibility review |
| M7 Platform lifecycle | Mac package baseline runs; valid local signing identity; existing notarization routes investigated | Final package/offline/native installation evidence. **Notarization blocked: saved Xcode account cannot log in.** [Trust report](../verification/macos-trust.md) |
| M8 Release candidate | Public source repo, screenshot-backed README, install/privacy/contributing/release docs, license inventory | Trusted downloadable assets, completed release evidence and user acceptance; no npm registry publication claimed |

Runtime reports are local ignored `artifacts/e2e-report` and `artifacts/packaged-e2e-report`; CI retains screenshots/traces/synthetic fixtures for each exact build. Never upload endpoint.json or capability tokens. The offline audit script has been authored and syntax checked, **not yet run**. A stopped overlapping benchmark is invalid evidence and is not counted as a result.

## Criterion template for each handoff

| Criterion / flow | Actual OS / arch | Build SHA | Synthetic fixture | Evidence                                           | Pass / fail / not run | Remaining limitation      |
| ---------------- | ---------------- | --------- | ----------------- | -------------------------------------------------- | --------------------- | ------------------------- |
| Exact criterion  | Declared host    | Pin build | Name/hash         | Files + logs + receipts/screenshots as appropriate | Not run               | State the unresolved case |

Record user acceptance separately: date, build, milestones reviewed, accepted changes and remaining blockers. Silence does not establish acceptance.
