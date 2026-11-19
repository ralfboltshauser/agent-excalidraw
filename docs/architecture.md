# Agent Excalidraw: revised implementation plan

Reviewed 2026-11-19. This replaces the earlier proposal. Source research supports the architecture; the integration gates below have not yet been run. No application, global skill, or public repository has been installed or published.

## Product contract

`agent-excalidraw` is an independent local Excalidraw workspace for macOS, Windows and Linux. It provides a visible editor, ordinary local drawing files, a browsable library with actual host paths, a complete drawing CLI, optional MCP with equivalent operations, and a thin globally discoverable skill. The existing coding agent does the reasoning; there is no model/API key/account inside this app.

Examples:

* `$agent-excalidraw` opens the library without creating a file.
* `$agent-excalidraw draw this project's onboarding flow` chooses a path, creates and opens the drawing, then draws, inspects, refines and saves it.
* `$agent-excalidraw improve the selected section` reads the live selection/context and makes targeted edits.
* An explicit path is honored. A clearly requested existing drawing is reopened. Ambiguous matches are reported, never silently overwritten.
* Cmd+S on macOS, Ctrl+S on Windows/Linux, and agent save write through the same native file service to the displayed path. Background crash recovery is separate; document autosave is opt-in.
* The app works manually without a skill, MCP registration or an agent connection.

Project/repository/CLI/skill/MCP registration name: `agent-excalidraw`. Display name: **Agent Excalidraw**. Preserve the standard `.excalidraw` extension and upstream product/package names. Explain that this is not an official Excalidraw release.

## Decision: build the missing workspace, reuse the drawing engine

Use the published official `@excalidraw/excalidraw` React component in a thin Electron shell. Start against **0.18.1**, the published stable release inspected during research, not changing upstream HEAD. Pin the complete dependency set and lockfile. Prefer the editor's public root exports for element creation/restoration, immutable updates, serialization, conversion and image export. Do not mix newer extracted element/utils packages or Mermaid versions into stable without compatibility tests.

Electron is the best-supported starting choice here: a consistent Chromium editor environment, native file/menu/lifecycle APIs, and TypeScript on both sides. It is a provisional engineering choice, not a benchmark result. Tauri or Swift/WKWebView could reduce bundled browser costs but do not remove Excalidraw's state/history integration work. Do not build multiple shells.

The official Excalidraw CLI already provides local rendering and Mermaid conversion, but its workspace editing/MCP path reaches Excalidraw+. Reuse narrow official packages/ideas; do not use its cloud path as this local app's backend or spawn another browser for every live render. Existing Excalidraw-specific tools are evaluated in the linked foundations report before any code is adopted. Reuse requires both suitable behavior and an explicit license.

The strongest existing agent toolkit inspected, `yctimlin/mcp_excalidraw`, already has a real CLI, optional MCP, drawing helpers, a local canvas and durable checkpoints. Reuse selected helpers/tests with notices after compatibility review. Do not adopt its scene store unchanged: the inspected frontend can post a stale whole-scene snapshot to a server endpoint that replaces the element map without an expected revision, and its CLI `apply` performs several requests rather than one editor transaction. Those are source-derived failure paths, not reproduced runtime bugs. Its checkpoint model also differs from user-chosen `.excalidraw` documents. A thin desktop wrapper would leave the hardest work unresolved.

The earlier Tauri-wrapper candidate has no license statement/file in the inspected revision, so copying its implementation is excluded pending clarification. ExcalidrawZ is MIT licensed and a serious alternative for an existing-app integration, but its Swift architecture, feature-gated optimized MCP and cloud/update functionality must be considered rather than assumed away. A new wrapper should stay much smaller than a fork of that whole product.

## Ownership: two responsibilities, one live scene

### Renderer: editor and scene controller

The mounted Excalidraw instance owns the live scene and native history. A renderer-local controller owns agent commit coordination: scene inspection, content revisions, busy-state checks, operation compilation, final expected-revision validation, SDK application/readback and immutable render/save snapshots.

Excalidraw is not a fully controlled React document component. Human edits happen internally; `onChange` reports them after mutation. Main cannot approve every human edit before it happens through the public SDK. Do not maintain a second independently writable scene in main.

### Main: host and file service

Electron main owns application lifecycle, document identity/path registry, approved IPC routing, the private local socket, file dialogs, menus, library metadata, serialized disk writes and recovery snapshots. Its latest scene mirror is acknowledged/cached state, not authority for live scene mutation. A save asks the renderer for a current immutable snapshot; it does not blindly write main's older mirror.

