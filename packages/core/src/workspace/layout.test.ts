import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../catalog.js";
import { Workspace } from "../runtime/workspace.js";
import { LOCAL_FILE, WORKSPACE_FILE } from "./config.js";
import { loadWorkspaceLayout, locate, settingLocation, workspaceLayoutState } from "./layout.js";

/** A main repository `main/` with the given workspace and local files, plus sibling folders. */
const setup = async (
  workspaceYaml: string | undefined,
  options: { readonly local?: string; readonly folders?: readonly string[] } = {},
): Promise<FixtureWorkspace> => {
  const files: Record<string, string> = { "main/metamodel/types.yaml": "types: {}\n" };
  if (workspaceYaml !== undefined) {
    files[`main/${WORKSPACE_FILE}`] = workspaceYaml;
  }
  if (options.local !== undefined) {
    files[`main/${LOCAL_FILE}`] = options.local;
  }
  for (const folder of options.folders ?? []) {
    files[`${folder}/README.md`] = "x\n";
  }
  const ws = await createFixtureWorkspace({ files });
  onTestFinished(() => ws.cleanup());
  return ws;
};

const yaml = (repositories: string, rest = "metamodel: { repository: main, path: metamodel }\n"): string =>
  `reqseq-workspace: 1\nname: W\nrepositories:\n${repositories}${rest}`;

const MAIN = "  - { name: main, url: u, main: true }\n";

const failure = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

