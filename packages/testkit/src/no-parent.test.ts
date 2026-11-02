import { describe, expect, it } from "vitest";
import { malformedNoParentHints, noParentHints, withoutNoParent, withoutParent } from "./index.js";

describe("trace.no-parent hints of the generated workspace (#659)", () => {
  it("counts the system requirements without derives-from or refines", () => {
    const files = new Map([
      ["a.md", "---\ntype: system-requirement\n---\nNo parent.\n"],
      ["b.md", "---\ntype: system-requirement\nderives-from:\n  - { id: x, version: y }\n---\n"],
      ["c.md", "---\ntype: system-requirement\nrefines:\n  - { id: x, version: y }\n---\n"],
      ["d.md", "---\ntype: need\n---\nA need has no parent.\n"],
    ]);
    expect(withoutParent(files)).toBe(1);
  });

  it("splits the hints from the other problems and finds malformed ones", () => {
    const hint = { code: "trace.no-parent", severity: "warning", elementId: "e1" };
    const error = { code: "trace.no-parent", severity: "error", elementId: "e2" };
    const loose = { code: "trace.no-parent", severity: "warning" };
    const outdated = { code: "relation.outdated", severity: "warning", elementId: "e3" };
    const problems = [hint, outdated, error, loose];
    expect(noParentHints(problems)).toEqual([hint, error, loose]);
    expect(malformedNoParentHints(problems)).toEqual([error, loose]);
    expect(withoutNoParent(problems)).toEqual([outdated]);
  });
});
