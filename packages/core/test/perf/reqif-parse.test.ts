// The ReqIF parser in the performance suite (ADR-0011, ADR-0013): a generated delivery at the size of
// N-036, 50,000 SPEC-OBJECTs with about 1 KB of XHTML each and 200,000 SPEC-RELATIONs, parsed once.
// Recorded with time and memory; the 10 s are the target of the plan of #265, not of an SR, so the
// row is not asserted. A second row writes (`write.ts`) a model in the export's shape at the same size,
// both round-trip text channels included, checks the file stays below the parser's byte limit and
// reads it back.
import { measurePeakMemory, memoryIncrease, recordValue } from "@reqseq/testkit";
import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import type { XhtmlElement, XhtmlNode } from "../../src/reqif/model.js";
import { XHTML_NAMESPACE } from "../../src/reqif/model.js";
import { parseReqif, REQIF_LIMITS } from "../../src/reqif/parse.js";
import type { ReqifWritable } from "../../src/reqif/write.js";
import { writeReqif } from "../../src/reqif/write.js";

const OBJECTS = 50_000;
const RELATIONS = 200_000;
const BASIS = "N-036, #265: ReqIF parse of a delivery at 50,000 requirements";
const BASIS_WRITE = "N-036, SR-052 AK3: ReqIF export of 50,000 requirements, read back";

/** One XHTML text of about 1 KB: a heading, a paragraph with emphasis and a list. */
const xhtml = (i: number): string =>
  `<xhtml:div><xhtml:h2>Requirement ${String(i)}</xhtml:h2><xhtml:p>The system <xhtml:strong>shall</xhtml:strong> ${"handle the delivery in time and keep every value as given, ".repeat(12)}</xhtml:p><xhtml:ul><xhtml:li>first</xhtml:li><xhtml:li>second</xhtml:li></xhtml:ul></xhtml:div>`;

const generated = (): Uint8Array => {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    '<THE-HEADER><REQ-IF-HEADER IDENTIFIER="_hd"><TITLE>perf</TITLE></REQ-IF-HEADER></THE-HEADER><CORE-CONTENT><REQ-IF-CONTENT>',
    '<DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="dt-s" MAX-LENGTH="1000"/><DATATYPE-DEFINITION-XHTML IDENTIFIER="dt-x"/></DATATYPES>',
    '<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="ot"><SPEC-ATTRIBUTES>',
    '<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="ad-id"><TYPE><DATATYPE-DEFINITION-STRING-REF>dt-s</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>',
    '<ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="ad-text"><TYPE><DATATYPE-DEFINITION-XHTML-REF>dt-x</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>',
    '</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE><SPEC-RELATION-TYPE IDENTIFIER="rt"/></SPEC-TYPES><SPEC-OBJECTS>',
  ];
  for (let i = 0; i < OBJECTS; i++) {
    parts.push(
      `<SPEC-OBJECT IDENTIFIER="o${String(i)}" LAST-CHANGE="2026-10-31T00:00:00Z" LONG-NAME="Requirement ${String(i)}"><VALUES>`,
      `<ATTRIBUTE-VALUE-STRING THE-VALUE="REQ-${String(i)}"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>ad-id</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>`,
      `<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>ad-text</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE>${xhtml(i)}</THE-VALUE></ATTRIBUTE-VALUE-XHTML>`,
      "</VALUES><TYPE><SPEC-OBJECT-TYPE-REF>ot</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>\n",
    );
  }
  parts.push("</SPEC-OBJECTS><SPEC-RELATIONS>");
  for (let i = 0; i < RELATIONS; i++) {
    parts.push(
      `<SPEC-RELATION IDENTIFIER="r${String(i)}"><SOURCE><SPEC-OBJECT-REF>o${String(i % OBJECTS)}</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>o${String((i * 7 + 1) % OBJECTS)}</SPEC-OBJECT-REF></TARGET><TYPE><SPEC-RELATION-TYPE-REF>rt</SPEC-RELATION-TYPE-REF></TYPE></SPEC-RELATION>\n`,
    );
  }
  parts.push("</SPEC-RELATIONS></REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>\n");
  return new TextEncoder().encode(parts.join(""));
};

describe("ReqIF parse at N-036", () => {
  it("records time and memory of parsing a delivery of 50,000 objects and 200,000 relations", async () => {
    const bytes = generated();
    const peak = await measurePeakMemory(() => parseReqif(bytes));
    const size = `${(bytes.length / 1e6).toFixed(0)} MB`;
    await recordValue(
      `ReqIF parse of ${String(OBJECTS)} objects, ${String(RELATIONS)} relations (${size})`,
      peak.ms,
      {
        basis: BASIS,
        thresholdMs: 10_000,
      },
    );
    await recordValue(`ReqIF parse of ${String(OBJECTS)} objects (${size}): ${memoryIncrease(peak)}`, 0, {
      basis: BASIS,
    });
    expect(peak.result.kind).toBe("parsed");
    if (peak.result.kind === "parsed") {
      expect(peak.result.file.specObjects).toHaveLength(OBJECTS);
      expect(peak.result.file.specRelations).toHaveLength(RELATIONS);
      expect(peak.result.warnings).toEqual([]);
    }
  });

  it("writes an export-shaped file of 50,000 objects and 200,000 relations below the parser's limit and reads it back", async () => {
    const model = exportShaped();
    const peak = await measurePeakMemory(() => writeReqif(model));
    if (peak.result.kind !== "written") {
      throw new Error(JSON.stringify(peak.result.problems.slice(0, 3)));
    }
    const encoder = new TextEncoder();
    const bytes = Buffer.concat(peak.result.chunks.map((chunk) => encoder.encode(chunk)));
    const size = `${(bytes.length / 2 ** 20).toFixed(0)} MiB of ${(REQIF_LIMITS.bytes / 2 ** 20).toFixed(0)} MiB`;
    await recordValue(
      `ReqIF write of ${String(OBJECTS)} export-shaped objects, ${String(RELATIONS)} relations (${size})`,
      peak.ms,
      { basis: BASIS_WRITE },
    );
    await recordValue(`ReqIF write of ${String(OBJECTS)} objects (${size}): ${memoryIncrease(peak)}`, 0, {
      basis: BASIS_WRITE,
    });
    // SR-052 AK3 at N-036: the export of 50,000 requirements must be readable by the parser.
    expect(bytes.length).toBeLessThan(REQIF_LIMITS.bytes);
    const back = parseReqif(bytes);
    if (back.kind !== "parsed") {
      throw new Error(back.message);
    }
    expect(back.file.specObjects).toHaveLength(OBJECTS);
    expect(back.file.specRelations).toHaveLength(RELATIONS);
    expect(back.file.specObjects[OBJECTS - 1]?.values).toEqual(model.specObjects[OBJECTS - 1]?.values);
  });
});

