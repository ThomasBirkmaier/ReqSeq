import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReqifFile, XhtmlElement, XhtmlNode } from "./model.js";
import { XHTML_NAMESPACE } from "./model.js";
import { parseReqif } from "./parse.js";
import type { ReqifWritable, ReqifWriteOutcome, ReqifWriteProblem } from "./write.js";
import { writeReqif } from "./write.js";
import { markdownToXhtml } from "./xhtml-markdown.js";

const SAMPLES = new URL("../../../../toolchain/reqif/samples/", import.meta.url);
const T = "2026-10-31T12:00:00Z";

const parsedFile = (bytes: Uint8Array): ReqifFile => {
  const outcome = parseReqif(bytes);
  if (outcome.kind !== "parsed") {
    throw new Error(`${outcome.message} (line ${String(outcome.line)})`);
  }
  return outcome.file;
};
/** The entry `index` of `list`; a test fixture always has it. */
const at = <T>(list: readonly T[], index: number): T => {
  const item = list[index];
  if (item === undefined) {
    throw new Error(`no entry ${String(index)}`);
  }
  return item;
};
const xmlOf = (outcome: ReqifWriteOutcome): string => {
  if (outcome.kind !== "written") {
    throw new Error(JSON.stringify(outcome.problems));
  }
  return outcome.xml;
};
const problemsOf = (outcome: ReqifWriteOutcome): readonly ReqifWriteProblem[] =>
  outcome.kind === "refused" ? outcome.problems : [];
/** The model without lines and `unread`, to compare a round trip. */
const unlined = (file: object): unknown =>
  JSON.parse(
    JSON.stringify({ ...file, unread: undefined }, (key, value: unknown) =>
      key === "line" ? undefined : value,
    ),
  );
const roundTrip = (file: ReqifWritable): ReqifFile =>
  parsedFile(new TextEncoder().encode(xmlOf(writeReqif(file))));
const xhtml = (
  name: string,
  children: readonly XhtmlNode[],
  attributes: readonly string[] = [],
): XhtmlElement => ({
  name,
  namespace: XHTML_NAMESPACE,
  attributes,
  children,
});

