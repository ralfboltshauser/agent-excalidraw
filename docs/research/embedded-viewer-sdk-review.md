# Embedded viewer: SDK and contract review

Research date: 2026-11-19. Independent research/design review for the implementation-plan author; no implementation or runtime qualification. Read alongside [embedded-scenes](embedded-scenes.md), [host compatibility](embedded-host-compatibility.md), and [architecture](../architecture.md). Recommendations below are proposed contracts, not shipped behavior.

## Decision and principal objections

Use a small, bundled, read-only MCP App that displays immutable image captures from the existing renderer. Share the same template and server contract across T3 with Codex, T3 with Claude, and Claude Desktop local stdio. Preserve the ordinary CLI and MCP tools. Do not add a second Excalidraw editor, HTTP listener, filesystem-backed polling loop, subscriptions, selection handoff, or export controls to establish the first useful viewer.

The main plan risks are:

- Installing the current Apps SDK without a version pin silently introduces the MCP 2.x package family; it is not a drop-in extension of our SDK 1.32.2.
- Polling existing `render`/`export` creates files, can launch the desktop app, and is not a read-only capture operation. A path is neither image bytes nor a browser capability.
- A document revision alone is insufficient for freshness: Save can change saved/dirty status without changing scene content. Capture identity and status identity need separate treatment.
- Tool visibility, read-only annotations, and data privacy are three different contracts. None provides blanket protection from host retention or provider processing.
- The older research's 256 KiB T3 limit is directional: the inspected check bounds iframe-to-host messages, not host-to-iframe tool replies.
- There is no standardized `hostContext.visibilityState` in the reviewed 2026-01-26 contract. Offscreen polling suspension must not depend on an invented field.

## Version evidence and compatibility

Registry metadata was fetched directly, without installation. At review time the registry's `latest` tag is **2.0.4**, while **2.1.0** is also published. Thus “highest published version” and “latest dist-tag” differ. The latest published **1.x** version is **1.7.5**. Pin the exact version chosen, not a tag. [Registry][registry]

| Component | Exact source/version | Consequence |
| --- | --- | --- |
| Local project | HEAD `ede3a52a592652604b26669ef9e436a99ab3fa04`; SDK `1.32.2`, Zod `4.6.7`, Vite `8.3.8`, Excalidraw `0.18.1` | Existing package pins; no dependencies changed. |
| Recommended Apps SDK for this increment | `@modelcontextprotocol/ext-apps@1.7.5`, commit `92f46a574568a3ddac7600343b7d3c4c4ed7b588` | Peer SDK `^1.29.0` includes 1.32.2; Zod `^3.25.0 || ^4.0.0` includes 4.6.7. React and React DOM are optional peers; the vanilla viewer needs neither. [Manifest][v1-package] |
| Current registry default | `ext-apps@2.0.4`, commit `7af9a75da720b8a81be0f9aff47b25f75e9530ad` | Required peers core/client `^2.0.0`, Zod `^4.2.0`; server `^2.0.0` is optional globally but needed for server helpers. [Manifest][v2-package] |
| Highest published version observed | `ext-apps@2.1.0`, registry gitHead `6cc763a8291b1fbbca8e3844efbcea1b9162b5a5` | Not the `latest` tag; no recommendation to adopt it. [Registry][registry] |
| Optional single-file plugin | `vite-plugin-singlefile@2.3.4`, gitHead `59e8faa9ed8df908baf06b86101641d8abd73ca3` | Peer Vite `^5.4.21 || ^6.0.0 || ^7.0.0 || ^8.0.0`, Rollup `^4.59.0`. Vite 8.3.8 satisfies the declared Vite range; actual build compatibility remains a test. [Registry][singlefile-registry] |
| T3 source rechecked | `5bc2d512e470ed8f3ea6b5876118d9f3b39c4474` | Host bridge, frame, shared Apps constants, request router and snapshot source are byte-identical to the earlier review's `031dd1a…` versions. Provider adapters and user guide were also read at the new pin. [Host][t3-host], [guide][t3-guide] |
| Current upstream Apps repository | `ea3e9d0e624a20bc1c51310292f09d9b8ed17161` | Repository HEAD is not a published npm version; do not combine its draft APIs with the pinned 1.7.5 runtime. |

