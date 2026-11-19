# Agent Excalidraw

A quiet local workspace for visual thinking, with your agent beside you.

**Under active development.** This repository contains the desktop app, full CLI and optional MCP adapter. The verification ledger records which behaviors and platforms have actually been tested. It is an independent project, built with Excalidraw.

- Ordinary `.excalidraw` files at visible locations on your computer.
- The official drawing editor, with a small library and native file actions.
- CLI first: create, inspect, edit, render and save without configuring MCP.
- Optional MCP exposes the same drawing commands.
- No account, in-app model or automatic cloud synchronization.

## Run from source

Requires Node.js 22 or newer and npm. The desktop editor bundles its own runtime after packaging.

```sh
git clone https://github.com/ralfboltshauser/agent-excalidraw.git
cd agent-excalidraw
npm ci
npm run dev
```

To use the built CLI:

```sh
node dist/cli/index.js --help
node dist/cli/index.js skills get core
```

Packaged release installation instructions will be published with verified release artifacts. Do not assume an npm package or signed download exists until the release is listed.

## Product and implementation

- [User flows and visual direction](docs/design/product-and-flows.md)
- [Milestone acceptance scripts](docs/design/milestones.md)
- [Architecture](docs/architecture.md)
- [Verification ledger](docs/design/verification-ledger.md)

## Privacy

Manual editing is designed to work offline with bundled editor assets. Drawings and recovery data stay on your machine. Agent content is handled by the agent provider you already use. Local storage does not make a cloud model local. Source drawings are not encrypted by this app.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run package
```

Original code is MIT licensed. Upstream software and fonts retain their own licenses; see the release license inventory. Report reproducible bugs using synthetic drawings rather than confidential content.
