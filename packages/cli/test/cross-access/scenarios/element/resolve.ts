// Cross-access scenarios of element.resolve, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { CRITERIA } from "../../fixtures.js";

scenariosOf("element.resolve", [
  {
    name: "short ID with an outdated version (SR-060)",
    input: { ref: "SR-e88fb3", version: "n1:0000000000000000" },
    expect: "output",
  },
  {
    name: "short ID with its version date (D-013)",
    input: { ref: "SR-e88fb3", versionDate: true },
    expect: "output",
  },
  { name: "unknown short ID (SR-060 AK3)", input: { ref: "SR-ffffff" }, expect: "error" },
  {
    tag: "[SR-205/AK-ndnj]",
    name: "a test name's reference to a criterion names the requirement, number and text",
    fixture: CRITERIA,
    input: { ref: "[SR-0000e3/AK-kfro]" },
    expect: "output",
    check: (results) => {
      const { element, criterion } = (
        results["core"]?.outcome as { output: { element: { id: string }; criterion: unknown } }
      ).output;
      expect([element.id, criterion]).toEqual([
        "31313131-0000-4000-8000-3131310000e3",
        {
          criterion: 3,
          key: "kfro",
          text: "Given frost, then a mark shows.",
          reference: "[SR-0000e3/AK-kfro]",
        },
      ]);
    },
  },
  {
    tag: "[SR-205/AK-ndnj]",
    name: "a reference to a criterion by number is refused alike",
    fixture: CRITERIA,
    input: { ref: "[SR-0000e3/AK3]" },
    expect: "error",
  },
  {
    name: "one copy of a UUID two files share, by file (SR-088, ThomasBirkmaier/ReqSeq-archive#255)",
    fixture: { fixture: "SR-088/copied-file", git: true },
    root: "system",
    input: { ref: "N-cf2661", file: "requirements/N-00606ccf2661.md" },
    expect: "output",
  },
  {
    name: "outdated prefix names the candidate (SR-060 AK3, ThomasBirkmaier/ReqSeq-archive#275)",
    fixture: {
      fixture: "SR-004/one-repository",
      git: true,
      files: {
        "requirements/SR-7a8b9c0d1e2f.md":
          "---\nid: 9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f\ntype: need\nstatus: draft\ntitle: Formerly a requirement\n---\n",
      },
    },
    input: { ref: "SR-0d1e2f" },
    expect: "error",
  },
  {
    name: "element without a version: current is unknown (ThomasBirkmaier/ReqSeq-archive#276)",
    fixture: {
      fixture: "SR-004/one-repository",
      git: true,
      files: {
        "requirements/SR-1d2e3f4a5b6c.md":
          "---\nid: 3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\nrequirement-type: functional\nacceptance-criteria: .inf\n---\n",
      },
    },
    input: { ref: "SR-4a5b6c", version: "n1:0000000000000000", versionDate: true },
    expect: "output",
  },
]);
