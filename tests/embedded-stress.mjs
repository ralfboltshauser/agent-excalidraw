/** Isolated renderer-backed qualification. Run: node tests/embedded-stress.mjs
 * Optional: AE_STRESS_SECONDS=60 (smoke only), AE_STRESS_EXECUTABLE=/path/to/executable.
 * Evidence and private endpoint remain in a mode-0700 /tmp/ae-stress-* directory.
 * Does not build, change configuration, install integrations or touch other apps.
 */
import { _electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  chmod,
  access,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const exec = promisify(execFile),
  repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (b) => createHash("sha256").update(b).digest("hex");
const seconds = Number(process.env.AE_STRESS_SECONDS || 1800);
assert(Number.isFinite(seconds) && seconds > 0);
const root = await mkdtemp("/tmp/ae-stress-");
await chmod(root, 0o700);
const data = path.join(root, "data"),
  drawings = path.join(root, "drawings");
await Promise.all([mkdir(data), mkdir(drawings)]);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) =>
      v !== undefined && !["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(k),
  ),
);
Object.assign(env, {
  AGENT_EXCALIDRAW_DATA_DIR: data,
  AGENT_EXCALIDRAW_BIN_DIR: path.join(root, "bin"),
  AGENTS_HOME: path.join(root, "agents"),
  CODEX_HOME: path.join(root, "codex"),
  CLAUDE_CONFIG_DIR: path.join(root, "claude"),
});
const result = {
  root,
  requestedSeconds: seconds,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  startedAt: new Date().toISOString(),
  failures: [],
  samples: [],
  kinds: {},
  timings: {},
  counts: {
    requests: 0,
    frames: 0,
    chunks: 0,
    edits: 0,
    saves: 0,
    preservationChecks: 0,
    visibilityCycles: 0,
  },
  limitations: [],
};
const times = {},
  failures = result.failures;
let app,
  endpoint,
  page,
  identity,
  bindings = [],
  lastFrames = [],
  stressStart;
