// `workspace.check` restricted to what a merge request changed (SR-092; spec question #291, options
// (a)): `changedSince` and `changedFiles`, the changed elements and their targets, the findings kept,
// and the errors of a commit that is not here (AK2). The small cases use fixtures/SR-025/outdated:
// requirement A derives from the need N, is valid in the variant V and references N in its text;
// requirement B refines A. AK1 runs on a generated workspace of 1,000 elements in four repositories.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace, LargeFixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace, generateLargeWorkspace, writeLargeWorkspace } from "@logreq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput, Problem } from "../../catalog.js";
import * as reader from "../../git/reader.js";
import type { Metamodel } from "../../metamodel/index.js";
import { STANDARD_MODEL_TEXT, findType, metamodelState } from "../../metamodel/index.js";
import { changedFiles, currentVersions, elementStoreState, restrictTo } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { VersionValue } from "../../version/version.js";
import { computeVersion } from "../../version/version.js";
import { workspaceLayoutState } from "../../workspace/index.js";

// The real reader, except where a test makes git fail in a way a fixture cannot.
vi.mock("../../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof reader>();
  return {
    ...original,
    resolveCommit: vi.fn(original.resolveCommit),
    changedPaths: vi.fn(original.changedPaths),
    openObjectReader: vi.fn(original.openObjectReader),
  };
});

afterEach(() => {
  vi.mocked(reader.resolveCommit).mockClear();
  vi.mocked(reader.changedPaths).mockClear();
  vi.mocked(reader.openObjectReader).mockClear();
});

type Output = CommandOutput<"workspace.check">;

const P = "5e025a7d-2b4f-4c61-9d08-0";
const N = `${P}a0000000001`;
const A = `${P}b0000000001`;
const B = `${P}b0000000002`;
const V = `${P}c0000000001`;
const N_FILE = "needs/N-0a0000000001.md";
const V_FILE = "variants/V-0c0000000001.md";
const A_FILE = "requirements/SR-0b0000000001.md";
const B_FILE = "requirements/SR-0b0000000002.md";

const fixture = async (options: Parameters<typeof createFixtureWorkspace>[0]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

const outdatedFixture = (): Promise<FixtureWorkspace> => fixture({ fixture: "SR-025/outdated", git: true });

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const check = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>> = {},
  signal?: AbortSignal,
): Promise<Output> =>
  (await invoke("workspace.check", input, {
    workspace,
    ...(signal === undefined ? {} : { signal }),
  })) as Output;

/** Code, element and target of each problem. */
const brief = (problems: readonly Problem[]): (readonly [string, string | undefined, string | undefined])[] =>
  problems.map((p) => [p.code, p.elementId, p.targetId] as const);

/** Appends `text` to the Markdown text of a file of the fixture. */
const append = async (ws: FixtureWorkspace, file: string, text: string): Promise<void> => {
  await ws.write(file, `${await fs.readFile(ws.path(file), "utf8")}${text}`);
};

/** The changed elements and the selection (C, C and Z) of a workspace for `input`, by UUID. */
const selection = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>>,
): Promise<{ changed: string[]; selected: string[] }> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  const files = await changedFiles(workspace.root, layout, input, new AbortController().signal);
  const restriction = restrictTo(files ?? { files: new Map(), ids: new Set(), problems: [] }, {
    store,
    layout,
    metamodel,
    versions: await currentVersions(workspace),
  });
  return { changed: restriction.changed.map((e) => e.id), selected: restriction.selected.map((e) => e.id) };
};

