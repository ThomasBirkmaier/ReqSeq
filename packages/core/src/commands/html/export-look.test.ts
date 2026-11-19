// html.export (SR-231 AK2, AK4, AK5, AK6, AK9): the look of the docs, formatted texts, references, the footer, and
// that every address of the folder names one of its files.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { InvokedOutput } from "../../catalog.js";
import { DOCS_STYLESHEET } from "../../html-export/docs-theme.generated.js";
import { writeHtmlExport } from "../../html-export/export.js";
import { VENDOR_FOLDER } from "../../html-export/vendor.js";
import { PRODUCT_VERSION } from "../../product.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const OLD = "0b7c6e1a-1111-4222-8333-444455556666";
const SHARED = "5a5a5a5a-1111-4222-8333-000000000001";
const GONE = "9d9d9d9d-1111-4222-8333-000000000002";
const FAR = "7f7f7f7f-1111-4222-8333-0000001a2b3c";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const WORKSPACE_WITH_VAULT =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
  '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
  "metamodel: { repository: system, path: metamodel }\n";

const element = (id: string, title: string, body: string, status = "draft"): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: ${status}\ntitle: ${title}\n---\n\n${body}\n`;

const TEXT = [
  "Speed $v = \\frac{d}{t}$ and a broken $\\frac{1$ one.",
  "",
  "$$",
  "E = \\tfrac{1}{2} m v^2",
  "$$",
  "",
  "```math",
  "\\sqrt{x}",
  "```",
  "",
  "> [!WARNING]",
  "> Check the mast.",
  "",
  "| Range | Unit |",
  "|:--|--:|",
  "| 0–60 | m/s |",
  "",
  "- [x] sensor",
  "- [ ] display",
  "",
  "![mast](img/mast.png)",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Sensor] --> B[Display]",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  '  click A "https://example.org"',
  "```",
  "",
  `See [gusts](reqseq:${GUSTS}?version=n1:0000000000000000), [rain](reqseq:${OLD}), [twin](reqseq:${SHARED}),`,
  `[gone](reqseq:${GONE}) and [far](reqseq:${FAR}?repository=vault), [the site](https://example.org).`,
].join("\n");

const FILES: Readonly<Record<string, string | Uint8Array>> = {
  "reqseq-workspace.yaml": WORKSPACE_WITH_VAULT,
  "requirements/SR-6328cee88fb3.md": element(WIND, "Show wind speed", TEXT),
  "requirements/SR-444455556666.md": element(OLD, "Show rain", "Gone.", "obsolete"),
  "requirements/SR-000000000001.md": element(SHARED, "Twin", "One."),
  "copy/SR-000000000001.md": element(SHARED, "Twin", "Two."),
  "requirements/img/mast.png": PNG,
};

const open = async (options: FixtureOptions = { fixture: "SR-001/two-elements", files: FILES }) => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exported = (workspace: Workspace, output = "site") =>
  invoke("html.export", { output }, { workspace }) as Promise<InvokedOutput<"html.export">>;

/** Every file below `folder`, relative with `/`. */
const filesOf = async (folder: string): Promise<string[]> =>
  (await fs.readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();

const read = (folder: string, file: string): Promise<string> => fs.readFile(path.join(folder, file), "utf8");

describe("html.export looks like the docs (SR-231 AK4)", () => {
  it("[SR-231/AK-q64j] links the docs' stylesheet on every page, with the theme select and the menu of the docs", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace);
    const site = fixture.path("site");
    expect(await read(site, "assets/docs.css")).toBe(DOCS_STYLESHEET);
    for (const [file, up] of [
      ["index.html", ""],
      [`elements/${WIND}.html`, "../"],
    ] as const) {
      const page = await read(site, file);
      expect(page).toContain(`<link rel="stylesheet" href="${up}assets/docs.css">`);
      expect(page).toContain(`<script src="${up}assets/theme.js"></script>\n</head>`);
      expect(page).toMatch(new RegExp(`<script src="${up}assets/reqseq\\.js"></script>\\n`, "u"));
      // Two theme selects (dark, light, auto), as the docs have: in the header and in the menu.
      expect(page.match(/<starlight-theme-select>/gu)).toHaveLength(2);
      expect(page).toContain('<option value="dark"');
      expect(page).toContain('<option value="light"');
      expect(page).toContain('<option value="auto"');
      // The menu button opens the sidebar pane, which the page script makes a popover below 50em.
      expect(page).toMatch(/<button popovertarget="starlight__sidebar" class="sl-menu-button[^"]*"/u);
      expect(page).toContain('<sl-sidebar-pane id="starlight__sidebar"');
    }
    expect(await read(site, "assets/reqseq.js")).toContain('matchMedia("(min-width: 50em)")');
    expect(await read(site, "assets/theme.js")).toContain("prefers-color-scheme: light");
  });
});

