import type { Capture } from "./protocol";
import type { ViewerSink, ViewerSnapshot } from "./session";

const icons = {
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
};
function icon(name: keyof typeof icons) {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function button(
  action: string,
  label: string,
  name: keyof typeof icons,
  text = "",
) {
  return `<button type="button" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}${text ? `<span>${text}</span>` : ""}</button>`;
}

export class CanvasView implements ViewerSink {
  private title: HTMLElement;
  private status: HTMLElement;
  private notice: HTMLElement;
  private empty: HTMLElement;
  private viewport: HTMLElement;
  private image?: HTMLImageElement;
  private url?: string;
  private candidates = new Set<string>();
  private zoom = 1;
  private x = 0;
  private y = 0;
  private fitted = true;
  private size?: { width: number; height: number };
  private abort = new AbortController();
  private resize: ResizeObserver;
  constructor(
    private root: HTMLElement,
    actions: { refresh(): void; pause(): void; fullscreen(): void },
  ) {
    // Only this fixed template enters innerHTML. All binding/state strings use textContent.
    root.innerHTML = `<section class="canvas-viewer" aria-label="Drawing preview">
      <header class="viewer-header"><div class="viewer-heading"><h1>Drawing</h1><p class="viewer-status" role="status" aria-live="polite" aria-atomic="true">Waiting for a drawing…</p></div>
      <div class="viewer-actions">${button("refresh", "Refresh preview", "refresh")}${button("pause", "Pause updates", "pause")}${button("fullscreen", "Enter fullscreen", "expand")}</div></header>
      <div class="viewer-viewport" role="region" aria-label="Drawing canvas. Drag to pan. Use plus and minus to zoom, F to fit, and arrow keys to pan." tabindex="0">
        <div class="viewer-empty"><span class="empty-mark" aria-hidden="true">◇</span><strong>Drawing preview</strong><p>Waiting for the agent to show a drawing.</p></div>
        <span class="viewer-stale" hidden>Last preview</span>
      </div>
      <footer class="viewer-footer"><p class="viewer-notice">Read-only preview</p><div class="viewer-zoom" role="group" aria-label="Canvas zoom">${button("out", "Zoom out (−)", "minus")}<output aria-label="Zoom level">100%</output>${button("in", "Zoom in (+)", "plus")}${button("fit", "Fit drawing (F)", "fit", "Fit")}</div></footer>
    </section>`;
    this.title = root.querySelector("h1")!;
    this.status = root.querySelector(".viewer-status")!;
    this.notice = root.querySelector(".viewer-notice")!;
    this.empty = root.querySelector(".viewer-empty")!;
    this.viewport = root.querySelector(".viewer-viewport")!;
    root.querySelector<HTMLButtonElement>(
      '[data-action="fullscreen"]',
    )!.hidden = true;
    const signal = this.abort.signal;
    root
      .querySelector('[data-action="refresh"]')!
      .addEventListener("click", actions.refresh, { signal });
    root
      .querySelector('[data-action="pause"]')!
      .addEventListener("click", actions.pause, { signal });
    root
      .querySelector('[data-action="fullscreen"]')!
      .addEventListener("click", actions.fullscreen, { signal });
    root
      .querySelector('[data-action="in"]')!
      .addEventListener("click", () => this.scale(1.25), { signal });
    root
      .querySelector('[data-action="out"]')!
      .addEventListener("click", () => this.scale(0.8), { signal });
    root
      .querySelector('[data-action="fit"]')!
      .addEventListener("click", () => this.fit(), { signal });
    this.viewport.addEventListener(
      "keydown",
      (event) => {
        if (event.altKey || event.metaKey || event.ctrlKey || !this.image)
          return;
        if (event.key === "+" || event.key === "=") this.scale(1.25);
        else if (event.key === "-") this.scale(0.8);
        else if (["f", "F", "0"].includes(event.key)) this.fit();
        else if (event.key.startsWith("Arrow")) {
          const steps: Record<string, [number, number]> = {
            ArrowLeft: [40, 0],
            ArrowRight: [-40, 0],
            ArrowUp: [0, 40],
            ArrowDown: [0, -40],
          };
          const step = steps[event.key];
          if (!step) return;
          this.x += step[0];
          this.y += step[1];
          this.fitted = false;
          this.transform();
        } else return;
        event.preventDefault();
      },
      { signal },
    );
    this.viewport.addEventListener(
      "wheel",
      (event) => {
        if (!this.image) return;
        event.preventDefault();
        const rect = this.viewport.getBoundingClientRect();
        this.scale(
          Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.005),
          event.clientX - rect.left - rect.width / 2,
          event.clientY - rect.top - rect.height / 2,
        );
      },
      { passive: false, signal },
    );
    const pointers = new Map<number, { x: number; y: number }>();
    const geometry = () => {
      const p = [...pointers.values()];
      return {
        x: p.reduce((sum, v) => sum + v.x, 0) / p.length,
        y: p.reduce((sum, v) => sum + v.y, 0) / p.length,
        distance:
          p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0,
      };
    };
    this.viewport.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.image || event.button !== 0) return;
        this.viewport.focus({ preventScroll: true });
        this.viewport.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.viewport.classList.add("dragging");
      },
      { signal },
    );
    this.viewport.addEventListener(
      "pointermove",
      (event) => {
        if (!pointers.has(event.pointerId)) return;
        const before = geometry();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = geometry();
        this.x += after.x - before.x;
        this.y += after.y - before.y;
        if (before.distance > 0 && after.distance > 0) {
          const rect = this.viewport.getBoundingClientRect();
          this.scale(
            after.distance / before.distance,
            after.x - rect.left - rect.width / 2,
            after.y - rect.top - rect.height / 2,
          );
        }
        this.fitted = false;
        this.transform();
      },
      { signal },
    );
    const release = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) this.viewport.classList.remove("dragging");
    };
    this.viewport.addEventListener("pointerup", release, { signal });
    this.viewport.addEventListener("pointercancel", release, { signal });
    this.viewport.addEventListener("lostpointercapture", release, { signal });
    this.resize = new ResizeObserver(() => {
      if (this.fitted) this.fit();
    });
    this.resize.observe(this.viewport);
  }
  setDisplayMode(fullscreen: boolean, available: boolean) {
    this.root
      .querySelector(".canvas-viewer")!
      .classList.toggle("fullscreen", fullscreen);
    const button = this.root.querySelector<HTMLButtonElement>(
      '[data-action="fullscreen"]',
    )!;
    button.hidden = !available;
    button.setAttribute(
      "aria-label",
      fullscreen ? "Exit fullscreen" : "Enter fullscreen",
    );
    button.title = button.getAttribute("aria-label")!;
  }
  update(snapshot: ViewerSnapshot) {
    this.title.textContent =
      snapshot.state?.title || snapshot.binding?.title || "Drawing";
    this.title.title = this.title.textContent;
    const saved = snapshot.state?.saving
      ? "Saving…"
      : snapshot.state?.dirty
        ? "Unsaved"
        : "Saved";
    const label =
      snapshot.phase === "live"
        ? `Live · ${saved}`
        : snapshot.phase === "busy"
          ? "Editing… · Last preview"
          : snapshot.phase === "paused"
            ? "Paused"
            : snapshot.phase === "stale"
              ? "Stale · Updates unavailable"
              : snapshot.phase === "empty"
                ? `Live · ${saved}`
                : snapshot.phase === "loading"
                  ? "Loading preview…"
                  : "Waiting for a drawing…";
    this.status.textContent = label;
    this.root
      .querySelector(".canvas-viewer")!
      .setAttribute("data-phase", snapshot.phase);
    const observed = snapshot.state?.observedAt;
    const time =
      observed && ["stale", "paused", "busy"].includes(snapshot.phase)
        ? ` Last checked ${new Date(observed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
        : "";
    this.notice.textContent = snapshot.message + time;
    this.empty.hidden = snapshot.hasFrame;
    this.empty.querySelector("strong")!.textContent =
      snapshot.phase === "empty"
        ? "A blank canvas"
        : snapshot.phase === "stale"
          ? "Preview unavailable"
          : "Drawing preview";
    this.empty.querySelector("p")!.textContent = snapshot.message;
    const stale = this.root.querySelector<HTMLElement>(".viewer-stale")!;
    stale.hidden =
      !snapshot.hasFrame ||
      !["paused", "stale", "busy"].includes(snapshot.phase);
    stale.textContent =
      snapshot.phase === "paused"
        ? "Paused · Last preview"
        : snapshot.phase === "busy"
          ? "Editing · Last preview"
          : "Stale · Last preview";
    this.root.querySelector<HTMLButtonElement>(
      '[data-action="refresh"]',
    )!.disabled = !snapshot.binding || snapshot.terminal;
    const pause = this.root.querySelector<HTMLButtonElement>(
      '[data-action="pause"]',
    )!;
    pause.disabled = !snapshot.binding || snapshot.terminal;
    pause.setAttribute(
      "aria-label",
      snapshot.paused ? "Resume updates" : "Pause updates",
    );
    pause.title = pause.getAttribute("aria-label")!;
    pause.setAttribute("aria-pressed", String(snapshot.paused));
    pause.innerHTML = icon(snapshot.paused ? "play" : "pause");
    for (const action of ["out", "in", "fit"])
      this.root.querySelector<HTMLButtonElement>(
        `[data-action="${action}"]`,
      )!.disabled = !snapshot.hasFrame;
  }
  async prepare(bytes: Uint8Array<ArrayBuffer>, capture: Capture) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    this.candidates.add(url);
    const image = new Image();
    image.width = capture.width;
    image.height = capture.height;
    image.alt =
      "Read-only drawing preview. Detailed diagram content is available in the desktop app.";
    image.draggable = false;
    image.src = url;
    try {
      await image.decode();
      if (
        image.naturalWidth !== capture.width ||
        image.naturalHeight !== capture.height
      )
        throw new Error("Invalid decoded dimensions");
    } catch {
      this.candidates.delete(url);
      URL.revokeObjectURL(url);
      throw new Error("The PNG preview could not be decoded.");
    }
    let settled = false;
    return {
      commit: () => {
        if (settled) return;
        settled = true;
        this.candidates.delete(url);
        const previous = this.url;
        this.image?.remove();
        this.viewport.prepend(image);
        this.image = image;
        this.url = url;
        this.size = { width: capture.width, height: capture.height };
        if (this.fitted) this.fit();
        else this.transform();
        if (previous) URL.revokeObjectURL(previous);
      },
      discard: () => {
        if (!settled) {
          settled = true;
          this.candidates.delete(url);
          URL.revokeObjectURL(url);
        }
      },
    };
  }
  clear() {
    this.image?.remove();
    this.image = undefined;
    this.size = undefined;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined;
    for (const url of this.candidates) URL.revokeObjectURL(url);
    this.candidates.clear();
  }
  private fit() {
    this.fitted = true;
    this.x = 0;
    this.y = 0;
    if (this.size)
      this.zoom = Math.max(
        0.02,
        Math.min(
          (this.viewport.clientWidth - 48) / this.size.width,
          (this.viewport.clientHeight - 48) / this.size.height,
          2,
        ),
      );
    this.transform();
  }
  private scale(factor: number, anchorX = 0, anchorY = 0) {
    if (!this.image) return;
    const next = Math.max(0.02, Math.min(8, this.zoom * factor)),
      ratio = next / this.zoom;
    this.x = anchorX - (anchorX - this.x) * ratio;
    this.y = anchorY - (anchorY - this.y) * ratio;
    this.zoom = next;
    this.fitted = false;
    this.transform();
  }
  private transform() {
    if (this.image)
      this.image.style.transform = `translate(calc(-50% + ${this.x}px), calc(-50% + ${this.y}px)) scale(${this.zoom})`;
    this.root.querySelector("output")!.textContent =
      `${Math.round(this.zoom * 100)}%`;
  }
  destroy() {
    this.abort.abort();
    this.resize.disconnect();
    this.clear();
  }
}