For future lockfile verification, the registry reports the 1.7.5 tarball integrity as `sha512-TjPH2S2y5UEGKhmI6+XGFuqfqOV4ppe1x6DA3txnUaEWkgtA4G5vo14jGKFZmegdkZ1H4QMLyujLvoU1BEdnAg==`. This review retrieved metadata/source, not an installed dependency tree or a reproducible build.

The official v2 migration guide says the split SDKs share no classes/types with SDK 1.x, while the Apps postMessage protocol and UI-resource metadata remain compatible. **Package major version and wire-protocol version are independent.** Keeping 1.7.5 avoids an unrelated server migration; it does not mean the host must use the same npm major. [Migration guide][migration]

Our adapter currently uses low-level `Server` and manual request handlers. `registerAppTool`/`registerAppResource` accept the high-level `McpServer` registration interfaces, not that low-level instance. The smallest change can retain low-level handlers and add equivalent validated metadata/resource handling, using the Apps SDK for the browser bridge and capability helper. If the parent chooses `McpServer`, account explicitly for schema, error, tool-name and fallback parity; do not smuggle a full adapter rewrite into the viewer. Use Zod schemas with 1.x helpers; their widened Standard Schema types do not imply non-Zod runtime support on SDK 1.x. [Helper source][server-helpers], [local adapter](../../src/cli/mcp.ts)

## Packaging and metadata contract

Serve one static, versioned resource such as `ui://agent-excalidraw/viewer-v1.html`, with `text/html;profile=mcp-app`. Link the opening tool through `_meta.ui.resourceUri`; explicitly choose visibility for every new tool. The SDK helper also normalizes the deprecated flat resource key, but canonical nested metadata should remain authoritative. `getUiCapability` reads `clientCapabilities.extensions["io.modelcontextprotocol/ui"]`; check the supported MIME type rather than guessing from client names. [Helper source][server-helpers]

Declare resource policy on the **returned resource contents entry**: `_meta.ui.csp` with empty `connectDomains`, `resourceDomains`, and `frameDomains`, and no requested device permissions. T3's capture code reads policy from that location. Registration metadata alone is insufficient evidence that policy arrives there. Do not require `_meta.ui.domain`: its meaning/format is host-specific, and T3 does not use it to grant filesystem/network access. `prefersBorder` is a presentation preference. `hostInfo` and optional host context are negotiation/UI data, never document authorization. [T3 capture][t3-snapshot], [SDK schema][schema]

The pinned official example uses Vite plus `viteSingleFile`. The existing desktop Vite build emits chunks and separately copies fonts; its HTML cannot simply become the `ui://` resource. Create a separate tiny viewer entry, bundle its bridge code and CSS, omit source maps from delivered HTML, and avoid bringing the editor/React/font tree into it. Keep the HTML comfortably below T3's 5 MiB capture limit. [Example config][vite-example], [local build](../../scripts/build.mjs), [T3 constants][t3-shared]

The plugin inlines recognized JavaScript/CSS, not every possible resource: its author documents public-folder assets, SVG references and non-inlined chunks as traps. Pinning the plugin and satisfying peer ranges does not prove offline output. Inspect the produced HTML for external/relative loads, dynamic imports, font URLs and source maps; exercise with network denied. A hand-built single HTML bundle with inline CSS and one esbuild-generated browser script is also reasonable for this small viewer; no plugin is intrinsically required. [Plugin documentation][singlefile]

The template must contain no private scene, local path, endpoint token, or document-specific capability. T3 persists the fetched HTML as a thread attachment. Version the template URI when its contract changes, because hosts may cache it and historical cards can outlive the server release. [T3 capture][t3-snapshot]

## Smallest proposed interface

These are conceptual names/types for the parent to refine, not an implementation prescription.