describe("workspace.check restricted to changed elements (SR-092)", () => {
  it("[SR-092/AK1] reports the relations to an old version of a changed element, and no other finding", async () => {
    const ws = await outdatedFixture();
    await append(ws, N_FILE, "Changed in the merge request.\n");
    const out = await check(open(ws.root), { changedSince: "HEAD", failOn: "warning" });
    // N has no relations of its own: only the derivation and the reference of A to its old version.
    expect(brief(out.problems)).toEqual([
      ["relation.outdated", A, N],
      ["relation.outdated", A, N],
    ]);
    expect(out.problems.every((p) => p.storedDate !== undefined && p.currentDate === null)).toBe(true);
    expect([out.ok, out.checkedElements]).toEqual([false, 1]);
  });

  it("[SR-092/AK1] reports the findings of a changed element's targets, and not those of an unchanged one", async () => {
    const ws = await outdatedFixture();
    await append(ws, N_FILE, "Changed after the commit.\n");
    const workspace = open(ws.root);
    // B refines A: A is its target, so A's outdated relations to N count.
    const viaB = await check(workspace, { changedFiles: [B_FILE], failOn: "warning" });
    expect(brief(viaB.problems)).toEqual([
      ["relation.outdated", A, N],
      ["relation.outdated", A, N],
    ]);
    expect([viaB.ok, viaB.checkedElements]).toEqual([false, 2]);
    // V has no relations and nothing of it is outdated.
    expect(await check(workspace, { changedFiles: [V_FILE] })).toEqual({
      ok: true,
      problems: [],
      checkedElements: 1,
    });
    // The full check reports the same relations.
    expect(brief((await check(workspace)).problems)).toEqual(brief(viaB.problems));
  });

  it("counts changed embedded images, untracked files, and both inputs together", async () => {
    const ws = await outdatedFixture();
    await append(ws, A_FILE, "\n![Wind rose](rose.png)\n");
    await ws.write("requirements/rose.png", "png 1");
    const base = await ws.commit();
    const workspace = open(ws.root);
    expect(await selection(workspace, { changedSince: base })).toEqual({ changed: [], selected: [] });
    // Only the image changed: A's version changed (ADR-0005), so A counts, with its targets V and N.
    await ws.write("requirements/rose.png", "png 2");
    await workspace.reset(elementStoreState);
    expect(await selection(workspace, { changedSince: base })).toEqual({ changed: [A], selected: [N, A, V] });
    // A new element file that Git does not track yet, and a file named directly.
    await ws.write(
      "requirements/SR-0b0000000003.md",
      (await fs.readFile(ws.path(B_FILE), "utf8")).replace(B, `${P}b0000000003`),
    );
    await workspace.reset(elementStoreState);
    expect(await selection(workspace, { changedSince: base, changedFiles: [ws.path(V_FILE)] })).toEqual({
      changed: [A, `${P}b0000000003`, V],
      selected: [N, A, `${P}b0000000003`, V],
    });
  });

  it("keeps the faulty files that changed, and the problems of the metamodel and the layout", async () => {
    const ws = await fixture({
      fixture: "SR-089/missing-targets",
      git: ["system", "sensor"],
      files: { "system/requirements/old.md": "---\nid: [unclosed\n---\n" },
    });
    await ws.write("system/requirements/new.md", "---\nid: [unclosed\n---\n");
    const workspace = open(ws.path("system"));
    const out = await check(workspace, { changedSince: "HEAD" });
    expect(out.problems.map((p) => [p.code, p.file])).toEqual([
      ["workspace.repository-missing", undefined],
      ["file.invalid-yaml", "requirements/new.md"],
      ["metamodel.meaning-unassigned", undefined],
    ]);
    expect(out.checkedElements).toBe(0);
    // Without a restriction both faulty files are reported.
    expect((await check(workspace)).problems.filter((p) => p.code === "file.invalid-yaml")).toHaveLength(2);
  });

  it("looks a revision up in every repository; one without it adds nothing and says so", async () => {
    const ws = await fixture({ fixture: "SR-089/missing-targets", git: ["system", "sensor"] });
    const sensorHead = await ws.head("sensor");
    await append(ws, "sensor/anemometer/SR-1e0f9a8b7c6d.md", "Changed.\n");
    await append(ws, "system/needs/N-0a1b2c3d4e5f.md", "Changed too, but system has no such commit.\n");
    const workspace = open(ws.path("system"));
    const { changed } = await selection(workspace, { changedSince: sensorHead });
    const store = await workspace.get(elementStoreState);
    expect(changed.map((id) => store.byId.get(id)?.[0]?.repository)).toEqual(["sensor"]);
    // A file named in another repository is looked up there.
    const named = await selection(workspace, { changedFiles: ["../sensor/anemometer/SR-1e0f9a8b7c6d.md"] });
    expect(named.changed).toEqual(changed);
    const out = await check(workspace, { changedSince: sensorHead });
    expect(out.checkedElements).toBeGreaterThanOrEqual(1);
    expect(out.problems.filter((p) => p.code.startsWith("git."))).toEqual([
      {
        code: "git.revision-missing",
        severity: "info",
        message: `Repository system has no commit ${sensorHead}: its changes are not looked at`,
        repository: "system",
      },
    ]);
  });

  it("shows only the severities asked for, and asks Git for no date then", async () => {
    const ws = await outdatedFixture();
    await append(ws, N_FILE, "Changed.\n");
    const workspace = open(ws.root);
    const out = await check(workspace, { changedSince: "HEAD", severity: "error" });
    // The two outdated relations of A to N are warnings: hidden, and ok by default (#304).
    expect(out).toEqual({
      ok: true,
      problems: [],
      hidden: { below: "error", warning: 2, info: 0 },
      checkedElements: 1,
    });
    expect((await check(workspace, { changedSince: "HEAD", severity: "error", failOn: "warning" })).ok).toBe(
      false,
    );
  });

  it("takes every element a target names: copies of a UUID; none for a missing target", async () => {
    const D = `${P}b0000000009`;
    const ws = await fixture({
      fixture: "SR-025/outdated",
      files: {
        "copies/N-0a0000000001.md": `---\nid: ${N}\ntype: need\nstatus: draft\ntitle: Copy\n---\n`,
        "requirements/SR-0b0000000009.md": [
          "---",
          `id: ${D}`,
          "type: system-requirement",
          "status: draft",
          "title: Gone",
          "derives-from:",
          `  - { id: ${P}ffffffffff01, version: n1:0000000000000000 }`,
          "---",
          "",
          `See [gone](logreq:${P}ffffffffff02).`,
          "",
        ].join("\n"),
      },
    });
    const { selected } = await selection(open(ws.root), {
      changedFiles: [A_FILE, "requirements/SR-0b0000000009.md"],
    });
    // Both files of N (SR-088), through A's relation and its reference.
    expect(selected).toEqual([N, N, A, D, V]);
  });

  it("names a file whose folders do not exist yet, also where no folder above it can be resolved", async () => {
    const ws = await outdatedFixture();
    const workspace = open(ws.root);
    const layout = await workspace.get(workspaceLayoutState);
    const signal = new AbortController().signal;
    const gone = "requirements/new/deeper/SR-0b0000000004.md";
    expect((await changedFiles(ws.root, layout, { changedFiles: [gone] }, signal))?.files).toEqual(
      new Map([["system", new Set([gone])]]),
    );
    // A file system that resolves nothing, not even the root: the path is taken as given.
    const realpath = vi.spyOn(fs, "realpath").mockRejectedValue(new Error("ENOENT"));
    onTestFinished(() => {
      realpath.mockRestore();
    });
    expect((await changedFiles(ws.root, layout, { changedFiles: [gone] }, signal))?.files).toEqual(
      new Map([["system", new Set([gone])]]),
    );
  });
});

