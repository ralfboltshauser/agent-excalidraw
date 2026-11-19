import {
  test as base,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  realpath,
  chmod,
  rename,
  lstat,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Reply, Request } from "../src/shared/types";
import { killOwnedProcessTree } from "./helpers/owned-process";

const execute = promisify(execFile);
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliEntry = path.join(repository, "dist", "cli", "index.js");
const modifier = process.platform === "darwin" ? "Meta" : "Control";

type Workspace = {
  application: ElectronApplication;
  page: Page;
  root: string;
  dataDirectory: string;
  drawingsDirectory: string;
  cli: (command: string, payload?: Record<string, any>) => Promise<Reply>;
  invoke: (request: Request) => Promise<Reply>;
  installedLauncher: (launcher: string, args: string[]) => Promise<string>;
  restartAfterCrash: () => Promise<void>;
  screenshot: (name: string) => Promise<void>;
};
function result(reply: Reply): any {
  expect(
    reply.ok,
    reply.ok ? "" : `${reply.error.code}: ${reply.error.message}`,
  ).toBe(true);
  return reply.ok ? reply.result : undefined;
}
function errorCode(reply: Reply): string | undefined {
  return reply.ok ? undefined : reply.error.code;
}
function live(elements: any[]) {
  return elements.filter((element) => !element.isDeleted);
}

async function crashOwnedApplication(application: ElectronApplication) {
  await killOwnedProcessTree(application.process());
}

const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({}, use, testInfo) => {
    // Short Unix paths avoid the macOS sockaddr_un pathname limit. All source
    // drawings and app metadata stay inside this owned temporary test home.
    const temporaryRoot = await mkdtemp(
      path.join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ae-e2e-"),
    );
    await Promise.all([
      mkdir(path.join(temporaryRoot, "data"), { recursive: true }),
      mkdir(path.join(temporaryRoot, "drawings"), { recursive: true }),
    ]);
    // Windows TEMP may contain an 8.3 alias (RUNNER~1). Compare/display the same
    // canonical host paths returned by the actual file service, on every OS.
    const root = await realpath(temporaryRoot);
    const dataDirectory = await realpath(path.join(root, "data"));
    const drawingsDirectory = await realpath(path.join(root, "drawings"));
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env))
      if (
        value !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key)
      )
        environment[key] = value;
    environment.AGENT_EXCALIDRAW_DATA_DIR = dataDirectory;
    // Child-process configuration only: never install/disconnect into real host
    // agent roots or the user's existing command directory.
    environment.AGENT_EXCALIDRAW_BIN_DIR = path.join(root, "bin");
    environment.AGENTS_HOME = path.join(root, "agents");
    environment.CODEX_HOME = path.join(root, "codex");
    environment.CLAUDE_CONFIG_DIR = path.join(root, "claude");
    const processLogs: string[] = [];
    let current!: ElectronApplication;
    let page!: Page;
    async function launch() {
      const packagedExecutable = process.env.AGENT_EXCALIDRAW_EXECUTABLE;
      current = await _electron.launch({
        ...(packagedExecutable
          ? { executablePath: path.resolve(packagedExecutable) }
          : {}),
        args: packagedExecutable ? [] : ["."],
        cwd: repository,
        env: environment,
        timeout: 60_000,
      });
      current
        .process()
        .stdout?.on("data", (chunk) => processLogs.push(String(chunk)));
      current
        .process()
        .stderr?.on("data", (chunk) => processLogs.push(String(chunk)));
      page = await current.firstWindow();
      page.on("pageerror", (error) =>
        processLogs.push(`RENDERER ERROR: ${error.stack || error.message}\n`),
      );
      await page.waitForFunction(() => Boolean(window.agentExcalidraw));
      await expect(
        page.getByRole("button", { name: "New drawing", exact: true }),
      ).toBeEnabled();
      await expect
        .poll(async () => {
          try {
            return JSON.parse(
              await readFile(path.join(dataDirectory, "endpoint.json"), "utf8"),
            ).protocol;
          } catch {
            return null;
          }
        })
        .toBe(1);
      const configured = await page.evaluate(
        async (folder) =>
          window.agentExcalidraw.invoke({
            command: "settings",
            args: { defaultFolder: folder, theme: "light" },
          }),
        drawingsDirectory,
      );
      result(configured);
    }
    try {
      await launch();
    } catch (error) {
      if (current)
        await current.close().catch(() => crashOwnedApplication(current));
      throw error;
    }
    const workspace: Workspace = {
      get application() {
        return current;
      },
      get page() {
        return page;
      },
      root,
      dataDirectory,
      drawingsDirectory,
      async invoke(request) {
        return page.evaluate(
          (request) => window.agentExcalidraw.invoke(request),
          request,
        );
      },
      async cli(command, payload = {}) {
        const input = path.join(root, `input-${randomUUID()}.json`);
        await writeFile(input, JSON.stringify(payload), { mode: 0o600 });
        try {
          const { stdout } = await execute(
            process.execPath,
            command === "schema"
              ? [cliEntry, "schema", "--json"]
              : [cliEntry, command, "--input", input, "--json", "--no-launch"],
            {
              cwd: repository,
              env: environment,
              timeout: 60_000,
              maxBuffer: 32 * 1024 * 1024,
            },
          );
          return JSON.parse(stdout.trim()) as Reply;
        } catch (error: any) {
          // CLI validation/application errors intentionally exit nonzero. Keep
          // their real machine-readable envelopes available for assertions.
          if (error.stdout?.trim()) {
            try {
              return JSON.parse(error.stdout.trim()) as Reply;
            } catch {}
          }
          throw error;
        }
      },
      async installedLauncher(launcher, args) {
        // Deliberately remove external Node from PATH: the installed launcher
        // must use its absolute bundled Electron runtime, including inside ASAR.
        const options = {
          cwd: root,
          env: { ...environment, PATH: path.dirname(launcher) },
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        };
        const { stdout } =
          process.platform === "win32"
            ? await execute(
                process.env.ComSpec || "cmd.exe",
                ["/d", "/s", "/c", `""${launcher}" ${args.join(" ")}"`],
                { ...options, windowsVerbatimArguments: true },
              )
            : await execute(launcher, args, options);
        return stdout.trim();
      },
      async restartAfterCrash() {
        await crashOwnedApplication(current);
        await launch();
      },
      async screenshot(name) {
        const destination = testInfo.outputPath(`${name}.png`);
        await page.screenshot({ path: destination, fullPage: true });
        await testInfo.attach(name, {
          path: destination,
          contentType: "image/png",
        });
      },
    };
    try {
      await use(workspace);
    } finally {
      // Save through the public command path before normal close. If a test
      // intentionally caused a conflict, preserve a copy inside the test home.
      try {
        const status = result(await workspace.invoke({ command: "status" }));
        if (status.active) {
          const saved = await workspace.invoke({ command: "save" });
          if (!saved.ok)
            await workspace.invoke({
              command: "save-as",
              args: {
                path: path.join(root, `teardown-${randomUUID()}.excalidraw`),
              },
            });
        }
      } catch (error) {
        processLogs.push(`TEARDOWN SAVE: ${String(error)}\n`);
      }
      try {
        await Promise.race([
          current.close(),
          new Promise((_, reject) => {
            const timeout = setTimeout(
              () =>
                reject(
                  new Error("Native test app did not close after saving."),
                ),
              5000,
            );
            timeout.unref();
          }),
        ]);
      } catch (error) {
        processLogs.push(`TEARDOWN CLOSE: ${String(error)}\n`);
        await crashOwnedApplication(current).catch((error) =>
          processLogs.push(`TEARDOWN KILL: ${String(error)}\n`),
        );
      }
      await testInfo.attach("electron-process.log", {
        body: Buffer.from(processLogs.join("")),
        contentType: "text/plain",
      });
      await testInfo.attach("test-home.txt", {
        body: Buffer.from(root),
        contentType: "text/plain",
      });
      // Keep the fixture on failure for diagnosis and never delete source files
      // from outside this root. Successful fixtures are also useful evidence.
    }
  },
});

async function snapshot(workspace: Workspace) {
  return result(await workspace.cli("snapshot"));
}
async function apply(
  workspace: Workspace,
  operations: any[],
  context?: any,
  requestId = randomUUID(),
) {
  const inspected = context || (await snapshot(workspace));
  return workspace.cli("apply", {
    document: inspected.document,
    epoch: inspected.epoch,
    expectedRevision: inspected.revision,
    requestId,
    session: "e2e-agent",
    operations,
  });
}
async function create(workspace: Workspace, title = "Agent onboarding") {
  const file = path.join(workspace.drawingsDirectory, `${title}.excalidraw`);
  return result(await workspace.cli("new", { title, path: file }));
}
async function target(workspace: Workspace) {
  const scene = await snapshot(workspace);
  return { document: scene.document, epoch: scene.epoch };
}
async function focusCanvas(page: Page) {
  const canvas = page.locator("canvas.excalidraw__canvas.interactive");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box)
    throw new Error("The actual interactive Excalidraw canvas has no bounds.");
  await page.mouse.click(box.x + box.width - 90, box.y + box.height - 100);
  return box;
}

