import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Metamodel } from "./index.js";
import { MEANINGS, loadMetamodel, metamodelState } from "./index.js";

const fixture = async (options: FixtureOptions = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-011/split-folder", ...options });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const load = async (root: string): Promise<Metamodel> => open(root).get(metamodelState);

/** The keys of the four lists, to compare what was read. */
const keys = (
  metamodel: Metamodel,
): Record<"types" | "properties" | "relations" | "statuses", readonly string[]> => ({
  types: metamodel.types.map((t) => t.key),
  properties: metamodel.properties.map((p) => p.key),
  relations: metamodel.relations.map((r) => r.key),
  statuses: metamodel.statuses.map((s) => s.key),
});

const SPLIT_FOLDER_KEYS = {
  types: ["need", "system-requirement", "variant"],
  properties: ["title", "wind-class"],
  relations: ["derives-from"],
  statuses: ["draft", "accepted", "rejected"],
};

const YML_WARNING = {
  code: "metamodel.invalid",
  severity: "warning",
  repository: "system",
  file: "model/legacy.yml",
  message: "model/legacy.yml is not read: metamodel files end in .yaml",
};

/** A metamodel file with one status, the initial one; `extra` is added to the file. */
const statusFile = (key: string, extra = ""): string =>
  `logreq-metamodel: 1\nstatuses:\n  - key: ${key}\n    name: ${key}\n    initial: true\n${extra}`;

describe("loadMetamodel", () => {
  it("[SR-011/AK1] reads types, properties, relation kinds and statuses only from the YAML files of the named folder", async () => {
    const ws = await fixture();
    const metamodel = await load(ws.root);
    // Not read: metamodel/ (not named), model/sub/, model/notes.md, model/legacy.yml.
    expect(keys(metamodel)).toEqual(SPLIT_FOLDER_KEYS);
    expect(metamodel.files).toEqual([
      "model/core-types.yaml",
      "model/properties.yaml",
      "model/relations.yaml",
      "model/statuses.yaml",
      "model/variant-types.yaml",
    ]);
    expect(metamodel).toMatchObject({ repository: "system", path: "model", valid: true });
    expect(metamodel.problems).toEqual([YML_WARNING]);
  });

  it("[SR-011/AK1] keeps every definition as written in its file", async () => {
    const metamodel = await load((await fixture()).root);
    expect(metamodel.properties).toEqual([
      { key: "title", name: "Title", kind: "text", meaning: "title" },
      {
        key: "wind-class",
        name: "Wind class",
        kind: "choice",
        content: true,
        choices: [
          { key: "low", name: "Low" },
          { key: "high", name: "High" },
        ],
      },
    ]);
    expect(metamodel.relations).toEqual([
      { key: "derives-from", name: "Derives from", "inverse-name": "Derived by", meaning: "derivation" },
    ]);
    expect(metamodel.statuses).toEqual([
      { key: "draft", name: "Draft", initial: true },
      { key: "accepted", name: "Accepted" },
      { key: "rejected", name: "Rejected", invalid: true },
    ]);
    expect(metamodel.types[2]).toEqual({
      key: "variant",
      name: "Variant",
      prefix: "VAR",
      meaning: "variant",
      properties: ["title"],
      required: ["title"],
    });
  });

  it("[SR-011/AK1] reads the metamodel from a folder in another repository of the workspace", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "system/logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: models, url: y }\nmetamodel: { repository: models, path: shared/mm }\n",
        "system/mm/decoy.yaml": statusFile("decoy"),
        "models/shared/mm/statuses.yaml": statusFile("open"),
      },
    });
    onTestFinished(() => ws.cleanup());
    const metamodel = await load(ws.path("system"));
    expect(metamodel).toMatchObject({ repository: "models", path: "shared/mm", valid: true, problems: [] });
    expect(metamodel.files).toEqual(["shared/mm/statuses.yaml"]);
    expect(keys(metamodel).statuses).toEqual(["open"]);
  });

  it("[SR-011/AK2] works with the metamodel of the checked-out state after each checkout", async () => {
    const ws = await fixture({ git: true });
    await ws.git(["checkout", "--quiet", "-b", "other"]);
    await fs.rm(ws.path("model/variant-types.yaml"));
    await ws.write("model/statuses.yaml", statusFile("open"));
    await ws.commit(".", "other metamodel");
    await ws.git(["checkout", "--quiet", "main"]);

    const workspace = open(ws.root);
    expect(keys(await workspace.get(metamodelState))).toEqual(SPLIT_FOLDER_KEYS);

    await ws.git(["checkout", "--quiet", "other"]);
    // A reset (what the watcher does on a change, SR-007, SR-015) and a new workspace object read it again.
    await workspace.reset(metamodelState);
    const other = { ...SPLIT_FOLDER_KEYS, types: ["need", "system-requirement"], statuses: ["open"] };
    expect(keys(await workspace.get(metamodelState))).toEqual(other);
    expect(keys(await load(ws.root))).toEqual(other);

    await ws.git(["checkout", "--quiet", "main"]);
    await workspace.reset(metamodelState);
    expect(keys(await workspace.get(metamodelState))).toEqual(SPLIT_FOLDER_KEYS);
    expect(keys(await load(ws.root))).toEqual(SPLIT_FOLDER_KEYS);
  });

  it("[SR-011/AK2] follows a checkout that moves the metamodel folder in the workspace file", async () => {
    const ws = await fixture({ git: true });
    await ws.git(["checkout", "--quiet", "-b", "moved"]);
    await ws.write(
      "logreq-workspace.yaml",
      "logreq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: metamodel }\n",
    );
    await ws.commit(".", "move metamodel");

    const workspace = open(ws.root);
    expect(await workspace.get(metamodelState)).toMatchObject({
      path: "metamodel",
      files: ["metamodel/standard-model.yaml"],
    });
    await ws.git(["checkout", "--quiet", "main"]);
    // The workspace file changed: the watcher resets the layout, which resets the metamodel too.
    await workspace.reset(workspaceLayoutState);
    expect(await workspace.get(metamodelState)).toMatchObject({ path: "model", valid: true });
    expect(keys(await workspace.get(metamodelState))).toEqual(SPLIT_FOLDER_KEYS);
  });

  it("[SR-011/AK2] reads the files of the working tree, not of the last commit", async () => {
    const ws = await fixture({ git: true });
    await ws.write("model/statuses.yaml", statusFile("uncommitted"));
    expect(keys(await load(ws.root)).statuses).toEqual(["uncommitted"]);
    expect(await ws.git(["status", "--porcelain"])).toBe(" M model/statuses.yaml\n");
  });

  it("[SR-011/AK3] reports file, line and reason of a metamodel file with faulty YAML", async () => {
    const ws = await fixture({
      files: { "model/statuses.yaml": "logreq-metamodel: 1\nstatuses:\n  - key: draft\n    name: [Draft\n" },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    const faulty = metamodel.problems.filter((p) => p.severity === "error");
    expect(faulty).toEqual([
      {
        code: "file.invalid-yaml",
        severity: "error",
        repository: "system",
        file: "model/statuses.yaml",
        line: 4,
        message: expect.stringMatching(/^Invalid YAML at line 4, column \d+: .+/) as unknown,
      },
    ]);
    // The faulty file contributes nothing; the valid files are still read.
    expect(keys(metamodel)).toEqual({ ...SPLIT_FOLDER_KEYS, statuses: [] });
  });

  it("reports a schema violation with file and line and leaves the file out", async () => {
    const ws = await fixture({
      files: {
        "model/variant-types.yaml":
          "logreq-metamodel: 1\ntypes:\n  - key: variant\n    name: Variant\n    colour: red\n  - key: package\n    name: Package\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems.filter((p) => p.severity === "error")).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/variant-types.yaml",
        line: 3,
        message: "Invalid model/variant-types.yaml: /types/0 must have required property 'prefix'",
      },
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/variant-types.yaml",
        line: 5,
        message: "Invalid model/variant-types.yaml: /types/0 must NOT have unevaluated properties: colour",
      },
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/variant-types.yaml",
        line: 6,
        message: "Invalid model/variant-types.yaml: /types/1 must have required property 'prefix'",
      },
    ]);
    expect(keys(metamodel).types).toEqual(["need", "system-requirement"]);
  });

  it("reports an unknown list on the line of its key and a missing format version on the first line", async () => {
    const ws = await fixture({ files: { "model/statuses.yaml": "# comment\nstates: []\n" } });
    const metamodel = await load(ws.root);
    expect(
      metamodel.problems.filter((p) => p.file === "model/statuses.yaml").map((p) => [p.line, p.message]),
    ).toEqual([
      [2, "Invalid model/statuses.yaml: (root) must have required property 'logreq-metamodel'"],
      [2, "Invalid model/statuses.yaml: (root) must NOT have additional properties: states"],
    ]);
  });

  it("reports an empty metamodel file without a line", async () => {
    const ws = await fixture({ files: { "model/statuses.yaml": "# nothing yet\n" } });
    const metamodel = await load(ws.root);
    expect(metamodel.problems.filter((p) => p.file === "model/statuses.yaml")).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/statuses.yaml",
        message: "Invalid model/statuses.yaml: (root) must be object",
      },
    ]);
  });

  it("reports a key defined twice, keeps the first definition and ignores the second", async () => {
    const ws = await fixture({
      files: {
        "model/statuses.yaml": statusFile("draft", "  - key: draft\n    name: Draft again\n"),
        "model/z-more.yaml": statusFile("draft"),
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.statuses).toEqual([{ key: "draft", name: "draft", initial: true }]);
    expect(metamodel.problems.filter((p) => p.severity === "error")).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/statuses.yaml",
        line: 6,
        message: "Status key draft is already defined in model/statuses.yaml; this definition is ignored",
      },
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/z-more.yaml",
        line: 3,
        message: "Status key draft is already defined in model/statuses.yaml; this definition is ignored",
      },
    ]);
  });

  it("names the list of a key defined twice", async () => {
    const ws = await fixture({
      files: {
        "model/z-more.yaml":
          "logreq-metamodel: 1\ntypes:\n  - { key: need, name: N, prefix: N }\nproperties:\n  - { key: title, name: T, kind: text }\nrelations:\n  - { key: derives-from, name: D }\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.problems.filter((p) => p.severity === "error").map((p) => [p.line, p.message])).toEqual([
      [3, "Type key need is already defined in model/core-types.yaml; this definition is ignored"],
      [5, "Property key title is already defined in model/properties.yaml; this definition is ignored"],
      [
        7,
        "Relation kind key derives-from is already defined in model/relations.yaml; this definition is ignored",
      ],
    ]);
  });

  it("reports keys defined twice in file order, and in line order within a file", async () => {
    const ws = await fixture({
      files: {
        "model/z-more.yaml":
          "logreq-metamodel: 1\nstatuses:\n  - { key: draft, name: D }\ntypes:\n  - { key: need, name: N, prefix: N }\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.problems.filter((p) => p.severity === "error").map((p) => [p.file, p.line])).toEqual([
      ["model/z-more.yaml", 3],
      ["model/z-more.yaml", 5],
    ]);
    // The first definitions, in core-types.yaml and statuses.yaml, are kept.
    expect(metamodel.types.find((t) => t.key === "need")?.name).toBe("Need");
    expect(metamodel.statuses.find((t) => t.key === "draft")?.name).toBe("Draft");
  });

  it("reports a relation kind key that a property already uses and ignores the relation kind", async () => {
    const ws = await fixture({
      files: { "model/z-more.yaml": "logreq-metamodel: 1\nrelations:\n  - { key: title, name: Title of }\n" },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(keys(metamodel).relations).toEqual(["derives-from"]);
    expect(metamodel.problems.filter((p) => p.severity === "error")).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/z-more.yaml",
        line: 3,
        message:
          "Relation kind key title is already used by a property in model/properties.yaml; this definition is ignored",
      },
    ]);
  });

  it("reports a property key that a relation kind already uses, in the order of the file", async () => {
    const ws = await fixture({
      files: {
        "model/z-more.yaml":
          "logreq-metamodel: 1\nrelations:\n  - { key: parent, name: Parent }\nproperties:\n  - { key: parent, name: Parent, kind: text }\n  - { key: derives-from, name: D, kind: text }\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(keys(metamodel)).toMatchObject({
      properties: ["title", "wind-class"],
      relations: ["derives-from", "parent"],
    });
    expect(metamodel.problems.filter((p) => p.severity === "error").map((p) => [p.line, p.message])).toEqual([
      [
        5,
        "Property key parent is already used by a relation kind in model/z-more.yaml; this definition is ignored",
      ],
      [
        6,
        "Property key derives-from is already used by a relation kind in model/relations.yaml; this definition is ignored",
      ],
    ]);
  });

  it("reports types in source-types and target-types that are not defined, on the line of each", async () => {
    const ws = await fixture({
      files: {
        "model/z-more.yaml": [
          "logreq-metamodel: 1",
          "properties:",
          "  - key: parent",
          "    name: Parent",
          "    kind: relation",
          "    target-types: [need, nede]",
          "relations:",
          "  - key: refines",
          "    name: Refines",
          "    source-types:",
          "      - system-requirement",
          "      - requirement",
          "    target-types:",
          "      - variant",
          "      - feature",
          "",
        ].join("\n"),
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    // The definitions are kept as written.
    expect(metamodel.relations.find((r) => r.key === "refines")?.["source-types"]).toEqual([
      "system-requirement",
      "requirement",
    ]);
    expect(metamodel.problems.filter((p) => p.severity === "error")).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/z-more.yaml",
        line: 6,
        message: "Property parent names type nede in target-types, which is not defined",
      },
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/z-more.yaml",
        line: 12,
        message: "Relation kind refines names type requirement in source-types, which is not defined",
      },
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/z-more.yaml",
        line: 15,
        message: "Relation kind refines names type feature in target-types, which is not defined",
      },
    ]);
  });

  it("reports a metamodel without an initial status on the first status", async () => {
    const ws = await fixture({
      files: {
        "model/statuses.yaml":
          "logreq-metamodel: 1\nstatuses:\n  - { key: draft, name: Draft }\n  - { key: done, name: Done, initial: false }\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems.filter((p) => p.severity === "error")).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model/statuses.yaml",
        line: 3,
        message: "No status is initial; exactly one status must have initial: true",
      },
    ]);
  });

  it("reports every further initial status on its line", async () => {
    const ws = await fixture({
      files: {
        "model/z-more.yaml":
          "logreq-metamodel: 1\nstatuses:\n  - { key: open, name: Open, initial: true }\n  - key: new\n    name: New\n    initial: true\n  - { key: closed, name: Closed, initial: false }\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(
      metamodel.problems.filter((p) => p.severity === "error").map((p) => [p.file, p.line, p.message]),
    ).toEqual([
      [
        "model/z-more.yaml",
        3,
        "Status open is initial, but status draft in model/statuses.yaml is already initial; exactly one status must have initial: true",
      ],
      [
        "model/z-more.yaml",
        6,
        "Status new is initial, but status draft in model/statuses.yaml is already initial; exactly one status must have initial: true",
      ],
    ]);
  });

  it("reports a metamodel without statuses on the folder", async () => {
    const ws = await fixture();
    await fs.rm(ws.path("model/statuses.yaml"));
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems.filter((p) => p.severity === "error")).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model",
        message: "No status is initial; exactly one status must have initial: true",
      },
    ]);
  });

  it("does not report a missing initial status or type while a file is faulty, which may define them", async () => {
    const ws = await fixture({
      files: {
        "model/statuses.yaml": "logreq-metamodel: 1\nstatuses: [\n",
        "model/z-more.yaml":
          "logreq-metamodel: 1\nrelations:\n  - { key: refines, name: Refines, target-types: [feature] }\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems.filter((p) => p.severity === "error").map((p) => [p.code, p.file])).toEqual([
      ["file.invalid-yaml", "model/statuses.yaml"],
    ]);
  });

  it("reports a further initial status also while a file is faulty", async () => {
    const ws = await fixture({
      files: {
        "model/z-more.yaml": statusFile("open"),
        "model/z-faulty.yaml": "logreq-metamodel: 1\nstatuses: [\n",
      },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.problems.filter((p) => p.severity === "error").map((p) => [p.file, p.line])).toEqual([
      ["model/z-faulty.yaml", 2],
      ["model/z-more.yaml", 5],
    ]);
  });

  it("passes YAML warnings on without making the metamodel invalid", async () => {
    const ws = await fixture({
      files: { "model/statuses.yaml": statusFile("draft", "    description: !note open\n") },
    });
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(true);
    expect(metamodel.problems.map((p) => [p.code, p.severity, p.file])).toEqual([
      ["metamodel.invalid", "warning", "model/legacy.yml"],
      ["file.yaml-warning", "warning", "model/statuses.yaml"],
    ]);
  });

  it("skips hidden files and folders whose name ends in .yaml", async () => {
    const ws = await fixture();
    await ws.write("model/.#statuses.yaml", "not: [yaml");
    await fs.mkdir(ws.path("model/folder.yaml"));
    const metamodel = await load(ws.root);
    expect(metamodel.valid).toBe(true);
    expect(metamodel.files).not.toContain("model/.#statuses.yaml");
    expect(metamodel.files).not.toContain("model/folder.yaml");
  });

  it("reports a metamodel folder without .yaml files", async () => {
    const ws = await fixture();
    await fs.rm(ws.path("model"), { recursive: true });
    await ws.write("model/readme.md", "# Model\n");
    const metamodel = await load(ws.root);
    expect(metamodel).toEqual({
      repository: "system",
      path: "model",
      files: [],
      types: [],
      properties: [],
      relations: [],
      statuses: [],
      effectiveTypes: [],
      meanings: Object.fromEntries(Object.keys(MEANINGS).map((m) => [m, []])),
      valid: false,
      problems: [
        {
          code: "metamodel.invalid",
          severity: "error",
          repository: "system",
          file: "model",
          message: "Metamodel folder model has no .yaml files",
        },
      ],
    });
  });

  it("leaves a missing metamodel folder to the layout, which reports it", async () => {
    const ws = await fixture();
    await fs.rm(ws.path("model"), { recursive: true });
    const workspace = open(ws.root);
    const metamodel = await workspace.get(metamodelState);
    expect(metamodel).toMatchObject({ valid: false, files: [], types: [], problems: [] });
    expect((await workspace.get(workspaceLayoutState)).problems.map((p) => p.code)).toEqual([
      "metamodel.invalid",
    ]);
  });

  it("reports a metamodel folder that cannot be read", async () => {
    const ws = await fixture();
    const layout = await open(ws.root).get(workspaceLayoutState);
    await fs.rm(ws.path("model"), { recursive: true });
    const metamodel = await loadMetamodel(layout);
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model",
        message: "Cannot read metamodel folder model: ENOENT",
      },
    ]);
  });

  it("gives the message of a folder error without code", async () => {
    const ws = await fixture();
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(new Error("listing failed"));
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    expect((await load(ws.root)).problems).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "system",
        file: "model",
        message: "Cannot read metamodel folder model: listing failed",
      },
    ]);
  });

  it("reads a metamodel in the root of the main repository, but not the workspace file", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: solo, url: x }\nmetamodel: { repository: solo, path: . }\n",
        "statuses.yaml": statusFile("open"),
      },
    });
    onTestFinished(() => ws.cleanup());
    const metamodel = await load(ws.root);
    // logreq-workspace.yaml lies in the same folder but is never a metamodel file. Every other
    // .yaml file of the root is one, also an unrelated one (documented in the core README).
    expect(metamodel).toMatchObject({ files: ["statuses.yaml"], valid: true, problems: [] });
    expect(keys(metamodel).statuses).toEqual(["open"]);
  });

  it("reads logreq-workspace.yaml as a metamodel file in the root of another repository", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "system/logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: models, url: y }\nmetamodel: { repository: models, path: . }\n",
        "models/logreq-workspace.yaml": statusFile("open"),
      },
    });
    onTestFinished(() => ws.cleanup());
    const metamodel = await load(ws.path("system"));
    expect(metamodel).toMatchObject({ files: ["logreq-workspace.yaml"], valid: true });
  });

  it("names the folder of a root metamodel that has no files as .", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: solo, url: x }\nmetamodel: { repository: solo, path: . }\n",
      },
    });
    onTestFinished(() => ws.cleanup());
    expect((await load(ws.root)).problems).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        repository: "solo",
        file: ".",
        message: "Metamodel folder . has no .yaml files",
      },
    ]);
  });
});
