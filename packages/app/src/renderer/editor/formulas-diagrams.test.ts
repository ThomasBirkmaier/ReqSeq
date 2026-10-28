import { describe, expect, it } from "vitest";
import { FORMULA_RULES, formulaTooltip } from "./formula-preview.js";
import { formulasAndDiagrams } from "./formulas-diagrams.js";
import { mathSyntax } from "./math-syntax.js";

describe("formulasAndDiagrams", () => {
  it("brings the formula syntax, its preview rules and the tooltip at the caret (SR-096)", () => {
    expect(formulasAndDiagrams).toEqual({
      markdown: [mathSyntax],
      rules: FORMULA_RULES,
      extensions: [formulaTooltip],
    });
  });
});
