import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import {
  parseBinding,
  parseHead,
  readFrame,
  unwrap,
  record,
  CHUNK_BYTES,
  MAX_BYTES,
  type Binding,
  type Capture,
  type ReadRequest,
} from "../src/embedded/protocol";
import {
  ViewerSession,
  type ViewerSink,
  type ViewerSnapshot,
} from "../src/embedded/session";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=",
  "base64",
);
const binding: Binding = {
  protocol: 1,
  viewId: "synthetic-view",
  document: "synthetic-document",
  epoch: "synthetic-epoch",
  title: "Synthetic drawing",
  expiresAt: Date.now() + 60_000,
};
const state = {
  document: binding.document,
  epoch: binding.epoch,
  revision: 1,
  dirty: true,
  saving: false,
  title: binding.title,
  observedAt: Date.now(),
};
function capture(bytes = png): Capture {
  return {
    id: "synthetic-capture",
    mime: "image/png",
    byteLength: bytes.length,
    width: 1,
    height: 1,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    revision: 1,
    expiresAt: Date.now() + 60_000,
  };
}
function reply(result: unknown) {
  return { structuredContent: { ok: true, result } };
}
function chunk(request: ReadRequest, bytes = png, c = capture(bytes)) {
  assert.equal(request.mode, "chunk");
  if (request.mode !== "chunk") throw Error("Expected chunk");
  return reply({
    captureId: c.id,
    offset: request.offset,
    byteCount: request.byteCount,
    totalBytes: bytes.length,
    data: bytes
      .subarray(request.offset, request.offset + request.byteCount)
      .toString("base64"),
    sha256: c.sha256,
    done: request.offset + request.byteCount === bytes.length,
  });
}
function head(kind = "frame", extra: Record<string, unknown> = {}) {
  return reply({
    kind,
    state,
    stateToken: "token-1",
    ...(kind === "frame" ? { capture: capture() } : {}),
    ...extra,
  });
}
function sink() {
  const snapshots: ViewerSnapshot[] = [];
  const counters = { prepared: 0, committed: 0, discarded: 0, cleared: 0 };
  const output: ViewerSink = {
    update: (s) => snapshots.push(s),
    clear: () => {
      counters.cleared++;
    },
    prepare: async () => {
      counters.prepared++;
      return {
        commit: () => {
          counters.committed++;
        },
        discard: () => {
          counters.discarded++;
        },
      };
    },
  };
  return { output, snapshots, counters, latest: () => snapshots.at(-1)! };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 1500;
  while (!check()) {
    if (Date.now() > deadline) throw Error("Timed out waiting for viewer");
    await new Promise((r) => setTimeout(r, 2));
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("embedded protocol refuses wrong identity, oversize images and model-text fallback", async () => {
  assert.deepEqual(parseBinding(binding), binding);
  assert.equal(
    parseBinding({ ...binding, expiresAt: new Date().toISOString() }).protocol,
    1,
  );
  assert.throws(() =>
    unwrap({ content: [{ type: "text", text: JSON.stringify(head()) }] }),
  );
  assert.throws(
    () =>
      parseHead(
        {
          kind: "frame",
          state: { ...state, epoch: "another" },
          stateToken: "x",
          capture: capture(),
        },
        binding,
      ),
    /different drawing/,
  );
  assert.throws(
    () =>
      parseHead(
        {
          kind: "frame",
          state,
          stateToken: "x",
          capture: { ...capture(), byteLength: MAX_BYTES + 1 },
        },
        binding,
      ),
    /too large/,
  );
  assert.throws(
    () =>
      parseHead(
        {
          kind: "frame",
          state,
          stateToken: "x",
          capture: { ...capture(), width: 3000, height: 3000 },
        },
        binding,
      ),
    /too large/,
  );
  assert.throws(
    () =>
      unwrap({
        structuredContent: {
          ok: false,
          error: { code: "PRIVATE", message: "/private/native/path" },
        },
      }),
    (e: Error) => !e.message.includes("/private"),
  );
});

test("embedded transfer assembles bounded immutable chunks and checks PNG/header/hash", async () => {
  const bytes = Buffer.concat([png, Buffer.alloc(CHUNK_BYTES + 123, 7)]),
    c = capture(bytes);
  const offsets: number[] = [];
  const actual = await readFrame(
    async (request) => {
      assert.equal(request.mode, "chunk");
      if (request.mode === "chunk") {
        offsets.push(request.offset);
        assert.ok(request.byteCount <= CHUNK_BYTES);
      }
      return chunk(request, bytes, c);
    },
    binding,
    c,
    () => true,
  );
  assert.deepEqual(Buffer.from(actual), bytes);
  assert.deepEqual(offsets, [0, CHUNK_BYTES]);
  const invalid = [
    { captureId: "different" },
    { offset: 1 },
    { totalBytes: png.length + 1 },
    { byteCount: 0 },
    { done: false },
    { data: "x".repeat(4 * Math.ceil(png.length / 3)) },
    { sha256: "0".repeat(64) },
  ];
  for (const patch of invalid)
    await assert.rejects(
      readFrame(
        async (r) => {
          const valid = chunk(r);
          return reply({ ...record(valid.structuredContent.result), ...patch });
        },
        binding,
        capture(),
        () => true,
      ),
    );
  const wrongSignature = Buffer.from(png);
  wrongSignature[0] = 0;
  await assert.rejects(
    readFrame(
      async (r) => chunk(r, wrongSignature),
      binding,
      capture(wrongSignature),
      () => true,
    ),
  );
  await assert.rejects(
    readFrame(
      async (r) => chunk(r),
      binding,
      { ...capture(), width: 2 },
      () => true,
    ),
  );
  await assert.rejects(
    readFrame(
      async (r) => chunk(r),
      binding,
      { ...capture(), sha256: "0".repeat(64) },
      () => true,
    ),
  );
  const badHash = { ...capture(), sha256: "0".repeat(64) };
  await assert.rejects(
    readFrame(
      async (r) => chunk(r, png, badHash),
      binding,
      badHash,
      () => true,
    ),
  );
});

test("status-only save changes retain pixels; failed frame never commits a token", async () => {
  const ui = sink(),
    requests: ReadRequest[] = [];
  let mode = "fail";
  const session = new ViewerSession(
    async (r) => {
      requests.push(r);
      if (r.mode === "chunk") {
        if (mode === "fail") throw Error("interrupted");
        return chunk(r);
      }
      if (mode === "saved")
        return head("status", {
          state: { ...state, dirty: false },
          stateToken: "saved-token",
        });
      return head();
    },
    ui.output,
    60_000,
  );
  try {
    session.bind(binding);
    await until(() => ui.latest().phase === "stale");
    assert.equal(ui.counters.committed, 0);
    mode = "frame";
    session.refresh();
    await until(() => ui.latest().phase === "live");
    assert.equal(
      requests.filter((r) => r.mode === "head")[1].afterStateToken,
      undefined,
    );
    mode = "saved";
    session.refresh();
    await until(() => ui.latest().state?.dirty === false);
    assert.equal(ui.counters.committed, 1);
    assert.equal(ui.latest().phase, "live");
    assert.equal(
      requests.filter((r) => r.mode === "head").at(-1)?.afterStateToken,
      "token-1",
    );
  } finally {
    session.stop();
  }
});

test("rapid refresh, pause, visibility and rebinding never overlap or admit late pixels", async () => {
  const gate = deferred<unknown>(),
    ui = sink();
  let active = 0,
    maximum = 0,
    calls = 0;
  const session = new ViewerSession(
    async (r) => {
      active++;
      maximum = Math.max(active, maximum);
      calls++;
      try {
        if (calls === 1) return await gate.promise;
        return r.mode === "head"
          ? head("frame", { state: { ...state, document: "new-document" } })
          : chunk(r);
      } finally {
        active--;
      }
    },
    ui.output,
    60_000,
  );
  try {
    session.bind(binding);
    session.refresh();
    session.refresh();
    session.togglePause();
    session.togglePause();
    session.setActive(false);
    session.setActive(true);
    session.bind({ ...binding, viewId: "new-view", document: "new-document" });
    assert.equal(calls, 1);
    gate.resolve(head());
    await until(() => ui.counters.committed === 1);
    assert.equal(maximum, 1);
    assert.equal(ui.latest().binding?.viewId, "new-view");
    assert.equal(ui.counters.committed, 1);
    session.togglePause();
    assert.equal(ui.latest().phase, "paused");
    assert.equal(ui.latest().hasFrame, true);
  } finally {
    session.stop();
  }
});

test("teardown during decode discards candidate, expired sessions keep clearly stale pixels", async () => {
  const ui = sink(),
    gate = deferred<{ commit(): void; discard(): void }>(),
    decoding = deferred<boolean>();
  ui.output.prepare = async () => {
    decoding.resolve(true);
    return gate.promise;
  };
  const session = new ViewerSession(
    async (r) => (r.mode === "head" ? head() : chunk(r)),
    ui.output,
    60_000,
  );
  session.bind(binding);
  await decoding.promise;
  session.stop();
  gate.resolve({
    commit: () => {
      ui.counters.committed++;
    },
    discard: () => {
      ui.counters.discarded++;
    },
  });
  await until(() => ui.counters.discarded === 1);
  assert.equal(ui.counters.committed, 0);
  const next = sink();
  let expired = false,
    calls = 0;
  const s = new ViewerSession(
    async (r) => {
      calls++;
      return expired
        ? {
            structuredContent: {
              ok: false,
              error: { code: "PRESENTATION_EXPIRED", message: "expired" },
            },
          }
        : r.mode === "head"
          ? head()
          : chunk(r);
    },
    next.output,
    60_000,
  );
  try {
    s.bind(binding);
    await until(() => next.latest().phase === "live");
    expired = true;
    s.refresh();
    await until(() => next.latest().phase === "stale");
    assert.equal(next.latest().hasFrame, true);
    const count = calls;
    s.bind(binding);
    s.refresh();
    assert.equal(calls, count);
  } finally {
    s.stop();
  }
});

test("empty and busy replies do not invent or replace pixels", async () => {
  const ui = sink();
  let kind = "empty";
  const session = new ViewerSession(async () => head(kind), ui.output, 60_000);
  try {
    session.bind(binding);
    await until(() => ui.latest().phase === "empty");
    kind = "unchanged";
    session.refresh();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ui.latest().phase, "empty");
    kind = "busy";
    session.refresh();
    await until(() => ui.latest().phase === "busy");
    assert.equal(ui.counters.committed, 0);
  } finally {
    session.stop();
  }
});

// Opt in after parent integration: this uses the real SDK App + AppBridge over
// postMessage and a browser image decoder. Only canvas_read is synthetic; no
// editor/native fidelity is claimed. No server, build outputs or config edits.
test(
  "browser: SDK initialization theme, chunks, save, pan/zoom, pause, stale and teardown",
  { skip: process.env.EMBEDDED_BROWSER_TESTS !== "1", timeout: 60_000 },
  async () => {
    const { build } = await import("esbuild");
    const { _electron, expect } = await import("@playwright/test");
    const cwd = resolve(import.meta.dirname, "..");
    const appBundle = await build({
      entryPoints: [resolve(cwd, "src/embedded/main.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
    });
    const css = await readFile(resolve(cwd, "src/embedded/style.css"), "utf8");
    const source = `<!doctype html><html><head><style>${css}</style></head><body><main id="app"></main><script type="module">${appBundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
    const host = await build({
      stdin: {
        resolveDir: cwd,
        contents: `
    import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
    const frame = document.querySelector('iframe');
    const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=160;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff';ctx.fillRect(0,0,320,160);ctx.fillStyle='#574bcc';ctx.fillRect(20,20,120,80);
    const noise=ctx.createImageData(320,90);let seed=19;for(let i=0;i<noise.data.length;i+=4){for(let k=0;k<3;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise.data[i+k]=seed>>>24;}noise.data[i+3]=255;}ctx.putImageData(noise,0,70);
    const data=canvas.toDataURL('image/png').split(',')[1], bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    const binding=${JSON.stringify(binding)};
    const state=${JSON.stringify(state)};
    const capture={id:'browser-capture',mime:'image/png',byteLength:bytes.length,width:320,height:160,sha256:hash,revision:1,expiresAt:Date.now()+60000};
    let mode='frame', calls=[], active=0, maxActive=0;
    const bridge=new AppBridge(null,{name:'Synthetic SDK test host',version:'1'},{serverTools:{}},{hostContext:{theme:'dark',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}});
    window.harness={bridge,calls,setMode:m=>mode=m,get maxActive(){return maxActive;}};
    bridge.oncalltool=async request=>{active++;maxActive=Math.max(maxActive,active);try{
      if(request.name!=='canvas_read')throw Error('Unexpected tool');
      const r=request.arguments;calls.push(r);await new Promise(r=>setTimeout(r,20));
      if(mode==='expired')return {content:[],structuredContent:{ok:false,error:{code:'PRESENTATION_EXPIRED',message:'expired'}}};
      const part=r.mode==='chunk'?btoa(String.fromCharCode(...bytes.subarray(r.offset,r.offset+r.byteCount))):'';
      const result=r.mode==='head'?{kind:mode==='saved'?'status':mode==='empty'?'empty':'frame',state:{...state,dirty:mode!=='saved'},stateToken:mode,capture}: {captureId:capture.id,offset:r.offset,byteCount:r.byteCount,totalBytes:bytes.length,data:mode==='corrupt'?'!'.repeat(part.length):part,sha256:hash,done:r.offset+r.byteCount===bytes.length};
      return {content:[],structuredContent:{ok:true,result}};
    }finally{active--;}};
    bridge.oninitialized=async()=>{await bridge.sendToolInput({arguments:{document:binding.document,epoch:binding.epoch}});await bridge.sendToolResult({content:[],_meta:{canvasBinding:binding}});};
    await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
    frame.srcdoc=${JSON.stringify(source)};
  `,
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
    });
    const temporary = await mkdtemp(join(tmpdir(), "ae-view-host-"));
    const environment: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.NODE_OPTIONS;
    const browser = await _electron.launch({
      args: [resolve(cwd, "tests/fixtures/embedded-host.cjs"), temporary],
      env: environment,
    });
    const page = await browser.firstWindow();
    await page.setViewportSize({ width: 760, height: 740 });
    const hostFile = join(temporary, "host.html");
    await writeFile(
      hostFile,
      `<iframe title="Drawing preview" sandbox="allow-scripts allow-forms" style="width:100%;height:650px;border:0"></iframe><script type="module">${host.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`,
    );
    const hostUrl = pathToFileURL(hostFile).href;
    const screenshots = resolve(cwd, "artifacts/embedded-ui");
    await mkdir(screenshots, { recursive: true });
    const external: string[] = [];
    await page.route("**/*", async (route) => {
      if (route.request().url() === hostUrl) await route.continue();
      else {
        external.push(route.request().url());
        await route.abort();
      }
    });
    try {
      await page.goto(hostUrl);
      const frame = page.frameLocator("iframe");
      await expect(frame.locator(".viewer-status")).toHaveText(
        "Live · Unsaved",
      );
      await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(frame.locator("body")).toHaveCSS(
        "color",
        "rgb(240, 239, 244)",
      );
      await expect(frame.locator("img")).toHaveCount(1);
      assert.ok(
        await page.evaluate(
          "harness.calls.filter(r=>r.mode==='chunk').length>=2",
        ),
      );
      await page.screenshot({ path: join(screenshots, "dark-unsaved.png") });
      const initial = await frame.locator("img").getAttribute("src");
      await page.evaluate("harness.setMode('saved')");
      await frame
        .getByRole("button", { name: "Refresh preview", exact: true })
        .click();
      await expect(frame.locator(".viewer-status")).toHaveText("Live · Saved");
      assert.equal(await frame.locator("img").getAttribute("src"), initial);
      await page.screenshot({ path: join(screenshots, "dark-saved.png") });
      await frame
        .getByRole("button", { name: "Zoom in (+)", exact: true })
        .click();
      const zoomed = await frame.locator("output").textContent();
      await frame.getByRole("region", { name: /^Drawing canvas/ }).focus();
      await page.keyboard.press("f");
      assert.notEqual(await frame.locator("output").textContent(), zoomed);
      const fitted = await frame.locator("img").getAttribute("style");
      await page.keyboard.press("ArrowRight");
      assert.notEqual(await frame.locator("img").getAttribute("style"), fitted);
      await expect(
        frame.getByRole("region", { name: /^Drawing canvas/ }),
      ).toBeFocused();
      await frame
        .getByRole("button", { name: "Pause updates", exact: true })
        .click();
      await expect(frame.locator(".viewer-status")).toHaveText("Paused");
      await expect(frame.locator(".viewer-stale")).toBeVisible();
      await page.screenshot({ path: join(screenshots, "paused.png") });
      await page.evaluate("harness.setMode('corrupt')");
      await frame
        .getByRole("button", { name: "Resume updates", exact: true })
        .click();
      await expect(frame.locator(".viewer-status")).toContainText("Stale");
      assert.equal(await frame.locator("img").getAttribute("src"), initial);
      await page.evaluate(
        "harness.setMode('frame');harness.bridge.setHostContext({theme:'light',displayMode:'inline',availableDisplayModes:['inline']})",
      );
      await expect(frame.locator("html")).toHaveAttribute(
        "data-theme",
        "light",
      );
      await page.screenshot({ path: join(screenshots, "light.png") });
      await page.setViewportSize({ width: 320, height: 740 });
      assert.ok(
        await frame
          .locator("body")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      await page.screenshot({ path: join(screenshots, "narrow.png") });
      await page.evaluate("harness.setMode('expired')");
      await frame
        .getByRole("button", { name: "Refresh preview", exact: true })
        .click();
      await expect(frame.locator(".viewer-notice")).toContainText(
        "no longer available",
      );
      assert.equal(await page.evaluate("harness.maxActive"), 1);
      assert.deepEqual(external, []);
      await page.evaluate("harness.bridge.teardownResource({})");
      await expect(frame.locator("img")).toHaveCount(0);
    } finally {
      await browser.close();
    }
  },
);

test("explicit refresh works while paused without resuming automatic updates", async () => {
  const ui = sink();
  let calls = 0;
  const session = new ViewerSession(
    async (r) => {
      calls++;
      return r.mode === "head" ? head() : chunk(r);
    },
    ui.output,
    60_000,
  );
  try {
    session.bind(binding);
    await until(() => ui.latest().phase === "live");
    session.togglePause();
    const before = calls;
    session.refresh(true);
    await until(() => calls > before && ui.counters.committed === 2);
    assert.equal(ui.latest().phase, "paused");
    assert.equal(ui.latest().paused, true);
    assert.match(ui.latest().message, /Refreshed once/);
  } finally {
    session.stop();
  }
});
