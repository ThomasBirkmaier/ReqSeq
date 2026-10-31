import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReqifFile, XhtmlElement } from "./model.js";
import { REQIF_NAMESPACE, XHTML_NAMESPACE } from "./model.js";
import type { ReqifLimits, ReqifParseOutcome } from "./parse.js";
import { parseReqif, REQIF_LIMITS } from "./parse.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const SAMPLES = new URL("../../../../toolchain/reqif/samples/", import.meta.url);
const sample = (name: string): Uint8Array => fs.readFileSync(new URL(name, SAMPLES));

const parsed = (outcome: ReqifParseOutcome): Extract<ReqifParseOutcome, { kind: "parsed" }> => {
  if (outcome.kind !== "parsed") {
    throw new Error(`refused: ${outcome.message}`);
  }
  return outcome;
};
const fileOf = (bytes: Uint8Array): ReqifFile => parsed(parseReqif(bytes)).file;
const refusal = (text: string, limits?: ReqifLimits): { message: string; line: number } => {
  const outcome = parseReqif(utf8(text), limits);
  if (outcome.kind !== "refused") {
    throw new Error("parsed");
  }
  return { message: outcome.message, line: outcome.line };
};

const NS = 'xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"';
/** A minimal file with `content` inside REQ-IF-CONTENT. */
const withContent = (content: string, after = ""): string =>
  `<REQ-IF ${NS}><THE-HEADER><REQ-IF-HEADER IDENTIFIER="h"/></THE-HEADER><CORE-CONTENT><REQ-IF-CONTENT>${content}</REQ-IF-CONTENT></CORE-CONTENT>${after}</REQ-IF>`;