test("native shell journeys remain minimal and expose real file locations", async ({
  workspace,
}) => {
  const page = workspace.page;
  await expect(
    page.getByRole("heading", { name: /A little space for/ }),
  ).toBeVisible();
  await workspace.screenshot("01-first-launch");
  await page.getByRole("button", { name: "New drawing", exact: true }).click();
  await expect(page.locator(".drawing-title")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await workspace.screenshot("02-empty-editor");
  await page.locator(".drawing-title").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    workspace.drawingsDirectory,
  );
  await workspace.screenshot("03-document-location");
  await page.getByLabel("Name", { exact: true }).fill("A quieter onboarding");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.locator(".drawing-title")).toContainText(
    "A quieter onboarding",
  );
  const host = result(await workspace.invoke({ command: "status" }));
  expect(JSON.parse(await readFile(host.active.path, "utf8")).type).toBe(
    "excalidraw",
  );
  await page
    .getByRole("button", { name: "Your drawings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your drawings", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".open-drawing").filter({ hasText: "A quieter onboarding" }),
  ).toBeVisible();
  await workspace.screenshot("04-library");
  await page.getByRole("button", { name: "Star drawing", exact: true }).click();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(
    page.locator(".open-drawing").filter({ hasText: "A quieter onboarding" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await workspace.screenshot("05-settings-light");
  await page
    .getByRole("button", { name: "dark appearance", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await workspace.screenshot("06-settings-dark");
  await page
    .getByRole("button", { name: "light appearance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review recovery…", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "No unsaved recovery snapshots.",
  );
  await workspace.screenshot("07-recovery-empty");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: /Keyboard & help/ }).click();
  await expect(
    page.getByRole("heading", { name: "Room to think.", exact: true }),
  ).toBeVisible();
  await workspace.screenshot("08-help");
  await page
    .getByRole("button", { name: "Set up your agent", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: /Your agent.*The same canvas/ }),
  ).toBeVisible();
  await workspace.screenshot("09-agents");
  await page.getByRole("button", { name: /Prefer MCP/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "The CLI works independently",
  );
  await workspace.screenshot("10-optional-mcp");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to your space", exact: true })
    .click();
  await page.locator(".drawing-title").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Export…", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Export does not save unsaved changes",
  );
  await expect(
    page.getByRole("checkbox", {
      name: "Include editable drawing",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Add a shape before rendering this drawing.",
  );
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await workspace.screenshot("11-export");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /Find a drawing/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Go to a drawing" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Find a drawing", exact: true })
    .fill("quieter");
  await expect(page.getByRole("dialog")).toContainText("A quieter onboarding");
  await workspace.screenshot("12-quick-switch");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("real CLI creates, binds, edits, renders, saves and reopens with one native undo step", async ({
  workspace,
}, testInfo) => {
  const schema = result(await workspace.cli("schema"));
  expect(schema.commands.some((command: any) => command.name === "apply")).toBe(
    true,
  );
  expect(schema.mutationPreconditions).toEqual([
    "document",
    "epoch",
    "expectedRevision",
    "requestId",
  ]);
  const created = await create(workspace);
  const before = await snapshot(workspace);
  const operations = [
    {
      op: "create",
      ref: "start",
      type: "rectangle",
      x: 120,
      y: 160,
      width: 200,
      height: 100,
      label: "Start here",
      backgroundColor: "#e5dbff",
      fillStyle: "solid",
    },
    {
      op: "create",
      ref: "done",
      type: "rectangle",
      x: 540,
      y: 160,
      width: 200,
      height: 100,
      label: "Make it clear",
    },
    {
      op: "create",
      ref: "next",
      type: "arrow",
      from: "start",
      to: "done",
      label: "next",
    },
  ];
  const requestId = randomUUID();
  const receipt = result(await apply(workspace, operations, before, requestId));
  const first = receipt.created.find((entry: any) => entry.ref === "start").id;
  const second = receipt.created.find((entry: any) => entry.ref === "done").id;
  const connector = receipt.created.find(
    (entry: any) => entry.ref === "next",
  ).id;
  expect(receipt.applied).toBe(true);
  const repeated = result(
    await apply(workspace, operations, before, requestId),
  );
  expect(repeated.created).toEqual(receipt.created);
  expect(repeated.revision).toBe(receipt.revision);
  const afterCreate = await snapshot(workspace);
  expect(afterCreate.elements).toHaveLength(6);
  const arrow = afterCreate.elements.find(
    (element: any) => element.id === connector,
  );
  expect(arrow.startBinding.elementId).toBe(first);
  expect(arrow.endBinding.elementId).toBe(second);
  expect(
    errorCode(
      await apply(workspace, [{ op: "update", id: first, x: 999 }], before),
    ),
  ).toBe("STALE_REVISION");
  expect(
    (await snapshot(workspace)).elements.find(
      (element: any) => element.id === first,
    ).x,
  ).toBe(120);
  result(
    await workspace.cli("view", { ...(await target(workspace)), focus: true }),
  );
  await workspace.screenshot("01-agent-created-diagram");
  const moved = result(
    await apply(workspace, [{ op: "update", id: first, y: 340 }]),
  );
  expect(moved.revision).toBeGreaterThan(afterCreate.revision);
  const afterMove = await snapshot(workspace);
  expect(
    afterMove.elements.find((element: any) => element.id === first).y,
  ).toBe(340);
  const movedArrow = afterMove.elements.find(
    (element: any) => element.id === connector,
  );
  expect(movedArrow.startBinding.elementId).toBe(first);
  expect(movedArrow.endBinding.elementId).toBe(second);
  expect(movedArrow.points).not.toEqual(arrow.points);
  // First establish SDK history using its actual visible controls. This isolates
  // native shortcut routing defects from scene/history integration defects.
  await expect(workspace.page.getByTestId("button-undo")).toBeEnabled();
  await workspace.page.getByTestId("button-undo").click();
  await expect
    .poll(async () => {
      const scene = await snapshot(workspace);
      return scene.elements.find((element: any) => element.id === first)?.y;
    })
    .toBe(160);
  await workspace.page.getByTestId("button-redo").click();
  await expect
    .poll(async () => {
      const scene = await snapshot(workspace);
      return scene.elements.find((element: any) => element.id === first)?.y;
    })
    .toBe(340);
  await workspace.application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.show();
    window.focus();
    window.webContents.focus();
  });
  await workspace.page.bringToFront();
  await focusCanvas(workspace.page);
  await workspace.page.keyboard.press(`${modifier}+z`);
  await expect
    .poll(async () => {
      const scene = await snapshot(workspace);
      return scene.elements.find((element: any) => element.id === first)?.y;
    })
    .toBe(160);
  // One Undo must retain the earlier complete creation batch.
  expect((await snapshot(workspace)).elements).toHaveLength(6);
  await workspace.screenshot("02-native-undo");
  await workspace.page.keyboard.press(`${modifier}+Shift+z`);
  await expect
    .poll(async () => {
      const scene = await snapshot(workspace);
      return scene.elements.find((element: any) => element.id === first)?.y;
    })
    .toBe(340);
  const targetContext = await target(workspace);
  const png = path.join(workspace.root, "diagram.png"),
    svg = path.join(workspace.root, "diagram.svg");
  const rendered = result(
    await workspace.cli("render", {
      ...targetContext,
      output: png,
      format: "png",
    }),
  );
  expect(rendered.path).toBe(png);
  const bytes = await readFile(png);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await workspace
    .cli("render", { ...targetContext, output: svg, format: "svg" })
    .then(result);
  expect(await readFile(svg, "utf8")).toContain("<svg");
  const saved = result(await workspace.cli("save", targetContext));
  expect(saved.path).toBe(created.path);
  const persisted = JSON.parse(await readFile(created.path, "utf8"));
  expect(live(persisted.elements)).toHaveLength(6);
  expect(
    persisted.elements.find((element: any) => element.id === first).y,
  ).toBe(340);
  await workspace.screenshot("03-saved-diagram");
  await testInfo.attach("persisted-drawing", {
    path: created.path,
    contentType: "application/json",
  });
  await testInfo.attach("rendered-png", {
    path: png,
    contentType: "image/png",
  });
  await testInfo.attach("rendered-svg", {
    path: svg,
    contentType: "image/svg+xml",
  });
  const reopened = result(await workspace.cli("open", { path: created.path }));
  expect(reopened.epoch).not.toBe(before.epoch);
  const restored = await snapshot(workspace);
  expect(restored.elements.find((element: any) => element.id === first).y).toBe(
    340,
  );
  expect(
    restored.elements.find((element: any) => element.id === connector)
      .startBinding.elementId,
  ).toBe(first);
  expect(
    errorCode(
      await apply(workspace, [{ op: "update", id: first, x: 900 }], afterMove),
    ),
  ).toBe("STALE_EPOCH");

  // Exercise the SDK's actual hyperlink popup and onLinkOpen callback. Only
  // opening the external browser is replaced; no editor callback is mocked.
  const webLink =
    "https://example.com/agent-excalidraw-drawing-link?from=canvas";
  result(await apply(workspace, [{ op: "update", id: first, link: webLink }]));
  await workspace.application.evaluate(({ shell }) => {
    const state = { original: shell.openExternal, urls: [] as string[] };
    (globalThis as any).__e2eExternalLinks = state;
    shell.openExternal = async (url) => {
      state.urls.push(url);
    };
  });
  let externalLinks: string[] = [];
  try {
    await focusCanvas(workspace.page);
    result(
      await workspace.cli("view", {
        ...(await target(workspace)),
        ids: [first],
        focus: true,
      }),
    );
    await workspace.page.keyboard.press(`${modifier}+k`);
    const linkInput = workspace.page.locator(
      ".excalidraw-hyperlinkContainer-input",
    );
    await expect(linkInput).toHaveValue(webLink);
    await linkInput.press("Enter");
    const link = workspace.page.locator("a.excalidraw-hyperlinkContainer-link");
    await expect(link).toHaveAttribute("href", webLink);
    await workspace.screenshot("04-sdk-drawing-hyperlink");
    await link.click();
    await expect
      .poll(() =>
        workspace.application.evaluate(
          () => (globalThis as any).__e2eExternalLinks.urls,
        ),
      )
      .toEqual([webLink]);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,private",
      "file://remote-host/private.excalidraw",
    ]) {
      const rejected = await workspace.invoke({
        command: "open-link",
        args: { url },
      });
      expect(rejected.ok).toBe(false);
      expect(errorCode(rejected)).toBe("UNSUPPORTED_LINK");
    }
  } finally {
    externalLinks = await workspace.application.evaluate(({ shell }) => {
      const state = (globalThis as any).__e2eExternalLinks;
      shell.openExternal = state.original;
      delete (globalThis as any).__e2eExternalLinks;
      return state.urls;
    });
  }
  expect(externalLinks).toEqual([webLink]);
  const linkedPath = path.join(
    workspace.drawingsDirectory,
    "Linked local drawing.excalidraw",
  );
  const linkedBytes = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-local-link",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });
  await writeFile(linkedPath, linkedBytes);
  const beforeLink = await snapshot(workspace);
  const restoreGuard = await automateNativeDialog(workspace, {
    kind: "message",
    detail: "Your drawing has unsaved changes.",
    response: 2,
  });
  try {
    expect(
      errorCode(
        await workspace.invoke({
          command: "open-link",
          args: { url: pathToFileURL(linkedPath).href },
        }),
      ),
    ).toBe("CANCELLED");
  } finally {
    await restoreGuard();
  }
  expect((await snapshot(workspace)).document).toBe(beforeLink.document);
  expect(result(await workspace.cli("status")).dirty).toBe(true);
  expect(await readFile(linkedPath, "utf8")).toBe(linkedBytes);
  result(await workspace.cli("save", await target(workspace)));
  result(
    await workspace.invoke({
      command: "open-link",
      args: { url: pathToFileURL(linkedPath).href },
    }),
  );
  expect(result(await workspace.cli("status")).active.path).toBe(linkedPath);
  expect((await snapshot(workspace)).epoch).not.toBe(beforeLink.epoch);
  expect(await readFile(linkedPath, "utf8")).toBe(linkedBytes);
});

