# Verification ledger

Updated 2026-11-19. Results describe observed builds and synthetic fixtures, not universal guarantees or user acceptance. [Public source](https://github.com/ralfboltshauser/agent-excalidraw).

Release scope is **macOS first**, explicitly directed by Ralf. Windows/Linux remain future distribution targets. Their native CI results are retained, but passing CI does not establish a signed installer or daily-use support.

## Evidence and build identity

- Local reference host: Apple M2 Max, 64 GiB, macOS arm64, Darwin 25.5.0. Typecheck and **58 module tests** and the **25-journey source suite** passed after the final background-renderer correction; these cover real temporary files, transport/process behavior, CLI parsing and installer seams. Mocked download/signature seams do not prove public download trust.
- **25 native Electron journeys passed together** against the signed arm64 package ASAR `b1123fe97a46c86a981bf6900b8ece9c6545ac717a6f4d38eea485844d94dbc0` in 59.3 seconds. Actual ASAR launcher execution without external Node, physical bundled license publishing and hidden-renderer viewport/selection are included. A separate native background probe without renderer CDP completed view in 175 ms and quit in 226 ms with saved bytes unchanged. The native window was hidden/minimized, although the DOM still reported visible; this is not proof of every OS visibility state.
- Native CI at `ae5c4a1` passed all four lanes: macOS arm64, macOS x64, Windows x64 and Linux x64, each exercising its source and packaged native suites. The final application-source run at `0d16d07` also passed all four lanes, including source and packaged 25-journey suites. [Exact native CI run](https://github.com/ralfboltshauser/agent-excalidraw/actions/runs/44582883785). CI packages are unsigned verification artifacts, not trusted release downloads.
- Screenshots were inspected for welcome, light/dark library, editor, title/location, settings, agents, help, quick switch, export, read-only, recovery, Locate, disconnect and cleanup. Actual disk bytes, image resources, captured exports, frame clipping and native Trash were checked separately from screenshots.
- The [offline/performance report](../verification/offline-and-performance.md) records exact-package audits, reference fixtures, 20-sample p95 measurements and 50 document switches. The final audit is bound to ASAR `b1123fe9…`, matching the packaged 25-case suite. Both normal-network and Chromium-offline profiles had zero observed remote requests during editing; all 234 font assets and self-contained SVG fallback/font notices were verified. This is not an OS firewall or complete-startup observation claim.
- The [installed Mac report](../verification/installed-mac.md) records native save/rename/Undo/Redo, Finder reveal/open, real global launcher/skill discovery and installed MCP edit/render/save preserving manual element IDs. Its own build identity determines coverage; do not assume an older installed walkthrough verified later package bytes.
- An independent installed-CLI consumer completed a create/refine/view/save/reopen loop using public commands, without implementation-source access. CLI/MCP schemas match all 21 tools; real stdio and Node 22 consumer calls passed. Isolated install/reinstall/removal preserved unrelated integrations. [Consumer report](../verification/consumer-trial.md).
- A separate five-task synthetic diagram trial passed the documented readability rubric and preserved original IDs/bindings in the annotation/refinement fixtures. The renders were inspected; modest fixtures, simulated human sketch and one-dimensional layout limit the conclusion. [Design consumer report](../verification/design-consumer.md).
- The locked dependency audit reported zero known advisories after updates; packaged software/font notices and the modern OFL-derived fallback were checked. This is not a universal security guarantee. [Notices and provenance](../THIRD_PARTY_NOTICES.md).

## Milestone assessment

These rows separate observed engineering evidence from remaining criteria. They are not blanket milestone acceptance.

| Gate | Observed evidence | Remaining evidence or acceptance |
| --- | --- | --- |
| M0 Product design | F01–F32 specification, implementation authorization, actual screens inspected | User visual/content acceptance remains distinct; historical prototype is not native evidence |
| M1 Editor/platform boundary | Real SDK creation/bindings, human drag vs stale mutation, final renderer load guard, Stop/queued cancellation, native batch Undo/Redo; native architecture CI | Realistic IME composition, crop/line and delayed image paste/drop during agent admission remain explicit edge coverage |
| M2 Files/recovery | Exclusive creation, save/reopen/image resources, conflict refusal/copy, SIGKILL recovery copy, read-only copy, native close/quit, deleted-resource filtering, publication-uncertainty faults, recovery metadata crash window | Full UI delayed-save/later-edit and failed-destination recovery scenarios; broader case/Unicode/long-path/xattr and interrupted cross-volume filesystem evidence; no arbitrary-network-drive guarantee |
| M3 Manual workflow | Create/open/rename/star/search, keyboard quick switch, recency, folder create/refresh/removal, Locate, native Trash; installed Finder reveal/open and physical shortcuts | Final installed-candidate walkthrough identity; broader disconnected-root/OS-open/image-drop edge coverage and user UX acceptance |
| M4 CLI co-editing | Independent CLI-only task loops, stable IDs, revision/epoch guards, session Stop, delivery-aware errors, exact captured exports, five-task design trial | Complex concurrent edits/graphs are not implied by modest fixtures |
| M5 Setup/MCP | Actual 21-tool parity and stdio calls, isolated setup/removal, owned symlinks, real Codex discovery and installed optional MCP workflow | Trusted bootstrap/public download; actual Claude session was not exercised; filesystem discovery does not prove host/model use |
| M6 Quality/performance | Visual review, selection/frame export preview and exact output, scale controls, 10k library windowing, 20-sample timing and 50-switch memory diagnostics (+9.8% working set), five-task rubric | Complete keyboard/screen-reader/reduced-motion audit and user visual acceptance; switches reuse two scenes and do not establish a long-term memory plateau, retained-tab teardown or unique-image accumulation |
| M7 Install/offline/lifecycle | Signed local Mac build, installed manual/agent workflows, actual native architecture CI, offline font/image/save/export audit | **Public trust blocked by Apple account authentication/notarization**; final Intel native signed-download installation and clean-account update/rollback/uninstall evidence remain; see [trust report](../verification/macos-trust.md) |
| M8 Public release candidate | Public source, README/screenshots, install/privacy/contributing/release docs, license inventory and synthetic examples | Trusted downloadable assets, matching manifest/CLI artifacts, clean public-instructions consumer and user acceptance; no npm registry publication claimed |

## Remaining engineering checks versus distribution trust

The app launches and core manual/agent workflows have direct runtime evidence. Apple notarization failure is a public-download trust blocker, not a failed editor/runtime test. Do not bypass Gatekeeper or claim local signing establishes downloaded-app trust.

The unexercised engineering cases above also remain real criteria. Prioritize composition/concurrent interaction, delayed or failing save UI, and native lifecycle/filesystem boundaries before claiming every historical requirement is accepted. Runtime tests, module fault injection, visual review and user acceptance answer different questions; none substitutes for all the others. A CI configuration alone is never counted as execution.

The initial SVG audit found a CDN fallback font reference despite zero editing egress. The corrected pipeline embeds the verified replacement plus full font notices and rejects unresolved loading resources; subsequent real SVG audits passed. This history explains why app-network observation alone is insufficient export evidence.

## Reproduce and record

### Embedded viewer increment (0.2.0)

The [embedded verification report](../verification/embedded-canvas.md) records the new build separately from the historical 0.1 evidence above. Typecheck, 82 module cases, eight enabled viewer cases and 29 native journeys pass; all 29 also pass against signed arm64 ASAR `766ede6aeb9dc0cf2a6d497fdde2fbf3b5139d0edf19d95a045a5a405a100e7b`. That bundle is installed locally. Real T3 E0 bridge reads and production model-side calls succeeded, while production host visual qualification, secondary lanes and long-duration evidence remain distinct open gates. Test interruption at the user's request was honored; it is not counted as completed verification. No existing public trust gate is closed by this increment.

Run the actual suites and scripts from the repository root; see [offline/performance reproduction](../verification/offline-and-performance.md#reproduce), [native tests](../../tests/electron.e2e.ts), [non-renderer-CDP background probe](../../tests/native-background.ts), and [native CI workflow](../../.github/workflows/verify.yml). Generated reports/screenshots are local or per-run CI artifacts rather than committed report links. Never upload endpoint capability files, tokens, credentials or private drawings.

For each handoff record criterion/flow, actual OS/architecture, source and package identity, synthetic fixture, evidence, pass/fail/not-run, and limitation. Record user acceptance separately with date, build, reviewed milestones and accepted scope changes. Silence does not establish acceptance.