describe("html.export formats texts (SR-231 AK5)", () => {
  it("[SR-231/AK-ycws] sets formulas, draws diagrams with the bundled Mermaid, keeps tables, task lists, callouts and image copies, and shows errors with their source", async () => {
    const { fixture, workspace } = await open();
    const output = await exported(workspace);
    const site = fixture.path("site");
    const page = await read(site, `elements/${WIND}.html`);
    // Formulas are set at export time: inline, a `$$` block and a fenced block.
    expect(page.match(/<span class="katex">/gu)?.length).toBe(3);
    expect(page).toContain('<span class="katex-display">');
    expect(page).toContain('<annotation encoding="application/x-tex">\\sqrt{x}</annotation>');
    // A broken formula: its source as code, then the error.
    expect(page).toContain(
      '<code>\\frac{1</code> <span class="rq-render-error"><span class="rq-render-error-label">Error</span> KaTeX parse error:',
    );
    expect(output.problems).toContainEqual(
      expect.objectContaining({
        code: "html.formula-error",
        severity: "warning",
        elementId: WIND,
        message: expect.stringMatching(
          /^Text: a formula with an error is shown as its source: KaTeX parse error/u,
        ) as unknown,
      }),
    );
    // A callout is the docs' aside; tables, task lists and the image copy are formatted.
    expect(page).toContain(
      '<aside aria-label="Warning" class="starlight-aside starlight-aside--caution"><p class="starlight-aside__title" aria-hidden="true">Warning</p><div class="starlight-aside__content">',
    );
    expect(page).toContain("<p>Check the mast.</p>");
    expect(page).toContain('<td align="right">m/s</td>');
    expect(page).toContain('<input type="checkbox" disabled checked> sensor');
    expect(page).toContain(`<img src="../images/${WIND}-0.png" alt="mast">`);
    expect(await fs.readFile(path.join(site, `images/${WIND}-0.png`))).toEqual(PNG);
    // Only the safe diagram is marked for the page script; the risky one stays code without its language.
    expect(page).toContain(
      '<pre class="rq-diagram" data-rq-diagram><code class="language-mermaid">flowchart LR\n  A[Sensor] --&gt; B[Display]</code></pre>',
    );
    expect(page).toContain("<pre><code>flowchart LR\n  click A");
    expect(page.match(/data-rq-diagram/gu)).toHaveLength(1);
    // The library lies once in the folder; the page loads it and KaTeX's stylesheet with its fonts as data: URLs.
    expect(await fs.readFile(path.join(site, "assets/mermaid.js"))).toEqual(
      await fs.readFile(path.join(VENDOR_FOLDER, "mermaid.js")),
    );
    expect(page).toContain('<script src="../assets/mermaid.js"></script>');
    expect(page).toContain('<link rel="stylesheet" href="../assets/katex.css">');
    const katex = await read(site, "assets/katex.css");
    expect(katex).toContain("url(data:font/woff2;base64,");
    expect(katex).not.toMatch(/\.woff\)|\.ttf\)/u);
    expect(page).toContain("font-src 'self' data:");
    expect(page).toContain("style-src 'self' 'unsafe-inline'");
    // A page without formulas or diagrams loads neither, and its policy stays as strict as before.
    const plain = await read(site, `elements/${GUSTS}.html`);
    expect(plain).not.toMatch(
      /katex\.css|mermaid\.js|style-src 'self' 'unsafe-inline'|font-src 'self' data:/u,
    );
    expect(plain).toContain("style-src 'self'; style-src-attr 'unsafe-inline'");
  });

  it("[SR-231/AK-ycws] writes neither KaTeX's stylesheet nor Mermaid when no text needs them", async () => {
    const { fixture, workspace } = await open({ fixture: "SR-001/two-elements" });
    await exported(workspace);
    const files = await filesOf(fixture.path("site"));
    expect(files).not.toContain("assets/katex.css");
    expect(files).not.toContain("assets/mermaid.js");
  });
});

