import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function buildEmbeddedViewer() {
  const result = await build({
    entryPoints: ["src/embedded/main.ts"],
    outfile: "viewer.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
    metafile: true,
    sourcemap: false,
  });
  let html = await readFile("src/embedded/index.html", "utf8");
  html = html
    .replace(/<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, "")
    .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, "");
  const sourceCss = await readFile("src/embedded/style.css", "utf8");
  const css =
    sourceCss +
    "\n" +
    result.outputFiles
      .filter((f) => f.path.endsWith(".css"))
      .map((f) => f.text)
      .join("\n");
  const js = result.outputFiles.find((f) => f.path.endsWith(".js"))?.text;
  if (!js) throw Error("Embedded viewer produced no script.");
  html = html
    .replace("</head>", () => `<style>${css}</style></head>`)
    .replace(
      "</body>",
      () =>
        `<script type="module">${js.replaceAll("</script", "<\\/script")}</script></body>`,
    );
  if (Buffer.byteLength(html) > 1024 * 1024)
    throw Error("Embedded viewer exceeds 1 MiB.");
  if (
    /\b(?:src|href)=["'](?!data:|#)[^"']+["']/i.test(html) ||
    /\bimport\s*\(/.test(js) ||
    /sourceMappingURL=/.test(html)
  )
    throw Error(
      "Embedded viewer must contain no external assets, imports or source maps.",
    );
  await mkdir("dist/embedded", { recursive: true });
  await writeFile("dist/embedded/viewer.html", html);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await buildEmbeddedViewer();
