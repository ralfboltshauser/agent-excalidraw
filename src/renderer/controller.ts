import {
  CaptureUpdateAction,
  FONT_FAMILY,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  getCommonBounds,
  newElementWith,
  restoreElements,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import { flushSync } from "react-dom";
import {
  AppError,
  blankScene,
  failure,
  success,
  type Bridge,
  type Reply,
  type Request,
  type Scene,
} from "../shared/types";

type Element = ReturnType<
  ExcalidrawImperativeAPI["getSceneElementsIncludingDeleted"]
>[number];
type AnyElement = any;
type Operation = {
  op: string;
  id?: string;
  ref?: string;
  type?: string;
  [key: string]: any;
};
const clone = <T>(value: T): T => structuredClone(value);
const finite = (value: unknown, name: string) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e7
  )
    throw new AppError(
      "INVALID_ARGUMENT",
      `${name} must be a finite coordinate within ±10,000,000.`,
    );
  return value;
};
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function persistentState(state: Partial<AppState>): Scene["appState"] {
  return {
    viewBackgroundColor: state.viewBackgroundColor || "#ffffff",
    gridSize: state.gridSize ?? 20,
    gridStep: state.gridStep ?? 5,
    gridModeEnabled: state.gridModeEnabled ?? false,
  };
}
function fingerprint(scene: Scene): string {
  const liveFiles = new Set(
    scene.elements
      .filter((e) => !e.isDeleted && e.type === "image")
      .map((e) => e.fileId),
  );
  return canonical({
    ...scene,
    elements: scene.elements
      .filter((e) => !e.isDeleted)
      .map((e) => {
        const { version, versionNonce, updated, index, ...content } = e;
        return content;
      }),
    files: Object.fromEntries(
      Object.entries(scene.files)
        .filter(([id]) => liveFiles.has(id))
        .map(([id, file]) => [
          id,
          { id, mimeType: file.mimeType, dataURL: file.dataURL },
        ]),
    ),
  });
}
function sceneFrom(api: ExcalidrawImperativeAPI): Scene {
  const elements = clone(api.getSceneElementsIncludingDeleted()) as any[];
  const used = new Set(
    elements.filter((e) => e.type === "image").map((e) => e.fileId),
  );
  return {
    ...blankScene(),
    elements,
    appState: persistentState(api.getAppState()),
    files: clone(
      Object.fromEntries(
        Object.entries(api.getFiles()).filter(([id]) => used.has(id)),
      ),
    ),
  };
}
const uuid = () => crypto.randomUUID();
const styleKeys = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
  "fontFamily",
  "fontSize",
  "textAlign",
  "verticalAlign",
  "angle",
  "locked",
  "link",
] as const;
const geometryKeys = ["x", "y", "width", "height", "points"] as const;
const pick = (value: any, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
  );
