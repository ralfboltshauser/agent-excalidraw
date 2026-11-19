import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { AppError } from "../src/shared/types";
import {
  CanvasPresentation,
  type PresentationSource,
} from "../src/main/canvas-presentation";
import {
  PRESENTATION_ASSET_TTL_MS,
  PRESENTATION_HARD_TTL_MS,
  PRESENTATION_IDLE_TTL_MS,
  PRESENTATION_MAX_PNG_BYTES,
  PRESENTATION_MAX_CHUNK_BYTES,
  presentationOpenRequestSchema,
  presentationReadRequestSchema,
  presentationHeadResultSchema,
  presentationChunkResultSchema,
  type PresentationHeadResult,
  type PresentationChunkResult,
} from "../src/shared/presentation";

// The source is the PNG encoder boundary; only its PNG header/size contract is
// exercised here. Real encoding and unsaved pixels belong to Electron coverage.
function png(length = 32, width = 1, height = 1) {
  const bytes = Buffer.alloc(length);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
function fixture() {
  let now = 1000,
    renders = 0;
  const host = {
    document: "drawing",
    epoch: "epoch",
    title: "Synthetic",
    saving: false,
  };
  const observed = {
    document: host.document,
    epoch: host.epoch,
    revision: 0,
    dirty: false,
    busy: false,
    empty: false,
  };
  let bytes: Buffer = png();
  let duringCapture: (() => Promise<void>) | undefined;
  const source: PresentationSource = {
    current: () => host,
    observe: async (document, epoch) => {
      if (document !== host.document)
        throw new AppError("DOCUMENT_NOT_ACTIVE", "Inactive synthetic drawing");
      if (epoch !== host.epoch)
        throw new AppError("STALE_EPOCH", "Old synthetic epoch");
      return { ...observed };
    },
    capture: async (document, epoch, revision) => {
      renders++;
      const data = bytes.toString("base64");
      if (duringCapture) await duringCapture();
      return {
        document,
        epoch,
        revision,
        data,
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      };
    },
  };
  const presentation = new CanvasPresentation(source, () => now);
  const scope = randomUUID();
  const open = (scopeId = scope) =>
    presentation.open({
      command: "presentation-open",
      document: host.document,
      epoch: host.epoch,
      args: { scope: scopeId },
    });
  const head = (viewId: string, afterStateToken?: string, scopeId = scope) =>
    presentation.read({
      scope: scopeId,
      viewId,
      mode: "head",
      ...(afterStateToken ? { afterStateToken } : {}),
    }) as Promise<PresentationHeadResult>;
  return {
    presentation,
    source,
    host,
    observed,
    scope,
    open,
    head,
    renders: () => renders,
    advance: (ms: number) => {
      now += ms;
    },
    bytes: (value: Buffer) => {
      bytes = value;
    },
    during: (value: () => Promise<void>) => {
      duringCapture = value;
    },
  };
}
const code = (expected: string) => (error: any) => error.code === expected;

test("strict private requests reject UI/path options and unsafe chunks", () => {
  const scope = randomUUID(),
    viewId = randomUUID();
  assert.equal(
    presentationOpenRequestSchema.safeParse({
      command: "presentation-open",
      document: "d",
      epoch: "e",
      args: { scope, output: "/tmp/a.png" },
    }).success,
    false,
  );
  for (const args of [
    { scope: "historical", viewId, mode: "head" },
    { scope, viewId, mode: "head", path: "/tmp/x" },
    {
      scope,
      viewId,
      mode: "chunk",
      captureId: randomUUID(),
      offset: -1,
      byteCount: 1,
    },
    {
      scope,
      viewId,
      mode: "chunk",
      captureId: randomUUID(),
      offset: 0,
      byteCount: PRESENTATION_MAX_CHUNK_BYTES + 1,
    },
  ])
    assert.equal(
      presentationReadRequestSchema.safeParse({
        command: "presentation-read",
        args,
      }).success,
      false,
    );
});

test("renderer state and immutable chunks use one hash and exact decoded ranges", async () => {
  const f = fixture(),
    b = await f.open(),
    h = await f.head(b.viewId);
  assert.equal(h.kind, "frame");
  presentationHeadResultSchema.parse(h);
  const capture = h.capture!;
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < capture.byteLength; offset += 7) {
    const c = (await f.presentation.read({
      scope: f.scope,
      viewId: b.viewId,
      mode: "chunk",
      captureId: capture.id,
      offset,
      byteCount: Math.min(7, capture.byteLength - offset),
    })) as PresentationChunkResult;
    presentationChunkResultSchema.parse(c);
    assert.equal(c.offset, offset);
    assert.equal(c.totalBytes, capture.byteLength);
    assert.equal(c.sha256, capture.sha256);
    assert.equal(c.done, offset + c.byteCount === capture.byteLength);
    chunks.push(Buffer.from(c.data, "base64"));
  }
  assert.equal(
    createHash("sha256").update(Buffer.concat(chunks)).digest("hex"),
    capture.sha256,
  );
  assert.equal(f.renders(), 1);
  await assert.rejects(
    f.presentation.read({
      scope: f.scope,
      viewId: b.viewId,
      mode: "chunk",
      captureId: capture.id,
      offset: capture.byteLength - 1,
      byteCount: 2,
    }),
    code("INVALID_ARGUMENT"),
  );
});

