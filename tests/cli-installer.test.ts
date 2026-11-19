import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  cp,
  rename,
  stat,
} from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  installApp,
  type InstallerDependencies,
} from "../src/cli/installer.js";
import { VERSION } from "../src/cli/transport.js";
import { AppError } from "../src/shared/types.js";

async function fixture(
  options: {
    platform?: NodeJS.Platform;
    team?: string;
    checksum?: string;
    runningAtFinalCheck?: boolean;
    renameFault?: "publication" | "rollback";
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "ae-installer-")),
    home = join(root, "home"),
    temporary = join(root, "temporary");
  await mkdir(home);
  await mkdir(temporary);
  const platform = options.platform || "darwin",
    name =
      platform === "darwin"
        ? "Agent Excalidraw-0.1.0-arm64-mac.zip"
        : platform === "win32"
          ? "Agent Excalidraw Setup 0.1.0.exe"
          : "Agent Excalidraw-0.1.0.AppImage";
  const bytes = Buffer.from("synthetic release bytes — not an executable"),
    checksum =
      options.checksum || createHash("sha256").update(bytes).digest("hex");
  const base =
    "https://github.com/ralfboltshauser/agent-excalidraw/releases/download/v0.1.0/";
  const target =
    platform === "darwin"
      ? join(home, "Applications", "Agent Excalidraw.app")
      : platform === "linux"
        ? join(
            home,
            ".local",
            "share",
            "agent-excalidraw",
            "Agent Excalidraw.AppImage",
          )
        : join(home, "old-windows-install.txt");
  if (platform === "darwin") {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "binary"), "old app");
  } else {
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "old app");
  }
  const commands: { file: string; args: string[] }[] = [];
  let checks = 0;
  const deps: InstallerDependencies = {
    home,
    tempRoot: temporary,
    platform,
    arch: "arm64",
    fetch: async (url: any) => {
      if (String(url).startsWith("https://api.github.com/"))
        return new Response(
          JSON.stringify({
            assets: [
              {
                name: "agent-excalidraw-manifest.json",
                browser_download_url: base + "manifest",
              },
              { name, browser_download_url: base + "app" },
            ],
          }),
        );
      if (String(url) === base + "manifest")
        return new Response(
          JSON.stringify({
            version: VERSION,
            assets: [{ platform, arch: "arm64", name, sha256: checksum }],
          }),
        );
      if (String(url) === base + "app") return new Response(bytes);
      throw new Error("Unexpected network request");
    },
    exec: async (file, args) => {
      commands.push({ file, args });
      // Extraction and process/signature checks are external seams. Actual app
      // staging, replacement, failure and rollback use the real temp filesystem.
      if (file === "/usr/bin/ditto") {
        if (args[0] === "-x") {
          const extracted = join(args[3], "Agent Excalidraw.app");
          await mkdir(extracted, { recursive: true });
          await writeFile(join(extracted, "binary"), "new app");
        } else await cp(args[0], args[1], { recursive: true });
      }
      if (file === "/usr/bin/codesign" && args[0] === "--display")
        return {
          stdout: "",
          stderr: `Executable=synthetic\nTeamIdentifier=${options.team || "76625SQ67N"}\n`,
        };
      return { stdout: file === "powershell.exe" ? "Valid\n" : "", stderr: "" };
    },
    assertAppStopped: async () => {
      checks++;
      if (options.runningAtFinalCheck && checks === 2)
        throw new AppError(
          "APP_RUNNING",
          "A drawing app was opened during download.",
        );
    },
    rename: async (from, to) => {
      if (
        options.renameFault &&
        basename(String(from)).startsWith(".Agent Excalidraw.installing-") &&
        to === target
      )
        throw Object.assign(new Error("simulated publication failure"), {
          code: "EACCES",
        });
      if (
        options.renameFault === "rollback" &&
        basename(String(from)) === ".Agent Excalidraw.previous.app" &&
        to === target
      )
        throw Object.assign(new Error("simulated rollback failure"), {
          code: "EACCES",
        });
      await rename(from, to);
    },
  };
  return {
    root,
    home,
    temporary,
    target,
    commands,
    deps,
    checks: () => checks,
    contents: () =>
      readFile(platform === "darwin" ? join(target, "binary") : target, "utf8"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
test("installer rejects a mismatched checksum without changing the installed app", async () => {
  const f = await fixture({ checksum: "0".repeat(64) });
  try {
    await assert.rejects(installApp({}, f.deps), { code: "CHECKSUM_MISMATCH" });
    assert.equal(await f.contents(), "old app");
    assert.equal(f.commands.length, 0);
    assert.deepEqual(await readdir(f.temporary), []);
  } finally {
    await f.cleanup();
  }
});
test("macOS installer verifies the exact publisher before changing the installed app", async () => {
  const f = await fixture({ team: "OTHERTEAM0" });
  try {
    await assert.rejects(installApp({}, f.deps), {
      code: "PUBLISHER_MISMATCH",
    });
    assert.equal(await f.contents(), "old app");
    assert(
      f.commands.some(
        (command) =>
          command.file === "/usr/bin/codesign" &&
          command.args[0] === "--verify",
      ),
    );
    assert(!f.commands.some((command) => command.file === "/usr/sbin/spctl"));
    assert.deepEqual(await readdir(join(f.home, "Applications")), [
      "Agent Excalidraw.app",
    ]);
  } finally {
    await f.cleanup();
  }
});
for (const platform of ["darwin", "win32", "linux"] as const)
  test(`${platform} installer rechecks the running app at its final replacement/execution boundary`, async () => {
    const f = await fixture({ platform, runningAtFinalCheck: true });
    try {
      await assert.rejects(installApp({}, f.deps), { code: "APP_RUNNING" });
      assert.equal(f.checks(), 2);
      assert.equal(await f.contents(), "old app");
      assert(
        !f.commands.some(
          (command) =>
            command.file.endsWith(".exe") && command.file !== "powershell.exe",
        ),
      );
      if (platform === "darwin")
        assert.deepEqual(await readdir(join(f.home, "Applications")), [
          "Agent Excalidraw.app",
        ]);
      if (platform === "linux")
        assert.deepEqual(await readdir(join(f.target, "..")), [
          "Agent Excalidraw.AppImage",
        ]);
    } finally {
      await f.cleanup();
    }
  });
test("failed macOS app publication restores the actual previous directory", async () => {
  const f = await fixture({ renameFault: "publication" });
  try {
    await assert.rejects(installApp({}, f.deps), { code: "EACCES" });
    assert.equal(await f.contents(), "old app");
    assert.deepEqual(await readdir(join(f.home, "Applications")), [
      "Agent Excalidraw.app",
    ]);
    assert.equal(f.checks(), 2);
  } finally {
    await f.cleanup();
  }
});
test("failed rollback reports the preserved previous app location instead of claiming restoration", async () => {
  const f = await fixture({ renameFault: "rollback" });
  try {
    await assert.rejects(
      installApp({}, f.deps),
      (error) =>
        (error as any).code === "INSTALL_ROLLBACK_REQUIRED" &&
        (error as any).details.target === f.target,
    );
    const backup = join(
      f.home,
      "Applications",
      ".Agent Excalidraw.previous.app",
    );
    assert.equal(await readFile(join(backup, "binary"), "utf8"), "old app");
    await assert.rejects(stat(f.target), { code: "ENOENT" });
  } finally {
    await f.cleanup();
  }
});
test("successful macOS installation retains the actual previous app and records the verified publisher", async () => {
  const f = await fixture();
  try {
    const result = await installApp({}, f.deps);
    assert.equal(result.publisherTeam, "76625SQ67N");
    assert.equal(result.previousVersionRetained, true);
    assert.equal(await f.contents(), "new app");
    assert.equal(
      await readFile(
        join(
          f.home,
          "Applications",
          ".Agent Excalidraw.previous.app",
          "binary",
        ),
        "utf8",
      ),
      "old app",
    );
    assert(f.commands.some((command) => command.file === "/usr/sbin/spctl"));
    assert.equal(f.checks(), 2);
  } finally {
    await f.cleanup();
  }
});
