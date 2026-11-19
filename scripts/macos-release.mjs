#!/usr/bin/env node
// Local release gate: use a saved Keychain profile; never accept Apple passwords
// or API private keys as command-line arguments or include them in output.
import { spawnSync } from "node:child_process";
const profile = process.env.APPLE_KEYCHAIN_PROFILE;
if (process.platform !== "darwin")
  throw new Error("Build signed Mac releases on macOS.");
if (!profile)
  throw new Error(
    "Set APPLE_KEYCHAIN_PROFILE to an existing working notarytool Keychain profile. This release command requires successful notarization; npm run package remains available for local development.",
  );
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed. Release verification stopped.`);
}
run("xcrun", ["notarytool", "history", "--keychain-profile", profile]);
run("npm", ["run", "build"]);
run("npx", [
  "--no-install",
  "electron-builder",
  "--mac",
  "--arm64",
  "--x64",
  "--publish",
  "never",
]);
console.log(
  "Signing/notarization build finished. Verify each package signature, staple and native installation before generating the public manifest or publishing.",
);
