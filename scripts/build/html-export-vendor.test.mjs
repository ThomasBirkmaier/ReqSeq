// The vendor files of the HTML export (SR-231 AK5): what a bundled script may hold, and KaTeX's fonts inlined.
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inlineFonts, scriptProblems, vendorComplete, VENDOR } from "./html-export-vendor.mjs";

describe("scriptProblems", () => {
  it("names eval, new Function and a dynamic import, and nothing in a plain script", () => {
    expect(scriptProblems("a.evaluate(1);x.imports(2)")).toEqual([]);
    expect(scriptProblems('eval ("1");new Function("x");import("./a.js")')).toEqual([
      "eval",
      "new Function",
      "a dynamic import",
    ]);
  });
});

describe("inlineFonts", () => {
  it("inlines each woff2 font once read and drops the woff and ttf entries", async () => {
    const css =
      '@font-face{src:url(fonts/A.woff2) format("woff2"),url(fonts/A.woff) format("woff"),url(fonts/A.ttf) format("truetype")}b{src:url(fonts/A.woff2)}';
    const read = (name) => Promise.resolve(Buffer.from(name));
    const base64 = Buffer.from("A.woff2").toString("base64");
    await expect(inlineFonts(css, read)).resolves.toBe(
      `@font-face{src:url(data:font/woff2;base64,${base64}) format("woff2")}b{src:url(data:font/woff2;base64,${base64})}`,
    );
    await expect(inlineFonts("a{b:url(x.png)}", read)).rejects.toThrow("no inlined woff2 font");
  });
});

describe("vendorComplete", () => {
  it("tells whether every vendor file is in a folder", async () => {
    await expect(vendorComplete()).resolves.toBe(true);
    expect(VENDOR).toMatch(/vendor[\\/]html-export$/u);
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "html-export-vendor-"));
    try {
      await expect(vendorComplete(empty)).resolves.toBe(false);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});
