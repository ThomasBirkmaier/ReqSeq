// Cross-access scenarios of reqif.import, in addition to the default one (cross-access.test.ts).
import { readFileSync } from "node:fs";
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import {
  DELIVERY,
  FIRST_IMPORT,
  PARTIAL_DELIVERY,
  PARTIAL_MAPPING,
  REPEAT,
  REPEATED,
  coreOutput,
  imported,
} from "../../fixtures.js";

/** The metamodel of SR-004/one-repository as the fixture holds it (SR-054 AK3). */
const STANDARD_MODEL = readFileSync(
  new URL("../../../../../../fixtures/SR-004/one-repository/metamodel/standard-model.yaml", import.meta.url),
  "utf8",
);
/** The saved mapping of DELIVERY without its entry for the source type Heading (SR-054 AK3). */
const WITHOUT_HEADING = [
  "reqseq-reqif-mapping: 1",
  "source: { name: Kunde A }",
  "types: [{ source: Customer Requirement, type: system-requirement }]",
  "attributes:",
  "  - { source: ReqIF.Name, property: title }",
  "  - { source: ReqIF.Text, property: text }",
  "  - { source: Priority, property: requirement-type, values: { High: functional, Low: quality } }",
  "  - { source: Internal Comment, omit: true }",
  "relations: [{ source: satisfies, kind: derives-from }]",
  "",
].join("\n");
/**
 * DELIVERY with a RELATION-GROUP of REL-1, which the import does not take over (SR-053 AK2, #941):
 * with it the delivery holds every kind of loss of SR-053 AK2 the fixture can show.
 */
const GROUPED: FixtureOptions = {
  ...DELIVERY,
  files: {
    ...DELIVERY.files,
    "in/lieferung.reqif": String(DELIVERY.files?.["in/lieferung.reqif"])
      .replace("</SPEC-TYPES>", '<RELATION-GROUP-TYPE IDENTIFIER="gt-links" LONG-NAME="Links"/></SPEC-TYPES>')
      .replace(
        "</REQ-IF-CONTENT>",
        [
          '<SPEC-RELATION-GROUPS><RELATION-GROUP IDENTIFIER="rg-1">',
          "<SPEC-RELATIONS><SPEC-RELATION-REF>REL-1</SPEC-RELATION-REF></SPEC-RELATIONS>",
          "<SOURCE-SPECIFICATION><SPECIFICATION-REF>SPEC-1</SPECIFICATION-REF></SOURCE-SPECIFICATION>",
          "<TARGET-SPECIFICATION><SPECIFICATION-REF>SPEC-1</SPECIFICATION-REF></TARGET-SPECIFICATION>",
          "<TYPE><RELATION-GROUP-TYPE-REF>gt-links</RELATION-GROUP-TYPE-REF></TYPE>",
          "</RELATION-GROUP></SPEC-RELATION-GROUPS></REQ-IF-CONTENT>",
        ].join(""),
      ),
  },
};
/** A workspace with the standard model only, and an export of SR-052/package in folder in (SR-052). */
const ROUND_TRIP: FixtureOptions = { fixture: "SR-052/empty", git: true };
/** Every access left the files of delivery 1 as they were. */
const unchangedRepeat = (results: Readonly<Record<string, Result>>): void => {
  for (const result of Object.values(results)) {
    for (const n of [1, 2, 3, 4]) {
      const file = `Kunde-A/SR-00000000000${String(n)}.md`;
      expect(result.files[file]).toBe(REPEATED.files?.[file]);
    }
    expect(Object.keys(result.files).filter((f) => f.startsWith("Kunde-A/"))).toHaveLength(4);
  }
};

/** A refused import leaves every file as it was and writes no element file (SR-055 AK3). */
const unchangedDelivery =
  (mapping: string) =>
  (results: Readonly<Record<string, Result>>): void => {
    for (const result of Object.values(results)) {
      expect(Object.keys(result.files).filter((file) => file.startsWith("Kunde-A/"))).toEqual([]);
      expect(result.files["reqif/kunde-a.yaml"]).toBe(mapping);
      expect(result.files["in/lieferung.reqif"]).toBe(DELIVERY.files?.["in/lieferung.reqif"]);
    }
  };

