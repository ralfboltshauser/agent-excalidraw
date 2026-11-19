import {
  parseBinding,
  parseHead,
  readFrame,
  unwrap,
  ViewerError,
  type Binding,
  type CanvasState,
  type Capture,
  type ReadTool,
} from "./protocol";

export interface ViewerSnapshot {
  binding?: Binding;
  state?: CanvasState;
  phase: "waiting" | "loading" | "live" | "busy" | "empty" | "paused" | "stale";
  message: string;
  hasFrame: boolean;
  paused: boolean;
  terminal: boolean;
}
export interface ViewerSink {
  update(snapshot: ViewerSnapshot): void;
  // Decode a candidate without replacing visible pixels. Commit is synchronous.
  prepare(
    bytes: Uint8Array<ArrayBuffer>,
    capture: Capture,
  ): Promise<{ commit(): void; discard(): void }>;
  clear(): void;
}
const TERMINAL =
  /(?:PRESENTATION_EXPIRED|BINDING.*(?:EXPIRED|INVALID|NOT_FOUND)|(?:STALE|EXPIRED|INVALID).*BINDING|VIEW.*(?:EXPIRED|INVALID|NOT_FOUND)|DOCUMENT.*(?:INACTIVE|NOT_ACTIVE|CLOSED|MISMATCH|NOT_FOUND)|EPOCH|ADAPTER|APP_NOT_RUNNING|DISCONNECTED|INCOMPATIBLE)/i;
