import { test } from "node:test";
import assert from "node:assert/strict";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileStore, pathSuggest } from "../src/main/files.js";
import { blankScene } from "../src/shared/types.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "agent-excalidraw-files-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FileStore(
    path.join(root, "data"),
    path.join(root, "drawings"),
  );
  await store.init();
  return { root, store };
}
const code = (expected: string) => (error: any) => error?.code === expected;
const edited = () => ({
  ...blankScene(),
  elements: [
    { id: "first", type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
  ],
});

test("new files allocate exclusively, suffix implicit collisions and preserve explicit files", async (t) => {
  const { store } = await fixture(t);
  const first = await store.create({ title: "Untitled" });
  const second = await store.create({ title: "Untitled" });
  assert.notEqual(first.drawing.path, second.drawing.path);
  assert.equal(path.basename(second.drawing.path), "Untitled 2.excalidraw");
  assert.equal(
    JSON.parse(await fs.readFile(first.drawing.path, "utf8")).elements.length,
    0,
  );
  await assert.rejects(
    store.create({ path: first.drawing.path }),
    code("FILE_EXISTS"),
  );
  assert.equal(store.active?.id, second.drawing.id);
});

test("save, reopen and exact outside-change conflict preserve both versions", async (t) => {
  const { store } = await fixture(t);
  const { drawing } = await store.create({ title: "My drawing" });
  await store.save(edited());
  const opened = await store.open(drawing.path);
  assert.equal(opened.drawing.id, drawing.id);
  assert.deepEqual(opened.scene.elements, edited().elements);
  const outside = { ...blankScene(), source: "outside editor" };
  await fs.writeFile(drawing.path, JSON.stringify(outside));
  await assert.rejects(store.save(edited()), code("FILE_CONFLICT"));
  assert.deepEqual(
    JSON.parse(await fs.readFile(drawing.path, "utf8")),
    outside,
  );
  await fs.unlink(drawing.path);
  await assert.rejects(store.save(edited()), code("FILE_MISSING"));
});

test("save as rebinds only on success; duplicate leaves original active", async (t) => {
  const { root, store } = await fixture(t);
  const original = await store.create({ title: "Original" });
  const duplicate = await store.duplicate(edited());
  assert.equal(store.active?.id, original.drawing.id);
  assert.deepEqual(
    JSON.parse(await fs.readFile(duplicate.path, "utf8")).elements,
    edited().elements,
  );
  await assert.rejects(
    store.saveAs(edited(), duplicate.path),
    code("FILE_EXISTS"),
  );
  assert.equal(store.active?.id, original.drawing.id);
  const saved = await store.saveAs(
    edited(),
    path.join(root, "other", "Saved as"),
  );
  assert.notEqual(saved.id, original.drawing.id);
  assert.equal(store.active?.path, saved.path);
  assert.equal(
    JSON.parse(await fs.readFile(original.drawing.path, "utf8")).elements
      .length,
    0,
  );
});

test("move preserves identity and persisted bytes, never writes unsaved content implicitly", async (t) => {
  const { root, store } = await fixture(t);
  const original = await store.create({ title: "Original" });
  const destination = path.join(root, "moved", "renamed.excalidraw");
  const moved = await store.move(destination);
  assert.equal(moved.id, original.drawing.id);
  assert.equal(moved.path, destination);
  await assert.rejects(fs.access(original.drawing.path));
  assert.equal(
    JSON.parse(await fs.readFile(destination, "utf8")).elements.length,
    0,
  );
  await store.save(edited());
  assert.equal(
    JSON.parse(await fs.readFile(destination, "utf8")).elements.length,
    1,
  );
  const existing = path.join(root, "existing.excalidraw");
  await fs.writeFile(existing, "keep");
  await assert.rejects(store.move(existing), code("FILE_EXISTS"));
  assert.equal(await fs.readFile(existing, "utf8"), "keep");
  assert.equal(store.active?.path, destination);
});

test("recovery is separate and restores a unique copy without modifying original", async (t) => {
  const { store } = await fixture(t);
  const original = await store.create({ title: "Original" });
  await store.writeRecovery(edited(), 7);
  assert.equal(
    JSON.parse(await fs.readFile(original.drawing.path, "utf8")).elements
      .length,
    0,
  );
  const [candidate] = await store.recoveries();
  assert.equal(candidate.id, original.drawing.id);
  assert.equal(candidate.path, original.drawing.path);
  const restored = await store.restoreRecovery(candidate.id);
  assert.notEqual(restored.drawing.id, original.drawing.id);
  assert.notEqual(restored.drawing.path, original.drawing.path);
  assert.equal(restored.scene.elements.length, 1);
  assert.equal(
    JSON.parse(await fs.readFile(original.drawing.path, "utf8")).elements
      .length,
    0,
  );
  assert.equal((await store.recoveries()).length, 0);
  await assert.rejects(
    store.discardRecovery("../../escape"),
    code("INVALID_ARGUMENT"),
  );
});

test("explicit discard and confirmed save remove their matching recovery", async (t) => {
  const { store } = await fixture(t);
  const { drawing } = await store.create();
  await store.writeRecovery(edited(), 1);
  await store.discardRecovery(drawing.id);
  assert.equal((await store.recoveries()).length, 0);
  await store.writeRecovery(edited(), 2);
  await store.save(edited());
  assert.equal((await store.recoveries()).length, 0);
});

test("corrupt and future content never activates or gets overwritten", async (t) => {
  const { root, store } = await fixture(t);
  const original = await store.create();
  const bad = path.join(root, "bad.excalidraw");
  await fs.writeFile(bad, "{broken");
  await assert.rejects(store.open(bad), code("INVALID_SCENE"));
  assert.equal(store.active?.id, original.drawing.id);
  assert.equal(await fs.readFile(bad, "utf8"), "{broken");
  const future = path.join(root, "future.excalidraw");
  const content = JSON.stringify({
    ...blankScene(),
    elements: [{ id: "future", type: "stickynote" }],
  });
  await fs.writeFile(future, content);
  await assert.rejects(store.open(future), code("UNSUPPORTED_FORMAT"));
  assert.equal(await fs.readFile(future, "utf8"), content);
  await assert.rejects(
    store.save({ ...blankScene(), version: 999 }),
    code("UNSUPPORTED_FORMAT"),
  );
});

test("failed writes retain old source and queued operations recover after failure", async (t) => {
  const { root, store } = await fixture(t);
  const { drawing } = await store.create();
  const collision = path.join(root, "not-a-directory");
  await fs.writeFile(collision, "x");
  await assert.rejects(
    store.saveAs(edited(), path.join(collision, "broken.excalidraw")),
  );
  assert.equal(store.active?.id, drawing.id);
  assert.equal(
    JSON.parse(await fs.readFile(drawing.path, "utf8")).elements.length,
    0,
  );
  await store.save(edited());
  assert.equal(
    JSON.parse(await fs.readFile(drawing.path, "utf8")).elements.length,
    1,
  );
});

test("registry survives restart; forget removes metadata only; star and settings persist", async (t) => {
  const { root, store } = await fixture(t);
  const { drawing } = await store.create({ title: "Persisted" });
  await store.star(drawing.id, true);
  await store.setSettings({ theme: "dark", autosave: true });
  const next = new FileStore(path.join(root, "data"));
  await next.init();
  const [entry] = await next.list();
  assert.equal(entry.id, drawing.id);
  assert.equal(entry.starred, true);
  assert.equal(next.settings.theme, "dark");
  assert.equal(next.settings.autosave, true);
  await next.forget(drawing.id);
  assert.equal((await next.list()).length, 0);
  await fs.access(drawing.path);
});

test("folder indexing is bounded to explicit root and does not follow symlinks", async (t) => {
  const { root, store } = await fixture(t);
  const folder = path.join(root, "scan"),
    outside = path.join(root, "private");
  await fs.mkdir(folder);
  await fs.mkdir(outside);
  await fs.writeFile(
    path.join(folder, "one.excalidraw"),
    JSON.stringify(blankScene()),
  );
  await fs.writeFile(
    path.join(outside, "secret.excalidraw"),
    JSON.stringify(blankScene()),
  );
  if (process.platform !== "win32")
    await fs.symlink(outside, path.join(folder, "escape"));
  const entries = await store.addFolder(folder);
  assert.deepEqual(
    entries.map((d) => d.title),
    ["one"],
  );
  assert.equal(store.active, null);
  await store.removeFolder(folder);
  assert.equal(store.settings.folders.length, 0);
  await fs.access(path.join(folder, "one.excalidraw"));
});

test("path suggestions sanitize names and namespace projects outside their repository", async (t) => {
  const { store, root } = await fixture(t);
  const target = store.pathSuggest("My / diagram", path.join(root, "repo"));
  assert.equal(
    target,
    path.join(
      store.settings.defaultFolder,
      "projects",
      "repo",
      "My - diagram.excalidraw",
    ),
  );
  assert.equal(
    path.basename(pathSuggest("CON", undefined, root)),
    "_CON.excalidraw",
  );
});

test("external watcher status is read-only across outside changes, own save and missing source", async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual(await store.externalStatus(), {
    changed: false,
    missing: false,
  });
  const { drawing } = await store.create({ title: "Watched" });
  assert.deepEqual(await store.externalStatus(), {
    changed: false,
    missing: false,
  });
  await store.save(edited());
  assert.deepEqual(await store.externalStatus(), {
    changed: false,
    missing: false,
  });
  const outside = { ...blankScene(), source: "outside editor" };
  await fs.writeFile(drawing.path, JSON.stringify(outside));
  assert.deepEqual(await store.externalStatus(), {
    changed: true,
    missing: false,
  });
  assert.deepEqual(await store.externalStatus(), {
    changed: true,
    missing: false,
  });
  await assert.rejects(store.save(edited()), code("FILE_CONFLICT"));
  assert.deepEqual(
    JSON.parse(await fs.readFile(drawing.path, "utf8")),
    outside,
  );
  await store.open(drawing.path);
  assert.deepEqual(await store.externalStatus(), {
    changed: false,
    missing: false,
  });
  await fs.unlink(drawing.path);
  assert.deepEqual(await store.externalStatus(), {
    changed: false,
    missing: true,
  });
  await assert.rejects(store.save(edited()), code("FILE_MISSING"));
});

