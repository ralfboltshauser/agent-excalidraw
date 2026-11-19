import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("artifacts/e0", { recursive: true });
const b = await build({
  entryPoints: ["tests/fixtures/mcp-app-probe-client.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  write: false,
});
await writeFile(
  "artifacts/e0/probe.html",
  `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;padding:20px;color:var(--color-text-primary,#222)}button{padding:12px;margin-top:16px}output{display:block}</style></head><body><h2>Agent Excalidraw bridge</h2><output>Connecting…</output><button>Read counter</button><script type="module">${b.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`,
);