test("a human gesture and a stale agent request cannot overwrite each other", async ({
  workspace,
}) => {
  await create(workspace, "Human and agent");
  const before = await snapshot(workspace);
  const box = await focusCanvas(workspace.page);
  await workspace.page.getByTestId("toolbar-rectangle").locator("..").click();
  await expect(
    workspace.page.getByRole("radio", { name: "Rectangle", exact: true }),
  ).toBeChecked();
  await focusCanvas(workspace.page);
  await workspace.page.keyboard.press("v");
  await expect(
    workspace.page.getByRole("radio", { name: "Selection", exact: true }),
  ).toBeChecked();
  await workspace.page.keyboard.press("r");
  await expect(
    workspace.page.getByRole("radio", { name: "Rectangle", exact: true }),
  ).toBeChecked();
  await workspace.page.mouse.move(box.x + 300, box.y + 260);
  await workspace.page.mouse.down();
  await workspace.page.mouse.move(box.x + 500, box.y + 380, { steps: 10 });
  const midGesture = await snapshot(workspace);
  const refused = await apply(
    workspace,
    [{ op: "create", type: "text", x: 700, y: 200, text: "Do not interrupt" }],
    midGesture,
  );
  expect(errorCode(refused)).toBe("DOCUMENT_BUSY");
  await workspace.page.mouse.up();
  const afterHuman = await snapshot(workspace);
  expect(
    afterHuman.elements.filter((element: any) => element.type === "rectangle"),
  ).toHaveLength(1);
  expect(afterHuman.revision).toBeGreaterThan(before.revision);
  expect(
    errorCode(
      await apply(
        workspace,
        [{ op: "create", type: "text", text: "Stale edit", x: 20, y: 20 }],
        before,
      ),
    ),
  ).toBe("STALE_REVISION");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "Your sketch, a little clearer.",
        x: 300,
        y: 430,
      },
    ]),
  );
  const combined = await snapshot(workspace);
  expect(
    combined.elements.some((element: any) => element.type === "rectangle"),
  ).toBe(true);
  expect(
    combined.elements.some(
      (element: any) => element.text === "Your sketch, a little clearer.",
    ),
  ).toBe(true);
  await workspace.screenshot("01-human-and-agent");
  result(await workspace.cli("stop", { session: "e2e-agent" }));
  expect(
    errorCode(
      await apply(workspace, [
        { op: "create", type: "text", text: "Stopped", x: 0, y: 0 },
      ]),
    ),
  ).toBe("SESSION_PAUSED");
  result(await workspace.cli("resume", { session: "e2e-agent" }));
  result(await workspace.cli("save", await target(workspace)));
});

test("external changes preserve both disk data and unsaved work", async ({
  workspace,
}, testInfo) => {
  const created = await create(workspace, "A shared filename");
  const applied = result(
    await apply(workspace, [
      {
        op: "create",
        ref: "note",
        type: "text",
        text: "Saved original",
        x: 180,
        y: 180,
      },
    ]),
  );
  const textId = applied.created[0].id;
  result(await workspace.cli("save", await target(workspace)));
  const original = JSON.parse(await readFile(created.path, "utf8"));
  result(
    await apply(workspace, [
      { op: "update", id: textId, text: "Unsaved local thought" },
    ]),
  );
  const outside = {
    ...original,
    appState: { ...original.appState, viewBackgroundColor: "#fff4e6" },
  };
  const externalBytes = JSON.stringify(outside, null, 2) + "\n";
  await writeFile(created.path, externalBytes);
  const failed = await workspace.cli("save", await target(workspace));
  expect(errorCode(failed)).toBe("FILE_CONFLICT");
  expect(await readFile(created.path, "utf8")).toBe(externalBytes);
  await expect(workspace.page.getByRole("alert")).toContainText(
    "changed outside the app",
  );
  await workspace.screenshot("01-external-change-error");
  expect(
    (await snapshot(workspace)).elements.find(
      (element: any) => element.id === textId,
    ).text,
  ).toBe("Unsaved local thought");
  const copyPath = path.join(
    workspace.drawingsDirectory,
    "My preserved copy.excalidraw",
  );
  result(
    await workspace.cli("save-as", {
      ...(await target(workspace)),
      path: copyPath,
    }),
  );
  expect(await readFile(created.path, "utf8")).toBe(externalBytes);
  expect(
    JSON.parse(await readFile(copyPath, "utf8")).elements.find(
      (element: any) => element.id === textId,
    ).text,
  ).toBe("Unsaved local thought");
  await testInfo.attach("external-original", {
    path: created.path,
    contentType: "application/json",
  });
  await testInfo.attach("preserved-local-copy", {
    path: copyPath,
    contentType: "application/json",
  });
  const unsupportedPath = path.join(
    workspace.drawingsDirectory,
    "Future drawing.excalidraw",
  );
  const unsupportedBytes = JSON.stringify({
    ...original,
    elements: [{ id: "future-sticky", type: "stickynote", x: 0, y: 0 }],
  });
  await writeFile(unsupportedPath, unsupportedBytes);
  expect(
    errorCode(await workspace.cli("open", { path: unsupportedPath })),
  ).toBe("UNSUPPORTED_FORMAT");
  expect(await readFile(unsupportedPath, "utf8")).toBe(unsupportedBytes);
  expect(
    result(await workspace.invoke({ command: "status" })).active.path,
  ).toBe(await realpath(copyPath));
});

test("a real process crash offers a recovery copy without replacing the source", async ({
  workspace,
}, testInfo) => {
  const created = await create(workspace, "A thought worth keeping");
  const originalBytes = await readFile(created.path, "utf8");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "Unsaved but recoverable",
        x: 200,
        y: 180,
      },
    ]),
  );
  await expect
    .poll(async () => {
      const reply = await workspace.invoke({ command: "recovery-list" });
      return reply.ok ? reply.result.recovery.length : 0;
    })
    .toBe(1);
  expect(await readFile(created.path, "utf8")).toBe(originalBytes);
  await workspace.restartAfterCrash();
  await expect(
    workspace.page.getByRole("heading", { name: "Your drawings", exact: true }),
  ).toBeVisible();
  await workspace.page
    .getByRole("button", { name: /unsaved drawing can be recovered/ })
    .click();
  await expect(workspace.page.getByRole("dialog")).toContainText(
    "Your original files stay unchanged.",
  );
  await workspace.screenshot("01-real-crash-recovery");
  await workspace.page
    .getByRole("button", { name: "Restore a copy", exact: true })
    .click();
  await expect(workspace.page.getByRole("dialog")).not.toBeVisible();
  const restored = result(await workspace.invoke({ command: "status" }));
  expect(restored.active.path).not.toBe(created.path);
  expect(await readFile(created.path, "utf8")).toBe(originalBytes);
  const recovered = JSON.parse(await readFile(restored.active.path, "utf8"));
  expect(
    recovered.elements.some(
      (element: any) => element.text === "Unsaved but recoverable",
    ),
  ).toBe(true);
  await workspace.screenshot("02-recovered-copy");
  await testInfo.attach("untouched-original", {
    path: created.path,
    contentType: "application/json",
  });
  await testInfo.attach("recovered-copy", {
    path: restored.active.path,
    contentType: "application/json",
  });
});

async function internalSceneCommand(
  workspace: Workspace,
  request: Request,
): Promise<Reply> {
  // Exercise the real renderer through the same narrow IPC channel as main.
  // The public CLI/renderer bridge intentionally cannot invoke load/capture.
  const envelope = { id: `e2e-${randomUUID()}`, request };
  return workspace.application.evaluate(
    ({ BrowserWindow, ipcMain }, envelope) =>
      new Promise<Reply>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ipcMain.removeListener("scene-reply", listener);
          reject(
            new Error(
              "The actual renderer did not reply to the integration probe.",
            ),
          );
        }, 10_000);
        const listener = (
          _event: unknown,
          message: { id: string; reply: Reply },
        ) => {
          if (message.id !== envelope.id) return;
          clearTimeout(timeout);
          ipcMain.removeListener("scene-reply", listener);
          resolve(message.reply);
        };
        ipcMain.on("scene-reply", listener);
        BrowserWindow.getAllWindows()[0].webContents.send(
          "scene-command",
          envelope,
        );
      }),
    envelope,
  );
}

test("a real PNG imported through the image picker survives undo, save and reopen", async ({
  workspace,
}, testInfo) => {
  const drawing = await create(workspace, "A local image");
  const imagePath = path.join(workspace.root, "local-image.png");
  const dataUrl = await workspace.page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#eeedff";
    ctx.fillRect(0, 0, 320, 180);
    ctx.strokeStyle = "#6965db";
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, 272, 132);
    ctx.fillStyle = "#20212b";
    ctx.font = "22px sans-serif";
    ctx.fillText("A local image", 82, 96);
    return canvas.toDataURL("image/png");
  });
  await writeFile(imagePath, Buffer.from(dataUrl.split(",")[1], "base64"));
  const chooserPromise = workspace.page.waitForEvent("filechooser", {
    timeout: 10_000,
  });
  await workspace.page.getByTestId("toolbar-image").locator("..").click();
  const chooser = await chooserPromise.catch(async (error) => {
    await workspace.screenshot("image-picker-failure");
    throw error;
  });
  await chooser.setFiles(imagePath);
  await expect
    .poll(async () => {
      const scene = await snapshot(workspace);
      return Boolean(
        scene.elements.find((element: any) => element.type === "image")?.fileId,
      );
    })
    .toBe(true);
  const canvas = workspace.page.locator(
    "canvas.excalidraw__canvas.interactive",
  );
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Image placement canvas has no bounds.");
  await workspace.page.mouse.move(bounds.x + 380, bounds.y + 280);
  await workspace.page.mouse.click(bounds.x + 380, bounds.y + 280);
  await expect
    .poll(async () => {
      const image = (await snapshot(workspace)).elements.find(
        (element: any) => element.type === "image",
      );
      return Boolean(image && image.width > 0 && image.height > 0);
    })
    .toBe(true);
  const imported = (await snapshot(workspace)).elements.find(
    (element: any) => element.type === "image",
  );
  expect(imported.fileId).toBeTruthy();
  result(await workspace.cli("save", await target(workspace)));
  const persisted = JSON.parse(await readFile(drawing.path, "utf8"));
  expect(persisted.files[imported.fileId].mimeType).toBe("image/png");
  const binary = persisted.files[imported.fileId].dataURL;
  expect(binary).toMatch(/^data:image\/png;base64,/);
  expect([
    ...Buffer.from(binary.split(",")[1], "base64").subarray(0, 8),
  ]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await workspace.screenshot("01-imported-image");
  await focusCanvas(workspace.page);
  const beforeUndo = await snapshot(workspace);
  await workspace.page.keyboard.press(`${modifier}+z`);
  let undoSteps = 1;
  let undone = await snapshot(workspace);
  // The pinned SDK records asynchronous image insertion and placement at two
  // native history boundaries. Agent batches have their separate one-step test.
  if (undone.elements.some((element: any) => element.type === "image")) {
    await workspace.page.keyboard.press(`${modifier}+z`);
    undoSteps++;
  }
  await expect
    .poll(
      async () =>
        (await snapshot(workspace)).elements.filter(
          (element: any) => element.type === "image",
        ).length,
    )
    .toBe(0);
  await workspace.screenshot("02-image-undo");
  const nativeAfterUndo = path.join(
    workspace.root,
    "drawing-after-image-undo.excalidraw",
  );
  result(
    await workspace.cli("render", {
      ...(await target(workspace)),
      format: "excalidraw",
      output: nativeAfterUndo,
    }),
  );
  const serializedUndo = JSON.parse(await readFile(nativeAfterUndo, "utf8"));
  expect(
    serializedUndo.elements.every(
      (element: any) => !element.isDeleted && element.type !== "image",
    ),
  ).toBe(true);
  expect(serializedUndo.files).toEqual({});
  for (let step = 0; step < undoSteps; step++)
    await workspace.page.keyboard.press(`${modifier}+Shift+z`);
  await expect
    .poll(
      async () =>
        (await snapshot(workspace)).elements.filter(
          (element: any) => element.type === "image",
        ).length,
    )
    .toBe(1);
  const redone = (await snapshot(workspace)).elements.find(
    (element: any) => element.type === "image",
  );
  const originalImage = beforeUndo.elements.find(
    (element: any) => element.type === "image",
  );
  expect(redone.fileId).toBe(imported.fileId);
  expect({
    x: redone.x,
    y: redone.y,
    width: redone.width,
    height: redone.height,
  }).toEqual({
    x: originalImage.x,
    y: originalImage.y,
    width: originalImage.width,
    height: originalImage.height,
  });
  await testInfo.attach("native-image-history", {
    body: Buffer.from(JSON.stringify({ undoSteps, redoSteps: undoSteps })),
    contentType: "application/json",
  });
  result(await workspace.cli("save", await target(workspace)));
  result(await workspace.cli("open", { path: drawing.path }));
  const reopened = (await snapshot(workspace)).elements.find(
    (element: any) => element.type === "image",
  );
  expect(reopened.fileId).toBe(imported.fileId);
  expect(reopened.width).toBeGreaterThan(0);
  expect(reopened.height).toBeGreaterThan(0);
  const restored = JSON.parse(await readFile(drawing.path, "utf8"));
  expect(restored.files[reopened.fileId].dataURL).toBe(binary);
  const output = path.join(workspace.root, "imported-image-render.png");
  result(
    await workspace.cli("render", {
      ...(await target(workspace)),
      output,
      format: "png",
    }),
  );
  await workspace.screenshot("03-reopened-image");
  await testInfo.attach("image-source", {
    path: imagePath,
    contentType: "image/png",
  });
  await testInfo.attach("drawing-with-embedded-image", {
    path: drawing.path,
    contentType: "application/json",
  });
  await testInfo.attach("reopened-image-render", {
    path: output,
    contentType: "image/png",
  });
});