/** A file in the shape of the export (ADR-0013): its IDs, both round-trip channels, every kind. */
const exportShaped = (): ReqifWritable => {
  const id = "_6f1c2a54-9a8e-4e55-8f8c-0d7d6c3f9b11";
  const stub = "_0b1f7f2e-2c1a-4a8e-9d55-3e0c5a6b7c8d";
  return {
    header: {
      identifier: "_hd-1a2b",
      title: "Workspace",
      creationTime: T,
      toolId: "reqseq",
      sourceToolId: "ReqSeq 0.6.0",
      version: "1.0",
    },
    datatypes: [
      { identifier: "_dt-string", lastChange: T, kind: "string", maxLength: "27", values: [] },
      { identifier: "_dt-xhtml", lastChange: T, kind: "xhtml", values: [] },
      {
        identifier: "_dt-real",
        lastChange: T,
        kind: "real",
        min: "-1.7976931348623157E308",
        max: "1.7976931348623157E308",
        accuracy: "15",
        values: [],
      },
      { identifier: "_dt-date", lastChange: T, kind: "date", values: [] },
      {
        identifier: "_dt-enum.priority",
        lastChange: T,
        kind: "enumeration",
        values: [
          { identifier: "_ev-priority.high", lastChange: T, longName: "high", key: "0", otherContent: "" },
          { identifier: "_ev-priority.low", lastChange: T, longName: "low", key: "1", otherContent: "" },
        ],
      },
    ],
    specTypes: [
      {
        identifier: "_ot-requirement",
        lastChange: T,
        longName: "requirement",
        category: "spec-object",
        attributes: [
          {
            identifier: "_ad-requirement.title",
            lastChange: T,
            kind: "string",
            datatype: "_dt-string",
            multiValued: false,
          },
          {
            identifier: "_ad-requirement.text",
            lastChange: T,
            kind: "xhtml",
            datatype: "_dt-xhtml",
            multiValued: false,
          },
          {
            identifier: "_ad-requirement.weight",
            lastChange: T,
            kind: "real",
            datatype: "_dt-real",
            multiValued: false,
          },
          {
            identifier: "_ad-requirement.due",
            lastChange: T,
            kind: "date",
            datatype: "_dt-date",
            multiValued: false,
          },
          {
            identifier: "_ad-requirement.priority",
            lastChange: T,
            kind: "enumeration",
            datatype: "_dt-enum.priority",
            multiValued: true,
            defaultValue: {
              kind: "enumeration",
              definition: "_ad-requirement.priority",
              values: ["_ev-priority.low"],
            },
          },
          {
            identifier: "_rq-requirement.markdown",
            lastChange: T,
            kind: "string",
            datatype: "_dt-string",
            multiValued: false,
          },
          {
            identifier: "_rq-requirement.values",
            lastChange: T,
            kind: "string",
            datatype: "_dt-string",
            multiValued: false,
          },
        ],
      },
      { identifier: "_rt-refines", lastChange: T, category: "spec-relation", attributes: [] },
      { identifier: "_st-specification", lastChange: T, category: "specification", attributes: [] },
    ],
    specObjects: [
      {
        identifier: id,
        lastChange: T,
        longName: 'Start <fast> & "safe"',
        type: "_ot-requirement",
        values: [
          { kind: "string", definition: "_ad-requirement.title", value: "Start" },
          {
            kind: "xhtml",
            definition: "_ad-requirement.text",
            value: [
              xhtml("div", [
                xhtml("p", ["a < b & c\r\nnext"]),
                xhtml("object", ["Sketch"], ["data", "start-images/sr-1/sketch.png", "type", "image/png"]),
              ]),
            ],
          },
          { kind: "real", definition: "_ad-requirement.weight", value: "0.5" },
          { kind: "date", definition: "_ad-requirement.due", value: "2026-11-01T00:00:00Z" },
          {
            kind: "enumeration",
            definition: "_ad-requirement.priority",
            values: ["_ev-priority.high", "_ev-priority.low"],
          },
          { kind: "string", definition: "_rq-requirement.markdown", value: 'a\tb\nc "q" & <x>\r' },
          { kind: "string", definition: "_rq-requirement.values", value: '{"status":"draft"}' },
        ],
      },
      { identifier: stub, lastChange: T, type: "_ot-requirement", values: [] },
    ],
    specRelations: [],
    specifications: [
      {
        identifier: "_sp-9f8e",
        lastChange: T,
        type: "_st-specification",
        values: [],
        children: [
          { identifier: `_sh-${id.slice(1)}`, lastChange: T, object: id, children: [] },
          { identifier: `_sh-${stub.slice(1)}`, lastChange: T, object: stub, children: [] },
        ],
      },
    ],
  };
};

