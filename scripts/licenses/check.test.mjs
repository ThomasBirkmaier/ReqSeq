import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { licenseProblems, packagePath, productionClosure, productionListing } from "./check.mjs";

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

const LOCK = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.14.0
        version: 12.14.0

packages:

  pnpm@12.14.0:
    resolution: {integrity: sha512-x}

snapshots:

  pnpm@12.14.0: {}
---
lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      vitest:
        specifier: 5.0.5
        version: 5.0.5

  packages/app:
    dependencies:
      '@reqseq/core':
        specifier: workspace:*
        version: link:../core
      dompurify:
        specifier: 3.4.17
        version: 3.4.17
      plugin:
        specifier: 1.0.0
        version: 1.0.0(dompurify@3.4.17)
    optionalDependencies:
      direct-optional:
        specifier: 1.0.0
        version: 1.0.0

packages:

  native-linux@1.0.0:
    resolution: {integrity: sha512-x}
    os: [linux]

snapshots:

  dompurify@3.4.17:
    optionalDependencies:
      gpl-optional: 2.0.0
      native-linux: 1.0.0

  plugin@1.0.0(dompurify@3.4.17):
    dependencies:
      dompurify: 3.4.17
      string-width-cjs: string-width@4.2.3

  direct-optional@1.0.0: {}

  gpl-optional@2.0.0: {}

  native-linux@1.0.0: {}

  string-width@4.2.3: {}

  vitest@5.0.5:
    dependencies:
      caniuse-lite: 1.0.30001819
`;

describe("licenses:check production closure (ADR-0015, pnpm 12)", () => {
  it("takes dependencies and optional dependencies of every project, transitively, without dev dependencies", () => {
    const closure = productionClosure(LOCK);
    expect([...closure.ids].sort()).toEqual([
      "direct-optional@1.0.0",
      "dompurify@3.4.17",
      "gpl-optional@2.0.0",
      "native-linux@1.0.0",
      "plugin@1.0.0",
      "string-width@4.2.3",
    ]);
    expect([...closure.platform]).toEqual(["native-linux@1.0.0"]);
  });

  it("rejects a disallowed optional dependency of a production package, and ignores dev-only packages", () => {
    const listing = productionListing(
      {
        MIT: [
          { name: "dompurify", versions: ["3.4.17"], paths: ["/d"] },
          { name: "plugin", versions: ["1.0.0"], paths: ["/p"] },
          { name: "direct-optional", versions: ["1.0.0"], paths: ["/o"] },
          { name: "string-width", versions: ["4.2.3", "5.1.2"], paths: ["/s4", "/s5"] },
        ],
        "GPL-3.0": [{ name: "gpl-optional", versions: ["2.0.0"], paths: ["/g"] }],
        "CC-BY-4.0": [{ name: "caniuse-lite", versions: ["1.0.30001819"], paths: ["/c"] }],
      },
      productionClosure(LOCK),
    );
    expect(listing.problems).toEqual([]);
    expect(listing.byLicense.MIT.find((p) => p.name === "string-width").versions).toEqual(["4.2.3"]);
    expect(listing.byLicense["CC-BY-4.0"]).toBeUndefined();
    expect(licenseProblems(listing.byLicense, {})).toEqual([
      "license not allowed (ADR-0015): gpl-optional@2.0.0: GPL-3.0",
    ]);
  });

  it("fails when a production package of the lockfile is missing from the listing (not one for other systems)", () => {
    const listing = productionListing(
      { MIT: [{ name: "dompurify", versions: ["3.4.17"], paths: ["/d"] }] },
      productionClosure(LOCK),
    );
    expect(listing.problems.sort()).toEqual([
      "production package direct-optional@1.0.0 of pnpm-lock.yaml is missing from pnpm licenses list",
      "production package gpl-optional@2.0.0 of pnpm-lock.yaml is missing from pnpm licenses list",
      "production package plugin@1.0.0 of pnpm-lock.yaml is missing from pnpm licenses list",
      "production package string-width@4.2.3 of pnpm-lock.yaml is missing from pnpm licenses list",
    ]);
  });

  it("reads the license file of the right version when pnpm lists the paths in another order", () => {
    const store = pkg(undefined);
    const v1 = path.join(store, ".pnpm", "@scope+khroma@2.1.0", "node_modules", "@scope", "khroma");
    const v2 = path.join(store, ".pnpm", "@scope+khroma@2.2.0_peer", "node_modules", "@scope", "khroma");
    fs.mkdirSync(v1, { recursive: true });
    fs.mkdirSync(v2, { recursive: true });
    fs.writeFileSync(path.join(v1, "license"), MIT);
    fs.writeFileSync(path.join(v2, "license"), "Other text\n");
    const p = { name: "@scope/khroma", versions: ["2.1.0", "2.2.0"], paths: [v2, v1] };
    expect(packagePath(p, "2.1.0")).toBe(v1);
    expect(packagePath(p, "2.2.0")).toBe(v2);
    expect(packagePath(p, "3.0.0")).toBeUndefined();
    const verified = { "@scope/khroma@2.1.0": { license: "MIT", file: "license", sha256: shaOf(MIT) } };
    expect(licenseProblems({ Unknown: [{ ...p, versions: ["2.1.0"] }] }, verified)).toEqual([]);
    expect(licenseProblems({ Unknown: [{ ...p, versions: ["2.1.0"], paths: [v2] }] }, verified)).toEqual([
      "license file of @scope/khroma@2.1.0 is not the verified MIT text (ADR-0015): license sha256 missing",
    ]);
  });
});