test("Stop cancels both font preparation and queued edits before anything is applied", async ({
  workspace,
}) => {
  await create(workspace, "Stop before commit");
  const before = await snapshot(workspace);
  await workspace.page.evaluate(() => {
    const fonts = document.fonts;
    const original = fonts.load;
    const gate = {
      blocked: false,
      release: null as (() => void) | null,
      original,
    };
    (window as any).__e2eFontGate = gate;
    // Delay the real browser font preparation rather than replace measurement,
    // the editor, the renderer command handler or any drawing state.
    fonts.load = async function (font: string, text?: string) {
      gate.blocked = true;
      await new Promise<void>((resolve) => (gate.release = resolve));
      return original.call(fonts, font, text);
    };
  });
  let pending: Promise<Reply> | undefined, queued: Promise<Reply> | undefined;
  try {
    pending = apply(
      workspace,
      [
        {
          op: "create",
          type: "text",
          text: "Must never appear",
          x: 180,
          y: 180,
        },
      ],
      before,
    );
    await workspace.page.waitForFunction(
      () => (window as any).__e2eFontGate?.blocked === true,
    );
    queued = apply(
      workspace,
      [
        {
          op: "create",
          type: "rectangle",
          x: 500,
          y: 200,
          width: 100,
          height: 80,
        },
      ],
      before,
    );
    const stopped = result(
      await workspace.invoke({
        command: "stop",
        args: { session: "e2e-agent" },
      }),
    );
    expect(stopped.paused).toBe(true);
    await workspace.page.evaluate(() => {
      const gate = (window as any).__e2eFontGate;
      document.fonts.load = gate.original;
      gate.release();
    });
    expect(errorCode(await pending)).toBe("OPERATION_CANCELLED");
    expect(["OPERATION_CANCELLED", "SESSION_PAUSED"]).toContain(
      errorCode(await queued),
    );
    const unchanged = await snapshot(workspace);
    expect(unchanged.elements).toHaveLength(0);
    expect(unchanged.revision).toBe(before.revision);
    expect(
      errorCode(
        await apply(workspace, [
          { op: "create", type: "text", text: "Still paused", x: 0, y: 0 },
        ]),
      ),
    ).toBe("SESSION_PAUSED");
    result(
      await workspace.invoke({
        command: "resume",
        args: { session: "e2e-agent" },
      }),
    );
    result(
      await apply(workspace, [
        {
          op: "create",
          type: "text",
          text: "Resumed with your permission.",
          x: 180,
          y: 180,
        },
      ]),
    );
    expect(
      (await snapshot(workspace)).elements.some(
        (element: any) => element.text === "Resumed with your permission.",
      ),
    ).toBe(true);
    await workspace.screenshot("01-resumed-after-cancellation");
  } finally {
    await workspace.page
      .evaluate(() => {
        const gate = (window as any).__e2eFontGate;
        if (gate) {
          document.fonts.load = gate.original;
          gate.release?.();
          delete (window as any).__e2eFontGate;
        }
      })
      .catch(() => {});
    await pending?.catch(() => {});
    await queued?.catch(() => {});
  }
});

test("the final renderer load guard preserves edits made after switch approval", async ({
  workspace,
}) => {
  const drawing = await create(workspace, "Keep the latest edit");
  const approved = await snapshot(workspace);
  const changed = result(
    await apply(
      workspace,
      [
        {
          op: "create",
          ref: "human-work",
          type: "rectangle",
          x: 220,
          y: 180,
          width: 200,
          height: 100,
          label: "Keep this thought",
        },
      ],
      approved,
    ),
  );
  const beforeRefusal = await snapshot(workspace);
  expect(beforeRefusal.revision).toBeGreaterThan(approved.revision);
  const candidate = {
    command: "load",
    args: {
      drawing: {
        id: randomUUID(),
        path: path.join(
          workspace.drawingsDirectory,
          "Another drawing.excalidraw",
        ),
        title: "Another drawing",
      },
      epoch: randomUUID(),
      scene: {
        type: "excalidraw",
        version: 2,
        source: "integration-test",
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      },
      previous: {
        document: approved.document,
        epoch: approved.epoch,
        revision: approved.revision,
      },
    },
  };
  const refused = await internalSceneCommand(workspace, candidate);
  expect(errorCode(refused)).toBe("STALE_REVISION");
  const afterRefusal = await snapshot(workspace);
  expect(afterRefusal.document).toBe(beforeRefusal.document);
  expect(afterRefusal.epoch).toBe(beforeRefusal.epoch);
  expect(afterRefusal.revision).toBe(beforeRefusal.revision);
  expect(afterRefusal.elements).toEqual(beforeRefusal.elements);
  const host = result(await workspace.invoke({ command: "status" }));
  expect(host.epoch).toBe(beforeRefusal.epoch);
  expect(host.active.path).toBe(drawing.path);
  // Public clients cannot skip the file service by calling an internal load.
  expect(errorCode(await workspace.invoke(candidate))).toBe("UNKNOWN_COMMAND");
  const dismiss = workspace.page.getByRole("button", {
    name: "Dismiss message",
    exact: true,
  });
  if (await dismiss.isVisible()) await dismiss.click();
  result(
    await apply(workspace, [
      {
        op: "update",
        id: changed.created[0].id,
        backgroundColor: "#e5dbff",
        fillStyle: "solid",
      },
    ]),
  );
  await workspace.screenshot("01-edits-preserved-after-stale-switch");
  result(await workspace.cli("save", await target(workspace)));
});

test("settings and agent education stay open before any drawing exists", async ({
  workspace,
}) => {
  const page = workspace.page;
  expect(
    result(await workspace.invoke({ command: "status" })).active,
  ).toBeNull();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Your agent.*The same canvas/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to your space", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your drawings", exact: true }),
  ).toBeVisible();
  await workspace.screenshot("01-empty-library");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "dark appearance", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "dark appearance", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    result(await workspace.invoke({ command: "status" })).active,
  ).toBeNull();
  await workspace.screenshot("02-settings-without-a-drawing");
  await page.getByRole("button", { name: /Keyboard & help/ }).click();
  await expect(
    page.getByRole("heading", { name: "Room to think.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Set up your agent", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: /Your agent.*The same canvas/ }),
  ).toBeVisible();
  // integration-status broadcasts metadata while no document is active. That
  // must not redirect this education flow back to Welcome or Library.
  result(await workspace.invoke({ command: "integration-status" }));
  await expect(
    page.getByRole("heading", { name: /Your agent.*The same canvas/ }),
  ).toBeVisible();
  await workspace.screenshot("03-agent-education-without-a-drawing");
});

test("a 10,000-drawing library stays windowed, searchable and openable after restart", async ({
  workspace,
}, testInfo) => {
  const settings = result(
    await workspace.invoke({ command: "status" }),
  ).settings;
  const actualPath = path.join(
    workspace.drawingsDirectory,
    "Drawing 09999.excalidraw",
  );
  await writeFile(
    actualPath,
    JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "integration-fixture",
      elements: [],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    }),
  );
  const now = Date.now();
  const drawings = Array.from({ length: 10_000 }, (_, index) => ({
    id: randomUUID(),
    title: `Drawing ${String(index).padStart(5, "0")}`,
    path:
      index === 9999
        ? actualPath
        : path.join(
            workspace.drawingsDirectory,
            `Drawing ${String(index).padStart(5, "0")}.excalidraw`,
          ),
    lastOpened: now - index,
    starred: index === 0,
  }));
  await writeFile(
    path.join(workspace.dataDirectory, "library.json"),
    JSON.stringify({ version: 1, drawings, settings }),
  );
  await workspace.restartAfterCrash();
  const page = workspace.page;
  await expect(
    page.getByRole("heading", { name: "Your drawings", exact: true }),
  ).toBeVisible();
  const rows = page.getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThanOrEqual(40);
  await expect(rows.first()).toHaveAttribute("aria-setsize", "10000");
  await workspace.screenshot("01-large-library-light");
  const summary = result(await workspace.cli("status"));
  expect(summary.libraryCount).toBe(10_000);
  expect(summary).not.toHaveProperty("drawings");
  const firstPage = result(
    await workspace.cli("list", { offset: 0, limit: 25 }),
  );
  expect(firstPage.drawings).toHaveLength(25);
  expect(firstPage.total).toBe(10_000);
  expect(firstPage.nextOffset).toBe(25);
  expect(firstPage.complete).toBe(false);
  const lastPage = result(
    await workspace.cli("list", { offset: 9990, limit: 25 }),
  );
  expect(lastPage.drawings).toHaveLength(10);
  expect(lastPage.nextOffset).toBeNull();
  const oneMatch = result(
    await workspace.cli("list", { query: "Drawing 09999", limit: 25 }),
  );
  expect(oneMatch.total).toBe(1);
  expect(oneMatch.drawings[0].missing).toBe(false);
  expect(oneMatch.complete).toBe(true);
  const list = page.getByRole("list");
  await list.evaluate((element) => (element.scrollTop = element.scrollHeight));
  const lastDrawing = page
    .locator(".open-drawing")
    .filter({ hasText: "Drawing 09999" });
  await expect(lastDrawing).toBeVisible();
  expect(await rows.count()).toBeLessThanOrEqual(40);
  await expect(lastDrawing.locator("..")).toHaveAttribute(
    "aria-posinset",
    "10000",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "dark appearance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to your space", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(lastDrawing).toBeVisible();
  await workspace.screenshot("02-large-library-dark");
  const searchStart = performance.now();
  await page
    .getByRole("textbox", { name: "Search drawings", exact: true })
    .fill("Drawing 09999");
  await expect(rows).toHaveCount(1);
  await expect(lastDrawing).toBeVisible();
  const searchElapsedMs = performance.now() - searchStart;
  await testInfo.attach("large-library-observations", {
    body: Buffer.from(
      JSON.stringify({
        metadataCount: 10_000,
        maximumExpectedMountedRows: 40,
        observedSearchMs: searchElapsedMs,
        note: "Includes automation overhead; not a reference-hardware p95 benchmark.",
      }),
    ),
    contentType: "application/json",
  });
  await workspace.screenshot("03-large-library-filtered");
  await lastDrawing.click();
  await expect(page.locator(".drawing-title")).toHaveText("Drawing 09999");
  expect((await snapshot(workspace)).elements).toHaveLength(0);
  expect(result(await workspace.cli("status")).active.path).toBe(
    await realpath(actualPath),
  );
});