describe("html.export links references (SR-231 AK6)", () => {
  it("[SR-231/AK-wkbf] links a reference to the page of its target, and gives the link text alone or with UNKNOWN for the others", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace);
    const page = await read(fixture.path("site"), `elements/${WIND}.html`);
    expect(page).toContain(
      `See <a href="../elements/${GUSTS}.html">gusts</a>, rain, twin,\ngone and far (UNKNOWN-1a2b3c, repository vault, not accessible), <a href="https://example.org" rel="noopener noreferrer">the site</a>.`,
    );
  });
});

describe("html.export names commit and date in the footer (SR-231 AK9)", () => {
  it("[SR-231/AK-hmbc] names the commit of the main repository, -dirty after a change and the date, and asks for noindex", async () => {
    const { fixture, workspace } = await open({ fixture: "SR-001/two-elements", git: true });
    const commit = (await fixture.git(["rev-parse", "HEAD"])).trim();
    await exported(workspace);
    const footer = `Commit ${commit.slice(0, 12)} · exported `;
    for (const file of ["index.html", `elements/${WIND}.html`]) {
      const page = await read(fixture.path("site"), file);
      expect(page).toMatch(
        new RegExp(
          `<span class="rq-footer">${footer}\\d{4}-\\d{2}-\\d{2} with ReqSeq ${PRODUCT_VERSION.replaceAll(".", "\\.")}</span>`,
          "u",
        ),
      );
      expect(page).toContain('<meta name="robots" content="noindex">');
    }
    await fixture.write("requirements/SR-6328cee88fb3.md", element(WIND, "Show wind speed", "Changed."));
    const again = new Workspace(fixture.root);
    onTestFinished(() => again.close());
    await writeHtmlExport(again, fixture.path("site"), { now: () => new Date("2026-03-04T23:30:00Z") });
    expect(await read(fixture.path("site"), "index.html")).toContain(
      `Commit ${commit.slice(0, 12)}-dirty · exported 2026-03-04 with ReqSeq ${PRODUCT_VERSION}`,
    );
  });

  it("[SR-231/AK-hmbc] says no commit without Git", async () => {
    const { fixture, workspace } = await open({ fixture: "SR-001/two-elements" });
    await exported(workspace);
    expect(await read(fixture.path("site"), "index.html")).toMatch(
      />no commit · exported \d{4}-\d{2}-\d{2} with ReqSeq/u,
    );
  });
});

describe("html.export keeps every address in the folder (SR-231 AK2)", () => {
  it("[SR-231/AK-f39g] names a file of the folder in every link, script, stylesheet, image and CSS url(), or a data: URL", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace);
    const site = fixture.path("site");
    const files = new Set(await filesOf(site));
    const checked: string[] = [];
    for (const file of files) {
      if (!/\.(?:html|css)$/u.test(file)) {
        continue;
      }
      const text = await read(site, file);
      const addresses = [
        ...[...text.matchAll(/\s(?:href|src)="([^"]*)"/gu)].map((m) => String(m[1])),
        ...[...text.matchAll(/url\(\s*["']?([^"')]*)/gu)].map((m) => String(m[1])),
      ];
      for (const address of addresses) {
        // A link of the content to the web is a link the reader follows, not a request of the page.
        if (address.startsWith("data:") || address.startsWith("#") || /^(?:https?|mailto):/u.test(address)) {
          continue;
        }
        expect(address, `${file}: ${address}`).not.toMatch(/^[a-z][a-z0-9+.-]*:|^\/|\/$/iu);
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), address));
        expect(files.has(target), `${file}: ${address}`).toBe(true);
        checked.push(target);
      }
      // Nothing the page loads by itself comes from the network.
      expect(text).not.toMatch(/\ssrc="[a-z]+:(?!image\/)|<link[^>]*\shref="[a-z]+:/u);
    }
    expect(new Set(checked)).toEqual(
      new Set([
        "index.html",
        `elements/${GUSTS}.html`,
        `elements/${WIND}.html`,
        `images/${WIND}-0.png`,
        "assets/copy.js",
        "assets/docs.css",
        "assets/reqseq.css",
        "assets/katex.css",
        "assets/theme.js",
        "assets/reqseq.js",
        "assets/mermaid.js",
      ]),
    );
  });
});
