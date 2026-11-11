// The pure adapter of level 2 (#1396): the files it writes for a small workspace.
import { describe, expect, it } from "vitest";
import {
  METAMODEL,
  elementFilesOf,
  elementPlaceOf,
  recordFilesOf,
  uuidOf,
  variantPlaceOf,
  workspaceFileOf,
} from "./file-render.js";
import type { ModelFileWorkspace } from "./file-workspace.js";
import type { ModelWorkspaceElement } from "./workspace-model.js";

function element(key: string, extra: Partial<ModelWorkspaceElement> = {}): ModelWorkspaceElement {
  return {
    key,
    id: "e1",
    repository: "spec",
    type: "requirement",
    invalid: false,
    emergent: false,
    validity: [],
    derivesFrom: [],
    replaces: [],
    own: { criteria: [], olderVersions: [], records: [] },
    ...extra,
  };
}

const T1 = "2026-11-01T10:00:00Z";
const files: ModelFileWorkspace = {
  base: {
    repositories: [
      { name: "spec", variantIndependent: false },
      { name: "lib", variantIndependent: true },
    ],
    variants: [
      { id: "A", repository: "lib", invalid: true, excludes: [{ id: "e1" }] },
      { id: "B", repository: "spec", invalid: false, excludes: [] },
    ],
    elements: [
      element("x0", {
        invalid: true,
        emergent: true,
        validity: ["A"],
        derivesFrom: [{ id: "e2", repository: "lib" }],
        replaces: [{ id: "e1" }],
        own: { criteria: [{ key: "alpha" }, {}], olderVersions: [], records: [] },
      }),
      element("x1", { repository: "lib", validity: ["A"] }),
      element("x2", { id: "e2", type: "need" }),
    ],
    order: [],
  },
  criteria: [undefined, [{ key: "bravo" }], undefined],
  crlf: [false, true, false],
  records: {
    e1: [
      {
        record: { kind: "verification", version: "current", date: T1, result: "passed", variant: "A" },
        pin: 1,
        form: "n1",
        format: "markdown",
        location: 1,
        crlf: true,
      },
      {
        record: {
          kind: "verification",
          version: "current",
          date: T1,
          result: "failed",
          criteria: [
            { by: "number", number: 2 },
            { by: "key", key: "alpha" },
            { by: "number", number: 2 },
          ],
          variant: "A",
        },
        pin: 0,
        form: "n2",
        format: "junit",
        location: 0,
        crlf: false,
      },
      {
        record: {
          kind: "validation",
          version: "v1",
          date: T1,
          result: "inconclusive",
          reason: "why",
          criteria: [{ by: "key", key: "alpha" }],
        },
        pin: 0,
        form: "n2",
        format: "markdown",
        location: 0,
        crlf: false,
      },
      {
        record: { kind: "verification", version: "v9", date: T1, result: "passed" },
        pin: 0,
        form: "n2",
        format: "junit",
        location: 0,
        crlf: false,
      },
      {
        record: { kind: "verification", version: "current", date: T1, result: "passed" },
        pin: 5,
        form: "n2",
        format: "markdown",
        location: 0,
        crlf: false,
      },
    ],
  },
};
const forms = (key: string) => ({ n1: `n1:${key}`, n2: `n2:${key}` });