test("a read-only source stays untouched while Save As creates a writable drawing", async ({
  workspace,
}, testInfo) => {
  const source = await create(workspace, "Read-only source");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "rectangle",
        x: 220,
        y: 180,
        width: 220,
        height: 110,
        label: "Keep the original",
      },
    ]),
  );
  result(await workspace.cli("save", await target(workspace)));
  const originalBytes = await readFile(source.path, "utf8");
  await chmod(source.path, 0o444);
  try {
    result(await workspace.cli("open", { path: source.path }));
    const host = result(await workspace.cli("status"));
    expect(host.active.readOnly).toBe(true);
    await expect(workspace.page.locator(".read-only-banner")).toContainText(
      "Save a separate copy",
    );
    await expect(
      workspace.page.getByRole("button", { name: "Read-only", exact: true }),
    ).toBeVisible();
    await expect(
      workspace.page.getByRole("radio", { name: "Rectangle", exact: true }),
    ).not.toBeVisible();
    const inspected = await snapshot(workspace);
    expect(
      errorCode(
        await apply(
          workspace,
          [
            {
              op: "create",
              type: "text",
              text: "Must not edit this source",
              x: 0,
              y: 0,
            },
          ],
          inspected,
        ),
      ),
    ).toBe("READ_ONLY");
    expect(await readFile(source.path, "utf8")).toBe(originalBytes);
    expect((await snapshot(workspace)).revision).toBe(inspected.revision);
    await workspace.screenshot("01-read-only-source");
    const copyPath = path.join(
      workspace.drawingsDirectory,
      "My writable copy.excalidraw",
    );
    const saved = result(
      await workspace.cli("save-as", {
        ...(await target(workspace)),
        path: copyPath,
      }),
    );
    expect(saved.path).toBe(await realpath(copyPath));
    expect(result(await workspace.cli("status")).active.readOnly).not.toBe(
      true,
    );
    await expect(workspace.page.locator(".read-only-banner")).not.toBeVisible();
    await expect(
      workspace.page.getByRole("radio", { name: "Rectangle", exact: true }),
    ).toBeVisible();
    result(
      await apply(workspace, [
        {
          op: "create",
          type: "ellipse",
          x: 550,
          y: 180,
          width: 180,
          height: 110,
          label: "Your own copy",
        },
      ]),
    );
    result(await workspace.cli("save", await target(workspace)));
    expect(await readFile(source.path, "utf8")).toBe(originalBytes);
    expect(
      JSON.parse(await readFile(copyPath, "utf8")).elements.some(
        (element: any) => element.type === "ellipse",
      ),
    ).toBe(true);
    await workspace.screenshot("02-writable-copy");
    await testInfo.attach("unchanged-read-only-original", {
      path: source.path,
      contentType: "application/json",
    });
    await testInfo.attach("edited-writable-copy", {
      path: copyPath,
      contentType: "application/json",
    });
  } finally {
    await chmod(source.path, 0o644);
  }
});

test("canvas and shapes share one native history batch and guarded revert restores both", async ({
  workspace,
}, testInfo) => {
  const drawing = await create(workspace, "One canvas batch");
  const initial = await snapshot(workspace);
  const firstColor = "#fff4e6",
    secondColor = "#edf2ff";
  const receipt = result(
    await apply(
      workspace,
      [
        { op: "canvas", viewBackgroundColor: firstColor },
        {
          op: "create",
          ref: "idea",
          type: "rectangle",
          x: 250,
          y: 200,
          width: 220,
          height: 120,
          label: "One complete change",
        },
      ],
      initial,
    ),
  );
  const first = await snapshot(workspace);
  expect(first.canvas.viewBackgroundColor).toBe(firstColor);
  expect(first.elements).toHaveLength(2);
  expect(receipt.revision).toBe(first.revision);
  await workspace.screenshot("01-canvas-and-shape-batch");
  await focusCanvas(workspace.page);
  await workspace.page.keyboard.press(`${modifier}+z`);
  await expect
    .poll(async () => {
      const state = await snapshot(workspace);
      return {
        count: state.elements.length,
        background: state.canvas.viewBackgroundColor,
      };
    })
    .toEqual({ count: 0, background: initial.canvas.viewBackgroundColor });
  await workspace.page.keyboard.press(`${modifier}+Shift+z`);
  await expect
    .poll(async () => {
      const state = await snapshot(workspace);
      return {
        count: state.elements.length,
        background: state.canvas.viewBackgroundColor,
      };
    })
    .toEqual({ count: 2, background: firstColor });
  const beforeSecond = await snapshot(workspace);
  result(
    await apply(
      workspace,
      [
        { op: "canvas", viewBackgroundColor: secondColor },
        {
          op: "create",
          type: "ellipse",
          x: 600,
          y: 200,
          width: 180,
          height: 120,
          label: "A later thought",
        },
      ],
      beforeSecond,
    ),
  );
  const afterSecond = await snapshot(workspace);
  expect(afterSecond.canvas.viewBackgroundColor).toBe(secondColor);
  expect(afterSecond.elements).toHaveLength(4);
  result(
    await workspace.cli("revert-last-agent-batch", {
      document: afterSecond.document,
      epoch: afterSecond.epoch,
      expectedRevision: afterSecond.revision,
      requestId: randomUUID(),
      session: "e2e-agent",
    }),
  );
  const reverted = await snapshot(workspace);
  expect(reverted.canvas.viewBackgroundColor).toBe(firstColor);
  expect(reverted.elements.map((element: any) => element.id).sort()).toEqual(
    beforeSecond.elements.map((element: any) => element.id).sort(),
  );
  await workspace.screenshot("02-canvas-and-shape-reverted");
  result(await workspace.cli("save", await target(workspace)));
  const persisted = JSON.parse(await readFile(drawing.path, "utf8"));
  expect(persisted.appState.viewBackgroundColor).toBe(firstColor);
  expect(persisted.elements).toHaveLength(2);
  await testInfo.attach("saved-canvas-batch", {
    path: drawing.path,
    contentType: "application/json",
  });
});

test("closing a Mac window unloads the document while activation returns to the library", async ({
  workspace,
}) => {
  test.skip(
    process.platform !== "darwin",
    "Window-close keeps the app running under the macOS lifecycle contract.",
  );
  const drawing = await create(workspace, "Close the window, keep the file");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "Still here when you return.",
        x: 200,
        y: 200,
      },
    ]),
  );
  result(await workspace.cli("save", await target(workspace)));
  const beforeClose = await snapshot(workspace);
  await workspace.application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await expect
    .poll(() =>
      workspace.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(false);
  expect(workspace.application.process().exitCode).toBeNull();
  const closed = result(await workspace.cli("status"));
  expect(closed.active).toBeNull();
  expect(closed.epoch).not.toBe(beforeClose.epoch);
  expect(
    errorCode(
      await apply(
        workspace,
        [{ op: "create", type: "text", text: "Old target", x: 0, y: 0 }],
        beforeClose,
      ),
    ),
  ).toBe("DOCUMENT_NOT_ACTIVE");
  await workspace.application.evaluate(({ app }) => app.emit("activate"));
  await expect
    .poll(() =>
      workspace.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(true);
  await expect(
    workspace.page.getByRole("heading", { name: "Your drawings", exact: true }),
  ).toBeVisible();
  await workspace.screenshot("01-reactivated-library");
  const reopened = result(await workspace.cli("open", { path: drawing.path }));
  expect(reopened.epoch).not.toBe(beforeClose.epoch);
  expect(
    (await snapshot(workspace)).elements.some(
      (element: any) => element.text === "Still here when you return.",
    ),
  ).toBe(true);
});

test("CLI quit refuses unsaved work and acknowledges a clean shutdown before exiting", async ({
  workspace,
}) => {
  await create(workspace, "Quit without losing a thought");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "Save me before quitting.",
        x: 200,
        y: 200,
      },
    ]),
  );
  expect(errorCode(await workspace.cli("quit"))).toBe("UNSAVED_CHANGES");
  expect(workspace.application.process().exitCode).toBeNull();
  expect(result(await workspace.cli("status")).active).not.toBeNull();
  result(await workspace.cli("save", await target(workspace)));
  const ownedProcess = workspace.application.process();
  const exited = once(ownedProcess, "exit");
  const reply = result(await workspace.cli("quit"));
  expect(reply.closing).toBe(true);
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error("Quit acknowledged but the owned app did not exit."),
          ),
        10_000,
      );
      timer.unref();
    }),
  ]);
  expect(ownedProcess.exitCode).toBe(0);
});

test("read-only observer commands cannot retarget the UI Stop action", async ({
  workspace,
}) => {
  await create(workspace, "Keep the agent session clear");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "The drawing agent owns this activity.",
        x: 200,
        y: 200,
      },
    ]),
  );
  const observer = result(
    await workspace.cli("status", { session: "read-only-observer" }),
  );
  expect(observer.agent.session).toBe("e2e-agent");
  result(
    await workspace.cli("snapshot", {
      session: "read-only-observer",
      compact: true,
    }),
  );
  await workspace.page
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await expect(
    workspace.page.getByRole("button", { name: "Stop changes", exact: true }),
  ).toBeVisible();
  await workspace.page
    .getByRole("button", { name: "Stop changes", exact: true })
    .click();
  const stopped = result(
    await workspace.cli("status", { session: "read-only-observer" }),
  );
  expect(stopped.agent.session).toBe("e2e-agent");
  expect(stopped.agent.paused).toBe(true);
  expect(
    errorCode(
      await apply(workspace, [
        { op: "create", type: "text", text: "Stopped edit", x: 0, y: 0 },
      ]),
    ),
  ).toBe("SESSION_PAUSED");
  await workspace.screenshot("01-correct-agent-session-paused");
  await workspace.page
    .getByRole("button", { name: "Resume changes", exact: true })
    .click();
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "An explicit resume permits the next edit.",
        x: 200,
        y: 300,
      },
    ]),
  );
  result(await workspace.cli("save", await target(workspace)));
});

