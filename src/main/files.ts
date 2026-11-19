import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AppError,
  blankScene,
  type Drawing,
  type Scene,
  type Settings,
} from "../shared/types.js";

const ELEMENT_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "freedraw",
  "text",
  "image",
  "frame",
  "magicframe",
  "embeddable",
]);
const MAX_SCENE_BYTES = 100 * 1024 * 1024;
const MAX_FOLDER_FILES = 10000;
const MAX_RECOVERIES = 30;
const MAX_RECOVERY_META_BYTES = 16 * 1024;
const MAX_RECOVERY_BODY_BYTES = MAX_SCENE_BYTES + 64 * 1024;
type Recovery = { id: string; path: string; time: number };
type RecoveryMeta = Recovery & { revision?: number };
type RecoveryData = Recovery & {
  revision: number;
  drawing: Drawing;
  scene: Scene;
};
type Index = { version: 1; drawings: Drawing[]; settings: Settings };

function slug(value: string, fallback = "Untitled") {
  const clean = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  const safe = clean.slice(0, 100) || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)
    ? `_${safe}`
    : safe;
}
function titleFor(file: string) {
  return path.basename(file, path.extname(file));
}
export function sceneBytes(scene: Scene): string {
  // Validate before filtering: an unknown future type must never disappear just
  // because it is marked deleted. Match local serializeAsJSON's privacy rule
  // without loading the browser-only editor package into the native host.
  const validated = validateScene(scene);
  const elements = validated.elements.filter((element) => !element.isDeleted);
  const referenced = new Set(
    elements
      .filter(
        (element) =>
          element.type === "image" &&
          typeof element.fileId === "string" &&
          element.fileId,
      )
      .map((element) => element.fileId),
  );
  const files = Object.fromEntries(
    Object.entries(validated.files).filter(([id]) => referenced.has(id)),
  );
  return JSON.stringify({ ...validated, elements, files }, null, 2) + "\n";
}
function fingerprint(bytes: string | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function withExtension(file: string) {
  return file.toLowerCase().endsWith(".excalidraw")
    ? file
    : `${file}.excalidraw`;
}
function missingError(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Reject unsupported input before activating it: the SDK must never silently drop future elements. */
export function validateScene(value: unknown): Scene {
  if (
    !isRecord(value) ||
    value.type !== "excalidraw" ||
    !Array.isArray(value.elements)
  ) {
    throw new AppError(
      "INVALID_SCENE",
      "This file is not a valid Excalidraw drawing. Its original bytes have not been changed.",
    );
  }
  if (![1, 2].includes(value.version))
    throw new AppError(
      "UNSUPPORTED_FORMAT",
      `Drawing format version ${value.version} is not supported. Open it with a compatible editor.`,
    );
  const ids = new Set<string>();
  for (const element of value.elements) {
    if (
      !isRecord(element) ||
      typeof element.type !== "string" ||
      !ELEMENT_TYPES.has(element.type)
    ) {
      throw new AppError(
        "UNSUPPORTED_FORMAT",
        `This drawing contains an unsupported element type: ${String(element?.type)}. The original file is unchanged.`,
      );
    }
    if (typeof element.id !== "string" || !element.id || ids.has(element.id))
      throw new AppError(
        "INVALID_SCENE",
        "Drawing elements have missing or duplicate identities.",
      );
    ids.add(element.id);
  }
  if (value.appState !== undefined && !isRecord(value.appState))
    throw new AppError("INVALID_SCENE", "Drawing app state is invalid.");
  if (value.files !== undefined && !isRecord(value.files))
    throw new AppError("INVALID_SCENE", "Drawing image resources are invalid.");
  return {
    ...value,
    type: "excalidraw",
    version: value.version,
    source:
      typeof value.source === "string" ? value.source : "agent-excalidraw",
    elements: value.elements,
    appState: value.appState || {},
    files: value.files || {},
  } as Scene;
}

/** Metadata-only suggestion. The create operation performs the final exclusive allocation. */
export function pathSuggest(
  title = "Untitled",
  projectDir?: string,
  defaultFolder = path.join(os.homedir(), "Excalidraw"),
): string {
  const project = projectDir
    ? slug(path.basename(path.resolve(projectDir)), "project")
    : null;
  return path.resolve(
    defaultFolder,
    ...(project ? ["projects", project] : ["inbox"]),
    `${slug(title)}.excalidraw`,
  );
}

/** One serialized writer owns current document persistence, registry and private crash snapshots. */
export class FileStore {
  settings: Settings;
  drawings: Drawing[] = [];
  active: Drawing | null = null;
  private hashes = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private indexPath: string;
  private recoveryDir: string;
  private legacyRecoveries = new Map<
    string,
    { signature: string; summary: RecoveryMeta | null }
  >();

  constructor(
    public readonly dataDir: string,
    defaultFolder = path.join(os.homedir(), "Excalidraw"),
  ) {
    this.settings = {
      defaultFolder: path.resolve(defaultFolder),
      theme: "system",
      autosave: false,
      folders: [],
    };
    this.indexPath = path.join(dataDir, "library.json");
    this.recoveryDir = path.join(dataDir, "recovery");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.recoveryDir, { recursive: true, mode: 0o700 });
    try {
      const index = JSON.parse(
        await fs.readFile(this.indexPath, "utf8"),
      ) as Index;
      if (
        index.version !== 1 ||
        !Array.isArray(index.drawings) ||
        !isRecord(index.settings)
      )
        throw new Error("Invalid library metadata");
      this.drawings = index.drawings
        .filter(
          (d) =>
            typeof d.id === "string" &&
            path.isAbsolute(d.path) &&
            typeof d.title === "string",
        )
        .map((d) => ({ ...d, starred: !!d.starred }));
      this.settings = {
        ...this.settings,
        ...index.settings,
        folders: Array.isArray(index.settings.folders)
          ? index.settings.folders.filter(
              (f) => typeof f === "string" && path.isAbsolute(f),
            )
          : [],
      };
    } catch (error) {
      if (!missingError(error)) {
        // A broken index must not make drawings inaccessible or be silently overwritten.
        await fs.rename(
          this.indexPath,
          path.join(this.dataDir, `library-corrupt-${Date.now()}.json`),
        );
      }
      await this.persist();
    }
  }

  private run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job);
    this.queue = result.catch(() => {});
    return result;
  }

  private async canonical(file: string, createParent = false): Promise<string> {
    const absolute = path.resolve(file);
    try {
      return await fs.realpath(absolute);
    } catch (error) {
      if (!missingError(error)) throw error;
    }
    if (createParent)
      await fs.mkdir(path.dirname(absolute), { recursive: true });
    return path.join(
      await fs.realpath(path.dirname(absolute)),
      path.basename(absolute),
    );
  }

  private async persist(): Promise<void> {
    await this.atomicWrite(
      this.indexPath,
      JSON.stringify(
        {
          version: 1,
          drawings: this.drawings,
          settings: this.settings,
        } satisfies Index,
        null,
        2,
      ) + "\n",
    );
  }

  private async atomicWrite(
    target: string,
    bytes: string,
    exclusive = false,
  ): Promise<void> {
    const temp = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${randomUUID()}.tmp`,
    );
    let mode = 0o600;
    if (!exclusive) {
      try {
        mode = (await fs.stat(target)).mode & 0o777;
      } catch (error) {
        if (!missingError(error)) throw error;
      }
    }
    const handle = await fs.open(temp, "wx", mode);
    let published = false;
    try {
      await handle.writeFile(bytes, "utf8");
      await handle.sync();
      await handle.close();
      if (exclusive) {
        // Hard-linking a completed sibling file is exclusive and never replaces an existing file.
        await fs.link(temp, target);
        published = true;
        await fs.unlink(temp);
      } else {
        await fs.rename(temp, target);
        published = true;
      }
      // Persist the directory entry on filesystems which expose directory fsync.
      let directory;
      try {
        directory = await fs.open(path.dirname(target), constants.O_RDONLY);
        await directory.sync();
      } catch (error) {
        if (
          !["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EACCES", "EBADF"].includes(
            (error as NodeJS.ErrnoException).code || "",
          )
        )
          throw error;
      } finally {
        await directory?.close();
      }
    } catch (error) {
      await handle.close().catch(() => {});
      await fs.unlink(temp).catch(() => {});
      if (published)
        throw new AppError(
          "WRITE_OUTCOME_UNKNOWN",
          `The new file was published at ${target}, but its durability could not be confirmed. Inspect the file before retrying.`,
          { path: target, stage: "published", cause: (error as Error).message },
        );
      throw error;
    }
  }

  private register(file: string): Drawing {
    const existing = this.drawings.find((d) => this.samePath(d.path, file));
    const drawing = existing || {
      id: randomUUID(),
      path: file,
      title: titleFor(file),
      lastOpened: Date.now(),
      starred: false,
    };
    drawing.lastOpened = Date.now();
    drawing.missing = false;
    if (!existing) this.drawings.push(drawing);
    return drawing;
  }
  private samePath(a: string, b: string) {
    return process.platform === "win32"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;
  }
  private current(id?: string) {
    if (!this.active)
      throw new AppError("NO_DOCUMENT", "Open or create a drawing first.");
    if (id && this.active.id !== id)
      throw new AppError(
        "DOCUMENT_CHANGED",
        "The active drawing changed before this file operation. Retry with its current identity.",
      );
    return this.active;
  }
  private async read(file: string): Promise<{ scene: Scene; hash: string }> {
    const stat = await fs.stat(file);
    if (!stat.isFile())
      throw new AppError(
        "INVALID_PATH",
        "Choose an Excalidraw file, not a folder.",
      );
    if (stat.size > MAX_SCENE_BYTES)
      throw new AppError(
        "FILE_TOO_LARGE",
        "This drawing exceeds the 100 MiB input limit.",
      );
    const bytes = await fs.readFile(file);
    if (bytes.length > MAX_SCENE_BYTES)
      throw new AppError(
        "FILE_TOO_LARGE",
        "This drawing exceeds the 100 MiB input limit.",
      );
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new AppError(
        "INVALID_SCENE",
        "This drawing contains invalid JSON. Its original bytes have not been changed.",
      );
    }
    return { scene: validateScene(value), hash: fingerprint(bytes) };
  }
  private async assertUnchanged(drawing: Drawing) {
    let bytes;
    try {
      bytes = await fs.readFile(drawing.path);
    } catch (error) {
      if (missingError(error))
        throw new AppError(
          "FILE_MISSING",
          "The original file is missing. Save a copy or locate it before continuing.",
        );
      throw error;
    }
    const expected = this.hashes.get(drawing.id);
    if (!expected || fingerprint(bytes) !== expected)
      throw new AppError(
        "FILE_CONFLICT",
        "This drawing changed outside the app. Save your work as a copy to preserve both versions.",
        { path: drawing.path },
      );
  }

  private async assertWritable(drawing: Drawing): Promise<void> {
    const metadata = await fs.stat(drawing.path);
    // Atomic replacement depends on directory permission, but a user marking a
    // source read-only must still be respected, including when running as root.
    if (process.platform !== "win32" && (metadata.mode & 0o222) === 0) {
      throw new AppError(
        "READ_ONLY",
        "This drawing is read-only. Save a copy at another location.",
        { path: drawing.path },
      );
    }
    try {
      await fs.access(drawing.path, constants.W_OK);
    } catch (error) {
      if (
        ["EACCES", "EPERM", "EROFS"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        throw new AppError(
          "READ_ONLY",
          "This drawing is read-only. Save a copy at another location.",
          { path: drawing.path },
        );
      throw error;
    }
  }

  async list(): Promise<Drawing[]> {
    return this.run(async () => {
      await Promise.all(
        this.drawings.map(async (d) => {
          try {
            d.missing = !(await fs.stat(d.path)).isFile();
          } catch {
            d.missing = true;
          }
        }),
      );
      return copy(this.drawings).sort(
        (a, b) =>
          Number(b.starred) - Number(a.starred) || b.lastOpened - a.lastOpened,
      );
    });
  }

  async create(
    args: {
      title?: string;
      path?: string;
      projectDir?: string;
      directory?: string;
    } = {},
  ): Promise<{ drawing: Drawing; scene: Scene }> {
    return this.run(async () => {
      const suggested = args.path
        ? withExtension(path.resolve(args.path))
        : args.directory
          ? path.join(
              path.resolve(args.directory),
              slug(args.title || "Untitled") + ".excalidraw",
            )
          : this.pathSuggest(args.title, args.projectDir);
      const base = await this.canonical(suggested, true);
      const scene = blankScene(),
        bytes = sceneBytes(scene);
      let file = base;
      for (let suffix = 1; ; suffix++) {
        try {
          await this.atomicWrite(file, bytes, true);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (args.path)
            throw new AppError(
              "FILE_EXISTS",
              "A file already exists at this location. Open it or choose another path.",
            );
          file = path.join(
            path.dirname(base),
            `${titleFor(base)} ${suffix + 1}.excalidraw`,
          );
        }
      }
      const drawing = this.register(file);
      drawing.readOnly = false;
      this.active = drawing;
      this.hashes.set(drawing.id, fingerprint(bytes));
      await this.persist();
      return { drawing: copy(drawing), scene };
    });
  }

  async open(file: string): Promise<{ drawing: Drawing; scene: Scene }> {
    return this.run(async () => {
      const canonical = await this.canonical(file);
      const { scene, hash } = await this.read(canonical);
      const drawing = this.register(canonical);
      try {
        const permissions = await fs.stat(canonical);
        drawing.readOnly =
          process.platform !== "win32" && (permissions.mode & 0o222) === 0;
        await fs.access(canonical, constants.W_OK);
      } catch {
        drawing.readOnly = true;
      }
      this.active = drawing;
      this.hashes.set(drawing.id, hash);
      await this.persist();
      return { drawing: copy(drawing), scene };
    });
  }

  /** Read-only watcher probe. Never adopts outside bytes as the new save baseline. */
  async externalStatus(): Promise<{ changed: boolean; missing: boolean }> {
    return this.run(async () => {
      if (!this.active) return { changed: false, missing: false };
      const drawing = this.active;
      try {
        const bytes = await fs.readFile(drawing.path);
        return {
          changed: fingerprint(bytes) !== this.hashes.get(drawing.id),
          missing: false,
        };
      } catch (error) {
        if (missingError(error)) return { changed: false, missing: true };
        throw error;
      }
    });
  }

  async save(scene: Scene, file?: string): Promise<Drawing> {
    if (
      file &&
      this.active &&
      !this.samePath(path.resolve(file), this.active.path)
    )
      return this.saveAs(scene, file);
    const id = this.current().id,
      bytes = sceneBytes(copy(scene));
    return this.run(async () => {
      const drawing = this.current(id);
      await this.assertUnchanged(drawing);
      await this.assertWritable(drawing);
      await this.atomicWrite(drawing.path, bytes);
      this.hashes.set(drawing.id, fingerprint(bytes));
      await this.discardRecoveryNow(drawing.id);
      await this.persist();
      return copy(drawing);
    });
  }

  async saveAs(scene: Scene, file: string): Promise<Drawing> {
    const id = this.current().id,
      bytes = sceneBytes(copy(scene));
    return this.run(async () => {
      const original = this.current(id);
      const target = await this.canonical(withExtension(file), true);
      if (this.samePath(target, original.path)) {
        await this.assertUnchanged(original);
        await this.assertWritable(original);
        await this.atomicWrite(target, bytes);
        this.hashes.set(original.id, fingerprint(bytes));
        await this.discardRecoveryNow(original.id);
        return copy(original);
      }
      try {
        await this.atomicWrite(target, bytes, true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new AppError(
            "FILE_EXISTS",
            "Save As does not replace an existing file. Choose a new filename.",
          );
        throw error;
      }
      // Save As is a new logical document: old document remains a library entry.
      const drawing = this.register(target);
      drawing.readOnly = false;
      this.active = drawing;
      this.hashes.set(drawing.id, fingerprint(bytes));
      await this.discardRecoveryNow(original.id);
      await this.persist();
      return copy(drawing);
    });
  }

  async duplicate(
    scene: Scene,
    args: { path?: string; title?: string } = {},
  ): Promise<Drawing> {
    const id = this.current().id,
      bytes = sceneBytes(copy(scene));
    return this.run(async () => {
      const original = this.current(id);
      const suggested = args.path
        ? withExtension(args.path)
        : path.join(
            path.dirname(original.path),
            `${slug(args.title || original.title + " copy")}.excalidraw`,
          );
      const base = await this.canonical(suggested, true);
      let target = base;
      for (let n = 2; ; n++) {
        try {
          await this.atomicWrite(target, bytes, true);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (args.path)
            throw new AppError(
              "FILE_EXISTS",
              "A file already exists at the duplicate destination.",
            );
          target = path.join(
            path.dirname(base),
            `${titleFor(base)} ${n}.excalidraw`,
          );
        }
      }
      const drawing = this.register(target);
      drawing.readOnly = false;
      await this.persist();
      return copy(drawing);
    });
  }

  async move(file: string): Promise<Drawing> {
    const id = this.current().id;
    return this.run(async () => {
      const drawing = this.current(id),
        target = await this.canonical(withExtension(file), true);
      if (this.samePath(target, drawing.path)) return copy(drawing);
      await this.assertUnchanged(drawing);
      await this.assertWritable(drawing);
      const source = drawing.path;
      // Exclusive copy + verification works across volumes and does not overwrite a target.
      try {
        await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new AppError(
            "FILE_EXISTS",
            "A file already exists at the move destination.",
          );
        throw error;
      }
      try {
        const targetHandle = await fs.open(target, "r+");
        try {
          await targetHandle.sync();
        } finally {
          await targetHandle.close();
        }
        const bytes = await fs.readFile(target);
        if (fingerprint(bytes) !== this.hashes.get(id))
          throw new AppError(
            "MOVE_VERIFY_FAILED",
            "The moved copy did not match the original. The original remains in place.",
          );
        // Recheck source after copying so an external change never gets silently deleted.
        await this.assertUnchanged(drawing);
        await fs.unlink(source);
      } catch (error) {
        // Keep both on interruption/failure; report the partial copy rather than hiding it.
        throw new AppError(
          "MOVE_INCOMPLETE",
          `The original is still at ${source}. A copy may also exist at ${target}.`,
          { source, target, cause: (error as Error).message },
        );
      }
      drawing.path = target;
      drawing.title = titleFor(target);
      await this.persist();
      return copy(drawing);
    });
  }

  async rename(title: string): Promise<Drawing> {
    return this.move(
      path.join(path.dirname(this.current().path), `${slug(title)}.excalidraw`),
    );
  }
  pathSuggest(title = "Untitled", projectDir?: string) {
    return pathSuggest(title, projectDir, this.settings.defaultFolder);
  }
  async forget(id: string): Promise<void> {
    return this.run(async () => {
      this.drawings = this.drawings.filter((d) => d.id !== id);
      await this.persist();
    });
  }
  async star(id: string, value = true): Promise<void> {
    return this.run(async () => {
      const drawing = this.drawings.find((d) => d.id === id);
      if (!drawing)
        throw new AppError("NOT_FOUND", "Drawing is not in the library.");
      drawing.starred = value;
      await this.persist();
    });
  }
  async removeAfterTrash(id: string): Promise<void> {
    return this.run(async () => {
      this.drawings = this.drawings.filter((d) => d.id !== id);
      if (this.active?.id === id) this.active = null;
      this.hashes.delete(id);
      await this.discardRecoveryNow(id);
      await this.persist();
    });
  }

  async addFolder(folder: string): Promise<Drawing[]> {
    return this.run(async () => {
      const root = await fs.realpath(path.resolve(folder));
      if (!(await fs.stat(root)).isDirectory())
        throw new AppError("INVALID_PATH", "Choose a folder.");
      const found: Drawing[] = [];
      let entriesSeen = 0;
      const visit = async (directory: string, depth: number): Promise<void> => {
        if (depth > 20)
          throw new AppError(
            "FOLDER_LIMIT",
            "This folder exceeds the 20-level indexing limit. Choose a smaller folder.",
          );
        for (const entry of await fs.readdir(directory, {
          withFileTypes: true,
        })) {
          if (++entriesSeen > MAX_FOLDER_FILES)
            throw new AppError(
              "FOLDER_LIMIT",
              "This folder exceeds the 10,000-entry indexing limit. Choose a smaller folder.",
            );
          if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(file, depth + 1);
          else if (
            entry.isFile() &&
            entry.name.toLowerCase().endsWith(".excalidraw")
          ) {
            const existing = this.drawings.find((d) =>
              this.samePath(d.path, file),
            );
            // Index metadata only; opening performs format validation. Do not parse every scene during search.
            if (existing) found.push(copy(existing));
            else {
              const drawing = {
                id: randomUUID(),
                path: file,
                title: titleFor(file),
                lastOpened: 0,
                starred: false,
              };
              this.drawings.push(drawing);
              found.push(copy(drawing));
            }
          }
        }
      };
      const before = [...this.drawings];
      try {
        await visit(root, 0);
      } catch (error) {
        this.drawings = before;
        throw error;
      }
      if (!this.settings.folders.some((f) => this.samePath(f, root)))
        this.settings.folders.push(root);
      await this.persist();
      return found;
    });
  }
  async removeFolder(folder: string): Promise<void> {
    return this.run(async () => {
      let canonical = path.resolve(folder);
      try {
        canonical = await fs.realpath(canonical);
      } catch {
        /* Offline folders can still be removed using their stored canonical path. */
      }
      const registered = this.settings.folders.find((root) =>
        this.samePath(root, canonical),
      );
      if (!registered) return; // Repeat removal is idempotent; arbitrary paths must not purge references.
      const within = (root: string, file: string) => {
        const relative = path.relative(root, file);
        return (
          relative === "" ||
          (relative !== ".." &&
            !relative.startsWith(".." + path.sep) &&
            !path.isAbsolute(relative))
        );
      };
      const folders = this.settings.folders.filter(
        (root) => !this.samePath(root, registered),
      );
      const drawings = this.drawings.filter(
        (drawing) =>
          drawing.id === this.active?.id ||
          !within(registered, drawing.path) ||
          folders.some((root) => within(root, drawing.path)),
      );
      const previousFolders = this.settings.folders,
        previousDrawings = this.drawings;
      this.settings.folders = folders;
      this.drawings = drawings;
      try {
        await this.persist();
      } catch (error) {
        this.settings.folders = previousFolders;
        this.drawings = previousDrawings;
        throw error;
      }
      const retained = new Set(drawings.map((drawing) => drawing.id));
      for (const drawing of previousDrawings)
        if (!retained.has(drawing.id)) this.hashes.delete(drawing.id);
      // The active entry stays navigable with the same identity and path. No
      // scene, recovery body, source file or dirty state is modified here.
    });
  }
  async setSettings(partial: Partial<Settings>): Promise<Settings> {
    return this.run(async () => {
      if (
        partial.theme !== undefined &&
        !["system", "light", "dark"].includes(partial.theme)
      )
        throw new AppError(
          "INVALID_ARGUMENT",
          "Choose system, light or dark appearance.",
        );
      if (
        partial.autosave !== undefined &&
        typeof partial.autosave !== "boolean"
      )
        throw new AppError(
          "INVALID_ARGUMENT",
          "Autosave must be true or false.",
        );
      if (
        partial.defaultFolder !== undefined &&
        (typeof partial.defaultFolder !== "string" ||
          !path.isAbsolute(partial.defaultFolder))
      )
        throw new AppError(
          "INVALID_ARGUMENT",
          "The default drawing folder must be an absolute path.",
        );
      this.settings = {
        ...this.settings,
        ...(partial.theme !== undefined ? { theme: partial.theme } : {}),
        ...(partial.autosave !== undefined
          ? { autosave: partial.autosave }
          : {}),
        ...(partial.defaultFolder !== undefined
          ? { defaultFolder: path.resolve(partial.defaultFolder) }
          : {}),
      };
      await this.persist();
      return copy(this.settings);
    });
  }

  async recoveries(): Promise<Recovery[]> {
    return this.run(async () => this.readRecoveries());
  }
  private recoverySummary(
    value: unknown,
    id: string,
    fileTime: number,
  ): RecoveryMeta | null {
    if (
      !isRecord(value) ||
      value.id !== id ||
      typeof value.path !== "string" ||
      !path.isAbsolute(value.path) ||
      typeof value.time !== "number" ||
      !Number.isFinite(value.time) ||
      value.time < 0
    )
      return null;
    return {
      id,
      path: value.path,
      time: Math.min(value.time, fileTime),
      ...(Number.isSafeInteger(value.revision) && value.revision >= 0
        ? { revision: value.revision }
        : {}),
    };
  }
  private async readRecoveryMeta(
    id: string,
    fileTime: number,
  ): Promise<RecoveryMeta | null> {
    let handle;
    try {
      handle = await fs.open(this.recoveryMetaFile(id), "r");
      // One bounded read: a damaged .meta file must not turn listing into an
      // accidental full-scene allocation, even if it grows after being opened.
      const buffer = Buffer.alloc(MAX_RECOVERY_META_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_RECOVERY_META_BYTES) return null;
      return this.recoverySummary(
        JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")),
        id,
        fileTime,
      );
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  private async migrateRecovery(
    id: string,
    metadata: { size: number; mtimeMs: number; ctimeMs: number },
  ): Promise<RecoveryMeta | null> {
    const signature = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    const cached = this.legacyRecoveries.get(id);
    if (cached?.signature === signature) return cached.summary;
    let summary: RecoveryMeta | null = null;
    try {
      if (metadata.size > MAX_RECOVERY_BODY_BYTES)
        throw new Error("Recovery exceeds supported input limit");
      const bytes = await fs.readFile(this.recoveryFile(id));
      if (bytes.length > MAX_RECOVERY_BODY_BYTES)
        throw new Error("Recovery exceeds supported input limit");
      const data = JSON.parse(bytes.toString("utf8"));
      if (
        isRecord(data) &&
        isRecord(data.scene) &&
        data.scene.type === "excalidraw" &&
        Array.isArray(data.scene.elements)
      )
        summary = this.recoverySummary(data, id, metadata.mtimeMs);
      if (summary)
        await this.atomicWrite(
          this.recoveryMetaFile(id),
          JSON.stringify(summary),
        ).catch(() => {});
    } catch {
      /* Keep the body intact. An unchanged unreadable legacy body is not reparsed on every broadcast. */
    }
    this.legacyRecoveries.set(id, { signature, summary });
    if (this.legacyRecoveries.size > 500)
      this.legacyRecoveries.delete(this.legacyRecoveries.keys().next().value!);
    return summary;
  }
  private async readRecoveries(): Promise<Recovery[]> {
    const result: Recovery[] = [];
    const entries = await fs.readdir(this.recoveryDir, { withFileTypes: true });
    for (const entry of entries) {
      // Never treat metadata, incomplete temporary writes, directories or
      // symlinks as recovery bodies, and never clean up unrelated files.
      const match =
        entry.isFile() && /^([a-zA-Z0-9-]+)\.json$/.exec(entry.name);
      if (!match) continue;
      const id = match[1];
      try {
        const metadata = await fs.stat(this.recoveryFile(id));
        if (!metadata.isFile()) continue;
        const summary =
          (await this.readRecoveryMeta(id, metadata.mtimeMs)) ||
          (await this.migrateRecovery(id, metadata));
        if (summary)
          result.push({
            id: summary.id,
            path: summary.path,
            time: summary.time,
          });
      } catch {
        /* Missing or unreadable bodies remain untouched; do not offer a metadata-only recovery. */
      }
    }
    return result.sort((a, b) => b.time - a.time);
  }
  async writeRecovery(scene: Scene, revision: number): Promise<void> {
    const time = Date.now(),
      drawing = copy(this.current()),
      snapshot = copy(validateScene(scene));
    return this.run(async () => {
      // Publish the full body first. If a crash occurs before the small metadata
      // replacement, a previous metadata timestamp is conservatively old; a
      // body without metadata is migrated once on the next listing.
      const recovery: RecoveryData = {
        id: drawing.id,
        path: drawing.path,
        time,
        revision,
        drawing,
        scene: snapshot,
      };
      await this.atomicWrite(
        this.recoveryFile(drawing.id),
        JSON.stringify(recovery),
      );
      await this.atomicWrite(
        this.recoveryMetaFile(drawing.id),
        JSON.stringify({
          id: drawing.id,
          path: drawing.path,
          time,
          revision,
        } satisfies RecoveryMeta),
      );
      this.legacyRecoveries.delete(drawing.id);
      const all = await this.readRecoveries();
      for (const old of all.slice(MAX_RECOVERIES))
        await this.discardRecoveryNow(old.id);
    });
  }
  private recoveryFile(id: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(id))
      throw new AppError("INVALID_ARGUMENT", "Invalid recovery identity.");
    return path.join(this.recoveryDir, `${id}.json`);
  }
  private recoveryMetaFile(id: string): string {
    return this.recoveryFile(id).replace(/\.json$/, ".meta.json");
  }
  private async discardRecoveryNow(id: string) {
    // Remove the body before metadata: a crash must not offer metadata whose
    // intentionally discarded body is gone. Both files are owned exact paths.
    await fs.unlink(this.recoveryFile(id)).catch((error) => {
      if (!missingError(error)) throw error;
    });
    await fs.unlink(this.recoveryMetaFile(id)).catch((error) => {
      if (!missingError(error)) throw error;
    });
    this.legacyRecoveries.delete(id);
  }
  async discardRecovery(id: string): Promise<void> {
    return this.run(async () => this.discardRecoveryNow(id));
  }
  async restoreRecovery(
    id: string,
  ): Promise<{ drawing: Drawing; scene: Scene }> {
    return this.run(async () => {
      const data = JSON.parse(
        await fs.readFile(this.recoveryFile(id), "utf8"),
      ) as RecoveryData;
      const scene = copy(validateScene(data.scene)),
        bytes = sceneBytes(scene);
      // Recover alongside the source when available; otherwise use the current default folder.
      let directory = path.dirname(data.path);
      try {
        await fs.access(directory, constants.W_OK);
      } catch {
        directory = this.settings.defaultFolder;
        await fs.mkdir(directory, { recursive: true });
      }
      const base = `${slug(data.drawing?.title || titleFor(data.path))} recovered`;
      let target = path.join(directory, `${base}.excalidraw`);
      for (let n = 2; ; n++) {
        try {
          await this.atomicWrite(target, bytes, true);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          target = path.join(directory, `${base} ${n}.excalidraw`);
        }
      }
      const drawing = this.register(await this.canonical(target));
      this.active = drawing;
      this.hashes.set(drawing.id, fingerprint(bytes));
      await this.discardRecoveryNow(id);
      await this.persist();
      return { drawing: copy(drawing), scene };
    });
  }
}
