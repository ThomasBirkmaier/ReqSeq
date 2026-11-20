// The docs theme of the HTML export (SR-231 AK4): the frame and stylesheet the generator takes from a docs page.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  SLOTS,
  badgeScopeOf,
  buildThemeModule,
  exportTheme,
  stylesheetOf,
  themeModule,
  themeOfPage,
} from "./export-theme.js";

const BODY = `<a href="#_top" class="sl-skip-link">Skip</a>
<header><a href="/" class="site-title astro-x"><span>ReqSeq 1.2</span></a><reqseq-search data-index="/ReqSeq/search-index.json" class="astro-s"><input></reqseq-search>
<div class="social-icons"><a href="https://github.com/x">GitHub</a></div><starlight-lang-select></starlight-lang-select>
<starlight-theme-select><select><option value="auto">Auto</option></select></starlight-theme-select></header>
<nav><button class="sl-menu-button" popovertarget="starlight__sidebar">Menu</button>
<sl-sidebar-pane id="starlight__sidebar" popover><div><span>Docs</span><sl-sidebar-state-persist><ul class="top-level astro-sdl5bin4"><li><a href="/guide/">Guide</a></li></ul></sl-sidebar-state-persist></div></sl-sidebar-pane></nav>
<div class="main-frame"><div class="lg:sl-flex"><aside class="right-sidebar-container astro-r"><div class="lg:sl-hidden"><mobile-starlight-toc><a href="#_top">Overview</a></mobile-starlight-toc></div>
<div class="right-sidebar-panel"><starlight-toc><nav><h2>On this page</h2><ul class="astro-skl1" style="--depth: 0;"><li><a href="#x">X</a></li></ul></nav></starlight-toc></div></aside>
<h1 id="_top">Home</h1><div class="sl-markdown-content"><p>Text <img src="/a.png"></p></div>
<footer><div class="meta"><a href="https://github.com/edit">Edit</a></div><div class="pagination-links"><a href="/next/">Next</a></div></footer>
<template><a href="/t/">t</a></template><script>alert(1)</script></div>`;

const page = (
  body = BODY,
  head = '<link rel="stylesheet" href="/_astro/a.css"><link rel="stylesheet" href="/_astro/p.css" media="print">',
) =>
  `<!doctype html><html lang="en" dir="ltr" data-theme="dark" data-has-toc><head>${head}</head><body class="b" data-ready>${body}</body></html>`;

describe("themeOfPage (SR-231 AK4)", () => {
  it("takes the frame with its slots, the hidden search field and the stylesheets, without scripts, links out or popover", () => {
    const { theme, styles } = themeOfPage(page());
    expect(styles).toEqual([
      { href: "/_astro/a.css", print: false },
      { href: "/_astro/p.css", print: true },
    ]);
    expect(theme.htmlAttributes).toBe('lang="en" dir="ltr"');
    expect(theme.bodyAttributes).toBe('class="b" data-ready');
    expect(theme.sidebarScope).toBe("astro-sdl5bin4");
    expect(theme.tocScope).toBe("astro-skl1");
    expect(theme.toc).toEqual([
      '<aside class="right-sidebar-container astro-r">\n<div class="right-sidebar-panel"><starlight-toc><nav><h2>On this page</h2><ul class="astro-skl1" style="--depth: 0;">',
      "</ul></nav></starlight-toc></div></aside>",
    ]);
    expect(theme.frame.filter((_, i) => i % 2 === 1)).toEqual([...SLOTS]);
    const frame = theme.frame.join("");
    for (const gone of [
      "<script",
      "<template",
      "data-index",
      "social-icons",
      "lang-select",
      "right-sidebar",
      "pagination",
      "ReqSeq 1.2",
      'href="/"',
    ]) {
      expect(frame).not.toContain(gone);
    }
    expect(frame).toContain('class="sl-menu-button"');
    expect(frame).toContain('<sl-sidebar-pane id="starlight__sidebar"><div><span>Docs</span>');
    expect(frame).toContain("<starlight-theme-select>");
    expect(frame).toContain('<reqseq-search class="astro-s" hidden=""><input></reqseq-search>');
  });

  it("fails on a missing landmark, a missing stylesheet or scope, an address out of the page and slots out of order", () => {
    expect(() => themeOfPage(page(BODY.replace("sl-menu-button", "x")))).toThrow("has no menu button");
    expect(() => themeOfPage(page(BODY, ""))).toThrow("links no stylesheet");
    expect(() => themeOfPage(page(BODY.replaceAll("reqseq-search", "x-search")))).toThrow(
      "has no search field",
    );
    expect(() => themeOfPage(page(BODY.replace(" astro-sdl5bin4", "")))).toThrow("no scoped class");
    expect(() => themeOfPage(page(BODY.replace("right-sidebar-container", "x")))).toThrow(
      "has no right column",
    );
    expect(() => themeOfPage(page(BODY.replaceAll("starlight-toc>", "x-toc>")))).toThrow(
      "has no table of contents",
    );
    expect(() => themeOfPage(page(BODY.replace('<ul class="astro-skl1"', "<ol")))).toThrow(
      "has no table of contents list",
    );
    expect(() => themeOfPage(page(BODY.replace("astro-skl1", "toc")))).toThrow(
      "the list of the table of contents has no scoped class",
    );
    expect(() => themeOfPage(page(BODY.replace("<h2>On", '<h2><a href="/o/">o</a>On')))).toThrow(
      "addresses outside the page: /o/",
    );
    expect(() => themeOfPage(page(BODY.replace("<nav>", '<nav><img src="/logo.svg">')))).toThrow(
      "addresses outside the page: /logo.svg",
    );
    for (const [markup, address] of [
      ['<svg><use xlink:href="/icons.svg#x"></use></svg>', "/icons.svg#x"],
      ['<a href="#top" ping="https://t.example/p">x</a>', "https://t.example/p"],
      ['<button formaction="/go">x</button>', "/go"],
      [`<div style="background:url('/bg.png')"></div>`, "/bg.png"],
    ] as const) {
      expect(() => themeOfPage(page(BODY.replace("<nav>", `<nav>${markup}`)))).toThrow(
        `addresses outside the page: ${address}`,
      );
    }
    // A data: URL in a style and an anchor stay.
    expect(() =>
      themeOfPage(
        page(BODY.replace("<nav>", `<nav><div style="background:url('data:image/png;base64,AA')"></div>`)),
      ),
    ).not.toThrow();
    const footerFirst = BODY.replace('<h1 id="_top">Home</h1>', "").replace(
      "<header>",
      '<h1 id="_top">Home</h1><header>',
    );
    expect(() => themeOfPage(page(footerFirst))).toThrow("the slots are title, home");
  });
});

