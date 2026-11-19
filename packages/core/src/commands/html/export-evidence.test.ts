// html.export, the evidence records at each acceptance criterion (SR-232 AK3) and the open hints above the text
// (SR-232 AK4) of an element's page.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { escapeHtml } from "../../html-export/markdown.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const ID = (tail: string): string => `43043043-0000-4000-8000-0000000000${tail}`;
const R = ID("e5");
/** K2 of the example: excluded in A (c1), no criteria. */
const K2 = ID("a2");

/** The example of SR-043 with acceptance criteria in its metamodel and an evidence location. */
const FILES: Readonly<Record<string, string>> = {
  "reqseq-workspace.yaml":
    "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
    '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
    "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n",
  "metamodel/model.yaml": `reqseq-metamodel: 1
types:
  - { key: need, name: Need, prefix: N, meaning: need, properties: [title] }
  - { key: system-requirement, name: System Requirement, prefix: SR, meaning: requirement, properties: [title, validity, acceptance-criteria] }
  - { key: decision, name: Decision, prefix: D, properties: [title] }
  - { key: variant, name: Variant, prefix: VAR, meaning: variant, properties: [title] }
  - { key: package, name: Package, prefix: PKG, meaning: package, properties: [title] }
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - { key: validity, name: Validity, kind: relation, many: true, target-types: [variant], meaning: validity }
  - { key: acceptance-criteria, name: Acceptance Criteria, kind: text, many: true, meaning: acceptance-criteria }
relations:
  - { key: derives-from, name: Derives from, inverse-name: Derived by, meaning: derivation }
  - { key: replaces, name: Replaces, inverse-name: Replaced by, source-types: [system-requirement], target-types: [system-requirement], meaning: replacement }
  - { key: excludes, name: Excludes, inverse-name: Excluded by, source-types: [variant], target-types: [system-requirement], meaning: exclusion }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: obsolete, name: Obsolete, invalid: true }
`,
  "requirements/SR-0000000000e5.md":
    `---\nid: ${R}\ntype: system-requirement\nstatus: draft\ntitle: Show the wind\n` +
    'acceptance-criteria:\n  - { key: kred, text: "Given wind, then it shows." }\n  - { key: kdas, text: "Given calm, then 0 shows." }\n' +
    "---\n\nThe station shows the wind.\n",
};

/** A Markdown verification record of `element` at `version`. */
const record = (
  element: string,
  version: string,
  fields: {
    result: string;
    date: string;
    variant?: string;
    criteria?: string;
    testCase?: string;
    method?: string;
  },
): string =>
  "---\nreqseq-record: 1\nkind: verification\n" +
  `element: ${element}\nversion: ${version}\nmethod: ${fields.method ?? "test"}\n` +
  (fields.variant === undefined ? "" : `variant: ${ID(fields.variant)}\n`) +
  (fields.criteria === undefined ? "" : `criteria: [${fields.criteria}]\n`) +
  (fields.testCase === undefined ? "" : `test-case: ${fields.testCase}\n`) +
  `item: build-47\nresult: ${fields.result}\ndate: ${fields.date}\n---\n`;

const versionOf = async (workspace: Workspace, id: string): Promise<string> =>
  String(
    ((await invoke("element.get", { ref: id }, { workspace })) as CommandOutput<"element.get">).element
      .version,
  );

/** The content slot of a page, without the icons of its copy buttons. */
const contentOf = (page: string): string =>
  page
    .slice(page.indexOf('<div class="sl-markdown-content">'), page.indexOf("</div><footer"))
    .replace(/<svg[^]*?<\/svg>/gu, "");