test("native drawing files omit deleted confidential shapes and unreferenced image resources", async (t) => {
  const { store, root } = await fixture(t);
  const original = await store.create({ title: "Private source" });
  const liveImage = {
    id: "live-binary",
    mimeType: "image/png",
    dataURL: "data:image/png;base64,TElWRS1JTUFHRQ==",
    created: 1,
  };
  const deletedImage = {
    id: "deleted-binary",
    mimeType: "image/png",
    dataURL: "data:image/png;base64,REVFVElORy1TRUNSRVQ=",
    created: 1,
  };
  const orphanImage = {
    id: "orphan-binary",
    mimeType: "image/png",
    dataURL: "data:image/png;base64,T1JQSEFOLVNFQ1JFVA==",
    created: 1,
  };
  const scene = {
    ...blankScene(),
    elements: [
      {
        id: "visible-text",
        type: "text",
        text: "Keep this live label",
        isDeleted: false,
      },
      {
        id: "deleted-text",
        type: "text",
        text: "DELETED CONFIDENTIAL TEXT",
        originalText: "DELETED CONFIDENTIAL TEXT",
        isDeleted: true,
      },
      {
        id: "visible-image",
        type: "image",
        fileId: "live-binary",
        isDeleted: false,
      },
      {
        id: "deleted-image",
        type: "image",
        fileId: "deleted-binary",
        isDeleted: true,
      },
      {
        id: "visible-rectangle",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 40,
        height: 30,
      },
    ],
    files: {
      "live-binary": liveImage,
      "deleted-binary": deletedImage,
      "orphan-binary": orphanImage,
    },
  };
  const assertPrivateFile = async (file: string) => {
    const bytes = await fs.readFile(file, "utf8"),
      saved = JSON.parse(bytes);
    assert.deepEqual(saved.elements, [
      scene.elements[0],
      scene.elements[2],
      scene.elements[4],
    ]);
    assert.deepEqual(saved.files, { "live-binary": liveImage });
    assert.equal(bytes.includes("DELETED CONFIDENTIAL TEXT"), false);
    assert.equal(bytes.includes(deletedImage.dataURL), false);
    assert.equal(bytes.includes(orphanImage.dataURL), false);
    assert.equal(bytes.includes(liveImage.dataURL), true);
  };
  await store.save(scene);
  await assertPrivateFile(original.drawing.path);
  // Saving must not mutate the live scene: native Undo still owns its history.
  assert.equal(scene.elements.length, 5);
  assert.equal(Object.keys(scene.files).length, 3);
  const duplicated = await store.duplicate(scene);
  await assertPrivateFile(duplicated.path);
  const savedAs = await store.saveAs(
    scene,
    path.join(root, "Private saved as.excalidraw"),
  );
  await assertPrivateFile(savedAs.path);
  await store.writeRecovery(scene, 12);
  const recovered = await store.restoreRecovery(savedAs.id);
  await assertPrivateFile(recovered.drawing.path);
  // Even deleted future types still reject rather than silently filtering away.
  await assert.rejects(
    store.save({
      ...scene,
      elements: [
        ...scene.elements,
        { id: "future-deleted", type: "stickynote", isDeleted: true },
      ],
    }),
    code("UNSUPPORTED_FORMAT"),
  );
});

