// Cross-access scenarios of evidence.list, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { EVIDENCE } from "../../fixtures.js";

scenariosOf("evidence.list", [
  {
    name: "the records of a requirement with the baselines of their version, and a faulty baseline file (SR-032)",
    fixture: {
      ...EVIDENCE,
      files: {
        "baselines/release-1.0.yaml":
          "reqseq-baseline: 1\nname: Release 1.0\ndate: 2026-10-24T09:30:00Z\nrepositories:\n" +
          "  - { name: system, commit: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad }\nelements:\n" +
          "  - { id: e8df96ea-a168-4d90-8d65-6328cee88fb3, version: n1:11335f109ffb1a19 }\n",
        "baselines/broken.yaml": "reqseq-baseline: 1\nname: Broken\n",
      },
    },
    input: { ref: "SR-e88fb3" },
    expect: "output",
  },
  {
    name: "the records of the core of a requirement and its baselines (SR-032 AK2)",
    fixture: { fixture: "SR-032/baselines", git: true },
    input: { ref: "SR-0032a1", view: "core" },
    expect: "output",
  },
  {
    name: "an unknown element gives the same error",
    fixture: EVIDENCE,
    input: { ref: "SR-ffffff" },
    expect: "error",
  },
  {
    name: "the records of one copy of a UUID two files share, by repository and file (SR-088, #821)",
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
    name: "a UUID two files share, without repository and file, is ambiguous (SR-088, #821)",
    fixture: { fixture: "SR-088/copied-file", git: true },
    root: "system",
    input: { ref: "948a10f1-05c3-4212-bd19-00606ccf2661" },
    expect: "error",
  },
]);