1. **`open_viewer({document, epoch})`**, model-visible, read-only, with the UI resource link. Validate explicit identity against the running authority. Return minimal model-facing text (opened identity/status plus CLI fallback guidance) and a schema-versioned viewer binding. Do not return scene JSON/image bytes in this model-originated call. Put an opaque binding in result `_meta` if needed, but do not treat it as protection from the host. Requiring `snapshot` first is acceptable and keeps this tool from following the active document implicitly.
2. **`viewer_read`**, app-only (`_meta.ui.visibility: ["app"]`), genuinely read-only, using a strict discriminated input schema. `head` takes the binding and last display-state token; it returns `unchanged`, `changed`, `empty`, `unavailable`, `stale`, or `expired`. On change, return a bounded image descriptor; `chunk` takes only an opaque capture ID, offset and bounded length. No arbitrary `path`, URI, output format, embed-scene, shell action or filesystem destination.
3. **One static HTML resource**, ordinary `resources/read`, containing only the client. Reuse current CLI commands for the fallback; no new CLI viewer command is necessary to qualify embedding.

One read tool with `head`/`chunk` variants keeps the public surface small while allowing large, immutable captures. Do not overload it with writes. If actual host limits demonstrate that all supported previews fit one bounded response, the chunk variant can be deferred; oversize must then produce an explicit limitation rather than an oversized reply or truncated image.

Explicitly mark existing scene-changing/file-writing tools model-only for the Apps route unless a later feature deliberately exposes them to the view. Our current adapter omits UI visibility, whose default is both model and app; adding only an app-only read tool would otherwise leave the whole command surface callable by an App, subject to host approvals. Model-only visibility preserves ordinary agent invocation. Enforce the narrow read contract server-side rather than trusting a disabled button or the `readOnlyHint` label. [Visibility contract][spec], [local adapter](../../src/cli/mcp.ts)

Recommended output contracts:

| Record | Required meaning |
| --- | --- |
| Binding | Protocol schema version; explicit document and epoch; short-lived opaque runtime binding. Validate it server-side on every read. It is not the private socket credential. |
| Display state | Document, epoch, scene revision, captured saved/dirty state, observation time and an opaque state token that changes when relevant status changes. Do not invent `savedRevision` semantics if the live authority only has a saved fingerprint. |
| Image descriptor | Capture ID, exact captured document/epoch/revision, MIME, total encoded/decoded sizes, dimensions, bounds and transform if exposed; expiry and complete/error state. |
| Chunk | Capture ID, offset, actual byte count, total bytes, completion flag and base64 bytes. Offsets refer to decoded bytes; alignment/maximums are specified. Never re-render between chunks. |

Default to a bounded PNG preview in an `<img>` with local pan/zoom/fit. This avoids needing to execute or insert scene-derived SVG markup in the application DOM. A sanitized SVG image can be a later fidelity option. The current SVG exporter deliberately preserves navigable HTTP(S) and some `file:` drawing links; “self-contained” means no loading references, not “all links are safe to activate inside a host.” Never use raw `innerHTML` for drawing text/SVG or let diagram links navigate the App. Keep `embedScene` false and omit native drawing payloads. [Local renderer](../../src/renderer/controller.ts), [SVG handling](../../src/renderer/svg-export.ts)

Bindings must expire on adapter/runtime restart, document epoch change or explicit invalidation. Reject old cards after reopen/switch; do not rebind to today's active drawing, auto-open a disk path, relaunch the desktop app or reconstruct access from a document title. A selected old card may retain its last already-delivered image, labelled stale; the server cannot claw bytes back from the host. Explain that limitation rather than promising deletion.

Do not use connection ID alone as a security boundary: the protocol scopes app calls to the originating server connection, but all Apps on that connection share that route. Bind reads narrowly and verify scope in our adapter. A same-user process or controlling host is outside the protection afforded by an opaque handle.

## Capture authority and polling lifecycle

The renderer must admit the requested document/epoch beside the editor, capture an immutable scene and its receipt together, and return image bytes without writing a file. Main may broker/cache the result but must not render its notification mirror, reread the saved `.excalidraw`, or manufacture the capture receipt. Existing rendering clones scene plus receipt before asynchronous export; preserve that pattern and reject a result if its binding was invalidated during preparation. [Architecture](../architecture.md), [controller](../../src/renderer/controller.ts)

Perform a cheap live state check before expensive rendering; unchanged polls must not re-export fonts/images. Include saved/dirty transitions in the state token. Cache by document/epoch/content revision plus preview parameters, bounded by bytes, count, age and inflight work. A capture's pixels and status are observations, not a claim that the screen is current at delivery. If Save races with capture, either attach coherent status or separately timestamp the status observation.

