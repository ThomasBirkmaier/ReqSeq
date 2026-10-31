import { describe, expect, it } from "vitest";
import type { ReqifFile } from "./model.js";
import { XHTML_NAMESPACE } from "./model.js";
import type { ReqifParseOutcome } from "./parse.js";
import { MAX_REQIF_BYTES, MAX_REQIF_DEPTH, parseReqif } from "./parse.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const parsed = (outcome: ReqifParseOutcome): Extract<ReqifParseOutcome, { kind: "parsed" }> => {
  if (outcome.kind !== "parsed") {
    throw new Error(`refused: ${outcome.message}`);
  }
  return outcome;
};
const fileOf = (bytes: Uint8Array): ReqifFile => parsed(parseReqif(bytes)).file;
const refusal = (text: string): { message: string; line: number } => {
  const outcome = parseReqif(utf8(text));
  if (outcome.kind !== "refused") {
    throw new Error("parsed");
  }
  return { message: outcome.message, line: outcome.line };
};

const NS = 'xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"';
/** A minimal file with `content` inside REQ-IF-CONTENT. */
const withContent = (content: string, after = ""): string =>
  `<REQ-IF ${NS}><THE-HEADER><REQ-IF-HEADER IDENTIFIER="h"/></THE-HEADER><CORE-CONTENT><REQ-IF-CONTENT>${content}</REQ-IF-CONTENT></CORE-CONTENT>${after}</REQ-IF>`;

