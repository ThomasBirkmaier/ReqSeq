// Cross-access scenarios of html.export, in addition to the default one (cross-access.test.ts).
import path from "node:path";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { CRITERIA, HINTS, IDENTIFIERS, ONE_REPOSITORY, WITH_VAULT } from "../../fixtures.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const PAGE = `site/elements/${WIND}.html`;
/** ONE_REPOSITORY with the text `body` for its requirement. */
const withText = (body: string) => ({
  ...ONE_REPOSITORY,
  files: {
    "requirements/SR-6328cee88fb3.md": `---\nid: ${WIND}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n---\n\n${body}\n`,
  },
});

/** ONE_REPOSITORY with the frontmatter lines `front` and the text `body` for its requirement, and `files`. */
const withFront = (front: string, body: string, files: Readonly<Record<string, string>> = {}) => ({
  ...ONE_REPOSITORY,
  files: {
    "requirements/SR-6328cee88fb3.md": `---\nid: ${WIND}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n${front}---\n\n${body}\n`,
    ...files,
  },
});
const OLD = "0b7c6e1a-1111-4222-8333-444455556666";
const FAR = "7f7f7f7f-1111-4222-8333-0000001a2b3c";

/** The content of a page: what its content slot holds, without the docs' frame and the page scripts. */
const contentOf = (page: string): string =>
  page.slice(page.indexOf('<div class="sl-markdown-content">'), page.indexOf("</div><footer"));