### CLI and MCP: equal adapters

An npm-distributed TypeScript CLI and optional stdio MCP adapter use the same typed command client, schemas, errors and private socket protocol. The CLI never calls MCP. Main routes scene commands to the correct renderer controller and file commands to the file service.

Use the supported official TypeScript MCP SDK. Start with a small shared definition map and real validation, not a custom command-schema compiler. Derive help and MCP metadata where straightforward; test remaining mappings. Host setup/install commands need not become drawing tools.

No HTTP server, public edit endpoint, CDP port, generic eval, OS accessibility permission or separate scene-owning daemon is required. Node Unix sockets provide local IPC on macOS/Linux; Windows uses a named pipe with verified user-restricted ACLs. Use an owner-only socket directory where applicable, bounded messages, validated peers/requests and a per-install local credential; this coordinates this app, not a sandbox against an agent with independent shell access.

## Command surface and agent workflow

Implement useful domain commands with concise text output, `--json`, per-command help and structured stdin/file input:

* `status`, `version`, `doctor`, `schema`, `skills get core`: discover the installed capability/protocol without launching the editor.
* `path suggest`: return a deterministic proposed absolute path from purpose/project context without creating a document; creation performs final exclusive allocation.
* `new`, `open`, `list`, `move`, `save-as`, `reveal`: create/find/organize files and return their resolved absolute paths.
* `snapshot`: inspect the scene, selection, group or region; return document-scoped stable element IDs, content revision and explicit completeness/pagination information. Do not add temporary snapshot refs in v1; the editor already supplies persistent IDs.
* `apply`: create/update/delete elements, labels, groups, ordering, style and connectors in one validated batch. Use named intra-batch references for newly created nodes. The app handles IDs, bindings, version counters and text metrics through supported SDK helpers.
* `layout`: begin with alignment/distribution and simple deterministic flow arrangement. Reuse a local layout package only when needed; do not build a universal diagram-design language.
* `view`: get/set selection, focus and viewport without changing document content revision.
* `render`, `export`: PNG/SVG/native export from captured scene state, with bounds and scene-to-pixel transform. CLI returns a local artifact path; MCP can return image content. The agent must actually view the image before claiming visual inspection.
* `save`: persist a captured revision and return the actual written path/revision.
* `operation status`: reconcile requests whose replies were lost within the current runtime epoch.
* `revert-last-agent-batch`: guarded compensation only if the current content revision still equals that batch's post-revision. See history limits below.
* `mcp`: run the optional server. MCP registration is a separate opt-in installer action.

Proposed flow, not commands already available:

```sh
agent-excalidraw skills get core
agent-excalidraw new --title "Onboarding" --project-dir /path/to/project --json
agent-excalidraw snapshot --document <id> --compact --json
agent-excalidraw apply --document <id> --epoch <epoch> \
  --expected-revision <revision> --request-id <unique-id> \
  --input /path/to/operations.json --json
agent-excalidraw render --document <id> --output /path/to/preview.png --json
agent-excalidraw save --document <id> --json
```

Rich/private payloads use `--input <file>` or stdin, not inline JSON in argv. Do not echo scene payloads into normal diagnostics. No user needs to register MCP to execute this flow. An npm CLI requiring a supported Node version is acceptable for the first release; a Node-free executable was an invented requirement in the earlier plan. Choose/test an active supported LTS line and declare engine constraints. Consider native/compiled distribution only after a demonstrated need.

## Commit and history guarantees

Every command targets a document ID and incarnation, never whichever tab happens to be focused. `--session` identifies the agent context; it does not clone scene state or solve concurrency. One application instance owns a file within our integration.

Use a monotonic **content** revision that covers scene elements, image resources and persistent app state. Viewport/selection changes are separate. Do not use `getSceneVersion` or a version hash as a collision-free concurrency token. Before an agent commit, compare against the actual live scene in the renderer, including changes not yet reported to main.

Prepare assets/fonts/layout without visible mutation. During a drag, text/IME edit, line creation, crop or pending asynchronous import, defer briefly within a bounded deadline or return `DOCUMENT_BUSY`. Do not modify underneath a live gesture using stale original geometry. At an idle boundary, re-read, validate and apply a candidate without an asynchronous gap between the final revision check and application. Use immutable candidate elements and one `updateScene` with the appropriate immediate history capture. Image preparation/cache changes need separate treatment because `addFiles` is not part of `updateScene`.

The intended guarantee is one validated visible scene batch, with verified readback, not database-level transaction isolation from the SDK. Prove this against the pinned package. A no-op must return without waiting forever for an `onChange` that will never occur.