test(
  "read-only source refuses atomic replacement and move but permits saving a copy",
  {
    skip:
      process.platform === "win32"
        ? "Unix mode-bit contract; native Windows ACL test remains separate"
        : false,
  },
  async (t) => {
    const { store, root } = await fixture(t);
    const { drawing } = await store.create({ title: "Read only" });
    const original = await fs.readFile(drawing.path, "utf8");
    await fs.chmod(drawing.path, 0o400);
    await assert.rejects(store.save(edited()), code("READ_ONLY"));
    await assert.rejects(
      store.saveAs(edited(), drawing.path),
      code("READ_ONLY"),
    );
    await assert.rejects(
      store.move(path.join(root, "Moved.excalidraw")),
      code("READ_ONLY"),
    );
    assert.equal(await fs.readFile(drawing.path, "utf8"), original);
    assert.equal(store.active?.path, drawing.path);
    const saved = await store.saveAs(
      edited(),
      path.join(root, "Writable copy.excalidraw"),
    );
    assert.equal(
      JSON.parse(await fs.readFile(saved.path, "utf8")).elements.length,
      1,
    );
    assert.equal(await fs.readFile(drawing.path, "utf8"), original);
  },
);

test("post-publication directory fsync failure reports uncertain outcome instead of claiming original retained", async (t) => {
  const { store } = await fixture(t);
  const { drawing } = await store.create({ title: "Durability failure" });
  const originalOpen = fs.open.bind(fs);
  const replacement = t.mock.method(
    fs,
    "open",
    async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (
        args[0] === path.dirname(drawing.path) &&
        args[1] === constants.O_RDONLY
      ) {
        return {
          close: () => handle.close(),
          sync: async () => {
            throw Object.assign(new Error("Injected directory sync failure"), {
              code: "EIO",
            });
          },
        } as any;
      }
      return handle;
    },
  );
  await assert.rejects(store.save(edited()), (error: any) => {
    assert.equal(error.code, "WRITE_OUTCOME_UNKNOWN");
    assert.equal(error.details.path, drawing.path);
    assert.equal(error.details.stage, "published");
    assert.match(error.message, /Inspect the file before retrying/);
    return true;
  });
  replacement.mock.restore();
  // Rename actually completed. A blind retry is refused until reinspection.
  assert.equal(
    JSON.parse(await fs.readFile(drawing.path, "utf8")).elements.length,
    1,
  );
  await assert.rejects(store.save(edited()), code("FILE_CONFLICT"));
  await store.open(drawing.path);
  await store.save(edited());
});

