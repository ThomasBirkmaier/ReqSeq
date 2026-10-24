import { describe, expect, it } from "vitest";
import { FILE_NAME_DIGITS, fileNameFor } from "./file-name.js";

describe("fileNameFor", () => {
  it("[SR-001/AK1] is the type prefix, a dash and the last 12 hex digits of the UUID (D-056)", () => {
    expect(fileNameFor({ prefix: "SR", id: "102ee39b-773f-4cd0-b414-825b7146fb54" })).toBe(
      "SR-825b7146fb54.md",
    );
    expect(fileNameFor({ prefix: "VAR", id: "e8df96ea-a168-4d90-8d65-6328cee88fb3" })).toBe(
      "VAR-6328cee88fb3.md",
    );
    expect(FILE_NAME_DIGITS).toBe(12);
  });
});
