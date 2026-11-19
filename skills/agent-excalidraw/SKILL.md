---
name: agent-excalidraw
description: Create, open, inspect and refine local Excalidraw drawings with the Agent Excalidraw desktop app. Use for agent-assisted diagrams or edits to an existing .excalidraw drawing.
---

Run `agent-excalidraw skills get core` and follow the installed version's guide before editing. This keeps the workflow matched to the available commands.

If the command is missing, install the CLI from the project's documented release: https://github.com/ralfboltshauser/agent-excalidraw. If only the desktop app is missing, run `agent-excalidraw install`. Installation may need internet; normal drawing does not. Report missing or unpublished artifacts rather than substituting a remote drawing service.

An explicit drawing path wins. A request only to launch opens the workspace without creating a file. For new work, give the CLI the purpose and project directory so it can allocate a sensible local path. Inspect and edit through the CLI; MCP is optional.

Preserve live human edits using the returned document, epoch and revision. View an actual render before claiming visual review, then save the authorized work and report its actual file path. Local storage does not make the user's cloud agent local: drawing content read by the agent is handled by that agent's provider.