test("recovery summaries and retention use small metadata without rereading scene bodies", async (t) => {
  const { store, root } = await fixture(t);
  const recoveryDir = path.join(root, "data", "recovery");
  const ids: string[] = [];
  const largeScene = {
    ...blankScene(),
    elements: [
      {
        id: "large-note",
        type: "text",
        text: "Synthetic recovery content. ".repeat(10000),
      },
    ],
  };
  for (let i = 0; i < 2; i++) {
    const { drawing } = await store.create({ title: `Recovery ${i}` });
    ids.push(drawing.id);
    await store.writeRecovery(largeScene, i + 1);
    const metadata = await fs.stat(
      path.join(recoveryDir, `${drawing.id}.meta.json`),
    );
    assert.ok(metadata.size < 16 * 1024);
  }
  const originalRead = fs.readFile.bind(fs);
  let bodyReads = 0;
  const monitor = t.mock.method(fs, "readFile", ((...args: any[]) => {
    const file = String(args[0]);
    if (
      file.startsWith(recoveryDir + path.sep) &&
      file.endsWith(".json") &&
      !file.endsWith(".meta.json")
    )
      bodyReads++;
    return (originalRead as any)(...args);
  }) as typeof fs.readFile);
  for (let i = 0; i < 10; i++)
    assert.equal((await store.recoveries()).length, 2);
  await store.writeRecovery(largeScene, 3);
  assert.equal(
    bodyReads,
    0,
    "listing and retention must not parse full recovery scenes",
  );
  await store.restoreRecovery(ids[0]);
  assert.equal(bodyReads, 1, "restore reads exactly its selected full body");
  monitor.mock.restore();
  await assert.rejects(fs.access(path.join(recoveryDir, `${ids[0]}.json`)));
  await assert.rejects(
    fs.access(path.join(recoveryDir, `${ids[0]}.meta.json`)),
  );
});