const limit = async (p, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      p,
      new Promise(
        (_, rej) =>
          (timer = setTimeout(
            () => rej(Error(`${label} timeout ${ms}ms`)),
            ms,
          )),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
async function call(command, rest = {}) {
  const start = performance.now();
  let reply;
  try {
    reply = await new Promise((resolve, reject) => {
      const c = createConnection(endpoint.socket);
      let text = "";
      const timer = setTimeout(
        () => c.destroy(Error("socket deadline 10000ms")),
        10000,
      );
      c.setEncoding("utf8");
      c.on("error", reject);
      c.on("close", () => clearTimeout(timer));
      c.on("connect", () =>
        c.write(
          JSON.stringify({ token: endpoint.token, command, ...rest }) + "\n",
        ),
      );
      c.on("data", (b) => {
        text += b;
        if (text.length > 12 * 1024 * 1024)
          c.destroy(Error("response size limit"));
        if (text.includes("\n")) {
          c.end();
          try {
            resolve(JSON.parse(text.slice(0, text.indexOf("\n"))));
          } catch {
            reject(Error("invalid JSON"));
          }
        }
      });
      c.on("end", () => {
        if (!text.includes("\n")) reject(Error("truncated reply"));
      });
    });
    if (!reply.ok)
      throw Error(`${command}: ${reply.error?.code}: ${reply.error?.message}`);
    return reply.result;
  } finally {
    const label =
      command === "presentation-read" ? `read-${rest.args.mode}` : command;
    (times[label] ??= []).push(performance.now() - start);
    result.counts.requests++;
  }
}
async function artifacts(dir) {
  const files = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (["endpoint.json", "control.sock", "logs"].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(files, await artifacts(f));
    else if (/\.(json|png|svg|excalidraw)$/.test(e.name))
      files[path.relative(root, f)] = hash(await readFile(f));
  }
  return files;
}
async function frame(b, h) {
  assert(h.capture);
  const c = h.capture;
  assert(
    c.width <= 1600 &&
      c.height <= 1600 &&
      c.width * c.height <= 4000000 &&
      c.byteLength <= 4194304,
  );
  assert.equal(c.revision, h.state.revision);
  const chunks = [];
  for (let offset = 0; offset < c.byteLength; offset += 65536) {
    const count = Math.min(65536, c.byteLength - offset);
    const x = await call("presentation-read", {
      args: {
        scope: b.scope,
        viewId: b.viewId,
        mode: "chunk",
        captureId: c.id,
        offset,
        byteCount: count,
      },
    });
    assert.equal(x.captureId, c.id);
    assert.equal(x.offset, offset);
    assert.equal(x.byteCount, count);
    assert.equal(x.totalBytes, c.byteLength);
    assert.equal(x.sha256, c.sha256);
    assert.equal(x.done, offset + count === c.byteLength);
    const bytes = Buffer.from(x.data, "base64");
    assert.equal(bytes.length, count);
    chunks.push(bytes);
    result.counts.chunks++;
  }
  const png = Buffer.concat(chunks);
  assert.equal(png.length, c.byteLength);
  assert.equal(hash(png), c.sha256);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), c.width);
  assert.equal(png.readUInt32BE(20), c.height);
  result.counts.frames++;
  lastFrames[b.index] = {
    revision: c.revision,
    sha256: c.sha256,
    width: c.width,
    height: c.height,
    byteLength: c.byteLength,
  };
  if (b.index === 0) await writeFile(path.join(root, "latest-frame.png"), png);
}
async function heads(force = false) {
  const responses = await Promise.all(
    bindings.map(async (b) => {
      const t = performance.now();
      const h = await call("presentation-read", {
        args: {
          scope: b.scope,
          viewId: b.viewId,
          mode: "head",
          ...(!force && b.token ? { afterStateToken: b.token } : {}),
        },
      });
      (times[h.kind] ??= []).push(performance.now() - t);
      assert.equal(h.state.document, identity.document);
      assert.equal(h.state.epoch, identity.epoch);
      assert(h.state.revision >= b.revision);
      b.revision = h.state.revision;
      result.kinds[h.kind] = (result.kinds[h.kind] || 0) + 1;
      if (h.kind === "frame") await frame(b, h);
      else
        assert(
          ["unchanged", "status"].includes(h.kind),
          `unexpected ${h.kind}`,
        );
      if (h.kind === "unchanged") assert.equal(h.stateToken, b.token);
      b.token = h.stateToken;
      return h;
    }),
  );
  assert.equal(new Set(responses.map((h) => h.state.revision)).size, 1);
  return responses;
}
async function preservation() {
  const before = await call("snapshot", identity),
    s = await call("status"),
    disk = await readFile(result.drawing),
    a = await artifacts(data);
  const hs = await heads();
  assert(hs.every((h) => h.kind === "unchanged"));
  assert.deepEqual((await call("status")).agent, s.agent);
  const after = await call("snapshot", identity);
  for (const k of ["elements", "selection", "revision"])
    assert.deepEqual(after[k], before[k]);
  assert.equal(hash(await readFile(result.drawing)), hash(disk));
  assert.deepEqual(await artifacts(data), a);
  result.counts.preservationChecks++;
}
async function memory() {
  const metrics = await limit(
    app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((m) => ({
          pid: m.pid,
          type: m.type,
          memory: m.memory,
          cpu: m.cpu.percentCPUUsage,
        })),
    ),
    10000,
    "metrics",
  );
  const pids = metrics.map((m) => m.pid);
  const { stdout } = await exec(
    "ps",
    ["-o", "pid=,rss=", "-p", pids.join(",")],
    { timeout: 10000 },
  );
  const rss = stdout
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  result.samples.push({
    elapsedSeconds: (performance.now() - stressStart) / 1000,
    rssKiB: rss.reduce((n, x) => n + x[1], 0),
    processes: metrics,
  });
}
try {
  const packageApp =
    "/tmp/ae-embedded-release-arm/mac-arm64/Agent Excalidraw.app";
  let executable = process.env.AE_STRESS_EXECUTABLE;
  if (!executable) {
    try {
      await access(packageApp);
      await exec("codesign", ["--verify", "--deep", "--strict", packageApp], {
        timeout: 20000,
      });
      executable = path.join(packageApp, "Contents/MacOS/Agent Excalidraw");
      result.signature = "codesign --verify --deep --strict passed";
    } catch {
      result.limitations.push(
        "Preferred package missing or failed strict code-sign verification at selection; source build used.",
      );
    }
  }
  let args;
  if (executable) {
    args = [];
    result.build = {
      kind: "packaged",
      executable,
      asarSha256: hash(
        await readFile(
          path.join(path.dirname(executable), "../Resources/app.asar"),
        ),
      ),
    };
  } else {
    const entry = path.join(repo, "dist/main/index.js");
    result.build = {
      kind: "source-dist",
      entry,
      sha256: hash(await readFile(entry)),
    };
    // Test-only bootstrap makes every native show inactive before loading app code.
    const bootstrap = path.join(root, "bootstrap.cjs");
    await writeFile(
      bootstrap,
      `const {app,BrowserWindow}=require('electron');app.setName('Embedded isolated stress');if(process.platform==='darwin')app.setActivationPolicy('accessory');BrowserWindow.prototype.show=BrowserWindow.prototype.showInactive;BrowserWindow.prototype.focus=function(){};import(${JSON.stringify(pathToFileURL(entry).href)});`,
    );
    args = [bootstrap];
  }
  app = await _electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args,
    cwd: repo,
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.agentExcalidraw), {
    timeout: 30000,
  });
  await app.evaluate(({ BrowserWindow, app }) => {
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    for (const w of BrowserWindow.getAllWindows()) {
      w.setFocusable(false);
      w.hide();
    }
  });
  for (let i = 0; i < 100; i++) {
    try {
      endpoint = JSON.parse(
        await readFile(path.join(data, "endpoint.json"), "utf8"),
      );
      break;
    } catch {
      await sleep(100);
    }
  }
  assert(endpoint);
  page.on("pageerror", () =>
    failures.push({
      kind: "renderer-pageerror",
      elapsedSeconds: stressStart
        ? (performance.now() - stressStart) / 1000
        : 0,
    }),
  );
  await call("settings", { args: { defaultFolder: drawings, theme: "light" } });
  result.drawing = path.join(drawings, "embedded-stress-synthetic.excalidraw");
  await call("new", {
    args: {
      title: "Synthetic multi-view 250-shape Unicode stress",
      path: result.drawing,
    },
  });
  let snap = await call("snapshot");
  identity = { document: snap.document, epoch: snap.epoch };
  result.identity = identity;
  const operations = Array.from({ length: 250 }, (_, i) => ({
    op: "create",
    ref: `shape-${i}`,
    type: "rectangle",
    x: (i % 25) * 180,
    y: Math.floor(i / 25) * 110,
    width: 155,
    height: 80,
    backgroundColor: i % 2 ? "#dbe4ff" : "#d3f9d8",
    fillStyle: "solid",
    ...(i % 25 === 0 ? { label: `Synthetic ${i} — Zürich 日本語` } : {}),
  }));
  const created = await call("apply", {
    ...identity,
    expectedRevision: snap.revision,
    requestId: randomUUID(),
    session: "isolated-embedded-stress",
    args: { operations },
  });
  const marker = created.created.find((e) => e.ref === "shape-0").id;
  await call("save", identity);
  const scope = randomUUID();
  for (let i = 0; i < 6; i++) {
    const b = await call("presentation-open", { ...identity, args: { scope } });
    assert.equal(b.document, identity.document);
    assert.equal(b.epoch, identity.epoch);
    bindings.push({ ...b, scope, index: i, revision: 0 });
  }
  result.fixture = {
    shapes: 250,
    bindings: 6,
    pollSeconds: 2,
    editSeconds: 15,
    preservationSeconds: 30,
    memorySeconds: 10,
    visibilitySeconds: 30,
    content:
      "Synthetic rectangles and Unicode labels; no imported images or private data",
  };
  stressStart = performance.now();
  result.stressStartedAt = new Date().toISOString();
  await heads();
  await preservation();
  await memory();
  let nextEdit = 15000,
    nextPreserve = 30000,
    nextMemory = 10000,
    nextVisibility = 30000,
    nextLog = 60000,
    cycle = 0;
  while (performance.now() - stressStart < seconds * 1000) {
    const cycleStart = performance.now(),
      elapsed = cycleStart - stressStart;
    if (elapsed >= nextEdit) {
      snap = await call("snapshot", identity);
      await call("apply", {
        ...identity,
        expectedRevision: snap.revision,
        requestId: randomUUID(),
        session: "isolated-embedded-stress",
        args: {
          operations: [
            {
              op: "update",
              id: marker,
              x: cycle % 2 ? 10 : 30,
              backgroundColor: cycle % 2 ? "#ffd8a8" : "#d3f9d8",
            },
          ],
        },
      });
      result.counts.edits++;
      const changed = await heads();
      assert(changed.every((h) => h.state.dirty));
      const ids = changed.map((h) => h.capture?.id);
      await call("save", identity);
      result.counts.saves++;
      const saved = await heads();
      assert(saved.every((h) => h.kind === "status" && !h.state.dirty));
      saved.forEach((h, i) => {
        if (h.capture) assert.equal(h.capture.id, ids[i]);
      });
      cycle++;
      nextEdit = elapsed + 15000;
    } else await heads();
    if (elapsed >= nextPreserve) {
      await preservation();
      nextPreserve = elapsed + 30000;
    }
    if (elapsed >= nextMemory) {
      await memory();
      nextMemory = elapsed + 10000;
    }
    if (elapsed >= nextVisibility) {
      const visible = result.counts.visibilityCycles % 2 === 0;
      await app.evaluate(({ BrowserWindow }, show) => {
        for (const w of BrowserWindow.getAllWindows()) {
          w.setFocusable(false);
          if (show) w.showInactive();
          else w.hide();
        }
      }, visible);
      result.counts.visibilityCycles++;
      nextVisibility = elapsed + 30000;
    }
    if (elapsed >= nextLog) {
      console.log(
        JSON.stringify({
          elapsedSeconds: Math.round(elapsed / 1000),
          requests: result.counts.requests,
          frames: result.counts.frames,
          rssMiB: Math.round(result.samples.at(-1).rssKiB / 1024),
        }),
      );
      await writeFile(
        path.join(root, "progress.json"),
        JSON.stringify(result, null, 2),
      );
      nextLog = elapsed + 60000;
    }
    await sleep(
      Math.max(
        0,
        Math.min(
          2000 - (performance.now() - cycleStart),
          seconds * 1000 - (performance.now() - stressStart),
        ),
      ),
    );
  }
  result.durationSeconds = (performance.now() - stressStart) / 1000;
  await preservation();
  await memory();
  const final = await call("snapshot", identity);
  result.finalRevision = final.revision;
  result.finalElements = final.elements.filter((e) => !e.isDeleted).length;
  result.sourceSha256 = hash(await readFile(result.drawing));
  result.finalFrames = lastFrames;
  await page.screenshot({ path: path.join(root, "editor-final.png") });
  result.build.endSha256 = hash(
    await readFile(
      result.build.kind === "packaged"
        ? path.join(
            path.dirname(result.build.executable),
            "../Resources/app.asar",
          )
        : result.build.entry,
    ),
  );
  assert.equal(
    result.build.endSha256,
    result.build.asarSha256 || result.build.sha256,
  );
} catch (e) {
  failures.push({
    kind: "harness-or-assertion",
    message: String(e.message).replaceAll(
      endpoint?.token || "__NO_TOKEN__",
      "[redacted]",
    ),
    elapsedSeconds: stressStart ? (performance.now() - stressStart) / 1000 : 0,
  });
  if (stressStart)
    result.durationSeconds = (performance.now() - stressStart) / 1000;
} finally {
  if (app) {
    try {
      await limit(app.close(), 10000, "owned app close");
      result.cleanClose = true;
    } catch {
      result.cleanClose = false;
      failures.push({ kind: "owned-app-close-timeout" });
      const child = app.process();
      if (child.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
    }
  }
  for (const [label, values] of Object.entries(times)) {
    const v = [...values].sort((a, b) => a - b);
    result.timings[label] = {
      count: v.length,
      p50Ms: v[Math.floor((v.length - 1) * 0.5)],
      p95Ms: v[Math.floor((v.length - 1) * 0.95)],
      maxMs: v.at(-1),
    };
  }
  result.finishedAt = new Date().toISOString();
  result.passed = failures.length === 0 && result.durationSeconds >= seconds;
  await writeFile(
    path.join(root, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      root,
      passed: result.passed,
      durationSeconds: result.durationSeconds,
      failures: result.failures,
      counts: result.counts,
      timings: result.timings,
    }),
  );
  if (!result.passed) process.exitCode = 1;
}
