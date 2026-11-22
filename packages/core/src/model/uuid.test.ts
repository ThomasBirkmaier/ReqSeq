import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isUuid, UUID } from "./uuid.js";

const schema = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "..", "..", "schemas", "common.schema.json"),
    "utf8",
  ),
) as { $defs: { uuid: { pattern: string } } };

describe("isUuid", () => {
  it("tests the pattern of the schema's uuid", () => {
    expect(UUID.source).toBe(schema.$defs.uuid.pattern);
  });

  it("takes a lower-case UUID version 4 and nothing else", () => {
    expect(isUuid("3f2a8c1e-5b7d-4e9f-8a6c-1d2e3f4a5b6c")).toBe(true);
    expect(isUuid("3F2A8C1E-5B7D-4E9F-8A6C-1D2E3F4A5B6C")).toBe(false);
    expect(isUuid("3f2a8c1e-5b7d-1e9f-8a6c-1d2e3f4a5b6c")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
