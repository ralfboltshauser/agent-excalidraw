# Security and privacy

Agent Excalidraw is preview software. The current development branch is the maintained version; no stable public release or long-term security-support policy is announced yet. macOS is the first release target. Windows/Linux development tests do not establish a supported release.

## Report a vulnerability

Use GitHub's private vulnerability-reporting option on this repository when available. If it is unavailable, open a public issue asking for a private reporting route, without exploit details, private drawing content or credentials. Do not post a confidential sample to demonstrate a bug; reproduce it with synthetic content.

Helpful reports identify the exact app/CLI version or commit, OS/architecture, trigger, observed effect and a minimal synthetic reproduction. Please allow a private fix discussion before publishing sensitive details.

## What stays local

The desktop editor works with ordinary `.excalidraw` files. Its settings, library index, recovery snapshots, reusable shape library and temporary previews use local application-data storage. Recovery and previews can contain the same sensitive material as the source drawing.

Normal manual editing has no account, model provider, telemetry, collaboration server or automatic cloud synchronization. Editor assets/fonts are bundled; remote embeds are not executed. Installation, explicit update checks and links you deliberately open are separate network actions. Filesystem backup/sync tools configured outside this app may still copy files.

The app does not encrypt source drawings or its recovery/cache data. OS account permissions and disk protection remain separate responsibilities. Clearing a library reference does not delete the source file; deleting recovery data can remove the only copy of unsaved work.

## Agent boundary

The CLI and optional MCP server talk to the local desktop through a user-local transport and credential. A local socket does not make a cloud model local: content returned to your coding agent is handled by its provider. Choose a local agent/model if your data requires it.

The app coordinates its own clients and rejects stale document mutations. It cannot restrict an agent's independent shell/filesystem permissions or stop unrelated software from reading a file. Session Stop pauses this app's mutations; it does not terminate another program's reasoning.

Endpoint descriptors contain local capability tokens. **Never upload `endpoint.json`, whole app-data directories or unreviewed diagnostic bundles.** Review screenshots, previews and logs before sharing them. This applies to synthetic test runs too.

## Imports, exports and release trust

Unsupported future element types are rejected before editing to avoid destructive compatibility loss. Imported embeds remain data/placeholders rather than runnable remote content. PNG/SVG export includes original editable scene data only when explicitly selected; such an export can expose more than its visible pixels.

A checksummed download is not, on its own, publisher authentication. The macOS automatic installer additionally requires a valid code signature from Team ID `76625SQ67N` and a successful Gatekeeper assessment. Do not bypass these checks to install an untrusted artifact. These checks are implemented requirements, not a claim that a notarized public release exists.

Development builds and CI package directories are not signed-public-release evidence. Read the [macOS trust report](docs/verification/macos-trust.md), [release guide](docs/releases.md) and [verification ledger](docs/design/verification-ledger.md) before relying on a download or platform-support claim.
