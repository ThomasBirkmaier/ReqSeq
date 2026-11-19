// `pnpm docs:export-theme`: the look of the docs for the HTML export (SR-231 AK4, ADR-0017). The docs site is built
// only in the docs steps of CI, with its own lockfile, so core cannot read it at export time. This generator reads
// one page of the offline build (`REQSEQ_DOCS_OFFLINE=1`, the build a delivery ships) and writes the tool-written
// `packages/core/src/html-export/docs-theme.generated.ts`:
//
// - the stylesheet the page links, the print one inside `@media print`;
// - the page frame, parsed with parse5: Starlight's header, sidebar pane with its menu button, theme selects,
//   content panel and footer with their scoped classes; every `<script>` and `<template>` removed, the search, the
//   social links, the table of contents and the links to the previous and next page left out, and the sidebar
//   pane without `popover` (the export's script sets it below the docs' breakpoint, as Starlight's does). Slots
//   take the site title and its link, the sidebar, the page title, the content and the footer, so neither the
//   docs' version nor their `href="/"` lands in the file;
// - Starlight's licence, which the export's notices name.
//
// It fails when a landmark is missing, or when the frame or the stylesheet keeps an address outside the page, so a
// Starlight update cannot break the frame silently. `--check` compares instead of writing (the CI docs step).
import fs from "node:fs/promises";
import path from "node:path";
import type { DefaultTreeAdapterMap } from "parse5";
import { defaultTreeAdapter, parse, serialize } from "parse5";

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

/** The slots of the frame, in the order they appear. */
export const SLOTS = ["home", "siteTitle", "sidebar", "title", "content", "footer"] as const;
export type Slot = (typeof SLOTS)[number];

export interface DocsTheme {
  /** The stylesheet of the docs: the one the page links, and its print one in `@media print`. */
  readonly stylesheet: string;
  /** The attributes of `<html>` and `<body>`, as written. */
  readonly htmlAttributes: string;
  readonly bodyAttributes: string;
  /** The frame: text, then slot name, then text, alternating, beginning and ending with text. */
  readonly frame: readonly string[];
  /** The scoped class of the sidebar's list, for the entries the export writes. */
  readonly sidebarScope: string;
}

export interface Notice {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly text: string;
}

const MARK = (slot: Slot): string => `@@reqseq-slot:${slot}@@`;

const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((a) => a.name === name)?.value;
const classes = (element: Element): string[] => (attribute(element, "class") ?? "").split(/\s+/u);

/** Every element below `root`, in document order. */
const elements = (root: ParentNode): Element[] => {
  const found: Element[] = [];
  const stack: Node[] = [...root.childNodes].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if ("tagName" in node) {
      found.push(node);
      stack.push(...[...(node.tagName === "template" ? [] : node.childNodes)].reverse());
    }
  }
  return found;
};

/** The one element of `root` that `test` takes; fails with `what` when there is none. */
const landmark = (root: ParentNode, what: string, test: (e: Element) => boolean): Element => {
  const found = elements(root).find(test);
  if (found === undefined) {
    throw new Error(`export-theme: the docs page has no ${what}; Starlight changed, adapt export-theme.ts`);
  }
  return found;
};

const text = (parent: ParentNode, value: string): DefaultTreeAdapterMap["textNode"] => ({
  nodeName: "#text",
  value,
  parentNode: parent,
});

/** Replaces the children of `element` by the mark of `slot`. */
const slotInside = (element: Element, slot: Slot): void => {
  element.childNodes = [text(element, MARK(slot))];
};

const attributesOf = (element: Element, dropped: readonly string[]): string =>
  element.attrs
    .filter((a) => !dropped.includes(a.name))
    .map((a) =>
      a.value === "" ? a.name : `${a.name}="${a.value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`,
    )
    .join(" ");

/**
 * The addresses of the frame that lead out of the page: every attribute that takes an address but an anchor and a
 * slot, and every `url()` of a `style` attribute but a `data:` URL.
 */
