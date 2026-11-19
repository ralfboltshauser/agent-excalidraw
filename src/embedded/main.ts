import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { ViewerSession } from "./session";
import { CanvasView } from "./view";

const app = new App({ name: "Agent Excalidraw Viewer", version: "1.0.0" });
const root = document.querySelector<HTMLElement>("#app")!;
let session: ViewerSession;
let ready = false;
let canRead = false;
let dead = false;
let visible = true;
let pendingBinding: unknown;
const view = new CanvasView(root, {
  refresh: () => session.refresh(true),
  pause: () => session.togglePause(),
  fullscreen: () => {
    const context = app.getHostContext();
    const mode =
      context?.displayMode === "fullscreen" ? "inline" : "fullscreen";
    if (!ready || !context?.availableDisplayModes?.includes(mode)) return;
    void app
      .requestDisplayMode({ mode })
      .then((result) => {
        if (!dead) view.setDisplayMode(result.mode === "fullscreen", true);
      })
      .catch(() => {
        /* Keep the inline preview usable if the host refuses. */
      });
  },
});
session = new ViewerSession(
  (request) =>
    app.callServerTool(
      { name: "canvas_read", arguments: request },
      { timeout: 15_000 },
    ),
  view,
);
function applyContext() {
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables)
    applyHostStyleVariables(context.styles.variables);
  view.setDisplayMode(
    context?.displayMode === "fullscreen",
    context?.availableDisplayModes?.includes("fullscreen") ?? false,
  );
}
const lifecycle = new AbortController();
const observer = new IntersectionObserver((entries) => {
  visible = entries.some((entry) => entry.isIntersecting);
  updateVisibility();
});
function updateVisibility() {
  session.setActive(ready && visible && !document.hidden);
}
function cleanup() {
  if (dead) return;
  dead = true;
  session.stop();
  view.destroy();
  observer.disconnect();
  lifecycle.abort();
}
// Register every handler before the initialization handshake can deliver data.
app.ontoolresult = (result) => {
  const binding = result._meta?.canvasBinding;
  if (binding === undefined || dead) return;
  if (ready && canRead) session.bind(binding);
  else if (!ready) pendingBinding = binding;
};
app.ontoolcancelled = () =>
  session.disconnect(
    "The canvas request was cancelled. Ask the agent to show the drawing again.",
  );
app.onhostcontextchanged = () => {
  if (!dead) applyContext();
};
app.onteardown = async () => {
  cleanup();
  return {};
};
app.onclose = () => {
  if (!dead) session.disconnect();
};
app.onerror = () => {
  if (!dead) session.disconnect();
};
document.addEventListener("visibilitychange", updateVisibility, {
  signal: lifecycle.signal,
});
window.addEventListener(
  "pagehide",
  () => {
    cleanup();
    void app.close();
  },
  { signal: lifecycle.signal },
);
session.setActive(false);
observer.observe(root);
try {
  await app.connect();
  if (!dead) {
    ready = true;
    // E0: initialize context may never be followed by a change notification.
    applyContext();
    updateVisibility();
    canRead = Boolean(app.getHostCapabilities()?.serverTools);
    if (!canRead)
      session.disconnect(
        "This host cannot read canvas previews. Continue in the desktop app or use the CLI.",
      );
    if (canRead && pendingBinding !== undefined) {
      session.bind(pendingBinding);
      pendingBinding = undefined;
    }
  }
} catch {
  session.disconnect(
    "The host could not connect this preview. Ask the agent to show the drawing again.",
  );
}