describe("deleted elements and repositories without Git (SR-092)", () => {
  it("reads no UUID from deleted files that held no element, and fails when Git cannot read them", async () => {
    const ws = await fixture({
      fixture: "SR-025/outdated",
      git: true,
      files: {
        "notes/faulty.md": "---\nid: [unclosed\n---\n",
        "notes/list.md": "---\n- a\n---\n",
        "notes/number.md": "---\nid: 5\ntype: need\n---\n",
        "notes/plain.md": "No frontmatter.\n",
      },
    });
    await ws.commit();
    for (const file of ["faulty", "list", "number", "plain"]) {
      await fs.rm(ws.path(`notes/${file}.md`));
    }
    const workspace = open(ws.root);
    expect(await check(workspace, { changedSince: "HEAD" })).toEqual({
      ok: true,
      problems: [],
      checkedElements: 0,
    });
    vi.mocked(reader.openObjectReader).mockReturnValueOnce({
      info: () => Promise.resolve({ known: false, reason: "timeout", detail: "slow" }),
      read: () => Promise.resolve({ known: false, reason: "timeout", detail: "slow" }),
      close: () => undefined,
    });
    await expect(check(workspace, { changedSince: "HEAD" })).rejects.toMatchObject({
      code: "git.unavailable",
      details: { repository: "system", reason: "timeout" },
    });
  });

  it("keeps the relations to an element whose file was deleted or whose UUID changed since the commit", async () => {
    const ws = await outdatedFixture();
    const workspace = open(ws.root);
    // Nothing changed: no finding.
    expect(await check(workspace, { changedSince: "HEAD" })).toEqual({
      ok: true,
      problems: [],
      checkedElements: 0,
    });
    await fs.rm(ws.path(N_FILE));
    const v = await fs.readFile(ws.path(V_FILE), "utf8");
    await ws.write(V_FILE, v.replace(V, `${P}c0000000009`));
    await workspace.reset(elementStoreState);
    const out = await check(workspace, { changedSince: "HEAD" });
    // A's validity item (to V), its derivation and its reference (to N) no longer resolve.
    expect(brief(out.problems)).toEqual([
      ["relation.missing-target", A, V],
      ["relation.missing-target", A, N],
      ["relation.missing-target", A, N],
    ]);
    // Only the new V file is a changed element; A is no target of anything changed.
    expect(out.checkedElements).toBe(1);
  });

  it("says which repository is no Git repository, and checks the others", async () => {
    const ws = await fixture({ fixture: "SR-089/missing-targets", git: ["system"] });
    await append(ws, "system/needs/N-0a1b2c3d4e5f.md", "Changed.\n");
    const out = await check(open(ws.path("system")), { changedSince: "HEAD" });
    expect(out.problems.filter((p) => p.code.startsWith("git."))).toEqual([
      {
        code: "git.unavailable",
        severity: "info",
        message: "Repository sensor is no Git repository: its changes since HEAD are not looked at",
        repository: "sensor",
      },
    ]);
    // The changed need: the relations to its old version, also from the repository without Git.
    expect(
      brief(out.problems.filter((p) => p.code === "relation.outdated")).map(([, , target]) => target),
    ).toEqual([
      "7d2c9e4f-1a3b-4c5d-8e6f-0a1b2c3d4e5f",
      "7d2c9e4f-1a3b-4c5d-8e6f-0a1b2c3d4e5f",
      "7d2c9e4f-1a3b-4c5d-8e6f-0a1b2c3d4e5f",
    ]);
    expect(out.checkedElements).toBe(1);
  });
});

