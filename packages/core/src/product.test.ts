import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, PRODUCT_VERSION } from "./product.js";

const rootPackage = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "..", "..", "..", "package.json"), "utf8"),
) as { readonly version: string };

describe("product", () => {
  it("carries the version of the root package.json", () => {
    expect(PRODUCT_NAME).toBe("ReqSeq");
    expect(PRODUCT_VERSION).toBe(rootPackage.version);
  });
});
