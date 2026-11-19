import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileStore, pathSuggest } from '../src/main/files.js';
import { blankScene } from '../src/shared/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agent-excalidraw-files-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FileStore(path.join(root, 'data'), path.join(root, 'drawings'));
  await store.init();
  return { root, store };
}
const code = (expected: string) => (error: any) => error?.code === expected;
const edited = () => ({ ...blankScene(), elements: [{ id: 'first', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 }] });

test('new files allocate exclusively, suffix implicit collisions and preserve explicit files', async t => {
  const { store } = await fixture(t);
  const first = await store.create({ title: 'Untitled' });
  const second = await store.create({ title: 'Untitled' });
  assert.notEqual(first.drawing.path, second.drawing.path);
  assert.equal(path.basename(second.drawing.path), 'Untitled 2.excalidraw');
  assert.equal(JSON.parse(await fs.readFile(first.drawing.path, 'utf8')).elements.length, 0);
  await assert.rejects(store.create({ path: first.drawing.path }), code('FILE_EXISTS'));
  assert.equal(store.active?.id, second.drawing.id);
});

test('save, reopen and exact outside-change conflict preserve both versions', async t => {
  const { store } = await fixture(t);
  const { drawing } = await store.create({ title: 'My drawing' });
  await store.save(edited());
  const opened = await store.open(drawing.path);
  assert.equal(opened.drawing.id, drawing.id);
  assert.deepEqual(opened.scene.elements, edited().elements);
  const outside = { ...blankScene(), source: 'outside editor' };
  await fs.writeFile(drawing.path, JSON.stringify(outside));
  await assert.rejects(store.save(edited()), code('FILE_CONFLICT'));
  assert.deepEqual(JSON.parse(await fs.readFile(drawing.path, 'utf8')), outside);
  await fs.unlink(drawing.path);
  await assert.rejects(store.save(edited()), code('FILE_MISSING'));
});

test('save as rebinds only on success; duplicate leaves original active', async t => {
  const { root, store } = await fixture(t);
  const original = await store.create({ title: 'Original' });
  const duplicate = await store.duplicate(edited());
  assert.equal(store.active?.id, original.drawing.id);
  assert.deepEqual(JSON.parse(await fs.readFile(duplicate.path, 'utf8')).elements, edited().elements);
  await assert.rejects(store.saveAs(edited(), duplicate.path), code('FILE_EXISTS'));
  assert.equal(store.active?.id, original.drawing.id);
  const saved = await store.saveAs(edited(), path.join(root, 'other', 'Saved as'));
  assert.notEqual(saved.id, original.drawing.id);
  assert.equal(store.active?.path, saved.path);
  assert.equal(JSON.parse(await fs.readFile(original.drawing.path, 'utf8')).elements.length, 0);
});

test('move preserves identity and persisted bytes, never writes unsaved content implicitly', async t => {
  const { root, store } = await fixture(t);
  const original = await store.create({ title: 'Original' });
  const destination = path.join(root, 'moved', 'renamed.excalidraw');
  const moved = await store.move(destination);
  assert.equal(moved.id, original.drawing.id);
  assert.equal(moved.path, destination);
  await assert.rejects(fs.access(original.drawing.path));
  assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).elements.length, 0);
  await store.save(edited());
  assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).elements.length, 1);
  const existing = path.join(root, 'existing.excalidraw');
  await fs.writeFile(existing, 'keep');
  await assert.rejects(store.move(existing), code('FILE_EXISTS'));
  assert.equal(await fs.readFile(existing, 'utf8'), 'keep');
  assert.equal(store.active?.path, destination);
});

test('recovery is separate and restores a unique copy without modifying original', async t => {
  const { store } = await fixture(t);
  const original = await store.create({ title: 'Original' });
  await store.writeRecovery(edited(), 7);
  assert.equal(JSON.parse(await fs.readFile(original.drawing.path, 'utf8')).elements.length, 0);
  const [candidate] = await store.recoveries();
  assert.equal(candidate.id, original.drawing.id);
  assert.equal(candidate.path, original.drawing.path);
  const restored = await store.restoreRecovery(candidate.id);
  assert.notEqual(restored.drawing.id, original.drawing.id);
  assert.notEqual(restored.drawing.path, original.drawing.path);
  assert.equal(restored.scene.elements.length, 1);
  assert.equal(JSON.parse(await fs.readFile(original.drawing.path, 'utf8')).elements.length, 0);
  assert.equal((await store.recoveries()).length, 0);
  await assert.rejects(store.discardRecovery('../../escape'), code('INVALID_ARGUMENT'));
});

test('explicit discard and confirmed save remove their matching recovery', async t => {
  const { store } = await fixture(t);
  const { drawing } = await store.create();
  await store.writeRecovery(edited(), 1);
  await store.discardRecovery(drawing.id);
  assert.equal((await store.recoveries()).length, 0);
  await store.writeRecovery(edited(), 2);
  await store.save(edited());
  assert.equal((await store.recoveries()).length, 0);
});

