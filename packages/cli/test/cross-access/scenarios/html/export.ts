// Cross-access scenarios of html.export, in addition to the default one (cross-access.test.ts).
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
        expect(page).not.toMatch(/<script|<img/u);
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
]);
