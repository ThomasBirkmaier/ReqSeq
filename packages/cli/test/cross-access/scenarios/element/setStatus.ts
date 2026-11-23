// Cross-access scenarios of element.setStatus, in addition to the default one (harness.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

/** Statuses per type (ThomasBirkmaier/ReqSeq-archive#306): glossary terms have no status, requirements require one. */
const STATUSES_PER_TYPE: FixtureOptions = { fixture: "enabler-306/statuses-per-type", git: true };

scenariosOf("element.setStatus", [
  {
    name: "approve an element without its required properties: the status is set and they are named",
    tag: "[SR-243/AK-h5mc]",
    input: { refs: ["SR-e88fb3"], status: "approved" },
    expect: "output",
    check: (results) => {
      // The accesses compared equal, so the core's output stands for all four.
      const { output } = results["core"]?.outcome as {
        output: { problems: { code: string; key: string }[] };
      };
      expect(output.problems.map((p) => [p.code, p.key])).toEqual([
        ["element.missing-required", "requirement-type"],
        ["element.missing-required", "acceptance-criteria"],
      ]);
    },
  },
  {
    name: "a status by its display name, in any case (ThomasBirkmaier/ReqSeq-archive#309)",
    input: { refs: ["sr-e88fb3"], status: "APPROVED" },
    expect: "output",
  },
  {
    name: "status not in the metamodel",
    input: { refs: ["SR-e88fb3"], status: "released" },
    expect: "error",
  },
  {
    name: "remove a leftover status with status null: CLI via --input (ThomasBirkmaier/ReqSeq-archive#343)",
    fixture: STATUSES_PER_TYPE,
    input: { refs: ["T-eee002"], status: null },
    expect: "output",
  },
  {
    name: "remove the status of an element whose type requires one (ThomasBirkmaier/ReqSeq-archive#343)",
    fixture: STATUSES_PER_TYPE,
    input: { refs: ["SR-bbb001"], status: null },
    expect: "error",
  },
]);