test("legacy and damaged metadata migrate once while keeping the full recovery body intact", async (t) => {
  const { store, root } = await fixture(t);
  const { drawing } = await store.create({ title: "Legacy snapshot" });
  await store.writeRecovery(edited(), 4);
  const body = path.join(root, "data", "recovery", `${drawing.id}.json`);
  const meta = path.join(root, "data", "recovery", `${drawing.id}.meta.json`);
  const originalBody = await fs.readFile(body, "utf8");
  await fs.unlink(meta);
  const originalRead = fs.readFile.bind(fs);
  let bodyReads = 0;
  const monitor = t.mock.method(fs, "readFile", ((...args: any[]) => {
    if (String(args[0]) === body) bodyReads++;
    return (originalRead as any)(...args);
  }) as typeof fs.readFile);
  assert.equal((await store.recoveries())[0].id, drawing.id);
  assert.equal(bodyReads, 1);
  assert.equal((await store.recoveries())[0].id, drawing.id);
  assert.equal(bodyReads, 1, "migrated legacy bodies must not be parsed again");
  await fs.writeFile(meta, "x".repeat(32 * 1024));
  // A new process has no migration cache. Oversized/corrupt metadata repairs
  // from this one real body, then returns to metadata-only listing.
  const restarted = new FileStore(path.join(root, "data"));
  await restarted.init();
  assert.equal((await restarted.recoveries())[0].id, drawing.id);
  assert.equal(bodyReads, 2);
  assert.equal((await restarted.recoveries())[0].id, drawing.id);
  assert.equal(bodyReads, 2);
  monitor.mock.restore();
  assert.equal(await fs.readFile(body, "utf8"), originalBody);
  const repaired = JSON.parse(await fs.readFile(meta, "utf8"));
  assert.equal(repaired.id, drawing.id);
  assert.ok(repaired.time <= JSON.parse(originalBody).time);
});

test("a crash between body and metadata publication uses conservative time and restores the newer body", async (t) => {
  const { store, root } = await fixture(t);
  const { drawing } = await store.create({ title: "Interrupted snapshot" });
  await store.writeRecovery(edited(), 2);
  const body = path.join(root, "data", "recovery", `${drawing.id}.json`);
  const previous = (await store.recoveries())[0];
  const data = JSON.parse(await fs.readFile(body, "utf8"));
  data.time += 1000;
  data.revision = 3;
  data.scene.elements[0].x = 777;
  await fs.writeFile(body, JSON.stringify(data)); // Metadata is deliberately left old.
  const summary = (await store.recoveries())[0];
  assert.equal(summary.time, previous.time);
  const restored = await store.restoreRecovery(drawing.id);
  assert.equal(restored.scene.elements[0].x, 777);
});

test("unreadable legacy bodies are not reparsed repeatedly and remain recoverable after repair", async (t) => {
  const { store, root } = await fixture(t);
  const { drawing } = await store.create();
  await store.writeRecovery(edited(), 1);
  const body = path.join(root, "data", "recovery", `${drawing.id}.json`);
  const meta = path.join(root, "data", "recovery", `${drawing.id}.meta.json`);
  const valid = await fs.readFile(body, "utf8");
  await fs.unlink(meta);
  await fs.writeFile(body, "{broken");
  const originalRead = fs.readFile.bind(fs);
  let reads = 0;
  const monitor = t.mock.method(fs, "readFile", ((...args: any[]) => {
    if (String(args[0]) === body) reads++;
    return (originalRead as any)(...args);
  }) as typeof fs.readFile);
  assert.deepEqual(await store.recoveries(), []);
  assert.deepEqual(await store.recoveries(), []);
  assert.equal(reads, 1);
  await fs.writeFile(body, valid);
  assert.equal((await store.recoveries())[0].id, drawing.id);
  assert.equal(reads, 2);
  monitor.mock.restore();
});