function label(value: any): any {
  if (value === undefined) return undefined;
  if (typeof value === "string") return { text: value };
  if (value && typeof value === "object" && typeof value.text === "string")
    return {
      text: value.text,
      ...pick(value, ["fontSize", "fontFamily", "textAlign", "verticalAlign"]),
    };
  throw new AppError(
    "INVALID_ARGUMENT",
    "A label must be text or an object containing text.",
  );
}
function center(el: any): [number, number] {
  return [el.x + el.width / 2, el.y + el.height / 2];
}
function edgePoint(element: any, towards: readonly number[]): [number, number] {
  const [cx, cy] = center(element),
    angle = element.angle || 0;
  const dx = towards[0] - cx,
    dy = towards[1] - cy;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle),
    localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const rx = Math.max(element.width / 2, 1),
    ry = Math.max(element.height / 2, 1);
  const factor =
    element.type === "ellipse"
      ? 1 / Math.sqrt((localX / rx) ** 2 + (localY / ry) ** 2)
      : element.type === "diamond"
        ? 1 / (Math.abs(localX) / rx + Math.abs(localY) / ry)
        : Math.min(
            localX ? rx / Math.abs(localX) : Infinity,
            localY ? ry / Math.abs(localY) : Infinity,
          );
  if (!Number.isFinite(factor))
    throw new AppError(
      "INVALID_ARGUMENT",
      "Connected shapes need distinct centers.",
    );
  const length = Math.hypot(dx, dy),
    padding = 8;
  return [
    cx + dx * factor + (length ? (dx / length) * padding : 0),
    cy + dy * factor + (length ? (dy / length) * padding : 0),
  ];
}
function semanticBatch(current: readonly Element[], operations: Operation[]) {
  let elements: AnyElement[] = clone(current) as AnyElement[];
  const appStatePatch: { viewBackgroundColor?: string } = {};
  const created: { ref?: string; id: string }[] = [];
  const refs = new Map<string, string>();
  const changedGeometry = new Set<string>();
  const resolve = (id: string) => refs.get(id) || id;
  const lookup = (id: string) => {
    const element = elements.find((e) => e.id === resolve(id) && !e.isDeleted);
    if (!element)
      throw new AppError(
        "ELEMENT_NOT_FOUND",
        `Element ${id} does not exist in this drawing.`,
      );
    return element;
  };
  const replace = (el: any, props: any) => {
    const next = newElementWith(el, props);
    elements = elements.map((e) => (e.id === el.id ? next : e));
    return next;
  };
  const textMetrics = (text: string, original: any) => {
    const skeleton = {
      ...pick(original, [
        "fontSize",
        "fontFamily",
        "textAlign",
        "lineHeight",
        "strokeColor",
      ]),
      type: "text",
      id: original.id,
      x: original.x,
      y: original.y,
      text,
    };
    const measured = convertToExcalidrawElements([skeleton as any], {
      regenerateIds: false,
    })[0] as any;
    return {
      text,
      originalText: text,
      width: measured.width,
      height: measured.height,
    };
  };
  const updateLabel = (container: any, value: any) => {
    const { text, ...labelStyle } = value;
    const bound = elements.find(
      (e) =>
        !e.isDeleted && e.type === "text" && e.containerId === container.id,
    );
    if (["rectangle", "ellipse", "diamond"].includes(container.type)) {
      // The converter owns text measurement, wrapping and container growth. Reuse
      // the bound text ID so references remain stable when changing a label.
      const skeleton = {
        ...container,
        boundElements: (container.boundElements || []).filter(
          (entry: any) => entry.type !== "text",
        ),
        label: {
          ...(bound
            ? pick(bound, [
                "id",
                "fontSize",
                "fontFamily",
                "textAlign",
                "verticalAlign",
              ])
            : {}),
          ...labelStyle,
          text,
        },
      };
      const converted = convertToExcalidrawElements([skeleton], {
        regenerateIds: false,
      });
      for (const el of converted) {
        const before = elements.find((e) => e.id === el.id);
        if (before) replace(before, el);
        else elements.push(el);
      }
      changedGeometry.add(container.id);
      return;
    }
    if (!bound) {
      const converted = convertToExcalidrawElements(
        [{ ...container, label: { ...labelStyle, text } }],
        { regenerateIds: false },
      );
      for (const el of converted) {
        const before = elements.find((e) => e.id === el.id);
        if (before) replace(before, el);
        else elements.push(el);
      }
      return;
    }
    const metrics = textMetrics(text, { ...bound, ...labelStyle });
    const [cx, cy] = center(container);
    replace(bound, {
      ...labelStyle,
      ...metrics,
      x: cx - metrics.width / 2,
      y: cy - metrics.height / 2,
    });
  };
  for (const op of operations) {
    if (!op || typeof op !== "object")
      throw new AppError(
        "INVALID_ARGUMENT",
        "Each operation must be an object.",
      );
    if (op.op === "canvas") {
      if (
        typeof op.viewBackgroundColor !== "string" ||
        !CSS.supports("color", op.viewBackgroundColor)
      )
        throw new AppError(
          "INVALID_ARGUMENT",
          "Canvas background must be a CSS color.",
        );
      appStatePatch.viewBackgroundColor = op.viewBackgroundColor;
      continue;
    }
    if (op.op === "create") {
      const type = op.type || "rectangle";
      if (
        !["rectangle", "ellipse", "diamond", "text", "arrow", "line"].includes(
          type,
        )
      )
        throw new AppError(
          "UNSUPPORTED_OPERATION",
          `Semantic creation of ${type} is not supported. Use the editor for image/frame/freehand creation.`,
        );
      const id = typeof op.id === "string" ? op.id : uuid();
      if (elements.some((e) => e.id === id))
        throw new AppError(
          "INVALID_ARGUMENT",
          `Element ID ${id} already exists.`,
        );
      if (
        op.ref !== undefined &&
        (typeof op.ref !== "string" || refs.has(op.ref))
      )
        throw new AppError(
          "INVALID_ARGUMENT",
          "Create refs must be unique strings.",
        );
      const skeleton: any = {
        type,
        id,
        x: op.x ?? 0,
        y: op.y ?? 0,
        ...pick(op, styleKeys),
        ...pick(op, ["width", "height", "points"]),
        ...(op.label !== undefined ? { label: label(op.label) } : {}),
      };
      finite(skeleton.x, "x");
      finite(skeleton.y, "y");
      if (op.width !== undefined) finite(op.width, "width");
      if (op.height !== undefined) finite(op.height, "height");
      if (type === "text") {
        if (typeof op.text !== "string")
          throw new AppError(
            "INVALID_ARGUMENT",
            "Text creation requires text.",
          );
        skeleton.text = op.text;
      }
      let dependencies: any[] = [];
      if (type === "arrow" && (op.from || op.to)) {
        const from = op.from ? lookup(op.from) : null;
        const to = op.to ? lookup(op.to) : null;
        if (
          [from, to]
            .filter(Boolean)
            .some(
              (e) =>
                !["rectangle", "ellipse", "diamond", "text"].includes(e.type),
            )
        )
          throw new AppError(
            "UNSUPPORTED_OPERATION",
            "Arrow endpoints must be rectangles, ellipses, diamonds or text.",
          );
        const fromCenter = from ? center(from) : [skeleton.x, skeleton.y];
        const toCenter = to
          ? center(to)
          : [skeleton.x + (op.width ?? 160), skeleton.y + (op.height ?? 0)];
        const start: [number, number] = from
          ? edgePoint(from, toCenter)
          : (fromCenter as [number, number]);
        const end: [number, number] = to
          ? edgePoint(to, fromCenter)
          : (toCenter as [number, number]);
        skeleton.x = start[0];
        skeleton.y = start[1];
        skeleton.points = [
          [0, 0],
          [end[0] - start[0], end[1] - start[1]],
        ];
        if (from) {
          skeleton.start = { id: from.id };
          dependencies.push(from);
        }
        if (to) {
          skeleton.end = { id: to.id };
          dependencies.push(to);
        }
      }
      const converted = convertToExcalidrawElements(
        [...new Map(dependencies.map((e) => [e.id, e])).values(), skeleton],
        { regenerateIds: false },
      );
      for (const el of converted) {
        const before = elements.find((e) => e.id === el.id);
        if (before) replace(before, el);
        else elements.push(el);
      }
      if (op.ref) refs.set(op.ref, id);
      created.push({ ...(op.ref ? { ref: op.ref } : {}), id });
    } else if (op.op === "update") {
      if (typeof op.id !== "string")
        throw new AppError(
          "INVALID_ARGUMENT",
          "Update requires an element ID.",
        );
      const original = lookup(op.id);
      const props = { ...pick(op, styleKeys), ...pick(op, geometryKeys) };
      for (const key of ["x", "y", "width", "height"] as const)
        if (props[key] !== undefined) finite(props[key], key);
      if (op.text !== undefined) {
        if (original.type !== "text" || typeof op.text !== "string")
          throw new AppError(
            "INVALID_ARGUMENT",
            "text updates require a text element and string.",
          );
        Object.assign(props, textMetrics(op.text, { ...original, ...props }));
      } else if (
        original.type === "text" &&
        (props.fontSize !== undefined || props.fontFamily !== undefined)
      )
        Object.assign(
          props,
          textMetrics(original.text, { ...original, ...props }),
        );
      const next = replace(original, props);
      if (geometryKeys.some((k) => props[k] !== undefined))
        changedGeometry.add(original.id);
      if (op.label !== undefined) updateLabel(next, label(op.label));
    } else if (op.op === "delete") {
      if (typeof op.id !== "string")
        throw new AppError("INVALID_ARGUMENT", "Delete requires an ID.");
      const element = lookup(op.id);
      const ids = new Set([
        element.id,
        ...elements
          .filter((e) => e.containerId === element.id)
          .map((e) => e.id),
      ]);
      elements = elements.map((e) =>
        ids.has(e.id) ? newElementWith(e, { isDeleted: true }) : e,
      );
      elements = elements.map((e) =>
        newElementWith(e, {
          ...(e.startBinding && ids.has(e.startBinding.elementId)
            ? { startBinding: null }
            : {}),
          ...(e.endBinding && ids.has(e.endBinding.elementId)
            ? { endBinding: null }
            : {}),
          ...(e.boundElements
            ? {
                boundElements: e.boundElements.filter(
                  (b: any) => !ids.has(b.id),
                ),
              }
            : {}),
        }),
      );
    } else if (op.op === "group") {
      if (!Array.isArray(op.ids) || op.ids.length < 2)
        throw new AppError(
          "INVALID_ARGUMENT",
          "Group requires at least two IDs.",
        );
      const ids = new Set(op.ids.map((id: string) => lookup(id).id));
      const groupId = uuid();
      elements = elements.map((e) =>
        ids.has(e.id) || ids.has(e.containerId)
          ? newElementWith(e, { groupIds: [...e.groupIds, groupId] })
          : e,
      );
    } else
      throw new AppError(
        "UNSUPPORTED_OPERATION",
        `Unknown semantic operation ${op.op}.`,
      );
  }
  // Reposition bound labels after a host shape moves. Excalidraw's public updateScene
  // does not perform the interactive drag's binding repair for callers.
  for (const id of changedGeometry) {
    const container = elements.find((e) => e.id === id && !e.isDeleted);
    if (!container) continue;
    for (const bound of elements.filter(
      (e) => !e.isDeleted && e.type === "text" && e.containerId === id,
    )) {
      if (["rectangle", "ellipse", "diamond"].includes(container.type)) {
        const skeleton = {
          ...container,
          boundElements: (container.boundElements || []).filter(
            (entry: any) => entry.type !== "text",
          ),
          label: {
            id: bound.id,
            text: bound.text,
            ...pick(bound, [
              "fontSize",
              "fontFamily",
              "textAlign",
              "verticalAlign",
            ]),
          },
        };
        for (const repaired of convertToExcalidrawElements([skeleton], {
          regenerateIds: false,
        })) {
          const original = elements.find((e) => e.id === repaired.id);
          if (original) replace(original, repaired);
        }
      } else {
        const [cx, cy] = center(container);
        replace(bound, { x: cx - bound.width / 2, y: cy - bound.height / 2 });
      }
    }
  }
  // Use the editor's own binding helper through the public converter for straight
  // connectors. Never silently flatten user-created bent/elbow/rotated geometry.
  for (const arrow of [...elements].filter(
    (e) => !e.isDeleted && e.type === "arrow",
  )) {
    if (
      ![arrow.startBinding?.elementId, arrow.endBinding?.elementId].some((id) =>
        changedGeometry.has(id),
      )
    )
      continue;
    if (arrow.elbowed || arrow.points.length !== 2 || arrow.angle)
      throw new AppError(
        "UNSUPPORTED_OPERATION",
        "Moving a shape with bent, elbow or rotated bound arrows requires the editor. No changes were applied.",
      );
    const from = elements.find(
      (e) => e.id === arrow.startBinding?.elementId && !e.isDeleted,
    );
    const to = elements.find(
      (e) => e.id === arrow.endBinding?.elementId && !e.isDeleted,
    );
    const oldEnd = arrow.points.at(-1);
    const fromCenter = from ? center(from) : [arrow.x, arrow.y],
      toCenter = to ? center(to) : [arrow.x + oldEnd[0], arrow.y + oldEnd[1]];
    const start = from ? edgePoint(from, toCenter) : fromCenter,
      end = to ? edgePoint(to, fromCenter) : toCenter;
    const skeleton = {
      ...arrow,
      x: start[0],
      y: start[1],
      points: [
        [0, 0],
        [end[0] - start[0], end[1] - start[1]],
      ],
      ...(from ? { start: { id: from.id } } : {}),
      ...(to ? { end: { id: to.id } } : {}),
    };
    const dependencies = [
      ...new Map([from, to].filter(Boolean).map((e) => [e.id, e])).values(),
    ];
    for (const el of convertToExcalidrawElements([...dependencies, skeleton], {
      regenerateIds: false,
    })) {
      const original = elements.find((e) => e.id === el.id);
      if (original) replace(original, el);
    }
    const nextArrow = elements.find((e) => e.id === arrow.id)!;
    for (const bound of elements.filter(
      (e) => !e.isDeleted && e.type === "text" && e.containerId === arrow.id,
    )) {
      const [cx, cy] = center(nextArrow);
      replace(bound, { x: cx - bound.width / 2, y: cy - bound.height / 2 });
    }
  }
  return { elements, created, appStatePatch };
}

