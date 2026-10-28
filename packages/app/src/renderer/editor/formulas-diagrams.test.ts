import { describe, expect, it } from "vitest";
import { diagramRule } from "./diagram.js";
import { FORMULA_RULES, formulaTooltip } from "./formula-preview.js";
import { formulasAndDiagrams } from "./formulas-diagrams.js";
import { mathSyntax } from "./math-syntax.js";

describe("formulasAndDiagrams", () => {
  it("brings the formula syntax, the rules of formulas and diagrams, the tooltip and the drawer (SR-096)", () => {
    expect(formulasAndDiagrams.markdown).toEqual([mathSyntax]);
    expect(formulasAndDiagrams.rules).toEqual([...FORMULA_RULES, diagramRule]);
    expect(formulasAndDiagrams.extensions?.[0]).toBe(formulaTooltip);
    expect(formulasAndDiagrams.extensions).toHaveLength(2);
  });
});