Keep native user Cmd+Z/Cmd+Shift+Z. Prove that one idle agent batch creates one native undo step without combining unrelated human edits. Public 0.18.1 history only exposes `clear`; it does not provide programmatic selective undo/redo. The guarded CLI revert applies an inverse as a **new edit** only with an unchanged post-revision. It refuses after intervening content edits. Arbitrary attributed undo needs a different design or upstream API work and is outside initial scope.

Deduplicate request IDs in memory within a runtime/document epoch; reject reuse with a different payload. Distinguish not sent, rejected, applied, read back, rendered and persisted. A timeout after possible application is `OUTCOME_UNKNOWN`, not permission to replay. Restart/reopen changes the epoch and invalidates old mutation preconditions; agents re-inspect restored state. Do not promise exactly-once mutations across crashes or a durable receipt ledger unless a separate recovery protocol has been implemented and tested.

## Files, saving and library

Default root: `<home>/Excalidraw` (`%USERPROFILE%\Excalidraw` on Windows), configurable. Explicit paths win. New project work goes under a deterministic project namespace; unrelated work goes to `inbox`. Avoid silently creating files inside Git repositories or cloud-synced Documents/Desktop. No folder name can guarantee third-party backup exclusion.

Create filenames exclusively and suffix collisions. Opening an existing file must never replace it with a blank scene. Track canonical paths, symlinks and document identity deliberately. A move changes the live persistence target through the file service; cross-volume move is copy/verify/remove with recoverable failure states, not assumed atomic rename.

Use standard local scene serialization with embedded referenced images. Scene files do not preserve native undo history. Extra properties on supported elements may survive; unknown future element types may be dropped by restoration. Detect unsupported content and refuse destructive overwrites/read-only-open it rather than claiming arbitrary future-format round trips.

Use one per-document save queue for Cmd+S, agent save, native/editor menus and save-as. The default is explicit document save, with a visible dirty indicator; the skill saves at the end of the authorized task. Private crash-recovery snapshots run in the background and do not change the chosen document file. Optional autosave uses this same queue. Closing dirty content offers save/discard/cancel and never silently persists a discard.

Capture an immutable renderer snapshot and tag it with its revision. Write a sibling temporary file, flush and atomically replace where supported. A completed write marks only its revision saved; newer edits remain dirty. Failure leaves the original and dirty state intact. Keep a bounded local recovery copy and explain that recovery is separate from native undo and operation deduplication.

Track external file fingerprints and refuse ordinary overwrite when an external modification is detected. This is best-effort conflict detection, not atomic compare-and-swap against arbitrary other applications. Offer reload or save a separate copy.

Start with one active editor and a library, switching documents only after flushing/handling unsaved state. The library contains created/opened files and deliberately registered folders, with search, modified time, full location, copy path, missing-file state and Reveal in Finder/Explorer/the file manager. It never scans the whole home folder. Add retained multi-document tabs after the core state/history slice passes.

Keep a rebuildable metadata index/settings and bounded recovery data in platform-native application-data directories, resolved through the platform adapter (macOS Application Support, Windows per-user app data, Linux XDG conventions). Drawings remain ordinary host files. Avoid a scene database or synchronization backend for v1.

## Offline and privacy contract

Bundle the matching editor fonts, lazy chunks, workers/WASM and other required assets. Configure local asset paths before initialization. Stable Excalidraw includes CDN fallbacks: CSP/request enforcement must block remote requests even when an asset is missing. Record attempted blocked requests separately from successful egress. Test cold caches, every supported font and self-contained SVG output. Define CJK/system fallback behavior explicitly; do not silently download fonts during confidential editing.

Do not run imported remote embeds or generated iframe HTML. Preserve their data and show placeholders where possible. No collaboration, cloud workspace calls, in-app model, telemetry or automatic network update check. Imports are local. External links open only through explicit user actions. Installation/explicit updates use network; ordinary editing does not.

Use packaged assets through a constrained standard/secure app protocol, isolated sandboxed renderer, narrow preload APIs, validated IPC senders, and appropriate Electron fuses. No renderer Node integration or generic filesystem/shell bridge. A custom protocol is not permission to bypass CSP or expose arbitrary files. Test the packaged application, not only the dev server.

CLI and MCP results sent to a cloud agent can reach its provider. A local transport does not make the model local. Launch/list operations return necessary metadata, not scene contents. A user request to inspect/edit a drawing authorizes that workflow within the host's normal permissions; do not add a repeated consent dialog for routine authorized edits. Manual app use does not read diagrams into an agent. Optional deny policies must be honored if configured, but the app does not pretend it can restrict an agent's independent filesystem access.