test("unchanged polling and save-only state reuse pixels; observation time is not a state change", async () => {
  const f = fixture();
  f.observed.dirty = true;
  const b = await f.open(),
    first = await f.head(b.viewId);
  f.advance(100);
  const unchanged = await f.head(b.viewId, first.stateToken);
  assert.equal(unchanged.kind, "unchanged");
  assert.ok(unchanged.state.observedAt > first.state.observedAt);
  f.host.saving = true;
  const saving = await f.head(b.viewId, first.stateToken);
  assert.equal(saving.kind, "status");
  assert.equal(saving.state.saving, true);
  f.host.saving = false;
  f.observed.dirty = false;
  const saved = await f.head(b.viewId, saving.stateToken);
  assert.equal(saved.kind, "status");
  assert.equal(saved.state.dirty, false);
  assert.equal(saved.capture!.id, first.capture!.id);
  assert.equal(f.renders(), 1);
});

test("empty and busy observations never request PNG encoding", async () => {
  const f = fixture(),
    b = await f.open();
  f.observed.empty = true;
  assert.equal((await f.head(b.viewId)).kind, "empty");
  f.observed.empty = false;
  f.observed.busy = true;
  assert.equal((await f.head(b.viewId)).kind, "busy");
  assert.equal(f.renders(), 0);
});

test("scope is a capability and old identity never follows active drawing", async () => {
  const f = fixture(),
    b = await f.open(),
    h = await f.head(b.viewId);
  await assert.rejects(
    f.head(b.viewId, undefined, randomUUID()),
    code("PRESENTATION_EXPIRED"),
  );
  f.host.document = "private-other";
  await assert.rejects(f.head(b.viewId), code("DOCUMENT_NOT_ACTIVE"));
  await assert.rejects(
    f.presentation.read({
      scope: f.scope,
      viewId: b.viewId,
      mode: "chunk",
      captureId: h.capture!.id,
      offset: 0,
      byteCount: 1,
    }),
    code("DOCUMENT_NOT_ACTIVE"),
  );
  f.host.document = "drawing";
  f.host.epoch = "reopened";
  await assert.rejects(f.head(b.viewId), code("STALE_EPOCH"));
});

test("bindings expire idle and hard despite repeated activity; scopes have eight slots", async () => {
  const f = fixture();
  const views = await Promise.all(Array.from({ length: 8 }, () => f.open()));
  await assert.rejects(f.open(), code("PRESENTATION_LIMIT"));
  f.advance(PRESENTATION_IDLE_TTL_MS);
  await assert.rejects(f.head(views[0].viewId), code("PRESENTATION_EXPIRED"));
  const b = await f.open();
  f.observed.empty = true;
  for (
    let elapsed = 0;
    elapsed < PRESENTATION_HARD_TTL_MS - 60_000;
    elapsed += 60_000
  ) {
    f.advance(60_000);
    await f.head(b.viewId);
  }
  f.advance(60_000);
  await assert.rejects(f.head(b.viewId), code("PRESENTATION_EXPIRED"));
});

test("assets expire after sixty seconds and only two revisions stay downloadable", async () => {
  const f = fixture(),
    b = await f.open(),
    first = await f.head(b.viewId);
  f.observed.revision++;
  const second = await f.head(b.viewId);
  assert.equal(second.kind, "frame");
  f.observed.revision++;
  await f.head(b.viewId);
  const chunk = (captureId: string) =>
    f.presentation.read({
      scope: f.scope,
      viewId: b.viewId,
      mode: "chunk",
      captureId,
      offset: 0,
      byteCount: 1,
    });
  await assert.rejects(
    chunk(first.capture!.id),
    code("PRESENTATION_CAPTURE_EXPIRED"),
  );
  await chunk(second.capture!.id);
  f.advance(PRESENTATION_ASSET_TTL_MS);
  await assert.rejects(
    chunk(second.capture!.id),
    code("PRESENTATION_CAPTURE_EXPIRED"),
  );
  const refreshed = await f.head(b.viewId);
  assert.equal(refreshed.kind, "frame");
  assert.equal(f.renders(), 4);
});

