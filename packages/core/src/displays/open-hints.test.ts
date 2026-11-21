import { describe, expect, it } from "vitest";
import { openHints } from "./open-hints.js";

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
});
