// Cross-access scenarios of element.get, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { CRITERIA, HINTS, IDENTIFIERS, IN_CRITERIA, MISSING_TARGETS, VARIANT_VIEWS } from "../../fixtures.js";

scenariosOf("element.get", [
  {
    tag: "[SR-205/AK-npsp]",
    name: "element.get gives each criterion its number, key, text and the reference for a test name",
    fixture: CRITERIA,
    input: { ref: "SR-0000e3" },
    expect: "output",
    check: (results) => {
      const { criterionReferences } = (
        results["core"]?.outcome as { output: { criterionReferences: { criteria: unknown[] } } }
      ).output;
      expect(criterionReferences.criteria[2]).toEqual({
        criterion: 3,
        key: "kfro",
        text: "Given frost, then a mark shows.",
        reference: "[SR-0000e3/AK-kfro]",
      });
    },
  },
  {
    tag: "[SR-046/AK-msfv]",
    name: "element.get names A as replacing and B as excluding variant",
    fixture: {
      ...VARIANT_VIEWS,
      files: {
        "variants/VAR-0000000000c2.md":
          "---\nid: 43043043-0000-4000-8000-0000000000c2\ntype: variant\nstatus: draft\ntitle: Mountain\n" +
          "excludes: [{ id: 43043043-0000-4000-8000-0000000000a1 }]\n---\n",
      },
    },
    input: { ref: "SR-0000a1" },
    expect: "output",
    check: (results) => {
      const { element } = (results["core"]?.outcome as { output: { element: Record<string, unknown> } })
        .output;
      const P = "43043043-0000-4000-8000-0000000000";
      expect([element["replacedBy"], element["excludedBy"]]).toEqual([
        [{ variant: `${P}c1`, replacement: `${P}b1` }],
        [`${P}c2`],
      ]);
    },
  },
  {
    name: "an element with a reference in an acceptance criterion: its outdated hint (SR-127 AK3)",
    fixture: IN_CRITERIA,
    input: { ref: "SR-0000b1" },
    expect: "output",
  },
  { name: "one element by short ID", input: { ref: "SR-e88fb3" }, expect: "output" },
  {
    name: "one element by a short ID in lower case (ThomasBirkmaier/ReqSeq-archive#309)",
    input: { ref: "sr-E88FB3" },
    expect: "output",
  },
  {
    name: "a reference that names no element: no identifier SR-036 here (ThomasBirkmaier/ReqSeq-archive#305)",
    input: { ref: "SR-036" },
    expect: "error",
  },
  {
    name: "a malformed reference: spaces at its end (ThomasBirkmaier/ReqSeq-archive#309)",
    input: { ref: "SR-e88fb3 " },
    expect: "error",
  },
  {
    name: "one element by its identifier, in any case, with the identifiers it names (ThomasBirkmaier/ReqSeq-archive#305)",
    fixture: IDENTIFIERS,
    input: { ref: "sr-036" },
    expect: "output",
  },
  {
    name: "a short ID of one element that is the identifier of another is ambiguous (ThomasBirkmaier/ReqSeq-archive#305)",
    fixture: {
      ...IDENTIFIERS,
      files: {
        "decisions/D-0000000c0048.md":
          "---\nid: 30500000-0000-4000-8000-0000000c0048\ntype: decision\nstatus: draft\ntitle: Clash\nspec-id: SR-0b0037\n---\n",
      },
    },
    input: { ref: "SR-0b0037" },
    expect: "error",
  },
  {
    name: "an element with an outdated relation and reference, with dates (SR-026 AK3)",
    fixture: HINTS,
    input: { ref: "SR-0000b1", versionDate: true },
    expect: "output",
  },
  {
    name: "the outdated relation and reference of an element dated, not the element itself (SR-110 AK2)",
    fixture: HINTS,
    input: { ref: "SR-0000b1", hintDates: true },
    expect: "output",
  },
  {
    name: "one element with its version date (D-013)",
    input: { ref: "SR-e88fb3", versionDate: true },
    expect: "output",
  },
  {
    name: "superseded element with its successor (SR-072 AK3)",
    fixture: {
      fixture: "SR-072/supersede",
      git: true,
      files: {
        "needs/N-a1b2c3d4e5f6.md":
          "---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6\ntype: need\nstatus: obsolete\ntitle: See the wind\n---\n",
        "needs/N-b2c3d4e5f6a7.md":
          "---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7\ntype: need\nstatus: draft\ntitle: See wind and gusts\nsupersedes:\n  - { id: 7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6, version: n1:1111111111111111, title: See the wind }\n---\n",
      },
    },
    input: { ref: "N-d4e5f6" },
    expect: "output",
  },
  {
    name: "unknown type, read-only (SR-016 AK3)",
    fixture: { fixture: "SR-016/unknown", git: true },
    input: { ref: "2c9e4b71-6d58-4f03-a1e7-0f6a7b8c9d0e" },
    expect: "output",
  },
  {
    name: "relations across repositories, one missing (SR-005, SR-006)",
    fixture: MISSING_TARGETS,
    root: "system",
    input: { ref: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
    expect: "output",
  },
  { name: "unknown reference", input: { ref: "SR-ffffff" }, expect: "error" },
  { name: "view of a variant (stage 5)", input: { ref: "SR-e88fb3", view: "core" }, expect: "error" },
  {
    name: "one copy of a UUID two files share, by repository and file (SR-088, ThomasBirkmaier/ReqSeq-archive#255)",
    fixture: { fixture: "SR-088/copied-file", git: true },
    root: "system",
    input: {
      ref: "948a10f1-05c3-4212-bd19-00606ccf2661",
      repository: "system",
      file: "copies/N-00606ccf2661.md",
    },
    expect: "output",
  },
  {
    name: "a file that holds none of the elements ref names (ThomasBirkmaier/ReqSeq-archive#255)",
    fixture: { fixture: "SR-088/copied-file", git: true },
    root: "system",
    input: { ref: "948a10f1-05c3-4212-bd19-00606ccf2661", file: "needs/N-00606ccf2661.md" },
    expect: "error",
  },
]);
