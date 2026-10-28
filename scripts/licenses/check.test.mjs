import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { licenseProblems } from "./check.mjs";

const MIT = "The MIT License (MIT)\n\nPermission is hereby granted ...\n";
const ANY_SHA = "0".repeat(64);

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    fs.rmSync(r, { recursive: true, force: true });
  }
});

/** A package folder with a `license` file of `text`. */
const pkg = (text) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "licenses-"));
  roots.push(root);
  if (text !== undefined) {
    fs.writeFileSync(path.join(root, "license"), text);
  }
  return root;
};

const shaOf = (text) => createHash("sha256").update(text).digest("hex");

const unknown = (name, version, folder) => ({
  Unknown: [{ name, versions: [version], paths: [folder], license: "Unknown" }],
});

describe("licenses:check (ADR-0015)", () => {
  it("accepts packages of the allowlist and SPDX alternatives of which one is allowed", () => {
    expect(
      licenseProblems(
        {
          MIT: [{ name: "a", versions: ["1.0.0"], paths: ["/x"] }],
          "(MPL-2.0 OR Apache-2.0)": [{ name: "b", versions: ["2.0.0"], paths: ["/y"] }],
        },
        {},
      ),
    ).toEqual([]);
  });

  it("rejects a license outside the allowlist", () => {
    expect(
      licenseProblems({ "EPL-2.0": [{ name: "elkjs", versions: ["0.9.3"], paths: ["/e"] }] }, {}),
    ).toEqual(["license not allowed (ADR-0015): elkjs@0.9.3: EPL-2.0"]);
  });

  it("rejects an unknown license that has no verified license file", () => {
    expect(licenseProblems(unknown("khroma", "2.1.0", pkg(MIT)), {})).toEqual([
      "license not allowed (ADR-0015): khroma@2.1.0: Unknown",
    ]);
  });

  it("accepts an unknown license whose license file is the verified one, by name, version and sha256", () => {
    const verified = { "khroma@2.1.0": { license: "MIT", file: "license", sha256: shaOf(MIT) } };
    expect(licenseProblems(unknown("khroma", "2.1.0", pkg(MIT)), verified)).toEqual([]);
  });

  it("rejects another version, another text or a missing file of a verified package", () => {
    const verified = { "khroma@2.1.0": { license: "MIT", file: "license", sha256: shaOf(MIT) } };
    expect(licenseProblems(unknown("khroma", "2.2.0", pkg(MIT)), verified)).toEqual([
      "license not allowed (ADR-0015): khroma@2.2.0: Unknown",
      "verified license file of khroma@2.1.0 is not used by any production package: remove the entry",
    ]);
    const changed = licenseProblems(unknown("khroma", "2.1.0", pkg(`${MIT}\nExtra clause.\n`)), verified);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(
      /^license file of khroma@2\.1\.0 is not the verified MIT text \(ADR-0015\): license sha256 [0-9a-f]{64}$/,
    );
    expect(licenseProblems(unknown("khroma", "2.1.0", pkg(undefined)), verified)).toEqual([
      "license file of khroma@2.1.0 is not the verified MIT text (ADR-0015): license sha256 missing",
    ]);
  });

  it("rejects a verified entry whose license is outside the allowlist", () => {
    const verified = { "x@1.0.0": { license: "EPL-2.0", file: "license", sha256: shaOf(MIT) } };
    expect(licenseProblems(unknown("x", "1.0.0", pkg(MIT)), verified)).toEqual([
      `license file of x@1.0.0 is not the verified EPL-2.0 text (ADR-0015): license sha256 ${shaOf(MIT)}`,
    ]);
  });

  it("rejects a verified entry no production package uses (no stale exceptions)", () => {
    expect(
      licenseProblems({}, { "gone@1.0.0": { license: "MIT", file: "license", sha256: ANY_SHA } }),
    ).toEqual([
      "verified license file of gone@1.0.0 is not used by any production package: remove the entry",
    ]);
  });
});
