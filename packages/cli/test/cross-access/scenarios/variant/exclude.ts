// Cross-access scenarios of variant.exclude, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { VARIANT_VIEWS } from "../../fixtures.js";

scenariosOf("variant.exclude", [
  {
    tag: "[SR-042/AK-qj7v]",
    name: "variant.exclude writes the exclusion of K3 into the file of A",
    fixture: VARIANT_VIEWS,
    input: { variant: "VAR-0000c1", refs: ["SR-0000a3"] },
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { files: string[] } }).output;
      expect(output.files).toEqual(["variants/VAR-0000000000c1.md"]);
    },
  },
  {
    tag: "[SR-042/AK-sq52]",
    name: "variant.exclude with undo removes the exclusion of K2 from the file of A",
    fixture: VARIANT_VIEWS,
    input: { variant: "VAR-0000c1", refs: ["SR-0000a2"], undo: true },
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { files: string[]; problems: unknown[] } })
        .output;
      expect([output.files, output.problems]).toEqual([["variants/VAR-0000000000c1.md"], []]);
    },
  },
  {
    name: "a requirement with validity is refused (SR-042 AK4)",
    fixture: VARIANT_VIEWS,
    input: { variant: "VAR-0000c1", refs: ["SR-0000b2"] },
    expect: "error",
  },
]);