test("recovery retention deletes only the oldest owned body and metadata pair", async (t) => {
  const { store, root } = await fixture(t);
  const { drawing } = await store.create();
  const directory = path.join(root, "data", "recovery");
  const time = Date.now() - 10000;
  for (let i = 0; i < 30; i++) {
    const id = `old-${String(i).padStart(2, "0")}`,
      source = path.join(root, `old-${i}.excalidraw`);
    const summary = { id, path: source, time: time - i * 1000, revision: 1 };
    await fs.writeFile(
      path.join(directory, `${id}.json`),
      JSON.stringify({
        ...summary,
        drawing: { id, path: source, title: id },
        scene: edited(),
      }),
    );
    await fs.writeFile(
      path.join(directory, `${id}.meta.json`),
      JSON.stringify(summary),
    );
  }
  const unrelated = path.join(directory, "notes.json"),
    incomplete = path.join(directory, ".snapshot.tmp"),
    orphan = path.join(directory, "unrelated.meta.json");
  await fs.writeFile(unrelated, '{"purpose":"keep me"}');
  await fs.writeFile(incomplete, "keep temporary evidence");
  await fs.writeFile(orphan, '{"purpose":"no matching body"}');
  await store.writeRecovery(edited(), 1);
  const summaries = await store.recoveries();
  assert.equal(summaries.length, 30);
  assert.ok(summaries.some((snapshot) => snapshot.id === drawing.id));
  assert.equal(
    summaries.some((snapshot) => snapshot.id === "old-29"),
    false,
  );
  await assert.rejects(fs.access(path.join(directory, "old-29.json")));
  await assert.rejects(fs.access(path.join(directory, "old-29.meta.json")));
  assert.equal(await fs.readFile(unrelated, "utf8"), '{"purpose":"keep me"}');
  assert.equal(
    await fs.readFile(incomplete, "utf8"),
    "keep temporary evidence",
  );
  assert.equal(
    await fs.readFile(orphan, "utf8"),
    '{"purpose":"no matching body"}',
  );
});

test("removing a folder forgets descendant references while preserving the active drawing and disk files", async (t) => {
  const { root, store } = await fixture(t);
  const folder = path.join(root, "tracked"),
    child = path.join(folder, "nested"),
    neighbor = path.join(root, "tracked-neighbor");
  await fs.mkdir(child, { recursive: true });
  await fs.mkdir(neighbor);
  const files = [
    path.join(folder, "first.excalidraw"),
    path.join(child, "active.excalidraw"),
    path.join(neighbor, "outside.excalidraw"),
  ];
  for (const file of files)
    await fs.writeFile(file, JSON.stringify(blankScene()));
  await store.addFolder(folder);
  await store.open(files[2]);
  const active = await store.open(files[1]);
  await store.writeRecovery(edited(), 9);
  await store.removeFolder(folder);
  assert.equal(store.active?.id, active.drawing.id);
  assert.equal(store.active?.path, files[1]);
  assert.deepEqual(
    (await store.list()).map((drawing) => drawing.path).sort(),
    [files[1], files[2]].sort(),
  );
  assert.equal(store.settings.folders.length, 0);
  assert.equal((await store.recoveries())[0].id, active.drawing.id);
  for (const file of files) await fs.access(file);
  await store.save(edited());
  assert.equal(
    JSON.parse(await fs.readFile(files[1], "utf8")).elements.length,
    1,
  );
  const restarted = new FileStore(path.join(root, "data"));
  await restarted.init();
  assert.deepEqual(
    (await restarted.list()).map((drawing) => drawing.path).sort(),
    [files[1], files[2]].sort(),
  );
  await restarted.addFolder(folder);
  await restarted.addFolder(folder);
  assert.equal(
    (await restarted.list()).length,
    3,
    "re-adding must not duplicate retained canonical entries",
  );
});

test("removing a folder preserves references covered by another registered root and never purges arbitrary paths", async (t) => {
  const { root, store } = await fixture(t);
  const folder = path.join(root, "parent"),
    child = path.join(folder, "registered-child");
  await fs.mkdir(child, { recursive: true });
  const parentFile = path.join(folder, "parent.excalidraw"),
    childFile = path.join(child, "child.excalidraw");
  await fs.writeFile(parentFile, JSON.stringify(blankScene()));
  await fs.writeFile(childFile, JSON.stringify(blankScene()));
  await store.addFolder(folder);
  await store.addFolder(child);
  await store.removeFolder(root);
  assert.equal(
    (await store.list()).length,
    2,
    "an unregistered ancestor must not remove tracked entries",
  );
  await store.removeFolder(folder);
  assert.deepEqual(
    (await store.list()).map((drawing) => drawing.path),
    [childFile],
  );
  assert.deepEqual(store.settings.folders, [child]);
  await store.removeFolder(folder);
  assert.deepEqual(
    (await store.list()).map((drawing) => drawing.path),
    [childFile],
  );
  await fs.access(parentFile);
  await fs.access(childFile);
});
