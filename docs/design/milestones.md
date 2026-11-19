# Agent Excalidraw — milestone implementation and verification plan

2026-11-19. Release scope updated by Ralf: macOS first; Windows and Linux remain future release targets. Architecture and native CI stay cross-platform. Product scope: native-feeling desktop editor, standard local files, full CLI, optional MCP, minimal shell. Detailed UX: [product-and-flows.md](product-and-flows.md). Technical baseline: [architecture](../architecture.md).

These are outcome gates, not a list of components completed. The application is implemented and substantial native file, editor, CLI/MCP, installation and UX evidence now exists. The [verification ledger](verification-ledger.md) records which exact builds and criteria were exercised, remaining engineering checks, and the separate public-distribution trust blocker. The historical milestone definitions below retain their acceptance requirements: implementation or a passing subset does not silently pass every criterion. User visual/product acceptance is recorded separately.

## How to verify each milestone

Every milestone handoff contains:

1. A specific build/commit and launch/install instructions for that build.
2. A short demo following the “Your check” script below, using synthetic drawings.
3. A pass/fail/not-run result for each criterion, by OS/architecture. **Not run is not pass.**
4. The resulting `.excalidraw` files, renders, sanitized operation receipts, relevant test output and known limitations.
5. Any scope/performance changes since the preceding gate. No quiet lowering of the acceptance bar.

Keep a verification ledger with columns `criterion`, `platform`, `build`, `fixture`, `evidence`, `result`, `limitation`. Do not use a screenshot alone to prove disk persistence, a mocked API alone to prove concurrency, or “CI configured” to mean the native test passed.

An architecture/engine failure at M1 blocks further product build-out. Visual feedback can change M0 choices without rewriting the file/agent contracts. Each later milestone remains a usable increment of the product. Package an installable alpha early; signing/publisher trust become release gates at M7/M8.

## M0 — Product contract and navigable design

**Deliver:** the visual direction, all F01–F32 flows and edge states, keyboard/focus rules, a clickable prototype of representative journeys, and this milestone plan. Show light/dark shell behavior and platform-specific labels. Prototype data/actions must be labeled as simulated outside the product surface.

**Your check:**

1. Start at Welcome. Create a drawing and find its location.
2. Go to Library and reopen an earlier drawing with a similar name.
3. Open Agents and explain which setup step actually proves the tool works.
4. Inspect unsaved close, recovery, conflict and failed-save examples.
5. Change platform/theme. Confirm terminology stays understandable and the canvas remains the focus.

**Pass:** no required account/agent setup before drawing; create/open/save destinations are clear; removing references and deleting files are distinct; the main happy paths and recovery branches have explicit destinations; each flow maps to a milestone. Capture your visual/content corrections before treating the design as settled.

**Does not prove:** any Excalidraw integration, OS installation, real files or connected agent. A design prototype alone is not app evidence; current native implementation evidence is recorded separately in the ledger.

## M1 — Prove the editor boundary on the Mac release architectures

**Deliver:** a minimal real Electron/editor build with the proposed host/file-service versus renderer/scene-controller split. Native host adapters retain macOS/Linux sockets and Windows named pipe for future releases. At least one real editor instance can create/read/update/render a synthetic scene. Pin actual editor/runtime versions and declare the tested support matrix.

**Your check:**

1. Open the alpha and create two labeled nodes and a bound arrow through a developer command.
2. Move one node manually. The arrow remains bound.
3. Apply a batch based on an older revision: see refusal and no changed elements.
4. Apply a fresh batch. Press native Undo once and Redo once.
5. Start a human drag/text edit while a request arrives: see safe wait/refusal, then a valid outcome after the edit.

**Required engineering evidence:** deliberately delayed main notifications; final revision validation in the renderer; text/IME, crop/line and delayed image paste/drop; no-op command; back-to-back agent batches; immutable exact-revision render; cancellation and lost reply without blind replay. A simple JS-thread/mutex argument does not count as proof. Validate unknown-element preservation/refusal before permitting ordinary saves.

