// Cross-access scenarios of metamodel.removeType, in addition to the default one (cross-access.test.ts).
// On SR-004/one-repository with a second metamodel file that has a type nothing uses or names.
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { KEPT_DEFINITIONS, ONE_REPOSITORY } from "../../fixtures.js";
import { scenariosOf } from "../../scenario.js";

/** A type no element has and no definition names, with a property only it has. */
const SCRATCH: FixtureOptions = {
  ...ONE_REPOSITORY,
  files: {
    "metamodel/zz-scratch.yaml":
      "reqseq-metamodel: 1\ntypes:\n  - { key: scratch, name: Scratch, prefix: SC, properties: [scribble] }\n" +
      "properties:\n  # Only scratch has it.\n  - { key: scribble, name: Scribble, kind: text }\n",
    "filters/scratch.yaml": "reqseq-filter: 1\nname: Scratch\nwhere: { type: [scratch] }\n",
  },
};

scenariosOf("metamodel.removeType", [
  {
    name: "removes an unused type with its own property and writes the same bytes and output through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    fixture: SCRATCH,
    input: { type: "scratch" },
    expect: "output",
    check: (results) => {
      for (const { changed, files } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/zz-scratch.yaml"]);
        expect(files["metamodel/zz-scratch.yaml"]).toBe("reqseq-metamodel: 1\ntypes: []\nproperties: []\n");
      }
    },
  },
  {
    name: "a type an element has is refused with the same use through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "system-requirement" },
    expect: "error",
  },
  {
    name: "keeps each definition an element of another type still holds and names their numbers through every access (SR-237 AK5, SR-236)",
    tag: "[SR-237/AK-b0j6]",
    fixture: KEPT_DEFINITIONS,
    input: { type: "note" },
    expect: "output",
    check: (results) => {
      for (const { outcome, changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
        const { kept } = (outcome as { output: { kept: readonly { key: string; count: number }[] } }).output;
        expect(kept.map(({ key, count }) => [key, count])).toEqual([
          ["remark", 1],
          ["noted", 1],
        ]);
      }
    },
  },
]);
