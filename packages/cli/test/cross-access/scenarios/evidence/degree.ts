// Cross-access scenarios of evidence.degree, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { CRITERIA, DEGREE, EVIDENCE, STATUS } from "../../fixtures.js";

scenariosOf("evidence.degree", [
  {
    name: "a variant view names its variant (SR-037, ThomasBirkmaier/ReqSeq-archive#588)",
    fixture: STATUS,
    input: { selection: { view: "5e031a7d-2b4f-4c61-9d08-0c0000000001" } },
    expect: "output",
  },
  {
    name: "the whole workspace (SR-037)",
    fixture: DEGREE,
    input: {},
    expect: "output",
  },
  {
    name: "a package with an indirect requirement (SR-037 AK2)",
    fixture: DEGREE,
    input: { selection: { package: "PKG-00d002" } },
    expect: "output",
  },
  {
    name: "a package page counts 6 verified, 1 failed, 1 outdated and 2 open",
    fixture: DEGREE,
    input: { selection: { package: "PKG-00d003" } },
    tag: "[SR-112/AK3]",
    expect: "output",
    check: (results) => {
      expect((results["core"]?.outcome as { output: { degree: unknown } }).output.degree).toEqual({
        share: 0.6,
        total: 10,
        counts: { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 },
      });
    },
  },
  {
    name: "a package with obsolete requirements in the core view (SR-037 AK3)",
    fixture: DEGREE,
    input: { selection: { package: "PKG-00d003", view: "core" } },
    expect: "output",
  },
  {
    name: "an unknown package gives the same error",
    fixture: DEGREE,
    input: { selection: { package: "PKG-ffffff" } },
    expect: "error",
  },
  {
    name: "requirements whose records name acceptance criteria count with their status per criterion (SR-031, SR-037)",
    fixture: CRITERIA,
    input: {},
    expect: "output",
    check: (results) => {
      expect((results["core"]?.outcome as { output: { degree: unknown } }).output.degree).toEqual({
        share: 0.4,
        total: 5,
        counts: { open: 1, verified: 2, indirect: 0, failed: 1, outdated: 1 },
      });
    },
  },
  {
    name: "a workspace with an evidence location (ThomasBirkmaier/ReqSeq-archive#535)",
    fixture: EVIDENCE,
    input: { selection: { ids: ["SR-e88fb3"] } },
    expect: "output",
  },
]);