Keep content tracing off by default. Renders, recovery copies and logs have explicit locations/retention/cleanup. Files are not app-encrypted; OS disk protection is separate. Do not claim OS-level egress isolation from Electron request hooks alone.

## Installation, skill and public repository

One public MIT-licensed repository for original code, with upstream/font/asset notices and synthetic examples only. Suggested folders: `app/`, `cli/`, `mcp/`, `shared/`, `skills/agent-excalidraw/`, `skill-data/`, `tests/`, `docs/`.

Publish the CLI through npm, signed/notarized macOS disk images, a signed per-user Windows installer, and a tested Ubuntu LTS `.deb` through tagged GitHub Releases, and the skill through a thin discovery installation. `agent-excalidraw install` installs a pinned compatible desktop release; the first skill invocation can run it if missing. Warm invocations never rebuild, update or reinstall the app. Install/update is atomic enough to leave the previous working version available on failure. Never restart a live editor for a version mismatch: negotiate protocol compatibility or report an actionable mismatch while preserving work.

Keep one canonical skill under a persistent local install directory; link into the required selected roots `~/.agents/skills/agent-excalidraw`, `~/.codex/skills/agent-excalidraw`, and `~/.claude/skills/agent-excalidraw`. Respect configured homes and existing unrelated installations. Use symlinks on Unix and test directory junctions on Windows with each supported host. Unsupported linking/discovery must produce actionable diagnostics rather than untracked duplicate skill copies. Verify discovery to avoid duplicate registrations. The stub loads version-matched instructions from `skills get core`; it does not contain a second independently versioned command manual.

MCP host registration is optional and uses each host's supported mechanism, preserving unrelated configuration. Explain reload/new-session needs honestly. CLI-only use must work before MCP registration and after its removal. Uninstall removes only owned integration files and preserves drawings by default.

## Product design and implementation gates

The current cross-platform UX contract is [Product and 32 user flows](agent-excalidraw-design/product-and-flows.md). It defines installation, onboarding, library/editor navigation, agent education, ordinary file operations and recovery states. The [milestone plan](agent-excalidraw-design/milestones.md) supersedes the earlier five engineering gates. Each gate includes a user demo and required evidence:

* M0: navigable product design; user review, not runtime acceptance.
* M1: prove editor ownership/concurrency/history and launch actual packages on macOS, Windows and Linux.
* M2: prove native files, accurate save state, recovery, failure and external conflicts.
* M3: finish daily manual library/editor workflows and native file operations.
* M4: deliver the full CLI agent workflow without MCP.
* M5: install/discover the skill, bootstrap easily and expose optional MCP with parity.
* M6: polish design, education, exports, accessibility and measured performance.
* M7: verify clean-account installers, cold-cache offline behavior, update/rollback/uninstall on every supported OS.
* M8: public release candidate, documentation, reproducible artifacts and user acceptance.

Manual GUI use requires no Node or terminal. The initial npm CLI may require a declared supported Node version. Initial proposed builds are macOS arm64/x64, Windows x64 and Linux x64 on a declared Ubuntu LTS baseline. Other distributions/architectures require their own evidence. Platform adapters cover launch, IPC, paths, shortcuts, trash and installation; there is one editor implementation.

Acceptance is observed effects: inspect live scene state, export artifacts and reopened disk contents independently. Native platform tests must actually run; configured CI and screenshots do not establish persistence or safe concurrent editing. No generic schema framework, separate scene database, second browser, CRDT server, attributed history system or native CLI is a prerequisite for the first complete workflow.

## Evidence and review reports

* [SDK and scene/history review](agent-excalidraw-sdk-review.md)
* [Existing foundations and build-versus-reuse review](agent-excalidraw-foundations-review.md)
* [Runtime/packaging review](agent-excalidraw-runtime-review.md)
* [Vercel agent-browser source research](agent-browser-research.md)
* [Vercel agent-desktop source research](agent-desktop-research.md)
* [Independent Opus design, preserved unchanged](agent-excalidraw-opus-independent.md)
* [Comparison and adjudicated decisions](agent-excalidraw-opus-comparison.md)

Primary implementation references: [published editor release](https://github.com/excalidraw/excalidraw/releases/tag/v0.18.1), [stable public API](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/types.ts), [official CLI](https://github.com/excalidraw/cli), [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Node local IPC](https://nodejs.org/api/net.html#ipc-support). Detailed findings distinguish inspected source from documented claims and untested design proposals.