test("quick switch searches every drawing even when the library is filtered to Starred", async ({
  workspace,
}) => {
  const pinned = await create(workspace, "Pinned idea");
  result(
    await workspace.invoke({
      command: "star",
      args: { id: pinned.document, value: true },
    }),
  );
  const unstarred = await create(workspace, "Unstarred idea");
  const page = workspace.page;
  await page
    .getByRole("button", { name: "Your drawings", exact: true })
    .click();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search drawings", exact: true })
    .fill("Pinned");
  await expect(page.locator(".open-drawing")).toHaveCount(1);
  await page.getByRole("button", { name: /Find a drawing/ }).click();
  await page
    .getByRole("textbox", { name: "Find a drawing", exact: true })
    .fill("Unstarred");
  await expect(
    page
      .getByRole("dialog")
      .locator(".switch-results button")
      .filter({ hasText: "Unstarred idea" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "Search drawings", exact: true }),
  ).toHaveValue("Pinned");
  await workspace.application.evaluate(({ Menu }) => {
    const view = Menu.getApplicationMenu()?.items.find(
      (item) => item.label === "View",
    );
    const find = view?.submenu?.items.find(
      (item) => item.label === "Find a drawing…",
    );
    if (!find) throw new Error("Native Find a drawing menu entry is missing.");
    find.click();
  });
  await expect(
    page.getByRole("dialog", { name: "Go to a drawing" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Find a drawing", exact: true })
    .fill("Unstarred");
  const option = page
    .getByRole("dialog")
    .locator(".switch-results button")
    .filter({ hasText: "Unstarred idea" });
  await expect(option).toBeVisible();
  await workspace.screenshot("01-quick-switch-outside-starred-filter");
  await page
    .getByRole("textbox", { name: "Find a drawing", exact: true })
    .press("ArrowDown");
  await expect(option).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(option).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".drawing-title")).toHaveText("Unstarred idea");
  expect((await snapshot(workspace)).document).toBe(unstarred.document);
});

async function automateNativeDialog(
  workspace: Workspace,
  configuration: {
    kind: "open" | "save" | "message";
    title?: string;
    detail?: string;
    defaultPath?: string;
    filePath?: string;
    cancel?: boolean;
    response?: number;
  },
) {
  await workspace.application.evaluate(({ dialog }, configuration) => {
    const method =
      configuration.kind === "open"
        ? "showOpenDialog"
        : configuration.kind === "save"
          ? "showSaveDialog"
          : "showMessageBox";
    const target = dialog as any;
    if (target.__e2eDialog)
      throw new Error("A native dialog automation is already installed.");
    const original = target[method];
    target.__e2eDialog = { method, original, calls: [] };
    // Only the native choice/confirmation response is automated. Scene loading,
    // native Trash, bytes, saving and renderer state are the actual app paths.
    target[method] = async (...args: any[]) => {
      const options = args.find(
        (value) =>
          value &&
          typeof value === "object" &&
          ("properties" in value ||
            "message" in value ||
            "defaultPath" in value),
      );
      if (
        !options ||
        (configuration.title && options.title !== configuration.title) ||
        (configuration.detail && options.detail !== configuration.detail) ||
        (configuration.defaultPath &&
          options.defaultPath !== configuration.defaultPath)
      )
        throw new Error(
          "Unexpected native dialog; refusing automatic acceptance.",
        );
      target.__e2eDialog.calls.push({
        title: options.title,
        message: options.message,
        detail: options.detail,
        defaultPath: options.defaultPath,
      });
      if (configuration.kind === "message")
        return {
          response: configuration.response ?? 0,
          checkboxChecked: false,
        };
      if (configuration.kind === "open")
        return {
          canceled: !!configuration.cancel,
          filePaths: configuration.cancel ? [] : [configuration.filePath],
        };
      return {
        canceled: !!configuration.cancel,
        filePath: configuration.cancel ? undefined : configuration.filePath,
      };
    };
  }, configuration);
  return async () =>
    workspace.application.evaluate(({ dialog }) => {
      const target = dialog as any;
      const state = target.__e2eDialog;
      if (state) {
        target[state.method] = state.original;
        delete target.__e2eDialog;
        return state.calls;
      }
      return [];
    });
}
async function exists(file: string) {
  return lstat(file).then(
    () => true,
    () => false,
  );
}
async function openExportSheet(page: Page) {
  await page.locator(".drawing-title").click();
  await page
    .getByRole("dialog", { name: "Your drawing" })
    .getByRole("button", { name: "Export…", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Take your drawing with you." }),
  ).toBeVisible();
}
function pngDimensions(bytes: Buffer) {
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("trashing the active saved drawing unloads it before creating or opening another", async ({
  workspace,
}, testInfo) => {
  const drawing = await create(workspace, "Trash this drawing");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "Synthetic trash fixture",
        x: 180,
        y: 180,
      },
    ]),
  );
  result(await workspace.cli("save", await target(workspace)));
  const originalEpoch = (await snapshot(workspace)).epoch;
  await workspace.page
    .getByRole("button", { name: "Your drawings", exact: true })
    .click();
  await workspace.page
    .getByRole("button", {
      name: "More actions for Trash this drawing",
      exact: true,
    })
    .click();
  await workspace.screenshot("01-file-removal-actions");
  const restore = await automateNativeDialog(workspace, {
    kind: "message",
    detail: drawing.path,
    response: 0,
  });
  try {
    await workspace.page
      .getByRole("dialog")
      .getByRole("button", { name: /Move file to (Trash|Recycle Bin)/ })
      .click();
    await expect.poll(() => exists(drawing.path)).toBe(false);
    await expect
      .poll(async () => result(await workspace.cli("status")).active)
      .toBeNull();
  } finally {
    await testInfo.attach("automated-native-trash-confirmation", {
      body: Buffer.from(JSON.stringify(await restore())),
      contentType: "application/json",
    });
  }
  const status = result(await workspace.cli("status"));
  expect(status.epoch).not.toBe(originalEpoch);
  const created = await create(workspace, "After Trash");
  expect((await snapshot(workspace)).document).toBe(created.document);
  result(await workspace.cli("open", { path: created.path }));
  await workspace.screenshot("02-new-drawing-after-trash");
});

test("Locate repairs both an active moved file and a missing recent reference", async ({
  workspace,
}, testInfo) => {
  const drawing = await create(workspace, "A drawing that moves");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "The same thought at another path.",
        x: 200,
        y: 200,
      },
    ]),
  );
  result(await workspace.cli("save", await target(workspace)));
  const original = await readFile(drawing.path, "utf8");
  const moved = path.join(
    workspace.drawingsDirectory,
    "Moved outside the app.excalidraw",
  );
  await rename(drawing.path, moved);
  await expect(workspace.page.getByRole("alert")).toContainText(
    "This file is no longer at its saved location.",
  );
  await workspace.screenshot("01-active-missing-file");
  let restore = await automateNativeDialog(workspace, {
    kind: "open",
    title: "Locate drawing",
    filePath: moved,
  });
  try {
    await workspace.page
      .getByRole("button", { name: "Locate file…", exact: true })
      .click();
    await expect
      .poll(async () => result(await workspace.cli("status")).active.path)
      .toBe(await realpath(moved));
  } finally {
    await restore();
  }
  await expect(workspace.page.locator(".conflict-banner")).not.toBeVisible();
  expect(await readFile(moved, "utf8")).toBe(original);
  expect(await exists(drawing.path)).toBe(false);
  const locatedTitle = result(await workspace.cli("status")).active.title;
  await create(workspace, "Another open drawing");
  const movedAgain = path.join(
    workspace.drawingsDirectory,
    "Located again.excalidraw",
  );
  await rename(moved, movedAgain);
  await workspace.page
    .getByRole("button", { name: "Your drawings", exact: true })
    .click();
  await workspace.page
    .locator(".open-drawing")
    .filter({ hasText: locatedTitle })
    .click();
  await expect(
    workspace.page.getByRole("dialog", { name: "Where did this drawing go?" }),
  ).toBeVisible();
  await expect(
    workspace.page
      .getByRole("alert")
      .getByRole("button", { name: "Save a copy…", exact: true }),
  ).toHaveCount(0);
  await workspace.screenshot("02-missing-recent-reference");
  restore = await automateNativeDialog(workspace, {
    kind: "open",
    title: "Locate drawing",
    filePath: movedAgain,
  });
  try {
    await workspace.page
      .getByRole("dialog")
      .getByRole("button", { name: "Locate file…", exact: true })
      .click();
    await expect
      .poll(async () => result(await workspace.cli("status")).active.path)
      .toBe(await realpath(movedAgain));
  } finally {
    await restore();
  }
  expect(await readFile(movedAgain, "utf8")).toBe(original);
  const listed = result(
    await workspace.cli("list", { query: locatedTitle, limit: 50 }),
  );
  expect(listed.drawings.some((item: any) => item.path === moved)).toBe(false);
  await workspace.screenshot("03-located-drawing");
  await testInfo.attach("located-original-bytes", {
    path: movedAgain,
    contentType: "application/json",
  });
});

test("Settings clears only agent previews while preserving source drawings and recovery", async ({
  workspace,
}) => {
  const drawing = await create(workspace, "Keep my source and recovery");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "rectangle",
        x: 220,
        y: 180,
        width: 220,
        height: 110,
        label: "Keep this drawing",
      },
    ]),
  );
  result(await workspace.cli("save", await target(workspace)));
  const original = await readFile(drawing.path, "utf8");
  const previewDir = path.join(workspace.dataDirectory, "previews");
  await mkdir(previewDir, { recursive: true });
  const png = path.join(previewDir, "synthetic-preview.png"),
    svg = path.join(previewDir, "synthetic-preview.svg"),
    unrelated = path.join(previewDir, "keep-this-note.txt");
  result(
    await workspace.cli("render", {
      ...(await target(workspace)),
      output: png,
      format: "png",
    }),
  );
  result(
    await workspace.cli("render", {
      ...(await target(workspace)),
      output: svg,
      format: "svg",
    }),
  );
  await writeFile(unrelated, "Not a generated preview.");
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "An unsaved thought worth recovering.",
        x: 220,
        y: 340,
      },
    ]),
  );
  await expect
    .poll(
      async () =>
        result(await workspace.invoke({ command: "recovery-list" })).recovery
          .length,
    )
    .toBe(1);
  await workspace.page
    .getByRole("button", { name: "Your drawings", exact: true })
    .click();
  await workspace.page
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const section = workspace.page.locator(".setting-row").filter({
    has: workspace.page.getByRole("heading", {
      name: "App data on this computer",
      exact: true,
    }),
  });
  await section.scrollIntoViewIfNeeded();
  await expect(section).toContainText(workspace.dataDirectory);
  await workspace.screenshot("01-app-data-settings");
  const revealed = result(await workspace.invoke({ command: "reveal-data" }));
  expect(revealed.path).toBe(workspace.dataDirectory);
  await workspace.application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.show();
    window.focus();
    window.webContents.focus();
  });
  await workspace.page
    .getByRole("button", { name: "Clear agent previews…", exact: true })
    .click();
  await expect(workspace.page.getByRole("dialog")).toContainText(
    "Drawing files and recovery snapshots stay in place.",
  );
  await workspace.screenshot("02-clear-previews-confirmation");
  await workspace.page
    .getByRole("button", { name: "Keep previews", exact: true })
    .click();
  expect(await exists(png)).toBe(true);
  await workspace.page
    .getByRole("button", { name: "Clear agent previews…", exact: true })
    .click();
  await workspace.page
    .getByRole("button", { name: "Clear previews", exact: true })
    .click();
  await expect.poll(() => exists(png)).toBe(false);
  expect(await exists(svg)).toBe(false);
  expect(await readFile(unrelated, "utf8")).toBe("Not a generated preview.");
  expect(await readFile(drawing.path, "utf8")).toBe(original);
  expect(
    result(await workspace.invoke({ command: "recovery-list" })).recovery,
  ).toHaveLength(1);
  await workspace.screenshot("03-preview-cleanup-complete");
  // Only the native application chooser is replaced. Main must read the real
  // bundled licenses (inside ASAR for packaged runs) and publish physical bytes.
  await workspace.application.evaluate(({ shell }) => {
    const state = { original: shell.openPath, paths: [] as string[] };
    (globalThis as any).__e2eLicenseOpener = state;
    shell.openPath = async (filePath) => {
      state.paths.push(filePath);
      return "";
    };
  });
  let licensePaths: string[] = [];
  try {
    await workspace.page
      .getByRole("button", { name: "Third-party notices", exact: true })
      .click();
    await expect
      .poll(() =>
        workspace.application.evaluate(
          () => (globalThis as any).__e2eLicenseOpener.paths.length,
        ),
      )
      .toBe(1);
  } finally {
    licensePaths = await workspace.application.evaluate(({ shell }) => {
      const state = (globalThis as any).__e2eLicenseOpener;
      shell.openPath = state.original;
      delete (globalThis as any).__e2eLicenseOpener;
      return state.paths;
    });
  }
  const licensePath = path.join(
    workspace.dataDirectory,
    "third-party-licenses.txt",
  );
  expect(licensePaths).toEqual([licensePath]);
  expect(licensePath).not.toMatch(/\.asar(?:[\\/]|$)/);
  expect((await lstat(licensePath)).isFile()).toBe(true);
  const notices = await readFile(licensePath, "utf8");
  expect(notices).toBe(
    await readFile(
      path.join(repository, "dist", "THIRD_PARTY_LICENSES.txt"),
      "utf8",
    ),
  );
  expect(notices).toContain("Permission is hereby granted, free of charge");
  expect(notices).toContain("@excalidraw/excalidraw@");
  expect(notices).toContain("Apache License");
  expect(await readFile(drawing.path, "utf8")).toBe(original);
  await workspace.screenshot("04-third-party-notices-published");
});