**Current release gate:** compile/package and launch on actual supported macOS architectures. Windows/Linux are future release lanes; preserve their CI results and resolve failures before declaring support for those releases. Native test logs identify OS/runtime. If only one platform was exercised, report the other lanes pending and keep this gate open.

**Pass:** zero observed lost human edits in the declared scenarios; one tested native undo boundary per allowed batch; no wrong-document application; no indefinite busy state. Decide whether stable SDK suffices before adding product scope. Do not hide integration failure with a second independently writable server scene.

## M2 — Trustworthy documents, save and recovery

**Deliver:** F05/F07/F09 file admission and native saves; F21–F26 close/recovery/conflict/error handling; actual document IDs/paths and one file writer. Basic creation/open/save UI can still be sparse.

**Your check:**

1. Create at a chosen location. Draw, press Mod+S, inspect that exact file and reopen it.
2. Draw again; close and choose Don't save. Reopen: only the last saved content remains; no discarded recovery is offered.
3. Crash/terminate the process after an edit. Restore a **copy** and verify the original is untouched.
4. Change the file outside the app while it is dirty. See the conflict and save a separate copy.
5. Simulate a denied/unavailable save destination. Your drawing remains editable, dirty and recoverable; retry/save-copy succeeds.

**Required checks:** delayed save followed by a later edit; partial write/flush/rename failures; image create/replace/delete/undo; corrupt JSON; unknown future types; symlink/case/non-ASCII/long paths; no browser download bypass; `save-as` target changes only after success. Record OS differences in atomic replace, xattrs/mode and filesystem behavior. Do not claim arbitrary network-drive guarantees from local-disk tests.

**Pass:** reopened disk bytes/scene independently confirm the written revision and image data; every failure retains the last good file and accurate dirty state. Native close/quit never asserts saved when only recovery exists. Explicit Save is default; document autosave is opt-in and uses the same queue.

## M3 — A delightful daily manual workflow

**Deliver:** the finished-feeling Library/editor shell, F03–F15, quick switch, title/location, native file associations, folder indexing, sensible new-document placement, rename/move/duplicate and OS trash. Preserve active editor state when showing Library.

**Your check:**

1. Fresh launch → New drawing in one action, then rename from the title.
2. Open two drawings with the same filename in different folders. Search and choose correctly by location.
3. Star one, add a folder, reopen a previous drawing and reveal its actual file.
4. Move a dirty drawing, then save. Verify the new target; no stale old-path write.
5. Remove a recent/reference and verify disk data remains. Trash a different file and verify OS Trash behavior.
6. Go to Library and back without switching the drawing: zoom, selection and native undo remain intact.

**Required checks:** dirty switch guard; native OS-open while already running; image drop versus drawing drop; disconnected root; missing/moved file; interrupted cross-volume move; folder removal; canonical deduplication. Audit shortcuts against the pinned editor; don't hijack text/IME or link actions.

**Pass:** keyboard and pointer complete all common flows; no ambiguous Remove/Save As/Export behavior; app-created and externally opened files remain ordinary files. Every library item answers “Where is it?” in one click. No fixed fake thumbnails or simulated native actions in the acceptance build.

## M4 — Full CLI and real agent co-editing

**Deliver:** F06/F19/F20 and CLI `new/open/list/path suggest/snapshot/apply/layout/view/render/export/save/move/revert-last-agent-batch/operation status`, with structured input, concise output, versioned errors and parity-ready definitions. The skill can already drive the core workflow manually before installer automation.

**Your check:** from your agent's normal terminal, with **no MCP configuration**:

1. Ask for an onboarding flow. The agent picks a path and the real canvas opens.
2. Select two elements manually and ask the agent to improve that section.
3. Edit while the agent is planning. A stale request refreshes or refuses without losing your edit.
4. Ask for a render; the agent actually views it, refines the scene and saves.
5. Interrupt work. The UI reports what was applied versus cancelled, and safe native Undo/guarded revert behaves as described.
6. Switch application focus/document context and confirm a queued request cannot target the wrong drawing.

