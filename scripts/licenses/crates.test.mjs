import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crateNotices, crateProblems, offersMit, parseTree, spdxOf } from "./crates.mjs";

const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

/** A crate folder with `files`. */
const crateFolder = (files) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "crate-"));
  folders.push(folder);
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(folder, name), text);
  }
  return folder;
};

describe("crates.mjs", () => {
  it("reads each crate of cargo tree once and leaves out the workspace's own", () => {
    const text = [
      "shell v0.0.0 (/repo/packages/shell/shell)|UNLICENSED",
      "launcher v0.0.0 (C:\\repo\\packages\\shell\\launcher)|UNLICENSED",
      "url v2.5.9|MIT OR Apache-2.0",
      "url v2.5.9|MIT OR Apache-2.0 (*)",
      "icu_normalizer v2.4.0|Unicode-3.0",
      "nameless v1.0.0|",
      "",
    ].join("\n");
    expect(parseTree(text)).toEqual([
      { name: "url", version: "2.5.9", license: "MIT OR Apache-2.0" },
      { name: "icu_normalizer", version: "2.4.0", license: "Unicode-3.0" },
      { name: "nameless", version: "1.0.0", license: null },
    ]);
  });

  it("reads the old slash spelling as OR and names every crate outside the allowlist", () => {
    expect(spdxOf("MIT/Apache-2.0")).toBe("MIT OR Apache-2.0");
    expect(spdxOf("Apache-2.0 / MIT")).toBe("Apache-2.0 OR MIT");
    expect(
      crateProblems([
        { name: "a", version: "1.0.0", license: "MIT/Apache-2.0" },
        { name: "b", version: "1.0.0", license: "Zlib" },
        { name: "c", version: "1.0.0", license: null },
        { name: "b", version: "1.0.0", license: "Zlib" },
        { name: "e", version: "1.0.0", license: "(MIT OR Apache-2.0) AND Unicode-3.0" },
        { name: "d", version: "1.0.0", license: "Apache-2.0 WITH LLVM-exception" },
      ]),
    ).toEqual([
      "b@1.0.0: Zlib",
      "c@1.0.0: no licence in its manifest",
      "d@1.0.0: Apache-2.0 WITH LLVM-exception",
    ]);
  });

  it("gives each crate's licence files, the MIT text for an MIT crate without one, and names the rest", () => {
    const packages = new Map([
      ["icu_normalizer@2.4.0", { folder: crateFolder({ LICENSE: "UNICODE LICENSE V3\n" }), authors: [] }],
      [
        "url@2.5.9",
        {
          folder: crateFolder({ "LICENSE-MIT": "MIT text\n", "LICENSE-APACHE": "Apache text\n" }),
          authors: [],
        },
      ],
      ["objc2@0.6.5", { folder: crateFolder({ "README.md": "" }), authors: ["A <a@example.org>"] }],
      ["block@0.1.0", { folder: crateFolder({}), authors: [] }],
      ["zlib-only@1.0.0", { folder: crateFolder({}), authors: [] }],
    ]);
    const crates = [
      { name: "url", version: "2.5.9", license: "MIT OR Apache-2.0" },
      { name: "icu_normalizer", version: "2.4.0", license: "Unicode-3.0" },
      { name: "objc2", version: "0.6.5", license: "MIT" },
      { name: "block", version: "0.1.0", license: "Zlib/MIT" },
      { name: "url", version: "2.5.9", license: "MIT OR Apache-2.0" },
      { name: "zlib-only", version: "1.0.0", license: "Zlib" },
      { name: "nameless", version: "1.0.0", license: null },
      { name: "gone", version: "1.0.0", license: "MIT" },
    ];
    packages.set("nameless@1.0.0", { folder: crateFolder({}), authors: [] });
    const { entries, problems } = crateNotices(
      crates,
      (key) => packages.get(key),
      "Permission is hereby granted\n",
    );
    expect(entries).toEqual([
      {
        name: "block",
        version: "0.1.0",
        license: "Zlib OR MIT",
        texts: [
          "The crate ships no licence file; its manifest names Zlib OR MIT. The MIT text:\n\nPermission is hereby granted",
        ],
      },
      { name: "icu_normalizer", version: "2.4.0", license: "Unicode-3.0", texts: ["UNICODE LICENSE V3"] },
      {
        name: "objc2",
        version: "0.6.5",
        license: "MIT",
        texts: [
          "The crate ships no licence file; its manifest names MIT by A <a@example.org>. The MIT text:\n\nPermission is hereby granted",
        ],
      },
      { name: "url", version: "2.5.9", license: "MIT OR Apache-2.0", texts: ["Apache text", "MIT text"] },
    ]);
    expect(problems).toEqual([
      "gone@1.0.0: not in cargo metadata",
      "nameless@1.0.0: no licence file, and its licence (none) offers no MIT text",
      "zlib-only@1.0.0: no licence file, and its licence Zlib offers no MIT text",
    ]);
    expect([
      offersMit("MIT"),
      offersMit("Apache-2.0/MIT"),
      offersMit("(MIT OR Apache-2.0) AND Unicode-3.0"),
    ]).toEqual([true, true, false]);
  });
});
