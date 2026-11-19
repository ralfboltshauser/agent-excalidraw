# Embedded canvas

Agent Excalidraw 0.2 adds an optional read-only canvas inside a compatible coding-agent conversation. The desktop editor remains the live drawing authority. Human edits, agent edits and explicit local saves keep using the same file.

## Connect

Use the same local stdio command in any compatible host:

```json
{
  "command": "/absolute/path/to/agent-excalidraw",
  "args": ["mcp"]
}
```

The desktop app's Agents screen shows the actual launcher path. A packaged launcher uses the app's bundled runtime, so a separate Node installation is unnecessary. Host configuration syntax and reload behavior vary; use the host's normal MCP setup. Skill installation and MCP registration are separate.

After connecting, ask your agent to open a particular drawing and show its canvas. The agent obtains its document ID/epoch, then calls `show_canvas`. That explicit identity binds the card to one open drawing session.

## Use

- Pan, zoom and Fit inspect the preview; they leave the desktop viewport untouched.
- Refresh reads a fresh preview. Pause keeps the last frame; Refresh while paused performs one read without resuming automatic updates.
- Saved/Unsaved follows the actual document state. Recovery remains separate from saving.
- Draw manually in the desktop app or ask the agent to edit through the existing commands. The card follows stable edits with a short polling delay.
- Switching, closing or reopening a drawing makes an old card stale. Ask the agent to show the intended drawing again; a card never follows a different active document.
- Fullscreen appears only when the host advertises that capability and may require a direct click.

This is a bounded PNG preview, not another editable Excalidraw instance. Full manual editing, region-to-agent messages and embedded export controls are not part of the first viewer increment. The ordinary CLI and optional MCP drawing tools remain independent of the UI.

## Privacy and lifecycle

The bundled HTML contains no drawing data, file paths or endpoint credentials. Preview reads use the local MCP bridge and private app transport, with no browser-facing server or external assets. Reads do not save/export files or create history entries. Preview image buffers and bindings have explicit size and expiry limits.

The host receives displayed pixels and can retain conversation artifacts. App-only tools and hidden metadata are not a privacy guarantee against that host or its provider. The viewer sends no automatic chat messages or model-context updates. Existing explicit agent reads are handled by that agent's provider.

A stopped provider or disconnected adapter can interrupt reads. The last frame is labelled stale; expired cards need a new explicit show request. After an adapter restart, an old binding cannot be reconstructed from the conversation. Already delivered pixels cannot be recalled from host history.

## Compatibility and evidence

Host support must be qualified by exact surface/version. T3's Codex and Claude providers are distinct test lanes, while standalone Codex or Claude Code terminal rendering is not implied. Claude Desktop documents local stdio Apps, but documentation alone is not an installed-host pass.

See the [embedded verification report](verification/embedded-canvas.md) for current observed lanes and limitations, and the [implementation plan](design/embedded-canvas-plan.md) for remaining gates. Mac public download trust remains subject to the separate notarization gate.