Register tool-input/result, host-context, teardown and error handlers **before** awaiting `app.connect()`. The pinned `App` performs the handshake and refuses server calls before initialization; use `getHostCapabilities().serverTools` before polling. Merge optional host-context updates; theme, dimensions, platform, locale, safe-area and display-mode values guide layout, not data access. Keep the canvas's drawing colors independent from shell theme. Fullscreen is optional and should request only host-advertised modes; T3 also requires recent user interaction. [SDK App source][app], [T3 frame][t3-frame]

After a valid final opening result, use a recursive delayed poll (roughly two seconds initially), with **one request/capture fetch in flight per view**. Schedule after completion, back off on transient errors, pause when `document.hidden` or the view's intersection is absent, and refresh immediately on visible resume. The SDK patterns demonstrate app-only polling and IntersectionObserver cleanup, but do not promise a host-level visibility event. An iframe-local observer may not reflect every host occlusion; measure this in each surface. Provide Pause/Resume and explicit Refresh so an old conversation cannot poll indefinitely under uncertain visibility. [Patterns][patterns]

On teardown/pagehide, stop timers, abort pending client work where supported, disconnect observers and revoke blob URLs. Ignore late replies using a local generation/binding check. Do not rely on a graceful teardown for server cleanup: host crashes and mobile remounts exist, so handles/caches need expiry. Show disconnected/stale status instead of silently claiming “Live.” Retrying a read may be safe, but should not activate or open another drawing. T3's documented provider-stop behavior requires the original thread's agent to be running; mobile fullscreen can recreate the App. [T3 guide][t3-guide], [SDK App source][app]

Resource subscriptions are not the baseline: the inspected T3 bridge implements reads/calls, not `resources/subscribe` or forwarding resource-update notifications. Tool-result notifications represent the originating call, not a stream of later scene mutations. `serverResources: {}` does not mean subscriptions are supported. [Host source][t3-host]

## Limits, annotations and disclosure traps

| Boundary observed in source | Planning implication |
| --- | --- |
| T3 HTML capture: 5 MiB UTF-8 | Static template budget; not the allowable size of every scene response. [Constants][t3-shared] |
| T3 inbound App bridge: 256 KiB serialized message, 16 pending requests | Keep App requests small and sequential. The check is in `receive`; replies are posted without that check. Do not claim a proven 256 KiB response maximum. [Host][t3-host] |
| SDK pattern's 500 KiB chunk | Example, not a normative or cross-host limit. [Patterns][patterns] |
| Local socket client: 8 MiB request / 32 MiB reply | A later chunked MCP reply cannot repair an oversized renderer-to-adapter response. Limit preview dimensions/bytes at the producing layer. [Transport](../../src/cli/transport.ts) |
| Current MCP image attachment: PNG bytes at most 12 MiB | Existing ordinary render fallback behavior, not Apps host compatibility. Base64 adds about one third plus JSON overhead. [Adapter](../../src/cli/mcp.ts) |
| Current PNG render: maximum side 16,384 px / 64 million pixels | Safety ceiling, not an appropriate recurring viewer budget; SVG has different size characteristics. [Controller](../../src/renderer/controller.ts) |

Propose a conservative initial chunk cap of 128 KiB decoded (about 171 KiB base64), plus separate total-image, decoded-pixel, response and runtime-cache budgets. This is a chosen starting budget, not a claimed host guarantee. Degrade preview resolution or display an explicit oversize message before chunking megabytes repeatedly. Validate counts, offsets, MIME, dimensions and total size on both ends. Never combine chunks from different revisions; expire old captures explicitly.

**Disk-path trap.** Current main `render` creates unique files in previews if no output is supplied; `export` may show a save dialog; explicit destinations use exclusive file creation. The MCP adapter then rereads PNG from the returned path. A polling wrapper would grow disk usage, expose paths and retain confidential artifacts. The general command path also updates agent activity/broadcasts for most requests. A dedicated capture read should not trigger recovery/save/history, agent-active indicators, launch/bootstrap or filesystem exports. [Main](../../src/main/index.ts), [adapter](../../src/cli/mcp.ts)