test("integration setup and Disconnect operate only on the isolated owned paths", async ({
  workspace,
}) => {
  const drawing = await create(workspace, "Keep drawings when disconnecting");
  const original = await readFile(drawing.path, "utf8");
  const before = result(
    await workspace.invoke({ command: "integration-status" }),
  );
  const launcher = path.join(
    workspace.root,
    "bin",
    process.platform === "win32" ? "agent-excalidraw.cmd" : "agent-excalidraw",
  );
  // Abort before any write if a profile override was lost; never touch real roots.
  expect(before.cliPath).toBe(launcher);
  for (const link of before.links)
    expect(link.path.startsWith(workspace.root + path.sep)).toBe(true);
  const unrelated = path.join(
    workspace.root,
    "codex",
    "skills",
    "unrelated-skill",
    "SKILL.md",
  );
  await mkdir(path.dirname(unrelated), { recursive: true });
  await writeFile(unrelated, "Leave this unrelated skill alone.");
  const configuration = path.join(workspace.root, "claude", "settings.json");
  await mkdir(path.dirname(configuration), { recursive: true });
  await writeFile(configuration, '{"unrelated":true}');
  await workspace.page
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await workspace.page
    .getByRole("button", { name: "Install local launcher", exact: true })
    .click();
  await expect.poll(() => exists(launcher)).toBe(true);
  const hostStatus = result(await workspace.cli("status"));
  expect(await workspace.installedLauncher(launcher, ["--version"])).toBe(
    hostStatus.version,
  );
  const launcherStatus = result(
    JSON.parse(
      await workspace.installedLauncher(launcher, [
        "status",
        "--json",
        "--no-launch",
      ]),
    ),
  );
  expect(launcherStatus.protocol).toBe(1);
  expect(launcherStatus.active.id).toBe(hostStatus.active.id);
  expect(launcherStatus.active.path).toBe(drawing.path);
  await workspace.page
    .getByRole("button", {
      name: "Install skill for Codex & Claude Code",
      exact: true,
    })
    .click();
  // Completion must refresh the currently visible paths, without navigating
  // away and relying on the Agents screen's mount effect to fetch fresh state.
  await expect(
    workspace.page.locator(".filepath.small").filter({ hasText: " · linked" }),
  ).toHaveCount(3);
  await expect
    .poll(
      async () =>
        result(
          await workspace.invoke({ command: "integration-status" }),
        ).links.filter((link: any) => link.installed).length,
    )
    .toBe(3);
  const installed = result(
    await workspace.invoke({ command: "integration-status" }),
  );
  const canonical = await realpath(installed.canonical);
  for (const link of installed.links)
    expect(await realpath(link.path)).toBe(canonical);
  await workspace.page
    .getByRole("heading", { name: "Installed on this computer", exact: true })
    .scrollIntoViewIfNeeded();
  await workspace.page
    .locator(".filepath.small")
    .filter({ hasText: " · linked" })
    .last()
    .scrollIntoViewIfNeeded();
  await workspace.screenshot("01-owned-integration-paths");
  await workspace.page
    .getByRole("button", { name: "Disconnect integrations…", exact: true })
    .click();
  await expect(workspace.page.getByRole("dialog")).toContainText(
    "unrelated configuration stay in place.",
  );
  await workspace.screenshot("02-disconnect-confirmation");
  await workspace.page
    .getByRole("button", { name: "Keep connected", exact: true })
    .click();
  expect(await exists(launcher)).toBe(true);
  await workspace.page
    .getByRole("button", { name: "Disconnect integrations…", exact: true })
    .click();
  await workspace.page
    .getByRole("button", { name: "Disconnect integrations", exact: true })
    .click();
  await expect.poll(() => exists(launcher)).toBe(false);
  for (const link of installed.links)
    expect(await exists(link.path)).toBe(false);
  expect(await exists(path.join(canonical, "SKILL.md"))).toBe(true);
  expect(await readFile(unrelated, "utf8")).toBe(
    "Leave this unrelated skill alone.",
  );
  expect(await readFile(configuration, "utf8")).toBe('{"unrelated":true}');
  expect(await readFile(drawing.path, "utf8")).toBe(original);
  await workspace.screenshot("03-disconnected-owned-integrations");
});

