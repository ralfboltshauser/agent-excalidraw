# Embedded host compatibility for Agent Excalidraw

Research date: 2026-11-19. Primary-source document and code review only; no host was installed, configured, or exercised. “Source-supported” below means the inspected implementation contains the path, not that the installed release has passed an integration test. GitHub links are pinned to the commits retrieved during this review. Scope excludes the parent investigation of T3 `html_render` networking/proxy and local server design.

## Finding

**A local live scene can be presented as an MCP App in some hosts, but there is no evidenced universal route across all four products.** Claude Desktop explicitly supports local stdio MCP Apps. Current T3 Code source contains a real MCP Apps iframe host and separate Codex and Claude provider adapters. Standalone Codex UI support is not established by the reviewed official product documentation; the Codex harness has host-facing support that a UI client must implement. Claude Code’s terminal is not established as an inline HTML host, although its programmatic facilities can supply data to T3’s host. Tool transport, HTML rendering, and continuous refresh are three separate requirements.[S1][S2][S3][S4][S5]

Recommend an **optional, self-contained, read-only MCP App mirror**, backed by the existing local stdio adapter and authoritative renderer captures. Use app-only snapshot polling through the host bridge first. Keep the desktop editor as the editing surface and retain ordinary tools/images for hosts without the Apps extension. Do not require a public tunnel or a nested localhost editor iframe for the baseline.

## Host matrix

| Surface | Local MCP transport evidence | Embedded MCP App UI evidence | Practical conclusion |
| --- | --- | --- | --- |
| Claude Desktop conversation | Official Apps guide gives local `--stdio` examples. | Explicit instructions say the app renders inline after its tool runs. | Best documented local target. Bundle the view itself in `ui://`; test live refresh separately. |
| T3 Code web/desktop, Codex provider | Codex supports stdio; T3 routes resource reads and tool calls through its provider session. | T3 captures the UI resource from a Codex MCP tool result, stores its HTML as an attachment, and mounts `McpAppFrame`. | Source-supported, conditional on T3 and Codex versions and correct UI metadata. No runtime claim for the installed build. |
| T3 Code web/desktop, Claude provider | T3 reuses the running Claude process’s MCP connection. | Dedicated capture path, gated by three named process capabilities; failure falls back to an ordinary tool row. | Source-supported only when those capabilities exist. This does not establish standalone Claude Code rendering. |
| Standalone Codex CLI | Official documentation supports stdio and Streamable HTTP. | A terminal iframe renderer is not established. | Ordinary tools/images; do not advertise inline MCP Apps. |
| Standalone Codex desktop/IDE | MCP configuration exists; harness can project the Apps capability from an outer client. | Reviewed OpenAI quickstart describes tools for ChatGPT and Codex, but UI specifically inside ChatGPT. Public harness code proves plumbing, not these clients’ renderer behavior. | Unverified; require surface/version-specific evidence and a real test. Do not transfer ChatGPT support to Codex by name. |
| Standalone Claude Code terminal | Official reference supports local stdio and remote transports. | Documentation distinguishes Apps UI resources as pages for a host to render; it hides them from ordinary resource discovery. No terminal iframe renderer established. | Tools are usable; an external UI host is needed for the embedded view. Claude Desktop’s Chat and Code surfaces must not be conflated. |

Sources: Claude Desktop [S1]; T3 host/frame/capture/adapters [S2][S3][S6][S7][S8]; Codex transport/product scope/harness [S4][S5][S9]; Claude Code [S10]. “Unverified” is a deliberate evidence limit, not a proof that a closed-source or future client can never support it.

## What MCP Apps actually requires

The versioned Apps extension is optional and explicitly negotiated using `capabilities.extensions["io.modelcontextprotocol/ui"]`, including the supported MIME type. A tool identifies a `ui://` resource through `_meta.ui.resourceUri`; `resources/read` supplies HTML with `text/html;profile=mcp-app`. The host renders that document and implements a separate JSON-RPC bridge over `postMessage`. The view performs `ui/initialize` and signals initialization; the host delivers tool inputs/results and exposes the capabilities it actually supports. Merely returning HTML, a resource link, or metadata to an arbitrary MCP client does not supply that host implementation.[S11]

Two connections must be distinguished:

1. **MCP client to local adapter:** stdio can carry HTML resources and tool responses without a public HTTP server.
2. **Sandboxed view to host:** browser `postMessage` carries bridge requests; the host proxies authorized `tools/call` and `resources/read` back to that adapter. The browser does not itself acquire stdio, filesystem, Node, Electron preload, or the app’s private socket.[S11]

The project’s current `src/cli/mcp.ts` advertises only tools and implements tool listing/calling over stdio. It does not currently register Apps resources. Thus this is a feasible extension proposal, not an existing capability.

### T3-specific limits visible in source

T3 pins the UI protocol to `2026-01-26`, recognizes `ui://` plus `text/html;profile=mcp-app`, and limits captured HTML to 5 MiB. Its frame is sandboxed with `allow-scripts allow-forms` and no `allow-same-origin`. The bridge checks the sending frame’s window reference; its inbound messages are limited to 256 KiB with at most 16 pending requests. Initial tool inputs/results are delivered once, with completion delivered later if needed. It is not a generic broadcast channel for later drawing edits.[S2][S3][S6]

The bridge implements `tools/call` and `resources/read`, but its reviewed request switch does **not** implement `resources/subscribe` or `resources/unsubscribe`, nor forward `notifications/resources/updated`. Its advertised `serverResources` is an empty object. Design for these actual capabilities, not the larger protocol’s possible feature set.[S2]

Tool calls are bound to the original app’s MCP server and a live provider session. Server-side validation checks app visibility; the frame asks approval for tools not marked read-only. The Claude adapter additionally checks deny rules because its direct MCP call path bypasses Claude’s usual permission check. It requires `mcp_tool_ui_meta_v1`, `mcp_read_resource_v1`, and `mcp_call_result_not_for_model_v1`, and reports unsupported/stopped sessions rather than starting a process for the view. A historical UI card is therefore not a promise of a permanently live session.[S3][S7][S8]

T3 persists the fetched HTML as an attachment. Do not embed private scene contents or endpoint credentials into that HTML template. A static bundled template with scene data requested at runtime reduces that specific persistence risk; it does not establish how all tool results or host state are retained.[S6]

## Local stdio is not a remote connector

Claude’s official guide explicitly supports local stdio Apps in Desktop. It separately states that app-provided tools, global entry points, and embedded websites require a remote-backed connector. The base inline App and those additional capabilities are different features.[S1]

Anthropic’s remote connector documentation says connections originate in **Anthropic’s cloud infrastructure even when the user runs Claude Desktop**. The endpoint must be public and reachable on standard HTTPS port 443. A loopback URL or a server available only on the user’s VPN does not satisfy that path. Local Desktop configuration is a separate mechanism. A tunnel changes the access/security boundary; it is not necessary merely to carry a bundled App UI over local stdio.[S12]

Codex likewise distinguishes a locally launched stdio process from URL-based MCP transport and executor location. A local configuration does not establish reachability from a hosted/cloud executor.[S4]

## Iframe, bridge and CSP objections

**Do not embed the existing Electron renderer unchanged.** The architecture grants it a narrow Electron preload and local assets under a constrained protocol. An Apps iframe has a different origin, sandbox, bridge, lifecycle and capabilities. Serving an HTML page does not transplant its Electron environment. A separate viewer can reuse suitable rendering code/assets while communicating only through supported bridge calls. This is an architectural inference from the project boundary and Apps sandbox, not an observed implementation.[S11][L1]

A self-contained `ui://` HTML view avoids external network dependencies. Bundle fonts and drawing assets, and request scene/image bytes via the MCP bridge. For external fetch/XHR/WebSocket endpoints, declare `connectDomains`; for external scripts, styles, images and fonts, declare `resourceDomains`. CSP permission and API CORS acceptance are independent. The SDK guide explicitly requires declaring localhost too, and says stable domain formats are host-specific.[S13]

T3’s generated policy defaults to `default-src 'none'` and `connect-src 'none'`, with inline script/style and bounded declared origins. It supports some declared network/frame origins, but that says nothing about another host permitting them.[S3]

