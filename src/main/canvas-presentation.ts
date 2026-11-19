import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../shared/types.js";
import {
  PRESENTATION_PROTOCOL,
  PRESENTATION_CACHE_BYTES,
  PRESENTATION_CAPTURES_PER_BINDING,
  PRESENTATION_BINDINGS_PER_SCOPE,
  PRESENTATION_ASSET_TTL_MS,
  PRESENTATION_IDLE_TTL_MS,
  PRESENTATION_HARD_TTL_MS,
  PRESENTATION_MAX_PNG_BYTES,
  PRESENTATION_MAX_PIXELS,
  PRESENTATION_MAX_SIDE,
  presentationOpenRequestSchema,
  presentationReadArgsSchema,
  type PresentationObservation,
  type PresentationState,
  type PresentationCapture,
  type PresentationOpenResult,
  type PresentationHeadResult,
  type PresentationChunkResult,
} from "../shared/presentation.js";

type Binding = {
  id: string;
  scope: string;
  document: string;
  epoch: string;
  created: number;
  used: number;
  assets: string[];
  states: Map<string, number>;
};
type Asset = { metadata: PresentationCapture; bytes: Buffer; key: string };
type Host = { document: string; epoch: string; title: string; saving: boolean };
export type PresentationSource = {
  current(): Host | null;
  observe(document: string, epoch: string): Promise<PresentationObservation>;
  capture(
    document: string,
    epoch: string,
    revision: number,
  ): Promise<{
    document: string;
    epoch: string;
    revision: number;
    data: string;
    width: number;
    height: number;
  }>;
};
function invalid(message: string): never {
  throw new AppError("INVALID_ARGUMENT", message);
}