describe("writeReqif", () => {
  it("writes every hand-written sample so that it reads back as the same model", () => {
    for (const name of ["basic.reqif", "xhtml-rich.reqif"]) {
      const file = parsedFile(fs.readFileSync(new URL(name, SAMPLES)));
      expect(unlined(roundTrip(file)), name).toEqual(unlined(file));
    }
  });

  it("writes a file in the export's shape that reads back exactly, the same bytes for the same model", () => {
    const file = exportShaped();
    const written = xmlOf(writeReqif(file));
    expect(written).toBe(xmlOf(writeReqif(exportShaped())));
    expect(written.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<REQ-IF xmlns=')).toBe(true);
    expect(written).not.toContain("\r");
    expect(written).toContain("<REQ-IF-VERSION>1.0</REQ-IF-VERSION>");
    expect(written).toContain("<SPEC-RELATIONS>\n      </SPEC-RELATIONS>");
    expect(written).toContain('MULTI-VALUED="true"');
    expect(unlined(roundTrip(file))).toEqual(unlined(file));
  });

  it("escapes text and attribute values, CR in text too, and writes XHTML with the xhtml prefix", () => {
    const written = xmlOf(writeReqif(exportShaped()));
    expect(written).toContain('LONG-NAME="Start &lt;fast> &amp; &quot;safe&quot;"');
    expect(written).toContain('THE-VALUE="a&#9;b&#10;c &quot;q&quot; &amp; &lt;x>&#13;"');
    expect(written).toContain(
      '<THE-VALUE><xhtml:div><xhtml:p>a &lt; b &amp; c&#13;\nnext</xhtml:p><xhtml:object data="start-images/sr-1/sketch.png" type="image/png">Sketch</xhtml:object></xhtml:div></THE-VALUE>',
    );
  });

  it("writes the XHTML of markdownToXhtml as it is", () => {
    const { value } = markdownToXhtml("# Start\n\n- *one*\n\n![a](x.png)");
    const file = exportShaped();
    const object = at(file.specObjects, 0);
    const withText: ReqifWritable = {
      ...file,
      specObjects: [
        { ...object, values: [{ kind: "xhtml", definition: "_ad-requirement.text", value: [value] }] },
      ],
    };
    expect(xmlOf(writeReqif(withText))).toContain(
      '<THE-VALUE><xhtml:div><xhtml:h1>Start</xhtml:h1><xhtml:ul><xhtml:li><xhtml:em>one</xhtml:em></xhtml:li></xhtml:ul><xhtml:p><xhtml:object data="x.png" type="image/png">a</xhtml:object></xhtml:p></xhtml:div></THE-VALUE>',
    );
    expect(roundTrip(withText).specObjects[0]?.values).toEqual(withText.specObjects[0]?.values);
  });

  it("refuses a model without a field the schema makes mandatory and names each one", () => {
    const file = exportShaped();
    const date = at(file.datatypes, 3);
    const outcome = writeReqif({
      ...file,
      header: { identifier: "_hd-1a2b" },
      datatypes: [
        { identifier: "_dt-string", lastChange: T, kind: "string", values: [] },
        { identifier: "_dt-xhtml", kind: "xhtml", values: [] },
        { identifier: "_dt-real", lastChange: T, kind: "real", values: [] },
        date,
        {
          identifier: "_dt-enum.x",
          lastChange: T,
          kind: "enumeration",
          values: [{ identifier: "_ev-x", lastChange: T }],
        },
        { identifier: "_dt-integer", lastChange: T, kind: "integer", values: [] },
      ],
    });
    expect(problemsOf(outcome)).toEqual(
      [
        ["_hd-1a2b", "CREATION-TIME"],
        ["_hd-1a2b", "REQ-IF-TOOL-ID"],
        ["_hd-1a2b", "SOURCE-TOOL-ID"],
        ["_hd-1a2b", "TITLE"],
        ["_dt-string", "MAX-LENGTH"],
        ["_dt-xhtml", "LAST-CHANGE"],
        ["_dt-real", "MIN"],
        ["_dt-real", "MAX"],
        ["_dt-real", "ACCURACY"],
        ["_ev-x", "KEY"],
        ["_ev-x", "OTHER-CONTENT"],
        ["_dt-integer", "MIN"],
        ["_dt-integer", "MAX"],
      ].map(([identifier, field]) => ({ kind: "missing-field", identifier, field })),
    );
  });

  it("refuses characters XML 1.0 cannot carry, in text and in attributes, with their place", () => {
    const file = exportShaped();
    const object = at(file.specObjects, 0);
    const outcome = writeReqif({
      ...file,
      specObjects: [
        {
          ...object,
          longName: "form\ffeed",
          values: [
            { kind: "string", definition: "_rq-requirement.markdown", value: "ok \u{1F600} ￿ \uD800x" },
            {
              kind: "xhtml",
              definition: "_ad-requirement.text",
              value: [xhtml("p", ["a\u000Bb"], ["title", "\u0000"])],
            },
          ],
        },
      ],
    });
    expect(problemsOf(outcome)).toEqual([
      {
        kind: "invalid-character",
        identifier: object.identifier,
        field: "LONG-NAME",
        codePoint: 0x0c,
        offset: 4,
      },
      {
        kind: "invalid-character",
        identifier: object.identifier,
        field: "THE-VALUE",
        codePoint: 0xffff,
        offset: 6,
      },
      {
        kind: "invalid-character",
        identifier: object.identifier,
        field: "THE-VALUE",
        codePoint: 0xd800,
        offset: 8,
      },
      { kind: "invalid-character", identifier: object.identifier, field: "title", codePoint: 0, offset: 0 },
      {
        kind: "invalid-character",
        identifier: object.identifier,
        field: "_ad-requirement.text",
        codePoint: 0x0b,
        offset: 1,
      },
    ]);
  });

  it("refuses an element outside XHTML and a prefixed attribute in a value, and drops namespace declarations", () => {
    const file = exportShaped();
    const object = at(file.specObjects, 0);
    const value = (nodes: readonly XhtmlNode[]): ReqifWritable => ({
      ...file,
      specObjects: [
        { ...object, values: [{ kind: "xhtml", definition: "_ad-requirement.text", value: nodes }] },
      ],
    });
    const outcome = writeReqif(
      value([
        xhtml("div", [
          { name: "q", namespace: "urn:other", attributes: [], children: ["x"] },
          { name: "q", namespace: "", attributes: [], children: [] },
          xhtml("p", [], ["x:a", "1", "xml:lang", "de"]),
        ]),
      ]),
    );
    expect(problemsOf(outcome)).toEqual([
      {
        kind: "unsupported-content",
        identifier: object.identifier,
        field: "_ad-requirement.text",
        name: "<q> in urn:other",
      },
      {
        kind: "unsupported-content",
        identifier: object.identifier,
        field: "_ad-requirement.text",
        name: "<q> in no namespace",
      },
      {
        kind: "unsupported-content",
        identifier: object.identifier,
        field: "_ad-requirement.text",
        name: "x:a",
      },
    ]);
    const declared = xmlOf(
      writeReqif(
        value([xhtml("p", ["y"], ["xmlns", XHTML_NAMESPACE, "xmlns:x", "urn:x", "xml:lang", "de"])]),
      ),
    );
    expect(declared).toContain('<THE-VALUE><xhtml:p xml:lang="de">y</xhtml:p></THE-VALUE>');
  });

  it("writes 20,000 levels of XHTML and of SPEC-HIERARCHY without recursion", () => {
    const depth = 20_000;
    let nested: XhtmlElement = xhtml("div", ["deep"]);
    for (let i = 0; i < depth; i++) {
      nested = xhtml("div", [nested]);
    }
    const file = exportShaped();
    const object = at(file.specObjects, 0);
    const specification = at(file.specifications, 0);
    type Level = ReqifWritable["specifications"][number]["children"][number];
    let level: Level = { identifier: "_sh-0", lastChange: T, object: object.identifier, children: [] };
    for (let i = 1; i < depth; i++) {
      level = {
        identifier: `_sh-${String(i)}`,
        lastChange: T,
        object: object.identifier,
        children: [level],
      };
    }
    const written = xmlOf(
      writeReqif({
        ...file,
        specObjects: [
          { ...object, values: [{ kind: "xhtml", definition: "_ad-requirement.text", value: [nested] }] },
        ],
        specifications: [{ ...specification, children: [level] }],
      }),
    );
    expect(written.split("<xhtml:div>")).toHaveLength(depth + 2);
    expect(written.split("<SPEC-HIERARCHY ")).toHaveLength(depth + 1);
    // Indentation stops at 16 levels.
    expect(written).not.toContain(" ".repeat(34) + "<");
    const back = parsedFile(new TextEncoder().encode(written));
    let read = back.specifications[0]?.children[0];
    let count = 0;
    for (; read !== undefined; read = read.children[0]) {
      count += 1;
    }
    expect(count).toBe(depth);
  });
});