describe("html.export shows the evidence records at each acceptance criterion (SR-232 AK3)", () => {
  it("[SR-232/AK-z2fm] lists the records that bear each criterion's status by test case or method, result, date and views, one line for one execution in several views", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-043/example", files: FILES, git: true });
    onTestFinished(() => fixture.cleanup());
    const first = new Workspace(fixture.root);
    const r = await versionOf(first, R);
    const k2 = await versionOf(first, K2);
    await first.close();
    const D = "2026-11-02T10:00:00Z";
    const records: Readonly<Record<string, string>> = {
      // One execution of a test case in the core and in A: one line.
      "evidence/wind-core.md": record(R, r, {
        result: "passed",
        date: D,
        criteria: "kred",
        testCase: "wind shows",
      }),
      "evidence/wind-a.md": record(R, r, {
        result: "passed",
        date: D,
        criteria: "kred",
        testCase: "wind shows",
        variant: "c1",
      }),
      // An older run bears nothing.
      "evidence/wind-old.md": record(R, r, {
        result: "failed",
        date: "2026-11-01T10:00:00Z",
        criteria: "kred",
        testCase: "wind shows",
      }),
      // A result that differs: each view its own line.
      "evidence/calm-core.md": record(R, r, {
        result: "passed",
        date: D,
        criteria: "kdas",
        testCase: "calm",
      }),
      "evidence/calm-b.md": record(R, r, {
        result: "failed",
        date: D,
        criteria: "kdas",
        testCase: "calm",
        variant: "c2",
      }),
      // Without criterion and test case: at each criterion, by its method.
      "evidence/all.md": record(R, r, { result: "passed", date: D, method: "inspection" }),
      // Without criteria: at the requirement.
      "evidence/k2-core.md": record(K2, k2, { result: "passed", date: D }),
      "evidence/k2-b.md": record(K2, k2, { result: "failed", date: D, variant: "c2" }),
    };
    for (const [file, text] of Object.entries(records)) {
      await fixture.write(file, text);
    }
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    await invoke("html.export", { output: "site" }, { workspace });
    const page = contentOf(await fs.readFile(fixture.path(`site/elements/${R}.html`), "utf8"));
    expect(page).toContain(
      "<p>Given wind, then it shows.</p>" +
        '<details class="rq-evidence"><summary>Evidence records (2)</summary><ul>' +
        '<li><code dir="auto">wind shows</code> <span class="rq-legend">test · passed · 2026-11-02T10:00:00Z · core, VAR-0000c1</span></li>' +
        '<li>inspection <span class="rq-legend">passed · 2026-11-02T10:00:00Z · core</span></li></ul></details></li>',
    );
    expect(page).toContain(
      "<p>Given calm, then 0 shows.</p>" +
        '<details class="rq-evidence"><summary>Evidence records (3)</summary><ul>' +
        '<li><code dir="auto">calm</code> <span class="rq-legend">test · failed · 2026-11-02T10:00:00Z · VAR-0000c2</span></li>' +
        '<li><code dir="auto">calm</code> <span class="rq-legend">test · passed · 2026-11-02T10:00:00Z · core</span></li>' +
        '<li>inspection <span class="rq-legend">passed · 2026-11-02T10:00:00Z · core</span></li></ul></details></li>',
    );
    expect(page).not.toContain("2026-11-01");
    expect(page).not.toContain('id="evidence-records"');
    const k2Page = contentOf(await fs.readFile(fixture.path(`site/elements/${K2}.html`), "utf8"));
    expect(k2Page).toContain(
      '<section class="rq-evidence"><h2 id="evidence-records">Evidence records</h2><ul>' +
        '<li>test <span class="rq-legend">failed · 2026-11-02T10:00:00Z · VAR-0000c2</span></li>' +
        '<li>test <span class="rq-legend">passed · 2026-11-02T10:00:00Z · core</span></li></ul></section>',
    );
    // An element without records shows none.
    const k1Page = contentOf(await fs.readFile(fixture.path(`site/elements/${ID("a1")}.html`), "utf8"));
    expect(k1Page).not.toContain("rq-evidence");
  });
});

describe("html.export shows the open hints above the text (SR-232 AK4)", () => {
  it("[SR-232/AK-q95d] shows each element's open hints as hint.list gives them for it, above its text", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-026/hints", git: true });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const output = (await invoke(
      "html.export",
      { output: "site" },
      { workspace },
    )) as CommandOutput<"html.export">;
    let withHints = 0;
    for (const { id } of output.exportedElements) {
      const listed = (await invoke("hint.list", { ref: id }, { workspace })) as CommandOutput<"hint.list">;
      const page = contentOf(await fs.readFile(fixture.path(`site/elements/${id}.html`), "utf8"));
      if (listed.hints.length === 0) {
        expect(page).not.toContain("Open hints");
        continue;
      }
      withHints += 1;
      const items = listed.hints.map((hint) => `<li>${escapeHtml(hint.message)}</li>`).join("");
      expect(page).toContain(
        '</dl><aside aria-label="Open hints" class="starlight-aside starlight-aside--caution rq-hints"><p class="starlight-aside__title" aria-hidden="true">Open hints</p>' +
          `<div class="starlight-aside__content"><ul>${items}</ul></div></aside><section class="rq-text">`,
      );
    }
    expect(withHints).toBeGreaterThan(1);
  });
});