test("capture identity is bound to each view, while simultaneous same-revision reads coalesce", async () => {
  const f = fixture(),
    a = await f.open(),
    b = await f.open();
  let release!: () => void;
  f.during(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const reads = [f.head(a.viewId), f.head(b.viewId)];
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [x, y] = await Promise.all(reads);
  assert.equal(f.renders(), 1);
  assert.equal(x.capture!.id, y.capture!.id);
  f.observed.revision++;
  // A third unopened view cannot download another view's known capture ID.
  const c = await f.open();
  await assert.rejects(
    f.presentation.read({
      scope: f.scope,
      viewId: c.viewId,
      mode: "chunk",
      captureId: x.capture!.id,
      offset: 0,
      byteCount: 1,
    }),
    code("PRESENTATION_CAPTURE_EXPIRED"),
  );
});

test("changes and switches during asynchronous encoding refuse publication", async () => {
  for (const change of ["revision", "epoch", "expiry"] as const) {
    const f = fixture(),
      b = await f.open();
    f.during(async () => {
      if (change === "revision") f.observed.revision++;
      if (change === "epoch") f.host.epoch = "new-epoch";
      if (change === "expiry") f.advance(PRESENTATION_IDLE_TTL_MS);
    });
    await assert.rejects(
      f.head(b.viewId),
      code(
        change === "epoch"
          ? "STALE_EPOCH"
          : change === "revision"
            ? "STALE_REVISION"
            : "PRESENTATION_EXPIRED",
      ),
    );
  }
});

test("reject oversize bytes, excessive dimensions and inconsistent image receipts", async () => {
  for (const bytes of [
    png(PRESENTATION_MAX_PNG_BYTES + 1),
    png(32, 1601, 1),
    png(32, 1, 0),
  ]) {
    const f = fixture(),
      b = await f.open();
    f.bytes(bytes);
    await assert.rejects(f.head(b.viewId), code("PRESENTATION_TOO_LARGE"));
  }
});

test("global cache evicts oldest immutable bytes at 32 MiB", async () => {
  const f = fixture();
  f.bytes(png(PRESENTATION_MAX_PNG_BYTES));
  const b = await f.open(),
    first = await f.head(b.viewId);
  // Keep one asset in each view so eviction cannot be explained by the
  // two-captures-per-view cap. The ninth view belongs to a second adapter scope.
  for (let i = 1; i <= 8; i++) {
    f.observed.revision++;
    const scope = i === 8 ? randomUUID() : f.scope;
    const next = await f.open(scope);
    await f.head(next.viewId, undefined, scope);
  }
  await assert.rejects(
    f.presentation.read({
      scope: f.scope,
      viewId: b.viewId,
      mode: "chunk",
      captureId: first.capture!.id,
      offset: 0,
      byteCount: 1,
    }),
    code("PRESENTATION_CAPTURE_EXPIRED"),
  );
});

test("lost frame transfers retry as frames and unchanged clients never re-encode expired cached bytes", async () => {
  const f = fixture(),
    b = await f.open(),
    first = await f.head(b.viewId);
  const lostFirst = await f.head(b.viewId);
  assert.equal(lostFirst.kind, "frame");
  assert.equal(lostFirst.capture!.id, first.capture!.id);
  f.observed.revision++;
  const second = await f.head(b.viewId, first.stateToken);
  assert.equal(second.kind, "frame");
  const retry = await f.head(b.viewId, first.stateToken);
  assert.equal(retry.kind, "frame");
  assert.equal(retry.capture!.id, second.capture!.id);
  f.advance(PRESENTATION_ASSET_TTL_MS + 1);
  const unchanged = await f.head(b.viewId, second.stateToken);
  assert.equal(unchanged.kind, "unchanged");
  assert.equal(f.renders(), 2);
  f.observed.dirty = true;
  const status = await f.head(b.viewId, second.stateToken);
  assert.equal(status.kind, "status");
  assert.equal(f.renders(), 2);
  const explicit = await f.head(b.viewId);
  assert.equal(explicit.kind, "frame");
  assert.equal(f.renders(), 3);
});
