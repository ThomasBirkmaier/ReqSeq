import { describe, expect, it } from "vitest";
import type { DataExportRelation } from "../generated/types.js";
import { nameOf, relationText } from "./relation-text.js";

const end = (relation: Partial<DataExportRelation>): DataExportRelation =>
  ({ id: "u-1", kind: "derives-from", direction: "out", ...relation }) as DataExportRelation;

describe("relationText", () => {
  it("names an end that is here by identifier, else short ID, with its title, and any other by what the relation knows (SR-006 AK1)", () => {
    expect(nameOf({ shortId: "SR-1", identifier: "REQ-1", title: "Wind" })).toBe("REQ-1 Wind");
    expect(nameOf({ shortId: "SR-1", title: "" })).toBe("SR-1");
    expect(relationText(end({ targetState: "available", shortId: "SR-2" }))).toBe("SR-2");
    expect(relationText(end({ targetState: "inaccessible", shortId: "UNKNOWN-1", repository: "far" }))).toBe(
      "UNKNOWN-1, repository far, not accessible",
    );
    expect(relationText(end({ targetState: "inaccessible" }))).toBe("u-1, repository , not accessible");
    expect(relationText(end({ targetState: "missing" }))).toBe("u-1, not found");
    expect(relationText(end({ targetState: "ambiguous" }))).toBe("u-1, in several files");
    expect(relationText(end({ targetState: "unknown-repository", repository: "x" }))).toBe(
      "u-1, repository x not in the workspace",
    );
  });
});