describe("a restriction that cannot be made (SR-092)", () => {
  it("[SR-092/AK2] fails with git.commit-not-found when no repository has the commit", async () => {
    const ws = await outdatedFixture();
    const missing = "0123456789abcdef0123456789abcdef01234567";
    await expect(check(open(ws.root), { changedSince: missing })).rejects.toMatchObject({
      code: "git.commit-not-found",
      message: `Commit ${missing} is not available locally in any repository of the workspace: fetch it, or deepen a shallow clone`,
      details: { command: "workspace.check", revision: missing },
    });
  });

  it("[SR-092/AK2] fails with git.commit-not-found for a name that is no commit, also in a shallow clone", async () => {
    const ws = await outdatedFixture();
    const first = await ws.head();
    await append(ws, N_FILE, "Second.\n");
    await ws.commit();
    await ws.git(["clone", "--quiet", "--depth", "1", `file://${ws.root}`, "../shallow"]);
    const shallow = path.join(ws.root, "..", "shallow");
    await expect(check(open(shallow), { changedSince: first })).rejects.toMatchObject({
      code: "git.commit-not-found",
    });
    await expect(check(open(ws.root), { changedSince: "no-such-branch" })).rejects.toMatchObject({
      code: "git.commit-not-found",
    });
  });

  it("fails with git.unavailable without a Git repository, or when git fails", async () => {
    const plain = await fixture({ fixture: "SR-025/outdated" });
    await expect(check(open(plain.root), { changedSince: "HEAD" })).rejects.toMatchObject({
      code: "git.unavailable",
      message:
        "No repository of the workspace on this machine is a Git repository; the check cannot be restricted to changes since a commit",
    });
    const ws = await outdatedFixture();
    const workspace = open(ws.root);
    vi.mocked(reader.resolveCommit).mockResolvedValueOnce({
      known: false,
      reason: "refused",
      detail: "dubious",
    });
    await expect(check(workspace, { changedSince: "HEAD" })).rejects.toMatchObject({
      code: "git.unavailable",
      message: "Git cannot tell what changed in repository system (refused); the check cannot be restricted",
      details: { command: "workspace.check", repository: "system", reason: "refused" },
    });
    vi.mocked(reader.changedPaths).mockResolvedValueOnce({ known: false, reason: "timeout", detail: "slow" });
    await expect(check(workspace, { changedSince: "HEAD" })).rejects.toMatchObject({
      code: "git.unavailable",
      details: { repository: "system", reason: "timeout" },
    });
  });

  it("refuses a file outside the repositories and a revision Git cannot take", async () => {
    const ws = await outdatedFixture();
    const workspace = open(ws.root);
    const outside = path.join(os.tmpdir(), "elsewhere.md");
    await expect(check(workspace, { changedFiles: [N_FILE, outside] })).rejects.toMatchObject({
      code: "input.invalid",
      message: `changedFiles names files in no repository of the workspace on this machine: ${path
        .relative(ws.root, outside)
        .split(path.sep)
        .join("/")}`,
      details: { command: "workspace.check", fields: ["changedFiles"] },
    });
    await expect(check(workspace, { changedFiles: ["."] })).rejects.toMatchObject({
      message: "changedFiles names files in no repository of the workspace on this machine: .",
    });
    await expect(check(workspace, { changedFiles: ["requirements", N_FILE] })).rejects.toMatchObject({
      code: "input.invalid",
      message: "changedFiles names folders, not files: requirements",
      details: { fields: ["changedFiles"] },
    });
    await expect(check(workspace, { changedSince: " HEAD" })).rejects.toMatchObject({
      code: "input.invalid",
      message: 'changedSince is no revision Git can take: " HEAD"',
      details: { fields: ["changedSince"] },
    });
  });

  it("stops when the caller goes away", async () => {
    const ws = await outdatedFixture();
    const controller = new AbortController();
    vi.mocked(reader.resolveCommit).mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve({ known: true, commit: undefined });
    });
    await expect(check(open(ws.root), { changedSince: "HEAD" }, controller.signal)).rejects.toMatchObject({
      code: "internal",
      details: { aborted: true },
    });
  });
});

