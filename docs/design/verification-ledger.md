# Verification ledger

Updated 2026-11-19. Results below describe observed builds and fixtures, not universal guarantees or user acceptance. Public source: https://github.com/ralfboltshauser/agent-excalidraw.

## Current evidence

- macOS arm64: typecheck, 25 real file/CLI tests and nine real Electron journeys passed. The same nine journeys passed against the actual packaged application.
- Actual screenshots were inspected in light/dark mode: welcome, library, editor, file/location, settings, agents, help, search, export, errors and recovery.
- Independent consumer installed the npm tarball in an empty directory: one package, no transitive dependencies, 3.7 MB installed. It created/refined/viewed/saved/reopened a diagram and exported verified transparent PNG/SVG through CLI only. [Report](../verification/consumer-trial.md).
- Package archive: 282 MB installed app; zero node_modules entries; Agent Sans fallback checksum matches the verified OFL derivative; software/font notices are present. This is not a notarized-download claim.
- First native CI install failed on missing optional peer lock entries. Clean regenerated lock passes npm10 validation. Next run reached actual Windows/Linux native tests: Windows7/9 passed, with canonical-path and crash-tree test failures being corrected; Linux required the official sandbox helper's correct owner/mode. Native rerun is pending. A configured runner is not a pass.

## Milestone status

| Gate | Observed | Still required before acceptance |
|---|---|---|
| M0 Product design | Implementation authorized against32flows and visual direction | User visual acceptance remains distinct |
| M1 Editor/platform proof | Live SDK, stale checks, native batch Undo/Redo, human gestures, pending-cancel and stale-load refusal pass on Mac source/package | Finish native all-OS lanes; remaining IME/crop/import edge coverage |
| M2 Files/recovery | Real bytes/reopen, PNG resources, source conflicts, crash recovery, read-only refusal, deleted-content filtering and publication-uncertainty tests | Complete remaining slow/failing-write/native-close cases and platform filesystem evidence |
| M3 Daily manual UX | Core library/create/open/rename/star/search/settings screens exercised and inspected | Missing/locate, native association, physical shortcut and lifecycle checks; remaining file-operation UX |
| M4 CLI agent workflow | Independent CLI design loop, stable IDs, epoch refusal; real co-editing and Stop verified | Remaining command/scene settings coverage and broader agent-quality trials |
| M5 Setup/MCP | Standalone bundled CLI/MCP initialization and parity; safe owned-link tests | Fix discovered skill-root guidance; actual packaged launcher and setup retry; clean release bootstrap |
| M6 Quality/performance | Nine native journeys and sampled visuals inspected; contrast corrections | Measured performance/large fixtures, remaining a11y and agent-quality tasks |
| M7 Platform lifecycle | Actual Mac package runs end-to-end; archive inspected | Native installer/update/uninstall/offline checks; Mac notarization and Windows publisher signing |
| M8 Release candidate | Public repository and pushed implementation | Polished public docs, distributable trusted artifacts, completed gates and user acceptance |

Current complete runtime reports: local ignored `artifacts/e2e-report` and `artifacts/packaged-e2e-report`; native CI retains screenshots/traces/synthetic files per build. Never upload endpoint.json or capability tokens.

## Criterion template for each handoff

| Criterion / flow | Actual OS / arch | Build SHA | Synthetic fixture | Evidence | Pass / fail / not run | Remaining limitation |
|---|---|---|---|---|---|---|
| Exact criterion | Declared host | Pin build | Name/hash | Files + logs + receipts/screenshots as appropriate | Not run | State the unresolved case |

Record user acceptance separately: date, build, milestones reviewed, accepted changes and remaining blockers. Silence does not establish acceptance.
