# Independent consumer runtime trial

Tested 2026-11-19 on macOS arm64, Node v25.2.1. No implementation source read or edited. Used only installed CLI help/schema/core skill and public README. No MCP or private IPC. App was quit through macOS after a successful save; an additional direct-exit probe reopened it, saved, and terminated only its exact main PID with SIGTERM.

## Installation and discovery

- Fresh root: `/tmp/exc-consumer.cI8VYp` (macOS canonical equivalent `/private/tmp/exc-consumer.cI8VYp`). `npm install /tmp/agent-excalidraw-0.1.0.tgz` succeeded: one package, no transitive npm dependencies, 3.7 MB installed footprint. Install took about 225 ms. This excludes the separately supplied native app.
- Explicit prerelease substitutions: `AGENT_EXCALIDRAW_APP` points to the supplied packaged executable; `AGENT_EXCALIDRAW_DATA_DIR=/tmp/excc-data`. No endpoint tokens printed or copied. The launch/data substitutions were supplied by the test brief, not discovered in the public consumer guide.
- `--help`, `skills get core`, `apply --help`, `render --help`, and `schema` were sufficient to construct, inspect, refine, save and export the diagram. Core guide explicitly teaches flat styling, font IDs, stable IDs, revisions, and viewing renders.
- **Skill installation isolation blocked by public discovery.** `skills install --help` exposes only `--hosts agents,codex,claude`; doctor lists real global skill roots. No root override is documented in README/core/help. Attempting `skills install --hosts agents --root /tmp/exc-consumer.cI8VYp/skills --json` fails with `unknown option '--root'` and repeats the same help, without explaining a safe isolated-root route. I stopped before mutation; real global skills were untouched. This is an actionable documentation/discovery gap, not a verified inability of the implementation to isolate roots.
- README correctly says release install instructions/artifacts are not yet published; this was a local tarball/native prerelease trial, not a release-download verification.

## Actual drawing workflow

1. Created synthetic confidential-notes system context with person, app, local files, dashed device trust boundary, and a clearly separate optional external AI provider. Cross-boundary arrow says selected text only with explicit consent. Footer avoids claiming local storage guarantees encryption.
2. Created 13 semantic objects (20 total elements including bound labels) in one batch, rendered and actually viewed `first.png`.
3. Visual inspection found an awkward three-line app label. Updated its stable ID to a shorter two-line label, rendered and viewed `refined.png`. No clipping or crossings obscured the final content.
4. Saved revision 2 with `persisted:true`. Opened a separate placeholder drawing and reopened the original file. Original document ID and all created stable IDs survived; epoch changed and revision reset to 0.
5. Deliberately replayed the old refine input to test precondition recovery. Received `STALE_EPOCH`, “This drawing was reopened or the app restarted. Inspect it again.” Error details returned current epoch/revision. Re-inspected and used a new request ID.
6. Targeted only provider stable ID `46d9d289-8237-4041-97af-7281ec638143`, replacing “External service” with “Consent required”. No new elements. Snapshot comparison confirmed only the intended bound-label text changed visibly. Several metadata fields changed and the bound AI arrow normalized its local coordinate origin/points, but its absolute endpoints remained identical: x 623.5 → 623; local start 0 → 0.5; local end 418 → 418.5, leaving absolute endpoints 623.5 and 1041.5 unchanged. No shape geometry or other label text changed.
7. Exported PNG and SVG with `--no-background`; actually viewed the final PNG. PNG has RGBA color type and corner alpha 0. SVG parses successfully, has no root background rectangle, and uses the same content bounds. Image exports omitted embedded scene by default. Saved final revision 1 with `persisted:true`.

## Concrete friction / limits

- `new --title ... --path ...` uses the supplied filename stem as the resulting drawing title (`confidential-notes`), silently superseding the requested descriptive title. File output itself is correct.
- Generic footer in `new --help` says scene edits require document/epoch/revision/request ID even though `new` needs none of these. The specific contract and successful call resolve the ambiguity.
- Direct CLI error exit behavior is correct: both `STALE_EPOCH` and stopped-app `APP_NOT_RUNNING` return status 1. Exact stale invocation from the consumer root: `AGENT_EXCALIDRAW_DATA_DIR=/tmp/excc-data ./node_modules/.bin/agent-excalidraw apply --input refine.json --json` (no pipeline). An initial claim of status 0 was a test-observation error from a compound shell command ending in `cat`, corrected by this direct probe.
- No accidental ref/stable-ID mistake occurred: the guide and creation receipt were sufficient. The only retry was the deliberate stale-epoch probe; the response clearly told me what to do next.
- No quit command is exposed in CLI help. To honor normal shutdown after save, used macOS application Quit (AppleScript), then verified CLI `snapshot --no-launch` reports stopped instead of launching again. For the later direct-exit probe, reopened and saved the same file, then sent SIGTERM only to the verified main PID 86626, as requested by the test coordinator.
- Tested Node 25 only; Node 22 compatibility, clean online app installation, signing/quarantine, other platforms, interrupted writes, and real global skill changes were not tested.

## Preserved outputs

- Editable drawing: `/private/tmp/exc-consumer.cI8VYp/confidential-notes.excalidraw`
- Final transparent PNG: `/tmp/exc-consumer.cI8VYp/confidential-notes-transparent.png` (1320 × 726)
- Final transparent SVG: `/tmp/exc-consumer.cI8VYp/confidential-notes-transparent.svg` (1320 × 725.4)
- Earlier visual review: `/tmp/exc-consumer.cI8VYp/first.png`, `/tmp/exc-consumer.cI8VYp/refined.png`
- Reopen placeholder: `/tmp/exc-consumer.cI8VYp/reopen-placeholder.excalidraw`
- Inputs, receipts, exported schema, snapshots and small normal-CLI wrapper/build script remain in the consumer root. Runtime fixtures remain in `/tmp/excc-data`; do not publish discovery/endpoint files because they may contain local capability tokens.
