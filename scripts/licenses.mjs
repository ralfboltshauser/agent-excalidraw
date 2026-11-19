import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeLicenses(moduleIds) {
  const packages = new Map();
  for (const moduleId of moduleIds) {
    const clean = moduleId.replace(/^\0/, "").split("?")[0];
    if (!clean.includes("node_modules")) continue;
    let directory = path.dirname(path.resolve(clean));
    while (directory !== path.dirname(directory)) {
      try {
        const json = JSON.parse(
          await readFile(path.join(directory, "package.json"), "utf8"),
        );
        if (json.name && json.version) {
          packages.set(directory, json);
          break;
        }
      } catch {}
      directory = path.dirname(directory);
    }
  }
  const entries = [],
    missing = [];
  for (const [directory, pkg] of [...packages].sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  )) {
    const files = (await readdir(directory)).filter((name) =>
      /^(licen[cs]e|copying|notice)([._-]|$)/i.test(name),
    );
    const texts = [];
    for (const name of files) {
      try {
        const text = await readFile(path.join(directory, name), "utf8");
        if (text.trim().length > 20 && text.length < 500000)
          texts.push({ name, text });
      } catch {}
    }
    if (!texts.length && pkg.name === "@excalidraw/excalidraw")
      texts.push({
        name: "Excalidraw-MIT.txt",
        text: await readFile("assets/font-licenses/Excalidraw-MIT.txt", "utf8"),
      });
    if (!texts.length && pkg.name.startsWith("@radix-ui/"))
      texts.push({
        name: "Radix-MIT.txt",
        text: await readFile("assets/software-licenses/Radix-MIT.txt", "utf8"),
      });
    const supplemental = {
      fastdom: "Fastdom-MIT.txt",
      "react-remove-scroll-bar": "ReactRemoveScrollBar-MIT.txt",
    };
    if (!texts.length && supplemental[pkg.name])
      texts.push({
        name: supplemental[pkg.name],
        text: await readFile(
          "assets/software-licenses/" + supplemental[pkg.name],
          "utf8",
        ),
      });
    if (texts.some((notice) => notice.text.trim().length < 20))
      throw new Error("Empty license notice for " + pkg.name);
    if (!texts.length) {
      missing.push({
        name: pkg.name,
        version: pkg.version,
        repository: pkg.repository,
      });
      continue;
    }
    entries.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license || pkg.licenses || "See license text",
      repository: pkg.repository,
      texts,
    });
  }
  if (missing.length) {
    await writeFile(
      "dist/license-audit-missing.json",
      JSON.stringify(missing, null, 2),
    );
    throw new Error(
      "Missing upstream license text: " +
        missing.map((p) => p.name + "@" + p.version).join(", "),
    );
  }
  await writeFile(
    "dist/THIRD_PARTY_LICENSES.txt",
    entries
      .map(
        (entry) =>
          `${"=".repeat(72)}\n${entry.name}@${entry.version}\nLicense: ${typeof entry.license === "string" ? entry.license : JSON.stringify(entry.license)}\n${entry.texts.map((t) => `\n--- ${t.name} ---\n${t.text}`).join("\n")}`,
      )
      .join("\n\n"),
  );
  await writeFile(
    "dist/dependency-inventory.json",
    JSON.stringify(
      entries.map(({ texts, ...entry }) => entry),
      null,
      2,
    ) + "\n",
  );
  return entries.length;
}
