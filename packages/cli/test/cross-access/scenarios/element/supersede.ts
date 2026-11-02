// Cross-access scenarios of element.supersede, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";

scenariosOf("element.supersede", [
  {
    name: "supersede with a successor and hints",
    fixture: { fixture: "SR-072/supersede", git: true },
    input: { ref: "N-d4e5f6", status: "obsolete", successor: "N-e5f6a7" },
    expect: "output",
  },
  {
    name: "status not marked invalid",
    fixture: { fixture: "SR-072/supersede", git: true },
    input: { ref: "N-d4e5f6", status: "approved" },
    expect: "error",
  },
  {
    name: "several succession kinds fit (relation-ambiguous)",
    fixture: {
      fixture: "SR-072/supersede",
      git: true,
      // A second kind with the meaning succession next to `supersedes`.
      files: {
        "metamodel/succession.yaml":
          "reqseq-metamodel: 1\nrelations:\n  - { key: obsoletes, name: Obsoletes, meaning: succession }\n",
      },
    },
    input: { ref: "SR-f6a7b8", status: "obsolete", successor: "SR-a7b8c9" },
    expect: "error",
  },
]);
