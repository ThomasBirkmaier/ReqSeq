import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { licenseAllowed, licenseTexts } from "./policy.mjs";

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    fs.rmSync(r, { recursive: true, force: true });
  }
});

describe("licence policy (ADR-0015)", () => {
  it.each([
    ["MIT", true],
    ["(MIT)", true],
    ["(Apache-2.0 OR MIT)", true],
    ["MIT OR GPL-3.0-only", true],
    ["MIT AND BSD-3-Clause", true],
    ["(MIT OR Apache-2.0) AND BSD-3-Clause", true],
    ["GPL-3.0-only OR (MIT AND ISC)", true],
    ["MIT AND ISC OR GPL-3.0-only", true],
    ["GPL-3.0-only", false],
    ["MIT AND GPL-3.0-only", false],
    ["GPL-3.0-only AND (MIT OR Apache-2.0)", false],
    ["(MIT OR Apache-2.0) AND Unicode-3.0", false],
    ["Apache-2.0 WITH LLVM-exception", false],
    ["MIT WITH x OR ISC", false],
    ["Apache-2.0+", false],
    ["LicenseRef-MIT", false],
    ["(MIT", false],
    ["MIT)", false],
    ["MIT OR", false],
    ["AND MIT", false],
    ["MIT ISC", false],
    ["()", false],
    ["", false],
    ["MIT, ISC", false],
    ["Unknown", false],
  ])("evaluates %j as %s and fails closed on anything it cannot parse", (expression, allowed) => {
    expect(licenseAllowed(expression)).toBe(allowed);
  });

  it("refuses a licence that is no string", () => {
    expect(licenseAllowed(undefined)).toBe(false);
    expect(licenseAllowed({ type: "MIT" })).toBe(false);
  });

  it("reads the licence files of a package, also those in a folder named LICENSE, in name order", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-"));
    roots.push(dir);
    fs.mkdirSync(path.join(dir, "LICENSE", "deeper"), { recursive: true });
    fs.writeFileSync(path.join(dir, "LICENSE", "LICENSE"), "own");
    fs.writeFileSync(path.join(dir, "LICENSE", "LICENSE-other"), "other");
    fs.writeFileSync(path.join(dir, "NOTICE.md"), "notice");
    fs.writeFileSync(path.join(dir, "COPYING"), "copying");
    fs.writeFileSync(path.join(dir, "index.js"), "code");
    expect(licenseTexts(dir)).toEqual(["copying", "own", "other", "notice"]);
  });
});
