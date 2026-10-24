import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { readElementFile } from "../files/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { computeVersion } from "../version/version.js";
import type { VersionPropertyDefinition, VersionValue } from "../version/version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { ElementStore, RepositoryChanges } from "./store.js";
import { applyStoreChange, elementStoreState, loadElements, updateElements } from "./store.js";

const fixture = async (options: Parameters<typeof createFixtureWorkspace>[0]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const store = async (root: string): Promise<ElementStore> => open(root).get(elementStoreState);

const located = (s: ElementStore): (readonly [string, string, string])[] =>
  s.elements.map((e) => [e.repository, e.file, e.id] as const);

const only = (s: ElementStore, id: string): ElementRecord => {
  const records = s.byId.get(id) ?? [];
  expect(records).toHaveLength(1);
  const [record] = records;
  if (record === undefined) {
    throw new Error(`no element ${id}`);
  }
  return record;
};

/** The Markdown text of an element of the main repository, read from its file (the store keeps no text). */
const textOf = async (workspace: Workspace, element: ElementRecord): Promise<string> => {
  const read = await readElementFile(workspace.root, element.file);
  if (read.kind !== "parsed") {
    throw new Error(`cannot read ${element.file}`);
  }
  return read.file.body;
};

/** The version of an element with the property definitions of its type (ADR-0005). */
const versionOf = async (workspace: Workspace, element: ElementRecord): Promise<string> => {
  const metamodel = await workspace.get(metamodelState);
  const keys = metamodel.types.find((t) => t.key === element.type)?.properties ?? [];
  const definitions: VersionPropertyDefinition[] = metamodel.properties
    .filter((p) => keys.includes(p.key))
    .map((p) => ({ key: p.key, kind: p.kind, content: p.content === true }));
  return computeVersion({
    text: await textOf(workspace, element),
    properties: element.data as Readonly<Record<string, VersionValue>>,
    definitions,
    files: [],
  });
};

/** Bytes and modification time of every file below `folder`. */
const snapshotFiles = async (folder: string): Promise<Map<string, readonly [string, number]>> => {
  const result = new Map<string, readonly [string, number]>();
  for (const entry of await fs.readdir(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = `${entry.parentPath}/${entry.name}`;
      result.set(file, [await fs.readFile(file, "utf8"), (await fs.stat(file)).mtimeMs]);
    }
  }
  return result;
};

const element = (id: string, type = "system-requirement", extra = ""): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: draft\ntitle: T\n${extra}---\n\nText.\n`;

const ID_A = "6b1f1b9e-2a39-4c4c-9a4e-0c1d2e3f4a5b";
const ID_B = "7c2e2c0f-3b4a-4d5d-8b5f-1d2e3f4a5b6c";

describe("element store", () => {
  it("[SR-003/AK1] finds element files in any folder of the repository", async () => {
    const ws = await fixture({ fixture: "SR-003/any-folder" });
    const s = await store(ws.root);
    expect(located(s)).toEqual([
      ["system", ".drafts/SR-08322988e035.md", "f4f04e4b-8ec8-4458-942b-08322988e035"],
      ["system", "Entwürfe für Kunden/SR-50fa8b039d43.md", "0f3a6dde-b9f5-4265-a4e3-50fa8b039d43"],
      ["system", "N-480462447faf.md", "24012b6f-6ecc-4b3b-b383-480462447faf"],
      ["system", "requirements/SR-7badf5d7a1c1.md", "3d905ee5-5977-484e-adf4-7badf5d7a1c1"],
      [
        "system",
        "requirements/display/units/metric/beaufort/SR-d5e21ac79aaa.md",
        "ff261680-3a91-4e83-9f9b-d5e21ac79aaa",
      ],
    ]);
    expect(s.problems).toEqual([]);
    const deep = only(s, "ff261680-3a91-4e83-9f9b-d5e21ac79aaa");
    const { snapshot, ...rest } = deep;
    expect(snapshot.path).toBe("requirements/display/units/metric/beaufort/SR-d5e21ac79aaa.md");
    expect(rest).toEqual({
      id: "ff261680-3a91-4e83-9f9b-d5e21ac79aaa",
      type: "system-requirement",
      repository: "system",
      file: "requirements/display/units/metric/beaufort/SR-d5e21ac79aaa.md",
      data: {
        id: "ff261680-3a91-4e83-9f9b-d5e21ac79aaa",
        type: "system-requirement",
        status: "draft",
        title: "Show Beaufort scale",
      },
      eol: "\n",
      closingEol: "\n",
      bom: false,
    });
  });

  it("[SR-003/AK1] finds an element file in a new folder after the workspace is read again", async () => {
    const ws = await fixture({ fixture: "SR-003/any-folder" });
    const workspace = open(ws.root);
    expect((await workspace.get(elementStoreState)).byId.has(ID_A)).toBe(false);
    await ws.write("brand/new/folder/SR-0c1d2e3f4a5b.md", element(ID_A));
    // Kept until reset: the watcher (SR-007) resets it.
    expect((await workspace.get(elementStoreState)).byId.has(ID_A)).toBe(false);
    await workspace.reset(elementStoreState);
    expect(only(await workspace.get(elementStoreState), ID_A).file).toBe(
      "brand/new/folder/SR-0c1d2e3f4a5b.md",
    );
  });

  it("[SR-003/AK1] finds element files in any folder of a repository that is not the main one", async () => {
    const ws = await fixture({
      fixture: "SR-004/three-repositories",
      files: { "sensor/a/b/c/SR-0c1d2e3f4a5b.md": element(ID_A) },
    });
    const s = await store(ws.path("system"));
    expect(only(s, ID_A)).toMatchObject({ repository: "sensor", file: "a/b/c/SR-0c1d2e3f4a5b.md" });
  });

  it("[SR-003/AK2] does not count Markdown files without element frontmatter and leaves them unchanged", async () => {
    const ws = await fixture({ fixture: "SR-003/not-elements" });
    const before = await snapshotFiles(ws.root);
    const s = await store(ws.root);
    expect(located(s)).toEqual([
      ["system", "requirements/SR-1ee3f1697bfe.md", "e20fc471-6776-4698-bc3b-1ee3f1697bfe"],
    ]);
    expect(s.nonElements).toEqual(
      [
        "README.md",
        "docs/empty-frontmatter.md",
        "docs/list-frontmatter.md",
        "docs/notes.md",
        "docs/only-id.md",
        "docs/only-type.md",
        "docs/scalar-frontmatter.md",
        "evidence/inspection-wind-speed.md",
      ].map((file) => ({ repository: "system", file })),
    );
    expect(s.problems).toEqual([]);
    // The UUID in only-id.md is not an element: nothing can point at it.
    expect(s.byId.has("5cb1e198-1130-4a13-9d25-88cc6ebc472a")).toBe(false);
    expect(await snapshotFiles(ws.root)).toEqual(before);
  });

  it("[SR-003/AK3] keeps relations to an element valid after its file moved to another folder", async () => {
    const ws = await fixture({ fixture: "SR-003/moved" });
    const workspace = open(ws.root);
    const parentId = "224dedea-c0ac-4ec8-a228-8beffcbd8c26";
    const childId = "5cb1e198-1130-4a13-9d25-88cc6ebc472a";
    const relation = async (): Promise<{ target: ElementRecord; stored: string; child: ElementRecord }> => {
      const s = await workspace.get(elementStoreState);
      const child = only(s, childId);
      const [stored] = child.data["derives-from"] as readonly {
        readonly id: string;
        readonly version: string;
      }[];
      expect(stored?.id).toBe(parentId);
      return { target: only(s, stored?.id ?? ""), stored: stored?.version ?? "", child };
    };

    const before = await relation();
    expect(before.target.file).toBe("needs/N-8beffcbd8c26.md");
    expect(await versionOf(workspace, before.target)).toBe(before.stored);

    await fs.mkdir(ws.path("archive/2026/needs"), { recursive: true });
    await fs.rename(ws.path("needs/N-8beffcbd8c26.md"), ws.path("archive/2026/needs/N-8beffcbd8c26.md"));
    await workspace.reset(elementStoreState);

    const after = await relation();
    expect(after.target.file).toBe("archive/2026/needs/N-8beffcbd8c26.md");
    // Same element, same content, so the same version: the relation is neither missing nor outdated.
    expect(await versionOf(workspace, after.target)).toBe(after.stored);
    expect(await textOf(workspace, after.target)).toBe(
      "\nAs a sailor I need to see the wind speed at a glance.\n",
    );
    expect(after.stored).toBe(before.stored);
    expect({ ...after.target, file: "", snapshot: null }).toEqual({
      ...before.target,
      file: "",
      snapshot: null,
    });
    expect(after.child).toEqual(before.child);
  });

  it("[SR-003/AK3] keeps the relation valid when the target moves into a folder of another depth", async () => {
    const ws = await fixture({ fixture: "SR-003/moved" });
    await fs.rename(ws.path("needs/N-8beffcbd8c26.md"), ws.path("N-8beffcbd8c26.md"));
    const workspace = open(ws.root);
    const s = await workspace.get(elementStoreState);
    const target = only(s, "224dedea-c0ac-4ec8-a228-8beffcbd8c26");
    expect(target.file).toBe("N-8beffcbd8c26.md");
    const [stored] = only(s, "5cb1e198-1130-4a13-9d25-88cc6ebc472a").data["derives-from"] as readonly {
      readonly version: string;
    }[];
    expect(await versionOf(workspace, target)).toBe(stored?.version);
  });

  it("[SR-004/AK1] shows the elements of all three repositories of the workspace file together", async () => {
    const ws = await fixture({ fixture: "SR-004/three-repositories", git: ["system", "product", "sensor"] });
    const s = await store(ws.path("system"));
    expect(located(s)).toEqual([
      ["system", "requirements/SR-4b4da63a2dd1.md", "2525fbab-1344-4bcf-8a35-4b4da63a2dd1"],
      ["product", "N-929eca5f9cf4.md", "05a8f3cf-e55e-4978-b540-929eca5f9cf4"],
      ["sensor", "anemometer/SR-481f080784bf.md", "c23372ad-5a33-47db-832f-481f080784bf"],
    ]);
    expect(s.problems).toEqual([]);
  });

  it("skips a missing repository and reads the others (SR-004 AK3)", async () => {
    const ws = await fixture({ fixture: "SR-004/three-repositories" });
    await fs.rm(ws.path("product"), { recursive: true });
    const s = await store(ws.path("system"));
    expect(s.elements.map((e) => e.repository)).toEqual(["system", "sensor"]);
    expect(s.problems).toEqual([]);
  });

  it("reads a nested repository of the workspace once, under its own name", async () => {
    const ws = await fixture({
      fixture: "SR-004/three-repositories",
      files: {
        "system/logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: sub, url: y, path: vendor/sub }\nmetamodel: { repository: system, path: metamodel }\n",
        "system/vendor/sub/SR-0c1d2e3f4a5b.md": element(ID_A),
      },
      git: ["system/vendor/sub"],
    });
    const s = await store(ws.path("system"));
    expect(located(s)).toEqual([
      ["system", "requirements/SR-4b4da63a2dd1.md", "2525fbab-1344-4bcf-8a35-4b4da63a2dd1"],
      ["sub", "SR-0c1d2e3f4a5b.md", ID_A],
    ]);
  });

  it("reads a nested repository folder of the workspace that has no .git once", async () => {
    const ws = await fixture({
      fixture: "SR-004/three-repositories",
      files: {
        "system/logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: sub, url: y, path: vendor/sub }\nmetamodel: { repository: system, path: metamodel }\n",
        "system/vendor/sub/SR-0c1d2e3f4a5b.md": element(ID_A),
      },
    });
    const s = await store(ws.path("system"));
    expect(s.byId.get(ID_A)?.map((e) => e.repository)).toEqual(["sub"]);
  });

  it("does not read a nested Git repository that is not in the workspace", async () => {
    const ws = await fixture({
      fixture: "SR-003/any-folder",
      files: {
        "third-party/lib/SR-0c1d2e3f4a5b.md": element(ID_A),
        "third-party/SR-1d2e3f4a5b6c.md": element(ID_B),
      },
      git: ["third-party/lib"],
    });
    const s = await store(ws.root);
    expect(s.byId.has(ID_A)).toBe(false);
    expect(only(s, ID_B).file).toBe("third-party/SR-1d2e3f4a5b6c.md");
  });

  it("never reads .git and node_modules and honours the ignore globs of the workspace file", async () => {
    const ws = await fixture({
      fixture: "SR-003/any-folder",
      files: {
        "logreq-workspace.yaml":
          'logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\nignore: ["requirements/display/**", "**/*.draft.md", "Entwürfe für Kunden"]\n',
        "node_modules/pkg/SR-0c1d2e3f4a5b.md": element(ID_A),
        "a/node_modules/SR-0c1d2e3f4a5b.md": element(ID_A),
        ".git/SR-0c1d2e3f4a5b.md": element(ID_A),
        "requirements/SR-1d2e3f4a5b6c.draft.md": element(ID_B),
      },
    });
    const s = await store(ws.root);
    expect(s.elements.map((e) => e.file)).toEqual([
      ".drafts/SR-08322988e035.md",
      "N-480462447faf.md",
      "requirements/SR-7badf5d7a1c1.md",
    ]);
  });

  it("reports faulty files with their repository and still reads the others (SR-008)", async () => {
    const ws = await fixture({
      fixture: "SR-004/three-repositories",
      files: {
        "product/broken/N-0c1d2e3f4a5b.md": "---\nid: [unclosed\n---\n",
        "product/warn/N-1d2e3f4a5b6c.md": element(ID_B, "need", "odd: !foo bar\n"),
      },
    });
    const s = await store(ws.path("system"));
    expect(s.elements.map((e) => e.id)).toEqual([
      "2525fbab-1344-4bcf-8a35-4b4da63a2dd1",
      "05a8f3cf-e55e-4978-b540-929eca5f9cf4",
      ID_B,
      "c23372ad-5a33-47db-832f-481f080784bf",
    ]);
    expect(s.problems.map((p) => [p.code, p.repository, p.file, p.line])).toEqual([
      ["file.invalid-yaml", "product", "broken/N-0c1d2e3f4a5b.md", 2],
      ["file.yaml-warning", "product", "warn/N-1d2e3f4a5b6c.md", 6],
    ]);
  });

  it("reports an element file whose id is not a UUID or whose type is not a key, and does not load it", async () => {
    const ws = await fixture({
      fixture: "SR-003/any-folder",
      files: {
        "bad/spec-id.md": '---\nid: "SR-003"\ntype: system-requirement\n---\n',
        "bad/upper.md": `---\ntitle: T\nid: ${ID_A.toUpperCase()}\ntype: system-requirement\n---\n`,
        "bad/empty-id.md": "---\nid:\ntype: system-requirement\n---\n",
        "bad/list-type.md": `---\nid: ${ID_A}\ntype: [a, b]\n---\n`,
        "bad/empty-type.md": `---\nid: ${ID_B}\n\ntype: ""\n---\n`,
      },
    });
    const s = await store(ws.root);
    expect(s.byId.has(ID_A)).toBe(false);
    expect(s.byId.has(ID_B)).toBe(false);
    expect(s.problems).toEqual([
      ...[
        ["bad/empty-id.md", 2, "id must be a UUID version 4 in lower case"],
        ["bad/empty-type.md", 4, "type must be a type key"],
        ["bad/list-type.md", 3, "type must be a type key"],
        ["bad/spec-id.md", 2, "id must be a UUID version 4 in lower case"],
        ["bad/upper.md", 3, "id must be a UUID version 4 in lower case"],
      ].map(([file, line, message]) => ({
        code: "element.invalid",
        severity: "error",
        repository: "system",
        file,
        line,
        message: `${String(message)}; the file is not read as an element`,
      })),
    ]);
  });

  it("keeps the YAML warnings of a file whose id is invalid, before its error", async () => {
    const ws = await fixture({
      fixture: "SR-003/any-folder",
      files: { "bad/warn.md": '---\nodd: !foo bar\nid: "SR-003"\ntype: system-requirement\n---\n' },
    });
    const s = await store(ws.root);
    expect(s.problems.map((p) => [p.code, p.severity, p.repository, p.file, p.line])).toEqual([
      ["file.yaml-warning", "warning", "system", "bad/warn.md", 2],
      ["element.invalid", "error", "system", "bad/warn.md", 3],
    ]);
  });

  it("refuses ignore patterns with a backslash or an empty name in the workspace file", async () => {
    for (const pattern of ['"docs\\\\*.md"', '"docs//a"', '""']) {
      const ws = await fixture({
        fixture: "SR-003/any-folder",
        files: {
          "logreq-workspace.yaml": `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\nignore: [${pattern}]\n`,
        },
      });
      await expect(store(ws.root)).rejects.toMatchObject({ code: "file.faulty" });
    }
  });

  it("reports an invalid id written with an alias key without a line, and reads the other files", async () => {
    const ws = await fixture({
      fixture: "SR-003/any-folder",
      files: {
        "bad/alias-id.md": "---\nk: &k id\n*k : not-a-uuid\ntype: system-requirement\n---\n",
        "bad/alias-type.md": `---\nid: ${ID_A}\nt: &t type\n*t : [x]\n---\n`,
      },
    });
    const s = await store(ws.root);
    expect(s.elements).toHaveLength(5);
    expect(s.problems).toEqual([
      {
        code: "element.invalid",
        severity: "error",
        repository: "system",
        file: "bad/alias-id.md",
        message: "id must be a UUID version 4 in lower case; the file is not read as an element",
      },
      {
        code: "element.invalid",
        severity: "error",
        repository: "system",
        file: "bad/alias-type.md",
        message: "type must be a type key; the file is not read as an element",
      },
    ]);
  });

  it("keeps an element of a type the metamodel does not know (SR-016 AK3)", async () => {
    const ws = await fixture({
      fixture: "SR-003/any-folder",
      files: { "x/X-0c1d2e3f4a5b.md": element(ID_A, "gizmo") },
    });
    expect(only(await store(ws.root), ID_A).type).toBe("gizmo");
  });

  it("keeps every file of a UUID that appears twice (reported by SR-088)", async () => {
    const ws = await fixture({
      fixture: "SR-003/any-folder",
      files: { "a/SR-0c1d2e3f4a5b.md": element(ID_A), "b/SR-0c1d2e3f4a5b.md": element(ID_A) },
    });
    const s = await store(ws.root);
    expect(s.byId.get(ID_A)?.map((e) => e.file)).toEqual(["a/SR-0c1d2e3f4a5b.md", "b/SR-0c1d2e3f4a5b.md"]);
    expect(s.problems).toEqual([]);
  });

  it("reads CRLF files and files with a byte order mark and keeps their form for writing", async () => {
    const ws = await fixture({
      fixture: "SR-003/any-folder",
      files: {
        "crlf/SR-0c1d2e3f4a5b.md": element(ID_A).replaceAll("\n", "\r\n"),
        "bom/SR-1d2e3f4a5b6c.md": `\uFEFF${element(ID_B)}`,
      },
    });
    const s = await store(ws.root);
    expect(only(s, ID_A)).toMatchObject({ eol: "\r\n", closingEol: "\r\n", bom: false });
    expect(only(s, ID_B)).toMatchObject({ eol: "\n", bom: true, data: { id: ID_B, title: "T" } });
  });

  it("reports a repository folder that vanished after the layout was read", async () => {
    const ws = await fixture({ fixture: "SR-004/three-repositories" });
    const workspace = open(ws.path("system"));
    const layout = await workspace.get(workspaceLayoutState);
    await fs.rm(ws.path("sensor"), { recursive: true });
    const s = await loadElements(layout);
    expect(s.elements.map((e) => e.repository)).toEqual(["system", "product"]);
    expect(s.problems).toEqual([
      {
        code: "file.unreadable",
        severity: "error",
        repository: "sensor",
        file: ".",
        message: "Cannot read folder: ENOENT",
      },
    ]);
  });

  it("is kept per workspace and read again after the layout is reset", async () => {
    const ws = await fixture({ fixture: "SR-003/any-folder" });
    const workspace = open(ws.root);
    const first = await workspace.get(elementStoreState);
    expect(await workspace.get(elementStoreState)).toBe(first);
    await workspace.reset(workspaceLayoutState);
    const second = await workspace.get(elementStoreState);
    expect(second).not.toBe(first);
    expect(located(second)).toEqual(located(first));
  });
});

describe("updating the element store file by file (SR-007)", () => {
  const NEED = "224dedea-c0ac-4ec8-a228-8beffcbd8c26";
  const REQUIREMENT = "5cb1e198-1130-4a13-9d25-88cc6ebc472a";
  const REQUIREMENT_FILE = "requirements/SR-88cc6ebc472a.md";

  /** The SR-007 fixture with an extra element that no test touches, its store and layout. */
  const opened = async (
    files: Readonly<Record<string, string>> = {},
  ): Promise<{ ws: FixtureWorkspace; layout: WorkspaceLayout; before: ElementStore }> => {
    const ws = await fixture({
      fixture: "SR-007/external-changes",
      files: { "other/SR-0c1d2e3f4a5b.md": element(ID_A), ...files },
    });
    const workspace = open(ws.root);
    return {
      ws,
      layout: await workspace.get(workspaceLayoutState),
      before: await workspace.get(elementStoreState),
    };
  };

  const changes = (paths: readonly string[], all = false): Map<string, RepositoryChanges> =>
    new Map([["system", all ? { paths, all } : { paths }]]);

  const updated = async (
    before: ElementStore,
    layout: WorkspaceLayout,
    change: Map<string, RepositoryChanges>,
  ): Promise<ElementStore> => {
    const next = await updateElements(before, layout, change);
    if (next === undefined) {
      throw new Error("expected a new store");
    }
    return next;
  };

  it("equals a full read after files were changed, added, deleted and a folder renamed", async () => {
    const { ws, layout, before } = await opened();
    const untouched = only(before, ID_A);
    await ws.write(
      REQUIREMENT_FILE,
      (await fs.readFile(ws.path(REQUIREMENT_FILE), "utf8")).replace("Show wind speed", "Show gusts"),
    );
    await fs.rm(ws.path("needs/N-8beffcbd8c26.md"));
    await ws.write("extra/deep/SR-1d2e3f4a5b6c.md", element(ID_B));
    await fs.rename(ws.path("requirements"), ws.path("reqs"));
    const next = await updated(
      before,
      layout,
      changes([
        "requirements/SR-88cc6ebc472a.md",
        "needs/N-8beffcbd8c26.md",
        "extra",
        "requirements",
        "reqs",
      ]),
    );
    expect(next).toEqual(await loadElements(layout));
    expect(only(next, REQUIREMENT).data["title"]).toBe("Show gusts");
    expect(only(next, REQUIREMENT).file).toBe("reqs/SR-88cc6ebc472a.md");
    expect(next.byId.has(NEED)).toBe(false);
    expect(only(next, ID_A)).toBe(untouched);
  });

  it("keeps the store when a named file did not change or a path holds no element file", async () => {
    const { layout, before } = await opened();
    expect(await updateElements(before, layout, changes([REQUIREMENT_FILE, "nothing/here"]))).toBeUndefined();
    expect(await updateElements(before, layout, new Map())).toBeUndefined();
  });

  it("takes the new modification time of a file saved with the same bytes, as a full read does", async () => {
    const { ws, layout, before } = await opened();
    const text = await fs.readFile(ws.path(REQUIREMENT_FILE), "utf8");
    // Whole seconds, so every file system stores the time exactly.
    const later = new Date((Math.floor(only(before, REQUIREMENT).snapshot.mtimeMs / 1000) + 5) * 1000);
    await ws.write(REQUIREMENT_FILE, text);
    await fs.utimes(ws.path(REQUIREMENT_FILE), later, later);
    const next = await updated(before, layout, changes([REQUIREMENT_FILE]));
    expect(next).toEqual(await loadElements(layout));
    expect(only(next, REQUIREMENT).snapshot.mtimeMs).toBe(later.getTime());
    expect(only(next, REQUIREMENT).snapshot.sha256).toBe(only(before, REQUIREMENT).snapshot.sha256);
  });

  it("counts a file deleted while it is read as gone, and keeps one it cannot read", async () => {
    const { ws, layout, before } = await opened();
    await ws.write(REQUIREMENT_FILE, element(REQUIREMENT, "system-requirement", "extra: longer now\n"));
    const lstat = fs.lstat.bind(fs);
    // Both files are listed by the walk; then one is gone and the other refuses to be read.
    let refused = false;
    const spy = vi.spyOn(fs, "lstat").mockImplementation((file, ...rest) => {
      const name = String(file);
      if (name.endsWith("N-8beffcbd8c26.md")) {
        return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      }
      if (name.endsWith("SR-88cc6ebc472a.md") && !refused) {
        // The read is refused once; the file is still there when the update looks again.
        refused = true;
        return Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" }));
      }
      return lstat(file, ...rest);
    });
    onTestFinished(() => {
      spy.mockRestore();
    });
    const next = await updated(before, layout, changes(["needs", REQUIREMENT_FILE]));
    expect(next.byId.has(NEED)).toBe(false);
    expect(next.byId.has(REQUIREMENT)).toBe(false);
    expect(next.problems.map((p) => [p.code, p.file])).toEqual([["file.unreadable", REQUIREMENT_FILE]]);
  });

  it("checks the files below a changed folder, and every file with `all`, by size and time first", async () => {
    const { ws, layout, before } = await opened();
    await ws.write(REQUIREMENT_FILE, element(REQUIREMENT, "system-requirement", "extra: a longer file\n"));
    for (const change of [changes(["requirements"]), changes([], true)]) {
      const next = await updated(before, layout, change);
      expect(next).toEqual(await loadElements(layout));
      expect(only(next, REQUIREMENT).data["extra"]).toBe("a longer file");
      expect(only(next, NEED)).toBe(only(before, NEED));
    }
    expect(await updateElements(before, layout, changes(["other"]))).toBeUndefined();
  });

  it("follows files that are not elements, faulty files and files that are not read", async () => {
    const { ws, layout, before } = await opened({ "notes/plain.md": "# Notes\n" });
    await ws.write("notes/plain.md", "# Notes\n");
    expect(await updateElements(before, layout, changes(["notes/plain.md"]))).toBeUndefined();
    await ws.write("notes/plain.md", element(ID_B));
    await ws.write("notes/faulty.md", "---\nid: [\n---\n");
    await ws.write("notes/README.MD", "# Upper case\n");
    const next = await updated(before, layout, changes(["notes"]));
    expect(next).toEqual(await loadElements(layout));
    expect(only(next, ID_B).file).toBe("notes/plain.md");
    expect(next.problems.map((p) => [p.code, p.file])).toEqual([
      ["file.skipped", "notes/README.MD"],
      ["file.invalid-yaml", "notes/faulty.md"],
    ]);
    await fs.rm(ws.path("notes/README.MD"));
    const again = await updated(next, layout, changes(["notes/README.MD"]));
    expect(again.problems.map((p) => p.code)).toEqual(["file.invalid-yaml"]);
  });

  it("reads the store in full when it has no per-file contents or other repositories are available", async () => {
    const { layout, before } = await opened();
    const { repositories: _ignored, ...plain } = before;
    expect(await updateElements(plain, layout, changes([]))).toEqual(await loadElements(layout));
    const three = await fixture({ fixture: "SR-004/three-repositories" });
    await fs.rename(three.path("sensor"), three.path("sensor-away"));
    const without = open(three.path("system"));
    const partial = await without.get(elementStoreState);
    await fs.rename(three.path("sensor-away"), three.path("sensor"));
    const full = await open(three.path("system")).get(workspaceLayoutState);
    expect(await updateElements(partial, full, new Map())).toEqual(await loadElements(full));
  });

  it("keeps the contents of repositories without changes", async () => {
    const three = await fixture({ fixture: "SR-004/three-repositories" });
    const workspace = open(three.path("system"));
    const layout = await workspace.get(workspaceLayoutState);
    const before = await workspace.get(elementStoreState);
    await three.write("product/SR-0c1d2e3f4a5b.md", element(ID_A));
    const next = await updated(before, layout, new Map([["product", { paths: ["SR-0c1d2e3f4a5b.md"] }]]));
    expect(next).toEqual(await loadElements(layout));
    expect(next.repositories?.[0]).toBe(before.repositories?.[0]);
    expect(next.repositories?.[1]).not.toBe(before.repositories?.[1]);
  });

  it("stops reading when the signal is aborted", async () => {
    const { ws, layout, before } = await opened();
    await ws.write("extra/SR-1d2e3f4a5b6c.md", element(ID_B));
    const aborted = new AbortController();
    aborted.abort(new Error("stopped"));
    await expect(updateElements(before, layout, changes(["extra"]), aborted.signal)).rejects.toThrow(
      "stopped",
    );
  });
});

describe("applyStoreChange (SR-007)", () => {
  const withTitle = (store: ElementStore, title: string): ElementStore => ({
    ...store,
    problems: [],
    elements: store.elements.map((e) => ({ ...e, data: { ...e.data, title } })),
  });

  it("does nothing while the store is not read", async () => {
    const ws = await fixture({ fixture: "SR-007/external-changes" });
    const workspace = open(ws.root);
    const change = vi.fn(() => Promise.resolve(undefined));
    expect(await applyStoreChange(workspace, change)).toBeUndefined();
    expect(change).not.toHaveBeenCalled();
  });

  it("runs changes one after the other, each on the store the one before set", async () => {
    const ws = await fixture({ fixture: "SR-007/external-changes" });
    const workspace = open(ws.root);
    const first = await workspace.get(elementStoreState);
    const seen: ElementStore[] = [];
    const one = applyStoreChange(workspace, async (store) => {
      seen.push(store);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return withTitle(store, "one");
    });
    const two = applyStoreChange(workspace, (store) => {
      seen.push(store);
      return Promise.resolve(withTitle(store, "two"));
    });
    const failing = applyStoreChange(workspace, () => Promise.reject(new Error("broken")));
    const none = applyStoreChange(workspace, () => Promise.resolve(undefined));
    const [afterOne, afterTwo] = await Promise.all([one, two]);
    await expect(failing).rejects.toThrow("broken");
    expect(await none).toBeUndefined();
    expect(seen).toEqual([first, afterOne]);
    expect(await workspace.get(elementStoreState)).toBe(afterTwo);
  });

  it("runs a change again on the newer store when the store was replaced while it ran", async () => {
    const ws = await fixture({ fixture: "SR-007/external-changes" });
    const workspace = open(ws.root);
    const first = workspace.get(elementStoreState);
    const loaded = await first;
    const newer = withTitle(loaded, "newer");
    const seen: ElementStore[] = [];
    const result = await applyStoreChange(workspace, async (store) => {
      seen.push(store);
      if (seen.length === 1) {
        // Someone else (not through the queue) replaces the store meanwhile.
        expect(await workspace.replace(elementStoreState, first, Promise.resolve(newer))).toBe(true);
      }
      return withTitle(store, "mine");
    });
    expect(seen).toEqual([loaded, newer]);
    expect(await workspace.get(elementStoreState)).toBe(result);
  });
});