describe("loadWorkspaceLayout", () => {
  it("locates repositories by path, by the default ../<name> and the main one at the root", async () => {
    const ws = await setup(
      yaml(`${MAIN}  - { name: a, url: u }\n  - { name: b, url: u, path: ../elsewhere/b }\n`),
      {
        folders: ["a", "elsewhere/b"],
      },
    );
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.root).toBe(ws.path("main"));
    expect(layout.name).toBe("W");
    expect(layout.file.name).toBe("W");
    expect(layout.main).toBe("main");
    expect(layout.repositories).toEqual([
      {
        name: "main",
        url: "u",
        main: true,
        path: ".",
        folder: ws.path("main"),
        available: true,
        excludes: [],
      },
      { name: "a", url: "u", main: false, path: "../a", folder: ws.path("a"), available: true, excludes: [] },
      {
        name: "b",
        url: "u",
        main: false,
        path: "../elsewhere/b",
        folder: ws.path("elsewhere/b"),
        available: true,
        excludes: [],
      },
    ]);
    expect(layout.metamodel).toEqual({
      repository: "main",
      path: "metamodel",
      folder: ws.path("main/metamodel"),
      exists: true,
    });
    expect(layout.problems).toEqual([]);
  });

  it("applies relative and absolute paths of .reqseq/local.yaml", async () => {
    const ws = await setup(
      yaml(`${MAIN}  - { name: a, url: u }\n  - { name: b, url: u, path: ../b }\n  - { name: c, url: u }\n`),
      {
        folders: ["checkouts/a", "c"],
      },
    );
    const absolute = ws.path("checkouts/b-abs");
    await ws.write("checkouts/b-abs/README.md", "x\n");
    await ws.write(
      `main/${LOCAL_FILE}`,
      `reqseq-local: 1\nrepositories:\n  a: { path: ../checkouts/a }\n  b: { path: ${JSON.stringify(absolute)} }\n`,
    );
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.repositories.map((r) => [r.name, r.path, r.folder, r.available])).toEqual([
      ["main", ".", ws.path("main"), true],
      ["a", "../checkouts/a", ws.path("checkouts/a"), true],
      ["b", absolute, absolute, true],
      ["c", "../c", ws.path("c"), true],
    ]);
    expect(layout.problems).toEqual([]);
  });

  it("accepts a local file without repositories", async () => {
    const ws = await setup(yaml(MAIN), { local: "reqseq-local: 1\n" });
    expect((await loadWorkspaceLayout(ws.path("main"))).problems).toEqual([]);
  });

  it("warns about a local override for a repository the workspace file does not name", async () => {
    const ws = await setup(yaml(MAIN), {
      local: "reqseq-local: 1\nrepositories:\n  ghost: { path: ../ghost }\n",
    });
    expect((await loadWorkspaceLayout(ws.path("main"))).problems).toEqual([
      {
        code: "workspace.invalid",
        severity: "warning",
        file: LOCAL_FILE,
        message: `Repository ghost is not in ${WORKSPACE_FILE}; its path is ignored`,
      },
    ]);
  });

  it("ignores a faulty local file with a warning", async () => {
    const ws = await setup(yaml(`${MAIN}  - { name: a, url: u }\n`), {
      local: "reqseq-local: 1\nrepositories:\n  a: [unclosed\n",
      folders: ["a"],
    });
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.repositories[1]?.path).toBe("../a");
    expect(layout.problems).toHaveLength(1);
    expect(layout.problems[0]).toMatchObject({
      code: "file.invalid-yaml",
      severity: "warning",
      file: LOCAL_FILE,
    });
    expect(layout.problems[0]?.message).toMatch(/; \.reqseq\/local\.yaml is ignored$/);
  });

  it("ignores a local file that does not match its schema, with a warning per violation", async () => {
    const ws = await setup(yaml(`${MAIN}  - { name: a, url: u }\n`), {
      local: "reqseq-local: 1\nrepositories:\n  a: { folder: ../x }\nextra: 1\n",
      folders: ["a"],
    });
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.repositories[1]?.path).toBe("../a");
    expect(layout.problems.map((p) => [p.code, p.severity, p.file])).toEqual([
      ["workspace.invalid", "warning", LOCAL_FILE],
      ["workspace.invalid", "warning", LOCAL_FILE],
      ["workspace.invalid", "warning", LOCAL_FILE],
    ]);
  });

  it("keeps YAML warnings of both files", async () => {
    const ws = await setup(`${yaml(MAIN)}ignore: [!unknown x]\n`, {
      local: "reqseq-local: 1\nrepositories: !other {}\n",
    });
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.problems.map((p) => [p.code, p.file])).toEqual([
      ["file.yaml-warning", WORKSPACE_FILE],
      ["file.yaml-warning", LOCAL_FILE],
    ]);
  });

  it("keeps the YAML warnings of a local file that does not match its schema", async () => {
    const ws = await setup(yaml(MAIN), { local: "reqseq-local: !other 2\n" });
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.problems.map((p) => [p.code, p.severity])).toEqual([
      ["file.yaml-warning", "warning"],
      ["workspace.invalid", "warning"],
    ]);
  });

  it("refuses a workspace file that names a repository twice", async () => {
    const ws = await setup(yaml(`${MAIN}  - { name: a, url: first }\n  - { name: a, url: second }\n`));
    const error = await failure(loadWorkspaceLayout(ws.path("main")));
    expect(error.code).toBe("file.faulty");
    expect(error.details?.["problems"]).toEqual([
      {
        code: "workspace.invalid",
        severity: "error",
        file: WORKSPACE_FILE,
        message: `Invalid ${WORKSPACE_FILE}: repository a is listed twice`,
      },
    ]);
  });

  it("refuses a workspace file with several repositories marked main", async () => {
    const ws = await setup(yaml(`${MAIN}  - { name: a, url: u, main: true }\n`));
    expect((await failure(loadWorkspaceLayout(ws.path("main")))).code).toBe("file.faulty");
  });

  it("refuses a workspace file with several repositories and none marked main", async () => {
    const ws = await setup(yaml("  - { name: main, url: u }\n  - { name: a, url: u }\n"));
    const error = await failure(loadWorkspaceLayout(ws.path("main")));
    expect(error.code).toBe("file.faulty");
    expect(error.message).toContain("/repositories must contain at least 1 valid item(s)");
  });

  it("keeps the main repository at the root whatever path the files give it", async () => {
    const ws = await setup(yaml("  - { name: main, url: u, main: true, path: ./ }\n"));
    expect((await loadWorkspaceLayout(ws.path("main"))).problems).toEqual([]);

    const moved = await setup(yaml("  - { name: main, url: u, main: true, path: ../main-copy }\n"));
    const layout = await loadWorkspaceLayout(moved.path("main"));
    expect(layout.repositories[0]?.folder).toBe(moved.path("main"));
    expect(layout.problems).toEqual([
      {
        code: "workspace.invalid",
        severity: "warning",
        file: WORKSPACE_FILE,
        message: 'Repository main holds the workspace file; its path is always "."',
      },
    ]);

    const overridden = await setup(yaml(MAIN), {
      local: "reqseq-local: 1\nrepositories:\n  main: { path: ../x }\n",
    });
    expect((await loadWorkspaceLayout(overridden.path("main"))).problems).toEqual([
      {
        code: "workspace.invalid",
        severity: "warning",
        file: LOCAL_FILE,
        message: 'Repository main holds the workspace file; its path is always "."',
      },
    ]);
  });

  it("warns about \\ in a committed path and uses / instead", async () => {
    const ws = await setup(yaml(`${MAIN}  - { name: a, url: u, path: "..\\\\shared\\\\a" }\n`), {
      folders: ["shared/a"],
    });
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.repositories[1]).toMatchObject({
      path: "../shared/a",
      folder: ws.path("shared/a"),
      available: true,
    });
    expect(layout.problems).toEqual([
      {
        code: "workspace.invalid",
        severity: "warning",
        file: WORKSPACE_FILE,
        message: "Repository a: write its path with / instead of \\",
      },
    ]);
  });

  it("ignores an absolute path in the committed workspace file with a warning", async () => {
    const ws = await setup(undefined, { folders: ["a", "elsewhere"] });
    for (const absolute of [ws.path("elsewhere"), "/abs/a", "C:/abs/a"]) {
      await ws.write(
        `main/${WORKSPACE_FILE}`,
        yaml(`${MAIN}  - { name: a, url: u, path: ${JSON.stringify(absolute)} }\n`),
      );
      const layout = await loadWorkspaceLayout(ws.path("main"));
      expect(layout.repositories[1]).toMatchObject({ path: "../a", folder: ws.path("a") });
      expect(layout.problems.map((p) => p.message)).toContain(
        `Repository a: an absolute path is ignored here; put it in ${LOCAL_FILE}`,
      );
    }
  });

  it("does not expand ~ in paths", async () => {
    const ws = await setup(yaml(`${MAIN}  - { name: a, url: u, path: ~/a }\n`));
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.repositories[1]).toMatchObject({
      path: "~/a",
      folder: path.join(ws.path("main"), "~", "a"),
      available: false,
    });
  });

  it("leaves out a repository that lies in the same folder as another one", async () => {
    const ws = await setup(
      yaml(
        `  - { name: a, url: u, path: ../shared }\n${MAIN}  - { name: b, url: u, path: ../shared/ }\n  - { name: c, url: u, path: . }\n`,
      ),
      { folders: ["shared"] },
    );
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.repositories.map((r) => r.name)).toEqual(["a", "main"]);
    expect(layout.problems).toEqual([
      {
        code: "workspace.invalid",
        severity: "error",
        file: WORKSPACE_FILE,
        message: "Repository b lies in the same folder as a; it is left out",
      },
      {
        code: "workspace.invalid",
        severity: "error",
        file: WORKSPACE_FILE,
        message: "Repository c lies in the same folder as main; it is left out",
      },
    ]);
  });

  it("tells each repository which nested repositories to skip", async () => {
    const ws = await setup(
      yaml(
        `${MAIN}  - { name: sub, url: u, path: modules/sub }\n  - { name: deep, url: u, path: modules/sub/deep }\n  - { name: gone, url: u, path: modules/gone }\n  - { name: side, url: u }\n`,
      ),
      { folders: ["main/modules/sub/deep", "side"] },
    );
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.repositories.map((r) => [r.name, r.excludes])).toEqual([
      ["main", [ws.path("main/modules/sub"), ws.path("main/modules/sub/deep")]],
      ["sub", [ws.path("main/modules/sub/deep")]],
      ["deep", []],
      ["gone", []],
      ["side", []],
    ]);
  });

  it("reports locations that name a repository not in the list", async () => {
    const ws = await setup(
      yaml(
        MAIN,
        "metamodel: { repository: nope, path: m }\nevidence:\n  - { repository: main, path: e }\n  - { repository: other, path: e }\nbaselines: { repository: b, path: x }\nfilters: { repository: f, path: x }\nmappings: { repository: main, path: x }\n",
      ),
    );
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.metamodel).toEqual({ repository: "nope", path: "m", folder: undefined, exists: false });
    expect(layout.problems.map((p) => [p.code, p.severity, p.message])).toEqual([
      ["workspace.invalid", "error", "evidence names repository other, which is not in repositories"],
      ["workspace.invalid", "error", "baselines names repository b, which is not in repositories"],
      ["workspace.invalid", "error", "filters names repository f, which is not in repositories"],
      ["metamodel.invalid", "error", "Metamodel repository nope is not in repositories"],
    ]);
  });

  it("reports a missing metamodel folder in an available repository", async () => {
    const ws = await setup(yaml(MAIN, "metamodel: { repository: main, path: model }\n"));
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(layout.metamodel).toEqual({
      repository: "main",
      path: "model",
      folder: path.join(ws.path("main"), "model"),
      exists: false,
    });
    expect(layout.problems).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        file: WORKSPACE_FILE,
        message: "Metamodel folder model is missing in repository main",
      },
    ]);
  });

  it("gives an existing metamodel folder as its real path, links resolved and the name as stored, unless a link leads out of the repository (#231)", async () => {
    const ws = await setup(yaml(MAIN, "metamodel: { repository: main, path: METAMODEL }\n"));
    // Where the file system ignores letter case (APFS, NTFS), the folder typed in another case is
    // the stored one, spelled as stored; elsewhere it is missing.
    const typed = (await loadWorkspaceLayout(ws.path("main"))).metamodel;
    const sameCase = await fs.stat(ws.path("main/METAMODEL")).then(
      () => true,
      () => false,
    );
    expect(typed).toEqual({
      repository: "main",
      path: "METAMODEL",
      folder: ws.path(sameCase ? "main/metamodel" : "main/METAMODEL"),
      exists: sameCase,
    });
    await fs.symlink(ws.path("main/metamodel"), ws.path("main/linked"), "junction");
    await ws.write(`main/${WORKSPACE_FILE}`, yaml(MAIN, "metamodel: { repository: main, path: linked }\n"));
    expect((await loadWorkspaceLayout(ws.path("main"))).metamodel.folder).toBe(ws.path("main/metamodel"));
    await ws.write("shared/model/types.yaml", "types: {}\n");
    await fs.symlink(ws.path("shared/model"), ws.path("main/outside"), "junction");
    await ws.write(`main/${WORKSPACE_FILE}`, yaml(MAIN, "metamodel: { repository: main, path: outside }\n"));
    expect((await loadWorkspaceLayout(ws.path("main"))).metamodel).toEqual({
      repository: "main",
      path: "outside",
      folder: ws.path("main/outside"),
      exists: true,
    });
  });

  it("fails with workspace.not-found when there is no workspace file", async () => {
    const ws = await setup(undefined);
    const error = await failure(loadWorkspaceLayout(ws.path("main")));
    expect(error.toJSON()).toEqual({
      code: "workspace.not-found",
      message: `No ${WORKSPACE_FILE} in the workspace folder`,
      details: { file: WORKSPACE_FILE },
    });
  });

  it("fails with workspace.not-found when the folder does not exist", async () => {
    const ws = await setup(undefined);
    const error = await failure(loadWorkspaceLayout(ws.path("nowhere")));
    expect(error.code).toBe("workspace.not-found");
  });

  it("fails with file.faulty for a workspace file with invalid YAML", async () => {
    const ws = await setup("reqseq-workspace: 1\nname: [unclosed\n");
    const error = await failure(loadWorkspaceLayout(ws.path("main")));
    expect(error.code).toBe("file.faulty");
    expect(error.details?.["problems"]).toEqual([
      expect.objectContaining({ code: "file.invalid-yaml", file: WORKSPACE_FILE }),
    ]);
    expect(error.message).toMatch(/^reqseq-workspace\.yaml is faulty: Invalid YAML at line/);
  });

  it("fails with file.faulty for a workspace file that does not match its schema", async () => {
    const ws = await setup("reqseq-workspace: 2\nname: W\nrepositories: []\n");
    const error = await failure(loadWorkspaceLayout(ws.path("main")));
    expect(error.code).toBe("file.faulty");
    const problems = error.details?.["problems"] as readonly {
      code: string;
      severity: string;
      file: string;
    }[];
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(new Set(problems.map((p) => `${p.code} ${p.severity} ${p.file}`))).toEqual(
      new Set([`workspace.invalid error ${WORKSPACE_FILE}`]),
    );
    expect(error.message).toContain(
      "Invalid reqseq-workspace.yaml: /reqseq-workspace must be equal to constant",
    );
  });
});