describe("stylesheetOf (SR-231 AK4)", () => {
  it("joins the sheets, the print one in @media print, and fails on what loads from outside", async () => {
    const sheets: Record<string, string> = {
      a: "a{b:url(data:x)}",
      p: "p{c:d}",
      u: "x{y:url('/f.woff2')}",
      i: "@import 'x.css';",
    };
    const read = (href: string) => Promise.resolve(String(sheets[href]));
    await expect(
      stylesheetOf(
        [
          { href: "a", print: false },
          { href: "p", print: true },
        ],
        read,
      ),
    ).resolves.toBe("a{b:url(data:x)}\n@media print{p{c:d}}\n");
    await expect(stylesheetOf([{ href: "u", print: false }], read)).rejects.toThrow(
      "outside the page: /f.woff2",
    );
    await expect(stylesheetOf([{ href: "i", print: false }], read)).rejects.toThrow(
      "outside the page: @import",
    );
  });
});

describe("badgeScopeOf (SR-231 AK4)", () => {
  it("takes the scoped class of Starlight's badge, and fails without one", () => {
    expect(badgeScopeOf("a{}.sl-badge:where(.astro-qn5){b:c}")).toBe("astro-qn5");
    expect(() => badgeScopeOf(".sl-badge{b:c}")).toThrow("no scoped style of Starlight's badge");
  });
});

describe("exportTheme (SR-231 AK4)", () => {
  const site = async (html = page()) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-theme-"));
    onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
    const paths = {
      site: path.join(root, "dist"),
      starlight: path.join(root, "starlight"),
      module: path.join(root, "theme.ts"),
    };
    await fs.mkdir(path.join(paths.site, "_astro"), { recursive: true });
    await fs.mkdir(paths.starlight);
    await fs.writeFile(path.join(paths.site, "index.html"), html);
    await fs.writeFile(path.join(paths.site, "_astro", "a.css"), ".sl-badge:where(.astro-b1){}");
    await fs.writeFile(path.join(paths.site, "_astro", "p.css"), "p{}");
    await fs.writeFile(path.join(paths.starlight, "package.json"), '{"version":"0.42.6","license":"MIT"}');
    await fs.writeFile(path.join(paths.starlight, "LICENSE"), "MIT License\n");
    return paths;
  };

  it("writes the module, and with check tells whether it is up to date", async () => {
    const paths = await site();
    await expect(exportTheme(paths, true)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("differs") as unknown,
    });
    await expect(exportTheme(paths, false)).resolves.toEqual({
      ok: true,
      message: `docs: wrote ${paths.module}\n`,
    });
    const written = await fs.readFile(paths.module, "utf8");
    expect(written).toBe(await buildThemeModule(paths));
    expect(written).toContain(
      'export const DOCS_STYLESHEET = ".sl-badge:where(.astro-b1){}\\n@media print{p{}}\\n";',
    );
    expect(written).toContain('export const DOCS_BADGE_SCOPE = "astro-b1";');
    expect(written).toContain(
      '"name":"@astrojs/starlight","version":"0.42.6","license":"MIT","text":"MIT License"',
    );
    await expect(exportTheme(paths, true)).resolves.toEqual({
      ok: true,
      message: "docs: the theme of the HTML export is up to date\n",
    });
  });

  it("refuses a site that is not the offline build", async () => {
    const online = await site(
      page(BODY, '<link rel="canonical" href="https://x/"><link rel="stylesheet" href="/_astro/a.css">'),
    );
    await expect(buildThemeModule(online)).rejects.toThrow("not the offline build");
    const based = await site(page(BODY, '<link rel="stylesheet" href="/docs/_astro/a.css">'));
    await expect(buildThemeModule(based)).rejects.toThrow("not the offline build");
  });

  it("writes every part of the theme into the module", () => {
    const module = themeModule(
      {
        stylesheet: "s",
        htmlAttributes: "h",
        bodyAttributes: "b",
        frame: ["a", "home", "z"],
        sidebarScope: "astro-1",
        toc: ["<aside><ul>", "</ul></aside>"],
        tocScope: "astro-2",
        badgeScope: "astro-3",
      },
      { name: "n", version: "1", license: "MIT", text: "t" },
    );
    expect(module).toContain('export const DOCS_FRAME: readonly string[] = ["a","home","z"];');
    expect(module).toContain('export const DOCS_SIDEBAR_SCOPE = "astro-1";');
    expect(module).toContain(
      'export const DOCS_TOC: readonly [string, string] = ["<aside><ul>","</ul></aside>"];',
    );
    expect(module).toContain('export const DOCS_TOC_SCOPE = "astro-2";');
    expect(module).toContain('export const DOCS_BADGE_SCOPE = "astro-3";');
  });
});
