// `.reqseq/local.yaml` tracked by Git is not used (SR-004 AK8, #1456), through `loadWorkspaceLayout`:
// a main repository `main/` whose local file moves repository `a` from `../a` to `../elsewhere/a`.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as reader from "../git/reader.js";
import { LOCAL_FILE, WORKSPACE_FILE } from "./config.js";
import { loadWorkspaceLayout } from "./layout.js";

vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof reader>();
  return { ...original, trackedFile: vi.fn(original.trackedFile) };
});

afterEach(() => {
  vi.mocked(reader.trackedFile).mockClear();
});

const WORKSPACE =
  "reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: main, url: u, main: true }\n  - { name: a, url: u }\n" +
  "metamodel: { repository: main, path: metamodel }\n";

const LOCAL = "reqseq-local: 1\nrepositories:\n  a: { path: ../elsewhere/a }\n";

/** The fixture; with `committed`, the local file is in the first commit of `main`. */
const setup = async (options: {
  readonly git?: boolean;
  readonly committed?: boolean;
}): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({
    files: {
      [`main/${WORKSPACE_FILE}`]: WORKSPACE,
      "main/metamodel/types.yaml": "types: {}\n",
      ...(options.committed === true ? { [`main/${LOCAL_FILE}`]: LOCAL } : {}),
      "a/README.md": "x\n",
      "elsewhere/a/README.md": "x\n",
    },
    ...(options.git === false ? {} : { git: ["main"] }),
  });
  onTestFinished(() => ws.cleanup());
  if (options.committed !== true) {
    await ws.write(`main/${LOCAL_FILE}`, LOCAL);
  }
  return ws;
};

/** Where repository `a` is looked for, and the problems of the layout. */
const outcome = async (ws: FixtureWorkspace): Promise<readonly [string | undefined, readonly string[]]> => {
  const layout = await loadWorkspaceLayout(ws.path("main"));
  return [
    layout.repositories.find((r) => r.name === "a")?.path,
    layout.problems.map((p) => `${p.code} ${p.severity} ${String(p.file)}: ${p.message}`),
  ];
};

const IGNORED = "and the places of the workspace file apply";

describe("a tracked local file is not used (SR-004 AK8)", () => {
  it("[SR-004/AK-m7c2] ignores a committed local file with a warning, and the places of the workspace file apply", async () => {
    const ws = await setup({ committed: true });
    expect(await outcome(ws)).toEqual([
      "../a",
      [
        `workspace.invalid warning ${LOCAL_FILE}: ${LOCAL_FILE} is tracked by Git, so every clone would bring its places; remove it from Git (git rm --cached ${LOCAL_FILE}) and commit; it is ignored, ${IGNORED}`,
      ],
    ]);
  });

  it("[SR-004/AK-m7c2] ignores a staged local file, also in a repository without commits", async () => {
    const staged = await setup({});
    await staged.git(["add", LOCAL_FILE], "main");
    expect((await outcome(staged))[0]).toBe("../a");
    const fresh = await setup({ git: false });
    await fresh.git(["init", "--quiet", "--template="], "main");
    expect((await outcome(fresh))[0]).toBe("../elsewhere/a");
    await fresh.git(["add", LOCAL_FILE], "main");
    expect((await outcome(fresh))[0]).toBe("../a");
  });

  it("[SR-004/AK-m7c2] uses an untracked local file, and one in a folder without Git (SR-004 AK6)", async () => {
    const untracked = await setup({});
    expect(await outcome(untracked)).toEqual(["../elsewhere/a", []]);
    const plain = await setup({ git: false });
    vi.mocked(reader.trackedFile).mockClear();
    expect(await outcome(plain)).toEqual(["../elsewhere/a", []]);
    // No Git: no process is started for the local file.
    expect(reader.trackedFile).not.toHaveBeenCalled();
  });

  it("[SR-004/AK-m7c2] uses the local file without a git program, and ignores it when git refuses or fails (#1475)", async () => {
    const ws = await setup({});
    vi.mocked(reader.trackedFile).mockResolvedValueOnce({ known: false, reason: "no-git", detail: "x" });
    expect(await outcome(ws)).toEqual(["../elsewhere/a", []]);
    for (const reason of ["refused", "timeout", "not-a-repository"] as const) {
      vi.mocked(reader.trackedFile).mockResolvedValueOnce({
        known: false,
        reason,
        detail: `git said ${reason}`,
      });
      // A constant text: git's own message is not in it.
      expect(await outcome(ws)).toEqual([
        "../a",
        [
          `workspace.invalid warning ${LOCAL_FILE}: ${LOCAL_FILE} may be tracked by Git: Git could not tell; it is ignored, ${IGNORED}`,
        ],
      ]);
    }
  });

  it("[SR-004/AK-m7c2] uses the local file when the main repository has no Git, also with a repository at .reqseq", async () => {
    const ws = await setup({ git: false });
    await ws.git(["init", "--quiet", "--template="], "main/.reqseq");
    expect(await outcome(ws)).toEqual(["../elsewhere/a", []]);
    expect(reader.trackedFile).not.toHaveBeenCalled();
  });
});

