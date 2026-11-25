# Contributing

Agent Excalidraw is a local drawing workspace shared by a person and their coding agent. Keep the canvas central, files ordinary, and displayed success tied to an observed result.

## Development setup

Use Node.js 22.12 or newer and npm. Work from the lockfile:

```sh
npm ci
npm run dev
```

`dev` builds the real Electron app and opens it; it is not a browser mockup. Development uses the normal application-data location unless overridden. For an isolated test instance, set `AGENT_EXCALIDRAW_DATA_DIR` to a new absolute directory before launching. The same value must be supplied to its CLI. A custom app-data directory does not change where drawings are created: choose an explicit drawing path or change the default folder in Settings.

Build once with `npm run build`, then `npm start` to run that build. `npm run package` creates a native application directory for the current host. Packaging is separate from release signing/notarization.

## Where changes belong

| Area                                                 | Location                   |
| ---------------------------------------------------- | -------------------------- |
| Native lifecycle, document files and local transport | `src/main/`                |
| Desktop interface and live scene controller          | `src/renderer/`            |
| CLI, optional MCP and skill setup                    | `src/cli/`                 |
| Shared command definitions and protocol types        | `src/shared/`              |
| Version-matched skill entrypoint                     | `skills/agent-excalidraw/` |
| Real file, command and native journey checks         | `tests/`                   |

Read the [architecture](docs/architecture.md) before changing scene ownership or persistence. Excalidraw owns the live scene in the renderer. The file writer captures that scene; it does not overwrite it from a second mutable model. CLI and MCP share command contracts.

## Verify the result

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run package
```

Run the checks relevant to your change. Local `npm run test:e2e` exercises background drawing work without showing a window. CI runs the full suite, including foreground journeys. On a dedicated test desktop, use `AGENT_EXCALIDRAW_TEST_FOREGROUND=1 npm run test:e2e` to run the full suite locally. The native benchmark and offline audit also require that opt-in. Linux CI uses Xvfb and the official Chromium sandbox helper.

For UI changes, open the real app and complete the affected journey. Capture and inspect screenshots for hierarchy, alignment, spacing, contrast, focus, clipping and consistency. Include empty, populated and relevant error states. Use synthetic drawings; keep local tokens and private host paths out of public attachments.

For file changes, inspect the actual saved bytes and reopened scene. For agent changes, run the CLI without MCP, inspect a real render and verify its saved drawing. Test MCP parity where the contract changes. Treat stale/busy/unknown-outcome responses as part of the interface, not exceptions to skip.

The [milestone plan](docs/design/milestones.md) defines acceptance scripts. Record build SHA, real OS/architecture, fixture, evidence, result and remaining limits. Do not mark a platform passed because CI was configured, or user acceptance complete because nobody objected.

## Send a focused change

Explain the concrete problem, resulting behavior and how you verified it. Link the relevant flow or milestone when helpful. Include screenshots for interface changes and reproducible synthetic inputs for bugs. Keep dependency versions pinned and include any required license notices.

Use GitHub issues for reproducible bugs and scoped proposals. For sensitive security findings, follow [SECURITY.md](SECURITY.md). Do not attach real confidential drawings, endpoint credentials, entire application-data folders or unreviewed logs.
