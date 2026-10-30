// The Git state of a new baseline (state.ts) on fixtures/SR-061/export (Git repositories `system`,
// main with the metamodel, and `sensor`): the commits of the repositories involved, and the refusal
// while a file of the selection is not committed. The command: commands/baseline/create.test.ts.
import fs from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import * as reader from "../git/reader.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Checked } from "./state.js";
import { involvedCommits, refuseUncommitted } from "./state.js";

vi.mock("../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof reader>();
  return { ...original, changedPaths: vi.fn(original.changedPaths) };
});

const ID = "61061061-0000-4000-8000-0000000000";
const B1 = "requirements/SR-0000000000b1.md";

/** The fixture, a fresh workspace object of `system` with its layout and the elements by tail of their UUID. */
const open = async (
  git: FixtureOptions["git"] = ["system", "sensor"],
): Promise<{
  ws: FixtureWorkspace;
  workspace: Workspace;
  layout: WorkspaceLayout;
  elements: (...tails: string[]) => ElementRecord[];
  checked: (tails: string[], embeds?: Checked["embeds"]) => Promise<Checked>;
}> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-061/export", git });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  const layout = await workspace.get(workspaceLayoutState);
  const store = await workspace.get(elementStoreState);
  const elements = (...tails: string[]): ElementRecord[] =>
    store.elements.filter((e) => tails.some((tail) => e.id === `${ID}${tail}`));
  const checked = async (tails: string[], embeds: Checked["embeds"] = new Map()): Promise<Checked> => ({
    elements: elements(...tails),
    embeds,
    metamodel: await workspace.get(metamodelState),
  });
  return { ws, workspace, layout, elements, checked };
};

/** The error `run` throws. */
const thrown = async (run: () => Promise<unknown>): Promise<CommandError> => {
  const error = await run().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

describe("involvedCommits", () => {
  it("gives the HEAD of the repositories of the elements, the main and the metamodel's, each once in workspace order", async () => {
    const { ws, layout, elements } = await open();
    const [system, sensor] = [await ws.head("system"), await ws.head("sensor")];
    const commits = async (...tails: string[]): Promise<[string, string][]> =>
      (await involvedCommits(layout, elements(...tails))).map((c) => [c.repository.name, c.commit]);
    expect(await commits("e1", "b1", "b2")).toEqual([
      ["system", system],
      ["sensor", sensor],
    ]);
    expect(await commits("b1")).toEqual([["system", system]]);
  });

  it("refuses a repository without commit, naming it and why", async () => {
    const { ws, layout, elements } = await open(["system"]);
    await ws.git(["init", "-q"], "sensor");
    const error = await thrown(() => involvedCommits(layout, elements("e1")));
    expect([error.code, error.details]).toEqual(["git.unavailable", { repository: "sensor" }]);
    expect(error.message).toContain("repository sensor has no commit (its Git repository has no commit yet)");
  });
});

describe("refuseUncommitted", () => {
  it("names changed element files, the elements of a changed embedded file and the other files", async () => {
    const { ws, workspace: first, layout, elements, checked } = await open();
    const commits = await involvedCommits(layout, elements("b1", "e1"));
    await expect(refuseUncommitted(first, commits, await checked(["b1", "e1"]))).resolves.toBeUndefined();
    await ws.write("system/requirements/wind.png", "png");
    await ws.write("system/requirements/calm.png", "png");
    await ws.write("system/metamodel/extra.yaml", "x: 1\n");
    const head = await ws.commit("system");
    const committed = commits.map((c) => (c.repository.name === "system" ? { ...c, commit: head } : c));
    const b1 = elements("b1");
    const embeds = new Map([
      [
        "system",
        new Map([
          ["requirements/wind.png", b1],
          ["requirements/calm.png", b1],
        ]),
      ],
    ]);
    await fs.promises.appendFile(ws.path(`system/${B1}`), "edited\n");
    await ws.write("system/requirements/wind.png", "changed");
    await fs.promises.rm(ws.path("system/metamodel/extra.yaml"));
    await fs.promises.appendFile(ws.path("system/reqseq-workspace.yaml"), "# edited\n");
    await fs.promises.appendFile(ws.path("system/requirements/SR-0000000000b3.md"), "outside\n");
    await ws.write("system/evidence/2026-11-01-SR-0000b1-test.md", "a record\n");
    const workspace = new Workspace(ws.path("system"));
    onTestFinished(() => workspace.close());
    const selection = { ...(await checked(["b1", "e1"])), embeds };
    const error = await thrown(() => refuseUncommitted(workspace, committed, selection));
    expect(error.code).toBe("baseline.uncommitted-changes");
    const details = error.details as { elements: unknown[]; files: { file: string }[] };
    expect(details.elements).toEqual([{ id: `${ID}b1`, repository: "system", file: B1 }]);
    expect(details.files.map((f) => f.file).sort()).toEqual([
      "metamodel/extra.yaml",
      "reqseq-workspace.yaml",
      "requirements/wind.png",
    ]);
    expect(error.message).toContain(`SR-0000b1 (${B1})`);
  });

  it("refuses where Git cannot tell", async () => {
    const { workspace, layout, elements, checked } = await open();
    const commits = await involvedCommits(layout, elements("b1"));
    vi.mocked(reader.changedPaths).mockResolvedValueOnce({ known: false, reason: "timeout", detail: "slow" });
    const error = await thrown(async () => refuseUncommitted(workspace, commits, await checked(["b1"])));
    expect([error.code, error.message]).toEqual([
      "git.unavailable",
      "Not created: repository system cannot be read by Git (timeout)",
    ]);
  });
});
