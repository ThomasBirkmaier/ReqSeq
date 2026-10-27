import { describe, expect, it } from "vitest";
import { afterSave, dirty } from "./save.js";

describe("save", () => {
  it("is dirty when the document differs from the baseline", () => {
    expect(dirty("a", "a")).toBe(false);
    expect(dirty("a ", "a")).toBe(true);
  });

  it("takes the answer as the baseline", () => {
    expect(afterSave("a\n", "a\n", "a\n")).toEqual({ baseline: "a\n" });
  });

  it("replaces the document by the answer when core added the final line break and nothing was typed meanwhile", () => {
    expect(afterSave("a", "a\n", "a")).toEqual({ baseline: "a\n", replace: "a\n" });
  });

  it("keeps the document when it changed while the save ran", () => {
    expect(afterSave("a", "a\n", "ab")).toEqual({ baseline: "a\n" });
  });
});
