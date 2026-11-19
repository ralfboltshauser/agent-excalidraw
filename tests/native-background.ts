/** Lifecycle regression without renderer CDP, which can keep frames alive. */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
} from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { killOwnedProcessTree } from "./helpers/owned-process";
const execute = promisify(execFile);
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
if (process.platform !== "darwin")
  throw new Error("This native executable probe currently targets macOS.");
const root = await realpath(await mkdtemp("/tmp/ae-native-bg-"));
const outcomes: any[] = [];
for (const mode of ["view", "quit"]) {
  const directory = path.join(root, mode);
  await mkdir(directory);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (
      value !== undefined &&
      !["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key)
    )
      environment[key] = value;
  environment.AGENT_EXCALIDRAW_DATA_DIR = directory;
  environment.AGENT_EXCALIDRAW_BIN_DIR = path.join(directory, "bin");
  environment.AGENTS_HOME = path.join(directory, "agents");
  environment.CODEX_HOME = path.join(directory, "codex");
  environment.CLAUDE_CONFIG_DIR = path.join(directory, "claude");
  const executable =
    process.env.AGENT_EXCALIDRAW_EXECUTABLE ||
    path.join(
      repository,
      "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    );
  const application = spawn(
    executable,
    process.env.AGENT_EXCALIDRAW_EXECUTABLE
      ? ["--inspect=0"]
      : ["--inspect=0", "."],
    {
      cwd: repository,
      env: environment,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let inspectorUrl: string | undefined;
  application.stderr?.on("data", (chunk) => {
    const match = String(chunk).match(/ws:\/\/127\.0\.0\.1:\d+\/[-a-f0-9]+/i);
    if (match) inspectorUrl = match[0];
  });
  let savedBytes: Buffer | undefined;
  const drawingPath = path.join(
    directory,
    "Saved background drawing.excalidraw",
  );
  async function cli(command: string, payload: any = {}, timeout = 10_000) {
    const input = path.join(directory, `input-${command}-${Date.now()}.json`);
    await writeFile(input, JSON.stringify(payload));
    const { stdout } = await execute(
      process.execPath,
      [
        path.join(repository, "dist/cli/index.js"),
        command,
        "--json",
        "--no-launch",
        "--input",
        input,
      ],
      { cwd: repository, env: environment, timeout },
    );
    const reply = JSON.parse(stdout);
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.result;
  }
  try {
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        await readFile(path.join(directory, "endpoint.json"));
        break;
      } catch {
        if (Date.now() > deadline)
          throw new Error("Owned app did not publish its endpoint");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    await cli("new", { path: drawingPath, title: "Saved background drawing" });
    let scene = await cli("snapshot");
    await cli("apply", {
      document: scene.document,
      epoch: scene.epoch,
      expectedRevision: scene.revision,
      requestId: `native-${mode}`,
      operations: [
        {
          op: "create",
          type: "rectangle",
          x: 200,
          y: 200,
          width: 200,
          height: 100,
          label: "Remain safe in the background",
        },
      ],
    });
    scene = await cli("snapshot");
    const target = { document: scene.document, epoch: scene.epoch };
    await cli("save", target);
    savedBytes = await readFile(drawingPath);
    // Attach only to Node/main to hide the real BrowserWindow. Never attach
    // renderer CDP, alter RAF, or modify SDK APIs. Disconnect before domain ops.
    assert.ok(
      inspectorUrl,
      "Owned main process inspector did not publish a URL",
    );
    const socket = new WebSocket(inspectorUrl);
    const visibility = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Main inspector hide timed out")),
        5_000,
      );
      socket.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.addEventListener("open", () =>
        socket.send(
          JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: {
              expression: `(async()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');const w=e.BrowserWindow.getAllWindows()[0];w.minimize();await new Promise(r=>setTimeout(r,400));w.hide();await new Promise(r=>setTimeout(r,1000));return {visible:w.isVisible(),state:await w.webContents.executeJavaScript('document.visibilityState')}})()`,
              awaitPromise: true,
              returnByValue: true,
            },
          }),
        ),
      );
      socket.addEventListener("message", ({ data }) => {
        const reply = JSON.parse(String(data));
        if (reply.id !== 1) return;
        clearTimeout(timer);
        if (reply.error || reply.result?.exceptionDetails)
          reject(new Error(JSON.stringify(reply)));
        else resolve(reply.result.result.value);
      });
    });
    const disconnected = new Promise<void>((resolve) =>
      socket.addEventListener("close", () => resolve()),
    );
    socket.close();
    await disconnected;
    assert.equal(visibility.visible, false);
    const started = Date.now();
    if (mode === "view") {
      const reply = await cli(
        "view",
        {
          ...target,
          ids: [scene.elements[0].id],
          zoom: 1.25,
          scrollX: 25,
          scrollY: 35,
        },
        5_000,
      );
      assert.equal(reply.revision, scene.revision);
      assert.equal(reply.zoom, 1.25);
      assert.equal(reply.scrollX, 25);
      assert.equal(reply.scrollY, 35);
      const after = await cli("snapshot");
      assert.deepEqual(after.elements, scene.elements);
      assert.equal(after.revision, scene.revision);
    } else {
      const exited = once(application, "exit");
      const reply = await cli("quit", {}, 5_000);
      assert.equal(reply.closing, true);
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Quit acknowledged but native process remained running",
                  ),
                ),
              5_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(application.exitCode, 0);
    }
    const elapsedMs = Date.now() - started;
    assert.ok(elapsedMs < 5_000, `${mode} took ${elapsedMs}ms`);
    assert.deepEqual(await readFile(drawingPath), savedBytes);
    outcomes.push({ mode, ok: true, elapsedMs, visibility });
  } catch (error: any) {
    outcomes.push({
      mode,
      ok: false,
      error: String(error),
      stdout: error.stdout,
      killed: error.killed,
      savedBytesUnchanged: savedBytes
        ? (await readFile(drawingPath)).equals(savedBytes)
        : null,
    });
  } finally {
    await killOwnedProcessTree(application);
  }
}
console.log(JSON.stringify({ root, outcomes }, null, 2));
if (outcomes.some((outcome) => !outcome.ok)) process.exitCode = 1;