const outsideAddresses = (frame: string): string[] => [
  ...[
    ...frame.matchAll(
      /\s(?:xlink:href|href|src|action|formaction|srcset|poster|data|ping|background|cite)="([^"]*)"/gu,
    ),
  ]
    .map((m) => String(m[1]))
    .filter((value) => !value.startsWith("#") && !value.startsWith("@@reqseq-slot:")),
  ...[...frame.matchAll(/\sstyle="([^"]*)"/gu)].flatMap((m) =>
    [...String(m[1]).matchAll(/url\(\s*(?!(?:["']|&quot;)?data:)(?:["']|&quot;)?([^"')&]*)/gu)].map((u) =>
      String(u[1]),
    ),
  ),
];

/** The frame and the stylesheet links of the offline docs page `html` (see the file comment). */
export const themeOfPage = (
  html: string,
): { theme: Omit<DocsTheme, "stylesheet">; styles: { href: string; print: boolean }[] } => {
  const document = parse(html);
  const root = landmark(document, "<html>", (e) => e.tagName === "html");
  const head = landmark(root, "<head>", (e) => e.tagName === "head");
  const body = landmark(root, "<body>", (e) => e.tagName === "body");
  const styles = elements(head)
    .filter((e) => e.tagName === "link" && attribute(e, "rel") === "stylesheet")
    .map((e) => ({ href: String(attribute(e, "href")), print: attribute(e, "media") === "print" }));
  if (!styles.some((s) => !s.print)) {
    throw new Error("export-theme: the docs page links no stylesheet");
  }
  for (const element of elements(body)) {
    const name = element.tagName;
    const cls = classes(element);
    if (
      name === "script" ||
      name === "template" ||
      name === "reqseq-search" ||
      name === "starlight-lang-select" ||
      cls.includes("social-icons") ||
      cls.includes("right-sidebar-container") ||
      cls.includes("pagination-links")
    ) {
      defaultTreeAdapter.detachNode(element);
    }
  }
  const title = landmark(body, "site title", (e) => e.tagName === "a" && classes(e).includes("site-title"));
  const titleText = landmark(title, "site title text", (e) => e.tagName === "span");
  title.attrs = title.attrs.map((a) => (a.name === "href" ? { ...a, value: MARK("home") } : a));
  slotInside(titleText, "siteTitle");
  landmark(body, "menu button", (e) => e.tagName === "button" && classes(e).includes("sl-menu-button"));
  const pane = landmark(body, "sidebar pane", (e) => e.tagName === "sl-sidebar-pane");
  pane.attrs = pane.attrs.filter((a) => a.name !== "popover");
  landmark(body, "theme select", (e) => e.tagName === "starlight-theme-select");
  const persist = landmark(pane, "sidebar list", (e) => e.tagName === "sl-sidebar-state-persist");
  const list = landmark(
    persist,
    "sidebar top-level list",
    (e) => e.tagName === "ul" && classes(e).includes("top-level"),
  );
  const sidebarScope = classes(list).find((c) => /^astro-[a-z0-9]+$/u.test(c));
  if (sidebarScope === undefined) {
    throw new Error("export-theme: the sidebar list has no scoped class");
  }
  const holder = landmark(pane, "sidebar list holder", (e) => e.childNodes.includes(persist));
  const slot = text(holder, MARK("sidebar"));
  holder.childNodes = holder.childNodes.map((c) => (c === persist ? slot : c));
  slotInside(
    landmark(body, "page title", (e) => e.tagName === "h1" && attribute(e, "id") === "_top"),
    "title",
  );
  slotInside(
    landmark(body, "content", (e) => classes(e).includes("sl-markdown-content")),
    "content",
  );
  const footer = landmark(body, "footer", (e) => e.tagName === "footer");
  slotInside(
    landmark(footer, "footer meta", (e) => classes(e).includes("meta")),
    "footer",
  );
  const serialized = serialize(body);
  const outside = outsideAddresses(serialized);
  if (outside.length > 0) {
    throw new Error(`export-theme: the frame keeps addresses outside the page: ${outside.join(", ")}`);
  }
  const frame = serialized.split(/@@reqseq-slot:(\w+)@@/u);
  const order = frame.filter((_, i) => i % 2 === 1);
  if (order.join(" ") !== SLOTS.join(" ")) {
    throw new Error(`export-theme: the slots are ${order.join(", ")}, not ${SLOTS.join(", ")}`);
  }
  return {
    theme: {
      htmlAttributes: attributesOf(root, ["data-theme", "data-has-toc"]),
      bodyAttributes: attributesOf(body, []),
      frame,
      sidebarScope,
    },
    styles,
  };
};

