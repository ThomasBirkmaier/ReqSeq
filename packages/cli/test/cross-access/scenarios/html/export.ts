// Cross-access scenarios of html.export, in addition to the default one (cross-access.test.ts).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";
import type { Copy } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { CRITERIA, EXPORT, HINTS, IDENTIFIERS, ONE_REPOSITORY, WITH_VAULT } from "../../fixtures.js";

const execFileAsync = promisify(execFile);
const ID = "61061061-0000-4000-8000-0000000000";

/**
 * In `system` of an EXPORT copy: the baseline „Release 2“ of SR-0000b1 and SR-0000b2 at HEAD, then a commit that
 * changes the criterion of SR-0000b1, with fixed author and dates, so every copy gets the same commits; once. The
 * fixture's „Release 1“ names a commit the repository does not have.
 */
const changedSinceBaseline = async ({ root }: Copy): Promise<void> => {
  const date = "2026-11-03T10:00:00Z";
  const git = (args: readonly string[]): Promise<{ stdout: string }> =>
    execFileAsync("git", args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
  const file = path.join(root, "baselines", "Release-2.yaml");
  if (
    await fs.stat(file).then(
      () => true,
      () => false,
    )
  ) {
    return;
  }
  const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
  await fs.writeFile(
    file,
    "reqseq-baseline: 1\nname: Release 2\ndate: 2026-11-02T13:00:00Z\nrepositories:\n" +
      `  - { name: system, commit: ${head} }\nelements:\n` +
      `  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }\n` +
      `  - { id: ${ID}b2, version: n1:077d46fbf1a6a93d }\n`,
  );
  const b1 = path.join(root, "requirements", "SR-0000000000b1.md");
  await fs.writeFile(
    b1,
    (await fs.readFile(b1, "utf8")).replace("shows the speed.", "shows the speed in knots."),
  );
  await git(["commit", "-qam", "change"]);
};

/** The baseline export of the EXPORT fixture, as each scenario of SR-232 AK7, SR-233 AK2 and SR-234 takes it. */
const BASELINE_EXPORT = {
  fixture: EXPORT,
  root: "system",
  input: { output: "site" },
  expect: "output",
  prepare: changedSinceBaseline,
} as const;

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
const PACKAGE = "9d9d9d9d-1111-4222-8333-0000000000d1";
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
  {
    tag: "[SR-232/AK-tndh]",
    name: "the neighbourhood names a repository that is not on this machine and shows a parent there without a link",
    fixture: withFront(`derives-from:\n  - { id: ${FAR}, repository: vault }\n`, "Text.", {
      "reqseq-workspace.yaml": WITH_VAULT,
    }),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      const line = (what: string): string =>
        `<p class="rq-nb-none">Repositories not on this machine: vault. ${what} from their elements are not accessible and may be missing here.</p>`;
      for (const { files } of Object.values(results)) {
        expect(contentOf(String(files[PAGE]))).toContain(
          '<h3>Parents</h3><ul class="rq-nb"><li><span><span>UNKNOWN-1a2b3c</span><span>repository vault, not accessible</span><span></span></span></li></ul>' +
            `<h3>Children</h3>${line("Children")}${line("Incoming relations and references")}</section>`,
        );
      }
    },
  },
  {
    tag: "[SR-233/AK-pmt8]",
    name: "a list per type with a row per element, the settings of search, filters and sorting, and its script",
    fixture: ONE_REPOSITORY,
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const list = contentOf(String(files["site/lists/system-requirement.html"]));
        expect(list).toContain(
          `<a href="../elements/${WIND}.html">SR-e88fb3</a></td><td>Show wind speed</td>`,
        );
        expect(list).toContain("data-rq-list=");
        expect(list).toContain("&quot;label&quot;:&quot;Status&quot;");
        expect(files["site/assets/list.js"]).toContain("rq-search");
      }
    },
  },
  {
    tag: "[SR-233/AK-hqc9]",
    name: "a start page with the verification degree, what needs attention, the newest baseline and each type",
    fixture: ONE_REPOSITORY,
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const start = contentOf(String(files["site/index.html"]));
        expect(start).toContain('<h2 id="verification-degree">Verification degree</h2>');
        expect(start).toContain('<h2 id="not-verified">Failed, outdated or open requirements</h2>');
        expect(start).toContain("<p>The workspace has no baseline.</p>");
        expect(start).toContain(
          '<a href="lists/system-requirement.html">System Requirement</a></td><td>1</td>',
        );
      }
    },
  },
  {
    tag: "[SR-006/AK-q0f4]",
    name: "an export with a repository of the workspace not on this machine is marked incomplete",
    fixture: { ...ONE_REPOSITORY, files: { "reqseq-workspace.yaml": WITH_VAULT } },
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { outcome, files } of Object.values(results)) {
        expect(outcome).toMatchObject({
          output: {
            incomplete: true,
            answer: "Exported 1 element page to site; incomplete, as a repository is not available.",
          },
        });
        expect(String(files["site/index.html"])).toContain("This export is incomplete:");
      }
    },
  },
  {
    tag: "[SR-233/AK-kh76]",
    name: "every page names each package, and the page of a package lists its elements",
    fixture: withFront(
      `packages:\n  - { id: ${PACKAGE}, version: n2:0000000000000000, title: Display }\n`,
      "Wind.",
      {
        "packages/PKG-0000000000d1.md": `---\nid: ${PACKAGE}\ntype: package\ntitle: Display\n---\n\nThe display.\n`,
      },
    ),
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(files[PAGE]).toContain(`href="../elements/${PACKAGE}.html"`);
        const own = contentOf(String(files[`site/elements/${PACKAGE}.html`]));
        expect(own).toContain("The display.");
        expect(own).toContain('<h2 id="elements">Elements</h2>');
        expect(own).toContain(
          `<a href="../elements/${WIND}.html">SR-e88fb3</a></td><td>Show wind speed</td><td>draft</td>`,
        );
      }
    },
  },
  {
    tag: "[SR-233/AK-twk6]",
    name: "a list is the whole table without script, and its controls come from the script alone",
    fixture: ONE_REPOSITORY,
    input: { output: "site" },
    expect: "output",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const list = String(files["site/lists/system-requirement.html"]);
        expect(contentOf(list)).toContain("<table>");
        expect(contentOf(list)).not.toContain("rq-search");
        expect(list).toContain('src="../assets/list.js"');
      }
    },
  },
  {
    ...BASELINE_EXPORT,
    tag: "[SR-232/AK-dywy]",
    name: "an element page names the change since each baseline, with the field difference where Git has the commit",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = contentOf(String(files[`system/site/elements/${ID}b1.html`]));
        expect(page).toContain('<h2 id="since-baselines">Since baselines</h2>');
        expect(page).toContain(
          "Release 2</a> of 2026-11-02: changed; version in the baseline n1:697a2ad17ed49170",
        );
        expect(page).toContain("then it shows the speed in knots.</pre>");
        expect(page).toContain(
          "The difference is not available: the commit 61aa061aa061 of the baseline is not in the local Git history of repository system.",
        );
      }
    },
  },
  {
    ...BASELINE_EXPORT,
    tag: "[SR-233/AK-p6z2]",
    name: "a list carries the change of each row since each baseline, in a column hidden until one is chosen",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const list = contentOf(String(files["system/site/lists/system-requirement.html"]));
        expect(list).toContain(
          "&quot;compare&quot;:{&quot;label&quot;:&quot;Change since baseline&quot;,&quot;baselines&quot;:[&quot;Release 2 (2026-11-02)&quot;,&quot;Release 1 (2026-10-23)&quot;]",
        );
        expect(list).toContain('<th scope="col" hidden>Change since baseline</th>');
        expect(list).toContain('data-b="[0,0]"');
      }
    },
  },
  {
    ...BASELINE_EXPORT,
    tag: "[SR-234/AK-vjfq]",
    name: "a baseline page names its commits and its elements by change",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const index = String(files["system/site/baselines/index.html"]);
        const href = /href="\.\.\/(baselines\/[0-9a-f]{12}\.html)">Release 2</u.exec(index)?.[1];
        const page = contentOf(String(files[`system/site/${String(href)}`]));
        expect(page).toContain('<h2 id="commits">Commits</h2>');
        expect(page).toContain(`<h2 id="changed">Changed</h2><table>`);
        expect(page).toContain(`<a href="../elements/${ID}b1.html">SR-0000b1</a>`);
        expect(page).toContain('<h2 id="unchanged">Unchanged</h2>');
        expect(page).toContain("This baseline stores no selection");
      }
    },
  },
  {
    ...BASELINE_EXPORT,
    tag: "[SR-234/AK-swvj]",
    name: "the page of all baselines lists each with date and numbers, newest first",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const index = contentOf(String(files["system/site/baselines/index.html"]));
        expect(index).toMatch(
          /Release 2<\/a><\/td><td>2026-11-02T13:00:00Z<\/td><td>2<\/td><td>1<\/td>.*Release 1<\/a><\/td><td>2026-10-23T09:00:00Z<\/td><td>4<\/td>/u,
        );
      }
    },
  },
  {
    ...BASELINE_EXPORT,
    tag: "[SR-234/AK-k5g4]",
    name: "the variant comparison shows the degree per view and the requirements whose status differs",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = contentOf(String(files["system/site/variants/index.html"]));
        expect(page).toContain('<h2 id="verification-degree">Verification degree per view</h2>');
        expect(page).toContain('<th scope="row">core</th>');
        expect(page).toContain(`<th scope="row"><a href="../elements/${ID}c1.html">VAR-0000c1</a></th>`);
        expect(page).toContain('<h2 id="differences">Requirements whose verification status differs</h2>');
      }
    },
  },
  {
    ...BASELINE_EXPORT,
    tag: "[SR-234/AK-gzpr]",
    name: "a variant page shows what it adds, replaces and excludes compared with the core, and its degree",
    masks: DATE,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        const page = contentOf(String(files[`system/site/elements/${ID}c1.html`]));
        expect(page).toContain('<h2 id="variant-compared-with-the-core">Compared with the core</h2>');
        expect(page).toContain(
          `<h3 id="variant-added">Adds</h3><ul><li><a href="../elements/${ID}b1.html">SR-0000b1 Show the wind speed</a></li></ul>`,
        );
        expect(page).toContain('<h2 id="variant-verification-degree">Verification degree</h2>');
      }
    },
  },
]);
