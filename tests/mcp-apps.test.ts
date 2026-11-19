import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createCanvasMcp, CANVAS_RESOURCE } from "../src/cli/mcp-apps.js";
const capabilities = {
  extensions: {
    "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
  },
};
test("non-Apps clients get a useful fallback without contacting or starting the desktop", async () => {
  let calls = 0;
  const apps = createCanvasMcp({
    capabilities: () => ({}),
    request: async () => {
      calls++;
      throw Error("must not launch");
    },
  });
  assert.deepEqual(
    apps.tools().map((x) => x.name),
    ["show_canvas"],
  );
  assert.deepEqual(apps.resources(), []);
  const r = await apps.call("show_canvas", { document: "d", epoch: "e" });
  assert.equal(r.isError, false);
  assert.equal(calls, 0);
  assert.match(JSON.stringify(r), /CLI/);
  const hidden = await apps.call("canvas_read", {
    mode: "head",
    viewId: randomUUID(),
  });
  assert.equal(hidden.isError, true);
  assert.equal(calls, 0);
});
test("the static viewer resource and tool metadata contain no scene or runtime credentials", async () => {
  const apps = createCanvasMcp({
    capabilities: () => capabilities,
    html: async () => "<html><body>Static template</body></html>",
  });
  const tools = apps.tools();
  ListToolsResultSchema.parse({ tools });
  assert.equal(tools.length, 2);
  assert.deepEqual(
    tools.find((x) => x.name === "canvas_read")?._meta?.ui.visibility,
    ["app"],
  );
  assert.equal(tools[0]._meta?.ui.resourceUri, CANVAS_RESOURCE);
  const r = await apps.readResource(CANVAS_RESOURCE);
  assert.equal(r.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(r.contents[0]._meta.ui.csp, {
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
  });
  assert.equal(r.contents[0].text, "<html><body>Static template</body></html>");
  await assert.rejects(apps.readResource("file:///private/drawing.excalidraw"));
});
test("open and app-only byte reads share a runtime scope without exposing it or image data to model content", async () => {
  const seen: any[] = [];
  const viewId = randomUUID();
  const apps = createCanvasMcp({
    capabilities: () => capabilities,
    request: async (request) => {
      seen.push(request);
      return request.command === "presentation-open"
        ? {
            ok: true,
            result: {
              protocol: 1,
              viewId,
              document: "d",
              epoch: "e",
              title: "Synthetic",
              expiresAt: Date.now() + 10000,
              scope: "must-not-leak",
            },
          }
        : {
            ok: true,
            result: { data: "synthetic-private-pixels", done: true },
          };
    },
  });
  const opened = await apps.call("show_canvas", { document: "d", epoch: "e" });
  assert.equal(opened.isError, false);
  assert.equal((opened as any)._meta.canvasBinding.viewId, viewId);
  assert.ok(!JSON.stringify(opened).includes("must-not-leak"));
  const read = await apps.call("canvas_read", {
    mode: "chunk",
    viewId,
    captureId: randomUUID(),
    offset: 0,
    byteCount: 10,
  });
  assert.deepEqual(read.content, []);
  assert.equal(
    (read.structuredContent as any).result.data,
    "synthetic-private-pixels",
  );
  assert.equal(seen[0].args.scope, seen[1].args.scope);
  assert.ok(!JSON.stringify(opened).includes(seen[0].args.scope));
});
test("a restarted adapter uses a fresh scope and strict schemas refuse paths, writes and oversized chunks", async () => {
  const scopes: string[] = [];
  const request = async (r: any) => {
    scopes.push(r.args.scope);
    return {
      ok: true as const,
      result: {
        protocol: 1,
        viewId: randomUUID(),
        document: "d",
        epoch: "e",
        title: "Test",
        expiresAt: Date.now() + 10000,
      },
    };
  };
  const a = createCanvasMcp({ capabilities: () => capabilities, request }),
    b = createCanvasMcp({ capabilities: () => capabilities, request });
  await a.call("show_canvas", { document: "d", epoch: "e" });
  await b.call("show_canvas", { document: "d", epoch: "e" });
  assert.notEqual(scopes[0], scopes[1]);
  for (const input of [
    { mode: "head", viewId: randomUUID(), path: "/private" },
    { mode: "save", viewId: randomUUID() },
    {
      mode: "chunk",
      viewId: randomUUID(),
      captureId: randomUUID(),
      offset: 0,
      byteCount: 65537,
    },
  ])
    assert.equal((await a.call("canvas_read", input)).isError, true);
  assert.equal(scopes.length, 2);
});
test("older desktop versions produce an actionable compatibility response without retrying a write", async () => {
  let calls = 0;
  const apps = createCanvasMcp({
    capabilities: () => capabilities,
    request: async () => {
      calls++;
      return {
        ok: false,
        error: {
          code: "UNKNOWN_COMMAND",
          message: "Unknown command",
          retryable: false,
        },
      };
    },
  });
  const r = await apps.call("show_canvas", { document: "d", epoch: "e" });
  assert.equal(r.isError, true);
  assert.match(JSON.stringify(r), /VIEW_NOT_SUPPORTED/);
  assert.equal(calls, 1);
});
