# Installation, lifecycle and releases

## Current availability

This is a source/development preview. The first public desktop release targets **macOS**, with Apple silicon and Intel builds verified separately. No signed/notarized public app download or npm registry publication is claimed yet. The [macOS trust report](verification/macos-trust.md) separates locally verified signing from the still-open notarization and downloaded-app acceptance gate.

Windows x64 and Linux x64 remain experimental. Windows has completed an earlier native CI journey run; that does not verify every later commit, a signed installer or support for daily use. The latest native lanes and the [verification ledger](design/verification-ledger.md) are authoritative. A green source test or cross-compiled binary cannot substitute for running the actual package.

## Run the current source

Requires Node.js 22.12 or newer, npm and the native desktop runtime dependencies for your host:

```sh
git clone https://github.com/ralfboltshauser/agent-excalidraw.git
cd agent-excalidraw
npm ci
npm run dev
```

`npm ci` installs locked dependencies. The pinned Electron runtime is downloaded on first use (or explicitly with `node node_modules/electron/install.js`). `npm run dev` builds and starts the actual app. Use `npm run build` followed by `npm start` to start an already built checkout. Keep that checkout in place if you install a launcher pointing into it.

`npm run package` creates a native development application directory under `release/`. A locally created package is not the same as a signed public download. Development and CI packages are labeled accordingly.

## Packaged desktop app

When a verified macOS release is published, its GitHub release notes will name the exact supported OS versions, architecture, signed artifacts, checksums and known limits. Use that release's installation instructions. Do not treat a similarly named asset or a CI upload as a supported installer.

Mac packaging uses canonical ASCII filenames while the app remains **Agent Excalidraw**:

| Architecture  | DMG                                         | Automatic-install ZIP                       |
| ------------- | ------------------------------------------- | ------------------------------------------- |
| Apple silicon | `agent-excalidraw-VERSION-darwin-arm64.dmg` | `agent-excalidraw-VERSION-darwin-arm64.zip` |
| Intel         | `agent-excalidraw-VERSION-darwin-x64.dmg`   | `agent-excalidraw-VERSION-darwin-x64.zip`   |

Replace `VERSION` with the exact release version. These names are shared by packaging, GitHub assets, checksum records and the installer manifest. GitHub can normalize spaces and other unsafe characters in uploaded filenames; do not generate a manifest from a different local spelling.

Manual use of a packaged desktop app needs no Node.js, terminal, Docker, MCP configuration or account. Choose New drawing or Open drawing and save with the OS shortcut. File associations and signing/quarantine behavior must be tested for the release artifact itself.

### Local CLI launcher

Open **Agents → Install local launcher**. It invokes the app's bundled runtime and works without a separate Node installation.

| Host                             | Default launcher                                           |
| -------------------------------- | ---------------------------------------------------------- |
| macOS / Linux development target | `~/.local/bin/agent-excalidraw`                            |
| Windows development target       | `%LOCALAPPDATA%\agent-excalidraw\bin\agent-excalidraw.cmd` |

Use the full path immediately if the directory is not on PATH. Add that directory to your user PATH using your shell/OS settings and start a new terminal for command-name discovery. The app does not silently edit shell startup files. If you move the app or source checkout, reinstall the owned launcher from its new location.

From a built source checkout, `node dist/cli/index.js --help` is another working route. The normal Node CLI requires Node.js 22 or newer.

### Standalone CLI package

When a release actually provides a CLI `.tgz`, it can be installed with npm using its downloaded path:

```sh
npm install -g /absolute/path/to/agent-excalidraw-VERSION.tgz
```

Replace the filename with the exact provided artifact. This is not an instruction to assume an npm registry publication exists. A locally built package can be produced with `npm run build` and `npm pack` for development testing; it still needs a compatible desktop app.

