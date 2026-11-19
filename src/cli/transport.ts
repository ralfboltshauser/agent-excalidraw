import { connect } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Request, Reply } from "../shared/types.js";
import { AppError } from "../shared/types.js";

import packageInfo from "../../package.json";
export const VERSION = packageInfo.version;
export const PROTOCOL = 1;
export function dataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  os = platform(),
  home = homedir(),
) {
  return (
    env.AGENT_EXCALIDRAW_DATA_DIR ||
    (os === "darwin"
      ? join(home, "Library", "Application Support", "agent-excalidraw")
      : os === "win32"
        ? join(
            env.APPDATA || join(home, "AppData", "Roaming"),
            "agent-excalidraw",
          )
        : join(
            env.XDG_CONFIG_HOME || join(home, ".config"),
            "agent-excalidraw",
          ))
  );
}
export type Endpoint = {
  socket: string;
  token: string;
  pid: number;
  version: string;
  protocol: number;
};
export async function endpoint(dir = dataDirectory()): Promise<Endpoint> {
  const file = join(dir, "endpoint.json");
  try {
    const info = await stat(file);
    if (
      process.platform !== "win32" &&
      ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
    )
      throw new AppError(
        "UNSAFE_ENDPOINT",
        "Endpoint credentials must be owned by your user and readable only by your user.",
      );
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value.protocol !== PROTOCOL)
      throw new AppError(
        "VERSION_MISMATCH",
        `The app uses protocol ${value.protocol}; this CLI uses ${PROTOCOL}. Update the CLI or app without closing unsaved drawings.`,
      );
    if (
      typeof value.socket !== "string" ||
      typeof value.token !== "string" ||
      typeof value.pid !== "number"
    )
      throw new Error("invalid descriptor");
    return value;
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "APP_NOT_RUNNING",
      "Agent Excalidraw is not running. Start the desktop app or run agent-excalidraw install.",
    );
  }
}
export async function send(
  request: Request,
  options: { dir?: string; timeout?: number } = {},
): Promise<Reply> {
  const ep = await endpoint(options.dir);
  return new Promise((resolveReply, reject) => {
    let sent = false,
      done = false,
      buffer = "";
    const socket = connect(ep.socket);
    socket.setEncoding("utf8");
    const finish = (error?: Error, result?: Reply) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) reject(error);
      else resolveReply(result!);
    };
    socket.setTimeout(options.timeout ?? 30000);
    socket.on("connect", () => {
      const payload = JSON.stringify({ ...request, token: ep.token }) + "\n";
      if (Buffer.byteLength(payload) > 8 * 1024 * 1024)
        return finish(
          new AppError(
            "INPUT_TOO_LARGE",
            "Request exceeds 8 MiB. Split the work into smaller batches.",
          ),
        );
      sent = true;
      socket.write(payload);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > 32 * 1024 * 1024)
        return finish(
          new AppError(
            "RESPONSE_TOO_LARGE",
            "Reply exceeded the transport limit. Request a smaller snapshot.",
          ),
        );
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const reply = JSON.parse(buffer.slice(0, newline));
        if (typeof reply.ok !== "boolean")
          throw new Error("missing reply status");
        finish(undefined, reply);
      } catch {
        finish(
          new AppError(
            "INVALID_REPLY",
            "The app returned an invalid reply. Inspect state before retrying a mutation.",
          ),
        );
      }
    });
    socket.on("timeout", () =>
      finish(
        new AppError(
          sent ? "OUTCOME_UNKNOWN" : "APP_UNAVAILABLE",
          sent
            ? "The command may have been applied, but no reply arrived. Inspect operation status using the same request ID and epoch; do not replay blindly."
            : "Could not connect to the desktop app.",
        ),
      ),
    );
    socket.on("error", () =>
      finish(
        new AppError(
          sent ? "OUTCOME_UNKNOWN" : "APP_UNAVAILABLE",
          sent
            ? "The connection closed after sending the command. Reconcile operation status before retrying."
            : "Could not connect to the desktop app. Start the app and try again.",
        ),
      ),
    );
    socket.on("end", () => {
      if (!done)
        finish(
          new AppError(
            sent ? "OUTCOME_UNKNOWN" : "APP_UNAVAILABLE",
            "The app closed the connection before returning a result. Inspect current state before retrying.",
          ),
        );
    });
  });
}
export async function launchApp(): Promise<void> {
  const home = homedir();
  const candidates =
    process.platform === "darwin"
      ? [
          join(
            home,
            "Applications",
            "Agent Excalidraw.app",
            "Contents",
            "MacOS",
            "Agent Excalidraw",
          ),
          "/Applications/Agent Excalidraw.app/Contents/MacOS/Agent Excalidraw",
        ]
      : process.platform === "win32"
        ? [
            join(
              process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
              "Programs",
              "agent-excalidraw",
              "Agent Excalidraw.exe",
            ),
            join(
              process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
              "Programs",
              "Agent Excalidraw",
              "Agent Excalidraw.exe",
            ),
          ]
        : [
            join(
              home,
              ".local",
              "share",
              "agent-excalidraw",
              "Agent Excalidraw.AppImage",
            ),
            "/usr/bin/agent-excalidraw",
            "/opt/Agent Excalidraw/agent-excalidraw",
          ];
  if (process.env.AGENT_EXCALIDRAW_APP)
    candidates.unshift(resolve(process.env.AGENT_EXCALIDRAW_APP));
  let executable: string | undefined,
    args: string[] = [];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        executable = candidate;
        break;
      }
    } catch {}
  }
  if (!executable) {
    try {
      const require = createRequire(import.meta.url);
      const electron = require("electron");
      const root = fileURLToPath(new URL("../../", import.meta.url));
      if (
        typeof electron === "string" &&
        (await stat(join(root, "package.json"))).isFile()
      ) {
        executable = electron;
        args = [root];
      }
    } catch {}
  }
  if (!executable)
    throw new AppError(
      "APP_NOT_INSTALLED",
      "Install the desktop app with agent-excalidraw install, or download it from https://github.com/ralfboltshauser/agent-excalidraw/releases.",
    );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(executable!, args, {
      detached: true,
      stdio: "ignore",
      env,
    });
    child.once("error", () =>
      reject(
        new AppError(
          "APP_LAUNCH_FAILED",
          "The installed desktop app could not start. Open it manually to inspect operating-system messages.",
        ),
      ),
    );
    child.once("spawn", () => {
      child.unref();
      resolveLaunch();
    });
  });
}
export async function requestApp(
  request: Request,
  options: { launch?: boolean; dir?: string; timeout?: number } = {},
): Promise<Reply> {
  try {
    return await send(request, options);
  } catch (error: any) {
    if (
      !options.launch ||
      !["APP_NOT_RUNNING", "APP_UNAVAILABLE"].includes(error.code)
    )
      throw error;
  }
  await launchApp();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      return await send(request, options);
    } catch (error: any) {
      if (!["APP_NOT_RUNNING", "APP_UNAVAILABLE"].includes(error.code))
        throw error;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new AppError(
    "APP_STARTING",
    "The app did not become ready within 20 seconds. Open it manually and run doctor.",
  );
}
