import { describe, expect, it } from "vitest";
import type { Problem } from "../generated/types.js";
import { elementProblemGroups } from "./element-problems.js";

const problem = (code: string, severity: Problem["severity"], message: string): Problem =>
  ({ code, severity, message, elementId: "e" }) as Problem;

describe("elementProblemGroups", () => {
  it("groups an element's problems by severity and kind, errors first, each kind in the order it first appears", () => {
    const problems = [
      problem("relation.outdated", "warning", "a"),
      problem("trace.no-parent", "warning", "b"),
      problem("element.missing-required", "error", "c"),
      problem("relation.outdated", "warning", "d"),
      problem("no.such-kind", "info", "e"),
      problem("element.missing-required", "error", "f"),
    ];
    expect(
      elementProblemGroups(problems).map((g) => [
        g.severity,
        g.code,
        g.title,
        g.problems.map((p) => p.message),
      ]),
    ).toEqual([
      ["error", "element.missing-required", "Required property without value", ["c", "f"]],
      ["warning", "relation.outdated", "Outdated relation", ["a", "d"]],
      ["warning", "trace.no-parent", "Requirement without parent", ["b"]],
      ["info", "no.such-kind", "no.such-kind", ["e"]],
    ]);
  });

  it("gives no group for an element without problems", () => {
    expect(elementProblemGroups(undefined)).toEqual([]);
    expect(elementProblemGroups([])).toEqual([]);
  });
});
