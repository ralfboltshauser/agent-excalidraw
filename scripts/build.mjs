import { buildEmbeddedViewer } from "./build-embedded.mjs";
import { build as bundle } from "esbuild";
import { build as vite } from "vite";
import { writeLicenses } from "./licenses.mjs";
import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
await mkdir("dist/main", { recursive: true });
const native = await bundle({
  metafile: true,
  entryPoints: ["src/main/index.ts", "src/main/preload.ts", "src/cli/index.ts"],
  outdir: "dist",
  outbase: "src",
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  banner: {
    js: "import { createRequire as __aeCreateRequire } from 'node:module'; const require = __aeCreateRequire(import.meta.url);",
  },
  sourcemap: true,
});
// Sandboxed preload must be a self-contained CommonJS bundle.
await bundle({
  entryPoints: ["src/main/preload.ts"],
  outfile: "dist/main/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
const embedded = await buildEmbeddedViewer();
const renderer = await vite({
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000,
  },
  logLevel: "warn",
});
await cp(
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
  "dist/renderer/fonts",
  { recursive: true },
);
await cp(
  "assets/fonts/AgentSans-Regular.woff2",
  "dist/renderer/fonts/Liberation/LiberationSans-Regular.woff2",
);
await cp("assets/font-licenses", "dist/font-licenses", { recursive: true });
await cp("assets/fonts", "dist/font-provenance", {
  recursive: true,
  filter: (source) => !source.endsWith(".woff2"),
});
const notices = (await readFile("docs/THIRD_PARTY_NOTICES.md", "utf8"))
  .replaceAll("../assets/font-licenses/", "font-licenses/")
  .replaceAll("../assets/fonts/", "font-provenance/");
await writeFile(
  "dist/THIRD_PARTY_NOTICES.md",
  notices +
    "\nAdditional bundled library license texts: [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt).\n",
);
await cp("skills", "dist/skills", { recursive: true });
await writeFile("dist/cli/package.json", '{"type":"module"}');

const outputs = Array.isArray(renderer) ? renderer : [renderer];
const modules = [
  ...Object.keys(native.metafile.inputs),
  ...Object.keys(embedded.metafile.inputs),
  ...outputs.flatMap((output) =>
    output.output.flatMap((chunk) =>
      chunk.type === "chunk" ? Object.keys(chunk.modules) : [],
    ),
  ),
];
const count = await writeLicenses(modules);
console.log(
  `Built desktop and standalone CLI; retained notices for ${count} bundled packages.`,
);