describe("locate and settingLocation", () => {
  it("resolve locations of the workspace file and the defaults in the main repository", async () => {
    const ws = await setup(
      yaml(
        `${MAIN}  - { name: a, url: u }\n  - { name: gone, url: u }\n`,
        "metamodel: { repository: main, path: metamodel }\nbaselines: { repository: a, path: snapshots }\n",
      ),
      { folders: ["a"] },
    );
    const layout = await loadWorkspaceLayout(ws.path("main"));
    expect(locate(layout, { repository: "a", path: "x/y" })).toEqual({
      repository: layout.repositories[1],
      folder: path.join(ws.path("a"), "x", "y"),
    });
    expect(locate(layout, { repository: "gone", path: "x" })).toEqual({
      repository: layout.repositories[2],
      folder: undefined,
    });
    expect(locate(layout, { repository: "nope", path: "x" })).toEqual({
      repository: undefined,
      folder: undefined,
    });
    expect(settingLocation(layout, "baselines")).toEqual({ repository: "a", path: "snapshots" });
    expect(settingLocation(layout, "filters")).toEqual({ repository: "main", path: "filters" });
    expect(settingLocation(layout, "mappings")).toEqual({ repository: "main", path: "reqif" });
  });
});

describe("workspaceLayoutState", () => {
  it("reads the layout once per workspace and again after a reset", async () => {
    const ws = await setup(yaml(MAIN));
    const workspace = new Workspace(ws.path("main"));
    onTestFinished(() => workspace.close());
    const first = await workspace.get(workspaceLayoutState);
    expect(await workspace.get(workspaceLayoutState)).toBe(first);
    await ws.write(`main/${WORKSPACE_FILE}`, yaml(MAIN).replace("name: W", "name: Renamed"));
    expect((await workspace.get(workspaceLayoutState)).name).toBe("W");
    await workspace.reset(workspaceLayoutState);
    expect((await workspace.get(workspaceLayoutState)).name).toBe("Renamed");
  });

  it("does not keep a failed read", async () => {
    const ws = await setup(undefined);
    const workspace = new Workspace(ws.path("main"));
    onTestFinished(() => workspace.close());
    await expect(workspace.get(workspaceLayoutState)).rejects.toMatchObject({ code: "workspace.not-found" });
    await ws.write(`main/${WORKSPACE_FILE}`, yaml(MAIN));
    expect((await workspace.get(workspaceLayoutState)).name).toBe("W");
  });
});
