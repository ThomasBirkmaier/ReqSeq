// html.export, the page of an element (SR-232 AK1, AK2) and the short page of an element that became invalid
// (SR-231 AK8), with the references in acceptance criteria and other Markdown properties (SR-231 AK6).
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { InvokedOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const NEED = "aaaa1111-1111-4111-8111-00000000a001";
const PKG = "aaaa1111-1111-4111-8111-00000000b001";
const COAST = "aaaa1111-1111-4111-8111-00000000c001";
const OLD = "0b7c6e1a-1111-4222-8333-444455556666";
const GONE = "9d9d9d9d-1111-4222-8333-000000000002";
const FAR = "7f7f7f7f-1111-4222-8333-0000001a2b3c";
const V = "version: n1:0000000000000000";

const WORKSPACE =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
  '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
  "metamodel: { repository: system, path: metamodel }\n";

const METAMODEL = `reqseq-metamodel: 1
types:
  - { key: need, name: Need, prefix: N, meaning: need, properties: [title, spec-id, validation-criteria, packages], required: [title] }
  - key: system-requirement
    name: System Requirement
    prefix: SR
    meaning: requirement
    properties: [title, spec-id, rationale, requirement-type, acceptance-criteria, validity, packages]
    required: [title]
  - { key: variant, name: Variant, prefix: VAR, meaning: variant, properties: [title, spec-id], required: [title] }
  - { key: package, name: Package, prefix: PKG, meaning: package, properties: [title, spec-id], required: [title] }
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }
  - { key: rationale, name: Rationale, kind: text, markdown: true }
  - { key: requirement-type, name: Requirement Type, kind: choice, choices: [{ key: functional, name: Functional }] }
  - { key: validation-criteria, name: Validation Criteria, kind: text, many: true }
  - { key: acceptance-criteria, name: Acceptance Criteria, kind: text, many: true, markdown: true, meaning: acceptance-criteria }
  - { key: validity, name: Validity, kind: relation, many: true, target-types: [variant], meaning: validity }
  - { key: packages, name: Package, kind: relation, many: true, target-types: [package], meaning: packages }
relations:
  - { key: derives-from, name: Derives from, meaning: derivation }
  - { key: based-on, name: Based on }
  - { key: supersedes, name: Supersedes, inverse-name: Superseded by, meaning: succession }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: approved, name: Approved }
  - { key: obsolete, name: Obsolete, invalid: true }
`;

const file = (id: string, type: string, front: string, body: string): string =>
  `---\nid: ${id}\ntype: ${type}\n${front}---\n\n${body}\n`;

const windFile = (supersedes: boolean): string =>
  file(
    WIND,
    "system-requirement",
    [
      "status: approved",
      "title: Show wind speed",
      "spec-id: SR-001",
      "requirement-type: functional",
      `rationale: "Pilots ask for [gusts](reqseq:${GUSTS}) and [SR-1a2b3c](reqseq:${FAR}?repository=vault)."`,
      "acceptance-criteria:",
      "  - key: kred",
      `    text: "Given wind, then [SR-1a2b3c](reqseq:${FAR}?repository=vault) and [gusts](reqseq:${GUSTS}) show."`,
      "  - key: kdas",
      `    text: "Given calm, then [](reqseq:${FAR}?repository=vault), [elsewhere](reqseq:${GONE}?repository=nowhere) and [rain](reqseq:${OLD}) show."`,
      "  - Given a criterion without key, then it has no reference.",
      "validity:",
      `  - { id: ${COAST}, ${V}, title: Coast }`,
      "packages:",
      `  - { id: ${PKG}, ${V}, title: Display }`,
      "derives-from:",
      `  - { id: ${NEED}, ${V}, title: See the wind }`,
      "based-on:",
      `  - { id: ${FAR}, ${V}, repository: vault }`,
      `  - { id: ${GONE}, ${V} }`,
      ...(supersedes ? ["supersedes:", `  - { id: ${OLD}, ${V}, title: Show rain }`] : []),
      "",
    ].join("\n"),
    "The station shows the wind speed.",
  );

const oldFile = (status: string): string =>
  file(OLD, "system-requirement", `status: ${status}\ntitle: Show rain\nspec-id: SR-002\n`, "Rain.");

const FILES: Readonly<Record<string, string>> = {
  "reqseq-workspace.yaml": WORKSPACE,
  "metamodel/standard-model.yaml": METAMODEL,
  "requirements/SR-6328cee88fb3.md": windFile(true),
  "requirements/SR-444455556666.md": oldFile("approved"),
  "needs/N-00000000a001.md": file(
    NEED,
    "need",
    "status: approved\ntitle: See the wind\nvalidation-criteria:\n  - Pilots read it.\n",
    "I need to see the wind.",
  ),
  "packages/PKG-00000000b001.md": file(PKG, "package", "title: Display\n", "The display."),
  "variants/VAR-00000000c001.md": file(
    COAST,
    "variant",
    "status: draft\ntitle: Coast\nspec-id: VAR-1\n",
    "Coast.",
  ),
};

const open = async (options: FixtureOptions = { fixture: "SR-001/two-elements", files: FILES }) => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exported = (workspace: Workspace) =>
  invoke("html.export", { output: "site" }, { workspace }) as Promise<InvokedOutput<"html.export">>;

/** The content slot of a page, without the icons of its copy buttons. */
const contentOf = (page: string): string =>
  page
    .slice(page.indexOf('<div class="sl-markdown-content">'), page.indexOf("</div><footer"))
    .replace(/<svg[^]*?<\/svg>/gu, "");

const read = async (fixture: { path: (relative: string) => string }, id: string): Promise<string> =>
  contentOf(await fs.readFile(fixture.path(`site/elements/${id}.html`), "utf8"));

/** A row of the list of fields with its copy button. */
const row = (label: string, html: string, copy: string): string =>
  `<dt>${label}</dt><dd class="rq-copyable"><span class="rq-value">${html}</span><button type="button" class="rq-copy" data-copy="${copy}" aria-label="Copy ${label}" title="Copy ${label}" hidden></button></dd>`;

describe("html.export shows every field of an element (SR-232 AK1)", () => {
  it("[SR-232/AK-cj5d] lists type, identifier, short ID, status, packages and the verification status per view with copy buttons, then text, properties and outgoing relations", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace);
    const wind = await read(fixture, WIND);
    expect(wind).toContain(
      [
        '<dl class="rq-fields">',
        row("Type", "System Requirement", "System Requirement"),
        row("Identifier", "SR-001", "SR-001"),
        row("Short ID", "SR-e88fb3", "SR-e88fb3"),
        row("Status", "approved", "approved"),
        row("Packages", `<a href="../elements/${PKG}.html">PKG-00b001 Display</a>`, "PKG-00b001 Display"),
        row("Repository", "system", "system"),
        // Valid only on the coast: not in the core.
        row("Verification status in the core", "not in the core", "not in the core"),
        row("Verification status in VAR-00c001 (VAR-1)", "open", "open"),
        "</dl>",
      ].join(""),
    );
    // Then the text, after the open hints (SR-232 AK4).
    expect(wind).toContain(
      '</aside><section class="rq-text"><p>The station shows the wind speed.</p></section>',
    );
    // Every other filled property as in the file; a relation property as links.
    expect(wind).toContain(
      `<section class="rq-properties"><h2 id="properties">Properties</h2><dl><dt>Requirement Type</dt><dd><p>functional</p></dd><dt>Rationale</dt><dd><p>Pilots ask for <a href="../elements/${GUSTS}.html">gusts</a> and SR-1a2b3c (UNKNOWN-1a2b3c, repository vault, not accessible).</p></dd><dt>Validity</dt><dd><ul><li><a href="../elements/${COAST}.html">VAR-1 Coast</a></li></ul></dd></dl></section>`,
    );
    // The outgoing relations by relation kind, each target a link to its page where it has one.
    expect(wind).toContain(
      `<section class="rq-relations"><h2 id="relations">Relations</h2><dl><dt>Derives from</dt><dd><ul><li><a href="../elements/${NEED}.html">N-00a001 See the wind</a></li></ul></dd><dt>Based on</dt><dd><ul><li>UNKNOWN-1a2b3c, repository vault, not accessible</li><li>${GONE}, not found</li></ul></dd><dt>Supersedes</dt><dd><ul><li><a href="../elements/${OLD}.html">SR-002 Show rain</a></li></ul></dd></dl></section>`,
    );
    // A core requirement: its status in the core and in each variant; without identifier and package "–"; a
    // property the metamodel does not know by its key.
    const gusts = await read(fixture, GUSTS);
    expect(gusts).toContain(
      row("Identifier", "–", "–") +
        row("Short ID", "SR-4a5b6c", "SR-4a5b6c") +
        row("Status", "draft", "draft") +
        row("Packages", "–", "–"),
    );
    expect(gusts).toContain(
      row("Verification status in the core", "open", "open") +
        row("Verification status in VAR-00c001 (VAR-1)", "open", "open"),
    );
    expect(gusts).toContain("<dt>customer-id</dt><dd><p>815</p></dd>");
    // A need: its validation status, no verification status.
    const need = await read(fixture, NEED);
    expect(need).toContain(row("Validation status", "open", "open"));
    expect(need).not.toContain("Verification status");
    expect(need).toContain("<dt>Validation Criteria</dt><dd><ul><li><p>Pilots read it.</p></li></ul></dd>");
  });

  it("[SR-232/AK-cj5d] shows each filled property of the element file with the value element.get gives, and of a list item with a text only that text", async () => {
    const { fixture, workspace } = await open();
    await fixture.write(
      "requirements/SR-1d2e3f4a5b6c.md",
      file(
        GUSTS,
        "system-requirement",
        [
          "title: Report gusts",
          "customer-id: 00815",
          'order-no: "00815"',
          "notes:",
          "  - { key: abcd, text: First note. }",
          "  - Second note.",
          "empty-value:",
          'empty-text: ""',
          "empty-list: []",
          "",
        ].join("\n"),
        "Gusts.",
      ),
    );
    const shown = (await invoke("element.get", { ref: GUSTS }, { workspace })) as {
      readonly element: { readonly properties: Readonly<Record<string, unknown>> };
    };
    expect(shown.element.properties).toMatchObject({ "customer-id": 815, "order-no": "00815" });
    await exported(workspace);
    const gusts = await read(fixture, GUSTS);
    expect(gusts).toContain(
      '<section class="rq-properties"><h2 id="properties">Properties</h2><dl><dt>customer-id</dt><dd><p>815</p></dd><dt>order-no</dt><dd><p>00815</p></dd><dt>notes</dt><dd><ul><li><p>First note.</p></li><li><p>Second note.</p></li></ul></dd></dl></section>',
    );
    expect(gusts).not.toContain("<dt>empty-");
  });

  it("[SR-232/AK-cj5d] says without status \u2013 and names no repository in a workspace of one", async () => {
    const { fixture, workspace } = await open({ fixture: "SR-001/two-elements" });
    await fixture.write(
      "requirements/SR-6328cee88fb3.md",
      file(WIND, "system-requirement", "title: Show wind speed\n", "No status."),
    );
    await exported(workspace);
    const wind = await read(fixture, WIND);
    expect(wind).toContain(row("Status", "–", "–"));
    expect(wind).not.toContain("<dt>Repository</dt>");
  });
});

