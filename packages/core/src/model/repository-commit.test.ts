// Why a repository has no commit (`RepositoryCommit.unknown`, SR-062 K3, review S5): one row of the
// mapping per case, git's own answers through `vi.mock` of the reader (as workspace/status.test.ts
// does), the others on real folders.
import fs from "node:fs";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as reader from "../git/reader.js";
import { repositoryCommit } from "./repository-commit.js";

vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof reader>();
  return {
    ...original,
    headCommit: vi.fn(original.headCommit),
    openObjectReader: vi.fn(original.openObjectReader),
  };
});

const fixture = async (git?: true): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ files: { "a.md": "# A\n" }, ...(git ? { git } : {}) });
  onTestFinished(() => created.cleanup());
  return created;
};

const at = (folder: string) => repositoryCommit({ name: "r", folder });

describe("repositoryCommit: why there is no commit (K3)", () => {
  it("takes git's reason when git is missing, refuses or does not answer", async () => {
    const ws = await fixture(true);
    for (const reason of ["no-git", "refused", "timeout"] as const) {
      vi.mocked(reader.headCommit).mockResolvedValueOnce({ known: false, reason, detail: "" });
      expect((await at(ws.root)).unknown).toBe(reason);
    }
  });

  it("is not-a-repository outside a work tree and no-commit in one without a commit", async () => {
    const plain = await fixture();
    expect(await at(plain.root)).toEqual({ unknown: "not-a-repository" });
    await plain.git(["init", "-q"]);
    expect(await at(plain.root)).toEqual({ unknown: "no-commit" });
  });

  it("below the top level: no-tree where the commit has nothing at the folder, else the reason of the lookup", async () => {
    const ws = await fixture(true);
    fs.mkdirSync(ws.path("sub"));
    expect(await at(ws.path("sub"))).toEqual({ unknown: "no-tree" });
    vi.mocked(reader.openObjectReader).mockImplementationOnce(() => ({
      info: () => Promise.resolve({ known: false, reason: "timeout", detail: "slow" }),
      read: () => Promise.resolve({ known: false, reason: "timeout", detail: "slow" }),
      close: () => undefined,
    }));
    await ws.write("spec/b.md", "# B\n");
    await ws.commit();
    expect(await at(ws.path("spec"))).toEqual({ unknown: "timeout" });
    expect(await at(ws.path("spec"))).toEqual({ commit: await ws.head() });
  });
});
