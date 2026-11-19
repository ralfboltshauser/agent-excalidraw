# Embedded canvas verification

Updated 2026-11-20. Synthetic fixtures only. This report separates working implementation from host qualification and public download trust.

## Build and runtime evidence

Agent Excalidraw **0.2.0**, Electron **45.4.1**, Excalidraw **0.18.1**, MCP SDK **1.32.2**, Apps SDK **1.7.5**. Reference machine: macOS arm64, Apple M2 Max, Darwin 25.5.0.

- Typecheck and **82 module tests passed**; the separately enabled UI journey is skipped in the ordinary module run.
- **Eight viewer tests passed**, including a native Electron host using the official SDK AppBridge, real image decoding, theme initialization/change, multi-chunk integrity, save-only status, keyboard pan/Fit, pause, stale pixels, narrow layout and teardown. External request interception observed no requests beyond the local host HTML.
- **All 29 native source journeys passed together. All 29 passed again against the signed arm64 package**, including the full renderer → private socket → bundled stdio MCP → SDK iframe viewer chain. The packaged test installs its own launcher and removes external Node from PATH. It obtains the HTML through `resources/read`, rather than reading a source file as a substitute.
- Signed package ASAR SHA-256: `766ede6aeb9dc0cf2a6d497fdde2fbf3b5139d0edf19d95a045a5a405a100e7b`. `codesign --verify --deep --strict` passed. This exact bundle was installed locally, retaining the previous app as a backup. The installed launcher reports 0.2.0 and serves the updated core guide.
- Screenshots were inspected for light, dark, narrow, paused and real-scene states. The full-chain journey observes actual unsaved mouse edits and agent edits, preserves the image URL on Save, and refuses the old drawing after switching. Separate native cases check Undo/Redo, unchanged files/artifacts, viewport/activity preservation, empty drawings and huge sparse bounds.
- An [independent source review](embedded-code-review.md) found no actionable defects in its bounded scope. It does not substitute for host or package execution.
- A [clean installed consumer](embedded-package-consumer.md) passed dependency-free npm installation outside the checkout, ordinary status, actual stdio capability negotiation/fallback, and matching self-contained HTML from npm and the signed ASAR launcher. Its README link finding was corrected to a public repository URL with an explicit offline core-guide command. The original tested tarball hash remains recorded separately.
- Added a real imported-image presentation read to the native image/history journey; it passes against the signed package. A separate opt-in measurement seeds 250 extra rectangles, then times 20 real accepted edits through automatic two-second polling to decoded viewer image swaps: **p95 1,888 ms, max 1,898 ms**, below the 3,500 ms target. This is the SDK reference host with a local signed app, not an installed T3/Claude latency claim. Reproduce with `AE_EMBEDDED_LATENCY=1 AGENT_EXCALIDRAW_EXECUTABLE=/path/to/executable npx playwright test --grep 'embedded viewer follows'`.
- The complete packaged stdio/viewer journey also passes with an enforced deny-by-default iframe CSP: inline bundled scripts/styles and data/blob images work, while network/frame/object/form access is denied. Resource metadata alone is not counted as policy enforcement.
- A real 0.2.0 installed MCP adapter was connected to the retained 0.1.0 signed app using isolated data and a two-element unsaved synthetic scene. Actual `show_canvas` returned `VIEW_NOT_SUPPORTED` with upgrade/CLI guidance. Snapshot elements/revision, dirty status and saved bytes were unchanged before explicit synthetic cleanup. The old app remained usable and exited normally after Save. Local reproduction/evidence: `/tmp/ae-legacy-embedded-check.py`, `/tmp/ae-legacy-view-xjea_rda/compatibility.json`; no endpoint credentials are included in this report.

The first packaged run was stopped at the user's request after 23 passes; six did not run. The resumed complete run passed all 29. Interrupted work is not counted as a failed app journey or a completed stress result.

## Actual host lanes

| Surface | Observed | Qualification limit |
| --- | --- | --- |
| T3 / Codex | Actual E0 tool/resource/app-only round trip visibly passed. Two fresh consumers invoked production `show_canvas` successfully using explicit live identities. | Production card pixels and controls have not yet been inspected in the installed T3 host. Native computer use timed out twice after resuming. E0 is bridge evidence, not full production qualification. |
| T3 / Claude | Source compatibility researched. | Actual provider/UI workflow not run; not qualified. |
| Claude Desktop local stdio | Temporary server loaded; actual Status call succeeded after approval; Snapshot approval was reached. | Interrupted before a completed show/view workflow. Resumed native inspection unavailable. Not qualified. |
| Standalone Codex / Claude Code terminal | Ordinary CLI/MCP fallback supported. | Inline MCP App rendering not established; do not advertise it. |
| Official SDK reference host | Complete real stdio/native-editor/viewer journey passed, both source and packaged. | A deterministic test host is not T3 or Claude Desktop. |

See [E0 evidence](embedded-e0-consumer.md) and the [production consumer report](embedded-production-consumer.md). Host names never select a different UI implementation.

## Privacy boundaries

Static HTML is self-contained and contains no document, host file path or endpoint credential. Presentation bytes are runtime app-only structured replies; they are not automatically added to model-facing text/image blocks. The viewer sends no chat messages or model-context updates. Existing domain tools are model-only for Apps clients. Schema, metadata and non-Apps fallback are checked with actual stdio and focused tests.

The host still receives pixels and can retain them. App-only visibility and resource policy are not confidentiality guarantees against the host/provider. Template inspection and local request observation do not establish every host's storage, transcript handling or OS-wide egress. No public HTTP listener or tunnel was added.

## Remaining gates

- Complete production UI qualification in the installed host lanes when native computer use is available; include actual permission behavior, fullscreen and provider disconnect/restart.
- Record the resumed 30-minute stress result and timing/memory series in [its report](embedded-stress.md). The interrupted attempt is not a pass.
- Record clean installed consumer and cross-platform CI results independently.
- User visual acceptance, region handoff and full embedded manual editing are separate. The delivered panel is a read-only mirror; editing and explicit Save stay in the desktop authority.
- Apple notarization/account authentication remains the existing public-download gate. Local signing and local installation do not close it.

## Local setup and CI boundary

The verified installed app reports 0.2.0 with the existing library preserved. Codex now has an ordinary `agent-excalidraw` stdio entry using `/Users/ralf/.local/bin/agent-excalidraw mcp`, with no synthetic data-directory override. A fresh agent session may be needed for tool discovery. Owned temporary preview registrations in Codex and Claude Desktop were removed. The canonical skill continues to fetch the installed version's core guide.

The implementation was pushed at `d7f46dd`; **all four native CI lanes passed**, each running source and packaged journeys: macOS arm64, macOS x64, Windows x64 and Linux x64. [Exact run](https://github.com/ralfboltshauser/agent-excalidraw/actions/runs/44637870582). Proposed additional workflow steps were excluded because the available GitHub OAuth credential lacks `workflow` scope and existing SSH access did not complete. The additional eight-case viewer harness has direct local evidence; no new CI execution for that harness is claimed. No persistent Git/auth configuration was changed. Later test-only coverage is identified separately from these exact source bytes.

Reproduce with `npm run build`, `npm run typecheck`, `npm test`, `EMBEDDED_BROWSER_TESTS=1 npx tsx --test tests/embedded-ui.test.ts`, and `npm run test:e2e`. Set `AGENT_EXCALIDRAW_EXECUTABLE` to the packaged executable for the native package suite. Stress instructions and limits are in the separate report. Test screenshots and private endpoint files remain local; never upload the latter.