describe("html.export shows the acceptance criteria (SR-232 AK2)", () => {
  it("[SR-232/AK-zr5v] gives each criterion its number, key, text and verification status, and a button for its reference where it has one", async () => {
    const { fixture, workspace } = await open({ fixture: "SR-031/criteria" });
    await exported(workspace);
    // Keys: each criterion copies its reference for test names.
    const keyed = await read(fixture, "31313131-0000-4000-8000-3131310000e3");
    expect(keyed).toContain(
      '<li><p class="rq-criterion rq-copyable"><strong>AK1</strong> <code>kred</code> <span class="rq-criterion-status">verified</span><button type="button" class="rq-copy" data-copy="[SR-0000e3/AK-kred]" aria-label="Copy criterion reference [SR-0000e3/AK-kred]" title="Copy criterion reference [SR-0000e3/AK-kred]" hidden></button></p><p>Given a reading, then it shows.</p>',
    );
    expect(keyed).toContain(
      '<strong>AK3</strong> <code>kfro</code> <span class="rq-criterion-status">outdated</span><button type="button" class="rq-copy" data-copy="[SR-0000e3/AK-kfro]"',
    );
    // Without keys: number, text and status, no button.
    const plain = await read(fixture, "31313131-0000-4000-8000-3131310000e4");
    expect(plain).toContain(
      '<li><p class="rq-criterion rq-copyable"><strong>AK1</strong> <span class="rq-criterion-status">verified</span></p><p>',
    );
    expect(plain).toContain('<strong>AK2</strong> <span class="rq-criterion-status">failed</span></p>');
    const open3 = await read(fixture, "31313131-0000-4000-8000-3131310000e1");
    expect(open3).toContain('<strong>AK3</strong> <span class="rq-criterion-status">open</span></p>');
    expect(open3).not.toContain('data-copy="[');
    // Criteria are not repeated among the properties.
    expect(open3).not.toContain("<dt>Acceptance Criteria</dt>");
  });

  it("[SR-232/AK-zr5v] names the view of each status when the requirement applies in variants", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace);
    expect(await read(fixture, GUSTS)).toContain(
      '<strong>AK1</strong> <span class="rq-criterion-status">core: open · VAR-00c001 (VAR-1): open</span></p>',
    );
    expect(await read(fixture, WIND)).toContain(
      '<strong>AK3</strong> <span class="rq-criterion-status">VAR-00c001 (VAR-1): open</span></p>',
    );
  });
});

