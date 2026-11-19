# Embedded canvas: clean package consumer verification

Completed 2026-11-20 Europe/Zurich (2026-11-19 23:24 UTC). Result: **local tarball installation, installed CLI, self-contained viewer delivery, notices, actual stdio capability negotiation/no-UI fallback, and ordinary status passed** on macOS arm64. This does not establish embedded host rendering or public distribution trust.

## Artifact and environment

- Host: Darwin 25.5.0 arm64; Node v25.2.1; npm 11.6.2.
- Tarball: `/tmp/agent-excalidraw-0.2.0.tgz`, 987,023 bytes, SHA-256 `36ad65d40a4037232a9cccffa3174f2323b8805543fa5712d47ca1737f89c8eb`.
- Fresh consumer directory: `/tmp/ae-package-consumer.RAqO9h`; all npm installation and CLI/probe execution occurred there, outside the repository cwd. `npm install --prefix /tmp/ae-package-consumer.RAqO9h /tmp/agent-excalidraw-0.2.0.tgz --no-audit --no-fund` exited 0, reporting `added 1 package in 410ms`. No dependency packages were installed.
- Installed executable: `/tmp/ae-package-consumer.RAqO9h/node_modules/.bin/agent-excalidraw`. Package version: 0.2.0. No global installation or host MCP registration was performed.
- Supplied desktop artifact: `/tmp/ae-embedded-release-arm/mac-arm64/Agent Excalidraw.app`; ASAR SHA-256 `766ede6aeb9dc0cf2a6d497fdde2fbf3b5139d0edf19d95a045a5a405a100e7b`. `codesign --verify --deep --strict --verbose=2` exited 0, reporting valid on disk and satisfying its designated requirement. This verifies the local signature, not notarization or quarantine acceptance.
- Checkout HEAD when testing: `373754a029c703590b8aa072bc6ff15623559972`, with substantial pre-existing uncommitted implementation changes. Artifact hashes, rather than HEAD alone, identify this test.

## Consumer method and evidence

Read the public README, `docs/embedded-canvas.md`, relevant release instructions, installed `--help`, `mcp --help`, and `skills get core`. The installed guide includes the explicit document/epoch requirement, read-only semantics, and render/desktop fallback. Followed repository acceptance/evidence instructions. No implementation changes were made. Limited inspection of installed bundled code established the launcher invocation and diagnosed environment/app selection; no repository implementation code or repository test fixture was used to implement the client.

Raw local evidence and reproducible client scripts are retained under `/tmp/ae-package-consumer.RAqO9h`, particularly `probe.mjs`, `signed-lane.mjs`, `audit.mjs`, `bundled-launcher`, and `evidence/`. These temporary artifacts are not committed and may be removed by system cleanup. No endpoint tokens are copied into this report or probe transcripts.

### Installed CLI and ordinary app status — pass

`./node_modules/.bin/agent-excalidraw --help`, `skills get core`, and `mcp --help` exited 0 outside the checkout. Help exposes ordinary drawing commands and optional stdio MCP; the guide describes fallback when MCP Apps are unavailable.

Launched the supplied desktop executable directly with an isolated `AGENT_EXCALIDRAW_DATA_DIR=/tmp/ae-package-consumer.RAqO9h/signed-data`, clearing the inherited `ELECTRON_RUN_AS_NODE` for GUI launch. Owned final app PID: 57621. The installed npm CLI's `status --no-launch --json` returned `ok:true`, version `0.2.0`, protocol `1`, active `null`, dirty `false`, saving `false`, revision `0`, libraryCount `0`, recoveryCount `0`, error `null`. Evidence: `evidence/signed-status.json`.

### Actual stdio client without UI capabilities — pass

The independent Node client spawns the installed executable with `mcp`, writes newline-delimited JSON-RPC over its real stdin, and reads real stdout replies. It initializes protocol `2024-11-05`, client name `clean-no-ui-consumer`, version `1.0`, and `capabilities:{}`, then sends `notifications/initialized`.

Against the isolated 0.2.0 app (`evidence/signed-npm-no-ui.json`):

- `tools/list` returned 22 tools, including `show_canvas`; `canvas_read` was absent. No UI metadata was attached to `show_canvas`.
- `resources/list` returned an empty list. Direct `resources/read` for the viewer URI returned JSON-RPC error `-32603`, `This viewer resource is not available to this client.` This is expected capability gating, not an installation failure.
- Ordinary `tools/call` `status` returned `isError:false` and an `ok:true` text envelope identifying the 0.2.0 app with no active document.
- `show_canvas` with synthetic nonempty identity values (`synthetic-consumer-document`, `synthetic-consumer-epoch`) returned `isError:false`, structured `ok:true`, `mode:"desktop"`, and exactly: `Inline canvas is unavailable in this client. Use snapshot and render, or continue in the Agent Excalidraw desktop app. The CLI workflow needs no MCP App UI.` No drawing needed to be opened or mutated to exercise this no-UI branch. This proves graceful fallback, not identity validation for an actual UI binding.

### Actual stdio UI resource delivery — pass

Repeated real stdio initialization with:

```json
{"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}
```

