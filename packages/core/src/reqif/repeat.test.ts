// The relation edits of a repeated delivery (SR-056, ADR-0013 "Import"): the items to elements of
// the source follow the delivery, every other item stays.
import { describe, expect, it } from "vitest";
import { relationEdits } from "./repeat.js";

const OWN = "6f1c2a3b-4d5e-4f60-9a7b-c0ffe0000001";
const OTHER = "6f1c2a3b-4d5e-4f60-9a7b-c0ffe0000002";
const ids = new Set([OWN]);

describe("relationEdits (SR-056)", () => {
  it("leaves equal items of the source alone, also with their repository", () => {
    const stored = [
      { id: OWN, version: "n1:1", repository: "sensor", title: "x" },
      { id: OTHER, version: "n1:2" },
    ];
    expect(
      relationEdits({ k: stored }, "k", [{ id: OWN, version: "n1:1", repository: "sensor" }], ids),
    ).toEqual([]);
    expect(relationEdits({}, "k", [], ids)).toEqual([]);
  });

  it("replaces the items of the source and keeps the others", () => {
    const stored = [
      { id: OTHER, version: "n1:2" },
      { id: OWN, version: "n1:1" },
    ];
    expect(relationEdits({ k: stored }, "k", [{ id: OWN, version: "n1:3" }], ids)).toEqual([
      { kind: "remove-item", key: "k", index: 1 },
      { kind: "append-item", key: "k", value: { id: OWN, version: "n1:3" } },
    ]);
    expect(relationEdits({ k: [{ id: OWN, version: "n1:1" }] }, "k", [], ids)).toEqual([
      { kind: "remove", key: "k" },
    ]);
    expect(relationEdits({}, "k", [{ id: OWN, version: "n1:1" }], ids)).toEqual([
      { kind: "set", key: "k", value: [{ id: OWN, version: "n1:1" }] },
    ]);
  });

  it("turns one stored target into a list, dropping it when it is an element of the source", () => {
    const own = { id: OWN, version: "n1:1" };
    const other = { id: OTHER, version: "n1:2" };
    expect(relationEdits({ k: own }, "k", [], ids)).toEqual([{ kind: "remove", key: "k" }]);
    expect(relationEdits({ k: other }, "k", [{ id: OWN, version: "n1:3" }], ids)).toEqual([
      { kind: "set", key: "k", value: [other, { id: OWN, version: "n1:3" }] },
    ]);
  });
});
