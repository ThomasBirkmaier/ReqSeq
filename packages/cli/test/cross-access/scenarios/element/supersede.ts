// Cross-access scenarios of element.supersede, in addition to the default one (cross-access.test.ts).
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { supersededHintFiles } from "../../fixtures.js";
import { scenariosOf } from "../../scenario.js";

scenariosOf("element.supersede", [
  {
    tag: "[SR-072/AK-y5gr]",
    name: "supersede with a successor: a hint on each relation but the successor's own",
    fixture: { fixture: "SR-072/supersede", git: true },
    input: { ref: "N-d4e5f6", status: "obsolete", successor: "N-e5f6a7" },
    expect: "output",
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(supersededHintFiles(result)).toEqual([
          "requirements/SR-c3d4e5f6a7b8.md",
          "requirements/SR-e5f6a7b8c9d0.md",
        ]);
      }
    },
  },
  {
    tag: "[SR-072/AK-y5gr]",
    name: "no hint on the relation of an obsolete source",
    fixture: {
      fixture: "SR-072/supersede",
      git: true,
      files: {
        "requirements/SR-c3d4e5f6a7b8.md": readFileSync(
          new URL(
            "../../../../../../fixtures/SR-072/supersede/requirements/SR-c3d4e5f6a7b8.md",
            import.meta.url,
          ),
          "utf8",
        ).replace(/^status: .*$/mu, "status: obsolete"),
      },
    },
    input: { ref: "N-d4e5f6", status: "obsolete", successor: "N-e5f6a7" },
    expect: "output",
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(supersededHintFiles(result)).toEqual(["requirements/SR-e5f6a7b8c9d0.md"]);
      }
    },
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