The npm-installed CLI and supplied app's bundled CLI both returned 23 tools, adding `canvas_read` with app-only visibility. `show_canvas` advertised `ui.resourceUri` and `ui/resourceUri` as `ui://agent-excalidraw/viewer-v1.html`, with model visibility. Resource listing advertised `Canvas viewer`; resource reading returned MIME `text/html;profile=mcp-app`.

The temporary bundled launcher uses the actual signed app executable and ASAR CLI, following the packaged launcher form:

```sh
ELECTRON_RUN_AS_NODE=1 exec '/tmp/ae-embedded-release-arm/mac-arm64/Agent Excalidraw.app/Contents/MacOS/Agent Excalidraw' '/tmp/ae-embedded-release-arm/mac-arm64/Agent Excalidraw.app/Contents/Resources/app.asar/dist/cli/index.js' "$@"
```

The launcher was created only in the temporary consumer directory. It invokes the bundled Electron runtime rather than a Node CLI substitute. The client driver itself uses Node.

Npm and bundled resource bytes exactly match each other and the npm-installed `dist/embedded/viewer.html`: 545,866 bytes, SHA-256 `b40c61dfedc5301d3e588ebf40d6ee8e552285981a4c261fd7dd7563e16551fc`. Resource metadata has `ui.csp.connectDomains:[]`, `resourceDomains:[]`, `frameDomains:[]`, and `prefersBorder:true`. Evidence: `evidence/npm-ui.json`, `evidence/bundled-ui.json`, `evidence/signed-bundled-ui.json`, and corresponding `*-viewer.html` files. The signed bundled lane also returned ordinary status with version 0.2.0 and active `null`.

### Self-contained asset and notices — pass within static scope

Audited the installed HTML independently: one inline module script; parsing with Node `vm.SourceTextModule` reports zero static import dependencies; zero dynamic `import(` occurrences; no external `src`/`href` asset tags. The single actual style block has no CSS `url()` or `@import`. Schema URL strings and URL-validation library code inside the JavaScript are not external asset loads. The HTML does not contain the consumer path or `endpoint.json`. This static audit plus restrictive resource CSP supports self-contained packaging; it is not an observed browser-network execution test or comprehensive secret scan.

The installed package contains project `LICENSE`, `dist/dependency-inventory.json` (144 entries), and `dist/THIRD_PARTY_LICENSES.txt` (234,246 bytes). Notices contain the MIT grant and sections for `@modelcontextprotocol/ext-apps@1.7.5`, `@modelcontextprotocol/sdk@1.32.2`, `commander@14.0.3`, and `zod@4.6.7`. Evidence: `evidence/static-audit.json` and the installed files. This confirms physical delivery and sampled embedded/CLI dependency notices; it is not a complete legal inventory reconciliation.

## Issues, setup corrections and limits

- **Packaged documentation gap:** the tarball ships README, but not `docs/embedded-canvas.md` (nor its other linked docs). The README's relative embedded setup link therefore does not work as a local installed-package document. The public repository copy and installed core guide supplied the instructions for this trial. This does not block runtime operation.
- Initial MCP status auto-discovery selected the existing `/Users/ralf/Applications/Agent Excalidraw.app` version 0.1.0 while still using this test's isolated `app-data`. Ordinary status succeeded there, but that is not evidence for 0.2.0 desktop behavior. Setting `AGENT_EXCALIDRAW_APP` did not select the supplied app in that attempt. The final lane explicitly launched the supplied binary and established version 0.2.0 before both CLI and stdio status checks. Discovery selection deserves a focused follow-up if explicit override precedence is intended as a supported contract; that environment variable is not documented in the public instructions used here.
- The first direct executable launch inherited `ELECTRON_RUN_AS_NODE=1` from the harness and consequently did not start the GUI; CLI status correctly reported `APP_NOT_RUNNING`. Clearing it resolved this test setup error. The final successful direct launch is recorded separately; earlier failures are not treated as product failures.
- No compatible-host UI rendering, pan/zoom/refresh, live preview updates, actual document-bound `show_canvas`/`canvas_read` round trip, image inspection, save/edit workflow, or stale binding lifecycle was exercised. Successful HTML delivery alone is not an embedded rendering pass.
- No drawing was opened, created, changed or saved. All statuses had no active document. DefaultFolder pointing at the user's normal drawing directory is a setting, not evidence that a drawing there was accessed.
- Tested one local tarball and one signed local arm64 artifact. No npm registry/public download, network installer, Gatekeeper quarantine/notarization, clean OS account, Intel/Windows/Linux, Node 22 minimum, offline firewall, or host MCP registration claim is made.

## Cleanup and repository scope

Parent follow-up: the new README setup link now uses an absolute public repository URL and names `agent-excalidraw skills get core` for offline, version-matched guidance. The tarball above was tested before that documentation-only correction; its hash is retained unchanged as evidence.

Owned app instances were closed through CLI `quit` using their exact isolated data directories, returning `ok:true`, `closing:true`. Final `app-data` and `signed-data` endpoint descriptors were absent; owned PIDs 53189 and 57621 were gone. Other pre-existing or concurrently appearing app/MCP processes were left untouched. The temporary consumer install/evidence remain for inspection. No production code/config, global launcher, host registration, or user's drawing was modified. No agents were spawned. Only this verification report was added to the repository; no commit was made.
