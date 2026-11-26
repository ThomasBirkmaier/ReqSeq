import { describe, expect, it } from "vitest";
import { withoutVerificationGaps } from "./index.js";

describe("gaps of verification of workspace.check (#1921)", () => {
  it("leaves out the three codes of SR-230 and keeps every other problem in its order", () => {
    const location = { code: "evidence.no-location", severity: "warning" };
    const open = { code: "evidence.open-requirements", severity: "info" };
    const criteria = { code: "evidence.no-criteria-property", severity: "warning" };
    const outdated = { code: "evidence.outdated", severity: "warning", elementId: "e1" };
    const cycle = { code: "trace.cycle", severity: "warning", elementId: "e2" };
    expect(withoutVerificationGaps([location, outdated, open, criteria, cycle])).toEqual([outdated, cycle]);
  });
});
