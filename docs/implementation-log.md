# Implementation log

## M0 — 2026-11-19

Implementation authorized against the existing visual direction and 32-flow specification. Created a standalone repository rather than modifying the unrelated parent project.

M0 design artifacts are ready for review; no claim of user visual acceptance is inferred. Future milestone handoffs retain pass/fail/not-run evidence.

## M1 — in progress

Pinned the published Excalidraw SDK and began the renderer-owned live document integration. File/CLI modules were developed in parallel behind typed interfaces to permit actual end-to-end proof. This development concurrency does not mean later gates have passed.

Changes discovered during integration review: final load admission must validate the prior renderer revision; notifications and delayed recovery need document/epoch identity; file/export commands require explicit agent document/epoch; nonactive trash must preserve active dirty state; image exports cannot overwrite existing source paths.

Platform lanes are separate: local macOS walkthroughs are possible here; native Windows/Linux CI must actually run before cross-platform acceptance. Public release signing and installer tests remain release blockers.

### Native M1/M2/M4 proof, macOS arm64

Five real Electron integration journeys passed: first-launch/library/settings/agents/help/export UI; CLI semantic creation, stable IDs, staleness, arrow movement, native one-step Undo/Redo, PNG/SVG and save/reopen; real mouse drag with busy/stale refusal; outside-file conflict/save-copy; SIGKILL/relaunch/recovery-copy. Actual screenshots and file artifacts were inspected. This does not pass the full platform or installer gates.

The keyboard failure was traced to the pinned SDK: changing `handleKeyboardGlobally` after mount removed local handling without installing its document listener. Keep it false and retain editor-local focus handling; native Electron Undo/Redo routes to the pinned editor action. Regression tests cover V/R and Cmd+Z/Shift+Cmd+Z.

The first clean CI install failed because the npm-generated lock omitted optional WASM peer entries required by npm10 on runners. Regenerate the lock in an empty directory and verify a clean npm10 install, rather than using the existing node_modules as proof.

Node CLI dependencies are bundled into one executable script. Standalone CLI/MCP initialization, all 20 tools, authenticated calls and version-matched guide passed in an isolated directory without node_modules. Build dependencies are development-only; the native package and npm consumer need no redundant drawing-engine node_modules tree.

### Further integration findings

Stop now interrupts pending font preparation and rejects previously queued session mutations; Resume admits newly considered work. Document load admission checks the previous renderer identity/revision before reset, and main publishes the new epoch only after acceptance.

Manual image import uses the SDK's supported file-input adapter. Playwright intercepts Chromium File System Access pickers with AbortError; this was an automation limitation, not proof of a broken native picker. Choosing the fallback before SDK import keeps file dialogs under a consistent adapter and prevents editor document-save paths from bypassing the native host. Manual image import/placement has two observed SDK history boundaries; the one-step requirement applies to agent batches.

Native file serialization removes deleted shapes and unused image resources. Read-only sources refuse replacement even when their directory would permit atomic rename. Errors after publication report WRITE_OUTCOME_UNKNOWN instead of asserting the original is unchanged.

Font audit found a legacy 1.05 fallback with different license provenance. It is replaced by a reproducible OFL-derived Agent Sans fallback, with original copyright retained and internal names changed. Printable ASCII advances and vertical metrics match; two other shared codepoints differ. Package inspection and actual fallback renders are release checks.

### Expanded native baseline

A clean build (143 bundled library notices), full typecheck and all nine real Electron end-to-end journeys passed together. Added actual PNG file-picker import, local binary persistence, native image Undo/Redo, reopen and render; pending real font preparation interrupted by Stop; queued edit cancellation; stale renderer load refusal; and navigation before creating any drawing. Screenshots were inspected. This is macOS arm64 evidence, not a signed download or other-OS pass.

### Packaged and consumer checks

Actual282MB macOS arm64 package passed the same nine real journeys. ASAR inspection confirmed zero node_modules entries, the verified OFL fallback hash, and retained dependency/font notices. The npm CLI tarball is679KB compressed and installs as one dependency-free package (~3.7MB). An independent consumer completed the full diagram loop using only installed public commands/guide; isolated skill-root setup was undiscoverable and will be corrected before M5 acceptance.

The all-OS run now reaches native tests after the lock correction. Windows passed 7/9; fixture short-path canonicalization and hard-crash process-tree cleanup need native recheck. Ubuntu's official Electron sandbox helper requires its standard root owner and 4755 mode. Configure that helper in ephemeral CI and retain sandboxing, rather than passing --no-sandbox. Native installer/public trust checks remain open.

## Release scope update

