// Cross-access scenarios of reqif.export, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { DELIVERY, FIRST_IMPORT } from "../../fixtures.js";

/** A package with requirements, a need and a decision, relations among them and to a missing element (SR-052). */
const REQIF_EXPORT: FixtureOptions = { fixture: "SR-052/package", git: true };
/** The package and a requirement of REQIF_EXPORT (SR-059). */
const PACKAGE_S6 = "52052052-0000-4000-8000-0000000052f1";
const WIND_S6 = "52052052-0000-4000-8000-0000000052a1";
/** REQIF_EXPORT with the mapping of a supplier it delivers to (SR-059 AK3). */
const SUPPLIER_MAPPING = "reqseq-reqif-mapping: 1\nsource: { name: Zulieferer }\n";
const SUPPLIER: FixtureOptions = { ...REQIF_EXPORT, files: { "reqif/zulieferer.yaml": SUPPLIER_MAPPING } };
/** Elements imported from Kunde A with and without a statement, and its mappings (SR-058). */
const STATEMENTS: FixtureOptions = { fixture: "SR-058/statements", git: true };
/** The export time and the header IDENTIFIER of a ReqIF file ReqSeq writes. */
const EXPORT_MASKS: readonly RegExp[] = [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, /_hd-[0-9a-f-]{36}/g];
/** A JUnit result at the output of an export (SR-207 AK1). */
const JUNIT =
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="s" tests="0"/></testsuites>\n';

scenariosOf("reqif.export", [
  {
    tag: "[SR-052/AK1]",
    name: "a package as one ReqIF file, its relations as SPEC-RELATIONs and their targets outside it as stubs",
    fixture: REQIF_EXPORT,
    input: { output: "s6.reqif", selection: { package: "52052052-0000-4000-8000-0000000052f1" } },
    expect: "output",
    masks: EXPORT_MASKS,
  },
  {
    tag: "[SR-058/AK1]",
    name: "the statements of the mapping's source by their source IDENTIFIERs, one without counted",
    fixture: STATEMENTS,
    input: { output: "back.reqif", mapping: "reqif/kunde-a.yaml", statements: true },
    expect: "output",
    masks: EXPORT_MASKS,
  },
  {
    tag: "[SR-207/AK1]",
    name: "an output that is an XML file but no ReqIF file is refused with the reason, and nothing is written",
    fixture: { ...REQIF_EXPORT, files: { "results.xml": JUNIT } },
    input: { output: "results.xml", selection: { ids: [WIND_S6] } },
    expect: "error",
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.changed).toEqual([]);
        expect(result.files["results.xml"]).toBe(JUNIT);
      }
      const { error } = results["core"]?.outcome as { error: { code: string; message: string } };
      expect([error.code, error.message]).toEqual([
        "file.faulty",
        "Not exported: results.xml is no ReqIF file (its root element is <testsuites>, not <REQ-IF>); ReqSeq replaces only a ReqIF file",
      ]);
    },
  },
  {
    name: "a profile is refused: not available yet",
    fixture: REQIF_EXPORT,
    input: { output: "s6.reqif", profile: "stage-6" },
    expect: "error",
  },
  {
    tag: "[SR-054/AK2]",
    name: "an export to the same source through the saved mapping the command names, without a question on types and attributes",
    fixture: {
      ...FIRST_IMPORT,
      files: {
        ...FIRST_IMPORT.files,
        "reqif/kunde-a.yaml": `${String(DELIVERY.files?.["reqif/kunde-a.yaml"])}omit-properties: [delivery, import-date]\n`,
      },
    },
    input: { output: "kunde-a.reqif", mapping: "reqif/kunde-a.yaml" },
    expect: "output",
    masks: EXPORT_MASKS,
    check: (results) => {
      for (const { files } of Object.values(results)) {
        // The mapping's omitted properties are left out, and the mapping is used as saved.
        expect(files["kunde-a.reqif"]).toContain("Measure the wind");
        expect(files["kunde-a.reqif"]).not.toContain("Lastenheft 2026-11");
        expect(files["reqif/kunde-a.yaml"]).toContain("omit-properties: [delivery, import-date]");
      }
    },
  },
  {
    tag: "[SR-059/AK1]",
    name: "the properties to omit are missing from the file",
    fixture: REQIF_EXPORT,
    input: { output: "s6.reqif", selection: { package: PACKAGE_S6 }, omitProperties: ["rationale"] },
    expect: "output",
    masks: EXPORT_MASKS,
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.files["s6.reqif"]).not.toContain("rationale");
      }
    },
  },
  {
    tag: "[SR-059/AK2]",
    name: "a target outside the export is a SPEC-OBJECT with IDENTIFIER and type only",
    fixture: REQIF_EXPORT,
    input: { output: "wind.reqif", selection: { ids: [WIND_S6] } },
    expect: "output",
    masks: EXPORT_MASKS,
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.files["wind.reqif"]).toMatch(
          /<SPEC-OBJECT IDENTIFIER="_52052052-0000-4000-8000-0000000052d1" LAST-CHANGE="[^"]*"><TYPE>/,
        );
        expect(result.files["wind.reqif"]).not.toContain("Know the weather");
      }
    },
  },
  {
    tag: "[SR-059/AK3]",
    name: "the properties to omit are saved in the mapping of the target",
    fixture: SUPPLIER,
    input: { output: "s6.reqif", mapping: "reqif/zulieferer.yaml", omitProperties: ["rationale"] },
    expect: "output",
    masks: EXPORT_MASKS,
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.files["reqif/zulieferer.yaml"]).toContain("omit-properties");
      }
    },
  },
  {
    tag: "[SR-059/AK3]",
    name: "a later delivery leaves out the properties the mapping saved",
    fixture: {
      ...SUPPLIER,
      files: { "reqif/zulieferer.yaml": `${SUPPLIER_MAPPING}omit-properties: [rationale]\n` },
    },
    input: { output: "s6.reqif", mapping: "reqif/zulieferer.yaml" },
    expect: "output",
    masks: EXPORT_MASKS,
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.files["s6.reqif"]).not.toContain("rationale");
      }
    },
  },
]);