/** Core's version (ADR-0005) for the generator, as `elementVersion` computes it for a read element. */
const versionOf =
  (metamodel: Metamodel) =>
  ({
    type,
    text,
    properties,
  }: {
    readonly type: string;
    readonly text: string;
    readonly properties: Readonly<Record<string, unknown>>;
  }): string => {
    const keys = new Set(findType(metamodel, type)?.properties ?? []);
    return computeVersion({
      text,
      properties: properties as Readonly<Record<string, VersionValue>>,
      definitions: metamodel.properties
        .filter((p) => keys.has(p.key))
        .map((p) => ({
          key: p.key,
          kind: p.kind,
          ...(p.content === undefined ? {} : { content: p.content }),
        })),
      files: [],
    });
  };

/** The standard model as a workspace reads it. */
const standardModel = async (): Promise<Metamodel> => {
  const ws = await fixture({
    files: {
      "logreq-workspace.yaml":
        'logreq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
      "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
    },
  });
  return open(ws.root).get(metamodelState);
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** The targets a file names: relation items (`{ id: … }`) and inline references (`logreq:…`). */
const TARGET = new RegExp(`\\{ id: (${UUID})|\\(logreq:(${UUID})`, "g");

describe("SR-092 AK1 on a generated workspace", () => {
  it("[SR-092/AK1] reports only the findings of the 3 of 1,000 elements a merge request changed and of their targets", async () => {
    const tree = generateLargeWorkspace({
      version: versionOf(await standardModel()),
      elements: 1000,
      relations: 4000,
    });
    const fx: LargeFixtureWorkspace = await writeLargeWorkspace(tree, { git: true });
    onTestFinished(() => fx.cleanup());
    const folderOf = new Map(tree.repositories.map((r) => [r.name, r.folder]));
    const fileOf = (id: string): string => {
      const element = tree.elements.find((e) => e.id === id);
      return `${folderOf.get(element?.repository ?? "") ?? ""}/${element?.file ?? ""}`;
    };
    // What each element points at, read from the files (the oracle; core is not asked).
    const targets = new Map<string, Set<string>>();
    for (const element of tree.elements) {
      const content = tree.files.get(fileOf(element.id)) ?? "";
      targets.set(element.id, new Set([...content.matchAll(TARGET)].map((m) => m[1] ?? m[2] ?? "")));
    }
    const sourcesOf = (id: string): string[] => [...targets].filter(([, t]) => t.has(id)).map(([s]) => s);
    // X1 has a target T that another element points at too, and a source S that is none of its targets.
    const candidates = tree.elements.filter((e) => e.type === "system-requirement").map((e) => e.id);
    const outsideSource = (id: string): string | undefined =>
      sourcesOf(id).find((s) => s !== id && !(targets.get(id)?.has(s) ?? false));
    const x1 = candidates.find(
      (id) =>
        outsideSource(id) !== undefined &&
        [...(targets.get(id) ?? [])].some((t) => sourcesOf(t).some((s) => s !== id)),
    );
    expect(x1).toBeDefined();
    const X1 = String(x1);
    const S = String(outsideSource(X1));
    const T = [...(targets.get(X1) ?? [])].find((t) => sourcesOf(t).some((s) => s !== X1)) ?? "";
    const [X2 = "", X3 = ""] = candidates
      .filter((id) => id !== X1 && id !== T && id !== S && !(targets.get(id)?.has(S) ?? false))
      .slice(-2);
    const changed = [X1, X2, X3];
    const selectedIds = new Set([...changed, ...changed.flatMap((id) => [...(targets.get(id) ?? [])])]);
    const U =
      tree.elements.find(
        (e) => !selectedIds.has(e.id) && ![...(targets.get(e.id) ?? [])].some((t) => changed.includes(t)),
      )?.id ?? "";
    // On main: T and U each get an unknown property and a new text (their incoming relations are outdated).
    const odd = async (id: string, text: string): Promise<void> => {
      const file = fx.path(fileOf(id));
      const content = await fs.readFile(file, "utf8");
      await fs.writeFile(file, `${content.replace(/\ntitle: /, "\nodd-key: 1\ntitle: ")}${text}\n`);
    };
    await odd(T, "Changed on main.");
    await odd(U, "Changed on main.");
    for (const repository of tree.repositories) {
      await fx.commit(repository.folder, "findings on main");
      await fx.git(["checkout", "--quiet", "-b", "merge-request"], repository.folder);
    }
    // The merge request changes three elements.
    for (const id of changed) {
      await fs.appendFile(fx.path(fileOf(id)), "Changed in the merge request.\n");
    }
    await fs.writeFile(
      fx.path(fileOf(X2)),
      (await fs.readFile(fx.path(fileOf(X2)), "utf8")).replace(/\ntitle: /, "\nodd-key: 2\ntitle: "),
    );
    for (const repository of tree.repositories) {
      await fx.commit(repository.folder, "the merge request");
    }

    const workspace = open(fx.workspaceRoot);
    const full = await check(workspace);
    const restricted = await check(workspace, { changedSince: "main", failOn: "warning" });
    const belongs = (p: Problem): boolean =>
      p.elementId === undefined
        ? true
        : selectedIds.has(p.elementId) || (p.targetId !== undefined && changed.includes(p.targetId));
    expect(brief(restricted.problems)).toEqual(brief(full.problems.filter(belongs)));
    expect(restricted.checkedElements).toBe(selectedIds.size);
    expect(restricted.ok).toBe(false);
    const has = (problems: readonly Problem[], code: string, element: string, target?: string): boolean =>
      problems.some(
        (p) => p.code === code && p.elementId === element && (target === undefined || p.targetId === target),
      );
    // Of the changed elements and their targets.
    expect(has(restricted.problems, "element.unknown-property", X2)).toBe(true);
    expect(has(restricted.problems, "element.unknown-property", T)).toBe(true);
    expect(has(restricted.problems, "relation.outdated", X1, T)).toBe(true);
    // Relations of unchanged elements to an old version of a changed one (N-059).
    expect(selectedIds.has(S)).toBe(false);
    expect(has(restricted.problems, "relation.outdated", S, X1)).toBe(true);
    // Not: U, nor the relations of unrelated elements to the target T or to U.
    expect(has(full.problems, "element.unknown-property", U)).toBe(true);
    expect(has(restricted.problems, "element.unknown-property", U)).toBe(false);
    const other = sourcesOf(T).find((s) => !selectedIds.has(s)) ?? "";
    expect(has(full.problems, "relation.outdated", other, T)).toBe(true);
    expect(has(restricted.problems, "relation.outdated", other, T)).toBe(false);
    expect(restricted.problems.some((p) => p.targetId === U)).toBe(false);
  }, 120_000);
});
