import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  chmod,
  copyFile,
  open,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "../shared/types.js";
import { VERSION, send } from "./transport.js";
const exec = promisify(execFile);
const repository = "ralfboltshauser/agent-excalidraw";
const MAC_TEAM_ID = "76625SQ67N";
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
type Asset = { platform: string; arch: string; name: string; sha256: string };
type Manifest = { version: string; assets: Asset[] };
/** External download/process seams are injectable so failure tests still exercise real files. */
export type InstallerDependencies = {
  fetch: typeof fetch;
  exec: (
    file: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
  home: string;
  tempRoot: string;
  platform: NodeJS.Platform;
  arch: string;
  assertAppStopped: () => Promise<void>;
  rename: typeof rename;
};
async function assertAppStopped() {
  try {
    await send({ command: "status" }, { timeout: 3000 });
    throw new AppError(
      "APP_RUNNING",
      "Close Agent Excalidraw normally before installing an app update. Save or discard your work in its window first.",
    );
  } catch (error: any) {
    if (!["APP_NOT_RUNNING", "APP_UNAVAILABLE"].includes(error.code))
      throw error;
  }
}
async function fetchRelease(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(120000),
    headers: {
      "User-Agent": "agent-excalidraw-cli",
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok)
    throw new AppError(
      response.status === 404 ? "RELEASE_NOT_AVAILABLE" : "DOWNLOAD_FAILED",
      response.status === 404
        ? `A compatible desktop release is not published yet. Build from the source instructions at https://github.com/${repository}.`
        : `Download failed (${response.status}). Your existing installation is unchanged.`,
    );
  return response;
}
function manifestValue(value: any, version: string): Manifest {
  if (
    !value ||
    value.version !== version ||
    !Array.isArray(value.assets) ||
    value.assets.some(
      (a: any) =>
        !a ||
        typeof a.platform !== "string" ||
        typeof a.arch !== "string" ||
        typeof a.name !== "string" ||
        a.name !== basename(a.name) ||
        typeof a.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(a.sha256),
    )
  )
    throw new AppError(
      "INVALID_MANIFEST",
      "The release manifest is malformed or does not match the requested version.",
    );
  return value;
}
async function download(file: string, response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES)
    throw new AppError(
      "DOWNLOAD_TOO_LARGE",
      "The installer exceeds the 1 GiB download limit. Nothing was installed.",
    );
  if (!response.body)
    throw new AppError("DOWNLOAD_FAILED", "The installer download is empty.");
  const handle = await open(file, "wx", 0o600),
    hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of response.body as any) {
      size += chunk.byteLength;
      if (size > MAX_DOWNLOAD_BYTES)
        throw new AppError(
          "DOWNLOAD_TOO_LARGE",
          "The installer exceeds the 1 GiB download limit. Nothing was installed.",
        );
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}
export async function installApp(
  options: { version?: string } = {},
  overrides: Partial<InstallerDependencies> = {},
) {
  const deps: InstallerDependencies = {
    fetch: globalThis.fetch,
    exec,
    home: homedir(),
    tempRoot: tmpdir(),
    platform: process.platform,
    arch: process.arch,
    assertAppStopped,
    rename,
    ...overrides,
  };
  const version = (options.version || VERSION).replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
    throw new AppError(
      "INVALID_VERSION",
      "Use a specific release version, for example 0.1.0.",
    );
  const release = (await (
    await fetchRelease(
      `https://api.github.com/repos/${repository}/releases/tags/v${version}`,
      deps.fetch,
    )
  ).json()) as any;
  const manifestAsset = release.assets?.find(
    (a: any) => a.name === "agent-excalidraw-manifest.json",
  );
  if (!manifestAsset)
    throw new AppError(
      "RELEASE_NOT_INSTALLABLE",
      "This release has no verified installer manifest. Download the signed native installer from the release page.",
    );
  const manifest = manifestValue(
    await (
      await fetchRelease(manifestAsset.browser_download_url, deps.fetch)
    ).json(),
    version,
  );
  const asset = manifest.assets.find(
    (a) => a.platform === deps.platform && a.arch === deps.arch,
  );
  if (!asset)
    throw new AppError(
      "UNSUPPORTED_PLATFORM",
      `No verified installer is available for ${deps.platform}/${deps.arch} in this release.`,
    );
  const remote = release.assets.find((a: any) => a.name === asset.name);
  if (!remote)
    throw new AppError(
      "INVALID_MANIFEST",
      "The installer named by the manifest is missing.",
    );
  await deps.assertAppStopped();
  const work = await mkdtemp(join(deps.tempRoot, "agent-excalidraw-install-"));
  try {
    const downloaded = join(work, asset.name);
    const digest = await download(
      downloaded,
      await fetchRelease(remote.browser_download_url, deps.fetch),
    );
    if (digest !== asset.sha256.toLowerCase())
      throw new AppError(
        "CHECKSUM_MISMATCH",
        "The downloaded app failed checksum verification. Nothing was installed.",
      );
    if (deps.platform === "darwin") {
      if (!asset.name.endsWith(".zip"))
        throw new AppError(
          "INSTALLER_FORMAT",
          "Automatic macOS installation requires a signed app zip. Use the disk image manually.",
        );
      const expanded = join(work, "expanded");
      await deps.exec("/usr/bin/ditto", ["-x", "-k", downloaded, expanded]);
      const app = join(expanded, "Agent Excalidraw.app");
      await stat(app);
      await deps.exec("/usr/bin/codesign", [
        "--verify",
        "--deep",
        "--strict",
        app,
      ]);
      const identity = await deps.exec("/usr/bin/codesign", [
        "--display",
        "--verbose=4",
        app,
      ]);
      const team = (identity.stdout + "\n" + identity.stderr).match(
        /^TeamIdentifier=([^\r\n]+)$/m,
      )?.[1];
      if (team !== MAC_TEAM_ID)
        throw new AppError(
          "PUBLISHER_MISMATCH",
          "The macOS app is not signed by the expected Agent Excalidraw publisher. Nothing was installed.",
        );
      await deps.exec("/usr/sbin/spctl", [
        "--assess",
        "--type",
        "execute",
        app,
      ]);
      const applications = join(deps.home, "Applications");
      await mkdir(applications, { recursive: true });
      const target = join(applications, "Agent Excalidraw.app"),
        stage = join(
          applications,
          `.Agent Excalidraw.installing-${randomUUID()}.app`,
        ),
        backup = join(applications, ".Agent Excalidraw.previous.app");
      try {
        await deps.exec("/usr/bin/ditto", [app, stage]);
        // Download/signature checks may take minutes. Recheck at the actual write
        // boundary. This is best-effort admission, not an OS-wide installer lock.
        await deps.assertAppStopped();
        let replaced = false;
        try {
          await stat(target);
          await rm(backup, { recursive: true, force: true });
          await deps.rename(target, backup);
          replaced = true;
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error;
        }
        try {
          await deps.rename(stage, target);
        } catch (error) {
          if (replaced) {
            try {
              await deps.rename(backup, target);
            } catch {
              throw new AppError(
                "INSTALL_ROLLBACK_REQUIRED",
                `Installation failed and automatic restoration could not finish. Your previous app is preserved at ${backup}. Restore it to ${target} before launching.`,
                { backup, target },
              );
            }
          }
          throw error;
        }
        return {
          version,
          path: target,
          verified: true,
          publisherTeam: MAC_TEAM_ID,
          previousVersionRetained: replaced,
        };
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(() => {});
      }
    }
    if (deps.platform === "win32") {
      if (!asset.name.endsWith(".exe"))
        throw new AppError(
          "INSTALLER_FORMAT",
          "Windows installation requires the signed per-user installer.",
        );
      const escaped = downloaded.replaceAll("'", "''");
      const result = await deps.exec("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status`,
      ]);
      if (result.stdout.trim() !== "Valid")
        throw new AppError(
          "SIGNATURE_INVALID",
          "The Windows installer signature is not valid. Nothing was installed.",
        );
      await deps.assertAppStopped();
      await deps.exec(downloaded, ["/S"]);
      return {
        version,
        installed: true,
        verified: true,
        message:
          "Per-user installer completed. Start Agent Excalidraw from the Start menu.",
      };
    }
    if (deps.platform === "linux") {
      if (!asset.name.endsWith(".AppImage"))
        throw new AppError(
          "INSTALLER_FORMAT",
          "Use the documented .deb installer for this release. Automatic installation requires a verified AppImage.",
        );
      const folder = join(deps.home, ".local", "share", "agent-excalidraw");
      await mkdir(folder, { recursive: true });
      const target = join(folder, "Agent Excalidraw.AppImage"),
        stage = target + `.installing-${randomUUID()}`;
      try {
        await copyFile(downloaded, stage);
        await chmod(stage, 0o755);
        await deps.assertAppStopped();
        try {
          await stat(target);
          await deps.rename(target, target + ".previous");
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error;
        }
        try {
          await deps.rename(stage, target);
        } catch (error) {
          try {
            await deps.rename(target + ".previous", target);
          } catch {}
          throw error;
        }
        return {
          version,
          path: target,
          verified: true,
          message:
            "AppImage installed. If your distribution requires FUSE, follow the release launch instructions.",
        };
      } finally {
        await rm(stage, { force: true }).catch(() => {});
      }
    }
    throw new AppError(
      "UNSUPPORTED_PLATFORM",
      `Automatic installation is not available for ${deps.platform}.`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
