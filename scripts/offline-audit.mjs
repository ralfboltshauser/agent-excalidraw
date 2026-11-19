#!/usr/bin/env node
/** Build/package first. Native, synthetic-data request audit; not an OS firewall.
 * AGENT_EXCALIDRAW_EXECUTABLE=/absolute/app/executable node scripts/offline-audit.mjs
 * Two fresh profiles: normal-network request observation, then browser-offline
 * editing. Separate positive controls exercise renderer blocking and an explicit
 * main-process update check. App CSP/onBeforeRequest are never replaced.
 */
import { _electron } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const output = path.join(repository, "artifacts", "offline-audit");
const home = await mkdtemp(
  path.join(
    process.platform === "darwin" ? "/tmp" : os.tmpdir(),
    "ae-offline-",
  ),
);
const executable = process.env.AGENT_EXCALIDRAW_EXECUTABLE;
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined &&
      !["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key),
  ),
);
const fontManifest = JSON.parse(
  await readFile(
    path.join(repository, "assets/font-licenses/bundled-font-metadata.json"),
    "utf8",
  ),
);
const assetInputs = Object.values(fontManifest.families)
  .flatMap((family) => family.assets)
  .map((asset) => ({
    ...asset,
    sha256:
      asset.name === fontManifest.replacement?.upstreamPath
        ? fontManifest.replacement.replacementSha256
        : asset.sha256,
  }));
const report = {
  started: new Date().toISOString(),
  home,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  executable: executable || "development Electron",
  profiles: [],
  limitations: [
    "Observed native Electron/browser requests and main-process undici fetch events, not packet capture or OS-level egress isolation.",
    "Observers attach at the first native window, before confidential scene work. Requests earlier in process startup are outside the observed window.",
    "Browser-offline emulation disables Chromium network access; it is not a machine-wide airplane-mode test and does not disable Node main-process networking.",
    "All content is synthetic. No cloud agent/model, credentials, endpoint tokens, request headers or request bodies are logged.",
    "All 234 bundled WOFF2 assets are fetched, hash-checked and parsed by the real browser FontFace implementation; representative family/CJK text is drawn/exported. This is not an exhaustive visual audit of every Unicode glyph.",
  ],
};
let application,
  page,
  phase = "startup-observed",
  browserEvents = [],
  processLog = [];
const remote = (url) => /^https?:|^wss?:/.test(url);
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return String(value);
  }
};
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const result = (reply) => {
  check(
    reply?.ok,
    `${reply?.error?.code || "INVALID_REPLY"}: ${reply?.error?.message || "Missing app reply"}`,
  );
  return reply.result;
};
async function persist() {
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(path.join(output, "native-process.log"), processLog.join(""));
}
async function invoke(command, args = {}, context = {}) {
  return result(
    await page.evaluate((request) => window.agentExcalidraw.invoke(request), {
      command,
      args,
      ...context,
    }),
  );
}
async function snapshot() {
  return invoke("snapshot", { limit: 5000 });
}
async function target() {
  const scene = await snapshot();
  return { document: scene.document, epoch: scene.epoch };
}
async function setPhase(value) {
  phase = value;
  await application.evaluate((_, value) => {
    globalThis.__aeOfflineAudit.phase = value;
  }, value);
  await page.evaluate((value) => {
    globalThis.__aeAuditPhase = value;
  }, value);
}
async function settle() {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function until(action, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}
async function auditState() {
  return application.evaluate(() => ({
    mainFetch: globalThis.__aeOfflineAudit.mainFetch,
    rendererNetwork: globalThis.__aeOfflineAudit.rendererNetwork,
  }));
}
async function close() {
  if (!application) return;
  const owned = application;
  application = undefined;
  let timer;
  try {
    await Promise.race([
      owned.close(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Audit app close timed out")),
          5000,
        );
        timer.unref();
      }),
    ]);
  } catch (error) {
    processLog.push(`CLOSE: ${error.message}\n`);
    owned.process().kill("SIGKILL");
  } finally {
    clearTimeout(timer);
  }
}