**Required checks:** same request ID replay/different payload; request lost before/after commit; process restart/epoch invalidation; input limits; incomplete snapshots; no inline secret payload requirement; render/image artifacts and unsaved status; unavailable path; active dirty drawing blocks implicit switch; stopped session cannot submit later mutations until resumed. Commands return canonical document identity/path and evidence stages.

**Pass:** full design workflow works through CLI only; no coordinate clicking, MCP dependency, duplicate shapes on retries or selective-undo claims unsupported by the guard. Cleanly report closed/inactive document limitations in the one-editor release.

## M5 — Easy agent onboarding and optional MCP

**Deliver:** F02/F17/F18/F32: published-style bootstrap, version-matched skill content, one canonical skill/link strategy, supported host discovery/registration, resumable setup UI, diagnostics, optional MCP server.

**Your check:**

1. In a fresh test home, follow the default CLI + skill setup for Codex, then separately Claude Code.
2. Ask the provided sample request. Only a real successful call changes Last used/status.
3. Repeat setup: no duplicate skill, broken symlink/junction or replaced unrelated config.
4. Configure MCP explicitly and repeat create/edit/render/save using MCP only.
5. Remove MCP. Repeat the complete task through CLI; everything still works.

**Required evidence:** domain-command input/result/error equivalence through both adapters; protocol version compatibility with actual supported host releases; hot reload/fresh-session messaging; missing Node/runtime; blocked package lifecycle scripts; download failure; host not installed; stale PATH; Windows junction/permissions; WSL/remote host mismatch. Never start Claude with API billing credentials during tests; follow the subscription-only guard.

**Pass:** GUI users still need no terminal; agent users get an honest short setup route and no mandatory MCP. Copying commands/config is not counted as a verified connection. Uninstalling owned integration leaves other skills/MCP entries untouched.

## M6 — Design quality, education and interface performance

**Deliver:** F16/F27/F28/F31: complete export, local help, useful agent scene description and layout/style helpers, clear context education, final visual states, keyboard/focus and measured performance. Polish applies throughout prior gates; this is the final quality audit, not the first styling pass.

**Your check:**

1. Draw and export a synthetic frame/selection. Compare preview, output and editable-payload choice.
2. Complete create/open/rename/export/agent setup through keyboard alone. Close dialogs with Escape and confirm focus returns.
3. Use dark/light/system appearance and UI scaling. File background is not silently modified.
4. Ask the agent for five distinct tasks: system diagram, decision flow, mind map, annotation of a human sketch and refinement of an existing layout. Review readability and preserved human work.
5. Open the large library/scene fixtures and use them while thumbnails/recovery work runs.

**Design acceptance:** one visual primary action per view; no permanent in-app chat; no unreadable path/status; essential actions available without hover; all designed error states; contrast and visible focus checked; no distracting loops; reduced-motion setting respected. Validate stock canvas keyboard/screen-reader limits separately from accessible shell claims.

**Agent-quality target:** at least 4 of the 5 tasks produce a readable result without binding damage, with evidence of render inspection and at most three refinement loops. The independent five-task synthetic trial is recorded in the [consumer report](../verification/design-consumer.md); its modest fixtures and rubric review are evidence for those tasks, not a general graph-layout benchmark. Readability is reviewed against a documented rubric (labels, hierarchy, spacing, crossings, clipping), not a tautological “lint passed”.