/** The export date in the footer, which differs between calls only across midnight. */
const DATE = [/exported \d{4}-\d{2}-\d{2}/gu];
const GONE = "9d9d9d9d-1111-4222-8333-000000000002";
const NEED = "aaaa1111-1111-4111-8111-00000000a001";
const CHILD = "aaaa1111-1111-4111-8111-00000000c0de";
const GRANDCHILD = "aaaa1111-1111-4111-8111-00000000c0df";

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
  {
    tag: "[SR-232/AK-cj5d]",
    name: "an element's page lists type, short ID, status, packages and verification status, each with a copy button",
    fixture: ONE_REPOSITORY,
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = contentOf(String(files[PAGE]));
        for (const [label, value] of [
          ["Type", "System Requirement"],
          ["Short ID", "SR-e88fb3"],
          ["Status", "draft"],
          ["Packages", "–"],
          ["Verification status in the core", "open"],
        ] as const) {
          expect(page).toContain(
            `<dt>${label}</dt><dd class="rq-copyable"><span class="rq-value">${value}</span><button type="button" class="rq-copy" data-copy="${value}"`,
          );
        }
        expect(files["site/assets/copy.js"]).toContain("navigator");
      }
    },
  },
  {
    tag: "[SR-232/AK-zr5v]",
    name: "an acceptance criterion shows number, key, text and status and copies its reference for test names",
    fixture: withFront(
      "requirement-type: functional\nacceptance-criteria:\n  - key: kred\n    text: Given wind, then it shows.\n  - Given calm, then 0 shows.\n",
      "Text.",
    ),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = contentOf(String(files[PAGE]));
        expect(page).toContain(
          '<p class="rq-criterion rq-copyable"><strong>AK1</strong> <code>kred</code> <span class="rq-criterion-status">open</span><button type="button" class="rq-copy" data-copy="[SR-e88fb3/AK-kred]"',
        );
        expect(page).toContain("<p>Given wind, then it shows.</p>");
        expect(page).toContain(
          '<strong>AK2</strong> <span class="rq-criterion-status">open</span></p><p>Given calm, then 0 shows.</p>',
        );
      }
    },
  },
  {
    tag: "[SR-232/AK-z2fm]",
    name: "an acceptance criterion lists the evidence records that bear its status",
    fixture: CRITERIA,
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = contentOf(String(files["site/elements/31313131-0000-4000-8000-3131310000e3.html"]));
        expect(page).toContain(
          '<p>Given a reading, then it shows.</p><div class="rq-evidence"><p class="rq-evidence-title">Evidence records</p><ul><li>inspection <span class="rq-legend">passed · 2026-11-02T10:00:00Z · core</span></li></ul></div>',
        );
      }
    },
  },
  {
    tag: "[SR-232/AK-q95d]",
    name: "an element's open hints stand above its text",
    fixture: HINTS,
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = contentOf(String(files["site/elements/26a0b000-0000-4000-8000-0000000000b2.html"]));
        expect(page).toContain(
          '<p class="starlight-aside__title" aria-hidden="true">Open hints</p><div class="starlight-aside__content"><ul><li>Required property Acceptance Criteria (acceptance-criteria) of type System Requirement (system-requirement) has no value; ReqSeq changes no file</li></ul></div></aside><section class="rq-text">',
        );
      }
    },
  },
  {
    tag: "[SR-231/AK-q4mj]",
    name: "an element that had a page and became invalid gets a short page with its successor",
    fixture: withFront(
      `supersedes:\n  - { id: ${OLD}, version: n1:0000000000000000 }\n`,
      `See [rain](reqseq:${OLD}).`,
      {
        "requirements/SR-444455556666.md": `---\nid: ${OLD}\ntype: system-requirement\nstatus: obsolete\ntitle: Show rain\n---\n\nRain.\n`,
        "site/reqseq-html-export.yaml": `reqseq-html-export: 1\nfiles:\n  - elements/${OLD}.html\n`,
        [`site/elements/${OLD}.html`]: "old\n",
      },
    ),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const stub = contentOf(String(files[`site/elements/${OLD}.html`]));
        expect(stub).toContain("<dt>Title</dt><dd>Show rain</dd><dt>Status</dt><dd>obsolete</dd>");
        expect(stub).toContain(`<li><a href="../elements/${WIND}.html">SR-e88fb3 Show wind speed</a></li>`);
        expect(files[PAGE]).toContain(`<a href="../elements/${OLD}.html">rain</a>`);
      }
    },
  },
  {
    tag: "[SR-231/AK-wkbf]",
    name: "a reference into a repository that is not on this machine is its link text with the note of SR-006 AK1",
    fixture: withFront(
      `acceptance-criteria:\n  - "Given [SR-1a2b3c](reqseq:${FAR}?repository=vault), then it shows."\n`,
      `See [far](reqseq:${FAR}?repository=vault).`,
      { "reqseq-workspace.yaml": WITH_VAULT },
    ),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = String(files[PAGE]);
        expect(page).toContain("<p>See far (UNKNOWN-1a2b3c, repository vault, not accessible).</p>");
        expect(page).toContain(
          "<p>Given SR-1a2b3c (UNKNOWN-1a2b3c, repository vault, not accessible), then it shows.</p>",
        );
      }
    },
  },
  {
    tag: "[SR-232/AK-r9s3]",
    name: "the neighbourhood shows parents, children and incoming relations, each row a link to its element's page",
    fixture: withFront(`derives-from:\n  - { id: ${NEED} }\n`, "Text.", {
      "needs/N-1.md": `---\nid: ${NEED}\ntype: need\nstatus: approved\ntitle: See the wind\n---\n\nNeed.\n`,
      "requirements/SR-1.md": `---\nid: ${CHILD}\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\nderives-from:\n  - { id: ${WIND} }\nbased-on:\n  - { id: ${WIND} }\n---\n\nGusts.\n`,
    }),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = contentOf(String(files[PAGE]));
        const row = (id: string, shown: string, title: string, status: string): string =>
          `<li><a href="../elements/${id}.html"><span>${shown}</span><span>${title}</span><span>${status}</span></a></li>`;
        expect(page).toContain(
          `<h3>Parents</h3><ul class="rq-nb">${row(NEED, "N-00a001", "See the wind", "approved")}</ul>` +
            `<h3>Children</h3><ul class="rq-nb">${row(CHILD, "SR-00c0de", "Show gusts", "draft")}</ul>` +
            `<h3>← Basis for</h3><ul class="rq-nb">${row(CHILD, "SR-00c0de", "Show gusts", "draft")}</ul>`,
        );
      }
    },
  },
  {
    tag: "[SR-232/AK-kycg]",
    name: "a child with an invalid status stands in the neighbourhood without a link, its own child after it",
    fixture: withFront("", "Text.", {
      "requirements/SR-1.md": `---\nid: ${CHILD}\ntype: system-requirement\nstatus: obsolete\ntitle: Show gusts\nderives-from:\n  - { id: ${WIND} }\n---\n\nGusts.\n`,
      "requirements/SR-2.md": `---\nid: ${GRANDCHILD}\ntype: system-requirement\nstatus: draft\ntitle: Show peaks\nderives-from:\n  - { id: ${CHILD} }\n---\n\nPeaks.\n`,
    }),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(contentOf(String(files[PAGE]))).toContain(
          '<h3>Children</h3><ul class="rq-nb"><li><span><span>SR-00c0de</span><span>Show gusts</span><span>obsolete</span></span></li>' +
            `<li style="--rq-level:1"><a href="../elements/${GRANDCHILD}.html"><span>SR-00c0df</span><span>Show peaks</span><span>draft</span></a></li></ul>`,
        );
      }
    },
  },
]);
