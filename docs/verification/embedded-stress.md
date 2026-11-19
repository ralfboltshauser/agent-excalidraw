# Embedded presentation stress qualification

Completed 2026-11-20 Europe/Zurich. **Passed 1,800.001 seconds with no recorded failures and a clean owned-app shutdown.** The earlier attempt was stopped at the user's request and is not counted as completion.

## Observed result

Signed macOS arm64 0.2.0 ASAR SHA-256 `766ede6aeb9dc0cf2a6d497fdde2fbf3b5139d0edf19d95a045a5a405a100e7b`, unchanged at the end. Reference machine: Apple M2 Max, Darwin 25.5.0. Local raw synthetic evidence: `/tmp/ae-stress-cH4XIU/results.json`; private endpoint data in that directory must not be uploaded.

| Measurement | Result |
| --- | --- |
| Requests / frame deliveries / chunks | 8,392 / 678 / 1,356 |
| Edits and explicit saves | 112 each |
| Preservation checks / native visibility cycles | 61 / 59 |
| Unchanged heads / save-only status heads | 5,094 / 672 |
| All head replies, p95 / maximum | 31.1 / 205.5 ms |
| Frame head replies, p95 / maximum | 37.7 / 205.5 ms |
| Unchanged head replies, p95 | 15.3 ms |
| Ordinary snapshot / apply / save, p95 | 14.6 / 24.8 / 46.8 ms |

Frame timings mix initial encoding and shared-cache hits; they are not an isolated encoder benchmark or host UI latency measurement. Every delivered PNG passed byte length, dimensions, identity/revision and SHA-256 checks. Read-only preservation intervals kept saved bytes, tracked artifacts, scene/selection/revision and agent activity unchanged. Save-only updates did not create a new content frame.

181 aggregate app-process RSS samples ranged from **564.4 to 683.3 MiB**, starting at 573.7 and ending at 636.5 MiB (+11.0%). The final ten-minute median was 647.4 MiB. This includes editor history, GPU/runtime allocation and warm-up; it does not prove leak freedom or attribute every byte to the presentation cache. Later samples fluctuate rather than showing monotonic growth, but longer/unique-image and actual retained-host-panel workloads remain separate checks. Internal cache caps are established by focused module tests, not inferred from process RSS.

## Reproduce and scope

The reproducible harness is `tests/embedded-stress.mjs`.

Run from the repository with `node tests/embedded-stress.mjs`. It requires existing build outputs and installed Playwright/Electron dependencies; it does not build or install. `AE_STRESS_SECONDS=20` runs only a smoke check. `AE_STRESS_EXECUTABLE` explicitly selects an executable; otherwise the preferred `/tmp/ae-embedded-release-arm/mac-arm64/Agent Excalidraw.app` is selected only after strict code-sign verification, with existing source dist as fallback.

Every run allocates a mode-0700 `/tmp/ae-stress-*` root containing isolated app data, drawing, agent integration roots and evidence. Launch strips `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS`. Cleanup closes only the owned Electron application; timeout cleanup targets its owned process group. Endpoint credentials remain in the private test root and are not printed. No production files, package metadata, configuration or other app instances are changed.

The synthetic fixture contains 250 rectangles plus ten Unicode bound labels, six independent presentation bindings to the same explicit document/epoch, two-second concurrent head polling, edits/saves every 15 seconds, preservation checks every 30 seconds and process-memory samples every ten seconds. Each new frame is downloaded in bounded chunks; PNG signature, dimensions, length, revision, document/epoch identity and SHA-256 are checked. Unchanged replies and save-only status transitions are asserted. Read-only intervals compare saved drawing bytes, application JSON/image artifacts, scene elements/selection/revision and agent activity. Native windows alternate hidden and `showInactive()` with focus disabled; this is not actual embedded host visibility qualification.

Evidence is synthetic. The test exercises the real renderer-backed private socket presentation contract, not T3/Claude host permissions, actual MCP App UI polling, frontend visibility timers, provider transcripts or image-heavy drawings. There is no claimed change-to-visible UI measurement, sustained queue/cache internals instrumentation, OS-wide memory attribution or ordinary editing regression baseline. Memory growth must be assessed from the recorded series, not interpreted as leak freedom from a final sample.