describe("html.export links references in acceptance criteria and properties (SR-231 AK6)", () => {
  it("[SR-231/AK-wkbf] links a reference in a criterion and in a Markdown property, and gives a short ID, an empty link text and a repository the workspace file does not name as SR-231 AK6 says", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace);
    const wind = await read(fixture, WIND);
    // The link text is the short ID (SR-005 AK3): it stays, the note of SR-006 AK1 follows it.
    expect(wind).toContain(
      `<p>Given wind, then SR-1a2b3c (UNKNOWN-1a2b3c, repository vault, not accessible) and <a href="../elements/${GUSTS}.html">gusts</a> show.</p>`,
    );
    // An empty link text: only the note. A repository the workspace file does not name: the link text without
    // link and without note.
    expect(wind).toContain(
      `<p>Given calm, then  (UNKNOWN-1a2b3c, repository vault, not accessible), elsewhere and <a href="../elements/${OLD}.html">rain</a> show.</p>`,
    );
    expect(wind).toContain(
      `<dt>Rationale</dt><dd><p>Pilots ask for <a href="../elements/${GUSTS}.html">gusts</a> and SR-1a2b3c (UNKNOWN-1a2b3c, repository vault, not accessible).</p></dd>`,
    );
  });
});

describe("html.export gives an element that became invalid a short page (SR-231 AK8)", () => {
  it("[SR-231/AK-q4mj] writes a short page with identifier, title, status and successor where the earlier export had a page, and links references to it", async () => {
    const { fixture, workspace } = await open();
    const first = await exported(workspace);
    expect(first.exportedElements.map((e) => e.id)).toContain(OLD);
    await fixture.write("requirements/SR-444455556666.md", oldFile("obsolete"));
    const again = new Workspace(fixture.root);
    onTestFinished(() => again.close());
    const output = await exported(again);
    // Not in the pages of the output, which the lists and the search are made of.
    expect(output.exportedElements.map((e) => e.id)).not.toContain(OLD);
    expect(output.pages).toBe(first.pages - 1);
    const page = await fs.readFile(fixture.path(`site/elements/${OLD}.html`), "utf8");
    expect(page).toMatch(/<h1 id="_top"[^>]*>SR-002 Show rain<\/h1>/u);
    expect(contentOf(page)).toBe(
      `<div class="sl-markdown-content"><p class="rq-invalid">This element has an invalid status and no page of its own any more.</p><dl class="rq-fields"><dt>Identifier</dt><dd>SR-002</dd><dt>Short ID</dt><dd>SR-556666</dd><dt>Title</dt><dd>Show rain</dd><dt>Status</dt><dd>obsolete</dd></dl><h2 id="successors">Successors</h2><ul><li><a href="../elements/${WIND}.html">SR-001 Show wind speed</a></li></ul>`,
    );
    // A reference to it leads to the short page.
    expect(await read(fixture, WIND)).toContain(`<a href="../elements/${OLD}.html">rain</a>`);
    // Without successor it says so; a page it never had is not written.
    await fixture.write("requirements/SR-6328cee88fb3.md", windFile(false));
    await fixture.write(
      "requirements/SR-0000000000f1.md",
      file(
        "aaaa1111-1111-4111-8111-0000000000f1",
        "system-requirement",
        "status: obsolete\ntitle: Never\n",
        "x",
      ),
    );
    const third = new Workspace(fixture.root);
    onTestFinished(() => third.close());
    await exported(third);
    expect(contentOf(await fs.readFile(fixture.path(`site/elements/${OLD}.html`), "utf8"))).toContain(
      "</dl><p>It has no successor.</p>",
    );
    await expect(
      fs.stat(fixture.path("site/elements/aaaa1111-1111-4111-8111-0000000000f1.html")),
    ).rejects.toThrow();
  });

  it("[SR-231/AK-q4mj] writes no short page for an element that never had a page, and its reference is the link text", async () => {
    const { fixture, workspace } = await open({
      fixture: "SR-001/two-elements",
      files: { ...FILES, "requirements/SR-444455556666.md": oldFile("obsolete") },
    });
    await exported(workspace);
    await expect(fs.stat(fixture.path(`site/elements/${OLD}.html`))).rejects.toThrow();
    expect(await read(fixture, WIND)).toContain(", elsewhere and rain show.</p>");
  });
});