Ralf explicitly chose macOS for the first release because Windows publisher signing is not available yet. Keep Windows/Linux adapters, tests and CI; defer their support/download claims and distribution gates. Mac signing identity is available; existing notarization configuration is being discovered locally as requested, without asking Ralf to identify profile details again.

## Expanded daily workflows and final verification increment

Added renderer-synchronous background/shape batches with exact readback, native close/unload/quit, read-only copies, private paginated agent library queries,10k-row windowing, recovery metadata, safe shared-source skill ownership across homes, full quick-switch keyboard navigation, Locate, folder new/refresh/removal, actual Trash state reset, owned integration disconnect, and explicit preview cleanup. Exports now use a real captured preview, PNG resolution controls and exact preview-token bytes; later agent changes do not alter an approved export.

Source verification reached 50 module cases and 23 real Electron cases. Screenshot review corrected unrelated missing-reference actions, recovery grammar and unopened dates. The installed-theme bootstrap avoids a white first-paint flash. Public docs and synthetic screenshots were reviewed; source formatting was normalized for maintainability. Dependency updates remove all reported advisories in the current lock, and a clean temporary-directory lock generation preserves optional WASM peers needed by clean CI.

Signing is available. A synthetic signed Xcode archive export was actually attempted using the existing account; it failed account login. No profile or private key was found in the standard local configuration checked. Notarization remains an explicit external authentication gate; the local signed package, offline audit, performance run, final consumer trials and public release acceptance are separate evidence.

## Artifact privacy and packaged workflow verification

An actual offline artifact audit found that the pinned SDK's fallback SVG font rule referenced a CDN, despite zero observed remote requests while editing. The export pipeline now embeds the verified bundled Agent Sans bytes, includes complete notices for embedded fonts, and refuses unresolved loading resources. Stock SVG clipboard export bypassed that pipeline, so the pinned context action is hidden and the controlled export sheet provides Copy SVG. Actual SDK DOM/shortcut and clipboard-boundary regressions verify this integration; PNG copying remains available.

Added selected-frame PNG/SVG clipping and exact bounds/scale metadata, explicit web/local drawing links with guarded switching, and native JSON render cleanup of deleted resources. Fixed the packaged license viewer to publish a physical text copy before opening it through the OS. Actual installed launchers execute from ASAR with no external Node on PATH. Linux test cleanup now waits for inherited-pipe closure and kills only the owned detached process group; two process regressions reproduce the main-exited/descendant-open case.

Typecheck and 52 module cases pass. The complete24-case suite passes against source and the signed macOS arm64 package (ASAR SHA-256 `9a4265076549183af064b7a589b12169de64facc91d5b9c7d13c5b56096c2efa`). Screenshots and actual clipped output were reviewed. The separate five-task consumer produced readable diagrams and preserved fixture identities/bindings; reviewed synthetic examples are included in the repository. Final offline/performance runs and native host installation remain separately recorded gates.

## Installed Mac and background lifecycle increment

Installed the signed local app and bundled launcher in the real user account. Native manual drawing, Save, rename, Undo/Redo, Finder reveal/open and physical license notices worked. The canonical skill resolves through three host symlinks; Codex's actual discovery returned one enabled user skill. A real installed MCP client edited, rendered and saved the manually created drawing while preserving its original IDs and text. [Installed verification](verification/installed-mac.md) distinguishes these local checks from a trusted downloaded install.

The versioned installer parser and release asset naming were corrected after actual consumer/release checks. Canonical architecture-specific names prevent GitHub's filename normalization from breaking manifests. All 58 module tests passed. All four native CI source/package lanes passed at `ae5c4a1`; the subsequent background fix at `0d16d07` also passed all four native source/package CI lanes.

An installed-preview update attempt exposed a partial document-unload state while the app was backgrounded. The saved synthetic drawing remained intact. The controller previously awaited animation frames after loading/unloading and changing the viewport; those waits could depend on display scheduling. Synchronous React commits now establish the SDK's state/history baseline without waiting for a frame. All 25 source journeys pass, including bounded hidden-window viewport and clean-quit checks, unchanged revisions and saved bytes, and existing one-step Undo/Redo coverage. A separate native probe without renderer CDP completed view in 177 ms and quit in 255 ms. The original stall was not reproduced under automation, so these results establish the corrected scheduling contract and observed regression behavior rather than a deterministic reproduction of that exact stall.

Signed release artifacts remain draft-only. Existing Apple account authentication failed the actual notarization route; the signing certificate alone cannot resolve this external trust gate. No security protections or quarantine attributes were removed. Remaining milestone criteria are recorded in the ledger rather than inferred from successful core flows.

## Embedded canvas E0 — actual T3 bridge proof