test("a selected folder owns New and Refresh while recent order follows actual opens", async ({
  workspace,
}) => {
  const folder = path.join(workspace.root, "Architecture");
  await mkdir(folder);
  const scene = {
    type: "excalidraw",
    version: 2,
    source: "folder-fixture",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
  const earlier = path.join(folder, "Earlier idea.excalidraw");
  await writeFile(earlier, JSON.stringify(scene));
  result(
    await workspace.invoke({ command: "folder-add", args: { path: folder } }),
  );
  await workspace.page
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await workspace.page
    .getByRole("button", { name: "Back to your space", exact: true })
    .click();
  await workspace.page
    .locator(".folder-row")
    .getByRole("button", { name: "Architecture", exact: true })
    .click();
  await expect(
    workspace.page.getByRole("heading", { name: "Architecture", exact: true }),
  ).toBeVisible();
  await workspace.screenshot("01-selected-folder");
  await workspace.page
    .getByRole("button", { name: "New drawing", exact: true })
    .click();
  const created = result(await workspace.cli("status")).active;
  expect(path.dirname(created.path)).toBe(await realpath(folder));
  const later = path.join(folder, "Later external idea.excalidraw");
  await writeFile(later, JSON.stringify(scene));
  await workspace.page
    .getByRole("button", { name: "Your drawings", exact: true })
    .click();
  await workspace.page
    .getByRole("button", { name: "Refresh folder", exact: true })
    .click();
  await expect(
    workspace.page
      .locator(".open-drawing")
      .filter({ hasText: "Later external idea" }),
  ).toBeVisible();
  await workspace.page
    .locator(".open-drawing")
    .filter({ hasText: "Earlier idea" })
    .click();
  await workspace.page
    .getByRole("button", { name: "Your drawings", exact: true })
    .click();
  await expect(workspace.page.locator(".open-drawing").first()).toContainText(
    "Earlier idea",
  );
  await workspace.screenshot("02-refreshed-folder-newest-first");
});

test("an export token writes the captured bytes even after a later agent edit", async ({
  workspace,
}, testInfo) => {
  const drawing = await create(workspace, "Capture one revision");
  result(
    await apply(workspace, [
      {
        op: "create",
        ref: "one",
        type: "rectangle",
        x: 220,
        y: 180,
        width: 220,
        height: 110,
        label: "Captured thought",
      },
    ]),
  );
  result(await workspace.cli("save", await target(workspace)));
  const sourceBytes = await readFile(drawing.path, "utf8");
  const preview = result(
    await workspace.invoke({
      command: "export-preview",
      args: { format: "png", scale: 1 },
    }),
  );
  const expected = Buffer.from(preview.dataURL.split(",")[1], "base64");
  pngDimensions(expected);
  result(
    await apply(workspace, [
      {
        op: "create",
        type: "text",
        text: "A later thought outside the captured preview.",
        x: 220,
        y: 380,
      },
    ]),
  );
  expect((await snapshot(workspace)).revision).toBeGreaterThan(
    preview.revision,
  );
  const output = path.join(workspace.root, "captured-preview.png");
  const exported = result(
    await workspace.invoke({
      command: "export",
      args: { previewToken: preview.previewToken, output },
    }),
  );
  expect(exported.previewMatched).toBe(true);
  expect(exported.revision).toBe(preview.revision);
  expect(await readFile(output)).toEqual(expected);
  expect(await readFile(drawing.path, "utf8")).toBe(sourceBytes);
  expect(result(await workspace.cli("status")).dirty).toBe(true);
  await testInfo.attach("exact-captured-export", {
    path: output,
    contentType: "image/png",
  });
});

test("the export sheet previews real selection and PNG scale and preserves work on picker cancellation", async ({
  workspace,
}, testInfo) => {
  const drawing = await create(workspace, "Preview before exporting");
  const batch = result(
    await apply(workspace, [
      {
        op: "create",
        ref: "one",
        type: "rectangle",
        x: 100,
        y: 160,
        width: 200,
        height: 100,
        label: "One thought",
      },
      {
        op: "create",
        type: "rectangle",
        x: 650,
        y: 160,
        width: 200,
        height: 100,
        label: "Another thought",
      },
    ]),
  );
  const first = batch.created.find((entry: any) => entry.ref === "one").id;
  result(
    await workspace.cli("view", { ...(await target(workspace)), ids: [first] }),
  );
  const sourceBytes = await readFile(drawing.path, "utf8");
  await openExportSheet(workspace.page);
  const preview = workspace.page.getByRole("img", {
    name: "Captured drawing export preview",
    exact: true,
  });
  await expect(preview).toBeVisible();
  let src = await preview.getAttribute("src");
  const whole = pngDimensions(Buffer.from(src!.split(",")[1], "base64"));
  await workspace.screenshot("01-whole-drawing-export-preview");
  await workspace.page
    .getByLabel("Resolution", { exact: true })
    .selectOption("2");
  await expect
    .poll(async () =>
      pngDimensions(
        Buffer.from(
          (await preview.getAttribute("src"))!.split(",")[1],
          "base64",
        ),
      ),
    )
    .toEqual({ width: whole.width * 2, height: whole.height * 2 });
  await workspace.page
    .getByLabel("Area", { exact: true })
    .selectOption("selection");
  await expect
    .poll(
      async () =>
        pngDimensions(
          Buffer.from(
            (await preview.getAttribute("src"))!.split(",")[1],
            "base64",
          ),
        ).width,
    )
    .toBeLessThan(whole.width * 2);
  src = await preview.getAttribute("src");
  const selected = pngDimensions(Buffer.from(src!.split(",")[1], "base64"));
  expect(selected.height).toBeGreaterThan(0);
  await workspace.screenshot("02-selected-high-resolution-preview");
  const rootBeforeCancel = (await readdir(workspace.root)).sort(),
    drawingsBeforeCancel = (await readdir(workspace.drawingsDirectory)).sort();
  const restore = await automateNativeDialog(workspace, {
    kind: "save",
    defaultPath: "Preview before exporting.png",
    cancel: true,
  });
  try {
    await workspace.page
      .getByRole("dialog", { name: "Take your drawing with you.", exact: true })
      .getByRole("button", { name: "Export…", exact: true })
      .click();
    await expect(
      workspace.page.getByRole("dialog", {
        name: "Take your drawing with you.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      workspace.page
        .getByRole("dialog", {
          name: "Take your drawing with you.",
          exact: true,
        })
        .getByRole("button", { name: "Export…", exact: true }),
    ).toBeEnabled();
    expect(await readFile(drawing.path, "utf8")).toBe(sourceBytes);
    expect((await readdir(workspace.root)).sort()).toEqual(rootBeforeCancel);
    expect((await readdir(workspace.drawingsDirectory)).sort()).toEqual(
      drawingsBeforeCancel,
    );
  } finally {
    await testInfo.attach("automated-native-export-cancel", {
      body: Buffer.from(JSON.stringify(await restore())),
      contentType: "application/json",
    });
  }
  expect(result(await workspace.cli("status")).dirty).toBe(true);
  const output = path.join(workspace.root, "selected-high-resolution.png");
  const approve = await automateNativeDialog(workspace, {
    kind: "save",
    defaultPath: "Preview before exporting.png",
    filePath: output,
  });
  try {
    await workspace.page
      .getByRole("dialog", { name: "Take your drawing with you.", exact: true })
      .getByRole("button", { name: "Export…", exact: true })
      .click();
    await expect(
      workspace.page.getByRole("dialog", {
        name: "Take your drawing with you.",
        exact: true,
      }),
    ).not.toBeVisible();
  } finally {
    await approve();
  }
  expect(await readFile(output)).toEqual(
    Buffer.from(src!.split(",")[1], "base64"),
  );
  expect(pngDimensions(await readFile(output))).toEqual(selected);
  expect(await readFile(drawing.path, "utf8")).toBe(sourceBytes);
  await testInfo.attach("selected-scaled-export", {
    path: output,
    contentType: "image/png",
  });

  const canvas = workspace.page.locator(
    "canvas.excalidraw__canvas.interactive",
  );
  await canvas.click({ button: "right", position: { x: 800, y: 500 } });
  // This is the stock SDK portal, so verify the ancestor selector really matches
  // the live menu rather than merely asserting that our stylesheet contains it.
  await expect(workspace.page.getByTestId("copyAsSvg")).toHaveCount(1);
  await expect(workspace.page.getByTestId("copyAsSvg")).toBeHidden();
  await expect(workspace.page.getByTestId("copyAsPng")).toBeVisible();
  await workspace.screenshot("03-safe-native-context-menu");
  await workspace.page.keyboard.press("Escape");
  for (const shortcut of [`${modifier}+Shift+p`, `${modifier}+/`]) {
    await workspace.page.keyboard.press(shortcut);
    await expect(
      workspace.page.getByText("Copy as SVG", { exact: true }),
    ).toBeHidden();
    await workspace.page.keyboard.press("Escape");
  }

  // Capture only the OS clipboard write boundary; do not read or overwrite the
  // user's real clipboard. The editor, prepared SVG and host copy route are real.
  await workspace.application.evaluate(({ clipboard }) => {
    const state = { original: clipboard.writeText, values: [] as string[] };
    (globalThis as any).__e2eSvgClipboard = state;
    clipboard.writeText = async (value) => {
      state.values.push(value);
    };
  });
  let copied: string[] = [];
  try {
    await openExportSheet(workspace.page);
    await workspace.page
      .getByLabel("Format", { exact: true })
      .selectOption("svg");
    const copy = workspace.page.getByRole("button", {
      name: "Copy SVG",
      exact: true,
    });
    await expect(
      workspace.page.getByRole("img", {
        name: "Captured drawing export preview",
        exact: true,
      }),
    ).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
    await expect(copy).toBeEnabled();
    const svgPreview = await workspace.page
      .getByRole("img", {
        name: "Captured drawing export preview",
        exact: true,
      })
      .getAttribute("src");
    const expectedSvg = Buffer.from(
      svgPreview!.split(",")[1],
      "base64",
    ).toString("utf8");
    await workspace.screenshot("04-controlled-svg-copy");
    await copy.click();
    await expect
      .poll(() =>
        workspace.application.evaluate(
          () => (globalThis as any).__e2eSvgClipboard.values.length,
        ),
      )
      .toBe(1);
    copied = await workspace.application.evaluate(
      () => (globalThis as any).__e2eSvgClipboard.values,
    );
    expect(copied).toEqual([expectedSvg]);
    expect(copied[0]).toContain("<svg");
    expect(copied[0]).toMatch(/data:font\/woff2;base64,/);
    expect(copied[0]).not.toMatch(/url\(\s*["']?(?:https?:|app:|file:)/i);
    expect(copied[0]).not.toContain("cdn.jsdelivr.net");
    expect(copied[0]).not.toMatch(
      /payload-type:application\/vnd\.excalidraw|payload-start|payload-end/i,
    );
    const extraMetadata = await workspace.page.evaluate((svgText) => {
      const svg = new DOMParser().parseFromString(svgText, "image/svg+xml");
      return [...svg.querySelectorAll("metadata")]
        .filter(
          (node) =>
            node.getAttribute("data-agent-excalidraw-font-notices") !== "true",
        )
        .map((node) => node.innerHTML.trim())
        .filter(Boolean);
    }, copied[0]);
    expect(extraMetadata).toEqual([]);
    await expect(
      workspace.page.getByRole("dialog", {
        name: "Take your drawing with you.",
        exact: true,
      }),
    ).not.toBeVisible();
    expect(await readFile(drawing.path, "utf8")).toBe(sourceBytes);
  } finally {
    await workspace.application.evaluate(({ clipboard }) => {
      clipboard.writeText = (globalThis as any).__e2eSvgClipboard.original;
      delete (globalThis as any).__e2eSvgClipboard;
    });
  }
});

test("selected-frame PNG and SVG exports clip children to the frame and report actual dimensions", async ({
  workspace,
}, testInfo) => {
  const common = {
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
  const frameId = "export-focus-frame";
  const fixture = {
    type: "excalidraw",
    version: 2,
    source: "e2e-selected-frame",
    elements: [
      {
        ...common,
        id: frameId,
        type: "frame",
        x: 200,
        y: 200,
        width: 300,
        height: 200,
        name: "Focus frame",
      },
      {
        ...common,
        id: "left-partial-red",
        type: "rectangle",
        frameId,
        x: 120,
        y: 240,
        width: 180,
        height: 100,
        backgroundColor: "#ff0000",
      },
      {
        ...common,
        id: "right-partial-blue",
        type: "rectangle",
        frameId,
        x: 450,
        y: 240,
        width: 150,
        height: 100,
        backgroundColor: "#0000ff",
      },
      {
        ...common,
        id: "fully-outside-green",
        type: "rectangle",
        frameId,
        x: 700,
        y: 240,
        width: 120,
        height: 100,
        backgroundColor: "#00ff00",
      },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
  const file = path.join(
    workspace.drawingsDirectory,
    "Frame clipping fixture.excalidraw",
  );
  const fixtureBytes = JSON.stringify(fixture);
  await writeFile(file, fixtureBytes);
  result(await workspace.cli("open", { path: file }));
  const loaded = await snapshot(workspace);
  expect(
    loaded.elements.find((element: any) => element.id === "fully-outside-green")
      .frameId,
  ).toBe(frameId);
  result(
    await workspace.cli("view", {
      ...(await target(workspace)),
      ids: [frameId],
      focus: true,
    }),
  );
  expect((await snapshot(workspace)).selection).toEqual([frameId]);
  await workspace.screenshot("01-frame-only-selection");
  for (const format of ["png", "svg"] as const) {
    const scale = format === "png" ? 2 : 1;
    const preview = result(
      await workspace.invoke({
        command: "export-preview",
        args: { format, selection: true, scale, background: true },
      }),
    );
    const pixels = await workspace.page.evaluate(async (dataURL) => {
      const image = new Image();
      image.src = dataURL;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0,
        blue = 0,
        green = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const [r, g, b, alpha] = data.subarray(offset, offset + 4);
        if (alpha > 240 && r > 240 && g < 15 && b < 15) red++;
        if (alpha > 240 && b > 240 && r < 15 && g < 15) blue++;
        if (alpha > 240 && g > 240 && r < 15 && b < 15) green++;
      }
      return { width: canvas.width, height: canvas.height, red, blue, green };
    }, preview.dataURL);
    expect(pixels.width).toBe(300 * scale);
    expect(pixels.height).toBe(200 * scale);
    expect(pixels.width).toBe(preview.width);
    expect(pixels.height).toBe(preview.height);
    expect(pixels.red).toBeGreaterThan(0);
    expect(pixels.blue).toBeGreaterThan(0);
    expect(pixels.green).toBe(0);
    const output = path.join(workspace.root, `selected-frame.${format}`);
    const rendered = result(
      await workspace.cli("render", {
        ...(await target(workspace)),
        selection: true,
        format,
        scale,
        output,
      }),
    );
    expect(rendered.bounds).toEqual([200, 200, 500, 400]);
    expect(rendered.width).toBe(pixels.width);
    expect(rendered.height).toBe(pixels.height);
    expect(rendered.scale).toBe(scale);
    expect(rendered.transform).toEqual({ sceneOrigin: [200, 200], scale });
    if (format === "png")
      expect(await readFile(output)).toEqual(
        Buffer.from(preview.dataURL.split(",")[1], "base64"),
      );
    if (format === "png")
      expect(pngDimensions(await readFile(output))).toEqual({
        width: pixels.width,
        height: pixels.height,
      });
    await testInfo.attach(`frame-clipped-${format}`, {
      path: output,
      contentType: format === "png" ? "image/png" : "image/svg+xml",
    });
  }
  expect(await readFile(file, "utf8")).toBe(fixtureBytes);
});
