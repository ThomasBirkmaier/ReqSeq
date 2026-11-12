// Cross-access scenarios of variant.diff, in addition to the default one (cross-access.test.ts).
import type { VariantDiffOutput } from "@reqseq/core";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { VARIANT_VIEWS } from "../../fixtures.js";

scenariosOf("variant.diff", [
  {
    tag: "[SR-044/AK-nxhm]",
    name: "A adds A2, replaces K1 by A1 and excludes K2",
    fixture: VARIANT_VIEWS,
    input: { variant: "VAR-0000c1" },
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: VariantDiffOutput }).output;
      const tail = (id: string): string => id.slice(-2);
      expect([
        output.added.map(tail),
        output.replaced.map((row) => [tail(row.core), tail(row.replacement)]),
        output.excluded.map(tail),
      ]).toEqual([["b2"], [["a1", "b1"]], ["a2"]]);
    },
  },
  {
    tag: "[SR-044/AK-dc1n]",
    name: "the replaced row names the IDs of core requirement and replacement",
    fixture: VARIANT_VIEWS,
    input: { variant: "VAR-0000c1" },
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { replaced: unknown } }).output;
      expect(output.replaced).toEqual([
        {
          core: "43043043-0000-4000-8000-0000000000a1",
          replacement: "43043043-0000-4000-8000-0000000000b1",
        },
      ]);
    },
  },
  { name: "no variant", fixture: VARIANT_VIEWS, input: { variant: "SR-0000a1" }, expect: "error" },
]);