Pinned Apps SDK 1.7.5 against MCP SDK 1.32.2. A synthetic stdio server was registered as a separate owned Codex test entry. A fresh consumer called its actual model-visible tool; T3 captured the declared UI resource. Native computer use then opened that actual T3 card, observed bridge initialization and clicked its app-only read button. The visible successful reply and synthetic server trace establish the primary T3/Codex round trip. No write approval appeared. The unrelated unsent draft remained preserved.

The synthetic visual exposed an initial-theme omission. Production UI must apply initial host context as well as later changes. Other hosts and provider lifecycle checks remain separate gates. The baseline 58 module tests and typecheck pass. Lockfile generation was repeated without node_modules/old lock in a temporary directory to retain the optional WASM peers that npm otherwise prunes. [E0 evidence](verification/embedded-e0-consumer.md).

## Embedded canvas 0.2 — shared implementation and packaged chain

Implemented renderer-backed in-memory observation/capture, scoped expiring bindings, bounded immutable PNG chunks, capability-negotiated MCP tools/resource, and one self-contained read-only viewer. Domain tools remain model-only for Apps clients. The viewer applies initial and subsequent host context, preserves pixels during decoding/errors, separates Save status from pixel revision, supports pan/zoom/Fit/pause/manual refresh, and refuses inactive document sessions. It adds no HTTP listener or second writable scene.

Real integration found and corrected three issues: frame delivery acknowledgements must be independent of cached asset lifetime; the discriminated read schema needs an explicit object root for actual MCP schema validation; and JavaScript inserted into HTML must use replacement callbacks to avoid `$` replacement-string corruption. Meaningful regression cases now cover those boundaries.

Typecheck, 82 ordinary module cases, eight enabled viewer cases and all 29 native source journeys passed. The same 29 journeys passed against signed arm64 ASAR `766ede6aeb9dc0cf2a6d497fdde2fbf3b5139d0edf19d95a045a5a405a100e7b`, including actual bundled-runtime/ASAR stdio resource reads with external Node absent from PATH. Screenshots were inspected. The verified bundle is installed locally with its predecessor retained as a backup; its launcher reports 0.2.0 and provides the new core guide.

Two independent production MCP consumers found the active synthetic drawing and called `show_canvas`. That is not yet a production visual pass. Claude Desktop reached real read approvals before interruption. The user requested tests stop while working; all owned runners/test apps were stopped and temporary registrations removed. On explicit resume, the complete package suite passed and the stress run restarted. Native computer use timed out twice, so production T3 pixels and secondary host workflows remain unqualified. [Current evidence and remaining gates](verification/embedded-canvas.md).

The clean npm/ASAR consumer passed installation, guide discovery, ordinary status, actual stdio negotiation/fallback and matching self-contained resource delivery. Its README setup-link finding was fixed. The installed 0.2.0 app launches through the existing global bundled-runtime launcher with its two library references preserved; Codex has one normal local MCP registration without a synthetic override. Temporary test registrations were removed.

Additional packaged checks cover an unsaved imported image and deny-by-default iframe CSP with blob image display. An opt-in actual polling measurement with 250 extra shapes and 20 stable edits observed p95 1,888 ms and maximum 1,898 ms from accepted receipt to decoded image swap. These are reference-host measurements, not installed T3/Claude performance claims. The public screenshot is labelled accordingly. Source was pushed at `d7f46dd`; workflow-only changes were excluded after OAuth workflow-scope rejection, while the existing four native source/package lanes run the new journeys unchanged.

The final test coverage commit `f7edf46` passed all four native source/package CI lanes. The exact signed package completed 1,800.001 seconds of real renderer-backed stress: six views, 8,392 requests, 678 frame deliveries, 112 edits/saves, 61 preservation checks and 59 native visibility cycles, with no recorded failure and a clean shutdown. Aggregate RSS ranged 564.4–683.3 MiB and ended 11.0% above the initial sample; the report records warm-up/history/allocation uncertainty rather than declaring leak freedom. Ordinary snapshot/apply/save p95 was 14.6/24.8/46.8 ms under this workload. Host visual qualification remains blocked by native automation timeouts; no production behavior was inferred from a returned HTML resource.

## Background drawing and local testing — 2026-11-25

CLI and MCP now start the local renderer hidden and leave desktop focus alone during ordinary drawing work. Explicit desktop opening uses `open --show` or `launch`. Local Electron tests default to the background journey. Foreground journeys run in CI or with an explicit local opt-in, and the project instructions keep foreground work off Ralf's working desktop. The signed background-default build is installed locally with the previous bundle retained. See the [verification ledger](design/verification-ledger.md#background-drawing-and-local-testing) for evidence.