**Annotation trap.** T3's frame permits calls without write approval only when its tool-info path sees `annotations.readOnlyHint === true`. App visibility is checked independently server-side. Only the in-memory capture read merits that hint; existing `render`/`export` must remain writes. A binding/cache allocation does not change the drawing, but the endpoint must never accept an export/save action. Set read-only/idempotent/non-destructive/closed-world hints consistently, then test actual prompts: MCP annotations are advisory, and clients may distrust them. [T3 requests][t3-requests], [frame][t3-frame], [core tools specification][core-tools]

**Model-context trap.** The pinned Apps spec's best-practice prose describes `structuredContent` as outside model context, but core MCP also recommends serializing structured results into text for backwards compatibility. This is not a portable secrecy promise. Avoid copying UI image/chunk data into model-facing text; do not use `structuredContent` alone as the reason data is private. App-only visibility excludes discovery/callability by the model in compliant hosts; the host still receives the full result. [Apps contract][spec], [core tools][core-tools]

T3's Claude adapter explicitly requires `mcp_call_result_not_for_model_v1` and sends `result_not_for_model: true`; its Codex adapter uses dedicated `mcpServer/tool/call`/resource-read requests. Those are stronger route-specific evidence than a generic “hidden tool,” but still require retention/transcript inspection. Neither route proves a no-retention policy. Do not call `sendMessage`/`updateModelContext` automatically, log payloads, embed them in HTML/URLs, or expose socket credentials. Defer selection-to-agent features because they add an explicit disclosure contract. [Claude adapter][t3-claude], [Codex adapter][t3-codex]

## Host qualification and CLI fallback

Claude's current official guide documents local stdio examples rendering inline in Desktop. Its remote-only “app tools” means UI-provided tools that Claude can invoke; it must not be confused with ordinary server tools marked app-visible for polling. Entry points and embedded websites are also remote-backed capabilities. None is needed for this viewer. The closed-source Desktop build still needs qualification; the guide is not a runtime result. [Claude guide][claude-guide]

T3 source supports Codex and Claude as separate provider lanes. Its guide requires Claude Code 2.1.301 or newer; qualify the named capabilities rather than version-string guessing alone. Do not extend those claims to standalone Codex/Claude terminal rendering. Existing ordinary `snapshot`, `render`, `save` and text refusals remain available when Apps negotiation is absent. The fallback may intentionally create an image artifact through today's CLI; describe it as a snapshot with its returned receipt/path, not an automatically updating view. [T3 guide][t3-guide], [installed command guide](../../src/cli/core.ts)

Do not add an MCP dependency to CLI-only workflows or require an MCP-enabled host just to draw/render. When an App read fails, give a precise state and the existing command workflow. For “Open in desktop,” the first increment can simply tell the user to use the desktop app; T3's open-link path only accepts HTTP(S), so a custom scheme or shell launcher is not a shared primitive. [Host][t3-host]

## Unresolved runtime tests for the milestone plan

Use synthetic drawings and record exact host/provider/app versions. No lane below was exercised during this review.

- **Three independent lanes:** T3/Codex, T3/Claude and Claude Desktop local stdio: extension MIME negotiation, static resource policy, `_meta` binding delivery, app-only tool hidden from model discovery, read calls without write prompts, and usable fallback without Apps. Claude processes require the project's subscription-only workflow in a separately authorized test.
- **Freshness and identity:** unsaved human/CLI edits, undo/redo, Save without scene edit, empty drawing, queued render during switch/close, reopen same file, renderer crash, desktop/adapter restart and replay of old conversations. A card must never follow a newly active private document.
- **Concurrency and lifecycle:** rapid Refresh plus poll, delayed/reordered results, provider stop/restart, lost connection, scrolling offscreen, background tab, collapsed card, mobile fullscreen remount and teardown omission. Measure whether polling actually stops; no overlapping renders or queue starvation of human/agent work.
- **Bytes and fidelity:** text-only/font-heavy scenes, embedded raster images, Unicode, huge sparse bounds and maximum host replies. Test template size, actual request/reply thresholds, base64 overhead, decoding/pixel limits, truncation, chunk expiry and cache eviction. Qualify bounded preview quality and memory rather than relying on export's large safety ceiling.
- **Privacy and read-only behavior:** inspect network, provider transcript, host attachments and debug logs using synthetic markers. Prove polling creates no files, source/recovery changes, new history entries, agent-activity side effects or unexpected app launches. Inspect historical-card retention; distinguish avoided future reads from already-retained pixels.
- **Offline packaging:** launch installed/package-distributed adapter away from the repo working directory, with network denied and no loose build assets. Confirm no CDN/font/relative imports, HTML source-map leakage, broken MIME, external diagram navigation or hidden dependency on Electron preload.

