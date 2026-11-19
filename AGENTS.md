# Working on Agent Excalidraw

Before each milestone, read its acceptance script in [docs/design/milestones.md](docs/design/milestones.md), the latest [implementation log](docs/implementation-log.md), and the [verification ledger](docs/design/verification-ledger.md). Revise assumptions from observed evidence before implementing.

For each usable increment:

1. Build and run the actual app through the affected user journey. Exercise real files, CLI/MCP and native behavior as relevant.
2. For UI changes, capture and inspect every affected screen: hierarchy, alignment, spacing, focus, error states and consistency. Fix findings and repeat the affected journey.
3. Ask an independent agent to try installation or the documented agent workflow at the integration gates. Give it consumer instructions, not an implementation walkthrough.
4. Run the appropriate checks from package.json. Record build, actual OS/architecture, synthetic fixture and resulting files/receipts/screenshots. A configured runner or a mocked editor is not native evidence.
5. Commit and push the verified increment. Update the ledger and future milestones with changed assumptions before moving on. Keep failures and unrun lanes visible.

Read [docs/architecture.md](docs/architecture.md) before changing document ownership, file persistence, IPC, history or retries. The renderer owns live scene admission; the native host owns persistence. Drawing commands target explicit document identities and epochs. User work and source files survive refused operations.

Use synthetic fixtures for tests and public artifacts. Keep runtime endpoint credentials, private drawings and local recovery data out of Git and CI uploads.
