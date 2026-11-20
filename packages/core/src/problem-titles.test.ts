import { describe, expect, it } from "vitest";
import { PROBLEM_TITLES, problemTitle } from "./problem-titles.js";

describe("the titles of the problem kinds (SR-224 AK6)", () => {
  it("give the title of a problem kind by its code (runtime/contracts.test.ts checks them all)", () => {
    expect(PROBLEM_TITLES["relation.outdated"]).toBe("Outdated relation");
    expect(problemTitle("relation.outdated")).toBe("Outdated relation");
  });

  it("give no title for a code that is no problem kind, also not one of an object's own keys", () => {
    expect(problemTitle("no.such-kind")).toBeUndefined();
    expect(problemTitle("toString")).toBeUndefined();
  });
});
