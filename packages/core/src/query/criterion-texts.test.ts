// Conditions and search read an acceptance criterion with its criterion key as its text (SR-204):
// the key is no value a condition compares and no word the search finds.
import { describe, expect, it } from "vitest";
import { valuesOf } from "./context.js";
import { valueTexts } from "./search-index.js";

describe("acceptance criteria with criterion keys in conditions and search (SR-204)", () => {
  it("compares the texts of a list with criteria, and a list without one as it is", () => {
    const plain = ["A", 1];
    expect(valuesOf(plain)).toBe(plain);
    expect(valuesOf([{ key: "keya", text: "A" }, "B", { id: "x" }])).toEqual(["A", "B", { id: "x" }]);
  });

  it("indexes the text of a criterion, not its key", () => {
    const out: string[] = [];
    valueTexts([{ key: "keya", text: "Given wind" }, "Given rain"], out);
    expect(out).toEqual(["Given wind", "Given rain"]);
  });
});
