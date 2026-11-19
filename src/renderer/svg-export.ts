/// <reference types="vite/client" />
import { AppError } from "../shared/types";
import agentSans from "../../assets/fonts/provenance.json";
import agentSansLicense from "../../assets/font-licenses/AgentSans-OFL.txt?raw";
import virgilLicense from "../../assets/font-licenses/Virgil-OFL.txt?raw";
import cascadiaLicense from "../../assets/font-licenses/Cascadia-OFL.txt?raw";
import excalifontLicense from "../../assets/font-licenses/Excalifont-OFL.txt?raw";
import nunitoLicense from "../../assets/font-licenses/Nunito-OFL.txt?raw";
import lilitaLicense from "../../assets/font-licenses/Lilita-OFL.txt?raw";
import comicShannsLicense from "../../assets/font-licenses/ComicShanns-MIT.txt?raw";
import xiaolaiLicense from "../../assets/font-licenses/Xiaolai-OFL.txt?raw";

const fontNotices: Record<string, string> = {
  "Liberation Sans":
    "Agent Sans Regular, derived from Liberation Sans 2.1.5. Internal family names changed and converted to WOFF2; original glyphs and copyright notices retained.\n" +
    agentSansLicense,
  Virgil: virgilLicense,
  Cascadia: cascadiaLicense,
  Excalifont: excalifontLicense,
  Nunito: nunitoLicense,
  "Lilita One":
    'Bundled binary notice: Copyright (c) 2011 Juan Montoreano (juan@remolacha.biz), with Reserved Font Names "Lilita One".\n' +
    lilitaLicense,
  "Comic Shanns": comicShannsLicense,
  Xiaolai: xiaolaiLicense,
};
function allowsNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) ||
      (url.protocol === "file:" &&
        ["", "localhost"].includes(url.hostname) &&
        decodeURIComponent(url.pathname).toLowerCase().endsWith(".excalidraw"))
    );
  } catch {
    return false;
  }
}

let cachedAgentSans: Promise<string> | undefined;
const cssUrls = (css: string) =>
  [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)].map(
    (match) => ({
      expression: match[0],
      value: match[1] ?? match[2] ?? match[3] ?? "",
    }),
  );

function agentSansDataUrl(): Promise<string> {
  if (!cachedAgentSans)
    cachedAgentSans = (async () => {
      // Never fetch the SDK-generated remote fallback. This fixed app resource is
      // the renamed, OFL-licensed replacement whose bytes were verified at build.
      const response = await fetch(
        "app://local/fonts/Liberation/LiberationSans-Regular.woff2",
      );
      if (!response.ok)
        throw new AppError(
          "FONT_ASSET_UNAVAILABLE",
          "The bundled SVG fallback font could not be read. Reinstall this application before exporting.",
        );
      const buffer = await response.arrayBuffer(),
        bytes = new Uint8Array(buffer);
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== "wOF2")
        throw new AppError(
          "FONT_ASSET_INVALID",
          "The bundled SVG fallback is not a valid WOFF2 asset.",
        );
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
      ]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== agentSans.output.sha256)
        throw new AppError(
          "FONT_ASSET_INVALID",
          "The bundled SVG fallback does not match the verified Agent Sans asset. No remote replacement was loaded.",
        );
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return `data:font/woff2;base64,${btoa(binary)}`;
    })().catch((error) => {
      cachedAgentSans = undefined;
      throw error;
    });
  return cachedAgentSans;
}

function assertLocalCss(css: string) {
  if (
    css.includes("\\") ||
    /@import\b/i.test(css) ||
    cssUrls(css).some(({ value }) => value && !/^(?:data:|#)/i.test(value))
  )
    throw new AppError(
      "EXPORT_EXTERNAL_RESOURCE",
      "The SVG contains an unresolved font or image resource. Export was stopped rather than creating a drawing that loads external content.",
    );
}

/** Complete the SDK's server-side fallback rule and reject loading references. */
export async function makeSvgSelfContained(svg: SVGSVGElement): Promise<void> {
  const embeddedFamilies = new Set<string>();
  for (const style of svg.querySelectorAll("style")) {
    let css = style.textContent || "";
    for (const [rule] of css.matchAll(/@font-face\s*\{[^{}]*\}/gi)) {
      if (
        !/font-family\s*:\s*(?:"Liberation Sans"|'Liberation Sans'|Liberation\s+Sans)\s*;/i.test(
          rule,
        )
      )
        continue;
      let replacement = rule;
      for (const resource of cssUrls(rule)) {
        if (!/^https?:\/\//i.test(resource.value)) continue;
        let known = false;
        try {
          known = new URL(resource.value).pathname.endsWith(
            "/fonts/Liberation/LiberationSans-Regular.woff2",
          );
        } catch {}
        if (known)
          replacement = replacement.replace(
            resource.expression,
            `url(${await agentSansDataUrl()})`,
          );
      }
      css = css.replace(rule, replacement);
    }
    assertLocalCss(css);
    style.textContent = css;
    for (const [rule] of css.matchAll(/@font-face\s*\{[^{}]*\}/gi)) {
      if (!cssUrls(rule).some((resource) => /^data:/i.test(resource.value)))
        continue;
      const match =
        /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;]+))\s*;/i.exec(rule);
      const family = (match?.[1] || match?.[2] || match?.[3] || "").trim();
      if (!Object.hasOwn(fontNotices, family))
        throw new AppError(
          "EXPORT_FONT_NOTICE_MISSING",
          "An embedded SVG font has no bundled redistribution notice. Export was stopped.",
        );
      embeddedFamilies.add(family);
    }
  }
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    if (
      ["script", "iframe", "object", "embed", "link", "foreignobject"].includes(
        element.localName.toLowerCase(),
      )
    )
      throw new AppError(
        "EXPORT_EXTERNAL_RESOURCE",
        "The SVG contains active embedded content. Export was stopped.",
      );
    for (const attribute of [
      "style",
      "fill",
      "stroke",
      "filter",
      "clip-path",
      "mask",
      "marker",
      "marker-start",
      "marker-mid",
      "marker-end",
      "cursor",
    ]) {
      const value = element.getAttribute(attribute);
      if (value) assertLocalCss(value);
    }
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.localName))
        throw new AppError(
          "EXPORT_EXTERNAL_RESOURCE",
          "The SVG contains an active event handler. Export was stopped.",
        );
      if (!["href", "src"].includes(attribute.localName.toLowerCase()))
        continue;
      const value = attribute.value.trim();
      // Navigable diagram links require an explicit click; they are not loaded
      // while viewing. All image/use/font resources must be embedded or local IDs.
      const permittedLink =
        element.localName.toLowerCase() === "a" &&
        attribute.localName.toLowerCase() === "href" &&
        allowsNavigation(value);
      if (
        value &&
        !value.startsWith("#") &&
        !(element.localName.toLowerCase() !== "a" && /^data:/i.test(value)) &&
        !permittedLink
      )
        throw new AppError(
          "EXPORT_EXTERNAL_RESOURCE",
          "The SVG contains an unresolved external loading resource. Export was stopped.",
        );
    }
  }
  if (
    embeddedFamilies.size &&
    !svg.querySelector("metadata[data-agent-excalidraw-font-notices]")
  ) {
    const metadata = svg.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "metadata",
    );
    metadata.setAttribute("data-agent-excalidraw-font-notices", "true");
    metadata.textContent = [...embeddedFamilies]
      .sort()
      .map(
        (family) => `Embedded font software: ${family}\n${fontNotices[family]}`,
      )
      .join("\n\n");
    svg.appendChild(metadata);
  }
}