/** The stylesheet of `styles` read by `read(href)`; fails on a `url()` that is no `data:` URL. */
export const stylesheetOf = async (
  styles: readonly { href: string; print: boolean }[],
  read: (href: string) => Promise<string>,
): Promise<string> => {
  const parts = await Promise.all(
    styles.map(async ({ href, print }) => {
      const css = (await read(href)).trim();
      return print ? `@media print{${css}}` : css;
    }),
  );
  const css = `${parts.join("\n")}\n`;
  const outside = [...css.matchAll(/url\(\s*(?!["']?data:)["']?([^"')]*)/gu)].map((m) => String(m[1]));
  if (outside.length > 0 || /@import\b/u.test(css)) {
    throw new Error(
      `export-theme: the stylesheet loads from outside the page: ${outside.join(", ") || "@import"}`,
    );
  }
  return css;
};

/** The TypeScript module of `theme` and `notice`. */
export const themeModule = (theme: DocsTheme, notice: Notice): string =>
  [
    "// Written by `pnpm docs:export-theme` (packages/docs/src/export-theme.ts) from the offline build of the docs;",
    "// do not edit. The CI docs step fails when it differs from what the generator writes (SR-231 AK4, ADR-0017).",
    `export const DOCS_STYLESHEET = ${JSON.stringify(theme.stylesheet)};`,
    `export const DOCS_HTML_ATTRIBUTES = ${JSON.stringify(theme.htmlAttributes)};`,
    `export const DOCS_BODY_ATTRIBUTES = ${JSON.stringify(theme.bodyAttributes)};`,
    `export const DOCS_FRAME: readonly string[] = ${JSON.stringify(theme.frame)};`,
    `export const DOCS_SIDEBAR_SCOPE = ${JSON.stringify(theme.sidebarScope)};`,
    `export const STARLIGHT_NOTICE = ${JSON.stringify(notice)} as const;`,
    "",
  ].join("\n");

export interface ThemePaths {
  /** The built offline site (`packages/docs/site/dist`). */
  readonly site: string;
  /** Starlight's folder in the site's install. */
  readonly starlight: string;
  /** The module to write. */
  readonly module: string;
}

/** The theme module from the files of `paths`. */
export const buildThemeModule = async (paths: ThemePaths): Promise<string> => {
  const html = await fs.readFile(path.join(paths.site, "index.html"), "utf8");
  if (html.includes('<link rel="canonical"') || !html.includes('href="/_astro/')) {
    throw new Error("export-theme: the site is not the offline build; build it with REQSEQ_DOCS_OFFLINE=1");
  }
  const { theme, styles } = themeOfPage(html);
  const stylesheet = await stylesheetOf(styles, (href) =>
    fs.readFile(path.join(paths.site, ...href.split("/")), "utf8"),
  );
  const manifest = JSON.parse(await fs.readFile(path.join(paths.starlight, "package.json"), "utf8")) as {
    version: string;
    license: string;
  };
  const licence = await fs.readFile(path.join(paths.starlight, "LICENSE"), "utf8");
  return themeModule(
    { ...theme, stylesheet },
    {
      name: "@astrojs/starlight",
      version: manifest.version,
      license: manifest.license,
      text: licence.trim(),
    },
  );
};

/** Writes the module, or with `check` tells whether it is up to date; the message for the log. */
export const exportTheme = async (
  paths: ThemePaths,
  check: boolean,
): Promise<{ ok: boolean; message: string }> => {
  const module = await buildThemeModule(paths);
  if (!check) {
    await fs.writeFile(paths.module, module);
    return { ok: true, message: `docs: wrote ${paths.module}\n` };
  }
  const current = await fs.readFile(paths.module, "utf8").catch(() => "");
  return current === module
    ? { ok: true, message: "docs: the theme of the HTML export is up to date\n" }
    : {
        ok: false,
        message: `docs: ${paths.module} differs from the docs build; run pnpm docs:export-theme after the offline build and commit it\n`,
      };
};
