// Local wire contracts keep the static viewer independent of desktop/CLI modules.
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_PIXELS = 4_000_000;
export const CHUNK_BYTES = 65_536;
export type Timestamp = number | string;
export interface Binding {
  protocol: 1;
  viewId: string;
  document: string;
  epoch: string;
  title: string;
  expiresAt: Timestamp;
}
export interface CanvasState {
  document: string;
  epoch: string;
  revision: number;
  dirty: boolean;
  saving: boolean;
  title: string;
  observedAt: Timestamp;
}
export interface Capture {
  id: string;
  mime: "image/png";
  byteLength: number;
  width: number;
  height: number;
  sha256: string;
  revision: number;
  expiresAt: Timestamp;
}
export interface Head {
  kind: "frame" | "status" | "unchanged" | "empty" | "busy";
  state: CanvasState;
  stateToken: string;
  capture?: Capture;
}
export type ReadRequest =
  | { mode: "head"; viewId: string; afterStateToken?: string }
  | {
      mode: "chunk";
      viewId: string;
      captureId: string;
      offset: number;
      byteCount: number;
    };
export type ReadTool = (request: ReadRequest) => Promise<unknown>;
export class ViewerError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ViewerError(
      "INVALID_REPLY",
      "The preview response was invalid. Refresh to try again.",
    );
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
  );
}
function timestamp(value: unknown): value is Timestamp {
  return typeof value === "number"
    ? Number.isFinite(value) && value >= 0
    : string(value, 100) && Number.isFinite(Date.parse(value));
}
export function milliseconds(value: Timestamp): number {
  return typeof value === "number" ? value : Date.parse(value);
}
function invalid(): never {
  throw new ViewerError(
    "INVALID_REPLY",
    "The preview response was invalid. Refresh to try again.",
  );
}
export function parseBinding(value: unknown): Binding {
  const b = record(value);
  if (
    b.protocol !== 1 ||
    !string(b.viewId) ||
    !string(b.document) ||
    !string(b.epoch) ||
    typeof b.title !== "string" ||
    b.title.length > 4096 ||
    !timestamp(b.expiresAt)
  )
    invalid();
  return {
    protocol: 1,
    viewId: b.viewId,
    document: b.document,
    epoch: b.epoch,
    title: b.title,
    expiresAt: b.expiresAt,
  };
}
export function unwrap(value: unknown): unknown {
  const tool = record(value),
    reply = record(tool.structuredContent);
  if (tool.isError === true && reply.ok !== false)
    throw new ViewerError(
      "READ_FAILED",
      "The drawing could not be read. Refresh to try again.",
    );
  if (reply.ok === false) {
    const error = record(reply.error);
    if (!string(error.code, 100) || !string(error.message)) invalid();
    // Never surface transport messages, which can contain native paths or payloads.
    const code = error.code;
    const message = /TOO_LARGE|OVERSIZE/i.test(code)
      ? "This drawing is too large for an embedded preview. View it in the desktop app."
      : /CAPTURE.*(?:EXPIRED|NOT_FOUND|EVICTED)/i.test(code)
        ? "The preview expired during transfer. Refresh to try again."
        : /PERMISSION|DENIED|FORBIDDEN/i.test(code)
          ? "The host did not allow this preview read. Refresh to try again."
          : /INVALID_IMAGE/i.test(code)
            ? "The drawing preview could not be decoded. Refresh to try again."
            : /STALE_REVISION/i.test(code)
              ? "The drawing changed during capture. Waiting for a fresh preview."
              : "The drawing could not be read. Refresh to try again.";
    throw new ViewerError(code, message);
  }
  if (reply.ok !== true) invalid();
  return reply.result;
}
export function parseHead(value: unknown, binding: Binding): Head {
  const h = record(value),
    s = record(h.state);
  if (s.document !== binding.document || s.epoch !== binding.epoch)
    throw new ViewerError(
      "STALE_BINDING",
      "This preview belongs to a different drawing session.",
    );
  if (
    !["frame", "status", "unchanged", "empty", "busy"].includes(
      String(h.kind),
    ) ||
    !string(h.stateToken) ||
    !integer(s.revision, 0, Number.MAX_SAFE_INTEGER) ||
    typeof s.dirty !== "boolean" ||
    typeof s.saving !== "boolean" ||
    typeof s.title !== "string" ||
    s.title.length > 4096 ||
    !timestamp(s.observedAt)
  )
    invalid();
  const state: CanvasState = {
    document: binding.document,
    epoch: binding.epoch,
    revision: s.revision,
    dirty: s.dirty,
    saving: s.saving,
    title: s.title,
    observedAt: s.observedAt,
  };
  let capture: Capture | undefined;
  if (h.kind === "frame") {
    const c = record(h.capture);
    if (
      !integer(c.byteLength, 1, MAX_BYTES) ||
      !integer(c.width, 1, MAX_PIXELS) ||
      !integer(c.height, 1, MAX_PIXELS) ||
      c.width * c.height > MAX_PIXELS
    )
      throw new ViewerError(
        "PREVIEW_TOO_LARGE",
        "This drawing is too large for an embedded preview. View it in the desktop app.",
      );
    if (
      !string(c.id) ||
      c.mime !== "image/png" ||
      !string(c.sha256, 64) ||
      !/^[a-f0-9]{64}$/i.test(c.sha256) ||
      c.revision !== state.revision ||
      !timestamp(c.expiresAt)
    )
      invalid();
    capture = {
      id: c.id,
      mime: "image/png",
      byteLength: c.byteLength,
      width: c.width,
      height: c.height,
      sha256: c.sha256.toLowerCase(),
      revision: state.revision,
      expiresAt: c.expiresAt,
    };
  }
  return {
    kind: h.kind as Head["kind"],
    state,
    stateToken: h.stateToken,
    capture,
  };
}
export async function readFrame(
  read: ReadTool,
  binding: Binding,
  capture: Capture,
  current: () => boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(capture.byteLength);
  for (let offset = 0; offset < bytes.length; ) {
    if (!current()) throw new ViewerError("CANCELLED", "Preview paused.");
    if (milliseconds(capture.expiresAt) <= Date.now())
      throw new ViewerError(
        "CAPTURE_EXPIRED",
        "The preview expired during transfer. Refresh to try again.",
      );
    const count = Math.min(CHUNK_BYTES, bytes.length - offset);
    const c = record(
      unwrap(
        await read({
          mode: "chunk",
          viewId: binding.viewId,
          captureId: capture.id,
          offset,
          byteCount: count,
        }),
      ),
    );
    if (!current()) throw new ViewerError("CANCELLED", "Preview paused.");
    if (
      c.captureId !== capture.id ||
      c.offset !== offset ||
      c.byteCount !== count ||
      c.totalBytes !== bytes.length ||
      typeof c.sha256 !== "string" ||
      c.sha256.toLowerCase() !== capture.sha256 ||
      c.done !== (offset + count === bytes.length) ||
      typeof c.data !== "string" ||
      c.data.length !== 4 * Math.ceil(count / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        c.data,
      )
    )
      invalid();
    let decoded: string;
    try {
      decoded = atob(c.data);
    } catch {
      invalid();
    }
    if (decoded.length !== count) invalid();
    for (let i = 0; i < count; i++) bytes[offset + i] = decoded.charCodeAt(i);
    offset += count;
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((v, i) => bytes[i] !== v)) invalid();
  const header = new DataView(bytes.buffer);
  if (
    header.getUint32(8) !== 13 ||
    header.getUint32(12) !== 0x49484452 ||
    header.getUint32(16) !== capture.width ||
    header.getUint32(20) !== capture.height
  )
    invalid();
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if (
    Array.from(hash, (v) => v.toString(16).padStart(2, "0")).join("") !==
    capture.sha256
  )
    invalid();
  if (!current()) throw new ViewerError("CANCELLED", "Preview paused.");
  return bytes;
}