export function createController(api: ExcalidrawImperativeAPI, bridge: Bridge) {
  let documentId = "",
    epoch = "",
    revision = 0,
    savedFingerprint = "",
    lastFingerprint = "",
    loading = false;
  let latestScene: Scene = blankScene();
  let composition = false,
    pointer = false,
    lastImport = 0;
  const pausedSessions = new Set<string>(),
    sessionGenerations = new Map<string, number>();
  const receiptCache = new Map<string, { payload: string; reply: Reply }>();
  const captures = new Map<number, string>();
  let lastBatch: { before: Scene; afterRevision: number } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement)?.closest?.(".excalidraw")) pointer = true;
  };
  const onPointerUp = () => {
    pointer = false;
  };
  const onCompositionStart = () => {
    composition = true;
  };
  const onCompositionEnd = () => {
    composition = false;
  };
  const onImport = (event: Event) => {
    if ((event.target as HTMLElement)?.closest?.(".excalidraw"))
      lastImport = Date.now();
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("blur", onPointerUp);
  document.addEventListener("compositionstart", onCompositionStart, true);
  document.addEventListener("compositionend", onCompositionEnd, true);
  document.addEventListener("paste", onImport, true);
  document.addEventListener("drop", onImport, true);
  const dispose = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("blur", onPointerUp);
    document.removeEventListener("compositionstart", onCompositionStart, true);
    document.removeEventListener("compositionend", onCompositionEnd, true);
    document.removeEventListener("paste", onImport, true);
    document.removeEventListener("drop", onImport, true);
  };
  function receipt(extra: Record<string, any> = {}) {
    return { document: documentId, epoch, revision, ...extra };
  }
  function sync(notify = true) {
    if (loading || !documentId) return;
    const scene = sceneFrom(api),
      fp = fingerprint(scene);
    if (fp !== lastFingerprint) {
      revision++;
      lastFingerprint = fp;
      latestScene = scene;
      captures.set(revision, fp);
      if (captures.size > 500) captures.delete(captures.keys().next().value!);
      if (notify)
        bridge.notifyChange({
          document: documentId,
          epoch,
          revision,
          dirty: fp !== savedFingerprint,
          scene: clone(scene),
        });
    }
  }
  function isBusy() {
    const s = api.getAppState();
    return (
      pointer ||
      composition ||
      Date.now() - lastImport < 500 ||
      s.cursorButton === "down" ||
      s.selectedElementsAreBeingDragged ||
      s.isResizing ||
      s.isRotating ||
      s.isCropping ||
      Boolean(
        s.editingTextElement ||
        s.editingLinearElement ||
        s.multiElement ||
        s.newElement ||
        s.pendingImageElementId,
      )
    );
  }
  function ensureDocument(request: Request) {
    if (!documentId)
      throw new AppError("NO_DOCUMENT", "Create or open a drawing first.");
    if (request.document && request.document !== documentId)
      throw new AppError(
        "DOCUMENT_NOT_ACTIVE",
        "This command targets a drawing that is not active. Open it explicitly first.",
      );
  }
  function precondition(request: Request) {
    if (pausedSessions.has(request.session || "default"))
      throw new AppError(
        "SESSION_PAUSED",
        "This agent session was stopped. Resume explicitly before editing.",
      );
    ensureDocument(request);
    sync();
    if (
      !request.document ||
      !request.epoch ||
      !Number.isInteger(request.expectedRevision) ||
      !request.requestId
    )
      throw new AppError(
        "PRECONDITION_REQUIRED",
        "Mutations require document, epoch, expectedRevision and a unique requestId. Inspect snapshot first.",
      );
    if (request.epoch !== epoch)
      throw new AppError(
        "STALE_EPOCH",
        "This drawing was reopened or the app restarted. Inspect it again.",
        receipt(),
      );
    if (request.expectedRevision !== revision)
      throw new AppError(
        "STALE_REVISION",
        "The drawing changed. Inspect it again before applying an edit.",
        receipt(),
      );
    if (isBusy())
      throw new AppError(
        "DOCUMENT_BUSY",
        "Finish the current gesture or text edit, then inspect and retry.",
      );
  }
  async function setIdentity(
    id: string,
    nextEpoch: string,
    scene: Scene,
    previous?: { document: string; epoch: string; revision: number },
  ) {
    // Preparing a candidate must not destroy the active drawing if restoration
    // rejects malformed input. The final admission check follows preparation.
    const restored = restoreElements(clone(scene.elements), null, {
      repairBindings: true,
    });
    if (documentId) {
      sync();
      if (!previous)
        throw new AppError(
          "PRECONDITION_REQUIRED",
          "Switching drawings requires the approved current document, epoch and revision.",
          receipt(),
        );
      if (
        previous.document !== documentId ||
        previous.epoch !== epoch ||
        previous.revision !== revision
      )
        throw new AppError(
          "STALE_REVISION",
          "The open drawing changed while the next file was being prepared. Review the current drawing before switching.",
          receipt(),
        );
      if (isBusy())
        throw new AppError(
          "DOCUMENT_BUSY",
          "Finish the current gesture or text edit before switching drawings.",
          receipt(),
        );
    }
    // No await/event-loop yield separates the live admission check from reset.
    loading = true;
    documentId = id;
    epoch = nextEpoch;
    revision = 0;
    receiptCache.clear();
    captures.clear();
    lastBatch = null;
    pointer = false;
    composition = false;
    try {
      api.resetScene();
      if (Object.keys(scene.files || {}).length)
        api.addFiles(Object.values(scene.files));
      api.updateScene({
        elements: restored,
        appState: {
          ...scene.appState,
          selectedElementIds: {},
          selectedGroupIds: {},
          editingGroupId: null,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      api.history.clear();
      latestScene = sceneFrom(api);
      lastFingerprint = fingerprint(latestScene);
      savedFingerprint = lastFingerprint;
      captures.set(0, lastFingerprint);
    } finally {
      loading = false;
    }
    bridge.notifyChange({
      document: documentId,
      epoch,
      revision,
      dirty: false,
      scene: clone(latestScene),
    });
  }
  function commit(
    elements: any[],
    request: Request,
    created: any[] = [],
    appStatePatch: { viewBackgroundColor?: string } = {},
  ) {
    // There is deliberately no await between final validation and updateScene.
    precondition(request);
    const before = clone(sceneFrom(api));
    const candidate = {
      ...before,
      elements,
      appState: { ...before.appState, ...appStatePatch },
    };
    if (fingerprint(candidate) === lastFingerprint)
      return success(
        receipt({ applied: false, created: [], stage: "read-back" }),
      );
    const updateState =
      appStatePatch.viewBackgroundColor !== undefined
        ? { viewBackgroundColor: appStatePatch.viewBackgroundColor }
        : undefined;
    // The SDK replaces elements synchronously but queues React app state. Flush
    // both together so the receipt and history guard describe the same scene.
    // This also keeps final admission and readback in one event-loop turn.
    flushSync(() =>
      api.updateScene({
        elements,
        appState: updateState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );
    sync();
    const live = api.getSceneElementsIncludingDeleted();
    const expectedIds = new Set(
      elements.filter((e) => !e.isDeleted).map((e) => e.id),
    );
    if (
      live.filter((e) => !e.isDeleted).some((e) => !expectedIds.has(e.id)) ||
      live.filter((e) => !e.isDeleted).length !== expectedIds.size
    )
      throw new AppError(
        "OUTCOME_UNKNOWN",
        "The editor readback did not match this batch. Inspect before taking any further action.",
        receipt(),
      );
    lastBatch = { before, afterRevision: revision };
    return success(
      receipt({
        applied: true,
        created,
        stage: "read-back",
        elementCount: api.getSceneElements().length,
      }),
    );
  }
  async function mutation(request: Request) {
    const session = request.session || "default",
      generation = sessionGenerations.get(session) || 0;
    const payload = canonical({ ...request, requestId: undefined });
    const prior = request.requestId
      ? receiptCache.get(request.requestId)
      : null;
    if (prior) {
      if (prior.payload !== payload)
        throw new AppError(
          "REQUEST_ID_REUSED",
          "This requestId was used with a different command or payload.",
        );
      return prior.reply;
    }
    precondition(request);
    // Font preparation may yield. Final validation in commit catches intervening
    // human changes, including those not forwarded to the main process yet.
    await document.fonts.ready;
    const fontCharacters = new Map<number, string>();
    const collectFont = (family: number, text: string) =>
      fontCharacters.set(family, (fontCharacters.get(family) || "") + text);
    for (const element of api.getSceneElements())
      if (element.type === "text")
        collectFont(element.fontFamily, element.text);
    for (const operation of Array.isArray(request.args?.operations)
      ? request.args.operations
      : []) {
      if (typeof operation.text === "string")
        collectFont(
          operation.fontFamily || FONT_FAMILY.Excalifont,
          operation.text,
        );
      const textLabel = operation.label;
      if (typeof textLabel === "string")
        collectFont(operation.fontFamily || FONT_FAMILY.Excalifont, textLabel);
      else if (textLabel?.text)
        collectFont(
          textLabel.fontFamily ||
            operation.fontFamily ||
            FONT_FAMILY.Excalifont,
          textLabel.text,
        );
    }
    await Promise.all(
      [...fontCharacters].map(async ([family, text]) => {
        const name = Object.entries(FONT_FAMILY).find(
          ([, id]) => id === family,
        )?.[0];
        if (!name)
          throw new AppError(
            "INVALID_ARGUMENT",
            `Font family ${family} is not supported.`,
          );
        await document.fonts.load(`20px "${name}", Xiaolai`, text);
      }),
    );
    if ((sessionGenerations.get(session) || 0) !== generation)
      throw new AppError(
        "OPERATION_CANCELLED",
        "This pending batch was stopped before it could be applied.",
      );
    precondition(request);
    const args = request.args || {};
    let reply: Reply;
    if (request.command === "revert-last-agent-batch") {
      if (!lastBatch || lastBatch.afterRevision !== revision)
        throw new AppError(
          "REVERT_UNAVAILABLE",
          "Later edits prevent safely reverting the last agent batch. Use native Undo as appropriate.",
        );
      const before = lastBatch.before;
      reply = commit(before.elements, request, [], before.appState);
      lastBatch = null;
    } else {
      let operations: Operation[];
      if (request.command === "layout") {
        const ids =
          args.ids ||
          api
            .getSceneElements()
            .filter((e) => e.type !== "text" || !e.containerId)
            .map((e) => e.id);
        if (!Array.isArray(ids) || ids.length > 5000)
          throw new AppError(
            "INVALID_ARGUMENT",
            "Layout requires an array of at most 5,000 IDs.",
          );
        const items: any[] = ids.map((id: string) =>
          api.getSceneElements().find((e) => e.id === id),
        );
        if (items.some((e: any) => !e))
          throw new AppError(
            "ELEMENT_NOT_FOUND",
            "One or more layout elements do not exist.",
          );
        const horizontal = args.direction !== "vertical";
        const gap = args.gap ?? 80;
        finite(gap, "gap");
        let cursor =
          (horizontal ? args.x : args.y) ??
          Math.min(...items.map((e: any) => (horizontal ? e.x : e.y)));
        operations = items.map((el: any) => {
          const op = {
            op: "update",
            id: el.id,
            ...(horizontal
              ? { x: cursor, y: args.y ?? items[0].y }
              : { y: cursor, x: args.x ?? items[0].x }),
          };
          cursor += (horizontal ? el.width : el.height) + gap;
          return op;
        });
      } else {
        operations = args.operations;
        if (!Array.isArray(operations) || operations.length > 1000)
          throw new AppError(
            "INVALID_ARGUMENT",
            "Apply requires operations: an array of at most 1,000 operations.",
          );
      }
      const compiled = semanticBatch(
        api.getSceneElementsIncludingDeleted(),
        operations,
      );
      reply = commit(
        compiled.elements,
        request,
        compiled.created,
        compiled.appStatePatch,
      );
    }
    if (request.requestId) {
      receiptCache.set(request.requestId, { payload, reply });
      if (receiptCache.size > 1000)
        receiptCache.delete(receiptCache.keys().next().value!);
    }
    return reply;
  }
  async function handle(request: Request): Promise<Reply> {
    try {
      const args = request.args || {};
      if (request.command === "session-pause") {
        const name = args.session || "default";
        pausedSessions.add(name);
        sessionGenerations.set(name, (sessionGenerations.get(name) || 0) + 1);
        return success({ paused: true });
      }
      if (request.command === "session-resume") {
        pausedSessions.delete(args.session || "default");
        return success({ paused: false });
      }
      if (request.command === "unload") {
        await setIdentity("", args.epoch, blankScene(), args.previous);
        return success({ closed: true });
      }
      if (request.command === "load") {
        await setIdentity(
          args.drawing.id,
          args.epoch,
          args.scene,
          args.previous,
        );
        return success(receipt());
      }
      ensureDocument(request);
      if (loading)
        throw new AppError("APP_STARTING", "The drawing is still loading.");
      sync();
      if (request.command === "rebind") {
        documentId = args.document;
        epoch = args.epoch || uuid();
        receiptCache.clear();
        lastBatch = null;
        return success(receipt());
      }
      if (request.command === "capture") {
        captures.set(revision, lastFingerprint);
        return success(
          receipt({
            scene: clone(sceneFrom(api)),
            dirty: lastFingerprint !== savedFingerprint,
            busy: isBusy(),
          }),
        );
      }
      if (request.command === "mark-saved") {
        const fp = captures.get(args.revision);
        if (fp === undefined)
          throw new AppError(
            "UNKNOWN_REVISION",
            "The saved revision is no longer available. Capture and save again.",
          );
        savedFingerprint = fp;
        bridge.notifyChange({
          document: documentId,
          epoch,
          revision,
          dirty: lastFingerprint !== savedFingerprint,
          scene: clone(sceneFrom(api)),
        });
        return success(
          receipt({ dirty: lastFingerprint !== savedFingerprint }),
        );
      }
      if (
        ["apply", "layout", "revert-last-agent-batch"].includes(request.command)
      )
        return await mutation(request);
      if (request.command === "operation-status") {
        if (request.epoch !== epoch)
          throw new AppError(
            "STALE_EPOCH",
            "Receipts are scoped to the current open drawing epoch.",
            receipt(),
          );
        const found = receiptCache.get(
          args.requestId || request.requestId || "",
        );
        return success(
          receipt({
            status: found ? "completed" : "unknown",
            reply: found?.reply,
          }),
        );
      }
      if (request.command === "snapshot") {
        const state = api.getAppState();
        let elements = [...api.getSceneElements()];
        if (args.selection)
          elements = elements.filter(
            (e) =>
              state.selectedElementIds[e.id] ||
              (e.type === "text" &&
                e.containerId &&
                state.selectedElementIds[e.containerId]),
          );
        if (args.ids) {
          if (!Array.isArray(args.ids))
            throw new AppError("INVALID_ARGUMENT", "ids must be an array.");
          elements = elements.filter(
            (e) =>
              args.ids.includes(e.id) ||
              (e.type === "text" &&
                e.containerId &&
                args.ids.includes(e.containerId)),
          );
        }
        if (args.group)
          elements = elements.filter((e) => e.groupIds.includes(args.group));
        if (args.region) {
          const { x, y, width, height } = args.region;
          [x, y, width, height].forEach((n, i) =>
            finite(n, ["x", "y", "width", "height"][i]),
          );
          elements = elements.filter(
            (e) =>
              e.x + e.width >= x &&
              e.x <= x + width &&
              e.y + e.height >= y &&
              e.y <= y + height,
          );
        }
        const offset =
          Number.isInteger(args.offset) && args.offset >= 0 ? args.offset : 0;
        const limit =
          Number.isInteger(args.limit) && args.limit > 0
            ? Math.min(args.limit, 5000)
            : 500;
        const page = elements.slice(offset, offset + limit);
        return success(
          receipt({
            canvas: persistentState(state),
            interaction: isBusy() ? "busy" : "idle",
            pendingImage: !!state.pendingImageElementId,
            elements: clone(
              args.compact
                ? page.map((e) =>
                    pick(e, [
                      "id",
                      "type",
                      "x",
                      "y",
                      "width",
                      "height",
                      "text",
                      "containerId",
                      "groupIds",
                      "startBinding",
                      "endBinding",
                      "boundElements",
                      "strokeColor",
                      "backgroundColor",
                    ]),
                  )
                : page,
            ),
            selection: Object.keys(state.selectedElementIds),
            total: elements.length,
            offset,
            complete: offset === 0 && page.length === elements.length,
            nextOffset:
              offset + page.length < elements.length
                ? offset + page.length
                : null,
          }),
        );
      }
      if (request.command === "view") {
        if (args.ids) {
          if (!Array.isArray(args.ids))
            throw new AppError("INVALID_ARGUMENT", "ids must be an array.");
          const ids = new Set(args.ids);
          api.updateScene({
            appState: {
              selectedElementIds: Object.fromEntries(
                [...ids].map((id) => [id, true]),
              ),
            },
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          if (args.focus)
            api.scrollToContent(
              api.getSceneElements().filter((e) => ids.has(e.id)),
              { fitToContent: true, animate: false },
            );
        }
        if (
          args.zoom !== undefined ||
          args.scrollX !== undefined ||
          args.scrollY !== undefined
        ) {
          const appState: any = {};
          for (const k of ["scrollX", "scrollY"])
            if (args[k] !== undefined) appState[k] = finite(args[k], k);
          if (args.zoom !== undefined) {
            finite(args.zoom, "zoom");
            if (args.zoom < 0.1 || args.zoom > 30)
              throw new AppError(
                "INVALID_ARGUMENT",
                "Zoom must be between 0.1 and 30.",
              );
            appState.zoom = { value: args.zoom };
          }
          api.updateScene({
            appState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        }
        if (args.focus && !args.ids)
          api.scrollToContent(undefined, {
            fitToContent: true,
            animate: false,
          });
        if (
          args.ids ||
          args.focus ||
          args.zoom !== undefined ||
          args.scrollX !== undefined ||
          args.scrollY !== undefined
        )
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        const current = api.getAppState();
        return success(
          receipt({
            selection: Object.keys(current.selectedElementIds),
            zoom: current.zoom.value,
            scrollX: current.scrollX,
            scrollY: current.scrollY,
          }),
        );
      }
      if (request.command === "render" || request.command === "export") {
        const captured = clone(sceneFrom(api)),
          capturedReceipt = receipt();
        const format = args.format || "png";
        if (format === "excalidraw" || format === "json")
          return success({
            ...capturedReceipt,
            data: btoa(
              unescape(encodeURIComponent(JSON.stringify(captured, null, 2))),
            ),
            mime: "application/vnd.excalidraw+json",
          });
        const ids = args.ids
          ? new Set(args.ids)
          : args.selection
            ? new Set(Object.keys(api.getAppState().selectedElementIds))
            : null;
        if (ids) {
          for (const element of captured.elements)
            if (element.frameId && ids.has(element.frameId))
              ids.add(element.id);
        }
        const elements = ids
          ? captured.elements.filter(
              (e) => !e.isDeleted && (ids.has(e.id) || ids.has(e.containerId)),
            )
          : captured.elements.filter((e) => !e.isDeleted);
        if (!elements.length)
          throw new AppError(
            "EMPTY_DRAWING",
            "Add a shape before rendering this drawing.",
          );
        const appState = {
          ...captured.appState,
          exportBackground: args.background !== false,
          exportEmbedScene: args.embedScene === true,
          exportWithDarkMode: false,
        };
        const bounds = getCommonBounds(elements as any);
        if (format === "svg") {
          const svg = await exportToSvg({
            elements: elements as any,
            appState: appState as any,
            files: captured.files,
            exportPadding: 20,
          });
          const encoded = new TextEncoder().encode(
            new XMLSerializer().serializeToString(svg),
          );
          let str = "";
          for (const byte of encoded) str += String.fromCharCode(byte);
          return success({
            ...capturedReceipt,
            data: btoa(str),
            mime: "image/svg+xml",
            bounds,
          });
        }
        if (format !== "png")
          throw new AppError(
            "INVALID_ARGUMENT",
            "Format must be png, svg or excalidraw.",
          );
        const scale = args.scale ?? 1;
        if (typeof scale !== "number" || scale < 0.1 || scale > 4)
          throw new AppError(
            "INVALID_ARGUMENT",
            "Export scale must be between 0.1 and 4.",
          );
        const pixelWidth = (bounds[2] - bounds[0] + 40) * scale,
          pixelHeight = (bounds[3] - bounds[1] + 40) * scale;
        if (
          pixelWidth > 16384 ||
          pixelHeight > 16384 ||
          pixelWidth * pixelHeight > 64000000
        )
          throw new AppError(
            "RENDER_TOO_LARGE",
            "This image would be too large. Reduce scale, render a selection, or export SVG.",
          );
        const blob = await exportToBlob({
          elements: elements as any,
          appState: appState as any,
          files: captured.files,
          mimeType: "image/png",
          exportPadding: 20,
          getDimensions: (width: number, height: number) => ({
            width: width * scale,
            height: height * scale,
            scale,
          }),
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let str = "";
        for (const byte of bytes) str += String.fromCharCode(byte);
        return success({
          ...capturedReceipt,
          data: btoa(str),
          mime: "image/png",
          bounds,
          scale,
          transform: { sceneOrigin: [bounds[0] - 20, bounds[1] - 20], scale },
          width: Math.ceil(pixelWidth),
          height: Math.ceil(pixelHeight),
        });
      }
      throw new AppError(
        "UNKNOWN_COMMAND",
        `Unknown scene command ${request.command}.`,
      );
    } catch (error) {
      return failure(error);
    }
  }
  return {
    handle,
    onChange(
      _elements: readonly Element[],
      _state: AppState,
      _files: BinaryFiles,
    ) {
      sync();
    },
    setIdentity,
    isDirty() {
      sync();
      return lastFingerprint !== savedFingerprint;
    },
    dispose,
  };
}
