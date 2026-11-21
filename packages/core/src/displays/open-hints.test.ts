import { describe, expect, it } from "vitest";
import { hintCounts, openHints } from "./open-hints.js";

const hint = (code: string, extra: object = {}) => ({ code, severity: "warning", elementId: "e", ...extra });

describe("openHints", () => {
  it("keeps the hints hint.list gives, in its order, and no other problem (assumption of #2231)", () => {
    const problems = [
      hint("relation.outdated"),
      hint("file.faulty"),
      { code: "metamodel.meaning-unassigned", severity: "warning" },
      hint("relation.not-allowed", { severity: "error" }),
      hint("trace.no-parent"),
      hint("element.unknown-property"),
    ];
    expect(openHints(problems).map((p) => p.code)).toEqual([
      "element.unknown-property",
      "trace.no-parent",
      "relation.outdated",
    ]);
    expect(openHints(undefined)).toEqual([]);
  });

  it("counts the outdated relations, references and replacements apart from the other hints (SR-114 AK2)", () => {
    expect(
      hintCounts([hint("relation.outdated"), hint("variant.core-changed"), hint("trace.cycle")]),
    ).toEqual({ outdated: 2, other: 1 });
  });
});
