#!/usr/bin/env node
/** Native diagnostic, never a release-pass assertion. Build first.
 * node scripts/benchmark.mjs --quick       five samples, ten scene switches
 * node scripts/benchmark.mjs               twenty samples, fifty scene switches
 * Optional AGENT_EXCALIDRAW_EXECUTABLE tests a packaged app instead of dev Electron.
 * All drawing contents, app data and fixture metadata are owned synthetic inputs.
 */
import { _electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  stat,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");
if (process.argv.some((arg) => ["--help", "-h"].includes(arg))) {
  console.log(
    "Build first, then run node scripts/benchmark.mjs [--quick]. Uses real native Electron and CLI. Full:20 samples/50 scene switches; quick:5 samples/10 switches (insufficient for target acceptance). Evidence:artifacts/benchmark/.",
  );
  process.exit(0);
}
const samples = quick ? 5 : 20,
  cycles = quick ? 10 : 50;
const runProcess = promisify(execFile);
const artifactRoot = path.join(root, "artifacts", "benchmark");
const work = await mkdtemp(
  path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "ae-bench-"),
);
const drawings = path.join(work, "drawings");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined &&
      !["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key),
  ),
);
const report = {
  mode: quick ? "quick-diagnostic" : "reference-diagnostic",
  started: new Date().toISOString(),
  samples,
  cycles,
  syntheticHome: work,
  hardware: {
    platform: process.platform,
    architecture: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    osVersion: os.version(),
    cpuModel: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
  },
  runtime: {},
  fixtures: {},
  metrics: {},
  memory: [],
  limitations: [
    "No automatic performance acceptance. Review actual values on declared reference hardware.",
    "Fresh app data does not purge OS filesystem caches. Cold samples are process-cold/app-data-cold, not disk-cache-cold.",
    "Open timing ends after the real open command and two animation frames; not a claim that every offscreen asset has painted.",
    "UI timings include Playwright action/transport overhead. They are observed journeys, not isolated browser input-delay measurements.",
    "Memory sums process working sets and may count shared pages more than once. No forced garbage collection.",
    "The app has one mounted editor and no close-document command. Memory cycles switch away through Library and load another document; they do not create/close retained tabs.",
    "Generated library fixture contains 10,000 real metadata entries and 500 actual source files; the other entries deliberately represent missing/unavailable drawings.",
    ...(quick
      ? [
          "Five samples and ten switches are insufficient for p95/50-cycle milestone acceptance.",
        ]
      : []),
  ],
  targets: {
    coldUsableMs: 4000,
    warmSmallOpenMs: 1000,
    indexedSearchMs: 100,
    shellResponseMs: 100,
    smallRenderMs: 1500,
  },
  acceptance: "Not assessed; measured diagnostics and native evidence only.",
};
const logs = [];
let application, page;
function result(reply) {
  if (!reply?.ok)
    throw new Error(
      `${reply?.error?.code || "INVALID_REPLY"}: ${reply?.error?.message || "No valid application reply"}`,
    );
  return reply.result;
}
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    valuesMs: values.map((value) => +value.toFixed(2)),
    minMs: +sorted[0].toFixed(2),
    medianMs: +sorted[Math.floor((sorted.length - 1) / 2)].toFixed(2),
    nearestRankP95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2),
    maxMs: +sorted.at(-1).toFixed(2),
    sufficientSamplesForPlannedP95Gate: values.length >= 20,
  };
}
async function persist() {
  await writeFile(
    path.join(artifactRoot, "metrics.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(path.join(artifactRoot, "native-process.log"), logs.join(""));
}
async function paint() {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
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
async function target() {
  const scene = await invoke("snapshot", { limit: 1 });
  return { document: scene.document, epoch: scene.epoch };
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
          () => reject(new Error("Native benchmark app close timed out")),
          5000,
        );
        timer.unref();
      }),
    ]);
  } catch (error) {
    logs.push(`CLOSE: ${error.message}\n`);
    owned.process().kill("SIGKILL");
  } finally {
    clearTimeout(timer);
  }
}
async function launch(dataDirectory, { returning = false } = {}) {
  const started = performance.now();
  const executable = process.env.AGENT_EXCALIDRAW_EXECUTABLE;
  application = await _electron.launch({
    ...(executable ? { executablePath: path.resolve(executable) } : {}),
    args: executable ? [] : ["."],
    cwd: root,
    env: { ...environment, AGENT_EXCALIDRAW_DATA_DIR: dataDirectory },
    timeout: 60000,
  });
  application.process().stdout?.on("data", (chunk) => logs.push(String(chunk)));
  application.process().stderr?.on("data", (chunk) => logs.push(String(chunk)));
  page = await application.firstWindow();
  page.on("pageerror", (error) =>
    logs.push(`RENDERER: ${error.stack || error.message}\n`),
  );
  await page.waitForFunction(() => Boolean(window.agentExcalidraw));
  const button = page.getByRole("button", { name: "New drawing", exact: true });
  await button.waitFor({ state: "visible", timeout: 60000 });
  const deadline = Date.now() + 60000;
  while (!(await button.isEnabled())) {
    if (Date.now() > deadline)
      throw new Error("The real New drawing action never became enabled");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (returning)
    await page
      .getByRole("heading", { name: "Your drawings", exact: true })
      .waitFor();
  await paint();
  const elapsed = performance.now() - started;
  // Endpoint readiness is recorded after the usable-UI timer; CLI is separate.
  while (true) {
    try {
      await access(path.join(dataDirectory, "endpoint.json"));
      break;
    } catch {
      if (Date.now() > deadline)
        throw new Error("No local CLI endpoint appeared");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  environment.AGENT_EXCALIDRAW_DATA_DIR = dataDirectory;
  return elapsed;
}
async function measure(name, action, count = samples) {
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await action(i);
    values.push(performance.now() - start);
  }
  report.metrics[name] = summarize(values);
  await persist();
  console.log(
    `${name}: p95=${report.metrics[name].nearestRankP95Ms}ms (${count} samples)`,
  );
}
async function cli(command, payload) {
  const args = [path.join(root, "dist", "cli", "index.js"), command, "--json"];
  if (payload !== undefined) {
    const input = path.join(work, `input-${randomUUID()}.json`);
    await writeFile(input, JSON.stringify(payload), { mode: 0o600 });
    args.push("--input", input, "--no-launch");
  }
  return async () => {
    const response = await runProcess(process.execPath, args, {
      cwd: root,
      env: environment,
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return result(JSON.parse(response.stdout.trim()));
  };
}
async function open(file) {
  await invoke("open", { path: file });
  await paint();
}
async function memory(label, cycle = 0) {
  const processes = await application.evaluate(({ app }) =>
    app.getAppMetrics().map((process) => ({
      pid: process.pid,
      type: process.type,
      memory: process.memory,
      cpu: process.cpu.percentCPUUsage,
    })),
  );
  report.memory.push({
    label,
    cycle,
    time: new Date().toISOString(),
    aggregateWorkingSetBytes: processes.reduce(
      (total, process) => total + (process.memory?.workingSetSize || 0) * 1024,
      0,
    ),
    processes,
  });
}
async function createFixtures() {
  await invoke("settings", { defaultFolder: drawings, theme: "light" });
  const seedPath = path.join(drawings, "Fixture seed.excalidraw");
  await invoke("new", { title: "Fixture seed", path: seedPath });
  const inspected = await invoke("snapshot");
  await invoke(
    "apply",
    {
      operations: [
        {
          op: "create",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 144,
          height: 64,
          strokeColor: "#6965db",
          backgroundColor: "#eeedff",
          fillStyle: "solid",
        },
        {
          op: "create",
          type: "text",
          x: 0,
          y: 0,
          text: "A local benchmark idea",
          fontSize: 20,
        },
      ],
    },
    {
      document: inspected.document,
      epoch: inspected.epoch,
      expectedRevision: inspected.revision,
      requestId: randomUUID(),
    },
  );
  await invoke("save");
  const native = JSON.parse(await readFile(seedPath, "utf8"));
  const rectangle = native.elements.find(
    (element) => element.type === "rectangle",
  );
  const text = native.elements.find((element) => element.type === "text");
  if (!rectangle || !text)
    throw new Error(
      "The actual SDK did not produce valid fixture seed elements",
    );
  const images = await page.evaluate(() =>
    Array.from({ length: 12 }, (_, index) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No real canvas image generator");
      context.fillStyle = ["#6965db", "#efb36c", "#70b59c"][index % 3];
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = "#ffffff";
      context.font = "24px sans-serif";
      context.fillText(String(index + 1), 18, 42);
      return canvas.toDataURL("image/png");
    }),
  );
  async function make(name, count, imageCount) {
    const elements = [],
      files = {};
    for (let i = 0; i < count; i++) {
      const id = `${name}-${i}`,
        x = (i % (name === "small" ? 10 : 40)) * 180,
        y = Math.floor(i / (name === "small" ? 10 : 40)) * 100;
      let element;
      if (i >= count - imageCount) {
        const imageIndex = i - (count - imageCount),
          fileId = `${name}-image-${imageIndex}`;
        files[fileId] = {
          id: fileId,
          mimeType: "image/png",
          dataURL: images[imageIndex],
          created: 1,
          lastRetrieved: 1,
        };
        element = {
          ...rectangle,
          type: "image",
          id,
          x,
          y,
          width: 64,
          height: 64,
          fileId,
          scale: [1, 1],
          crop: null,
          status: "saved",
        };
      } else
        element =
          i % 4
            ? { ...rectangle, id, x, y }
            : {
                ...text,
                id,
                x,
                y,
                text: `Idea ${String(i).padStart(5, "0")}`,
                originalText: `Idea ${String(i).padStart(5, "0")}`,
                containerId: null,
              };
      delete element.index;
      element.boundElements = null;
      element.groupIds = [];
      element.frameId = null;
      element.seed = i + 1;
      element.versionNonce = i + 11;
      elements.push(element);
    }
    const fixture = { ...native, elements, files };
    const file = path.join(drawings, `${name}.excalidraw`),
      bytes = JSON.stringify(fixture);
    const imageBytes = Object.values(files).reduce(
      (sum, file) =>
        sum + Buffer.from(file.dataURL.split(",")[1], "base64").length,
      0,
    );
    if (Buffer.byteLength(bytes) > 8 * 1024 * 1024 || imageBytes > 1024 * 1024)
      throw new Error("Fixture exceeded declared byte bounds");
    await writeFile(file, bytes);
    report.fixtures[name] = {
      path: file,
      elements: count,
      images: imageCount,
      serializedBytes: Buffer.byteLength(bytes),
      imageBytes,
    };
    return file;
  }
  const small = await make("small", 250, 3),
    medium = await make("medium", 2000, 12);
  return { small, medium, native };
}

try {
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(drawings, { recursive: true });
  await access(path.join(root, "dist", "main", "index.js"));
  await access(path.join(root, "dist", "cli", "index.js"));
  report.runtime = {
    app: JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
      .version,
    executable:
      process.env.AGENT_EXCALIDRAW_EXECUTABLE ||
      "development Electron, built production resources",
  };
  try {
    report.runtime.gitSha = (
      await runProcess("git", ["rev-parse", "HEAD"], { cwd: root })
    ).stdout.trim();
  } catch {
    report.runtime.gitSha = "uncommitted";
  }
  const cold = [];
  for (let i = 0; i < samples; i++) {
    cold.push(await launch(path.join(work, `cold-${i}`)));
    if (i === 0) {
      report.runtime.electron = await application.evaluate(
        () => process.versions,
      );
      await page.screenshot({
        path: path.join(artifactRoot, "01-cold-usable.png"),
      });
    }
    await close();
  }
  report.metrics.coldUsable = summarize(cold);
  await persist();
  console.log(
    `coldUsable: p95=${report.metrics.coldUsable.nearestRankP95Ms}ms (${samples} fresh-data launches)`,
  );
  const benchmarkData = path.join(work, "session");
  await launch(benchmarkData);
  const fixtures = await createFixtures();
  await open(fixtures.small);
  await open(fixtures.medium);
  await open(fixtures.small);
  const observedSmall = await invoke("snapshot", { limit: 5000 });
  if (
    observedSmall.total !== 250 ||
    observedSmall.elements.filter((element) => element.type === "image")
      .length !== 3
  )
    throw new Error(
      "The real SDK did not admit the expected 250-element/3-image small fixture",
    );
  report.fixtures.small.sdkReadback = {
    elements: observedSmall.total,
    images: 3,
  };
  await measure("warmSmallOpen", () => open(fixtures.small));
  await measure("warmMediumOpen", () => open(fixtures.medium));
  const observedMedium = await invoke("snapshot", { limit: 5000 });
  if (
    observedMedium.total !== 2000 ||
    observedMedium.elements.filter((element) => element.type === "image")
      .length !== 12
  )
    throw new Error(
      "The real SDK did not admit the expected 2000-element/12-image medium fixture",
    );
  report.fixtures.medium.sdkReadback = {
    elements: observedMedium.total,
    images: 12,
  };
  await open(fixtures.small);
  await page.screenshot({
    path: path.join(artifactRoot, "02-small-fixture.png"),
  });
  await measure("smallRender", async (i) => {
    await invoke(
      "render",
      { format: "png", output: path.join(work, `small-render-${i}.png`) },
      await target(),
    );
  });
  const version = await cli("version");
  await measure("cliStartupVersion", version);
  const status = await cli("status", {});
  await measure("cliStatusRoundTrip", status);
  const context = await target();
  const snapshot = await cli("snapshot", {
    ...context,
    compact: true,
    limit: 250,
  });
  await measure("cliSmallSnapshotRoundTrip", snapshot);
  await memory("before-switches");
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await invoke("window-library");
    await open(cycle % 2 ? fixtures.medium : fixtures.small);
    if (cycle % 10 === 0 || cycle === cycles) {
      await paint();
      await memory("after-switches", cycle);
      await persist();
    }
  }
  report.memoryGrowth = {
    beforeBytes: report.memory[0].aggregateWorkingSetBytes,
    afterBytes: report.memory.at(-1).aggregateWorkingSetBytes,
    ratio: report.memory[0].aggregateWorkingSetBytes
      ? +(
          report.memory.at(-1).aggregateWorkingSetBytes /
          report.memory[0].aggregateWorkingSetBytes
        ).toFixed(3)
      : null,
    completedSwitches: cycles,
    fiftyCycleEvidence: cycles >= 50,
    interpretation:
      "Diagnostic only; compare trends and repeat against an accepted baseline. No leak-free claim from these samples.",
  };
  await close();

  const libraryRoot = path.join(work, "library-files"),
    libraryData = path.join(work, "library-data");
  await mkdir(libraryRoot);
  await mkdir(libraryData);
  const entries = Array.from({ length: 10000 }, (_, i) => ({
    id: `benchmark-${i}`,
    title: `Benchmark ${String(i).padStart(5, "0")}`,
    path: path.join(
      libraryRoot,
      `Benchmark ${String(i).padStart(5, "0")}.excalidraw`,
    ),
    lastOpened: Date.now() - i * 1000,
    starred: false,
  }));
  const scanFixture = JSON.stringify({
    ...fixtures.native,
    elements: fixtures.native.elements.slice(0, 1),
    files: {},
  });
  for (let batch = 0; batch < 500; batch += 25)
    await Promise.all(
      entries
        .slice(batch, batch + 25)
        .map((entry) => writeFile(entry.path, scanFixture)),
    );
  await writeFile(
    path.join(libraryData, "library.json"),
    JSON.stringify({
      version: 1,
      drawings: entries,
      settings: {
        defaultFolder: drawings,
        theme: "light",
        autosave: false,
        folders: [libraryRoot],
      },
    }),
  );
  report.fixtures.library = {
    metadataEntries: entries.length,
    actualFiles: 500,
    directory: libraryRoot,
    oneFileBytes: Buffer.byteLength(scanFixture),
    indexBytes: (await stat(path.join(libraryData, "library.json"))).size,
  };
  report.metrics.largeLibraryLaunch = summarize([
    await launch(libraryData, { returning: true }),
  ]);
  await page.screenshot({
    path: path.join(artifactRoot, "03-library-10000.png"),
  });
  const input = page.getByRole("textbox", {
    name: "Search drawings",
    exact: true,
  });
  const searchTimes = [];
  for (let i = 0; i < samples; i++) {
    await input.fill("");
    await paint();
    const query = `Benchmark ${String(77 + i).padStart(5, "0")}`,
      start = performance.now();
    await input.fill(query);
    await page
      .locator(".drawing-row .open-drawing")
      .filter({ hasText: query })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.querySelectorAll(".drawing-row").length === 1,
    );
    await paint();
    searchTimes.push(performance.now() - start);
  }
  report.metrics.indexedSearch = summarize(searchTimes);
  await page.screenshot({
    path: path.join(artifactRoot, "04-library-search.png"),
  });
  const shellTimes = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page
      .getByRole("heading", { name: /Your agent.*The same canvas/ })
      .waitFor();
    await paint();
    shellTimes.push(performance.now() - start);
    await page
      .getByRole("button", { name: "Back to your space", exact: true })
      .click();
    await input.waitFor({ state: "visible" });
  }
  report.metrics.shellAgentsNavigation = summarize(shellTimes);
  await measure(
    "explicitFolderScan500",
    () => invoke("folder-add", { path: libraryRoot }),
    quick ? 1 : 3,
  );
  await memory("large-library-after-search");
  report.finished = new Date().toISOString();
  await persist();
  console.log(
    `Library search:p95=${report.metrics.indexedSearch.nearestRankP95Ms}ms; shell navigation:p95=${report.metrics.shellAgentsNavigation.nearestRankP95Ms}ms`,
  );
  console.log(
    `Native diagnostic saved to ${path.join(artifactRoot, "metrics.json")}. No performance gate automatically marked passed.`,
  );
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  report.finished = new Date().toISOString();
  await mkdir(artifactRoot, { recursive: true });
  if (page)
    await page
      .screenshot({ path: path.join(artifactRoot, "failure.png") })
      .catch(() => {});
  await persist();
  console.error(error);
  process.exitCode = 1;
} finally {
  await close();
}
