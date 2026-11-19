# macOS distribution trust

The current release target is macOS; Windows publisher signing is deferred. The Electron shell, transport adapters and native CI retain future Windows/Linux support.

## Local investigation, 2026-11-19

- A valid Developer ID Application signing identity exists in the local Keychain. A previous packaged build signed successfully and passed `codesign --verify --deep --strict`.
- No usable saved notarization profile was found in the standard notarytool Keychain configuration. No configured App Store Connect private key was found in the standard local locations checked.
- Xcode's existing Apple account could not retrieve developer teams.
- A small, hardened-runtime, Developer-ID-signed synthetic archive was submitted through `xcodebuild -exportArchive` with `method=developer-id` and `destination=upload`. This tested whether the existing Xcode account could notarize without a separate profile. Export failed because that account could not log in.
- No Apple password, API private key or token was requested in chat, printed, committed, or fabricated. No developer account settings were changed.

Signing and notarization are separate. A valid signature alone does not establish Gatekeeper acceptance for a downloaded app. This is an outstanding public distribution gate, not a drawing-engine failure or a reason to bypass Gatekeeper.

## Release procedure

With an existing working Keychain profile available locally:

```sh
APPLE_KEYCHAIN_PROFILE='your-existing-profile-name' node scripts/macos-release.mjs
```

The script verifies access before building both Mac architectures and requires the notarizing build path. Secrets stay in Keychain. Do not generate or publish an install manifest from an unverified package.

For each final artifact, inspect the signature and expected TeamIdentifier, validate stapling, assess Gatekeeper, and perform the native install/reopen workflow on its actual architecture. These checks must reference the final build/commit. A development build or an older signed package does not pass the final artifact gate.

Useful Apple references: [notarization workflow](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [notarytool and Keychain profiles](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool).

## Download-trust assessment

The signed synthetic-content desktop package at source commit `ca19157` passed deep/strict signature verification. An actual `spctl --assess --type execute` check rejected it with `source=Unnotarized Developer ID`. This confirms that local signing is working and that it is not yet a trusted downloaded-app release. No Gatekeeper bypass is part of the installer.

The final application source `0d16d07`, ASAR SHA-256 `b1123fe97a46c86a981bf6900b8ece9c6545ac717a6f4d38eea485844d94dbc0`, was signed for both Apple Silicon and Intel. Each original app, ZIP-extracted app and read-only DMG-mounted app passed deep/strict signature verification with the expected TeamIdentifier. The actual installed final Apple Silicon app was assessed again and rejected as `Unnotarized Developer ID`.

Both architectures' DMG/ZIP assets, the dependency-bundled CLI archive and SHA256SUMS are staged in the owner-only GitHub draft. Every uploaded asset name, byte count and GitHub SHA-256 digest matches the local final artifact. A temporary verification manifest matches the canonical ZIP names and hashes; it is deliberately not published as a usable installer manifest. The release stays draft while notarization and the remaining clean-download/install checks are open.