async function observeMain() {
  await application.evaluate(({ session }) => {
    const audit = (globalThis.__aeOfflineAudit = {
      phase: "startup-observed",
      mainFetch: [],
      rendererNetwork: [],
    });
    const safe = (value) => {
      try {
        const url = new URL(value);
        url.search = "";
        url.hash = "";
        url.username = "";
        url.password = "";
        return url.href;
      } catch {
        return String(value);
      }
    };
    // Observe completions/errors only. Never replace the app's blocking
    // onBeforeRequest handler or weaken its CSP/permissions in order to test it.
    session.defaultSession.webRequest.onCompleted((details) =>
      audit.rendererNetwork.push({
        phase: audit.phase,
        event: "completed",
        url: safe(details.url),
        resourceType: details.resourceType,
        statusCode: details.statusCode,
        time: Date.now(),
      }),
    );
    session.defaultSession.webRequest.onErrorOccurred((details) =>
      audit.rendererNetwork.push({
        phase: audit.phase,
        event: "failed",
        url: safe(details.url),
        resourceType: details.resourceType,
        error: details.error,
        time: Date.now(),
      }),
    );
    const channels = process.getBuiltinModule("diagnostics_channel");
    const urlFor = (request) =>
      safe(String(request.origin || "") + String(request.path || ""));
    channels.channel("undici:request:create").subscribe(({ request }) =>
      audit.mainFetch.push({
        phase: audit.phase,
        event: "request",
        url: urlFor(request),
        method: request.method,
        time: Date.now(),
      }),
    );
    channels
      .channel("undici:request:headers")
      .subscribe(({ request, response }) =>
        audit.mainFetch.push({
          phase: audit.phase,
          event: "response",
          url: urlFor(request),
          statusCode: response.statusCode,
          time: Date.now(),
        }),
      );
    channels.channel("undici:request:error").subscribe(({ request, error }) =>
      audit.mainFetch.push({
        phase: audit.phase,
        event: "failed",
        url: urlFor(request),
        error: error.code || error.message,
        time: Date.now(),
      }),
    );
  });
}
async function launch(name, offline) {
  phase = "startup-observed";
  browserEvents = [];
  const directory = path.join(home, name);
  await mkdir(directory, { recursive: true });
  application = await _electron.launch({
    ...(executable ? { executablePath: path.resolve(executable) } : {}),
    args: executable ? [] : ["."],
    cwd: repository,
    env: { ...env, AGENT_EXCALIDRAW_DATA_DIR: directory },
    timeout: 60000,
  });
  application
    .process()
    .stdout?.on("data", (value) => processLog.push(String(value)));
  application
    .process()
    .stderr?.on("data", (value) => processLog.push(String(value)));
  page = await application.firstWindow();
  page.setDefaultTimeout(20000);
  const requestPhases = new WeakMap();
  page.on("request", (request) => {
    requestPhases.set(request, phase);
    browserEvents.push({
      phase,
      event: "request",
      url: safeUrl(request.url()),
      resourceType: request.resourceType(),
    });
  });
  page.on("requestfinished", (request) =>
    browserEvents.push({
      phase: requestPhases.get(request) || phase,
      event: "completed",
      url: safeUrl(request.url()),
      resourceType: request.resourceType(),
    }),
  );
  page.on("requestfailed", (request) =>
    browserEvents.push({
      phase: requestPhases.get(request) || phase,
      event: "failed",
      url: safeUrl(request.url()),
      resourceType: request.resourceType(),
      error: request.failure()?.errorText,
    }),
  );
  page.on("websocket", (socket) =>
    browserEvents.push({
      phase,
      event: "websocket",
      url: safeUrl(socket.url()),
    }),
  );
  page.on("pageerror", (error) =>
    processLog.push(`RENDERER: ${error.message}\n`),
  );
  await observeMain();
  if (offline) await application.context().setOffline(true);
  await page.waitForFunction(() => Boolean(window.agentExcalidraw));
  await page.evaluate(() => {
    globalThis.__aeCspAudit = [];
    globalThis.__aeAuditPhase = "startup-observed";
    document.addEventListener("securitypolicyviolation", (event) =>
      globalThis.__aeCspAudit.push({
        phase: globalThis.__aeAuditPhase,
        event: "csp-blocked",
        url: event.blockedURI,
        directive: event.effectiveDirective,
      }),
    );
  });
  await until(
    () =>
      page
        .getByRole("button", { name: "New drawing", exact: true })
        .isEnabled(),
    "usable native editor",
  );
  return {
    name,
    offline,
    navigatorOnline: await page.evaluate(() => navigator.onLine),
    dataDirectory: directory,
    fontFamilies: [],
    exports: [],
    assets: [],
  };
}
async function importImage(directory) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    context.fillStyle = "#eeedff";
    context.fillRect(0, 0, 240, 100);
    context.fillStyle = "#6965db";
    context.font = "20px sans-serif";
    context.fillText("Only a local image", 24, 57);
    return canvas.toDataURL("image/png");
  });
  const file = path.join(directory, "local-image.png");
  await writeFile(file, Buffer.from(encoded.split(",")[1], "base64"));
  const chosen = page.waitForEvent("filechooser");
  await page.getByTestId("toolbar-image").locator("..").click();
  await (await chosen).setFiles(file);
  await until(
    async () =>
      (await snapshot()).elements.some(
        (element) => element.type === "image" && element.fileId,
      ),
    "actual image import",
  );
  const bounds = await page
    .locator("canvas.excalidraw__canvas.interactive")
    .boundingBox();
  check(bounds, "No image placement canvas");
  await page.mouse.click(
    bounds.x + Math.min(800, bounds.width - 100),
    bounds.y + Math.min(400, bounds.height - 100),
  );
  return until(
    async () =>
      (await snapshot()).elements.find(
        (element) =>
          element.type === "image" && element.width > 0 && element.height > 0,
      ),
    "image placement",
  );
}
async function verifyAllFontAssets() {
  return page.evaluate(async (inputs) => {
    const outputs = [];
    for (let i = 0; i < inputs.length; i++) {
      const asset = inputs[i],
        url = new URL("fonts/" + asset.name, location.href).href;
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(
          `Missing font asset: ${asset.name} (${response.status})`,
        );
      const data = await response.arrayBuffer(),
        signature = String.fromCharCode(...new Uint8Array(data.slice(0, 4)));
      if (signature !== "wOF2")
        throw new Error(`Invalid WOFF2 asset: ${asset.name}`);
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
      ]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      if (hash !== asset.sha256)
        throw new Error(`Font checksum mismatch: ${asset.name}`);
      // Parse actual bytes without adding probe names to document.fonts. This
      // cannot mask a missing SDK family or alter its normal font resolution.
      const face = new FontFace(`audit_asset_${i}`, data);
      await face.load();
      outputs.push({
        name: asset.name,
        bytes: data.byteLength,
        sha256: hash,
        parsed: face.status,
      });
    }
    return outputs;
  }, assetInputs);
}
async function exercise(profile) {
  const directory = path.join(home, profile.name + "-drawings");
  await mkdir(directory, { recursive: true });
  await invoke("settings", { defaultFolder: directory, theme: "light" });
  await setPhase("confidential-editing");
  const file = path.join(directory, "Local fonts and image.excalidraw");
  await invoke("new", { path: file });
  const fonts = [
    [1, "Virgil"],
    [2, "Helvetica (system)"],
    [3, "Cascadia"],
    [5, "Excalifont"],
    [6, "Nunito"],
    [7, "Lilita One"],
    [8, "Comic Shanns"],
    [9, "Liberation Sans resource / Agent Sans"],
  ];
  const operations = fonts.map(([fontFamily, name], index) => ({
    op: "create",
    type: "text",
    ref: `font-${fontFamily}`,
    fontFamily,
    fontSize: 24,
    x: 70,
    y: 70 + index * 58,
    text: `${name}: Local ideas 0123 · ‒`,
  }));
  operations.push(
    {
      op: "create",
      type: "text",
      ref: "cjk",
      fontFamily: 5,
      fontSize: 24,
      x: 70,
      y: 565,
      text: "本地保密圖示 · 日本語 · 한글 · ✏️",
    },
    {
      op: "create",
      type: "rectangle",
      ref: "embed-base",
      x: 780,
      y: 520,
      width: 260,
      height: 140,
      label: "Local-only placeholder",
    },
  );
  let current = await snapshot();
  await invoke(
    "apply",
    { operations },
    {
      document: current.document,
      epoch: current.epoch,
      expectedRevision: current.revision,
      requestId: randomUUID(),
    },
  );
  const imported = await importImage(directory);
  await invoke("save");
  const saved = JSON.parse(await readFile(file, "utf8"));
  check(
    saved.files[imported.fileId]?.dataURL?.startsWith("data:image/png;base64,"),
    "The actual imported image was not embedded in the saved source",
  );
  const template = saved.elements.find(
    (element) => element.type === "rectangle",
  );
  const embedded = {
    ...template,
    id: randomUUID(),
    type: "embeddable",
    x: 780,
    y: 70,
    width: 300,
    height: 180,
    link: "https://example.com/agent-excalidraw-offline-probe",
    boundElements: null,
    groupIds: [],
    isDeleted: false,
  };
  delete embedded.index;
  const embeddedFile = path.join(
    directory,
    "Local remote-embed placeholder.excalidraw",
  );
  await writeFile(
    embeddedFile,
    JSON.stringify({ ...saved, elements: [...saved.elements, embedded] }),
  );
  await invoke("open", { path: embeddedFile });
  await until(
    async () =>
      (await snapshot()).elements.some(
        (element) =>
          element.id === embedded.id && element.type === "embeddable",
      ),
    "preserved imported embed",
  );
  check(
    (await page.locator('iframe[src^="http"],iframe[srcdoc]').count()) === 0,
    "Imported remote content created an active external/script iframe",
  );
  await invoke("view", { focus: true });
  await settle();
  await page.screenshot({
    path: path.join(output, `${profile.name}-fonts-image-placeholder.png`),
  });
  await invoke("save");
  await invoke("open", { path: embeddedFile });
  const reopened = JSON.parse(await readFile(embeddedFile, "utf8"));
  check(
    reopened.files[imported.fileId]?.dataURL ===
      saved.files[imported.fileId].dataURL,
    "Image bytes changed after save/reopen",
  );
  const textElements = (await snapshot()).elements.filter(
    (element) => element.type === "text",
  );
  profile.fontFamilies = fonts.map(([id, name]) => ({
    id,
    name,
    scenePresent: textElements.some((element) => element.fontFamily === id),
  }));
  check(
    profile.fontFamilies.every((font) => font.scenePresent),
    "A requested font family disappeared from the real scene",
  );
  for (const format of ["png", "svg"]) {
    const destination = path.join(output, `${profile.name}-export.${format}`);
    const rendered = await invoke(
      "render",
      { output: destination, format },
      await target(),
    );
    const bytes = await readFile(destination);
    check(bytes.length > 100, `Empty ${format} export`);
    if (format === "png")
      check(
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        "PNG export signature is invalid",
      );
    if (format === "svg") {
      profile.svgRemoteAssets = await page.evaluate((text) => {
        const document = new DOMParser().parseFromString(text, "image/svg+xml");
        return {
          parserErrors: document.querySelectorAll("parsererror").length,
          remoteImages: [...document.querySelectorAll("image")]
            .map(
              (image) =>
                image.getAttribute("href") ||
                image.getAttribute("xlink:href") ||
                "",
            )
            .filter((url) => /^https?:/.test(url)),
          remoteCss: [...document.querySelectorAll("style")]
            .map((style) => style.textContent)
            .filter((text) => /url\(["']?https?:/i.test(text)),
        };
      }, bytes.toString("utf8"));
      check(
        profile.svgRemoteAssets.parserErrors === 0 &&
          !profile.svgRemoteAssets.remoteImages.length &&
          !profile.svgRemoteAssets.remoteCss.length,
        "SVG contains invalid XML or remote font/image resources",
      );
    }
    profile.exports.push({
      format,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      revision: rendered.revision,
    });
  }
  profile.assets = await verifyAllFontAssets();
  profile.loadedFaces = await page.evaluate(() =>
    [...document.fonts]
      .map((face) => ({ family: face.family, status: face.status }))
      .filter((face) => face.status === "loaded"),
  );
  await setPhase("confidential-finished");
  await settle();
  const observed = await auditState();
  profile.confidential = {
    mainFetch: observed.mainFetch.filter(
      (event) => event.phase === "confidential-editing",
    ),
    rendererRemote: observed.rendererNetwork.filter(
      (event) => event.phase === "confidential-editing" && remote(event.url),
    ),
    browserRemote: browserEvents.filter(
      (event) => event.phase === "confidential-editing" && remote(event.url),
    ),
    localCompleted: observed.rendererNetwork.filter(
      (event) =>
        event.phase === "confidential-editing" &&
        event.event === "completed" &&
        event.url.startsWith("app://local/"),
    ).length,
  };
  check(
    !profile.confidential.mainFetch.length,
    "Confidential editing attempted an unexpected main-process network request",
  );
  check(
    !profile.confidential.rendererRemote.some(
      (event) => event.event === "completed",
    ) &&
      !profile.confidential.browserRemote.some(
        (event) => event.event === "completed" || event.event === "websocket",
      ),
    "Confidential editing completed an unexpected remote request",
  );
  profile.cspViolations = await page.evaluate(() => globalThis.__aeCspAudit);
  profile.observed = observed;
  profile.browserEvents = [...browserEvents];
  profile.savedDrawing = embeddedFile;
}

try {
  await mkdir(output, { recursive: true });
  if (executable) {
    await access(executable);
    if (process.platform === "darwin") {
      const archive = path.resolve(
        path.dirname(executable),
        "..",
        "Resources",
        "app.asar",
      );
      try {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(archive)) hash.update(chunk);
        report.appArchiveSha256 = hash.digest("hex");
      } catch {
        report.appArchiveSha256 =
          "Archive not resolved; executable path recorded";
      }
    }
  }
  for (const offline of [false, true]) {
    const profile = await launch(
      offline ? "browser-offline" : "normal-network",
      offline,
    );
    report.profiles.push(profile);
    await exercise(profile);
    if (!offline) {
      await setPhase("intentional-renderer-block-control");
      profile.blockControl = await page.evaluate(async () => {
        try {
          const response = await fetch(
            "https://example.com/agent-excalidraw-network-control",
          );
          return { resolved: true, status: response.status };
        } catch (error) {
          return { resolved: false, error: String(error) };
        }
      });
      await settle();
      check(
        !profile.blockControl.resolved,
        "The renderer network control unexpectedly succeeded",
      );
      await setPhase("explicit-update-control");
      profile.explicitUpdate = await page.evaluate(() =>
        window.agentExcalidraw.invoke({ command: "update-check" }),
      );
      await settle();
      const observed = await auditState();
      profile.mainPositiveControl = observed.mainFetch.filter(
        (event) => event.phase === "explicit-update-control",
      );
      check(
        profile.mainPositiveControl.some(
          (event) => event.event === "request",
        ) &&
          profile.mainPositiveControl.some(
            (event) => event.event === "response",
          ),
        "Main updater positive control did not produce an observed real HTTP response",
      );
      profile.cspViolations = await page.evaluate(
        () => globalThis.__aeCspAudit,
      );
      profile.rendererBlockObserved = [
        ...browserEvents,
        ...observed.rendererNetwork,
        ...profile.cspViolations,
      ].filter(
        (event) =>
          event.phase === "intentional-renderer-block-control" &&
          remote(event.url),
      );
      check(
        !profile.rendererBlockObserved.some(
          (event) => event.event === "completed",
        ),
        "The blocked renderer control completed remote traffic",
      );
      check(
        profile.rendererBlockObserved.some(
          (event) =>
            event.event === "failed" ||
            event.event === "request" ||
            event.event === "csp-blocked",
        ),
        "The renderer block control was not visible to either observer",
      );
      profile.observed = observed;
      profile.browserEvents = [...browserEvents];
    }
    await persist();
    await close();
    console.log(
      `${profile.name}: saved/reopened image, all font families, CJK, PNG/SVG, inactive embed, ${profile.assets.length} parsed/hash-verified local font assets; no observed successful confidential remote requests.`,
    );
  }
  report.finished = new Date().toISOString();
  report.result =
    "Observed confidential flows and isolated positive controls passed; see precise coverage limits.";
  await persist();
  console.log(`Native audit evidence: ${path.join(output, "report.json")}`);
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  report.finished = new Date().toISOString();
  if (application) {
    try {
      report.failure.observed = await auditState();
      report.failure.browserEvents = browserEvents;
    } catch {}
  }
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
  await persist();
  console.error(error);
  process.exitCode = 1;
} finally {
  await close();
}
