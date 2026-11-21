import { describe, expect, it } from "vitest";
import { EMPTY_VALUE, NO_NAMES, boundNote, emptyValueLabel, relationGroupLabel, shownId } from "./labels.js";

const NAMES = {
  relations: [
    { key: "based-on", name: "Based on", "inverse-name": "Basis for" },
    { key: "relates-to", name: "Relates to" },
  ],
  properties: [{ key: "packages", name: "Packages" }],
};

describe("relationGroupLabel", () => {
  it("names an outgoing kind by its name, an incoming one by its inverse name, else its name", () => {
    expect(relationGroupLabel({ kind: "based-on", direction: "out" }, NAMES)).toBe("Based on");
    expect(relationGroupLabel({ kind: "based-on", direction: "in" }, NAMES)).toBe("← Basis for");
    expect(relationGroupLabel({ kind: "relates-to", direction: "in" }, NAMES)).toBe("← Relates to");
  });

  it("names a relation property by its name, an inline reference by its word, and a key without a name by itself", () => {
    expect(relationGroupLabel({ kind: "packages", property: true, direction: "in" }, NAMES)).toBe(
      "← Packages",
    );
    expect(relationGroupLabel({ kind: "owners", property: true, direction: "in" }, NAMES)).toBe("← owners");
    expect(relationGroupLabel({ direction: "in" }, NAMES)).toBe("← inline reference");
    expect(relationGroupLabel({ kind: "refines", direction: "out" }, NO_NAMES)).toBe("refines");
    expect(relationGroupLabel({ kind: "refines", direction: "in" }, NO_NAMES)).toBe("← refines");
  });
});

describe("the shared words", () => {
  it("shows a missing value as a dash, the ID with its identifier, and the note of a bound", () => {
    expect(emptyValueLabel(undefined)).toBe(EMPTY_VALUE);
    expect(emptyValueLabel("")).toBe("–");
    expect(emptyValueLabel("draft")).toBe("draft");
    expect(shownId("SR-3c90b0", "SR-036")).toBe("SR-3c90b0 (SR-036)");
    expect(shownId("SR-3c90b0", " ")).toBe("SR-3c90b0");
    expect(shownId("SR-3c90b0")).toBe("SR-3c90b0");
    expect(boundNote(100)).toBe("Only the nearest 100 are shown.");
  });
});