scenariosOf("reqif.import", [
  {
    tag: "[SR-052/AK3]",
    name: "a file of ReqSeq without a mapping: one to one, its mapping saved",
    fixture: ROUND_TRIP,
    input: { file: "in/all.reqif", delivery: "round trip" },
    expect: "output",
    newElement: true,
  },
  {
    tag: "[SR-053/AK1]",
    name: "a delivery through its saved mapping: new element files in a folder named after the source",
    fixture: DELIVERY,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" },
    expect: "output",
    newElement: true,
  },
  {
    tag: "[SR-053/AK2]",
    name: "a delivery with content that is not taken over without loss lists each loss with its element and reason",
    fixture: GROUPED,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" },
    expect: "output",
    newElement: true,
    check: (results) => {
      const out = coreOutput(results) as {
        created: readonly { identifier: string; id: string }[];
        losses: readonly { identifier: string; id?: string }[];
      };
      const id = (identifier: string): string | undefined =>
        out.created.find((c) => c.identifier === identifier)?.id;
      expect(out.losses).toEqual([
        {
          identifier: "REQ-1",
          kind: "spec-object",
          id: id("REQ-1"),
          code: "omitted-attribute",
          reason: "the mapping omits its attribute Internal Comment",
        },
        {
          identifier: "HEAD-1",
          kind: "spec-object",
          code: "omitted-type",
          reason: "the mapping omits its type Heading",
        },
        {
          identifier: "REL-2",
          kind: "spec-relation",
          id: id("REQ-1"),
          code: "relation-end-not-imported",
          reason: "its target HEAD-1 is not imported",
        },
        {
          identifier: "SPEC-1",
          kind: "specification",
          code: "hierarchy",
          reason: "the SPEC-HIERARCHY of Lastenheft (order and nesting) is not imported",
        },
        {
          identifier: "REL-1",
          kind: "spec-relation",
          id: id("REQ-2"),
          code: "relation-group",
          reason: "its RELATION-GROUP rg-1 (type Links) is not imported",
        },
      ]);
    },
  },
  {
    tag: "[SR-056/AK4]",
    name: "a repeated delivery with a conflict and no choice is refused with reqif.conflict naming it",
    fixture: REPEATED,
    input: REPEAT,
    expect: "error",
    check: (results) => {
      const { error } = results["core"]?.outcome as {
        error: { code: string; details?: { conflicts?: unknown } };
      };
      expect([error.code, error.details?.conflicts]).toEqual([
        "reqif.conflict",
        [{ identifier: "REQ-3", id: imported(3) }],
      ]);
    },
  },
  {
    tag: "[SR-055/AK3]",
    name: "a repeated delivery refused for a conflict changes no file",
    fixture: REPEATED,
    input: REPEAT,
    expect: "error",
    check: unchangedRepeat,
  },
  {
    tag: "[SR-056/AK2]",
    name: "a repeated delivery with take updates the elements of the source in place and creates only the new one",
    fixture: REPEATED,
    input: { ...REPEAT, take: ["REQ-3"] },
    expect: "output",
    newElement: true,
    check: (results) => {
      const out = coreOutput(results) as {
        created: { identifier: string }[];
        updated: unknown;
        kept: unknown;
      };
      expect(out.created.map((c) => c.identifier)).toEqual(["REQ-5"]);
      expect(out.updated).toEqual(
        [1, 2, 3].map((n) => ({ identifier: `REQ-${String(n)}`, id: imported(n) })),
      );
      expect(out.kept).toEqual([]);
      for (const result of Object.values(results)) {
        expect(Object.keys(result.files).filter((f) => f.startsWith("Kunde-A/"))).toHaveLength(5);
        expect(result.files["Kunde-A/SR-000000000003.md"]).toContain("for 30 days.");
      }
    },
  },
  {
    tag: "[SR-056/AK3]",
    name: "a repeated delivery lists the dropped requirement and leaves its file as it was",
    fixture: REPEATED,
    input: { ...REPEAT, keep: ["REQ-3"] },
    expect: "output",
    newElement: true,
    check: (results) => {
      const out = coreOutput(results) as { dropped: unknown; kept: unknown };
      expect([out.dropped, out.kept]).toEqual([
        [{ identifier: "REQ-4", id: imported(4) }],
        [{ identifier: "REQ-3", id: imported(3) }],
      ]);
      for (const result of Object.values(results)) {
        // Versions are placeholders here (newElement); the rest of the file is as it was.
        const placeholder = (text: unknown): string =>
          String(text).replace(/n[12]:[0-9a-f]{16}/g, "<version>");
        expect(result.files["Kunde-A/SR-000000000004.md"]).toBe(
          placeholder(REPEATED.files?.["Kunde-A/SR-000000000004.md"]),
        );
        expect(result.files["Kunde-A/SR-000000000003.md"]).toContain("for a year.");
      }
    },
  },
  {
    tag: "[SR-055/AK3]",
    name: "a file that is no ReqIF is refused (reqif.invalid), changing no file",
    fixture: DELIVERY,
    input: { file: "reqif/kunde-a.yaml", mapping: "reqif/kunde-a.yaml", delivery: "x" },
    expect: "error",
    check: unchangedDelivery(String(DELIVERY.files?.["reqif/kunde-a.yaml"])),
  },
  {
    tag: "[SR-055/AK1]",
    name: "a mapping that leaves entries unmapped is refused with reqif.unmapped and the list of reqif.analyze",
    fixture: PARTIAL_DELIVERY,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" },
    expect: "error",
    check: (results) => {
      const error = (
        results["core"]?.outcome as { error?: { code: string; details?: { unmapped?: unknown } } }
      ).error;
      expect(error?.code).toBe("reqif.unmapped");
      expect(error?.details?.unmapped).toEqual([
        { kind: "attribute", source: "ReqIF.Text", sourceType: "Customer Requirement" },
        { kind: "attribute", source: "Priority", sourceType: "Customer Requirement" },
        { kind: "attribute", source: "Internal Comment", sourceType: "Customer Requirement" },
        { kind: "type", source: "Heading" },
        { kind: "attribute", source: "Heading Text", sourceType: "Heading" },
        { kind: "relation", source: "satisfies" },
      ]);
    },
  },
  {
    tag: "[SR-055/AK3]",
    name: "a refusal with reqif.unmapped changes no file",
    fixture: PARTIAL_DELIVERY,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" },
    expect: "error",
    check: unchangedDelivery(PARTIAL_MAPPING),
  },
  {
    tag: "[SR-055/AK2]",
    name: "after every entry is mapped or omitted in the mapping file, the import runs",
    fixture: DELIVERY,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" },
    expect: "output",
    newElement: true,
  },
  {
    tag: "[SR-054/AK2]",
    name: "the same source again through the saved mapping the command names, without a question on types and attributes",
    fixture: FIRST_IMPORT,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-12" },
    expect: "output",
    check: (results) => {
      const output = (coreOutput(results) as { updated: readonly { identifier: string }[] }).updated;
      expect(output.map((u) => u.identifier)).toEqual(["REQ-1", "REQ-2"]);
      for (const { files } of Object.values(results)) {
        // The mapping is used as saved, not rewritten.
        expect(files["reqif/kunde-a.yaml"]).toBe(DELIVERY.files?.["reqif/kunde-a.yaml"]);
        // Its attributes: the title from ReqIF.Name, Priority High as requirement-type functional,
        // Internal Comment omitted; its type: Customer Requirement as system-requirement.
        const first = files["Kunde-A/SR-000000000001.md"];
        expect(first).toContain("type: system-requirement");
        expect(first).toContain("title: Measure the wind");
        expect(first).toContain("requirement-type: functional");
        expect(first).toContain("delivery: Lastenheft 2026-12");
        expect(first).not.toContain("check with team");
        expect(Object.keys(files).filter((f) => f.startsWith("Kunde-A/"))).toHaveLength(2);
      }
    },
  },
  {
    tag: "[SR-054/AK3]",
    name: "reading the types and attributes of the source leaves the own metamodel as it was",
    fixture: DELIVERY,
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" },
    expect: "output",
    newElement: true,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(Object.keys(files).filter((f) => f.startsWith("metamodel/"))).toEqual([
          "metamodel/standard-model.yaml",
        ]);
        expect(files["metamodel/standard-model.yaml"]).toBe(STANDARD_MODEL);
      }
    },
  },
  {
    tag: "[SR-054/AK3]",
    name: "a source type the mapping does not name is refused (reqif.unmapped), the own metamodel unchanged",
    fixture: { ...DELIVERY, files: { ...DELIVERY.files, "reqif/kunde-a.yaml": WITHOUT_HEADING } },
    input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" },
    expect: "error",
    check: (results) => {
      for (const { outcome, files } of Object.values(results)) {
        expect(JSON.stringify(outcome)).toContain("reqif.unmapped");
        expect(files["metamodel/standard-model.yaml"]).toBe(STANDARD_MODEL);
      }
    },
  },
]);