**A nested `iframe src="http://localhost:…"` is not the portable solution.** Claude’s current embedded-sites documentation says local-server Apps cannot load embedded website origins. Even for remote custom connectors, embedded-site support is organization/conversation dependent; directory Community listings cannot use it, while Verified listings require approved origins. Accepted declarations are HTTPS origins, with IP addresses and private-network names refused. These are host policy restrictions beyond generic `frameDomains`. This restriction concerns a website nested inside the App, not the base bundled App HTML.[S14]

Even where an iframe or direct connection is allowed, localhost means the machine running that browser/webview. It does not identify the agent executor or drawing machine in a remote/linked environment. Loopback routing and any T3 proxy behavior remain the parent investigation’s responsibility.

## Keeping the mirror live

Core MCP resources define optional `resources.subscribe` support, `resources/subscribe`, and `notifications/resources/updated`. The update notification identifies the URI; it is not a scene payload. `notifications/resources/list_changed` means the available resource inventory changed, not that the current drawing changed.[S15]

Those server-to-client mechanisms do not automatically become iframe notifications. The reviewed Apps version provides initial tool input/result notifications and proxied reads/calls; host capability declarations must be checked. In particular, T3’s bridge supplies no resource subscription forwarding.[S2][S11]

The SDK’s official patterns recommend polling an app-only tool (`_meta.ui.visibility: ["app"]`) for real-time dashboards, with a two-second example and cleanup when unmounted. That is the smallest evidenced cross-host strategy here: expose a bounded read-only snapshot/revision operation, poll while visible, and refresh the mirror only on a changed revision. Start with full snapshots or bounded image captures, not a new unproven delta protocol. Measure payload size and latency, especially images.[S16]

Do not confuse Codex’s newer event-stream API with arbitrary local resource subscriptions: the inspected app-server code explicitly rejects subscriptions unless the server is the hosted-apps registration, with “MCP event subscriptions are only supported for hosted apps.” It does not establish push updates for Agent Excalidraw’s stdio server.[S17]

## Renderer authority and confidentiality

The architecture says the existing renderer is the single live scene authority; main owns persistence and its notifications are mirrors. Preserve that boundary.[L1]

- A view renders an immutable capture identified by document, epoch and revision. It must show that it is a mirror and handle closed/switched documents and disconnected sessions explicitly.
- Never let the embedded view hold a second independently editable Excalidraw scene and merge it back as if it were authoritative. If later adding controls, send commands through the existing validated path with document/epoch/expected revision/request ID; return the renderer’s accepted capture. This still does not provide arbitrary pointer-level editing, history synchronization or CRDT collaboration.
- Bind each view to an explicit document/epoch. Do not silently follow whichever private document becomes active when the user switches the desktop app.

These are design recommendations derived from the recorded authority rules; they have not been implemented or tested.

Local stdio avoids publishing an HTTP endpoint, but **local transport is not a confidentiality guarantee against the host or model provider**. The host receives HTML and UI data, can store artifacts and controls the bridge. Data included in model-facing tool results or explicit `ui/update-model-context`/messages can enter provider context. App-only tool visibility concerns model discovery/callability, not a complete no-retention or no-egress policy. Do not treat `structuredContent` or a hidden tool name as a universal secrecy mechanism; verify the exact host/provider route and retained records. The project architecture already warns that cloud agents can transmit content they read.[S6][S7][S11][L1]

Use a fixed bundled template, no external telemetry/fonts/CDNs, no scene data in URLs, no socket credentials in HTML or tool results, and narrowly scoped read-only view operations. The iframe sandbox protects the host from the UI; it does not sandbox the local stdio executable. If the parent chooses an HTTP path, MCP transport guidance separately calls for Origin validation against DNS rebinding, localhost binding, and authentication. Keep that a separate, explicit security design.[S18]

## Practical path and release gates

1. Retain the desktop app plus current CLI/MCP tools as the reliable baseline. Add the optional Apps resource only after negotiated support; text/image output remains useful otherwise.
2. Prototype one bundled read-only view against a synthetic scene. Use bridge-only app-visible read operations, document/epoch/revision binding and visibility-aware polling; no direct network access required.
3. Qualify **Claude Desktop local stdio** and **T3 with Codex** as separate host/version lanes. T3 with Claude is another lane gated by the capabilities named above. Do not spawn Claude for this research; a later authorized integration test must follow the project’s subscription-only rule.
4. Test unsaved human edits, agent edits, undo, document switch/close, large image assets, renderer/app restart, provider session stop, view unmount/remount and old conversation replay. Confirm stale cards cannot mutate or disclose a different document. Inspect network traffic and host persistence using synthetic data.
5. Advertise standalone Codex desktop/IDE or Claude Code inline UI only after finding an explicit renderer contract and observing that exact surface. The Codex app-server capability and T3’s renderer are not proof for those products.

