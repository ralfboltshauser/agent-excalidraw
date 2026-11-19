import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  Bridge,
  Request,
  SceneCall,
  Reply,
  HostState,
} from "../shared/types.js";
const bridge: Bridge = {
  initialTheme: process.argv.includes("--agent-excalidraw-theme=dark")
    ? "dark"
    : "light",
  invoke: (request: Request) => ipcRenderer.invoke("command", request),
  onSceneCommand: (listener) => {
    const fn = (_: unknown, call: SceneCall) => listener(call);
    ipcRenderer.on("scene-command", fn);
    return () => ipcRenderer.removeListener("scene-command", fn);
  },
  replyScene: (id: string, reply: Reply) =>
    ipcRenderer.send("scene-reply", { id, reply }),
  onHostState: (listener) => {
    const fn = (_: unknown, state: HostState) => listener(state);
    ipcRenderer.on("host-state", fn);
    return () => ipcRenderer.removeListener("host-state", fn);
  },
  notifyChange: (data) => ipcRenderer.send("scene-change", data),
  onUiAction: (listener) => {
    const fn = (_: unknown, action: string) => listener(action);
    ipcRenderer.on("ui-action", fn);
    return () => ipcRenderer.removeListener("ui-action", fn);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  ready: () => ipcRenderer.send("renderer-ready"),
};
contextBridge.exposeInMainWorld("agentExcalidraw", bridge);