describe("the local file Git is asked about is the one on disk (SR-004 AK8)", () => {
  it("[SR-004/AK-m7c2] ignores a local file reached through a linked .reqseq folder, also one inside the root", async () => {
    const ws = await setup({});
    await fs.rename(ws.path("main/.reqseq"), ws.path("main/cfg"));
    // A junction on Windows (no admin rights needed, an absolute target), a symbolic link elsewhere.
    await fs.symlink(ws.path("main/cfg"), ws.path("main/.reqseq"), "junction");
    expect(await outcome(ws)).toEqual([
      "../a",
      [
        `workspace.invalid warning ${LOCAL_FILE}: ${LOCAL_FILE} is reached through the link .reqseq; it is ignored, ${IGNORED}`,
      ],
    ]);
  });

  it("[SR-004/AK-m7c2] ignores a local file spelled otherwise on disk, as a case-insensitive file system opens it", async () => {
    const ws = await setup({});
    // The names as a case-insensitive file system lists them, while it opens `.reqseq/local.yaml`.
    const listing = (names: (folder: string) => string[]): typeof fs.readdir =>
      ((folder: string) => Promise.resolve(names(folder))) as unknown as typeof fs.readdir;
    const spy = vi.spyOn(fs, "readdir");
    onTestFinished(() => {
      spy.mockRestore();
    });
    spy.mockImplementation(listing((folder) => (folder.endsWith(".reqseq") ? ["Local.yaml"] : [".REQSEQ"])));
    expect((await outcome(ws))[1]).toEqual([
      `workspace.invalid warning ${LOCAL_FILE}: ${LOCAL_FILE} is not spelled so on disk; it is ignored, ${IGNORED}`,
    ]);
    spy.mockImplementation(listing((folder) => (folder.endsWith(".reqseq") ? ["Local.yaml"] : [".reqseq"])));
    expect((await outcome(ws))[0]).toBe("../a");
    spy.mockImplementation(() => Promise.reject(new Error("EACCES")));
    expect(await outcome(ws)).toEqual([
      "../a",
      [
        `workspace.invalid warning ${LOCAL_FILE}: ${LOCAL_FILE} cannot be checked: its folder or .reqseq cannot be listed; it is ignored, ${IGNORED}`,
      ],
    ]);
  });

  it("[SR-004/AK-m7c2] ignores a local file in a nested repository or submodule at .reqseq", async () => {
    const ws = await setup({});
    await ws.git(["init", "--quiet", "--template="], "main/.reqseq");
    expect(await outcome(ws)).toEqual([
      "../a",
      [
        `workspace.invalid warning ${LOCAL_FILE}: ${LOCAL_FILE} lies in another Git repository than the main repository (.reqseq is a submodule or a nested repository); it is ignored, ${IGNORED}`,
      ],
    ]);
  });
});