`agent-excalidraw install` is an explicit network action. It requests a versioned GitHub release (the CLI's matching version by default), validates its manifest/download and checks macOS publisher/signing trust before installation. It refuses when the matching release or trusted artifact is unavailable. It does not rebuild the app on every drawing command.

## Skills and agent roots

```sh
agent-excalidraw skills install --dry-run --json
agent-excalidraw skills install --hosts codex,claude --json
agent-excalidraw skills get core
```

Omit `--hosts` to select `agents,codex,claude`. The default links are:

| Host selection | Default root       | Configuration override     |
| -------------- | ------------------ | -------------------------- |
| `agents`       | `~/.agents/skills` | `AGENTS_HOME/skills`       |
| `codex`        | `~/.codex/skills`  | `CODEX_HOME/skills`        |
| `claude`       | `~/.claude/skills` | `CLAUDE_CONFIG_DIR/skills` |

The canonical source is `<app-data>/skills/agent-excalidraw`; selected roots link to it rather than receiving independent copies. Unix uses symlinks; Windows uses directory junctions. Existing unrelated content causes a conflict instead of replacement. Installation is not proof of a successful agent call. Start a new host session when skill discovery requires it; real app use updates Last used.

### Isolated trial

```sh
agent-excalidraw skills install \
  --home /tmp/excalidraw-trial \
  --data-dir /tmp/excalidraw-trial/app-data \
  --hosts codex,claude --dry-run --json
```

`--home` overrides all inherited agent-root settings. `--data-dir` controls the canonical source and overrides `AGENT_EXCALIDRAW_DATA_DIR`; that environment variable is honored when no explicit data-dir is given. With `--home`, the otherwise-default app-data directory is derived from that home. Use both flags above for an unambiguous isolated trial.

The preview makes no directories or links. Remove `--dry-run` to install. Clean up with the same destinations:

```sh
agent-excalidraw skills uninstall \
  --home /tmp/excalidraw-trial \
  --data-dir /tmp/excalidraw-trial/app-data \
  --hosts codex,claude --remove-source --json
```

Only selected owned links are removed. Source removal refuses while a recorded link in another home still uses it. Recorded paths authorize inspection, never deletion of unselected files.

## Files and local app data

Drawings default to `~/Excalidraw` (`%USERPROFILE%\Excalidraw` on Windows). Project-context creation uses a project-named subfolder; explicit drawing paths win. Changing the default folder affects new files, not existing drawings.

| Host                       | Default app data                                                     |
| -------------------------- | -------------------------------------------------------------------- |
| macOS                      | `~/Library/Application Support/agent-excalidraw`                     |
| Windows development target | `%APPDATA%\agent-excalidraw`                                         |
| Linux development target   | `$XDG_CONFIG_HOME/agent-excalidraw`, or `~/.config/agent-excalidraw` |

Settings shows the actual directory. `AGENT_EXCALIDRAW_DATA_DIR` selects a different app instance/data directory; use the same value for its CLI. It does not change the default drawing folder automatically. Recovery snapshots and previews may contain confidential content. Keep endpoint tokens private.

## Updates and rollback

There is no background network update check. **Settings → Check for updates** is explicit and opens the release route when available. Source users update their checkout, install the new lockfile and rebuild.

Save and quit normally before replacing an app. Automatic installation checks for a running app before download and again at the replacement/execution boundary. These checks reduce races; they are not an OS-wide installer lock. The installer does not deliberately terminate a running editor to update it.

The macOS CLI installer stages a verified app, retains the previous app at `~/Applications/.Agent Excalidraw.previous.app`, and restores it if final publication fails. If restoration itself fails, it reports the preserved backup and target paths; restore the previous app there before launching. A rollback of app binaries does not roll back drawings or app-data formats. Back up drawings before testing development versions.

A manually installed app uses that release's rollback instructions. Do not infer an automatic rollback guarantee from a manual copy or from an unsigned CI package.

## Disconnect and uninstall

1. Save or explicitly discard the active drawing. Review any recovery snapshots you want to keep.
2. In Agents, use **Disconnect integrations** to remove the owned launcher and default skill links. Alternatively, preview and run `skills uninstall` with the same roots used for setup. Remove optional MCP registration separately through its host.
3. Quit the app normally, then remove it using the operating system. For a local npm CLI package, uninstall that package with npm if desired.
4. Drawings remain where you saved them. Removing a recent/library reference is also separate from deleting a drawing.

App-data cleanup is optional and explicit. Settings shows its path and can clear agent previews. Removing the full directory after quitting also removes settings, library metadata, reusable shapes, recovery snapshots and the canonical skill source. Disconnect every linked skill source first; keep any unsaved recovery you need. Removing a configured folder from the library never deletes that folder's source drawings.

## Maintainer release gate

The current native workflow builds and tests source and packaged application directories. It does **not** publish releases or establish notarization. Before a public release:

- Pin the commit/version and finish the release's accepted milestone criteria. Inspect native screenshots and the real drawing/export artifacts.
- Verify macOS arm64 and x64 builds on actual matching hosts. Record signing, notarization, quarantine, file associations and clean-account installation/update/uninstall evidence.
- Check the complete software/font inventory, packaged notices and synthetic-only examples. Keep endpoint files, credentials and private diagrams out of artifacts.
- Create the signed/notarized macOS DMG/ZIP artifacts and a matching CLI tarball. Verify the automatic ZIP install path; do not repurpose unsigned CI output.
- Generate the manifest from the exact signed ZIP assets. For version 0.1.0:

  ```sh
  node scripts/release-manifest.mjs --version 0.1.0 \
    --asset darwin arm64 release/agent-excalidraw-0.1.0-darwin-arm64.zip \
    --asset darwin x64 release/agent-excalidraw-0.1.0-darwin-x64.zip
  ```

  The script rejects unsafe basenames rather than guessing GitHub normalization. It calculates SHA-256; it does not sign or notarize anything. See `node scripts/release-manifest.mjs --help` for additional targets.

- Publish versioned assets/notes only after verification. Compare the actual GitHub asset names against the manifest and checksum filename records; all must match exactly. If an upload name changed, rename the asset to its canonical name and regenerate filename records from the same verified bytes. The automatic installer reads tag `vVERSION` and `agent-excalidraw-manifest.json`; checksums must match the uploaded files.
- Re-run the public instructions in a clean consumer environment. Record what passed, what was not run and known limits in the ledger.

Windows/Linux distribution and signing are future release work, even when an experimental native CI lane succeeds.
