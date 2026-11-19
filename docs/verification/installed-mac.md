# Installed Mac verification

2026-11-19. Signed local application, source/application candidate `c2f39cc`; ASAR SHA-256 `9a4265076549183af064b7a589b12169de64facc91d5b9c7d13c5b56096c2efa`.

## Installation and manual workflow

Installed the actual signed bundle into `~/Applications/Agent Excalidraw.app` and verified its deep/strict signature after copying. Registered its drawing association through Launch Services. No quarantine attributes or security protections were removed.

Through native computer use: opened the installed app, inspected Welcome, installed the bundled local launcher and skill, created a drawing at the default root, drew a rectangle and bound text, saved with the native shortcut, renamed it, used Undo/Redo, revealed its exact file in Finder, quit normally and reopened that file through Finder's normal Open action. The drawing and saved status returned correctly; Library shows its real path. The license action opened the physical bundled notices in TextEdit. Relevant screens were visually inspected.

The host uses Swiss German keyboard layout. The computer-use tool's physical US key mapping required the corresponding physical Y key for the labeled Z shortcut; correct native Undo/Redo were verified. This is recorded to distinguish test-input mapping from app behavior.

The tool runtime inherited `ELECTRON_RUN_AS_NODE=1`, which initially caused an Electron launch through the tool to exit in Node mode. Launching through the OS without that inherited variable worked, and the subsequent normal Finder file-open worked. The app's own CLI launch path already removes this variable. This was not solved by bypassing Gatekeeper.

## Global integration

The GUI installed the launcher at `~/.local/bin/agent-excalidraw`, pointing into the installed app's bundled runtime and ASAR. `--version` and an authenticated `status --no-launch --json` call succeed.

One canonical source is stored at `~/Library/Application Support/agent-excalidraw/skills/agent-excalidraw`. The `~/.agents/skills`, `~/.codex/skills`, and `~/.claude/skills` entries are symlinks to it. Real unrelated integrations were preserved.

The installed Codex client's actual app-server `initialize` and `skills/list` with `forceReload:true` found exactly **one** enabled `agent-excalidraw` skill at user scope, resolving to the canonical source. No model turn or Claude Code process was launched. Claude discovery is a filesystem-link check, not a claim that a Claude session was exercised.

## Actual installed MCP workflow

A real MCP SDK client launched the installed global command with `mcp`, enumerated all 21 tools, inspected the manually created document, changed only its rectangle style, rendered a PNG and saved. The original element IDs and manually entered label remain present on disk. The response included an actual image content block; the PNG signature and saved bytes were checked, and the image was viewed. The client closed without quitting the user's app.

No MCP host configuration was added. CLI-only use and the optional exposed MCP server remain independent routes.

## Trust limit

This is a working signed **local build**, not a notarized public download. The explicit Gatekeeper assessment rejects it as Unnotarized Developer ID. Existing Apple account authentication still blocks notarization; the public release/install gate remains open. See [Mac distribution trust](macos-trust.md).

## Final candidate replacement and inspection

The installed preview was replaced with source payload `0d16d07`, ASAR SHA-256 `b1123fe97a46c86a981bf6900b8ece9c6545ac717a6f4d38eea485844d94dbc0`. The staged and final installed bundles both passed deep/strict signature verification. The previous app bundle was retained for rollback.

The earlier preview had entered a partial unload state: main still listed the saved drawing, while renderer commands returned `NO_DOCUMENT`. Its normal quit and termination handler did not complete. Before terminating only that known preview process, verification established its exact executable, the synthetic active drawing, clean save state, zero recovery entries and unchanged saved bytes. This is a developer replacement after a diagnosed lifecycle failure, **not** proof of the public installer's normal update path. The new controller removes display-frame waits from identity and viewport transitions; see the implementation log and bounded native regression results.

After replacement, the actual global launcher reopened the same file, and the complete saved file remained byte-for-byte identical (SHA-256 `cd653f852a8810608776f9f65dd825969a2b3bc52ec07c06469efa7fa98d926d`). All three skill entries still resolved to the single canonical source. An explicit versioned install request correctly returned structured `RELEASE_NOT_AVAILABLE` because the release is a private draft; it did not replace the app. The updated installed app acknowledged normal CLI quit immediately and reopened normally afterward.

Native computer-use inspection timed out after the replacement. As a fallback, the real Electron driver launched the actual installed bundle with the existing synthetic profile, opened the drawing, captured editor and Agents screenshots, and checked its file bytes again. The screenshots were viewed: title, Saved state, drawing, hierarchy and spacing were intact; Agents showed the launcher and three linked hosts. This final screenshot pass used an automation-attached process, not native pointer input. The driver exited, then the normal global launcher reopened the saved drawing for use. Earlier native manual/Finder evidence remains identified separately above.