const T = "2026-10-31T00:00:00Z";
/** A UUID-shaped identifier from a number, as the export's `_<uuid>`. */
const uuid = (i: number): string => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
const node = (name: string, children: readonly XhtmlNode[]): XhtmlElement => ({
  name,
  namespace: XHTML_NAMESPACE,
  attributes: [],
  children,
});
const SENTENCE = "handle the delivery in time and keep every value as given, ";

/**
 * A model in the export's shape (ADR-0013) at N-036: per object a title, about 1 KB of XHTML, the same
 * text as `reqseq-markdown` and `reqseq-values` with the object's outgoing relations; 4 relations per
 * object; one flat SPECIFICATION.
 */
const exportShaped = (): ReqifWritable => {
  const outgoing = new Map<number, string[]>();
  const relations: ReqifWritable["specRelations"][number][] = [];
  for (let i = 0; i < RELATIONS; i++) {
    const source = i % OBJECTS;
    const target = (i * 7 + 1) % OBJECTS;
    const list = outgoing.get(source) ?? [];
    list.push(`{"kind":"refines","target":"${uuid(target)}","version":3}`);
    outgoing.set(source, list);
    relations.push({
      identifier: `_sr-${i.toString(16).padStart(40, "0")}`,
      lastChange: T,
      type: "_rt-refines",
      source: `_${uuid(source)}`,
      target: `_${uuid(target)}`,
      values: [],
    });
  }
  const objects: ReqifWritable["specObjects"][number][] = [];
  const hierarchy: ReqifWritable["specifications"][number]["children"][number][] = [];
  let longest = 1;
  for (let i = 0; i < OBJECTS; i++) {
    const title = `Requirement ${String(i)}`;
    const markdown = `## ${title}\n\nThe system **shall** ${SENTENCE.repeat(12)}\n\n- first\n- second\n`;
    const values = `{"status":"draft","priority":"high","relations":[${(outgoing.get(i) ?? []).join(",")}]}`;
    longest = Math.max(longest, markdown.length, values.length);
    const id = `_${uuid(i)}`;
    objects.push({
      identifier: id,
      lastChange: T,
      longName: title,
      type: "_ot-requirement",
      values: [
        { kind: "string", definition: "_ad-requirement.title", value: title },
        {
          kind: "xhtml",
          definition: "_ad-requirement.text",
          value: [
            node("div", [
              node("h2", [title]),
              node("p", ["The system ", node("strong", ["shall"]), ` ${SENTENCE.repeat(12)}`]),
              node("ul", [node("li", ["first"]), node("li", ["second"])]),
            ]),
          ],
        },
        { kind: "string", definition: "_rq-requirement.markdown", value: markdown },
        { kind: "string", definition: "_rq-requirement.values", value: values },
      ],
    });
    hierarchy.push({ identifier: `_sh-${uuid(i)}`, lastChange: T, object: id, children: [] });
  }
  const definition = (identifier: string, longName: string, kind: "string" | "xhtml") => ({
    identifier,
    lastChange: T,
    longName,
    kind,
    datatype: `_dt-${kind}`,
    multiValued: false,
  });
  return {
    header: {
      identifier: `_hd-${uuid(0)}`,
      title: "Workspace",
      creationTime: T,
      toolId: "reqseq",
      sourceToolId: "ReqSeq",
      version: "1.0",
    },
    datatypes: [
      { identifier: "_dt-string", lastChange: T, kind: "string", maxLength: String(longest), values: [] },
      { identifier: "_dt-xhtml", lastChange: T, kind: "xhtml", values: [] },
    ],
    specTypes: [
      {
        identifier: "_ot-requirement",
        lastChange: T,
        longName: "requirement",
        category: "spec-object",
        attributes: [
          definition("_ad-requirement.title", "title", "string"),
          definition("_ad-requirement.text", "text", "xhtml"),
          definition("_rq-requirement.markdown", "reqseq-markdown", "string"),
          definition("_rq-requirement.values", "reqseq-values", "string"),
        ],
      },
      {
        identifier: "_rt-refines",
        lastChange: T,
        longName: "refines",
        category: "spec-relation",
        attributes: [],
      },
      { identifier: "_st-specification", lastChange: T, category: "specification", attributes: [] },
    ],
    specObjects: objects,
    specRelations: relations,
    specifications: [
      { identifier: "_sp-0", lastChange: T, type: "_st-specification", values: [], children: hierarchy },
    ],
  };
};