The parent should make these acceptance gates concrete in its milestone plan. This review recommends contracts and objections; it does not claim host runtime success or prescribe the full implementation sequence.

## Sources

[registry]: https://registry.npmjs.org/@modelcontextprotocol%2fext-apps
[v1-package]: https://github.com/modelcontextprotocol/ext-apps/blob/92f46a574568a3ddac7600343b7d3c4c4ed7b588/package.json
[v2-package]: https://github.com/modelcontextprotocol/ext-apps/blob/7af9a75da720b8a81be0f9aff47b25f75e9530ad/package.json
[migration]: https://github.com/modelcontextprotocol/ext-apps/blob/7af9a75da720b8a81be0f9aff47b25f75e9530ad/docs/migrate-to-2.md
[server-helpers]: https://github.com/modelcontextprotocol/ext-apps/blob/92f46a574568a3ddac7600343b7d3c4c4ed7b588/src/server/index.ts
[app]: https://github.com/modelcontextprotocol/ext-apps/blob/92f46a574568a3ddac7600343b7d3c4c4ed7b588/src/app.ts
[schema]: https://github.com/modelcontextprotocol/ext-apps/blob/92f46a574568a3ddac7600343b7d3c4c4ed7b588/src/generated/schema.ts
[spec]: https://github.com/modelcontextprotocol/ext-apps/blob/92f46a574568a3ddac7600343b7d3c4c4ed7b588/specification/2026-01-26/apps.mdx
[patterns]: https://github.com/modelcontextprotocol/ext-apps/blob/92f46a574568a3ddac7600343b7d3c4c4ed7b588/docs/patterns.md
[vite-example]: https://github.com/modelcontextprotocol/ext-apps/blob/92f46a574568a3ddac7600343b7d3c4c4ed7b588/examples/basic-server-vanillajs/vite.config.ts
[singlefile-registry]: https://registry.npmjs.org/vite-plugin-singlefile/2.3.4
[singlefile]: https://github.com/richardtallent/vite-plugin-singlefile/blob/59e8faa9ed8df908baf06b86101641d8abd73ca3/README.md
[t3-host]: https://github.com/pingdotgg/t3code/blob/5bc2d512e470ed8f3ea6b5876118d9f3b39c4474/packages/client-runtime/src/mcpApps/host.ts
[t3-frame]: https://github.com/pingdotgg/t3code/blob/5bc2d512e470ed8f3ea6b5876118d9f3b39c4474/apps/web/src/components/chat/McpAppFrame.tsx
[t3-shared]: https://github.com/pingdotgg/t3code/blob/5bc2d512e470ed8f3ea6b5876118d9f3b39c4474/packages/shared/src/mcpApp.ts
[t3-requests]: https://github.com/pingdotgg/t3code/blob/5bc2d512e470ed8f3ea6b5876118d9f3b39c4474/apps/server/src/mcpApps/McpAppRequests.ts
[t3-snapshot]: https://github.com/pingdotgg/t3code/blob/5bc2d512e470ed8f3ea6b5876118d9f3b39c4474/apps/server/src/mcpApps/McpAppSnapshot.ts
[t3-claude]: https://github.com/pingdotgg/t3code/blob/5bc2d512e470ed8f3ea6b5876118d9f3b39c4474/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts
[t3-codex]: https://github.com/pingdotgg/t3code/blob/5bc2d512e470ed8f3ea6b5876118d9f3b39c4474/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts
[t3-guide]: https://github.com/pingdotgg/t3code/blob/5bc2d512e470ed8f3ea6b5876118d9f3b39c4474/docs/user/html-renders.md
[core-tools]: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
[claude-guide]: https://claude.com/docs/connectors/building/mcp-apps/getting-started
