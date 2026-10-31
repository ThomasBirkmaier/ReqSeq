// reqif.import of XHTML text as Markdown (SR-095) on SR-004/one-repository: headings, lists, tables
// and emphasis in the element file (AK1), embedded images copied next to the element (AK2), and
// XHTML without Markdown form in the loss list (AK3).
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Imported = CommandOutput<"reqif.import">;

const xhtml = (attribute: string, body: string): string =>
  `<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>${attribute}</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>${body}</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>`;

/** A delivery of one requirement per entry of `texts`, with the XHTML `text` and an optional `note`. */
const delivery = (texts: readonly { readonly text: string; readonly note?: string }[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    '<THE-HEADER><REQ-IF-HEADER IDENTIFIER="h"/></THE-HEADER><CORE-CONTENT><REQ-IF-CONTENT>',
    '<DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="dt-s"/><DATATYPE-DEFINITION-XHTML IDENTIFIER="dt-x"/></DATATYPES>',
    '<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="ot" LONG-NAME="Requirement"><SPEC-ATTRIBUTES>',
    '<ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="a-text" LONG-NAME="Text"><TYPE><DATATYPE-DEFINITION-XHTML-REF>dt-x</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>',
    '<ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="a-note" LONG-NAME="Note"><TYPE><DATATYPE-DEFINITION-XHTML-REF>dt-x</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>',
    "</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE></SPEC-TYPES><SPEC-OBJECTS>",
    ...texts.map(
      ({ text, note }, i) =>
        `<SPEC-OBJECT IDENTIFIER="R-${String(i + 1)}" LONG-NAME="Requirement ${String(i + 1)}"><VALUES>${xhtml("a-text", text)}${
          note === undefined ? "" : xhtml("a-note", note)
        }</VALUES><TYPE><SPEC-OBJECT-TYPE-REF>ot</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>`,
    ),
    "</SPEC-OBJECTS></REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>",
  ].join("\n");

const MAPPING = [
  "reqseq-reqif-mapping: 1",
  "source: { name: Kunde A }",
  "types: [{ source: Requirement, type: system-requirement }]",
  "attributes:",
  "  - { source: Text, property: text }",
  "  - { source: Note, property: rationale }",
  "",
].join("\n");

const INPUT = { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" };

/** Bytes of two small images. */
const ROSE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const GUST = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);

const open = async (
  reqif: string,
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: { "in/lieferung.reqif": reqif, "reqif/kunde-a.yaml": MAPPING, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const run = async (workspace: Workspace): Promise<Imported> =>
  (await invoke("reqif.import", INPUT, { workspace })) as Imported;

/** The text of the element file `file` (relative to the workspace root), after the frontmatter. */
const textOf = async (fixture: FixtureWorkspace, file: string): Promise<string> => {
  const content = await fs.readFile(fixture.path(file), "utf8");
  return content.slice(content.indexOf("\n---\n", 4) + "\n---\n\n".length);
};

const stem = (file: string): string => path.posix.basename(file, ".md");

describe("reqif.import of XHTML as Markdown (SR-095)", () => {
  it("[SR-095/AK1] writes headings, nested lists, a simple table and emphasis as Markdown into the element file; a table Markdown cannot hold is simplified or listed as a loss", async () => {
    const { fixture, workspace } = await open(
      delivery([
        {
          text:
            "<xhtml:h1>Wind</xhtml:h1><xhtml:h2>Speed</xhtml:h2><xhtml:h3>Gusts</xhtml:h3>" +
            "<xhtml:p>The station <xhtml:strong>shall</xhtml:strong> measure <xhtml:em>gusts</xhtml:em>.</xhtml:p>" +
            "<xhtml:ul><xhtml:li>Speed<xhtml:ol><xhtml:li>Mean</xhtml:li><xhtml:li>Peak</xhtml:li></xhtml:ol></xhtml:li><xhtml:li>Direction</xhtml:li></xhtml:ul>" +
            "<xhtml:table><xhtml:tr><xhtml:th>Value</xhtml:th><xhtml:th>Unit</xhtml:th></xhtml:tr><xhtml:tr><xhtml:td>Speed</xhtml:td><xhtml:td>m/s</xhtml:td></xhtml:tr></xhtml:table>",
        },
        {
          text:
            "<xhtml:table><xhtml:tr><xhtml:th>Value</xhtml:th><xhtml:th>Note</xhtml:th></xhtml:tr>" +
            "<xhtml:tr><xhtml:td>Speed</xhtml:td><xhtml:td><xhtml:p>Mean</xhtml:p><xhtml:p>Peak</xhtml:p></xhtml:td></xhtml:tr>" +
            '<xhtml:tr><xhtml:td rowspan="2">Gust</xhtml:td><xhtml:td colspan="2">3 s</xhtml:td></xhtml:tr></xhtml:table>',
        },
      ]),
    );
    const out = await run(workspace);
    const [simple, complex] = out.files;
    expect(await textOf(fixture, simple ?? "")).toBe(
      [
        "# Wind",
        "",
        "## Speed",
        "",
        "### Gusts",
        "",
        "The station **shall** measure *gusts*.",
        "",
        "- Speed",
        "",
        "  1. Mean",
        "  2. Peak",
        "",
        "- Direction",
        "",
        "| Value | Unit |",
        "| ----- | ---- |",
        "| Speed | m/s  |",
        "",
      ].join("\n"),
    );
    // Paragraphs in a cell become `<br>` without loss; rowspan and colspan keep the text, as losses.
    expect(await textOf(fixture, complex ?? "")).toBe(
      [
        "| Value | Note         |   |",
        "| ----- | ------------ | - |",
        "| Speed | Mean<br>Peak |   |",
        "| Gust  | 3 s          |   |",
        "",
      ].join("\n"),
    );
    const id = out.created[1]?.id;
    expect(out.losses).toEqual([
      {
        identifier: "R-2",
        kind: "spec-object",
        id,
        code: "xhtml-rowspan",
        reason: 'Text: <td rowspan="2">',
      },
      {
        identifier: "R-2",
        kind: "spec-object",
        id,
        code: "xhtml-colspan",
        reason: 'Text: <td colspan="2">',
      },
    ]);
  });

  it("[SR-095/AK2] copies each embedded image next to the element like a pasted image and links the text to it; a missing image is a loss", async () => {
    const { fixture, workspace } = await open(
      delivery([
        {
          text:
            '<xhtml:p>Rose:</xhtml:p><xhtml:object data="img/wind%20rose.png" type="image/png">Wind rose</xhtml:object>' +
            // The same bytes once more, another image of the same name, and a missing one.
            '<xhtml:object data="copy/rose.png" type="image/png">Again</xhtml:object>' +
            '<xhtml:object data="other/wind%20rose.png" type="image/png">Gusts</xhtml:object>' +
            '<xhtml:object data="img/none.png" type="image/png">None</xhtml:object>',
          note: '<xhtml:object data="img/wind%20rose.png" type="image/png">In the rationale</xhtml:object>',
        },
        { text: '<xhtml:p>Elsewhere</xhtml:p><xhtml:object data="../outside.png">Out</xhtml:object>' },
      ]),
      {},
    );
    await fs.mkdir(fixture.path("in/img"), { recursive: true });
    await fs.mkdir(fixture.path("in/copy"), { recursive: true });
    await fs.mkdir(fixture.path("in/other"), { recursive: true });
    await fs.writeFile(fixture.path("in/img/wind rose.png"), ROSE);
    await fs.writeFile(fixture.path("in/copy/rose.png"), ROSE);
    await fs.writeFile(fixture.path("in/other/wind rose.png"), GUST);
    await fs.writeFile(fixture.path("outside.png"), GUST);
    const out = await run(workspace);
    const [first, second] = out.created.map((c) => c.id ?? "");
    const file = out.files[0] ?? "";
    const folder = stem(file);
    expect(out.files).toEqual([
      file,
      out.files[1],
      `Kunde-A/${folder}/wind-rose.png`,
      `Kunde-A/${folder}/wind-rose-2.png`,
    ]);
    expect(await fs.readFile(fixture.path(`Kunde-A/${folder}/wind-rose.png`))).toEqual(ROSE);
    expect(await fs.readFile(fixture.path(`Kunde-A/${folder}/wind-rose-2.png`))).toEqual(GUST);
    expect(await textOf(fixture, file)).toBe(
      [
        "Rose:",
        "",
        `![Wind rose](${folder}/wind-rose.png)![Again](${folder}/wind-rose.png)![Gusts](${folder}/wind-rose-2.png)![None](img/none.png)`,
        "",
      ].join("\n"),
    );
    const got = (await invoke("element.get", { ref: first }, { workspace })) as CommandOutput<"element.get">;
    expect(got.element.properties["rationale"]).toBe(`![In the rationale](${folder}/wind-rose.png)`);
    // The planned version, which relations and the import version take, is the one with the images.
    expect(got.element.properties["import-version"]).toBe(got.element.version);
    expect(out.losses).toEqual([
      {
        identifier: "R-1",
        kind: "spec-object",
        id: first,
        code: "image-missing",
        reason: "Text: the image img/none.png is not next to the ReqIF file",
      },
      {
        identifier: "R-2",
        kind: "spec-object",
        id: second,
        code: "image-outside",
        reason:
          "Text: the image ../outside.png is not below the folder of the ReqIF file, so it is not copied",
      },
    ]);
    await expect(fs.stat(fixture.path(`Kunde-A/${stem(out.files[1] ?? "")}`))).rejects.toThrow();
  });

  it("[SR-095/AK3] lists an XHTML element without Markdown form, such as a colour in style, as a loss and keeps its text", async () => {
    const { fixture, workspace } = await open(
      delivery([
        {
          text: '<xhtml:p>Wind <xhtml:span style="color:red">red</xhtml:span> <xhtml:u>under</xhtml:u></xhtml:p>',
          note: "<xhtml:p>A <xhtml:b>bold</xhtml:b> title</xhtml:p>",
        },
        { text: "<xhtml:p>Calm</xhtml:p>", note: "<xhtml:p>A plain title</xhtml:p>" },
      ]),
      // The note as title, a plain text: it keeps the text only.
      { "reqif/kunde-a.yaml": MAPPING.replace("property: rationale", "property: title") },
    );
    const out = await run(workspace);
    expect(await textOf(fixture, out.files[0] ?? "")).toBe("Wind red under\n");
    expect(out.losses).toEqual([
      expect.objectContaining({
        identifier: "R-1",
        code: "xhtml-style",
        reason: 'Text: <span style="color:red">',
      }),
      expect.objectContaining({
        identifier: "R-1",
        code: "xhtml-element",
        reason: "Text: <u> in http://www.w3.org/1999/xhtml",
      }),
      expect.objectContaining({
        identifier: "R-1",
        code: "xhtml-element",
        reason: "Note: XHTML b has no form in a plain text; its text is kept",
      }),
    ]);
    const got = (await invoke(
      "element.get",
      { ref: out.created[0]?.id ?? "" },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(got.element.title).toBe("A bold title");
  });
});
