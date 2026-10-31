// The ReqIF parser in the performance suite (ADR-0011, ADR-0013): a generated delivery at the size of
// N-036, 50,000 SPEC-OBJECTs with about 1 KB of XHTML each and 200,000 SPEC-RELATIONs, parsed once.
// Recorded with time and memory; the 10 s are the target of the plan of #265, not of an SR, so the
// row is not asserted. The same model is then written (`write.ts`) and parsed again.
import { measurePeakMemory, memoryIncrease, recordValue } from "@reqseq/testkit";
import { describe, expect, it } from "vitest";
import type { ReqifFile } from "../../src/reqif/model.js";
import { parseReqif } from "../../src/reqif/parse.js";
import type { ReqifWritable } from "../../src/reqif/write.js";
import { writeReqif } from "../../src/reqif/write.js";

const OBJECTS = 50_000;
const RELATIONS = 200_000;
const BASIS = "N-036, #265: ReqIF parse of a delivery at 50,000 requirements";

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

  it("records time and memory of writing that delivery and parsing it again", async () => {
    const parsed = parseReqif(generated());
    if (parsed.kind !== "parsed") {
      throw new Error(parsed.message);
    }
    const peak = await measurePeakMemory(() => writeReqif(complete(parsed.file)));
    if (peak.result.kind !== "written") {
      throw new Error(JSON.stringify(peak.result.problems.slice(0, 3)));
    }
    const { xml } = peak.result;
    const size = `${(xml.length / 1e6).toFixed(0)} MB`;
    await recordValue(
      `ReqIF write of ${String(OBJECTS)} objects, ${String(RELATIONS)} relations (${size})`,
      peak.ms,
      {
        basis: BASIS,
      },
    );
    await recordValue(`ReqIF write of ${String(OBJECTS)} objects (${size}): ${memoryIncrease(peak)}`, 0, {
      basis: BASIS,
    });
    const back = parseReqif(new TextEncoder().encode(xml));
    expect(back.kind === "parsed" && back.file.specRelations.length).toBe(RELATIONS);
  });
});

/** The generated model with the fields the schema makes mandatory and the generator leaves out. */
const complete = (file: ReqifFile): ReqifWritable => {
  const lastChange = "2026-10-31T00:00:00Z";
  return {
    ...file,
    header: { ...file.header, creationTime: lastChange, toolId: "perf", sourceToolId: "perf" },
    datatypes: file.datatypes.map((datatype) => ({ ...datatype, lastChange })),
    specTypes: file.specTypes.map((type) => ({
      ...type,
      lastChange,
      attributes: type.attributes.map((definition) => ({ ...definition, lastChange })),
    })),
    specRelations: file.specRelations.map((relation) => ({ ...relation, lastChange })),
  };
};