describe("parseReqif", () => {
  it("reads header, datatypes, spec types, objects, relations and nested hierarchies, by namespace, not by prefix", () => {
    const def = (kind: string, id: string) =>
      `<r:ATTRIBUTE-DEFINITION-${kind} IDENTIFIER="ad-${id}"><r:TYPE><r:DATATYPE-DEFINITION-${kind}-REF>dt-${id}</r:DATATYPE-DEFINITION-${kind}-REF></r:TYPE></r:ATTRIBUTE-DEFINITION-${kind}>`;
    const val = (kind: string, id: string, value: string) =>
      `<r:ATTRIBUTE-VALUE-${kind} THE-VALUE="${value}"><r:DEFINITION><r:ATTRIBUTE-DEFINITION-${kind}-REF>ad-${id}</r:ATTRIBUTE-DEFINITION-${kind}-REF></r:DEFINITION></r:ATTRIBUTE-VALUE-${kind}>`;
    const kinds = ["STRING", "XHTML", "INTEGER", "REAL", "DATE", "BOOLEAN", "ENUMERATION"];
    const text = [
      '<r:REQ-IF xmlns:r="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"><r:THE-HEADER><r:REQ-IF-HEADER IDENTIFIER="_hd">',
      "<r:COMMENT>c</r:COMMENT><r:CREATION-TIME>2026-10-31T00:00:00Z</r:CREATION-TIME><r:REPOSITORY-ID>repo</r:REPOSITORY-ID>",
      "<r:REQ-IF-TOOL-ID>tool</r:REQ-IF-TOOL-ID><r:REQ-IF-VERSION>1.0</r:REQ-IF-VERSION><r:SOURCE-TOOL-ID>src</r:SOURCE-TOOL-ID><r:TITLE>A</r:TITLE>",
      "</r:REQ-IF-HEADER></r:THE-HEADER><r:CORE-CONTENT><r:REQ-IF-CONTENT><r:DATATYPES>",
      ...kinds.slice(0, 6).map((k) => `<r:DATATYPE-DEFINITION-${k} IDENTIFIER="dt-${k.toLowerCase()}"/>`),
      '<r:DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="dt-enumeration"><r:SPECIFIED-VALUES>',
      '<r:ENUM-VALUE IDENTIFIER="ev-high" LONG-NAME="High"><r:PROPERTIES><r:EMBEDDED-VALUE KEY="1" OTHER-CONTENT="top"/></r:PROPERTIES></r:ENUM-VALUE>',
      "</r:SPECIFIED-VALUES></r:DATATYPE-DEFINITION-ENUMERATION></r:DATATYPES><r:SPEC-TYPES>",
      `<r:SPEC-OBJECT-TYPE IDENTIFIER="ot"><r:SPEC-ATTRIBUTES>${kinds.map((k) => def(k, k.toLowerCase())).join("")}</r:SPEC-ATTRIBUTES></r:SPEC-OBJECT-TYPE>`,
      '<r:SPEC-RELATION-TYPE IDENTIFIER="rt"/><r:SPECIFICATION-TYPE IDENTIFIER="st"/></r:SPEC-TYPES><r:SPEC-OBJECTS>',
      '<r:SPEC-OBJECT IDENTIFIER="o1" LONG-NAME="Start" LAST-CHANGE="2026-10-31T00:00:00Z"><r:VALUES>',
      val("STRING", "string", "A-1 &amp; more"),
      "<r:ATTRIBUTE-VALUE-XHTML><r:DEFINITION><r:ATTRIBUTE-DEFINITION-XHTML-REF>ad-xhtml</r:ATTRIBUTE-DEFINITION-XHTML-REF></r:DEFINITION>",
      '<r:THE-VALUE><div xmlns="http://www.w3.org/1999/xhtml">The system <b>shall</b> <span style="color:red">start</span>.</div></r:THE-VALUE></r:ATTRIBUTE-VALUE-XHTML>',
      val("INTEGER", "integer", "5"),
      val("REAL", "real", "0.5"),
      val("DATE", "date", "2026-11-01T00:00:00Z"),
      val("BOOLEAN", "boolean", "true"),
      "<r:ATTRIBUTE-VALUE-ENUMERATION><r:DEFINITION><r:ATTRIBUTE-DEFINITION-ENUMERATION-REF>ad-enumeration</r:ATTRIBUTE-DEFINITION-ENUMERATION-REF></r:DEFINITION>",
      "<r:VALUES><r:ENUM-VALUE-REF> ev-high </r:ENUM-VALUE-REF></r:VALUES></r:ATTRIBUTE-VALUE-ENUMERATION>",
      "</r:VALUES><r:TYPE><r:SPEC-OBJECT-TYPE-REF>ot</r:SPEC-OBJECT-TYPE-REF></r:TYPE></r:SPEC-OBJECT>",
      '<r:SPEC-OBJECT IDENTIFIER="o2"><r:TYPE><r:SPEC-OBJECT-TYPE-REF>ot</r:SPEC-OBJECT-TYPE-REF></r:TYPE></r:SPEC-OBJECT></r:SPEC-OBJECTS>',
      '<r:SPEC-RELATIONS><r:SPEC-RELATION IDENTIFIER="rel"><r:SOURCE><r:SPEC-OBJECT-REF>o2</r:SPEC-OBJECT-REF></r:SOURCE>',
      "<r:TARGET><r:SPEC-OBJECT-REF>o1</r:SPEC-OBJECT-REF></r:TARGET><r:TYPE><r:SPEC-RELATION-TYPE-REF>rt</r:SPEC-RELATION-TYPE-REF></r:TYPE></r:SPEC-RELATION></r:SPEC-RELATIONS>",
      '<r:SPECIFICATIONS><r:SPECIFICATION IDENTIFIER="s" LONG-NAME="Requirements"><r:TYPE><r:SPECIFICATION-TYPE-REF>st</r:SPECIFICATION-TYPE-REF></r:TYPE><r:CHILDREN>',
      '<r:SPEC-HIERARCHY IDENTIFIER="h1"><r:OBJECT><r:SPEC-OBJECT-REF>o1</r:SPEC-OBJECT-REF></r:OBJECT><r:CHILDREN>',
      '<r:SPEC-HIERARCHY IDENTIFIER="h2"><r:OBJECT><r:SPEC-OBJECT-REF>o2</r:SPEC-OBJECT-REF></r:OBJECT></r:SPEC-HIERARCHY>',
      "</r:CHILDREN></r:SPEC-HIERARCHY></r:CHILDREN></r:SPECIFICATION></r:SPECIFICATIONS>",
      '<r:SPEC-RELATION-GROUPS><r:RELATION-GROUP IDENTIFIER="g"/></r:SPEC-RELATION-GROUPS></r:REQ-IF-CONTENT></r:CORE-CONTENT>',
      "<r:TOOL-EXTENSIONS><r:REQ-IF-TOOL-EXTENSION/></r:TOOL-EXTENSIONS></r:REQ-IF>",
    ].join("\n");
    const file = fileOf(utf8(text));
    expect(file.header).toEqual({
      identifier: "_hd",
      title: "A",
      comment: "c",
      creationTime: "2026-10-31T00:00:00Z",
      repositoryId: "repo",
      toolId: "tool",
      sourceToolId: "src",
      version: "1.0",
    });
    expect(file.datatypes.map((d) => d.kind)).toEqual(kinds.map((k) => k.toLowerCase()));
    expect(file.datatypes[6]?.values).toEqual([
      { identifier: "ev-high", longName: "High", line: 12, key: "1", otherContent: "top" },
    ]);
    expect(
      file.specTypes.map((t) => [t.identifier, t.category, t.attributes.map((a) => a.datatype)]),
    ).toEqual([
      ["ot", "spec-object", kinds.map((k) => `dt-${k.toLowerCase()}`)],
      ["rt", "spec-relation", []],
      ["st", "specification", []],
    ]);
    const ns = { namespace: XHTML_NAMESPACE, attributes: {} };
    expect(file.specObjects[0]).toEqual({
      identifier: "o1",
      longName: "Start",
      lastChange: "2026-10-31T00:00:00Z",
      line: 16,
      type: "ot",
      values: [
        { kind: "string", definition: "ad-string", value: "A-1 & more" },
        {
          kind: "xhtml",
          definition: "ad-xhtml",
          value: [
            {
              name: "div",
              ...ns,
              children: [
                "The system ",
                { name: "b", ...ns, children: ["shall"] },
                " ",
                {
                  name: "span",
                  namespace: XHTML_NAMESPACE,
                  attributes: { style: "color:red" },
                  children: ["start"],
                },
                ".",
              ],
            },
          ],
        },
        { kind: "integer", definition: "ad-integer", value: "5" },
        { kind: "real", definition: "ad-real", value: "0.5" },
        { kind: "date", definition: "ad-date", value: "2026-11-01T00:00:00Z" },
        { kind: "boolean", definition: "ad-boolean", value: "true" },
        { kind: "enumeration", definition: "ad-enumeration", values: ["ev-high"] },
      ],
    });
    expect(file.specObjects[1]).toMatchObject({ identifier: "o2", values: [] });
    expect(file.specRelations).toMatchObject([
      { identifier: "rel", type: "rt", source: "o2", target: "o1", values: [] },
    ]);
    expect(file.specifications).toMatchObject([
      {
        identifier: "s",
        longName: "Requirements",
        type: "st",
        values: [],
        children: [
          { identifier: "h1", object: "o1", children: [{ identifier: "h2", object: "o2", children: [] }] },
        ],
      },
    ]);
    expect(file.unread).toEqual([
      { name: "RELATION-GROUP", line: 34 },
      { name: "REQ-IF-TOOL-EXTENSION", line: 35 },
    ]);
  });

  it("refuses doctype, an undefined entity, a foreign root, truncated, two roots and too deep input with the reason and line", () => {
    expect(refusal('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><REQ-IF/>').message).toBe(
      "A document type declaration (<!DOCTYPE) is not read",
    );
    expect(refusal(`<REQ-IF ${NS}>&nbsp;</REQ-IF>`).message).toMatch(/nbsp/);
    expect(refusal("<REQ-IF/>")).toEqual({
      message: "The root element is <REQ-IF> in no namespace, not <REQ-IF> of ReqIF 1.2",
      line: 1,
    });
    expect(refusal('<a xmlns="urn:x"/>').message).toBe(
      "The root element is <a> in urn:x, not <REQ-IF> of ReqIF 1.2",
    );
    expect(refusal(`<REQ-IF ${NS}>\n<THE-HEADER>`)).toMatchObject({ line: 2 });
    expect(refusal(`<REQ-IF ${NS}/><REQ-IF ${NS}/>`).message).toBe("A second root element");
    expect(refusal("<x:REQ-IF/>").message).toBe("Element <x:REQ-IF> has an undeclared prefix");
    const deep = `${"<a>".repeat(MAX_REQIF_DEPTH)}${"</a>".repeat(MAX_REQIF_DEPTH)}`;
    expect(refusal(withContent(deep)).message).toBe(
      `The file nests elements deeper than ${String(MAX_REQIF_DEPTH)} levels`,
    );
  });

  it("refuses a file over the size guard before reading it", () => {
    const bytes = new Uint8Array(MAX_REQIF_BYTES + 1);
    expect(parseReqif(bytes)).toEqual({
      kind: "refused",
      message: `The file has ${String(MAX_REQIF_BYTES + 1)} bytes; ReqSeq reads ReqIF files up to ${String(MAX_REQIF_BYTES)} bytes`,
      line: 1,
    });
  });

  it("refuses missing parts, a missing IDENTIFIER and a missing THE-VALUE", () => {
    expect(refusal(`<REQ-IF ${NS}><THE-HEADER/></REQ-IF>`).message).toBe("<REQ-IF> has no <CORE-CONTENT>");
    expect(
      refusal(
        `<REQ-IF ${NS}><THE-HEADER><REQ-IF-HEADER/></THE-HEADER><CORE-CONTENT><REQ-IF-CONTENT/></CORE-CONTENT></REQ-IF>`,
      ).message,
    ).toBe("<REQ-IF-HEADER> has no IDENTIFIER");
    expect(refusal(withContent('<SPEC-OBJECTS><SPEC-OBJECT IDENTIFIER="o"/></SPEC-OBJECTS>')).message).toBe(
      "<SPEC-OBJECT> has no <TYPE>",
    );
    const value = (attributes: string) =>
      withContent(
        `<SPEC-OBJECTS><SPEC-OBJECT IDENTIFIER="o"><VALUES><ATTRIBUTE-VALUE-STRING${attributes}><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>a</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING></VALUES><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT></SPEC-OBJECTS>`,
      );
    expect(refusal(value("")).message).toBe("<ATTRIBUTE-VALUE-STRING> has no THE-VALUE");
    expect(parsed(parseReqif(utf8(value(' THE-VALUE=""')))).file.specObjects[0]?.values).toEqual([
      { kind: "string", definition: "a", value: "" },
    ]);
  });

  it("keeps a reference the file does not define as written", () => {
    const text = withContent(
      [
        '<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="t"><SPEC-ATTRIBUTES><ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="a" MULTI-VALUED="true"><TYPE><DATATYPE-DEFINITION-ENUMERATION-REF>dt</DATATYPE-DEFINITION-ENUMERATION-REF></TYPE></ATTRIBUTE-DEFINITION-ENUMERATION></SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE></SPEC-TYPES>',
        '<SPEC-OBJECTS><SPEC-OBJECT IDENTIFIER="o"><VALUES><ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>a</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION><VALUES><ENUM-VALUE-REF>ev</ENUM-VALUE-REF></VALUES></ATTRIBUTE-VALUE-ENUMERATION></VALUES><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT></SPEC-OBJECTS>',
        '<SPEC-RELATIONS><SPEC-RELATION IDENTIFIER="r"><VALUES><ATTRIBUTE-VALUE-INTEGER THE-VALUE="1"><DEFINITION><ATTRIBUTE-DEFINITION-INTEGER-REF>x</ATTRIBUTE-DEFINITION-INTEGER-REF></DEFINITION></ATTRIBUTE-VALUE-INTEGER></VALUES><SOURCE><SPEC-OBJECT-REF>o</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>gone</SPEC-OBJECT-REF></TARGET><TYPE><SPEC-RELATION-TYPE-REF>rt</SPEC-RELATION-TYPE-REF></TYPE></SPEC-RELATION></SPEC-RELATIONS>',
        '<SPECIFICATIONS><SPECIFICATION IDENTIFIER="s"><TYPE><SPECIFICATION-TYPE-REF>st</SPECIFICATION-TYPE-REF></TYPE><CHILDREN><SPEC-HIERARCHY IDENTIFIER="h1"><OBJECT><SPEC-OBJECT-REF>lost</SPEC-OBJECT-REF></OBJECT><CHILDREN><OTHER/></CHILDREN></SPEC-HIERARCHY></CHILDREN></SPECIFICATION></SPECIFICATIONS>',
        "<SPEC-RELATION-GROUPS/><DATATYPES><DATATYPE-DEFINITION-OTHER/></DATATYPES>",
      ].join(""),
    );
    const { file } = parsed(parseReqif(utf8(text)));
    expect(file.specTypes[0]?.attributes[0]).toMatchObject({ datatype: "dt", multiValued: true });
    expect(file.specObjects[0]?.values).toEqual([{ kind: "enumeration", definition: "a", values: ["ev"] }]);
    expect(file.specRelations[0]).toMatchObject({ type: "rt", target: "gone" });
    expect(file.specifications[0]?.children[0]?.object).toBe("lost");
    expect(file.unread.map((u) => u.name)).toEqual(["DATATYPE-DEFINITION-OTHER", "OTHER"]);
  });

  it("leaves out what it does not read, reads optional parts when present and rethrows a programming error", () => {
    const x = 'xmlns:x="urn:x" xmlns:xhtml="http://www.w3.org/1999/xhtml"';
    const text = withContent(
      [
        `<DATATYPES ${x}><DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="dt" DESC="d"><SPECIFIED-VALUES><ENUM-VALUE IDENTIFIER="ev"><PROPERTIES/></ENUM-VALUE><x:ENUM-VALUE/></SPECIFIED-VALUES></DATATYPE-DEFINITION-ENUMERATION><x:DATATYPE-DEFINITION-STRING/></DATATYPES>`,
        `<SPEC-TYPES ${x}><SPEC-OBJECT-TYPE IDENTIFIER="t"><SPEC-ATTRIBUTES><ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="a"><TYPE><DATATYPE-DEFINITION-XHTML-REF>dt</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML><OTHER-DEFINITION/></SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE><x:SPEC-OBJECT-TYPE/><UNKNOWN-TYPE/></SPEC-TYPES>`,
        `<SPEC-OBJECTS ${x}><SPEC-OBJECT IDENTIFIER="o"><VALUES><ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>a</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE> <xhtml:p/></THE-VALUE></ATTRIBUTE-VALUE-XHTML><ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>a</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION></ATTRIBUTE-VALUE-ENUMERATION><x:ATTRIBUTE-VALUE-STRING/></VALUES><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT><OTHER/></SPEC-OBJECTS>`,
        "<SPEC-RELATIONS><OTHER/></SPEC-RELATIONS><SPECIFICATIONS><OTHER/></SPECIFICATIONS>",
      ].join(""),
    );
    const { file } = parsed(parseReqif(utf8(text)));
    expect(file.datatypes).toEqual([
      { identifier: "dt", desc: "d", line: 1, kind: "enumeration", values: [{ identifier: "ev", line: 1 }] },
    ]);
    expect(file.specTypes.map((t) => t.attributes.map((a) => a.identifier))).toEqual([["a"]]);
    expect(file.specObjects[0]?.values).toEqual([
      {
        kind: "xhtml",
        definition: "a",
        value: [" ", { name: "p", namespace: XHTML_NAMESPACE, attributes: {}, children: [] }],
      },
      { kind: "enumeration", definition: "a", values: [] },
    ]);
    expect(file.unread.map((u) => u.name)).toEqual([
      "ENUM-VALUE",
      "DATATYPE-DEFINITION-STRING",
      "OTHER-DEFINITION",
      "SPEC-OBJECT-TYPE",
      "UNKNOWN-TYPE",
      "ATTRIBUTE-VALUE-STRING",
      "OTHER",
      "OTHER",
      "OTHER",
    ]);
    // Not bytes: the scanner's Buffer view fails, which is a programming error, not a refusal.
    expect(() => parseReqif("x" as unknown as Uint8Array)).toThrow(TypeError);
  });
});