**Performance fixtures/targets:** fix reference hardware and OS in M1. Small scene: 250 elements/3 images; medium: 2,000 elements/12 images with bounded total bytes; library: 10,000 metadata entries and 500 scan files. Proposed p95 targets on those machines: shell response and indexed search <100ms; warm small-document open <1s; cold usable editor <4s; small-scene render <1.5s. Measure CLI startup separately from engine execution, font warmup and network download. Record input/frame behavior and aggregate app-process memory. Reject unbounded growth over 50 open/close cycles; investigate >20% same-fixture regression from the accepted M1/M4 baseline. Shared hosted CI timings are diagnostic, not the reference-machine oracle.

## M7 — Cross-platform install, offline use and lifecycle

**Deliver:** F01/F29/F30 and the release matrix: signed/notarized Mac distributions; future signed per-user Windows installer and tested Linux package; app associations/icons; first-run setup; explicit updates, rollback and uninstall. Packaged assets and transport permissions are audited/tested on each platform.

**Your check, repeated on each currently released OS/architecture:**

1. Clean account → official download → native installation → first drawing, without terminal/toolchain for manual use.
2. Disconnect internet, clear app caches, relaunch, draw, save and export fonts/images.
3. Open a file through the OS; reveal it; trash a different synthetic file.
4. Update with an active dirty drawing. Confirm it is preserved/guarded and failed update retains a healthy version.
5. Uninstall/disconnect integration. Your drawings remain; explicitly chosen app-data cleanup has the documented effect.

**Required evidence:** platform-correct shortcuts/chrome/menu labels; actual supported OS/arch manifests; named-pipe ACL/socket ownership checks; cold-cache fonts/chunks/workers/WASM; imported embed placeholders; process-level successful egress versus blocked request attempts; explicit updater/installer network boundary; package-manager variant behavior; invalid/corrupt installer; old CLI/new app compatibility without killing a live renderer.

**Pass:** every declared platform has real install/reopen/update/uninstall evidence and an offline daily-work path. Unsupported platforms/architectures are labeled before download. Source tests, a Mac screenshot and cross-compiled binaries cannot stand in for native verification.

## M8 — Public release candidate and product acceptance

**Deliver:** public-repo-ready source, license/asset inventory, synthetic examples, release notes, npm CLI, tagged app artifacts, skill install route, local-first/privacy explanation, troubleshooting and the completed verification ledger. Publishing credentials are handled separately from app operation; no secrets/private diagrams enter the repo.

**Your final 10-minute check:**

1. Follow only the public README/download path on a clean environment.
2. Create manually, save, quit, reopen from library and reveal the file.
3. Use your agent through CLI + skill to improve it and save.
4. Test optional MCP separately.
5. Recover a synthetic unsaved drawing, resolve one external-change conflict, and export a noneditable image.
6. Confirm the public release declares macOS only; review Windows/Linux progress separately, without advertising unverified downloads.

**Release gate:** all F01–F32 have implemented evidence or an explicitly accepted scope change; zero silent data-loss/wrong-target bugs; zero blocked core workflow; runtime/platform/editor versions declared; known limitations shown where they affect users. Current excalidraw.com-format compatibility is tested with synthetic fixtures and unsupported-type protection, not inferred from a stable package number. No promise of universal future-format compatibility or full offline agents using cloud models.

Only mark the release ready when the evidence supports it. User acceptance remains recorded distinctly from engineering test completion.

## Explicitly outside this release

Mobile/tablet apps, remote/LAN editing, real-time multiuser CRDT collaboration, cloud sync/accounts, in-app LLM chat, arbitrary selective history undo and retained multi-document tabs. Full CLI/optional-MCP functionality is inside the macOS release. Windows/Linux architecture and CI remain in scope for future distribution, with their native installer/signing gates deferred by explicit user direction. Additional architectures/distributions need their own native evidence before being listed as supported.

## Planned follow-up: embedded canvas

The [shared embedded canvas plan](embedded-canvas-plan.md) defines E0–E6 for one optional MCP App viewer across qualified T3 and Claude Desktop routes, preserving CLI fallback and the existing renderer authority. E7 is a separate full-editing design gate. This research does not implement those features or close any outstanding original milestone criterion.
