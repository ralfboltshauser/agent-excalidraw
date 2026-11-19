#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const usage = `Generate the checksum manifest consumed by agent-excalidraw install.

Usage:
  node scripts/release-manifest.mjs [--version VERSION] [--output PATH]
    --asset PLATFORM ARCH FILE [--asset PLATFORM ARCH FILE ...]

Examples:
  node scripts/release-manifest.mjs --version 0.1.0 \\
    --asset darwin arm64 release/agent-excalidraw-0.1.0-darwin-arm64.zip \\
    --asset darwin x64 release/agent-excalidraw-0.1.0-darwin-x64.zip \\
    --asset win32 x64 release/agent-excalidraw-0.1.0-win32-x64.exe \\
    --asset linux x64 release/agent-excalidraw-0.1.0-linux-x64.AppImage

Defaults: version from package.json; output release/agent-excalidraw-manifest.json.
Automatic install supports darwin .zip, win32 .exe, linux .AppImage.
DMG and deb artifacts remain useful manual downloads, but are not install assets.
Asset basenames must use ASCII letters/digits/dots/underscores/hyphens and start
with a letter or digit. Spaces, leading dots and other characters are rejected:
GitHub may normalize those names, breaking exact manifest/checksum matching.
This script verifies input files and calculates checksums. It does not sign,
notarize, publish, or establish trust in those files. Generate public manifests
only after the separate signing and release-verification gates pass.
`;

async function main(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return;
  }
  let version;
  let output = path.resolve("release/agent-excalidraw-manifest.json");
  const inputs = [];
  const next = (index, option) => {
    const value = args[index];
    if (!value || value.startsWith("--"))
      throw new Error(`${option} requires a value. See --help.`);
    return value;
  };
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === "--version") version = next(++i, option).replace(/^v/, "");
    else if (option === "--output") output = path.resolve(next(++i, option));
    else if (option === "--asset") {
      const platform = next(++i, option),
        arch = next(++i, option),
        file = next(++i, option);
      inputs.push({ platform, arch, file: path.resolve(file) });
    } else throw new Error(`Unknown option ${option}. See --help.`);
  }
  if (!version)
    version = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ).version;
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)
  )
    throw new Error(
      "Version must be an explicit semantic release version, for example 0.1.0.",
    );
  if (!inputs.length)
    throw new Error(
      "Add at least one --asset PLATFORM ARCH FILE. No manifest was generated.",
    );
  const formats = { darwin: ".zip", win32: ".exe", linux: ".AppImage" };
  const identities = new Set(),
    names = new Set();
  const assets = [];
  for (const input of inputs) {
    if (
      !Object.hasOwn(formats, input.platform) ||
      !["arm64", "x64"].includes(input.arch)
    )
      throw new Error(`Unsupported target ${input.platform}/${input.arch}.`);
    const identity = `${input.platform}/${input.arch}`;
    if (identities.has(identity))
      throw new Error(
        `Duplicate install target ${identity}; the installer requires one unambiguous asset.`,
      );
    const name = path.basename(input.file);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
      throw new Error(
        `Unsafe release asset name ${JSON.stringify(name)}. Use ASCII letters, digits, dots, underscores and hyphens, starting with a letter or digit. GitHub may rename unsafe assets; manifest names must match uploaded names exactly.`,
      );
    if (!name.endsWith(formats[input.platform]))
      throw new Error(
        `${identity} requires a ${formats[input.platform]} asset, received ${name}.`,
      );
    if (names.has(name))
      throw new Error(
        `Duplicate release asset name ${name}; GitHub release asset names must be unique.`,
      );
    if (
      (process.platform === "win32" ? input.file.toLowerCase() : input.file) ===
      (process.platform === "win32" ? output.toLowerCase() : output)
    )
      throw new Error(
        "Manifest output cannot replace an input installer asset.",
      );
    const metadata = await stat(input.file);
    if (!metadata.isFile() || metadata.size === 0)
      throw new Error(`Asset is not a nonempty regular file: ${input.file}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(input.file)) hash.update(chunk);
    assets.push({
      platform: input.platform,
      arch: input.arch,
      name,
      sha256: hash.digest("hex"),
    });
    identities.add(identity);
    names.add(name);
  }
  assets.sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) || a.arch.localeCompare(b.arch),
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ version, assets }, null, 2) + "\n");
  console.log(
    `Wrote ${output} with ${assets.length} checksummed install asset${assets.length === 1 ? "" : "s"}. Signing and release acceptance remain separate checks.`,
  );
}
main(process.argv.slice(2)).catch((error) => {
  console.error(`Manifest error: ${error.message}`);
  process.exitCode = 1;
});
