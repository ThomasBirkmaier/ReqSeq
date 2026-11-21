import { describe, expect, it } from "vitest";
import { elementRef, invalidStatusKeys } from "./element-ref.js";

describe("elementRef", () => {
  const invalid = invalidStatusKeys({ statuses: [{ key: "obsolete", invalid: true }, { key: "draft" }] });
  const base = { id: "e", repository: "spec", type: "t", shortId: "X-e", title: "T" };

  it("keeps the identifier, status and file it has and marks an invalid status (D-044)", () => {
    expect(elementRef({ ...base, identifier: "SR-1", status: "obsolete", file: "e.md" }, invalid)).toEqual({
      ...base,
      identifier: "SR-1",
      status: "obsolete",
      invalid: true,
      file: "e.md",
    });
  });

  it("leaves out what the element does not have", () => {
    expect(elementRef(base, invalid)).toEqual({ ...base, invalid: false });
  });
});
