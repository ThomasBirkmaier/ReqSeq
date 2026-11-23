// Cross-access scenarios of trace.neighbourhood, in addition to the default one (harness.ts).
import fs from "node:fs/promises";
import path from "node:path";
import type { TraceNeighbourhoodOutput } from "@reqseq/core";
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";

/** Every kind of link around a few elements: derivations, a package, an exclusion, inline references (SR-107). */
const NEIGHBOURHOOD: FixtureOptions = { fixture: "SR-107/neighbourhood", git: true };
const NB = "5e107a7d-2b4f-4c61-9d08-";

/** 101 more requirements that derive from the need N1, with the two of the fixture 103 (SR-107 AK6). */
const MANY = 101;

const deriveMany = async (root: string): Promise<void> => {
  for (let n = 0; n < MANY; n += 1) {
    const tail = `1a${String(n).padStart(10, "0")}`;
    await fs.writeFile(
      path.join(root, "requirements", `SR-${tail}.md`),
      `---\nid: ${NB}${tail}\ntype: system-requirement\nstatus: draft\ntitle: Requirement ${String(n)}\n` +
        `requirement-type: functional\nacceptance-criteria:\n  - Given wind, when it blows, then it is shown.\n` +
        `derives-from:\n  - { id: ${NB}0a0000000001, version: n1:323df2732ed684b0 }\n---\n\nText.\n`,
    );
  }
};

const coreOutput = (results: Readonly<Record<string, Result>>): TraceNeighbourhoodOutput =>
  (results["core"]?.outcome as { output: TraceNeighbourhoodOutput }).output;

scenariosOf("trace.neighbourhood", [
  {
    name: "the count of each kind and its first 100 elements, the same in every access",
    tag: "[SR-107/AK-qy39]",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0a0000000001`, direction: "down", limit: 5 },
    expect: "output",
    prepare: async (copy) => {
      await deriveMany(copy.root);
    },
    check: (results) => {
      const groups = coreOutput(results).incoming?.map((g) => [g.kind, g.count, g.elements.length]);
      expect(groups).toEqual([["derives-from", MANY + 2, 100]]);
    },
  },
  {
    name: "the direct neighbours of a requirement over every kind (SR-107 AK2)",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0b0000000001` },
    expect: "output",
  },
  {
    name: "children level by level, derivations only, one page (SR-107 AK2, AK3)",
    fixture: NEIGHBOURHOOD,
    input: {
      ref: `${NB}0a0000000001`,
      direction: "down",
      meanings: ["derivation"],
      maxDepth: 2,
      limit: 2,
      offset: 2,
    },
    expect: "output",
  },
  {
    name: "the whole way up along one relation kind (SR-107 AK1)",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0c0000000001`, direction: "up", kinds: ["derives-from"], allLevels: true },
    expect: "output",
  },
  {
    name: "a key that is no relation kind",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0b0000000001`, kinds: ["nope"] },
    expect: "error",
  },
  {
    name: "the element in a named repository (SR-107)",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0b0000000001`, repository: "system", direction: "down", meanings: ["derivation"] },
    expect: "output",
  },
  {
    name: "a repository that holds no such element",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0b0000000001`, repository: "vault" },
    expect: "error",
  },
  { name: "unknown reference", fixture: NEIGHBOURHOOD, input: { ref: "SR-ffffff" }, expect: "error" },
]);
