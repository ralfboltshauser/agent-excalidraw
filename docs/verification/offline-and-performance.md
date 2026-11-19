# Offline and performance verification

On 2026-11-19, the native packaged app completed the offline audit and full reference benchmark described below. These are measurements of one build on one Mac, not universal performance or network-isolation guarantees.

## Tested build and machine

- App: 0.1.0; packaged `app.asar` SHA-256: `b1123fe97a46c86a981bf6900b8ece9c6545ac717a6f4d38eea485844d94dbc0`.
- Hardware: Apple M2 Max, 12 logical CPUs, 64 GiB RAM, arm64.
- OS: macOS, Darwin kernel 25.5.0.
- App runtime: Electron 45.4.1, Chromium 156.0.8078.100, Node 24.22.3. Harness: Node 25.2.1, Playwright 1.58.2. Editor: Excalidraw 0.18.1.
- Offline audit: 18:03:34–18:03:39 UTC. Benchmark: 18:03:47–18:04:24 UTC.

The archive hash identifies the tested application bytes independently of later documentation or test-only commits. This report does not establish notarization or installation trust; see [macOS trust verification](macos-trust.md).

## Offline editing and exports

The [native audit script](../../scripts/offline-audit.mjs) ran two fresh app-data profiles: normal network access and Chromium offline emulation (`navigator.onLine` was respectively true and false). Each exercised all eight editor font-family choices, representative CJK text and emoji, a real file-picker PNG import and placement, save/reopen, PNG/SVG export, and a remote embed represented by an inactive placeholder.

During each confidential-editing phase, observers recorded **282 completed local requests, zero remote request attempts or completions, and zero main-process undici fetch events**. All content was synthetic. Observers covered Playwright/browser requests, Electron session completion/error events, CSP violations, and main-process undici diagnostics without replacing the application's request-blocking policy.

Separate positive controls established that the observers worked: an intentional renderer fetch was blocked by the actual `connect-src` CSP, while an explicit update check produced an observed main-process GitHub request and HTTP 404 response because no public release existed at the time. That update request was outside the confidential-editing phase.

All **234 bundled WOFF2 assets** were fetched locally, SHA-256 checked against the font inventory and parsed by Chromium's real `FontFace` implementation in both profiles. Representative text and exports were visually inspected; this is not a glyph-by-glyph Unicode audit.

Both SVG exports parsed successfully and contained no external CSS or image-loading references. The embedded fallback font matched the modern Agent Sans asset exactly:

```text
5b8340b229c2f9888b8035b68e8489e28b3af3c4d561463bc31030b01cdfcb2e
```

The exported font-license metadata contained 32,522 characters, including the complete OFL text and the checked Agent Sans, Google and Red Hat notices. See [font provenance and notices](../THIRD_PARTY_NOTICES.md) and the [fallback provenance](../../assets/fonts/provenance.json).

This is **process-level observation, not an OS firewall or packet-capture test**. Observers attach at the first native window, before scene work; earlier startup requests are outside coverage. Chromium offline emulation does not disable Node networking or the whole machine. The audit does not observe arbitrary raw sockets. SVG remains a vector format that can retain links and original image resources; use PNG when sharing only rendered pixels.

## Performance

The [native benchmark](../../scripts/benchmark.mjs) used real Electron windows, the editor and CLI. Small and medium fixtures contained respectively 250 elements/3 images (116,161 serialized bytes) and 2,000 elements/12 images (924,342 bytes). Images were generated PNGs. The library contained 10,000 metadata entries and 500 actual source files; the remaining entries represented unavailable files.

Each row below uses **20 samples and nearest-rank p95**:

| Journey | Median | p95 |
| --- | ---: | ---: |
| Fresh process/data to usable New button | 536.07 ms | 566.40 ms |
| Warm small drawing open | 50.75 ms | 60.19 ms |
| Warm medium drawing open | 124.95 ms | 138.80 ms |
| Small drawing PNG render | 44.64 ms | 51.83 ms |
| CLI `--version` startup | 75.40 ms | 85.78 ms |
| CLI status round trip | 76.11 ms | 83.86 ms |
| CLI small snapshot round trip | 82.96 ms | 88.33 ms |
| Search 10,000 library entries | 30.81 ms | 41.16 ms |
| Navigate to Agents | 43.21 ms | 61.30 ms |

Large-library launch took **548.98 ms in one sample**. Explicit scanning of 500 files took **116.29–121.52 ms across three samples** (median 119.51 ms). Neither has enough samples for a p95 acceptance claim.

Across 50 alternating drawing switches through Library, aggregate process working set changed from 817,856,512 to 898,007,040 bytes (**+9.8%**). Samples at switches 10/20/30/40/50 were 837,910,528 / 891,142,144 / 891,699,200 / 884,441,088 / 898,007,040 bytes: a net increase with one intervening decrease, not evidence of a long-term plateau. A separate large-library process measured 674,873,344 bytes after searching. Working-set sums can double-count shared pages; no forced garbage collection was used. This is not proof of freedom from memory leaks. The switches reuse two fixtures and replace the single mounted editor's document; they do not test unique-image accumulation or retained-tab creation/teardown.

One synthetic Space-drag journey on the medium drawing produced 244 animation-frame intervals: median **10.0 ms**, p95 **11.6 ms**, maximum **12.4 ms**. Sixty injected pointer events had capture-listener dispatch delay median **8.6 ms**, p95 **10.6 ms**, maximum **13.3 ms**. The content revision remained unchanged. Idle frame intervals had p95 11.7 ms across 81 observations. These correlated samples describe one journey, not independent repeated trials; dispatch delay is not physical input-to-pixel latency or complete handler duration.

Fresh-data launch does not purge OS disk caches and excludes installer/quarantine latency. Open timing ends after the actual open command and two animation frames, without guaranteeing every offscreen asset has painted. UI timings include automation overhead. Screenshots of the drawing, library and search were inspected. Results require remeasurement on other hardware, operating systems, larger resources and later builds; the scripts do not automatically declare milestone acceptance.

## Reproduce

From the repository root, install dependencies and build a native package. For an Apple Silicon Mac:

```sh
npm ci
npm run package -- --mac --arm64
export AGENT_EXCALIDRAW_EXECUTABLE="$(pwd)/release/mac-arm64/Agent Excalidraw.app/Contents/MacOS/Agent Excalidraw"
node scripts/offline-audit.mjs
node scripts/benchmark.mjs
```

For an existing package, set the executable variable to its native executable instead. Omit the variable to test the development build after `npm run build`. Run these scripts serially in an available desktop session; concurrent GUI tests interfere with focus and timings. The default benchmark uses 20 samples and 50 switches; `--quick` is a smaller diagnostic, not equivalent evidence.

The scripts create isolated synthetic app data and local JSON/screenshot evidence under `artifacts/offline-audit/` and `artifacts/benchmark/`. Those generated files are intentionally ignored by Git. Review generated reports before sharing: they contain local paths and process details. Publish sanitized results such as this document, never local endpoint capability files.
