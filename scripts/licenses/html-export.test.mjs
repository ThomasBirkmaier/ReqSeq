// The licences of what the HTML export copies (SR-231 AK5, ADR-0015): attribution of the Mermaid bundle's sources.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundledPackages,
  checkoutNotices,
  MODULE,
  noticeEntries,
  noticesModule,
  parserSource,
  storePackage,
} from "./html-export.mjs";

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    fs.rmSync(r, { recursive: true, force: true });
  }
});

const STORE = "/r/node_modules/.pnpm";

describe("storePackage and parserSource", () => {
  it("names the package of a store path, a parser source and the bundled vscode-uri", () => {
    expect(storePackage(`${STORE}/@scope+a@1.2.3_x@1/node_modules/@scope/a/dist/i.js`)).toEqual({
      name: "@scope/a",
      version: "1.2.3",
      folder: `${STORE}/@scope+a@1.2.3_x@1/node_modules/@scope/a`,
    });
    expect(storePackage("/r/src/a.js")).toBeUndefined();
    expect(storePackage(`${STORE}/b@1.0.0/node_modules/c/i.js`)).toBeUndefined();
    const parser = { name: "@mermaid-js/parser", version: "1.0.0" };
    expect(parserSource(`${STORE}/langium@4.0.0/node_modules/langium/lib/a.js`, parser)).toEqual({
      name: "langium",
      version: "4.0.0",
    });
    expect(parserSource("../../src/language/x.ts", parser)).toBe(parser);
    expect(parserSource("webpack://LIB/node_modules/path-browserify/index.js", parser)).toEqual({
      name: "path-browserify",
      version: "1.0.1",
    });
    expect(parserSource("webpack://LIB/src/uri.ts", parser)).toEqual({
      name: "vscode-uri",
      version: "3.1.0",
    });
    expect(parserSource("elsewhere.js", parser)).toBeUndefined();
  });
});

describe("bundledPackages", () => {
  it("follows a parser chunk through its map and reports sources it cannot attribute", () => {
    const chunk = `${STORE}/@mermaid-js+parser@1.0.0/node_modules/@mermaid-js/parser/dist/chunks/c.mjs`;
    const map = {
      sources: [
        ".entry.mjs",
        `${STORE}/mermaid@11.0.0/node_modules/mermaid/dist/m.mjs`,
        `${STORE}/mermaid@11.0.0/node_modules/mermaid/dist/m.mjs`,
        chunk,
        "/r/unknown.js",
      ],
    };
    const maps = {
      [`${chunk}.map`]: { sources: ["../../src/x.ts", "webpack://LIB/src/uri.ts", "mystery.js"] },
    };
    const { packages, problems } = bundledPackages(map, "/out/mermaid.js.map", (file) => maps[file]);
    expect(packages.map((p) => `${p.name}@${p.version}`)).toEqual([
      "mermaid@11.0.0",
      "@mermaid-js/parser@1.0.0",
      "vscode-uri@3.1.0",
    ]);
    expect(problems).toEqual([
      "a chunk of @mermaid-js/parser holds code of an unknown source: mystery.js",
      "the Mermaid bundle holds code of an unknown source: /r/unknown.js",
    ]);
  });
});

describe("noticeEntries", () => {
  const folder = (manifest, files = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "html-export-licenses-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, name), text);
    }
    return root;
  };

  it("takes installed and kept licences, and reports a missing, changed or disallowed one", () => {
    const text = fs.readFileSync(path.join(import.meta.dirname, "texts", "vscode-uri@3.1.0.txt"), "utf8");
    const sha = createHash("sha256").update(text).digest("hex");
    const kept = [
      { name: "vscode-uri", version: "3.1.0", license: "MIT", file: "vscode-uri@3.1.0.txt", sha256: sha },
      { name: "bad", version: "1.0.0", license: "MIT", file: "vscode-uri@3.1.0.txt", sha256: "0".repeat(64) },
    ];
    const { entries, problems } = noticeEntries(
      [
        { name: "z", version: "1.0.0", folder: folder({ license: "MIT" }, { LICENSE: " MIT text \n" }) },
        { name: "a", version: "2.0.0", folder: folder({ license: "MIT" }) },
        { name: "gpl", version: "1.0.0", folder: folder({ license: "GPL-3.0" }) },
        { name: "vscode-uri", version: "3.1.0" },
        { name: "bad", version: "1.0.0" },
        { name: "lost", version: "1.0.0" },
      ],
      kept,
    );
    expect(entries.map((e) => [e.name, e.license, e.texts.length])).toEqual([
      ["a", "MIT", 0],
      ["vscode-uri", "MIT", 1],
      ["z", "MIT", 1],
    ]);
    expect(entries.at(-1)?.texts).toEqual(["MIT text"]);
    expect(problems).toEqual([
      "license not allowed (ADR-0015): gpl@1.0.0: GPL-3.0 (copied by the HTML export)",
      "the licence text vscode-uri@3.1.0.txt does not have the SHA-256 bundled.json names",
      "lost@1.0.0 is bundled but neither installed nor in scripts/licenses/texts/bundled.json",
    ]);
    expect(noticesModule(entries)).toContain(
      "export const VENDOR_NOTICES: readonly { readonly name: string;",
    );
  });
});

describe("the notices module of this checkout", () => {
  it("is what the bundle and KaTeX give, without problems", async () => {
    const { entries, problems } = await checkoutNotices();
    expect(problems).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(["katex", "mermaid", "langium", "dompurify"]),
    );
    expect(fs.readFileSync(MODULE, "utf8")).toBe(noticesModule(entries));
  }, 120_000);
});
