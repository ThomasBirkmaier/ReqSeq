// Cross-access scenarios of metamodel.get, in addition to the default one (cross-access.test.ts).
import type { MetamodelGetOutput as MetamodelOutput } from "@reqseq/core";
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { CHAIN, IN_CRITERIA } from "../../fixtures.js";

/** Inheritance, per-type statuses, relation kinds open on a side or both (SR-130). */
const METAMODEL: FixtureOptions = { fixture: "SR-130/metamodel", git: true };

scenariosOf("metamodel.get", [
  {
    name: "the metamodel with the properties marked as Markdown (SR-127 AK5)",
    fixture: IN_CRITERIA,
    input: {},
    expect: "output",
  },
  // SR-130 AK6: the app's graph and text of the metamodel show this output alone.
  {
    name: "types with inheritance, per-type statuses and open relation kinds (SR-130)",
    fixture: METAMODEL,
    input: {},
    tag: "[SR-130/AK-cmt2]",
    expect: "output",
    check: (results) => {
      for (const [access, { outcome }] of Object.entries(results)) {
        const output = (outcome as { output: MetamodelOutput }).output;
        const type = (key: string) => output.types.find((candidate) => candidate.key === key);
        const kind = (key: string) => output.relations.find((candidate) => candidate.key === key);
        expect(
          output.types.map((candidate) => candidate.key),
          access,
        ).toEqual(["item", "requirement", "software-requirement", "decision", "package"]);
        expect(type("software-requirement")?.ancestors, access).toEqual(["requirement", "item"]);
        expect(type("software-requirement")?.properties, access).toEqual([
          "title",
          "rationale",
          "packages",
          "component",
        ]);
        expect(type("package")?.statuses, access).toEqual([]);
        // Whether each property counts to the version (D-057, #624): false where not written.
        expect(
          output.properties.map((property) => [property.key, property.content]),
          access,
        ).toEqual([
          ["title", false],
          ["rationale", false],
          ["component", true],
          ["packages", false],
          ["severity", false],
        ]);
        expect(kind("based-on"), access).not.toHaveProperty("source-types");
        expect(kind("blocks")?.["source-types"], access).toEqual([]);
        // The relation kinds of each type, as relation.options gives them an element of it (SR-215 AK8).
        expect(
          output.relationKinds["item"]?.map((option) => option.kind),
          access,
        ).toEqual(["based-on", "concerns", "refines"]);
        expect(
          output.relationKinds["package"]?.find((option) => option.kind === "concerns")?.targetTypes,
          access,
        ).toEqual(["requirement", "software-requirement", "decision"]);
      }
    },
  },
  {
    name: "the standard model (SR-130)",
    fixture: CHAIN,
    input: {},
    tag: "[SR-130/AK-cmt2]",
    expect: "output",
  },
  {
    name: "a faulty metamodel file: the types of the valid files and the problem (SR-130)",
    fixture: {
      ...METAMODEL,
      files: { "model/broken.yaml": "reqseq-metamodel: 1\ntypes:\n  - { key: broken, name: Broken }\n" },
    },
    input: {},
    tag: "[SR-130/AK-cmt2]",
    expect: "output",
    check: (results) => {
      for (const [access, { outcome }] of Object.entries(results)) {
        const output = (outcome as { output: MetamodelOutput }).output;
        expect(output.types, access).toHaveLength(5);
        expect(output.problems, access).toMatchObject([
          { code: "metamodel.invalid", severity: "error", file: "model/broken.yaml" },
        ]);
      }
    },
  },
  {
    name: "a relation kind whose types do not fit its meaning: warnings, no error (#842)",
    fixture: {
      ...METAMODEL,
      files: {
        "model/excludes.yaml":
          "reqseq-metamodel: 1\nrelations:\n  - key: excludes\n    name: Excludes\n    source-types: [decision]\n    target-types: [requirement]\n    meaning: exclusion\n",
      },
    },
    input: {},
    expect: "output",
    check: (results) => {
      for (const [access, { outcome }] of Object.entries(results)) {
        const output = (outcome as { output: MetamodelOutput }).output;
        // The source is no variant; the fixture has no validity property, so no target fits either.
        expect(output.problems, access).toMatchObject([
          {
            code: "metamodel.meaning-type-mismatch",
            severity: "warning",
            file: "model/excludes.yaml",
            line: 5,
          },
          {
            code: "metamodel.meaning-type-mismatch",
            severity: "warning",
            file: "model/excludes.yaml",
            line: 6,
          },
        ]);
      }
    },
  },
]);