describe("status model level-2 files", () => {
  it("names elements and variants by UUID, a folder per key, below their repository's folder", () => {
    expect(uuidOf("e1")).toBe("13961396-0000-4000-8000-000000006531");
    expect(elementPlaceOf(element("x1", { repository: "lib" }))).toEqual({
      repository: "lib",
      file: "requirements/x1/SR-000000006531.md",
      path: "lib/requirements/x1/SR-000000006531.md",
    });
    expect(elementPlaceOf(element("x2", { type: "need", repository: "other" })).path).toBe(
      "needs/x2/N-000000006531.md",
    );
    expect(variantPlaceOf({ id: "A", repository: "other" }).path).toBe("variants/VAR-000000000041.md");
    expect(workspaceFileOf(files)).toContain("path: lib, variant-independent: true }");
    expect(workspaceFileOf(files)).toContain("main: true }");
  });

  it("writes the element files with criteria, marks, relation items and line ends as generated", () => {
    const out = elementFilesOf(files);
    expect(out.get("metamodel/model.yaml")).toBe(METAMODEL);
    expect(out.get("lib/variants/VAR-000000000041.md")).toBe(
      `---\nid: ${uuidOf("A")}\ntype: variant\nstatus: obsolete\ntitle: Variant A\nexcludes:\n` +
        `  - { id: ${uuidOf("e1")}, version: n1:0000000000000000 }\n---\n`,
    );
    const x0 = out.get("requirements/x0/SR-000000006531.md") ?? "";
    expect(x0).toContain("status: obsolete\n");
    expect(x0).toContain("acceptance-criteria:\n  - key: alpha\n    text: Criterion 1\n  - Criterion 2\n");
    expect(x0).toContain('emergent: "yes"\n');
    expect(x0).toContain(
      `validity:\n  - { id: ${uuidOf("A")}, version: n1:0000000000000000, repository: lib }\n`,
    );
    expect(x0).toContain(
      `derives-from:\n  - { id: ${uuidOf("e2")}, version: n1:0000000000000000, repository: lib }\n`,
    );
    expect(x0).toContain(`replaces:\n  - { id: ${uuidOf("e1")}, version: n1:0000000000000000 }\n`);
    const x1 = out.get("lib/requirements/x1/SR-000000006531.md") ?? "";
    expect(x1).toContain("\r\n  - key: bravo\r\n");
    expect(x1).toContain(`  - { id: ${uuidOf("A")}, version: n1:0000000000000000 }\r\n`);
    expect(
      elementFilesOf({ ...files, criteria: [undefined, [], undefined] }).get(
        "lib/requirements/x1/SR-000000006531.md",
      ),
    ).not.toContain("acceptance-criteria");
    expect(out.get("needs/x2/N-000000006532.md")).toBe(
      `---\nid: ${uuidOf("e2")}\ntype: need\nstatus: draft\ntitle: Element x2\n---\n\nText of x2.\n`,
    );
  });

  it("writes each record against the version of the file it names, as Markdown or JUnit", () => {
    const out = recordFilesOf(files, forms);
    expect([...out.keys()]).toEqual([
      "lib/evidence/r-0-00.md",
      "evidence/r-0-01.xml",
      "evidence/r-0-02.md",
      "evidence/r-0-03.xml",
      "evidence/r-0-04.md",
    ]);
    expect(out.get("lib/evidence/r-0-00.md")).toBe(
      [
        "---",
        "reqseq-record: 1",
        "kind: verification",
        `element: ${uuidOf("e1")}`,
        "version: n1:x1",
        "method: test",
        `variant: ${uuidOf("A")}`,
        "item: build",
        "result: passed",
        `date: ${T1}`,
        "---",
        "",
      ].join("\r\n"),
    );
    const junit = out.get("evidence/r-0-01.xml") ?? "";
    expect(junit).toContain('<property name="reqseq:version" value="n2:x0"/>');
    expect(junit).toContain(
      `<property name="reqseq:criterion" value="${uuidOf("e1")}:2"/><property name="reqseq:criterion" value="${uuidOf("e1")}:alpha"/><property name="reqseq:item"`,
    );
    expect(junit).toContain(
      `<property name="reqseq:variant" value="${uuidOf("A")}"/></properties><failure message="failed"/>`,
    );
    const validation = out.get("evidence/r-0-02.md") ?? "";
    expect(validation).toContain("kind: validation\n");
    expect(validation).toContain("version: n2:aaaaaaaaaaaaaaaa\nresult: inconclusive\nreason: why\n");
    expect(validation).not.toContain("method:");
    expect(validation).toContain("criteria: [alpha]\n");
    expect(elementFilesOf(files).get("variants/VAR-000000000042.md")).toContain(
      "status: draft\ntitle: Variant B\n---\n",
    );
    expect(out.get("evidence/r-0-03.xml")).toContain('value="n1:0000000000000000"/>');
    expect(out.get("evidence/r-0-03.xml")).not.toContain("<failure");
    expect(out.get("evidence/r-0-04.md")).toContain("version: n1:0000000000000000\n");
  });
});
