import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { frontmatter, readMetamodel, readSpec, stageMembers, traceCheck } from "./trace-check.mjs";

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    fs.rmSync(r, { recursive: true, force: true });
  }
});

const METAMODEL = `logreq-metamodel: 1
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: obsolete, name: Obsolete, invalid: true }
`;
// Built at run time, so that trace-check does not read this file as tests of real SRs.
const tag = (id, ak) => `[${id}/AK${ak}]`;
const WORKSPACE = `logreq-workspace: 1
name: Spec
repositories:
  - { name: spec, url: "", main: true }
metamodel: { repository: spec, path: metamodel }
`;
const STAGE_3 = "cf800f25-d03d-4092-8783-334263089f89";
const QS = "7a12a8c7-43e7-4349-9453-0ac2b6d5157d";

/** A repository with the spec workspace (two SRs, two packages) and the given extra files. */
function repo(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-trace-check-"));
  roots.push(root);
  const files = {
    "spec/logreq-workspace.yaml": WORKSPACE,
    "spec/metamodel/spec-model.yaml": METAMODEL,
    "spec/package/PKG-334263089f89.md": `---\nid: ${STAGE_3}\ntype: package\nstatus: draft\ntitle: "Stufe 3"\nspec-id: "Stufe-3"\n---\n`,
    "spec/package/PKG-0ac2b6d5157d.md": `---\nid: ${QS}\ntype: package\ntitle: Querschnitt\nspec-id: Querschnitt\n---\n`,
    // Written by the converter: double-quoted values, a flow mapping per package.
    "spec/system-requirement/SR-000000000001.md": [
      "---",
      "id: 00000000-0000-4000-8000-000000000001",
      "type: system-requirement",
      "status: draft",
      'title: "Eins"',
      'spec-id: "SR-001"',
      "acceptance-criteria:",
      '  - "Gegeben a, dann b."',
      "  - 'Gegeben c: dann d.'",
      "verification-method: test",
      "packages:",
      `  - { id: ${STAGE_3}, version: n1:89fcc971400d045e, title: "Stufe 3" }`,
      "---",
      "",
      "Text.",
      "",
    ].join("\n"),
    // Written by hand or by ReqSeq: plain scalars, CRLF, another folder.
    "spec/elsewhere/SR-000000000002.md":
      "---\r\nid: 00000000-0000-4000-8000-000000000002\r\ntype: system-requirement\r\nstatus: obsolete\r\ntitle: Zwei\r\nspec-id: SR-002\r\nacceptance-criteria:\r\n  - >-\r\n    Gegeben e,\r\n    dann f.\r\nverification-method: inspection\r\npackages:\r\n  - { id: " +
      QS +
      " }\r\n---\r\n",
    "spec/README.md": "# Not an element\n",
    ...extra,
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

describe("trace-check on the ReqSeq workspace in spec/", () => {
  it("reads system requirements by their identifier, in any folder and any YAML style", () => {
    const spec = readSpec(path.join(repo(), "spec"));
    expect([...spec.srs.keys()].sort()).toEqual(["SR-001", "SR-002"]);
    expect(spec.srs.get("SR-001")).toMatchObject({
      criteria: ["Gegeben a, dann b.", "Gegeben c: dann d."],
      method: "test",
      packages: [STAGE_3],
      invalid: false,
    });
    expect(spec.srs.get("SR-002")).toMatchObject({ criteria: ["Gegeben e, dann f."], invalid: true });
  });

  it("finds the members of a stage through its package, by number or identifier in any case", () => {
    const spec = readSpec(path.join(repo(), "spec"));
    expect(stageMembers(spec, "3")).toEqual(["SR-001"]);
    expect(stageMembers(spec, "querschnitt")).toEqual(["SR-002"]);
    expect(stageMembers(spec, "4")).toBeUndefined();
  });

  it("passes when every acceptance criterion with method test has a test and others a record", () => {
    const root = repo({
      "packages/x/a.test.ts": `it("${tag("SR-001", 1)} a");\nit("${tag("SR-001", 2)} b");\n`,
      "verification/SR-002.md": "# SR-002\n",
    });
    const result = traceCheck(root, ["--stage", "3", "--require", "SR-002"]);
    expect(result.errors).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.report).toContain(
      "2 system requirements in spec/, 2 referenced acceptance criteria in tests.",
    );
    expect(result.report).toContain("| SR-002 | all | inspection | verification/SR-002.md |");
  });

  it("reports missing tests, unknown SRs and criteria, records, stages and invalid statuses", () => {
    const root = repo({
      "packages/x/a.test.ts": `it("${tag("SR-009", 1)} a");\nit("${tag("SR-001", 3)} b");\n`,
      "packages/x/b.test.ts": `it("${tag("SR-002", 1)} c");\n`,
    });
    const result = traceCheck(root, ["--stage", "Querschnitt", "--require", "SR-001,SR-404"]);
    expect(result.code).toBe(1);
    expect(result.errors).toEqual([
      "packages/x/a.test.ts:1: test refers to unknown SR-009",
      "packages/x/a.test.ts:2: SR-001 has no acceptance criterion AK3",
      "SR-001 AK1 has no test",
      "SR-001 AK2 has no test",
      "required SR-404 not found in spec/",
      "SR-002 (inspection) has no record verification/SR-002.md",
    ]);
    expect(result.warnings).toEqual(["packages/x/b.test.ts:1: SR-002 is obsolete"]);
    expect(traceCheck(root, ["--stage", "9"]).errors).toContain(
      "no package for stage 9 in spec/ (identifier Stufe-9 or 9)",
    );
  });

  it("checks that a PR body names known SRs unless it is an enabler", () => {
    const root = repo();
    const body = path.join(root, "body.txt");
    fs.writeFileSync(body, "enabler: no SR here");
    expect(traceCheck(root, ["--pr-body", body]).errors).toEqual([
      "PR names no system requirement (add SR-xxx or label enabler)",
    ]);
    expect(traceCheck(root, ["--pr-body", body, "--enabler"]).errors).toEqual([]);
    fs.writeFileSync(body, "SR-001 and SR-117, SR-117");
    expect(traceCheck(root, ["--pr-body", body]).errors).toEqual(["PR names unknown SR-117"]);
  });

  it("reports a spec ID that two system requirements share", () => {
    const root = repo({
      "spec/system-requirement/SR-000000000003.md":
        "---\nid: 00000000-0000-4000-8000-000000000003\ntype: system-requirement\nspec-id: sr-001\n---\n",
    });
    expect(traceCheck(root, []).errors).toEqual([
      "sr-001 is the spec ID of more than one system requirement",
    ]);
  });

  it("reads the metamodel from the folder the workspace file names", () => {
    const root = repo({
      "spec/logreq-workspace.yaml": [
        "logreq-workspace: 1",
        "repositories:",
        '  - { name: spec, url: "", main: true }',
        '  - { name: model, url: "", path: ../model }',
        "metamodel: { repository: model, path: mm }",
        "",
      ].join("\n"),
      "model/mm/m.yaml":
        "logreq-metamodel: 1\nproperties:\n  - { key: ref-id, name: Ref, kind: text, meaning: identifier }\n",
    });
    expect(readMetamodel(path.join(root, "spec")).identifier).toBe("ref-id");
    fs.writeFileSync(path.join(root, "spec/logreq-workspace.yaml"), "logreq-workspace: 1\n");
    expect(() => readMetamodel(path.join(root, "spec"))).toThrow(/names no metamodel folder/);
  });

  it("needs a property with the meaning identifier in the metamodel", () => {
    const root = repo({ "spec/metamodel/spec-model.yaml": "logreq-metamodel: 1\n" });
    expect(() => traceCheck(root, [])).toThrow(/no property with the meaning identifier/);
  });

  it("reads frontmatter only when it is a mapping that parses", () => {
    expect(frontmatter("---\na: 1\n---\n")).toEqual({ a: 1 });
    expect(frontmatter("﻿---\r\na: 1\r\n---")).toEqual({ a: 1 });
    expect(frontmatter("no frontmatter")).toBeUndefined();
    expect(frontmatter("---\n- a\n---\n")).toBeUndefined();
    expect(frontmatter("---\na: [\n---\n")).toBeUndefined();
  });
});
