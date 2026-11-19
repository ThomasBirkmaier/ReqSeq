// The vendor files of the HTML export (SR-231 AK5): a missing one stops the export before it writes.
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readVendor, VENDOR_FOLDER } from "./vendor.js";

describe("readVendor (SR-231 AK5)", () => {
  it("reads the built files, and names the folder of a missing one", async () => {
    const files = await readVendor();
    expect(files.mermaid.byteLength).toBeGreaterThan(0);
    expect(files.katex.byteLength).toBeGreaterThan(0);
    expect(VENDOR_FOLDER).toMatch(/vendor[\\/]html-export[\\/]$/u);
    const missing = path.join(os.tmpdir(), "reqseq-no-vendor");
    await expect(readVendor(missing)).rejects.toMatchObject({
      code: "internal",
      message: expect.stringContaining(missing) as unknown,
    });
  });
});