/** In-memory capability bindings. Call within the host's ordinary command queue. */
export class CanvasPresentation {
  private bindings = new Map<string, Binding>();
  private assets = new Map<string, Asset>();
  private inFlight = new Map<string, Promise<Asset>>();
  constructor(
    private source: PresentationSource,
    private now = () => Date.now(),
  ) {}
  private expiry(b: Binding) {
    return Math.min(
      b.used + PRESENTATION_IDLE_TTL_MS,
      b.created + PRESENTATION_HARD_TTL_MS,
    );
  }
  private prune() {
    const now = this.now();
    for (const [id, b] of this.bindings)
      if (this.expiry(b) <= now) this.bindings.delete(id);
    for (const [id, asset] of this.assets)
      if (asset.metadata.expiresAt <= now) this.assets.delete(id);
    const referenced = new Set(
      [...this.bindings.values()].flatMap((b) => b.assets),
    );
    for (const id of this.assets.keys())
      if (!referenced.has(id)) this.assets.delete(id);
  }
  private validate(b: Binding): Host {
    if (this.expiry(b) <= this.now() || this.bindings.get(b.id) !== b)
      throw new AppError(
        "PRESENTATION_EXPIRED",
        "This canvas view expired. Show the canvas again explicitly.",
      );
    const host = this.source.current();
    if (!host || host.document !== b.document)
      throw new AppError(
        "DOCUMENT_NOT_ACTIVE",
        "The bound drawing is no longer active. This view cannot follow another drawing.",
      );
    if (host.epoch !== b.epoch)
      throw new AppError(
        "STALE_EPOCH",
        "The drawing was reopened. Show the canvas again explicitly.",
      );
    return host;
  }
  private binding(scope: string, id: string) {
    const b = this.bindings.get(id);
    if (!b || b.scope !== scope)
      throw new AppError(
        "PRESENTATION_EXPIRED",
        "Unknown or expired canvas scope/view. Show the canvas again explicitly.",
      );
    this.validate(b);
    return b;
  }
  async open(input: unknown): Promise<PresentationOpenResult> {
    const parsed = presentationOpenRequestSchema.safeParse(input);
    if (!parsed.success)
      invalid("Invalid presentation-open request: " + parsed.error.message);
    this.prune();
    const r = parsed.data,
      now = this.now();
    const b: Binding = {
      id: randomUUID(),
      scope: r.args.scope,
      document: r.document,
      epoch: r.epoch,
      created: now,
      used: now,
      assets: [],
      states: new Map(),
    };
    const host = this.source.current();
    if (!host || host.document !== b.document)
      throw new AppError(
        "DOCUMENT_NOT_ACTIVE",
        "Show canvas requires the explicitly identified active drawing.",
      );
    if (host.epoch !== b.epoch)
      throw new AppError(
        "STALE_EPOCH",
        "The drawing was reopened. Inspect its current identity first.",
      );
    if (
      [...this.bindings.values()].filter((v) => v.scope === b.scope).length >=
      PRESENTATION_BINDINGS_PER_SCOPE
    )
      throw new AppError(
        "PRESENTATION_LIMIT",
        "This adapter already has eight canvas views. Wait for a view to expire.",
      );
    const observation = await this.source.observe(b.document, b.epoch);
    if (observation.document !== b.document || observation.epoch !== b.epoch)
      throw new AppError(
        "STALE_EPOCH",
        "Canvas identity changed during observation.",
      );
    // Admission follows the renderer's asynchronous reply.
    const current = this.source.current();
    if (
      !current ||
      current.document !== b.document ||
      current.epoch !== b.epoch
    )
      throw new AppError(
        "STALE_EPOCH",
        "Canvas identity changed during observation.",
      );
    if (
      [...this.bindings.values()].filter(
        (v) => v.scope === b.scope && this.expiry(v) > this.now(),
      ).length >= PRESENTATION_BINDINGS_PER_SCOPE
    )
      throw new AppError(
        "PRESENTATION_LIMIT",
        "This adapter already has eight canvas views. Wait for a view to expire.",
      );
    this.bindings.set(b.id, b);
    return {
      protocol: PRESENTATION_PROTOCOL,
      viewId: b.id,
      document: b.document,
      epoch: b.epoch,
      title: current.title,
      expiresAt: this.expiry(b),
    };
  }
  private retain(b: Binding, asset: Asset) {
    const id = asset.metadata.id;
    b.assets = [
      ...b.assets.filter((old) => old !== id && this.assets.has(old)),
      id,
    ].slice(-PRESENTATION_CAPTURES_PER_BINDING);
    this.assets.set(id, asset);
    this.prune();
    let bytes = [...this.assets.values()].reduce(
      (n, a) => n + a.bytes.length,
      0,
    );
    for (const [old, a] of this.assets) {
      if (bytes <= PRESENTATION_CACHE_BYTES) break;
      this.assets.delete(old);
      bytes -= a.bytes.length;
    }
  }
  async read(
    input: unknown,
  ): Promise<PresentationHeadResult | PresentationChunkResult> {
    const parsed = presentationReadArgsSchema.safeParse(input);
    if (!parsed.success)
      invalid("Invalid presentation-read arguments: " + parsed.error.message);
    const r = parsed.data,
      b = this.binding(r.scope, r.viewId);
    this.prune();
    if (r.mode === "chunk") {
      // Revalidate in the live renderer for every range, including old assets.
      const observed = await this.source.observe(b.document, b.epoch);
      if (observed.document !== b.document || observed.epoch !== b.epoch)
        throw new AppError(
          "STALE_EPOCH",
          "Canvas identity changed during chunk observation.",
        );
      this.validate(b);
      const asset = this.assets.get(r.captureId);
      if (
        !b.assets.includes(r.captureId) ||
        !asset ||
        asset.metadata.expiresAt <= this.now()
      )
        throw new AppError(
          "PRESENTATION_CAPTURE_EXPIRED",
          "This capture expired or was evicted. Refresh the canvas head.",
        );
      if (
        r.offset >= asset.bytes.length ||
        r.offset + r.byteCount > asset.bytes.length
      )
        invalid("Chunk range exceeds the immutable capture bytes.");
      const bytes = asset.bytes.subarray(r.offset, r.offset + r.byteCount);
      b.used = this.now();
      return {
        captureId: r.captureId,
        offset: r.offset,
        byteCount: bytes.length,
        totalBytes: asset.bytes.length,
        data: bytes.toString("base64"),
        sha256: asset.metadata.sha256,
        done: r.offset + bytes.length === asset.bytes.length,
      };
    }
    let observed = await this.source.observe(b.document, b.epoch);
    let host = this.validate(b);
    if (observed.document !== b.document || observed.epoch !== b.epoch)
      throw new AppError(
        "STALE_EPOCH",
        "Canvas identity changed during observation.",
      );
    const display = (): PresentationState => ({
      document: b.document,
      epoch: b.epoch,
      revision: observed.revision,
      dirty: observed.dirty,
      saving: host.saving,
      title: host.title,
      observedAt: this.now(),
    });
    const token = (state: PresentationState) =>
      createHash("sha256")
        .update(
          JSON.stringify({
            ...state,
            observedAt: undefined,
            busy: observed.busy,
            empty: observed.empty,
          }),
        )
        .digest("hex");
    const remember = (stateToken: string) => {
      b.states.set(stateToken, observed.revision);
      if (b.states.size > 16) b.states.delete(b.states.keys().next().value!);
      b.used = this.now();
    };
    const key = `${b.document}/${b.epoch}/${observed.revision}`;
    // Acknowledged client state is distinct from server-side cached bytes. A
    // failed chunk transfer must remain a frame response on retry, and expired
    // byte caches must not force re-encoding an unchanged displayed image.
    if (
      !observed.empty &&
      !observed.busy &&
      r.afterStateToken &&
      b.states.get(r.afterStateToken) === observed.revision
    ) {
      const state = display(),
        stateToken = token(state);
      const cached = [...this.assets.values()].find(
        (a) =>
          a.key === key &&
          b.assets.includes(a.metadata.id) &&
          a.metadata.expiresAt > this.now(),
      );
      remember(stateToken);
      return {
        kind: r.afterStateToken === stateToken ? "unchanged" : "status",
        state,
        stateToken,
        ...(cached ? { capture: cached.metadata } : {}),
      };
    }
    let asset: Asset | undefined;
    if (!observed.empty && !observed.busy) {
      asset = [...this.assets.values()].find(
        (a) => a.key === key && a.metadata.expiresAt > this.now(),
      );
      if (!asset) {
        let pending = this.inFlight.get(key);
        if (!pending) {
          pending = this.source
            .capture(b.document, b.epoch, observed.revision)
            .then((rendered) => {
              if (
                rendered.document !== b.document ||
                rendered.epoch !== b.epoch ||
                rendered.revision !== observed.revision
              )
                throw new AppError(
                  "STALE_REVISION",
                  "The drawing changed during capture. Refresh the canvas.",
                );
              const bytes = Buffer.from(rendered.data, "base64");
              if (
                bytes.length < 24 ||
                !bytes
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              )
                throw new AppError(
                  "PRESENTATION_INVALID_IMAGE",
                  "The renderer did not return a PNG.",
                );
              const width = bytes.readUInt32BE(16),
                height = bytes.readUInt32BE(20);
              if (
                width !== rendered.width ||
                height !== rendered.height ||
                !width ||
                !height ||
                width > PRESENTATION_MAX_SIDE ||
                height > PRESENTATION_MAX_SIDE ||
                width * height > PRESENTATION_MAX_PIXELS ||
                bytes.length > PRESENTATION_MAX_PNG_BYTES
              )
                throw new AppError(
                  "PRESENTATION_TOO_LARGE",
                  "The preview exceeds the image budget.",
                );
              return {
                key,
                bytes,
                metadata: {
                  id: randomUUID(),
                  mime: "image/png" as const,
                  byteLength: bytes.length,
                  width,
                  height,
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                  revision: rendered.revision,
                  expiresAt: this.now() + PRESENTATION_ASSET_TTL_MS,
                },
              };
            });
          this.inFlight.set(key, pending);
        }
        try {
          asset = await pending;
        } finally {
          if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
        }
        // A human can change the renderer while encoding. Never publish old pixels
        // as the current frame, even though they were captured immutably.
        const latest = await this.source.observe(b.document, b.epoch);
        host = this.validate(b);
        if (latest.document !== b.document || latest.epoch !== b.epoch)
          throw new AppError(
            "STALE_EPOCH",
            "Canvas identity changed during capture.",
          );
        if (latest.revision !== observed.revision || latest.busy)
          throw new AppError(
            "STALE_REVISION",
            "The drawing changed during capture. Refresh the canvas.",
          );
        observed = latest;
      }
      this.validate(b);
      this.retain(b, asset);
    }
    const state = display(),
      stateToken = token(state);
    const kind = observed.busy ? "busy" : observed.empty ? "empty" : "frame";
    if (asset) remember(stateToken);
    else b.used = this.now();
    return {
      kind,
      state,
      stateToken,
      ...(asset ? { capture: asset.metadata } : {}),
    };
  }
}