/** A file with one SPEC-OBJECT whose XHTML value (prefix `x`) is `xhtml`. */
const object = (xhtml: string, after = ""): string =>
  withContent(
    `<SPEC-OBJECTS xmlns:x="http://www.w3.org/1999/xhtml"><SPEC-OBJECT IDENTIFIER="o"><VALUES><ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>a</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE>${xhtml}</THE-VALUE></ATTRIBUTE-VALUE-XHTML></VALUES><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT></SPEC-OBJECTS>`,
    after,
  );

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
      '<r:SPEC-RELATION-TYPE IDENTIFIER="rt"/><r:SPECIFICATION-TYPE IDENTIFIER="st"/><r:RELATION-GROUP-TYPE IDENTIFIER="gt"/></r:SPEC-TYPES><r:SPEC-OBJECTS>',
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
      ["gt", "relation-group", []],
    ]);
    const ns = { namespace: XHTML_NAMESPACE, attributes: [] };
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
                  attributes: ["style", "color:red"],
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
      { name: "SPEC-RELATION-GROUPS", namespace: REQIF_NAMESPACE, line: 34 },
      { name: "TOOL-EXTENSIONS", namespace: REQIF_NAMESPACE, line: 35 },
    ]);
  });

  it("reads the hand-written samples: basic.reqif with its parts not taken over, xhtml-rich.reqif, bom-crlf.reqif", () => {
    const { file, warnings } = parsed(parseReqif(sample("basic.reqif")));
    expect(warnings).toEqual([]);
    expect(file.header).toMatchObject({ identifier: "_hd-basic", title: "Customer A", version: "1.0" });
    expect(file.datatypes.map((d) => d.kind)).toEqual([
      "string",
      "xhtml",
      "integer",
      "real",
      "date",
      "boolean",
      "enumeration",
    ]);
    expect(
      file.datatypes.slice(0, 4).map(({ maxLength, min, max, accuracy }) => [maxLength, min, max, accuracy]),
    ).toEqual([
      ["10000", undefined, undefined, undefined],
      [undefined, undefined, undefined, undefined],
      [undefined, "0", "1000", undefined],
      [undefined, "0", "100", "2"],
    ]);
    expect(file.datatypes[6]?.values.map((v) => [v.identifier, v.key, v.otherContent])).toEqual([
      ["ev-high", "1", ""],
      ["ev-low", "2", "lowest"],
    ]);
    expect(file.specTypes.map((t) => [t.identifier, t.category, t.attributes.length])).toEqual([
      ["ot-req", "spec-object", 7],
      ["ot-note", "spec-object", 1],
      ["rt-refines", "spec-relation", 0],
      ["gt-links", "relation-group", 0],
      ["st-doc", "specification", 0],
    ]);
    expect(file.specObjects.map((o) => [o.identifier, o.type, o.values.length])).toEqual([
      ["req-1", "ot-req", 7],
      ["req-2", "ot-req", 0],
      ["note-1", "ot-note", 1],
    ]);
    expect(file.specObjects[0]?.values[0]).toEqual({
      kind: "string",
      definition: "ad-id",
      value: "A-1 & more",
    });
    expect(file.specRelations.map((r) => [r.identifier, r.source, r.target])).toEqual([
      ["rel-1", "req-2", "req-1"],
      ["rel-2", "note-1", "req-1"],
    ]);
    expect(file.specifications.map((s) => [s.identifier, s.children.length])).toEqual([
      ["spec-a", 1],
      ["spec-b", 0],
    ]);
    expect(file.specifications[0]?.children).toMatchObject([
      {
        identifier: "sh-1",
        object: "req-1",
        children: [{ identifier: "sh-2", object: "req-2", children: [] }],
      },
    ]);
    const owner = { kind: "spec-object", identifier: "req-1" };
    expect(file.unread).toEqual([
      { name: "ALTERNATIVE-ID", namespace: REQIF_NAMESPACE, line: 74, owner },
      { name: "THE-ORIGINAL-VALUE", namespace: REQIF_NAMESPACE, line: 82, owner },
      { name: "SPEC-RELATION-GROUPS", namespace: REQIF_NAMESPACE, line: 145 },
      { name: "TOOL-EXTENSIONS", namespace: REQIF_NAMESPACE, line: 155 },
    ]);

    const rich = fileOf(sample("xhtml-rich.reqif"));
    const value = rich.specObjects[0]?.values[0];
    const div = (value?.kind === "xhtml" ? value.value[0] : undefined) as XhtmlElement;
    expect(div).toMatchObject({ name: "div", namespace: XHTML_NAMESPACE, attributes: [] });
    const blocks = div.children.filter((child): child is XhtmlElement => typeof child !== "string");
    expect(blocks.map((b) => b.name)).toEqual(["h1", "h2", "h3", "p", "ul", "table", "p"]);
    expect(blocks[3]?.children[5]).toEqual({
      name: "span",
      namespace: XHTML_NAMESPACE,
      attributes: ["style", "color:red"],
      children: ["in red"],
    });
    expect((blocks[6]?.children as XhtmlElement[]).map((o) => o.attributes[1])).toEqual([
      "images/start.png",
      "../outside.png",
      "/etc/hosts.png",
    ]);
    expect(rich.unread).toEqual([{ name: "TOOL-EXTENSIONS", namespace: REQIF_NAMESPACE, line: 46 }]);

    expect(fileOf(sample("bom-crlf.reqif")).header).toEqual({
      identifier: "_hd-crlf",
      creationTime: "2026-10-31T00:00:00Z",
      toolId: "sample-tool",
      version: "1.0",
      sourceToolId: "sample-tool 1",
      title: "Zeile\nzwei",
    });
  });

  it("refuses doctype, an undefined entity, a foreign root, truncated, two roots, undeclared prefixes and names that are not qualified with the reason and line", () => {
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
    expect(refusal("<x:REQ-IF/>").message).toBe("x:REQ-IF in <x:REQ-IF> has an undeclared prefix");
    expect(refusal(`<REQ-IF ${NS} foo:bar="1"/>`).message).toBe(
      "foo:bar in <REQ-IF> has an undeclared prefix",
    );
    expect(refusal(`<REQ-IF ${NS}><:a/></REQ-IF>`).message).toBe(":a in <:a> is not a qualified name");
    expect(refusal(`<REQ-IF ${NS} a:b:c="1"/>`).message).toBe("a:b:c in <REQ-IF> is not a qualified name");
    expect(refusal(withContent("<SPEC-OBJECTS/>\n<SPEC-OBJECTS/>"))).toEqual({
      message: "<SPEC-OBJECTS> appears twice",
      line: 2,
    });
    expect(
      refusal(
        `<REQ-IF ${NS}>${"<THE-HEADER><REQ-IF-HEADER IDENTIFIER='h'/></THE-HEADER>".repeat(2)}</REQ-IF>`,
      ).message,
    ).toBe("<THE-HEADER> appears twice");
    expect(
      refusal(
        withContent(
          '<SPEC-TYPES><SPEC-RELATION-TYPE IDENTIFIER="x"/><SPECIFICATION-TYPE IDENTIFIER="x"/></SPEC-TYPES>',
        ),
      ),
    ).toEqual({ message: "IDENTIFIER x is used twice", line: 1 });
    expect(refusal(`<REQ-IF ${NS} xmlns:y=""/>`).message).toBe(
      "xmlns:y has an empty namespace (Namespaces in XML 1.0)",
    );
  });

  it("refuses a file over the size guard before reading it", () => {
    // 1 GiB: an export of ReqSeq at N-036 is about 300 MB; the retained budget guards the memory.
    expect(REQIF_LIMITS).toEqual({ bytes: 2 ** 30, retained: 2 ** 30 });
    const limits = { ...REQIF_LIMITS, bytes: 1000 };
    expect(parseReqif(new Uint8Array(1001), limits)).toEqual({
      kind: "refused",
      message: "The file has 1001 bytes; ReqSeq reads ReqIF files up to 1000 bytes",
      line: 1,
    });
  });

  it("refuses missing parts, a missing IDENTIFIER and a missing THE-VALUE", () => {
    expect(refusal(`<REQ-IF ${NS}><THE-HEADER/></REQ-IF>`).message).toBe(
      "<THE-HEADER> has no <REQ-IF-HEADER>",
    );
    expect(refusal(`<REQ-IF ${NS}/>`).message).toBe("<REQ-IF> has no <CORE-CONTENT>");
    expect(refusal(`<REQ-IF ${NS}><CORE-CONTENT/></REQ-IF>`).message).toBe(
      "<CORE-CONTENT> has no <REQ-IF-CONTENT>",
    );
    expect(refusal(`<REQ-IF ${NS}><CORE-CONTENT><REQ-IF-CONTENT/></CORE-CONTENT></REQ-IF>`).message).toBe(
      "<REQ-IF> has no <THE-HEADER>",
    );
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
    expect(refusal(withContent("<SPEC-OBJECTS><SPEC-OBJECT/></SPEC-OBJECTS>")).message).toBe(
      "<SPEC-OBJECT> has no IDENTIFIER",
    );
    expect(parsed(parseReqif(utf8(value(' THE-VALUE=""')))).file.specObjects[0]?.values).toEqual([
      { kind: "string", definition: "a", value: "" },
    ]);
  });

  it("warns about every reference the file does not define, keeps it, and gives unread parts their owner", () => {
    const text = withContent(
      [
        '<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="t"><SPEC-ATTRIBUTES><ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="a" MULTI-VALUED=" 1 "><TYPE><DATATYPE-DEFINITION-ENUMERATION-REF>dt</DATATYPE-DEFINITION-ENUMERATION-REF></TYPE></ATTRIBUTE-DEFINITION-ENUMERATION></SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE></SPEC-TYPES>',
        '<SPEC-OBJECTS><SPEC-OBJECT IDENTIFIER="o"><VALUES><ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>a</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION><VALUES><ENUM-VALUE-REF>ev</ENUM-VALUE-REF></VALUES></ATTRIBUTE-VALUE-ENUMERATION></VALUES><TYPE><SPEC-OBJECT-TYPE-REF>t</SPEC-OBJECT-TYPE-REF></TYPE><VALUES/></SPEC-OBJECT></SPEC-OBJECTS>',
        '<SPEC-RELATIONS><SPEC-RELATION IDENTIFIER="r"><VALUES><ATTRIBUTE-VALUE-INTEGER THE-VALUE="1"><DEFINITION><ATTRIBUTE-DEFINITION-INTEGER-REF>x</ATTRIBUTE-DEFINITION-INTEGER-REF></DEFINITION></ATTRIBUTE-VALUE-INTEGER></VALUES><SOURCE><SPEC-OBJECT-REF>o</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>gone</SPEC-OBJECT-REF></TARGET><TYPE><SPEC-RELATION-TYPE-REF>rt</SPEC-RELATION-TYPE-REF></TYPE><x:EXTRA xmlns:x="urn:x"/></SPEC-RELATION></SPEC-RELATIONS>',
        '<SPECIFICATIONS><SPECIFICATION IDENTIFIER="s"><TYPE><SPECIFICATION-TYPE-REF>st</SPECIFICATION-TYPE-REF></TYPE><CHILDREN><SPEC-HIERARCHY IDENTIFIER="h1"><OBJECT><SPEC-OBJECT-REF>lost</SPEC-OBJECT-REF></OBJECT><CHILDREN><OTHER/></CHILDREN></SPEC-HIERARCHY></CHILDREN></SPECIFICATION></SPECIFICATIONS>',
        "<SPEC-RELATION-GROUPS/><DATATYPES><DATATYPE-DEFINITION-OTHER/></DATATYPES>",
      ].join(""),
    );
    const { file, warnings } = parsed(parseReqif(utf8(text)));
    expect(warnings.map((w) => [w.message, w.identifier])).toEqual([
      ["Datatype dt of a is not in the file", "a"],
      ["Enumeration value ev of o is not in the file", "o"],
      ["SPEC-RELATION-TYPE rt of r is not in the file", "r"],
      ["Target gone of r is not in the file", "r"],
      ["Attribute definition x of r is not in the file", "r"],
      ["SPECIFICATION-TYPE st of s is not in the file", "s"],
      ["SPEC-OBJECT lost of h1 is not in the file", "h1"],
    ]);
    expect(file.specTypes[0]?.attributes[0]).toMatchObject({ datatype: "dt", multiValued: true });
    expect(file.specObjects[0]?.values).toEqual([{ kind: "enumeration", definition: "a", values: ["ev"] }]);
    expect(file.specRelations[0]).toMatchObject({ type: "rt", target: "gone" });
    expect(file.specifications[0]?.children[0]?.object).toBe("lost");
    expect(file.unread.map(({ name, namespace, owner }) => [name, namespace, owner])).toEqual([
      ["VALUES", REQIF_NAMESPACE, { kind: "spec-object", identifier: "o" }],
      ["EXTRA", "urn:x", { kind: "spec-relation", identifier: "r" }],
      ["OTHER", REQIF_NAMESPACE, { kind: "specification", identifier: "s" }],
      ["SPEC-RELATION-GROUPS", REQIF_NAMESPACE, undefined],
      ["DATATYPE-DEFINITION-OTHER", REQIF_NAMESPACE, undefined],
    ]);
  });

  it("reads the DEFAULT-VALUE of an attribute definition as a value of that definition, one per definition", () => {
    const definition = (kind: string, id: string, inner: string): string =>
      `<ATTRIBUTE-DEFINITION-${kind} IDENTIFIER="${id}"><TYPE><DATATYPE-DEFINITION-${kind}-REF>dt</DATATYPE-DEFINITION-${kind}-REF></TYPE><DEFAULT-VALUE>${inner}</DEFAULT-VALUE></ATTRIBUTE-DEFINITION-${kind}>`;
    const text = withContent(
      [
        '<DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="dt"/></DATATYPES><SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="t"><SPEC-ATTRIBUTES>',
        // DEFINITION as written names another attribute: the default still belongs to its own.
        definition(
          "STRING",
          "a",
          '<ATTRIBUTE-VALUE-STRING THE-VALUE="first"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>b</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING><ATTRIBUTE-VALUE-STRING THE-VALUE="second"/>',
        ),
        definition(
          "ENUMERATION",
          "b",
          "<NOTE/><ATTRIBUTE-VALUE-ENUMERATION><VALUES><ENUM-VALUE-REF>ev</ENUM-VALUE-REF></VALUES></ATTRIBUTE-VALUE-ENUMERATION>",
        ),
        "</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE></SPEC-TYPES>",
      ].join(""),
    );
    const { file, warnings } = parsed(parseReqif(utf8(text)));
    expect(file.specTypes[0]?.attributes.map((a) => a.defaultValue)).toEqual([
      { kind: "string", definition: "a", value: "first" },
      { kind: "enumeration", definition: "b", values: ["ev"] },
    ]);
    expect(file.unread.map((u) => u.name)).toEqual(["ATTRIBUTE-VALUE-STRING", "NOTE"]);
    expect(warnings.map((w) => w.message)).toEqual(["Enumeration value ev of b is not in the file"]);
  });

  it("reads a SPEC-HIERARCHY 5,000 levels deep without recursion, keeps attribute names as written and refuses ReqIF inside XHTML", () => {
    const levels = 5_000;
    const open = Array.from(
      { length: levels },
      (_, i) =>
        `<SPEC-HIERARCHY IDENTIFIER="h${String(i)}"><OBJECT><SPEC-OBJECT-REF>o</SPEC-OBJECT-REF></OBJECT><CHILDREN>`,
    ).join("");
    const deep = `<SPECIFICATIONS><SPECIFICATION IDENTIFIER="s"><TYPE><SPECIFICATION-TYPE-REF>st</SPECIFICATION-TYPE-REF></TYPE><CHILDREN>${open}${"</CHILDREN></SPEC-HIERARCHY>".repeat(levels)}</CHILDREN></SPECIFICATION></SPECIFICATIONS><y:SPEC-OBJECTS xmlns:y="urn:y"><y:SPEC-OBJECT/></y:SPEC-OBJECTS>`;
    const { file } = parsed(parseReqif(utf8(withContent(deep, "<OTHER-PART/>"))));
    let depth = 0;
    for (let level = file.specifications[0]?.children[0]; level !== undefined; level = level.children[0]) {
      depth++;
    }
    expect(depth).toBe(levels);
    expect(file.unread).toEqual([
      { name: "SPEC-OBJECTS", namespace: "urn:y", line: 1 },
      { name: "OTHER-PART", namespace: REQIF_NAMESPACE, line: 1 },
    ]);
    const xhtml = (inner: string) => object(inner);
    const value = parsed(parseReqif(utf8(xhtml('<x:p x:class="c" __proto__="kept"/>')))).file.specObjects[0]
      ?.values[0];
    expect(value?.kind === "xhtml" && value.value[0]).toMatchObject({
      name: "p",
      attributes: ["x:class", "c", "__proto__", "kept"],
    });
    expect(refusal(xhtml("<x:p><SPEC-OBJECT/></x:p>")).message).toBe(
      "ReqIF element <SPEC-OBJECT> inside XHTML",
    );
  });

  it("reads 20,000 nested namespace declarations in linear time and skips tool extensions without reading them", () => {
    const levels = 20_000;
    const nested = Array.from(
      { length: levels },
      (_, i) => `<x:b xmlns:p${String(i)}="urn:${String(i)}">`,
    ).join("");
    const start = performance.now();
    const outcome = parseReqif(
      utf8(
        object(
          `${nested}${"</x:b>".repeat(levels)}`,
          "<TOOL-EXTENSIONS><REQ-IF-TOOL-EXTENSION><SPEC-HIERARCHY/><THE-VALUE><SPEC-OBJECT/></THE-VALUE></REQ-IF-TOOL-EXTENSION></TOOL-EXTENSIONS>",
        ),
      ),
    );
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(parsed(outcome).file.unread).toEqual([
      { name: "TOOL-EXTENSIONS", namespace: REQIF_NAMESPACE, line: 1 },
    ]);
  });

  it("refuses a file whose kept memory would pass the budget: many XHTML attributes, many unread elements, text split by comments", () => {
    const limits = { bytes: REQIF_LIMITS.bytes, retained: 200_000 };
    const message = "Reading the file would keep more than 200000 bytes in memory";
    expect(refusal(object('<x:b c="1" d="2" e="3" f="4"/>'.repeat(2_000)), limits).message).toBe(message);
    expect(
      refusal(`<REQ-IF ${NS}><CORE-CONTENT>${'<a b=""/>'.repeat(4_000)}</CORE-CONTENT></REQ-IF>`, limits)
        .message,
    ).toBe(message);
    expect(refusal(object(`<x:p>${"a<!---->".repeat(4_000)}</x:p>`), limits).message).toBe(message);
    expect(parsed(parseReqif(utf8(object("<x:p/>")), limits)).file.specObjects).toHaveLength(1);
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
        value: [" ", { name: "p", namespace: XHTML_NAMESPACE, attributes: [], children: [] }],
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
