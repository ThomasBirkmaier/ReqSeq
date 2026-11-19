// Cross-access scenarios of html.export, in addition to the default one (cross-access.test.ts).
import path from "node:path";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { IDENTIFIERS, ONE_REPOSITORY } from "../../fixtures.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const PAGE = `site/elements/${WIND}.html`;
/** ONE_REPOSITORY with the text `body` for its requirement. */
const withText = (body: string) => ({
  ...ONE_REPOSITORY,
  files: {
    "requirements/SR-6328cee88fb3.md": `---\nid: ${WIND}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n---\n\n${body}\n`,
  },
});

/** The content of a page: what its content slot holds, without the docs' frame and the page scripts. */
const contentOf = (page: string): string =>
  page.slice(page.indexOf('<div class="sl-markdown-content">'), page.indexOf("</div><footer"));
/** The export date in the footer, which differs between calls only across midnight. */
const DATE = [/exported \d{4}-\d{2}-\d{2}/gu];
const GONE = "9d9d9d9d-1111-4222-8333-000000000002";

scenariosOf("html.export", [
  {
    tag: "[SR-231/AK-vm0n]",
    name: "a folder of HTML pages, one per element, a start page and the marker file",
    fixture: ONE_REPOSITORY,
    input: { output: "site" },
    expect: "output",
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(files["site/index.html"]).toContain("<!doctype html>");
        expect(files["site/reqseq-html-export.yaml"]).toContain("reqseq-html-export: 1");
        expect(Object.keys(files).some((f) => /^site\/elements\/[0-9a-f-]{36}\.html$/.test(f))).toBe(true);
      }
    },
  },
  {
    tag: "[SR-235/AK-zh58]",
    name: "a folder that is not empty and holds no marker file is refused, and nothing is written",
    fixture: { ...ONE_REPOSITORY, files: { "site/mine.txt": "mine\n" } },
    input: { output: "site" },
    expect: "error",
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.changed).toEqual([]);
      }
    },
  },
  {
    tag: "[SR-235/AK-m01q]",
    name: "a target in a .git folder is refused",
    fixture: ONE_REPOSITORY,
    input: { output: ".git/site" },
    expect: "error",
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.changed).toEqual([]);
      }
    },
  },
  {
    tag: "[SR-231/AK-z3tv]",
    name: "each page is named by the UUID of its element",
    fixture: IDENTIFIERS,
    input: { output: "site" },
    expect: "output",
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const pages = Object.keys(files).filter((f) => f.startsWith("site/elements/"));
        expect(pages.length).toBeGreaterThan(0);
        for (const page of pages) {
          expect(page).toMatch(
            /^site\/elements\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.html$/,
          );
        }
      }
    },
  },
  {
    tag: "[SR-235/AK-pnk8]",
    name: "an earlier export: its files replaced or removed, every other file left and named",
    fixture: {
      ...ONE_REPOSITORY,
      files: {
        "site/reqseq-html-export.yaml":
          "reqseq-html-export: 1\nfiles:\n  - index.html\n  - old.html\n  - ../outside.txt\n",
        "site/index.html": "old\n",
        "site/old.html": "old\n",
        "site/mine.txt": "mine\n",
        "outside.txt": "outside\n",
      },
    },
    input: { output: "site" },
    expect: "output",
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(files["site/index.html"]).toContain("<!doctype html>");
        expect(files["site/old.html"]).toBeUndefined();
        expect(files["site/mine.txt"]).toBe("mine\n");
        expect(files["outside.txt"]).toBe("outside\n");
      }
    },
  },
  {
    tag: "[SR-235/AK-f3tk]",
    name: "raw HTML, a script link, a network image and a Mermaid click action are shown as text and reported",
    fixture: withText(
      '<script>alert(1)</script> [run](javascript:alert(2)) ![net](https://example.org/x.png)\n\n```mermaid\nflowchart LR\n  click A "https://example.org"\n```',
    ),
    input: { output: "site" },
    expect: "output",
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = String(files[PAGE]);
        expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt; [run](javascript:alert(2))");
        expect(page).toContain("![net](https://example.org/x.png)");
        expect(contentOf(page)).not.toMatch(/<script|<img/u);
      }
    },
  },
  {
    tag: "[SR-235/AK-t7cw]",
    name: "a missing image stays text, and a link to another file of the repository is text without a link",
    fixture: withText("![gone](img/gone.png) and [spec](other.md)"),
    input: { output: "site" },
    expect: "output",
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(files[PAGE]).toContain("<p>![gone](img/gone.png) and spec</p>");
      }
    },
  },
  {
    tag: "[SR-231/AK-q64j]",
    name: "every page links the docs' stylesheet and has their theme select and menu",
    fixture: ONE_REPOSITORY,
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(files["site/assets/docs.css"]?.length).toBeGreaterThan(0);
        for (const [file, up] of [
          ["site/index.html", ""],
          [PAGE, "../"],
        ] as const) {
          const page = String(files[file]);
          expect(page).toContain(`<link rel="stylesheet" href="${up}assets/docs.css">`);
          expect(page).toContain("<starlight-theme-select>");
          expect(page).toContain('popovertarget="starlight__sidebar"');
        }
      }
    },
  },
  {
    tag: "[SR-231/AK-ycws]",
    name: "a formula is set, a diagram is drawn by the bundled Mermaid, and a broken formula shows its error",
    fixture: withText("Speed $v^2$, broken $\\frac{1$.\n\n```mermaid\nflowchart LR\n  A --> B\n```"),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = String(files[PAGE]);
        expect(page).toContain('<span class="katex">');
        expect(page).toContain('<code>\\frac{1</code> <span class="rq-render-error">');
        expect(page).toContain('<pre class="rq-diagram" data-rq-diagram><code class="language-mermaid">');
        expect(page).toContain('<script src="../assets/mermaid.js"></script>');
        expect(files["site/assets/mermaid.js"]?.length).toBeGreaterThan(0);
        expect(files["site/assets/katex.css"]).toContain("url(data:font/woff2;base64,");
      }
    },
  },
  {
    tag: "[SR-231/AK-wkbf]",
    name: "a reference links the page of its target, and one to a missing target is its link text",
    fixture: withText(`[self](reqseq:${WIND}) and [gone](reqseq:${GONE})`),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(files[PAGE]).toContain(`<p><a href="../elements/${WIND}.html">self</a> and gone</p>`);
      }
    },
  },
  {
    tag: "[SR-231/AK-c1hj]",
    name: "every page has the search field, and the index file names each element with a page and its title",
    fixture: withText("Text."),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(files["site/assets/search-index.js"]).toMatch(
          new RegExp(`^globalThis\\.reqseqSearchIndex = .*"Show wind speed",0,"${WIND}"`, "u"),
        );
        expect(files["site/assets/reqseq.js"]).toContain("function searchScript(");
        for (const file of ["site/index.html", PAGE]) {
          expect(files[file]).toMatch(/<reqseq-search class="astro-\w+" hidden="">/u);
        }
      }
    },
  },
  {
    tag: "[SR-231/AK-hmbc]",
    name: "the footer names the commit of the main repository and the date, and the page asks for noindex",
    fixture: ONE_REPOSITORY,
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = String(files[PAGE]);
        expect(page).toMatch(/<span class="rq-footer">Commit [0-9a-f]{12} · <masked> with ReqSeq /u);
        expect(page).toContain('<meta name="robots" content="noindex">');
      }
    },
  },
  {
    tag: "[SR-231/AK-f39g]",
    name: "every address a page names is a file of the folder, a data: URL or a link the reader follows",
    fixture: withText(
      "$x$ ![none](none.png) [web](https://example.org)\n\n```mermaid\nflowchart LR\n  A --> B\n```",
    ),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        for (const [file, text] of Object.entries(files)) {
          if (!file.startsWith("site/") || !/\.(?:html|css)$/u.test(file)) {
            continue;
          }
          for (const match of text.matchAll(/\s(?:href|src)="([^"]*)"|url\(\s*["']?([^"')]*)/gu)) {
            const address = String(match[1] ?? match[2]);
            if (/^(?:data:|#|https?:|mailto:)/u.test(address)) {
              continue;
            }
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), address));
            expect(files[target], `${file}: ${address}`).toBeDefined();
          }
        }
      }
    },
  },
]);
