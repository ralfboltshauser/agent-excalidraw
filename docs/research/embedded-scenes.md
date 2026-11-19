# Embedded scenes inside coding agents

Research date: 2026-11-19. This is a design investigation, not a shipped embedded editor. Host behavior is version-dependent. The existing desktop app remains unchanged.

## Recommendation

Build an **MCP App viewer backed by the existing local document authority** first. Include pan/zoom, full screen, explicit refresh, revision/saved status, selection/context handoff and Open in desktop. Keep CLI-only use fully functional. Add live refresh only after proving the actual host bridge and lifecycle. A local HTTP server is an optional adapter for browser/sidebar integrations; it is not required for a local stdio MCP App.

The first embedded viewer should not mount a second writable Excalidraw scene. The current renderer is the sole live authority, while main owns file persistence. Two writable editors with independent undo/history would introduce a new synchronization system. See [existing architecture](../architecture.md).

## Primary-source findings

T3 Code source was pinned to commit `031dd1a818c348353ff96dc42b81b6697701ecc7`.

1. **Self-contained interactive HTML already works here.** T3 visual replies run scripts in a sandbox, support full screen and local images, and persist the captured image bytes with the thread. This is enough for a revision-bound SVG/PNG viewer, local pan/zoom and UI-only interaction. It does not grant filesystem access or a generic tool bridge. [T3 user guide](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/docs/user/html-renders.md), [sandboxed frame](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/web/src/components/files/BrowserDocumentFrame.tsx#L429).
2. **A raw localhost iframe/fetch is not a portable shortcut.** The T3 preview browser sends loopback through its public-only proxy, which refuses private/reserved/host addresses and checks DNS results. This establishes a restriction on previewing such HTML, not proof that every final inline-frame network path is identical. A remote T3 environment also has a different localhost from the user's computer. Do not bypass these controls by publishing a confidential local server. [Browser launch](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/server/src/htmlRender/headlessChrome.ts#L185), [proxy address checks](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/server/src/htmlRender/publicProxy.ts#L74).
3. **T3 has a real MCP Apps bridge.** Its guide explicitly documents app rendering for configured Codex and Claude provider sessions, with a Claude Code minimum version of 2.1.301. The host supports server tool calls, resource reads, model-context updates, messages and full screen. This is T3's UI capability when using those agents; it does not establish the same UI in the standalone Codex or Claude Code terminal. [Guide](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/docs/user/html-renders.md#mcp-apps), [host implementation](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/web/src/components/chat/McpAppFrame.tsx#L277).
4. **T3 approves app writes.** App tool calls are checked against that app's server. Read-only calls can proceed; other calls request approval. Messages also request approval. Consequently, calling `apply` for every pointer movement or `onChange` is a poor UX. Do not mislabel writes as read-only to avoid approvals. App use also depends on the originating agent/provider being available; the guide says an app can remain visible after the agent stops, but using it requires that agent running. [Approval boundary](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/apps/web/src/components/chat/McpAppFrame.tsx#L283), [lifecycle guide](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/docs/user/html-renders.md#mcp-apps).
5. **MCP App networking is restrictive by default.** T3 constructs a default-deny CSP: inline scripts/styles, data/blob images and data fonts are available, while `connect-src` defaults to none. External domains require declared policy. Use bundled assets and the host's MCP bridge rather than a CDN or a secret-bearing loopback URL. [CSP implementation](https://github.com/pingdotgg/t3code/blob/031dd1a818c348353ff96dc42b81b6697701ecc7/packages/shared/src/mcpApp.ts#L168).
6. **The standard is host-mediated.** An MCP tool declares a `ui://` resource, the host renders the HTML in a sandboxed iframe, and the iframe talks to its host through the MCP Apps bridge. A compatible local host can proxy local stdio resources without an HTTP scene server. Capability negotiation is required; ordinary tools must continue to work without UI support. [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html).
7. **ChatGPT UI support must not be conflated with standalone Codex.** OpenAI's current quickstart describes tools for ChatGPT and Codex, with optional iframe UI in ChatGPT. Its documented ChatGPT development connection uses public HTTPS, which is a different privacy boundary from a local stdio server. [OpenAI quickstart](https://developers.openai.com/plugins/build/app-quickstart).
8. **Claude has interactive connector surfaces, but each client needs verification.** Official docs describe inline, side-panel and fullscreen connector UI in Claude/Cowork/Desktop, with rollout differences. That documentation alone does not prove a local custom server's UI in a standalone Claude Code terminal. [Claude documentation](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude).

The current Agent Excalidraw MCP adapter only registers ordinary tools. It has no UI resource handlers or MCP Apps metadata yet. Existing `render` writes an image artifact; because that writes a file, it should not simply be relabeled read-only. A new resource read should capture a live revision in memory and return viewer bytes without arbitrary output-path writes. [Current adapter](../../src/cli/mcp.ts).

## Three useful levels

| Level | Interaction | Persistence and freshness | Effort / limitation |
| --- | --- | --- | --- |
| Self-contained HTML snapshot | Pan, zoom, fit, local inspection | Captured revision; regenerate to refresh | Works with the existing inline HTML surface; not live editing |
| MCP App live viewer | Above, plus refresh, document state and context handoff | Reads the existing authority; explicit revision and saved status | Recommended first feature; bridge/agent lifecycle must be tested |
| Embedded editable Excalidraw | Full drawing tools, undo, agent co-editing | Needs an explicit authoritative editor session and host-compatible save contract | Separate architecture milestone; not a thin iframe wrapper |

## Proposed viewer contract

- `open_canvas`: an explicit tool returning a document-scoped viewer resource and initial revision.
- A revision-bound resource read returns SVG/PNG, bounds, scene revision, epoch and saved revision/state. Read-only data stays read-only. Never accept arbitrary host filesystem paths from an iframe.
- Pan/zoom remain local to the viewer. Optional selection can identify stable element IDs or a region; context handoff includes document/epoch/revision and only the selected information needed by the agent.
- An explicit Refresh action works first. Polling through `resources/read` while visible is a candidate enhancement. The inspected T3 host exposes resource reads; automatic subscription/server-push forwarding was not established, so do not promise it without a spike.
- Agent mutations continue through existing revision-checked commands. The viewer refreshes after acknowledged changes. Save is explicit and visibly separate from recovery and unsaved agent edits.
- Open in desktop uses a supported host link/tool route with user action; never assume a sandbox iframe can invoke shell commands or a custom protocol everywhere.

## If we add a local HTTP server

Use it for a normal browser/sidebar viewer or a host that explicitly permits that integration. It should adapt the same document authority, not read/write disk JSON independently while the editor is open.

Proposed boundaries: bind only loopback; validate Host and authorized origins; short-lived document-scoped capabilities; random document handles rather than file paths in URLs; no wildcard CORS; credentials outside URLs/logs; bounded requests; checked revisions/epochs and deduplicated operation IDs for writes; websocket origin/auth checks if streaming; no default LAN/public listener. An opaque sandbox origin cannot be trusted merely because it says `Origin: null`. Browser loopback access, CSP and private-network permission behavior require real tests in each host. These are proposed controls, not implemented claims.

A public tunnel changes who can reach confidential scene data and is not the default solution. A model/provider can still process whatever scene content the user asks the agent to read; local storage does not alter that boundary.

## Full editing: the hard problem

Mounting another official Excalidraw component is straightforward compared with preserving human edits, native history and one writer. Full editing should either transfer an exclusive editor lease to the embedded surface, or introduce a deliberately designed operation/synchronization model. An embedded draft that diverges while the desktop remains writable is not safe. A lease design must handle host approvals, host teardown, disconnected agents, delayed saves, crash recovery and stale agent batches before being accepted.

Recommended sequence:

1. **Completed research proof:** render the real README scene into self-contained HTML with pan/zoom controls. No server, network dependency, write bridge or document mutation. This establishes a rendering path, not live persistence or tested control input behavior.
2. Add MCP Apps resources to the existing stdio adapter; prove an actual T3 panel can read and refresh a synthetic drawing without external networking.
3. Prove manual desktop edit → panel refresh, CLI edit → panel refresh, epoch change and saved/dirty state. Verify provider-stop/restart behavior and read-only calls produce no write approvals.
4. Add explicit selection/context handoff and one approved mutation/save journey. Keep an ordinary tool/image fallback in incompatible hosts.
5. Only then decide whether embedded full editing is worth an editor-authority migration. Treat optional loopback HTTP as a separate integration adapter.

## Local proof and limits

The real visual README scene at revision 2 was captured through the installed app's SVG renderer. A self-contained 244,517-byte HTML page embeds those bytes and supplies pan/zoom/fit controls. `html_preview` rendered it at 728 px with no console output and no network dependency. The page clearly labels itself as a captured snapshot. No local scene server was started; no MCP configuration or app code was changed. No end-to-end UI write/refresh bridge is claimed.

Generated proof: `artifacts/research/embedded-scene.html` (ignored local artifact). The completed [host-compatibility review](embedded-host-compatibility.md) records the separate client/version evidence and privacy limits.


## Independent compatibility review update

The [host review](embedded-host-compatibility.md) confirmed a stronger local target: [Claude Desktop officially documents local stdio MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/getting-started#try-an-example-mcp-app-in-claude-desktop). This supports a bundled inline viewer without public hosting. Advanced Claude entry points, app-provided tools and nested embedded websites have separate remote-backed requirements; base inline UI support does not establish those features locally.

The T3 bridge source does not forward resource subscriptions into the iframe, so visibility-aware app-only polling or explicit Refresh is the first evidenced update strategy. Use a fixed UI template and fetch scene content at runtime: T3 stores captured HTML with the conversation, so embedding confidential drawing contents directly in that template would create another persisted copy. Runtime reads still pass through the host and must not be described as invisible to the host/provider. The prototype uses the intentionally public/synthetic README.

These findings strengthen the local MCP App recommendation, while leaving actual installed T3/Claude Desktop compatibility tests as the next implementation gate. Standalone coding-client rendering remains unverified.
