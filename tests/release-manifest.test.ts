import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  lstat,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile),
  script = resolve("scripts/release-manifest.mjs");
async function temporary() {
  return mkdtemp(join(tmpdir(), "ae-release-manifest-"));
}
async function rejected(args: string[], pattern: RegExp) {
  try {
    await execute(process.execPath, [script, ...args]);
    assert.fail("invalid manifest inputs must fail");
  } catch (error: any) {
    assert.equal(error.code, 1);
    assert.match(error.stderr, pattern);
  }
}

test("safe release names preserve exact basenames and SHA-256 of the actual input bytes", async () => {
  const dir = await temporary();
  try {
    const names = [
      "agent-excalidraw-0.1.0-darwin-arm64.zip",
      "agent-excalidraw-0.1.0-darwin-x64.zip",
    ];
    const bodies = [
      Buffer.from([0, 255, 1, 2, 3]),
      Buffer.from("synthetic Intel archive bytes"),
    ];
    for (let i = 0; i < names.length; i++)
      await writeFile(join(dir, names[i]), bodies[i]);
    const output = join(dir, "out", "agent-excalidraw-manifest.json");
    await execute(process.execPath, [
      script,
      "--version",
      "0.1.0",
      "--output",
      output,
      "--asset",
      "darwin",
      "arm64",
      join(dir, names[0]),
      "--asset",
      "darwin",
      "x64",
      join(dir, names[1]),
    ]);
    const manifest = JSON.parse(await readFile(output, "utf8"));
    assert.equal(manifest.version, "0.1.0");
    assert.deepEqual(
      manifest.assets.map((asset: any) => asset.name),
      names,
    );
    for (let i = 0; i < names.length; i++)
      assert.equal(
        manifest.assets[i].sha256,
        createHash("sha256").update(bodies[i]).digest("hex"),
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("unsafe or leading-dot asset names are refused before any output directory is created", async () => {
  const dir = await temporary();
  try {
    for (const [i, name] of [
      "Agent Excalidraw-0.1.0.zip",
      ".agent-excalidraw-0.1.0.zip",
      "agent-excalidraw-(arm64).zip",
      "agent-excalidraw-é.zip",
      "-agent-excalidraw.zip",
    ].entries()) {
      const asset = join(dir, name),
        output = join(dir, "out-" + i, "manifest.json");
      await writeFile(asset, "original bytes");
      await rejected(
        [
          "--version",
          "0.1.0",
          "--output",
          output,
          "--asset",
          "darwin",
          "arm64",
          asset,
        ],
        /Unsafe release asset name/,
      );
      await assert.rejects(lstat(join(dir, "out-" + i)), { code: "ENOENT" });
      assert.equal(await readFile(asset, "utf8"), "original bytes");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a GitHub normalization collision is refused rather than producing mismatched names or changing an existing output", async () => {
  const dir = await temporary();
  try {
    const safe = join(dir, "Agent.Excalidraw.zip"),
      unsafe = join(dir, "Agent Excalidraw.zip"),
      output = join(dir, "manifest.json");
    await writeFile(safe, "safe bytes");
    await writeFile(unsafe, "space-name bytes");
    await writeFile(output, "existing manifest must survive");
    await rejected(
      [
        "--version",
        "0.1.0",
        "--output",
        output,
        "--asset",
        "darwin",
        "arm64",
        safe,
        "--asset",
        "darwin",
        "x64",
        unsafe,
      ],
      /Unsafe release asset name/,
    );
    assert.equal(
      await readFile(output, "utf8"),
      "existing manifest must survive",
    );
    assert.equal(await readFile(safe, "utf8"), "safe bytes");
    assert.equal(await readFile(unsafe, "utf8"), "space-name bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("duplicate safe release basenames and output/input collisions preserve existing files", async () => {
  const dir = await temporary();
  try {
    const first = join(dir, "one", "agent-excalidraw-0.1.0.zip"),
      second = join(dir, "two", "agent-excalidraw-0.1.0.zip"),
      output = join(dir, "manifest.json");
    await mkdir(join(dir, "one"));
    await mkdir(join(dir, "two"));
    await writeFile(first, "first bytes");
    await writeFile(second, "second bytes");
    await writeFile(output, "existing manifest");
    await rejected(
      [
        "--version",
        "0.1.0",
        "--output",
        output,
        "--asset",
        "darwin",
        "arm64",
        first,
        "--asset",
        "darwin",
        "x64",
        second,
      ],
      /Duplicate release asset name/,
    );
    assert.equal(await readFile(output, "utf8"), "existing manifest");
    await rejected(
      [
        "--version",
        "0.1.0",
        "--output",
        first,
        "--asset",
        "darwin",
        "arm64",
        first,
      ],
      /Manifest output cannot replace an input installer asset/,
    );
    assert.equal(await readFile(first, "utf8"), "first bytes");
    assert.equal(await readFile(second, "utf8"), "second bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Mac packaging config emits canonical architecture-specific names without changing the app display name", async () => {
  const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  assert.equal(pkg.build.productName, "Agent Excalidraw");
  assert.equal(
    pkg.build.mac.artifactName,
    "agent-excalidraw-${version}-darwin-${arch}.${ext}",
  );
});
