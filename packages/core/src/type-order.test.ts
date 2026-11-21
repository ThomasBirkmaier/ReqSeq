import { describe, expect, it } from "vitest";
import { inTypeOrder } from "./type-order.js";

describe("type order", () => {
  it("puts the metamodel's types in its order, then unknown keys in the order given", () => {
    const types = [{ key: "need" }, { key: "requirement" }];
    expect(inTypeOrder(["zeta", "requirement", "alpha", "need"], (key) => key, types)).toEqual([
      "need",
      "requirement",
      "zeta",
      "alpha",
    ]);
  });
});