test('corrupt and future content never activates or gets overwritten', async t => {
  const { root, store } = await fixture(t);
  const original = await store.create();
  const bad = path.join(root, 'bad.excalidraw');
  await fs.writeFile(bad, '{broken');
  await assert.rejects(store.open(bad), code('INVALID_SCENE'));
  assert.equal(store.active?.id, original.drawing.id);
  assert.equal(await fs.readFile(bad, 'utf8'), '{broken');
  const future = path.join(root, 'future.excalidraw');
  const content = JSON.stringify({ ...blankScene(), elements: [{ id: 'future', type: 'stickynote' }] });
  await fs.writeFile(future, content);
  await assert.rejects(store.open(future), code('UNSUPPORTED_FORMAT'));
  assert.equal(await fs.readFile(future, 'utf8'), content);
  await assert.rejects(store.save({ ...blankScene(), version: 999 }), code('UNSUPPORTED_FORMAT'));
});

test('failed writes retain old source and queued operations recover after failure', async t => {
  const { root, store } = await fixture(t);
  const { drawing } = await store.create();
  const collision = path.join(root, 'not-a-directory');
  await fs.writeFile(collision, 'x');
  await assert.rejects(store.saveAs(edited(), path.join(collision, 'broken.excalidraw')));
  assert.equal(store.active?.id, drawing.id);
  assert.equal(JSON.parse(await fs.readFile(drawing.path, 'utf8')).elements.length, 0);
  await store.save(edited());
  assert.equal(JSON.parse(await fs.readFile(drawing.path, 'utf8')).elements.length, 1);
});

test('registry survives restart; forget removes metadata only; star and settings persist', async t => {
  const { root, store } = await fixture(t);
  const { drawing } = await store.create({ title: 'Persisted' });
  await store.star(drawing.id, true);
  await store.setSettings({ theme: 'dark', autosave: true });
  const next = new FileStore(path.join(root, 'data')); await next.init();
  const [entry] = await next.list();
  assert.equal(entry.id, drawing.id); assert.equal(entry.starred, true);
  assert.equal(next.settings.theme, 'dark'); assert.equal(next.settings.autosave, true);
  await next.forget(drawing.id);
  assert.equal((await next.list()).length, 0);
  await fs.access(drawing.path);
});

test('folder indexing is bounded to explicit root and does not follow symlinks', async t => {
  const { root, store } = await fixture(t);
  const folder = path.join(root, 'scan'), outside = path.join(root, 'private');
  await fs.mkdir(folder); await fs.mkdir(outside);
  await fs.writeFile(path.join(folder, 'one.excalidraw'), JSON.stringify(blankScene()));
  await fs.writeFile(path.join(outside, 'secret.excalidraw'), JSON.stringify(blankScene()));
  if (process.platform !== 'win32') await fs.symlink(outside, path.join(folder, 'escape'));
  const entries = await store.addFolder(folder);
  assert.deepEqual(entries.map(d => d.title), ['one']);
  assert.equal(store.active, null);
  await store.removeFolder(folder);
  assert.equal(store.settings.folders.length, 0);
  await fs.access(path.join(folder, 'one.excalidraw'));
});

test('path suggestions sanitize names and namespace projects outside their repository', async t => {
  const { store, root } = await fixture(t);
  const target = store.pathSuggest('My / diagram', path.join(root, 'repo'));
  assert.equal(target, path.join(store.settings.defaultFolder, 'projects', 'repo', 'My - diagram.excalidraw'));
  assert.equal(path.basename(pathSuggest('CON', undefined, root)), '_CON.excalidraw');
});


test('external watcher status is read-only across outside changes, own save and missing source', async t => {
  const { store } = await fixture(t);
  assert.deepEqual(await store.externalStatus(), { changed: false, missing: false });
  const { drawing } = await store.create({ title: 'Watched' });
  assert.deepEqual(await store.externalStatus(), { changed: false, missing: false });
  await store.save(edited());
  assert.deepEqual(await store.externalStatus(), { changed: false, missing: false });
  const outside = { ...blankScene(), source: 'outside editor' };
  await fs.writeFile(drawing.path, JSON.stringify(outside));
  assert.deepEqual(await store.externalStatus(), { changed: true, missing: false });
  assert.deepEqual(await store.externalStatus(), { changed: true, missing: false });
  await assert.rejects(store.save(edited()), code('FILE_CONFLICT'));
  assert.deepEqual(JSON.parse(await fs.readFile(drawing.path, 'utf8')), outside);
  await store.open(drawing.path);
  assert.deepEqual(await store.externalStatus(), { changed: false, missing: false });
  await fs.unlink(drawing.path);
  assert.deepEqual(await store.externalStatus(), { changed: false, missing: true });
  await assert.rejects(store.save(edited()), code('FILE_MISSING'));
});
