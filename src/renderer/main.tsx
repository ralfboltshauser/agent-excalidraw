import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import {
  ArrowUpRight,
  ChevronDown,
  FolderOpen,
  Plus,
  Search,
  Star,
  PanelLeft,
  Settings as SettingsIcon,
  Command,
  ArrowLeft,
  X,
  File,
  MoreHorizontal,
  FolderPlus,
  ArrowRight,
  Terminal,
  Check,
  AlertCircle,
  RotateCcw,
  Download,
  ExternalLink,
  Copy,
  Trash2,
  Pin,
  Sun,
  Moon,
  Monitor,
  Keyboard,
} from "lucide-react";
import { createController } from "./controller";
import type {
  HostState,
  Bridge,
  Request,
  SceneCall,
  Reply,
} from "../shared/types";
import "./style.css";
declare global {
  interface Window {
    agentExcalidraw: Bridge;
    EXCALIDRAW_ASSET_PATH: string;
  }
}
window.EXCALIDRAW_ASSET_PATH = new URL("./", location.href).href;
const bridge = window.agentExcalidraw;
const drawingDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
type Screen = "welcome" | "library" | "editor" | "agents" | "settings" | "help";
function IconButton({
  label,
  children,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      className={"icon-button " + (props.className || "")}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    if (!matchMedia("(pointer: coarse)").matches)
      (
        ref.current?.querySelector(
          "input,select,textarea",
        ) as HTMLElement | null
      )?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="dialog"
      onKeyDown={(e) => {
        const results = ref.current?.querySelector(".switch-results");
        if (!results || e.nativeEvent.isComposing) return;
        const buttons = [...results.querySelectorAll("button")];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next =
            e.key === "ArrowDown"
              ? Math.min(index + 1, buttons.length - 1)
              : index < 0
                ? buttons.length - 1
                : Math.max(index - 1, 0);
          buttons[next]?.focus();
        } else if (
          e.key === "Enter" &&
          (e.target as HTMLElement).matches("input")
        ) {
          e.preventDefault();
          buttons[0]?.click();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <IconButton label="Close" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}
function App() {
  const [shapeLibrary, setShapeLibrary] = useState<any[]>([]),
    [shapeLoaded, setShapeLoaded] = useState(false),
    [systemDark, setSystemDark] = useState(
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
  const [host, setHost] = useState<HostState | null>(null),
    [screen, setScreen] = useState<Screen>("welcome"),
    [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null),
    [search, setSearch] = useState(""),
    [quickSearch, setQuickSearch] = useState(""),
    [filter, setFilter] = useState("recent"),
    [selectedFolder, setSelectedFolder] = useState<string | null>(null),
    [modal, setModal] = useState<string | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [format, setFormat] = useState("png"),
    [embedded, setEmbedded] = useState(false),
    [background, setBackground] = useState(true),
    [exportScope, setExportScope] = useState("all"),
    [exportScale, setExportScale] = useState(1),
    [exportPreview, setExportPreview] = useState<any>(null),
    [previewError, setPreviewError] = useState<string | null>(null),
    [setup, setSetup] = useState<any>(null),
    [update, setUpdate] = useState<any>(null);
  const listRef = useRef<HTMLDivElement>(null),
    [listTop, setListTop] = useState(0),
    [listViewport, setListViewport] = useState(500);
  const controller = useRef<ReturnType<typeof createController> | null>(null),
    activeId = useRef<string | null>(null),
    hostInitialized = useRef(false),
    hostRef = useRef<HostState | null>(null),
    searchRef = useRef<HTMLInputElement>(null);
  const request = useCallback(
    async (command: string, args: Record<string, any> = {}) => {
      setBusy(true);
      setError(null);
      try {
        const reply = await bridge.invoke({ command, args });
        if (!reply.ok) {
          if (reply.error.code === "CANCELLED") return null;
          if (reply.error.code === "FILE_MISSING") {
            setName((reply.error.details as any)?.path || "");
            setModal("missing");
            return null;
          }
          throw new Error(reply.error.message);
        }
        return reply.result;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    const off = bridge.onHostState((next) => {
      hostRef.current = next;
      setHost(next);
      const nextId = next.active?.id || null;
      if (!hostInitialized.current || nextId !== activeId.current) {
        hostInitialized.current = true;
        activeId.current = nextId;
        setScreen(
          next.active ? "editor" : next.drawings.length ? "library" : "welcome",
        );
      }
      if ((next as any).error) setError((next as any).error);
    });
    const ui = bridge.onUiAction((action) => {
      if (action === "search") {
        setQuickSearch("");
        setModal("search");
        return;
      }
      if (action === "undo" || action === "redo") {
        const target = document.activeElement as HTMLElement;
        if (target?.matches("input,textarea,[contenteditable=true]"))
          document.execCommand(action);
        else
          (
            document.querySelector(
              '.editor-container:not(.concealed) button[data-testid="button-' +
                action +
                '"]',
            ) as HTMLButtonElement | null
          )?.click();
        return;
      }
      if (["library", "settings", "agents", "help"].includes(action)) {
        setScreen(action as Screen);
        setModal(null);
      }
      if (action === "export") setModal("export");
    });
    return () => {
      off();
      ui();
    };
  }, []);
  useEffect(() => {
    if (!api) return;
    controller.current = createController(api, bridge);
    const off = bridge.onSceneCommand(async (call: SceneCall) => {
      let reply: Reply;
      try {
        reply = await controller.current!.handle(call.request);
      } catch (e) {
        reply = {
          ok: false,
          error: {
            code: "EDITOR_ERROR",
            message: (e as Error).message,
            retryable: false,
          },
        };
      }
      bridge.replyScene(call.id, reply);
    });
    bridge.ready();
    return () => {
      off();
      controller.current = null;
    };
  }, [api]);
  useEffect(() => {
    if (!host) return;
    const apply = () => {
      const theme =
        host.settings.theme === "system"
          ? matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : host.settings.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };
    apply();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [host?.settings.theme]);
  useEffect(() => {
    void request("shape-library-get").then((items) => {
      if (Array.isArray(items)) setShapeLibrary(items);
      setShapeLoaded(true);
    });
  }, []);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(mq.matches);
    mq.addEventListener("change", changed);
    return () => mq.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (screen === "agents" || screen === "settings")
      void request("integration-status").then(setSetup);
  }, [screen]);
  useEffect(() => {
    if (modal === "search") searchRef.current?.focus();
  }, [modal]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setModal("search");
        setQuickSearch("");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (modal !== "export") {
      setExportPreview(null);
      setPreviewError(null);
      return;
    }
    let current = true;
    setExportPreview(null);
    setPreviewError(null);
    void bridge
      .invoke({
        command: "export-preview",
        args: {
          format,
          embedScene: embedded,
          background,
          selection: exportScope === "selection",
          scale: exportScale,
        },
      })
      .then((reply) => {
        if (!current) return;
        if (reply.ok) setExportPreview(reply.result);
        else setPreviewError(reply.error.message);
      })
      .catch((error) => {
        if (current) setPreviewError(error.message);
      });
    return () => {
      current = false;
    };
  }, [modal, format, embedded, background, exportScope, exportScale]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const resolvedTheme = !host?.settings.theme
    ? bridge.initialTheme || "light"
    : host.settings.theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : host.settings.theme;
  const active = host?.active,
    dirty = (host as any)?.dirty,
    saving = (host as any)?.saving;
  const makeNew = async () => {
    const result = await request(
      "new",
      selectedFolder ? { directory: selectedFolder } : {},
    );
    if (result) {
      setScreen("editor");
      setModal(null);
    }
  };
  const open = async (path?: string) => {
    const result = await request("open", path ? { path } : {});
    if (result) {
      setScreen("editor");
      setModal(null);
    }
  };
  const save = async () => {
    const result = await request("save");
    if (result) setNotice("Saved to " + result.path);
  };
  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const result = await request("rename", { title: name.trim() });
    if (result) setModal(null);
  };
  const orderedDrawings = [...(host?.drawings || [])].sort(
    (a, b) => b.lastOpened - a.lastOpened,
  );
  const documents = orderedDrawings
    .filter((d) => filter !== "starred" || d.starred)
    .filter((d) =>
      (d.title + " " + d.path).toLowerCase().includes(search.toLowerCase()),
    );
  const firstRow = Math.max(0, Math.floor(listTop / 84) - 6),
    lastRow = Math.min(
      documents.length,
      Math.ceil((listTop + listViewport) / 84) + 6,
    );
  useEffect(() => {
    if (screen !== "library" || !listRef.current) return;
    const element = listRef.current;
    element.scrollTop = listTop;
    const observer = new ResizeObserver(([entry]) =>
      setListViewport(entry.contentRect.height),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [screen, documents.length > 0]);
  useEffect(() => {
    setListTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [search, filter]);
  const switchDocuments = orderedDrawings.filter((d) =>
    (d.title + " " + d.path).toLowerCase().includes(quickSearch.toLowerCase()),
  );
  const isMac = host?.platform === "darwin",
    mod = isMac ? "⌘" : "Ctrl+";
  const menu = (value: string) => {
    setModal(null);
    setScreen(value as Screen);
  };
  const act = async (
    command: string,
    args: Record<string, any> = {},
    message?: string,
  ) => {
    const result = await request(command, args);
    if (result) {
      if (message) setNotice(message);
      setModal(null);
    }
    return result;
  };
  const recovery = host?.recovery || [];
  return (
    <div className="app-shell">
      <header className={"titlebar " + (isMac ? "mac" : "")}>
        <div className="titlebar-left">
          <IconButton
            label={screen === "editor" ? "Your drawings" : "Back to drawing"}
            onClick={() => {
              if (screen === "editor") setScreen("library");
              else if (active) setScreen("editor");
              else setScreen("library");
            }}
          >
            {screen === "editor" ? (
              <PanelLeft size={17} />
            ) : active ? (
              <ArrowLeft size={17} />
            ) : (
              <PanelLeft size={17} />
            )}
          </IconButton>
          {active ? (
            <button
              className="drawing-title"
              onClick={() => {
                setName(active.title);
                setModal("document");
              }}
            >
              <span>{active.title}</span>
              <ChevronDown size={13} />
            </button>
          ) : (
            <span className="app-name">agent-excalidraw</span>
          )}
        </div>
        <div className="titlebar-right">
          {active && (
            <button
              className={
                "save-status " + ((host as any)?.saveError ? "has-error" : "")
              }
              disabled={saving || busy}
              onClick={save}
            >
              {active.readOnly ? (
                "Read-only"
              ) : saving ? (
                "Saving…"
              ) : (host as any)?.saveError ? (
                <>
                  <AlertCircle size={13} />
                  Couldn’t save
                </>
              ) : dirty ? (
                <>
                  <span className="dirty-dot" />
                  Unsaved changes
                </>
              ) : (
                <>
                  <Check size={13} />
                  Saved
                </>
              )}
            </button>
          )}
          <IconButton
            label={`Find a drawing (${mod}P)`}
            onClick={() => {
              setQuickSearch("");
              setModal("search");
            }}
          >
            <Search size={17} />
          </IconButton>
          <button
            className={"agent-button " + (host?.agent.working ? "working" : "")}
            onClick={() =>
              setScreen(screen === "agents" && active ? "editor" : "agents")
            }
          >
            <span className="agent-dot" />
            {host?.agent.working ? "Agent working" : "Agents"}
          </button>
        </div>
      </header>
      {error &&
        !(
          modal === "missing" &&
          error.includes("no longer at its saved location")
        ) &&
        !(
          (host as any)?.external?.changed && error.includes("changed outside")
        ) && (
          <div className="error-banner" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            {active &&
              (host as any)?.saveError &&
              !error.includes("no longer at its saved location") && (
                <button onClick={() => request("save-as")}>Save a copy…</button>
              )}
            <IconButton
              label="Dismiss message"
              onClick={() => {
                setError(null);
                void request("dismiss-error");
              }}
            >
              <X size={15} />
            </IconButton>
          </div>
        )}
      {((host as any)?.external?.changed ||
        (host as any)?.external?.missing) && (
        <div className="conflict-banner" role="alert">
          <AlertCircle size={15} />
          <span>
            {(host as any).external.missing
              ? "This file is no longer at its saved location."
              : "This drawing changed outside the app."}
          </span>
          <button onClick={() => request("save-as")}>Save a copy…</button>
          {(host as any).external.missing && (
            <button onClick={() => request("locate", { id: active?.id })}>
              Locate file…
            </button>
          )}
          {!(host as any).external.missing && (
            <button onClick={() => request("reload")}>Reload file…</button>
          )}
        </div>
      )}
      {active?.readOnly && (
        <div className="read-only-banner" role="status">
          <File size={15} />
          <span>
            This drawing is read-only. Save a separate copy to edit it.
          </span>
          <button onClick={() => request("save-as")}>Save a copy…</button>
        </div>
      )}
      <div
        className="workspace"
        onDragOverCapture={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.kind === "file"))
            e.preventDefault();
        }}
        onDropCapture={(e) => {
          const file = [...e.dataTransfer.files].find((f) =>
            f.name.endsWith(".excalidraw"),
          );
          if (file) {
            e.preventDefault();
            e.stopPropagation();
            void open(bridge.pathForFile(file));
          }
        }}
      >
        {screen === "library" && (
          <aside className="sidebar">
            <div className="side-brand">
              <span className="brand-mark">a</span>
              <span>Your space</span>
            </div>
            <button
              className={filter === "recent" ? "nav active" : "nav"}
              onClick={() => {
                setFilter("recent");
                setSelectedFolder(null);
                setSearch("");
              }}
            >
              <File size={16} />
              Recent drawings
            </button>
            <button
              className={filter === "starred" ? "nav active" : "nav"}
              onClick={() => {
                setFilter("starred");
                setSelectedFolder(null);
                setSearch("");
              }}
            >
              <Star size={16} />
              Starred
            </button>
            <div className="side-section">FOLDERS</div>
            {host?.settings.folders.map((folder) => (
              <div className="folder-row" key={folder}>
                <button
                  title={folder}
                  onClick={() => {
                    setSearch(folder);
                    setSelectedFolder(folder);
                    setFilter("recent");
                  }}
                >
                  <FolderOpen size={15} />
                  <span>{folder.split(/[\\/]/).pop()}</span>
                </button>
                <IconButton
                  label="Remove folder from library"
                  onClick={() => request("folder-remove", { path: folder })}
                >
                  <X size={13} />
                </IconButton>
              </div>
            ))}
            <button className="nav muted" onClick={() => request("folder-add")}>
              <FolderPlus size={16} />
              Add folder…
            </button>
            <div className="side-bottom">
              <button className="nav" onClick={() => setScreen("agents")}>
                <Terminal size={16} />
                Use with an agent
              </button>
              <button className="nav" onClick={() => setScreen("settings")}>
                <SettingsIcon size={16} />
                Settings
              </button>
              <button className="nav muted" onClick={() => setScreen("help")}>
                Getting started <ArrowUpRight size={14} />
              </button>
            </div>
          </aside>
        )}
        <main
          className={
            "main-content " +
            (screen === "library"
              ? "library-host"
              : screen === "editor"
                ? ""
                : "scrolled-page")
          }
        >
          <div
            className={
              "editor-container " +
              (screen === "editor" && active ? "" : "concealed")
            }
            aria-hidden={screen !== "editor" || !active}
            inert={screen !== "editor" || !active ? true : undefined}
          >
            {shapeLoaded && (
              <Excalidraw
                initialData={{ libraryItems: shapeLibrary }}
                onLibraryChange={(items) => {
                  void request("shape-library-set", { items });
                }}
                excalidrawAPI={setApi}
                onChange={(elements, state, files) =>
                  controller.current?.onChange(elements, state, files)
                }
                theme={resolvedTheme}
                name={active?.title}
                viewModeEnabled={!!active?.readOnly}
                handleKeyboardGlobally={false}
                detectScroll={false}
                autoFocus={false}
                validateEmbeddable={() => false}
                UIOptions={{
                  canvasActions: {
                    loadScene: false,
                    saveToActiveFile: false,
                    export: false,
                    saveAsImage: false,
                    toggleTheme: false,
                  },
                }}
                onLinkOpen={(element, event) => {
                  if (element.link?.startsWith("#")) return;
                  event.preventDefault();
                  if (element.link)
                    void request("open-link", { url: element.link });
                }}
                renderTopRightUI={() => null}
              >
                <MainMenu>
                  <MainMenu.Item
                    onSelect={() => request("save")}
                    icon={<Check size={16} />}
                    shortcut={mod + "S"}
                  >
                    Save drawing
                  </MainMenu.Item>
                  <MainMenu.Item
                    onSelect={() => setModal("export")}
                    icon={<Download size={16} />}
                  >
                    Export…
                  </MainMenu.Item>
                  <MainMenu.DefaultItems.ChangeCanvasBackground />
                  <MainMenu.DefaultItems.ClearCanvas />
                  <MainMenu.DefaultItems.Help />
                </MainMenu>
                <WelcomeScreen>
                  <WelcomeScreen.Center>
                    <WelcomeScreen.Center.Heading>
                      Make room for your next idea.
                    </WelcomeScreen.Center.Heading>
                  </WelcomeScreen.Center>
                </WelcomeScreen>
              </Excalidraw>
            )}
          </div>
          {screen === "welcome" && (
            <section className="welcome-screen">
              <div className="welcome-art" aria-hidden="true">
                <div className="paper paper-back" />
                <div className="paper paper-front">
                  <span>What if…</span>
                  <div className="little-line" />
                  <div className="little-line short" />
                </div>
                <div className="ink-arrow">↗</div>
              </div>
              <span className="eyebrow">AGENT EXCALIDRAW</span>
              <h1>
                A little space for
                <br />
                your next idea.
              </h1>
              <p>Draw here. Keep the files wherever you want.</p>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={makeNew}
                  disabled={busy || !api}
                >
                  <Plus size={17} />
                  New drawing
                </button>
                <button
                  className="secondary"
                  onClick={() => open()}
                  disabled={busy || !api}
                >
                  <FolderOpen size={17} />
                  Open drawing
                </button>
              </div>
              <button
                className="text-button"
                onClick={() => setScreen("agents")}
              >
                Use with an agent <ArrowUpRight size={14} />
              </button>
              <div className="welcome-foot">
                No account. Works offline. Yours to keep.
              </div>
            </section>
          )}
          {screen === "library" && (
            <section className="library">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR SPACE</span>
                  <h1>
                    {selectedFolder
                      ? selectedFolder.split(/[\\/]/).pop()
                      : "Your drawings"}
                  </h1>
                  <p>
                    {selectedFolder
                      ? "New drawings will be saved in this folder."
                      : "A place for ideas in progress."}
                  </p>
                </div>
                <button className="primary" onClick={makeNew} disabled={busy}>
                  <Plus size={17} />
                  New drawing
                </button>
              </div>
              {recovery.length > 0 && (
                <button
                  className="recovery-banner"
                  onClick={() => setModal("recovery")}
                >
                  <RotateCcw size={17} />
                  <span>
                    {recovery.length} unsaved{" "}
                    {recovery.length === 1 ? "drawing" : "drawings"} can be
                    recovered
                  </span>
                  <ArrowRight size={16} />
                </button>
              )}
              <div className="library-search">
                <Search size={17} />
                <input
                  aria-label="Search drawings"
                  placeholder="Find a drawing…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <kbd>{mod}P</kbd>
              </div>
              <div className="list-header">
                <span>Drawing</span>
                <span>Last opened</span>
              </div>
              {documents.length ? (
                <div
                  className="drawing-list"
                  role="list"
                  ref={listRef}
                  style={{ height: documents.length * 84 }}
                  onScroll={(e) => setListTop(e.currentTarget.scrollTop)}
                >
                  <div
                    style={{
                      height: documents.length * 84,
                      position: "relative",
                    }}
                  >
                    {documents.slice(firstRow, lastRow).map((d, index) => (
                      <div
                        className="drawing-row"
                        role="listitem"
                        aria-setsize={documents.length}
                        aria-posinset={firstRow + index + 1}
                        style={{
                          position: "absolute",
                          top: (firstRow + index) * 84,
                          width: "100%",
                          height: 84,
                        }}
                        key={d.id}
                      >
                        <button
                          className="open-drawing"
                          onClick={() => open(d.path)}
                        >
                          <span className="file-glyph">
                            <File size={22} />
                          </span>
                          <span className="drawing-info">
                            <strong>{d.title}</strong>
                            <span title={d.path}>{d.path}</span>
                          </span>
                        </button>
                        <time>
                          {d.missing
                            ? "Missing"
                            : d.lastOpened > 0
                              ? drawingDate.format(d.lastOpened)
                              : "Not opened"}
                        </time>
                        <IconButton
                          label={d.starred ? "Unstar drawing" : "Star drawing"}
                          className={d.starred ? "starred" : ""}
                          onClick={() =>
                            request("star", { id: d.id, value: !d.starred })
                          }
                        >
                          <Star
                            size={15}
                            fill={d.starred ? "currentColor" : "none"}
                          />
                        </IconButton>
                        <IconButton
                          label={"More actions for " + d.title}
                          onClick={() => {
                            setName(d.id);
                            setModal("row");
                          }}
                        >
                          <MoreHorizontal size={17} />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty-list">
                  <File size={30} />
                  <h2>
                    {search
                      ? "No matching drawings"
                      : filter === "starred"
                        ? "Keep your favorites close."
                        : "Your first idea starts here."}
                  </h2>
                  <p>
                    {search
                      ? "Try another name or location."
                      : filter === "starred"
                        ? "Star a drawing to find it here."
                        : "Create a drawing, or open one you already have."}
                  </p>
                  {!search && filter !== "starred" && (
                    <button className="secondary" onClick={() => open()}>
                      Open drawing…
                    </button>
                  )}
                </div>
              )}
              <footer className="library-footer">
                <span>
                  {documents.length}{" "}
                  {documents.length === 1 ? "drawing" : "drawings"} · Files stay
                  at their original locations
                </span>
                {selectedFolder && (
                  <button
                    onClick={() =>
                      request("folder-add", { path: selectedFolder }).then(
                        (result) => {
                          if (result) setNotice("Folder index refreshed.");
                        },
                      )
                    }
                  >
                    Refresh folder
                  </button>
                )}
                <button onClick={() => request("folder-add")}>
                  Add folder <Plus size={13} />
                </button>
              </footer>
            </section>
          )}
          {screen === "agents" && (
            <section className="settings-page agents-page">
              <button
                className="back-link"
                onClick={() => setScreen(active ? "editor" : "library")}
              >
                <ArrowLeft size={14} />
                Back to your space
              </button>
              <span className="eyebrow">A SECOND PAIR OF HANDS</span>
              <h1>
                Your agent.
                <br />
                The same canvas.
              </h1>
              <p className="intro">
                Use the coding agent you already work with to sketch, arrange
                and refine. You stay in control of the drawing.
              </p>
              <div className="agent-current">
                <span className="agent-dot" />
                <strong>
                  {host?.agent.working
                    ? "Agent working"
                    : host?.agent.paused
                      ? "Agent paused"
                      : host?.agent.lastUsed
                        ? "Last used " +
                          new Date(host.agent.lastUsed).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Ready when you are"}
                </strong>
                <span className="grow" />
                {host?.agent.session && (
                  <button
                    onClick={() =>
                      request(host.agent.paused ? "resume" : "stop")
                    }
                  >
                    {host.agent.paused ? "Resume changes" : "Stop changes"}
                  </button>
                )}
              </div>
              <div className="setup-step">
                <span className="step-number">
                  {setup?.cli ? <Check size={16} /> : 1}
                </span>
                <div>
                  <h3>Make the CLI available</h3>
                  <p>
                    No MCP setup required. The CLI uses your local desktop app.
                  </p>
                  <code>agent-excalidraw --help</code>
                  <div className="button-row">
                    <button
                      className="secondary"
                      onClick={() =>
                        request("install-cli").then((result) => {
                          if (result) {
                            setSetup(result);
                            setNotice(
                              result.message || "CLI launcher installed.",
                            );
                          }
                        })
                      }
                    >
                      Install local launcher
                    </button>
                    <span className="small muted">
                      Uses the app’s bundled runtime
                    </span>
                  </div>
                  {setup?.cliPath && (
                    <span className="filepath">{setup.cliPath}</span>
                  )}
                </div>
              </div>
              <div className="setup-step">
                <span className="step-number">
                  {setup?.skill ? <Check size={16} /> : 2}
                </span>
                <div>
                  <h3>Give your agent the skill</h3>
                  <p>One skill, linked into the agents you use.</p>
                  <code>agent-excalidraw skills install</code>
                  <button
                    className="secondary"
                    onClick={() =>
                      request("install-skill").then(async (result) => {
                        if (result) {
                          const installed = await request("integration-status");
                          if (installed) setSetup(installed);
                          setNotice(
                            "Skill installed. Start a new agent session to discover it.",
                          );
                        }
                      })
                    }
                  >
                    Install skill for Codex & Claude Code
                  </button>
                  <span className="small muted block">
                    Existing unrelated skills are preserved.
                  </span>
                </div>
              </div>
              <div className="setup-step">
                <span className="step-number">3</span>
                <div>
                  <h3>Ask for your first drawing</h3>
                  <div className="prompt-example">
                    “Use agent-excalidraw to sketch my onboarding flow.”
                  </div>
                  <p>
                    Status updates after a real tool call. Start a new agent
                    session if the skill was just installed.
                  </p>
                </div>
              </div>
              <div className="setting-row stacked">
                <h3>Installed on this computer</h3>
                <p className="small muted">
                  {setup?.cli ? "CLI launcher" : "CLI destination"}
                </p>
                <span className="filepath">
                  {setup?.cliPath || "Checking…"}
                </span>
                <p className="small muted">Canonical skill source</p>
                <span className="filepath">
                  {setup?.canonical || "Checking…"}
                </span>
                {setup?.links?.map((link: any) => (
                  <span className="filepath small" key={link.host}>
                    {link.host}: {link.path}
                    {link.installed ? " · linked" : ""}
                  </span>
                ))}
                {(setup?.cli || setup?.skill) && (
                  <button
                    className="secondary"
                    onClick={() => setModal("disconnect")}
                  >
                    Disconnect integrations…
                  </button>
                )}
              </div>
              <div className="privacy-note">
                <span>Files stay local. Your agent is separate.</span>
                <p>
                  Agents run in your existing tools. Content they read is
                  handled by that tool’s provider.
                </p>
              </div>
              <button className="text-button" onClick={() => setModal("mcp")}>
                Prefer MCP? Configure it separately <ArrowUpRight size={14} />
              </button>
            </section>
          )}
          {screen === "settings" && (
            <section className="settings-page">
              <button
                className="back-link"
                onClick={() => setScreen(active ? "editor" : "library")}
              >
                <ArrowLeft size={14} />
                Back to your space
              </button>
              <span className="eyebrow">THE LITTLE THINGS</span>
              <h1>Make yourself at home.</h1>
              <div className="setting-row">
                <div>
                  <h3>Appearance</h3>
                  <p>Choose the look of your workspace.</p>
                </div>
                <div className="segmented">
                  {(
                    [
                      ["system", Monitor],
                      ["light", Sun],
                      ["dark", Moon],
                    ] as const
                  ).map(([theme, Icon]) => (
                    <button
                      aria-label={theme + " appearance"}
                      aria-pressed={host?.settings.theme === theme}
                      key={theme}
                      onClick={() => request("settings", { theme })}
                    >
                      <Icon size={16} />
                      <span>{theme}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row stacked">
                <h3>New drawings go here</h3>
                <span className="filepath">{host?.settings.defaultFolder}</span>
                <button
                  className="secondary"
                  onClick={() =>
                    request("settings", { defaultFolder: "choose" })
                  }
                >
                  Choose folder…
                </button>
                <p>
                  Applies to new drawings. Existing files stay where they are.
                </p>
              </div>
              <div className="setting-row">
                <div>
                  <h3>Save changes automatically</h3>
                  <p>Recovery snapshots are kept separately.</p>
                </div>
                <label className="toggle">
                  <input
                    aria-label="Save changes automatically"
                    type="checkbox"
                    checked={host?.settings.autosave || false}
                    onChange={(e) =>
                      request("settings", { autosave: e.target.checked })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className="setting-row stacked">
                <h3>Local recovery</h3>
                <p>
                  {recovery.length
                    ? `${recovery.length} unsaved recovery ${recovery.length === 1 ? "snapshot" : "snapshots"} available.`
                    : "Unsaved work is backed up locally while you draw."}
                </p>
                <button
                  className="secondary"
                  onClick={() => setModal("recovery")}
                >
                  Review recovery…
                </button>
              </div>
              <div className="setting-row stacked">
                <h3>App data on this computer</h3>
                <span className="filepath">
                  {setup?.dataDir || "Checking…"}
                </span>
                <p>
                  Settings, recovery snapshots, shape library and temporary
                  agent previews. Your drawing files stay at their own
                  locations.
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => request("reveal-data")}
                  >
                    Show app data
                  </button>
                  <button onClick={() => setModal("clear-previews")}>
                    Clear agent previews…
                  </button>
                </div>
                <p className="small muted">
                  To uninstall, quit the app and remove it using your operating
                  system. Disconnect integrations first. To remove all app data,
                  review recovery copies, quit, then remove this folder
                  explicitly.
                </p>
              </div>
              <div className="setting-row stacked">
                <h3>
                  Agent Excalidraw{" "}
                  <span className="muted">{host?.version}</span>
                </h3>
                <p>
                  Independent project, built with Excalidraw. No background
                  network checks.
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => request("update-check").then(setUpdate)}
                  >
                    Check for updates
                  </button>
                  <button onClick={() => request("open-notices")}>
                    Third-party notices
                  </button>
                  <button onClick={() => setScreen("help")}>
                    Keyboard & help <ArrowUpRight size={14} />
                  </button>
                </div>
                {update && (
                  <p role="status">
                    {update.message ||
                      (update.available
                        ? "Version " + update.version + " is available."
                        : "You are on the latest release.")}
                    {update.available && (
                      <button onClick={() => request("open-releases")}>
                        Open releases
                      </button>
                    )}
                  </p>
                )}
              </div>
            </section>
          )}
          {screen === "help" && (
            <section className="settings-page">
              <button
                className="back-link"
                onClick={() => setScreen(active ? "editor" : "library")}
              >
                <ArrowLeft size={14} />
                Back to your space
              </button>
              <span className="eyebrow">A LITTLE ORIENTATION</span>
              <h1>Room to think.</h1>
              <p className="intro">
                A drawing is a file. Your library helps you find it. Your agent
                can work beside you.
              </p>
              <div className="help-section">
                <h3>Start with a shape</h3>
                <p>
                  Choose a tool from the canvas toolbar, then draw. Connect
                  shapes with arrows. Double-click a shape to add a label. Hold
                  Space and drag to pan.
                </p>
              </div>
              <div className="help-section">
                <h3>Know where your work lives</h3>
                <p>
                  Click the drawing title to see its full path, rename, move or
                  reveal it. {mod}S saves there. Export creates another file.
                </p>
              </div>
              <div className="help-section">
                <h3>Unsaved is different from recovered</h3>
                <p>
                  Save writes your drawing. Private recovery snapshots protect
                  recent unsaved work. After a crash, restore a copy without
                  replacing the original.
                </p>
              </div>
              <div className="help-section">
                <h3>Keep the canvas yours</h3>
                <p>
                  Your agent sees stable shape IDs and edits the live drawing.
                  If your work changed while it was planning, stale edits are
                  refused. Stop changes in Agents to pause a session.
                </p>
                <button
                  className="secondary"
                  onClick={() => setScreen("agents")}
                >
                  Set up your agent <ArrowRight size={15} />
                </button>
              </div>
              <div className="shortcut-list">
                {[
                  [mod + "N", "New drawing"],
                  [mod + "O", "Open drawing"],
                  [mod + "S", "Save"],
                  [mod + "⇧S", "Save As"],
                  [mod + "P", "Find a drawing"],
                  [mod + "Z", "Undo"],
                  ["Space + drag", "Pan the canvas"],
                  ["?", "Excalidraw shortcuts"],
                ].map(([keys, label]) => (
                  <div key={keys}>
                    <span>{label}</span>
                    <kbd>{keys}</kbd>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          <span>{notice}</span>
          <IconButton
            label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={13} />
          </IconButton>
        </div>
      )}
      {modal === "document" && active && (
        <Modal title="Your drawing" onClose={() => setModal(null)}>
          <form onSubmit={rename}>
            <label htmlFor="drawing-name">Name</label>
            <input
              id="drawing-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
            <div className="location-label">LOCATION</div>
            <p className="filepath">{active.path}</p>
            <div className="button-row">
              <button className="primary" disabled={busy}>
                Rename
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => request("reveal")}
              >
                {isMac
                  ? "Show in Finder"
                  : host?.platform === "win32"
                    ? "Show in Explorer"
                    : "Show in file manager"}
                <ArrowUpRight size={14} />
              </button>
              <IconButton
                type="button"
                label="Copy path"
                onClick={() =>
                  request("copy-path").then(() => setNotice("Path copied"))
                }
              >
                <Copy size={16} />
              </IconButton>
            </div>
          </form>
          <div className="menu-list">
            <button onClick={() => act("move")}>
              Move…
              <ArrowRight size={15} />
            </button>
            <button
              onClick={() =>
                act(
                  "duplicate",
                  {},
                  "A separate copy was created. Your original drawing stays open.",
                )
              }
            >
              Duplicate
              <File size={15} />
            </button>
            <button onClick={() => act("save-as")}>
              Save As…
              <ArrowUpRight size={15} />
            </button>
            <button onClick={() => setModal("export")}>
              Export…
              <Download size={15} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "search" && (
        <Modal title="Go to a drawing" onClose={() => setModal(null)}>
          <div className="library-search">
            <Search size={17} />
            <input
              ref={searchRef}
              aria-label="Find a drawing"
              placeholder="Search names and locations…"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
            />
          </div>
          <div className="switch-results">
            {switchDocuments.slice(0, 15).map((d) => (
              <button key={d.id} onClick={() => open(d.path)}>
                <File size={17} />
                <span>
                  <strong>{d.title}</strong>
                  <small>{d.path}</small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
            {!switchDocuments.length && (
              <p className="muted">No matching drawings.</p>
            )}
            <button onClick={makeNew}>
              <Plus size={17} />
              New drawing
            </button>
            <button onClick={() => open()}>
              <FolderOpen size={17} />
              Open drawing…
            </button>
          </div>
        </Modal>
      )}
      {modal === "disconnect" && (
        <Modal title="Disconnect your agents?" onClose={() => setModal(null)}>
          <p className="muted">
            Remove this app’s local CLI launcher and owned skill links for
            Agents, Codex and Claude Code. Your drawings, recovery copies and
            unrelated configuration stay in place.
          </p>
          <p className="filepath">{setup?.cliPath}</p>
          {setup?.links
            ?.filter((link: any) => link.installed)
            .map((link: any) => (
              <p className="filepath small" key={link.host}>
                {link.path}
              </p>
            ))}
          <p className="small muted">
            Any MCP configuration you added manually must be removed in that
            agent host.
          </p>
          <div className="button-row">
            <button
              className="secondary danger"
              disabled={busy}
              onClick={() =>
                request("remove-integrations").then((result) => {
                  if (result) {
                    setSetup(result);
                    setModal(null);
                    setNotice(result.message);
                  }
                })
              }
            >
              Disconnect integrations
            </button>
            <button onClick={() => setModal(null)}>Keep connected</button>
          </div>
        </Modal>
      )}
      {modal === "clear-previews" && (
        <Modal
          title="Clear temporary agent previews?"
          onClose={() => setModal(null)}
        >
          <p className="muted">
            Remove PNG and SVG previews generated for agents. Agents may need to
            render them again. Drawing files and recovery snapshots stay in
            place.
          </p>
          <p className="filepath">{setup?.dataDir}/previews</p>
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act("clear-previews", {}, "Temporary previews cleared.")
              }
            >
              Clear previews
            </button>
            <button onClick={() => setModal(null)}>Keep previews</button>
          </div>
        </Modal>
      )}
      {modal === "missing" && (
        <Modal
          title="Where did this drawing go?"
          onClose={() => setModal(null)}
        >
          <p className="muted">
            We can’t find this drawing at its saved location. If you moved it,
            choose its new location.
          </p>
          <p className="filepath">{name}</p>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => act("locate", { path: name })}
            >
              Locate file…
            </button>
            <button
              onClick={() => {
                const drawing = host?.drawings.find((d) => d.path === name);
                if (drawing) void act("forget", { id: drawing.id });
                else setModal(null);
              }}
            >
              Remove reference
            </button>
            <button onClick={() => setModal(null)}>Cancel</button>
          </div>
          <p className="small muted">
            Removing a reference keeps files on disk.
          </p>
        </Modal>
      )}
      {modal === "row" && (
        <Modal
          title={
            host?.drawings.find((d) => d.id === name)?.title ||
            "Drawing actions"
          }
          onClose={() => setModal(null)}
        >
          <p className="filepath">
            {host?.drawings.find((d) => d.id === name)?.path}
          </p>
          <div className="menu-list">
            <button onClick={() => act("forget", { id: name })}>
              Remove from recents
              <X size={15} />
            </button>
            <p className="small muted">
              Removing a reference keeps the file on disk.
            </p>
            <button
              className="danger"
              onClick={() => act("trash", { id: name })}
            >
              Move file to{" "}
              {host?.platform === "win32" ? "Recycle Bin" : "Trash"}
              <Trash2 size={15} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "recovery" && (
        <Modal title="A thought worth keeping." onClose={() => setModal(null)}>
          <p className="muted">
            Restore unsaved work as a separate copy. Your original files stay
            unchanged.
          </p>
          {recovery.length ? (
            recovery.map((r) => (
              <div className="recovery-item" key={r.id}>
                <span className="filepath">{r.path}</span>
                <p className="small muted">
                  Snapshot · {new Date(r.time).toLocaleString()}
                </p>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      act("recovery-restore", { id: r.id }).then((r) => {
                        if (r) setScreen("editor");
                      })
                    }
                  >
                    Restore a copy
                  </button>
                  <button
                    onClick={() => {
                      setName(r.id);
                      setModal("discard-recovery");
                    }}
                  >
                    Discard…
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-list">
              <Check size={25} />
              <p>No unsaved recovery snapshots.</p>
            </div>
          )}
        </Modal>
      )}
      {modal === "discard-recovery" && (
        <Modal
          title="Discard this recovery copy?"
          onClose={() => setModal("recovery")}
        >
          <p className="muted">
            This removes only the unsaved recovery snapshot. Your drawing file
            stays unchanged.
          </p>
          <div className="button-row">
            <button
              className="danger secondary"
              onClick={() => act("recovery-discard", { id: name })}
            >
              Discard recovery
            </button>
            <button onClick={() => setModal("recovery")}>Keep it</button>
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal
          title="Take your drawing with you."
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await request("export", {
                previewToken: exportPreview?.previewToken,
              });
              if (result) {
                setModal(null);
                setNotice("Exported to " + result.path);
              }
            }}
          >
            <div className="export-preview" aria-live="polite">
              {previewError ? (
                <p role="alert">{previewError}</p>
              ) : exportPreview?.dataURL &&
                !exportPreview.dataURL.endsWith(",") ? (
                <img
                  src={exportPreview.dataURL}
                  alt="Captured drawing export preview"
                />
              ) : (
                <p>{exportPreview ? "Empty drawing" : "Preparing preview…"}</p>
              )}
            </div>
            {exportPreview && (
              <p className="small muted">
                Revision {exportPreview.revision}
                {exportPreview.width
                  ? " · " +
                    exportPreview.width +
                    " × " +
                    exportPreview.height +
                    " px"
                  : ""}
                . Export saves this preview’s captured drawing.
              </p>
            )}
            <label htmlFor="export-format">Format</label>
            <select
              id="export-format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option value="png">PNG image</option>
              <option value="svg">SVG image</option>
              <option value="excalidraw">Excalidraw file</option>
            </select>
            {format !== "excalidraw" && (
              <>
                <label htmlFor="export-scope">Area</label>
                <select
                  id="export-scope"
                  value={exportScope}
                  onChange={(e) => setExportScope(e.target.value)}
                >
                  <option value="all">Whole drawing</option>
                  <option value="selection">Selected elements</option>
                </select>
                {format === "png" && (
                  <>
                    <label htmlFor="export-scale">Resolution</label>
                    <select
                      id="export-scale"
                      value={exportScale}
                      onChange={(e) => setExportScale(Number(e.target.value))}
                    >
                      <option value={1}>1× · Standard</option>
                      <option value={2}>2× · High resolution</option>
                      <option value={4}>4× · Extra high resolution</option>
                    </select>
                  </>
                )}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={background}
                    onChange={(e) => setBackground(e.target.checked)}
                  />
                  Include canvas background
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={embedded}
                    onChange={(e) => setEmbedded(e.target.checked)}
                  />
                  Include editable drawing
                </label>
                <p className="small muted">
                  Anyone with an editable export can reopen its original drawing
                  data.
                </p>
                {format === "svg" && (
                  <p className="small muted">
                    SVG keeps vector elements, links and original image
                    resources. Choose PNG to share only rendered pixels.
                  </p>
                )}
              </>
            )}
            <div className="button-row">
              <button className="primary" disabled={busy || !exportPreview}>
                <Download size={16} />
                {busy ? "Exporting…" : "Export…"}
              </button>
              {format === "svg" && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !exportPreview}
                  onClick={() =>
                    request("copy-svg", {
                      previewToken: exportPreview?.previewToken,
                    }).then((result) => {
                      if (result) {
                        setModal(null);
                        setNotice("SVG copied.");
                      }
                    })
                  }
                >
                  Copy SVG
                </button>
              )}
              <button type="button" onClick={() => setModal(null)}>
                Cancel
              </button>
            </div>
            <p className="small muted export-note">
              Export does not save unsaved changes to your drawing.
            </p>
          </form>
        </Modal>
      )}
      {modal === "mcp" && (
        <Modal title="MCP, if you prefer." onClose={() => setModal(null)}>
          <p className="muted">
            The same tools, exposed to MCP-compatible clients. Add this server
            using your host’s configuration.
          </p>
          <pre>
            {JSON.stringify(
              {
                mcpServers: {
                  "agent-excalidraw": {
                    command: "agent-excalidraw",
                    args: ["mcp"],
                  },
                },
              },
              null,
              2,
            )}
          </pre>
          <p className="small muted">
            Configuration alone does not connect a host. The CLI works
            independently before and after MCP registration.
          </p>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
