import {
  mkdir,
  readFile,
  writeFile,
  lstat,
  realpath,
  symlink,
  unlink,
  rm,
  rename,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, isAbsolute, dirname, basename } from "node:path";
import { AppError } from "../shared/types.js";
import { dataDirectory, VERSION } from "./transport.js";
export const skillName = "agent-excalidraw";
const hostNames = ["agents", "codex", "claude"] as const;
type SkillOptions = {
  hosts?: string[];
  dir?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
};
export function roots(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
  return {
    agents: join(env.AGENTS_HOME || join(home, ".agents"), "skills"),
    codex: join(env.CODEX_HOME || join(home, ".codex"), "skills"),
    claude: join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "skills"),
  };
}
function destinations(options: SkillOptions) {
  const env = options.env || process.env;
  if (options.home !== undefined && !options.home.trim())
    throw new AppError("INVALID_HOME", "--home must name a directory.");
  if (options.dir !== undefined && !options.dir.trim())
    throw new AppError("INVALID_DATA_DIR", "--data-dir must name a directory.");
  const home = options.home !== undefined ? resolve(options.home) : homedir();
  // Explicit --home overrides inherited agent-host roots. The canonical source can
  // still be shared intentionally through --data-dir or AGENT_EXCALIDRAW_DATA_DIR.
  const known = roots(options.home !== undefined ? {} : env, home);
  const storageEnv =
    options.home !== undefined
      ? { ...env, APPDATA: undefined, XDG_CONFIG_HOME: undefined }
      : env;
  const base = resolve(
    options.dir || dataDirectory(storageEnv, process.platform, home),
  );
  const canonical = join(base, "skills", skillName);
  const hosts = [...new Set(options.hosts || hostNames)];
  if (!hosts.length || hosts.some((host) => !hostNames.includes(host as any)))
    throw new AppError(
      "UNKNOWN_HOST",
      "--hosts accepts a comma-separated selection of agents,codex,claude. Example: --hosts codex,claude.",
    );
  const links = hosts.map((host) => ({
    host,
    path: join(known[host as keyof typeof known], skillName),
    target: canonical,
  }));
  if (links.some((link) => resolve(link.path) === resolve(canonical)))
    throw new AppError(
      "SKILL_TARGET_OVERLAP",
      "The canonical source and an agent link would be the same folder. Choose a separate --data-dir.",
    );
  return { canonical, links, known };
}
export async function bundledSkill() {
  const candidates = [
    new URL("../skills/agent-excalidraw/SKILL.md", import.meta.url),
    new URL("../../skills/agent-excalidraw/SKILL.md", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {}
  }
  throw new AppError(
    "SKILL_MISSING",
    "This installation does not contain the skill. Reinstall the CLI package.",
  );
}
const markerPath = (canonical: string) =>
  join(canonical, ".agent-excalidraw-owned.json");
async function ownedMarker(canonical: string): Promise<{
  name: string;
  version?: string;
  canonical: string;
  links: string[];
} | null> {
  try {
    const info = await lstat(canonical);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const marker = JSON.parse(await readFile(markerPath(canonical), "utf8"));
    if (
      marker.name !== skillName ||
      typeof marker.canonical !== "string" ||
      resolve(marker.canonical) !== resolve(canonical)
    )
      return null;
    // Paths recorded in app data are inspection hints, never deletion authority.
    const links = Array.isArray(marker.links)
      ? marker.links.filter(
          (path: unknown): path is string =>
            typeof path === "string" &&
            isAbsolute(path) &&
            !path.includes("\0") &&
            path.length < 32768,
        )
      : [];
    return { ...marker, links };
  } catch {
    return null;
  }
}
async function writeMarker(canonical: string, links: string[]) {
  const temporary =
    markerPath(canonical) + `.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        name: skillName,
        version: VERSION,
        canonical,
        links: [...new Set(links)],
      }),
      { flag: "wx" },
    );
    await rename(temporary, markerPath(canonical));
  } finally {
    try {
      await unlink(temporary);
    } catch {}
  }
}
async function linkLocation(path: string) {
  // Resolve directory aliases while keeping the final symlink itself unresolved.
  // This lets selected aliases share one removal without granting a recorded
  // unselected path permission to delete anything.
  const location = join(
    await realpath(dirname(path)).catch(() => resolve(dirname(path))),
    basename(path),
  );
  return process.platform === "win32" ? location.toLowerCase() : location;
}
export async function installSkills(options: SkillOptions = {}) {
  const { canonical, links } = destinations(options);
  let exists = false;
  try {
    await lstat(canonical);
    exists = true;
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const previousMarker = exists ? await ownedMarker(canonical) : null;
  if (exists && !previousMarker)
    throw new AppError(
      "SKILL_CONFLICT",
      `An unrelated folder already exists at ${canonical}. It has not been changed.`,
    );
  let canonicalTarget = exists ? await realpath(canonical) : canonical;
  // Validate every destination before writing the source or creating any link.
  for (const link of links) {
    let info;
    try {
      info = await lstat(link.path);
    } catch (error: any) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    let target: string | null = null;
    try {
      target = await realpath(link.path);
    } catch {}
    if (
      !info.isSymbolicLink() ||
      !target ||
      resolve(target) !== resolve(canonicalTarget)
    )
      throw new AppError(
        "SKILL_CONFLICT",
        `Existing skill at ${link.path} is not owned by this installation. It has not been replaced.`,
      );
  }
  if (options.dryRun)
    return {
      dryRun: true,
      canonical,
      links,
      verified: false,
      message:
        "Preview only. No directories, source files or links were changed.",
    };
  const content = await bundledSkill();
  await mkdir(canonical, { recursive: true });
  canonicalTarget = await realpath(canonical);
  await writeFile(join(canonical, "SKILL.md"), content);
  await writeMarker(canonical, [
    ...(previousMarker?.links || []),
    ...links.map((link) => link.path),
  ]);
  const installed = [];
  for (const link of links) {
    await mkdir(join(link.path, ".."), { recursive: true });
    try {
      await lstat(link.path);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      await symlink(
        canonical,
        link.path,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    installed.push({ ...link, target: await realpath(link.path) });
  }
  return {
    canonical,
    links: installed,
    verified: installed.every(
      (link) => resolve(link.target) === resolve(canonicalTarget),
    ),
    message:
      "Skill files are installed. Start a new agent session if your host does not reload skills. Actual use is verified by a successful app call.",
  };
}
export async function uninstallSkills(
  options: SkillOptions & { removeSource?: boolean } = {},
) {
  const { canonical, links, known } = destinations(options),
    removed: string[] = [],
    kept: string[] = [];
  const canonicalTarget = await realpath(canonical).catch(() => canonical);
  const marker = await ownedMarker(canonical);
  for (const link of links) {
    let info;
    try {
      info = await lstat(link.path);
    } catch (error: any) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    let target: string | null = null;
    try {
      target = await realpath(link.path);
    } catch {}
    if (
      marker &&
      info.isSymbolicLink() &&
      target &&
      resolve(target) === resolve(canonicalTarget)
    )
      removed.push(link.path);
    else kept.push(link.path);
  }
  const selectedLocations = new Set(
    await Promise.all(removed.map(linkLocation)),
  );
  if (options.removeSource) {
    if (!marker)
      throw new AppError(
        "SKILL_CONFLICT",
        "Canonical skill ownership could not be verified. No integration files were changed.",
      );
    const candidates = [
      ...new Set([
        ...Object.values(known).map((root) => join(root, skillName)),
        ...marker.links,
      ]),
    ];
    for (const path of candidates) {
      if (selectedLocations.has(await linkLocation(path))) continue;
      try {
        if (
          (await lstat(path)).isSymbolicLink() &&
          resolve(await realpath(path)) === resolve(canonicalTarget)
        )
          throw new AppError(
            "SKILL_SOURCE_IN_USE",
            `The skill source is still linked from ${path}. Uninstall that home's link before removing the source.`,
          );
      } catch (error: any) {
        if (error instanceof AppError) throw error;
        if (!["ENOENT", "ENOTDIR", "EINVAL"].includes(error.code))
          throw new AppError(
            "SKILL_LINK_UNVERIFIED",
            `Could not verify recorded skill link ${path}. No integration files were changed.`,
          );
      }
    }
  }
  if (options.dryRun)
    return {
      dryRun: true,
      canonical,
      links,
      removed: [],
      wouldRemove: removed,
      removeSource: !!options.removeSource,
      kept,
      drawingsRemoved: false,
      message: "Preview only. No integration files were changed.",
    };
  const deletedLocations = new Set<string>();
  for (const path of removed) {
    const location = await linkLocation(path);
    if (deletedLocations.has(location)) continue;
    await unlink(path);
    deletedLocations.add(location);
  }
  if (options.removeSource) await rm(canonical, { recursive: true });
  else if (marker)
    await writeMarker(
      canonical,
      (
        await Promise.all(
          marker.links.map(async (path) => ({
            path,
            location: await linkLocation(path),
          })),
        )
      )
        .filter((entry) => !selectedLocations.has(entry.location))
        .map((entry) => entry.path),
    );
  return {
    canonical,
    removed,
    kept,
    sourceRemoved: !!options.removeSource,
    drawingsRemoved: false,
  };
}