export class ViewerSession {
  private binding?: Binding;
  private state?: CanvasState;
  private token?: string;
  private frameRevision?: number;
  private empty = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight = false;
  private pending = false;
  private pendingManual = false;
  private active = true;
  private stopped = false;
  private terminal = false;
  private failures = 0;
  private phase: ViewerSnapshot["phase"] = "waiting";
  private message = "Waiting for a drawing…";
  private hasFrame = false;
  private paused = false;
  constructor(
    private read: ReadTool,
    private sink: ViewerSink,
    private interval = 2000,
  ) {
    this.emit();
  }
  private emit() {
    this.sink.update({
      binding: this.binding,
      state: this.state,
      phase: this.phase,
      message: this.message,
      hasFrame: this.hasFrame,
      paused: this.paused,
      terminal: this.terminal,
    });
  }
  bind(value: unknown) {
    if (this.stopped) return;
    try {
      const binding = parseBinding(value);
      // Replayed tool results must never revive an invalidated historical card.
      if (this.binding?.viewId === binding.viewId) return;
      this.invalidate();
      this.binding = binding;
      this.token = undefined;
      this.state = undefined;
      this.frameRevision = undefined;
      this.empty = false;
      this.terminal = false;
      this.failures = 0;
      this.hasFrame = false;
      this.sink.clear();
      this.phase = "loading";
      this.message = "Loading preview…";
      this.emit();
      this.refresh();
    } catch {
      this.disconnect(
        "This canvas card is incompatible. Ask the agent to show the drawing again.",
      );
    }
  }
  private invalidate() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
    this.pendingManual = false;
  }
  private allowed(manual = false) {
    return (
      !this.stopped &&
      !this.terminal &&
      !!this.binding &&
      (manual || !this.paused) &&
      this.active
    );
  }
  setActive(active: boolean) {
    if (this.active === active || this.stopped) return;
    this.active = active;
    this.invalidate();
    if (!this.terminal) {
      this.phase = "paused";
      this.message = active
        ? "Resuming preview…"
        : "Updates paused while this preview is hidden.";
      this.emit();
    }
    if (active) this.refresh();
  }
  togglePause() {
    if (this.stopped || this.terminal) return;
    this.paused = !this.paused;
    this.invalidate();
    this.phase = "paused";
    this.message = this.paused
      ? "Updates paused. The last preview is kept below."
      : "Resuming preview…";
    this.emit();
    if (!this.paused) this.refresh();
  }
  refresh(manual = false) {
    if (!this.allowed(manual)) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.inFlight) {
      this.pending = true;
      this.pendingManual ||= manual;
      return;
    }
    void this.poll(manual);
  }
  disconnect(
    message = "Connection lost. Ask the agent to show this drawing again.",
  ) {
    if (this.stopped) return;
    this.invalidate();
    this.terminal = true;
    this.phase = "stale";
    this.message = message;
    this.emit();
  }
  stop() {
    if (this.stopped) return;
    this.invalidate();
    this.stopped = true;
    this.sink.clear();
  }
  private async poll(manual = false) {
    if (!this.allowed(manual) || this.inFlight) return;
    const binding = this.binding!,
      generation = this.generation;
    const current = () =>
      generation === this.generation && this.allowed(manual);
    this.inFlight = true;
    try {
      const head = parseHead(
        unwrap(
          await this.read({
            mode: "head",
            viewId: binding.viewId,
            ...(this.token ? { afterStateToken: this.token } : {}),
          }),
        ),
        binding,
      );
      if (!current()) return;
      if (this.state && head.state.revision < this.state.revision)
        throw new ViewerError(
          "INVALID_REPLY",
          "An older preview was refused. Refresh to try again.",
        );
      if (head.kind === "frame") {
        const bytes = await readFrame(
          this.read,
          binding,
          head.capture!,
          current,
        );
        if (!current()) return;
        const candidate = await this.sink.prepare(bytes, head.capture!);
        if (!current()) {
          candidate.discard();
          return;
        }
        candidate.commit();
        this.hasFrame = true;
        this.empty = false;
        this.frameRevision = head.capture!.revision;
      } else if (head.kind === "empty") {
        this.sink.clear();
        this.hasFrame = false;
        this.empty = true;
        this.frameRevision = head.state.revision;
      } else if (
        head.kind !== "busy" &&
        ((!this.hasFrame && !this.empty) ||
          head.state.revision !== this.frameRevision)
      ) {
        // A status token may only refer to pixels already held by this view.
        this.token = undefined;
        throw new ViewerError(
          "INVALID_REPLY",
          "A fresh preview is needed. Refresh to try again.",
        );
      }
      this.state = head.state;
      // Busy can report a newer revision without delivering its pixels.
      if (head.kind !== "busy") this.token = head.stateToken;
      this.phase = this.paused
        ? "paused"
        : head.kind === "busy"
          ? "busy"
          : this.empty
            ? "empty"
            : "live";
      this.message = this.paused
        ? "Updates paused. Refreshed once; automatic updates remain paused."
        : head.kind === "busy"
          ? "Editing… Waiting for a stable preview."
          : this.empty
            ? "This drawing is empty. Add something in the desktop app."
            : "Read-only preview · Edit in the desktop app";
      this.failures = 0;
      this.emit();
    } catch (error) {
      if (!current()) return;
      const e =
        error instanceof ViewerError
          ? error
          : new ViewerError(
              "READ_FAILED",
              "The preview is unavailable. Refresh to try again.",
            );
      this.failures++;
      this.phase = "stale";
      this.message = !TERMINAL.test(e.code)
        ? e.message
        : /INCOMPATIBLE/i.test(e.code)
          ? "The desktop app and preview are incompatible. Update the app, then ask the agent to show the drawing again."
          : /DOCUMENT.*(?:NOT_ACTIVE|INACTIVE|CLOSED|MISMATCH)/i.test(e.code)
            ? "This drawing is no longer active. This preview will not follow another drawing."
            : /EPOCH/i.test(e.code)
              ? "This drawing was reopened. Ask the agent to show the new drawing session."
              : /EXPIRED/i.test(e.code)
                ? "This drawing session is no longer available: the canvas card expired. Ask the agent to show it again."
                : "This drawing session is no longer available. Ask the agent to show it again.";
      if (TERMINAL.test(e.code)) this.terminal = true;
      this.emit();
    } finally {
      this.inFlight = false;
      if (this.pending && this.allowed(this.pendingManual)) {
        const pendingManual = this.pendingManual;
        this.pending = false;
        this.pendingManual = false;
        this.refresh(pendingManual);
      } else if (this.allowed()) {
        this.timer = setTimeout(
          () => this.refresh(),
          Math.min(30_000, this.interval * 2 ** Math.min(this.failures, 4)),
        );
      }
    }
  }
}
