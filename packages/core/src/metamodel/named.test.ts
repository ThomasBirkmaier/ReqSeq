import { describe, expect, it } from "vitest";
import { findNamed, listNamed } from "./named.js";

const STATUSES = [
  { key: "draft", name: "Draft" },
  { key: "in-review", name: "In Review" },
  { key: "approved", name: "Übernommen" },
];

describe("findNamed: a status or choice value by key or display name (#309)", () => {
  it("[SR-012/AK3] finds a value by its key, or by its key or name in any case", () => {
    expect(findNamed(STATUSES, "draft")).toEqual({ kind: "found", key: "draft" });
    expect(findNamed(STATUSES, "DRAFT")).toEqual({ kind: "found", key: "draft" });
    expect(findNamed(STATUSES, "in review")).toEqual({ kind: "found", key: "in-review" });
    expect(findNamed(STATUSES, "IN-REVIEW")).toEqual({ kind: "found", key: "in-review" });
    // Both Unicode normal forms of Ü.
    expect(findNamed(STATUSES, "übernommen")).toEqual({ kind: "found", key: "approved" });
    expect(findNamed(STATUSES, "Übernommen")).toEqual({ kind: "found", key: "approved" });
  });

  it("gives unknown for no fit and ambiguous for several; the exact key always wins", () => {
    expect(findNamed(STATUSES, "released")).toEqual({ kind: "unknown" });
    expect(findNamed([], "x")).toEqual({ kind: "unknown" });
    const clash = [
      { key: "low", name: "Soon" },
      { key: "soon", name: "Later" },
    ];
    expect(findNamed(clash, "soon")).toEqual({ kind: "found", key: "soon" });
    expect(findNamed(clash, "Soon")).toEqual({ kind: "ambiguous", keys: ["low", "soon"] });
  });

  it("lists values as key (Name), at most 20, and none for no values", () => {
    expect(listNamed(STATUSES)).toBe("draft (Draft), in-review (In Review), approved (Übernommen)");
    expect(listNamed([])).toBe("none");
    const many = Array.from({ length: 21 }, (_, i) => ({ key: `v${String(i)}`, name: `V${String(i)}` }));
    expect(listNamed(many)).toBe(
      `${many
        .slice(0, 20)
        .map((v) => `${v.key} (${v.name})`)
        .join(", ")}, …`,
    );
  });
});