No source/config/install changes were made. The report does not resolve the parent’s HTTP/proxy design and does not claim runtime verification.

## Sources

[S1]: https://claude.com/docs/connectors/building/mcp-apps/getting-started "Anthropic: Get started with MCP Apps (local examples; remote-only advanced capabilities)"
[S2]: https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/packages/client-runtime/src/mcpApps/host.ts "T3: MCP Apps host bridge"
[S3]: https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/web/src/components/chat/McpAppFrame.tsx "T3: frame rendering and approval; policy constants"
[S4]: https://learn.chatgpt.com/docs/extend/mcp?surface=cli "OpenAI: Model Context Protocol configuration"
[S5]: https://developers.openai.com/plugins/build/app-quickstart "OpenAI: MCP server and UI quickstart (UI scope is ChatGPT)"
[S6]: https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/server/src/mcpApps/McpAppSnapshot.ts "T3: UI resource capture and attachment persistence"
[S7]: https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L955-L967 "T3: Claude adapter capability gating and MCP Apps operations"
[S8]: https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L4321 "T3: Codex adapter UI capture and calls"
[S9]: https://github.com/openai/codex/blob/6eea32808167c4b87508e9611ba116f061ee315c/codex-rs/codex-mcp/src/client_capabilities.rs "Codex: projection of host-declared MCP Apps extension"
[S10]: https://code.claude.com/docs/en/mcp#use-mcp-resources "Anthropic: Claude Code MCP reference, including UI resource handling"
[S11]: https://github.com/modelcontextprotocol/ext-apps/blob/ea3e9d0e624a20bc1c51310292f09d9b8ed17161/specification/2026-01-26/apps.mdx "MCP Apps versioned 2026-01-26 specification"
[S12]: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp "Anthropic: Remote connector network requirements"
[S13]: https://github.com/modelcontextprotocol/ext-apps/blob/ea3e9d0e624a20bc1c51310292f09d9b8ed17161/docs/csp-cors.md "MCP Apps SDK: CSP and CORS guidance"
[S14]: https://claude.com/docs/connectors/building/mcp-apps/embedded-sites "Anthropic: Embedded website host restrictions"
[S15]: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/8a18b4b3292b9f9b3aee73f6325f9f62f19a89f9/docs/specification/2025-11-25/server/resources.mdx "Core MCP: resources subscriptions and list changes"
[S16]: https://github.com/modelcontextprotocol/ext-apps/blob/ea3e9d0e624a20bc1c51310292f09d9b8ed17161/docs/patterns.md "MCP Apps SDK: polling and app-only tools"
[S17]: https://github.com/openai/codex/blob/6eea32808167c4b87508e9611ba116f061ee315c/codex-rs/app-server/src/request_processors/mcp_event_stream.rs#L52-L62 "Codex: hosted-app-only event stream restriction"
[S18]: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/8a18b4b3292b9f9b3aee73f6325f9f62f19a89f9/docs/specification/2025-11-25/basic/transports.mdx "Core MCP: HTTP transport security"
[L1]: ../architecture.md "Project architecture reviewed locally"

Additional implementation evidence:

- [T3 MIME, limits and CSP generator](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/packages/shared/src/mcpApp.ts).
- [T3 server-side app visibility and same-server routing](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/server/src/mcpApps/McpAppRequests.ts).
- [Codex tests for app-server host capability forwarding](https://github.com/openai/codex/blob/6eea32808167c4b87508e9611ba116f061ee315c/codex-rs/app-server/tests/suite/v2/mcp_tool.rs#L310-L380).

The SDK repository also contains a newer draft specification. This report uses the versioned 2026-01-26 contract because T3 explicitly selects it; newer app-provided tools/WebMCP features must not be assumed available there. Repository commit pins identify source snapshots, not installed release versions.
