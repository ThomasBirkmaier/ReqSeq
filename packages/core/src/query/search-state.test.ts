import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import type { StoreUpdate } from "../model/store.js";
import { applyStoreChange, elementStoreState, updateElements } from "../model/store.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import * as query from "./index.js";
import { SearchBuildCancelled, searchElements } from "./search-index.js";
import type { SearchIndex } from "./search-index.js";
import {
  SEARCH_CARRY_LIMIT,
  nextSearchIndex,
  searchIndex,
  searchIndexState,
  warmSearchIndex,
} from "./search-state.js";

const N1 = "6adc6d88-2177-457b-959d-545b7b379da2";
const N2 = "0b0e6f6c-3c1f-4c55-9d0e-0c1d2e3f4a5b";

const need = (id: string, title: string): string =>
  `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: ${title}\n---\n`;

const WORKSPACE =
  "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\n";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A workspace of 600 needs, more than a build reads before its first turn, with its model loaded. */
const loaded = async (): Promise<{ readonly fixture: FixtureWorkspace; readonly workspace: Workspace }> => {
  const files: Record<string, string> = {
    "logreq-workspace.yaml": WORKSPACE,
    "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
  };
  for (let n = 0; n < 600; n += 1) {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    files[`bulk/N-${id.slice(-12)}.md`] = need(id, `Bulk ${String(n)}`);
  }
  const fixture = await createFixtureWorkspace({ files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  await Promise.all([
    workspace.get(elementStoreState),
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
  ]);
  return { fixture, workspace };
};

/** Whether `value` settled within `ms`. */
const settles = async (value: Promise<unknown>, ms: number): Promise<boolean> => {
  let settled = false;
  value.then(
    () => (settled = true),
    () => (settled = true),
  );
  await wait(ms);
  return settled;
};

describe("search index in the background (ADR-0008, SR-082)", () => {
  it("is started after a delay, pauses while a command runs, and goes on for a search", async () => {
    const { workspace } = await loaded();
    let release = (): void => undefined;
    const command = workspace.runCommand(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    expect(workspace.busy).toBe(true);
    warmSearchIndex(workspace, 20);
    expect(workspace.peek(searchIndexState)).toBeUndefined();
    await wait(60);
    const building = workspace.peek(searchIndexState);
    if (building === undefined) {
      throw new Error("the build did not start");
    }
    // Paused at its first turn while the command runs.
    expect(await settles(building, 500)).toBe(false);
    // A search waits for it: then it goes on.
    const index: SearchIndex = await searchIndex(workspace);
    expect(index).toBe(await building);
    expect(searchElements(index, "bulk").total).toBe(600);
    release();
    await command;
    expect(workspace.busy).toBe(false);
  });

  it("builds the arrays of the first search at the end of a server's build, not of another build (SR-098)", async () => {
    const walks = (index: SearchIndex): boolean => {
      const ids = (index.engine.mini as unknown as { _documentIds: Map<number, unknown> })._documentIds;
      const walk = vi.spyOn(ids, Symbol.iterator);
      searchElements(index, "bulk");
      const walked = walk.mock.calls.length > 0;
      walk.mockRestore();
      return walked;
    };
    const server = await loaded();
    warmSearchIndex(server.workspace, 0);
    expect(walks(await searchIndex(server.workspace))).toBe(false);
    const other = await loaded();
    expect(walks(await searchIndex(other.workspace))).toBe(true);
  });

  it("goes on once the command has ended", async () => {
    const { workspace } = await loaded();
    let release = (): void => undefined;
    const command = workspace.runCommand(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    warmSearchIndex(workspace, 0);
    await wait(20);
    const building = workspace.peek(searchIndexState);
    expect(building).toBeDefined();
    expect(await settles(building ?? Promise.resolve(), 300)).toBe(false);
    release();
    await command;
    await expect(building).resolves.toMatchObject({ store: await workspace.get(elementStoreState) });
  });

  it("finishes a build that a carry waits for, then carries it", async () => {
    const { fixture, workspace } = await loaded();
    let release = (): void => undefined;
    const command = workspace.runCommand(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    warmSearchIndex(workspace, 0);
    await wait(20);
    const building = workspace.peek(searchIndexState);
    // A save while the build is paused: the state is now the carry, which waits for the build.
    await fixture.write("bulk/N-0c1d2e3f4a5b.md", need(N2, "Hail"));
    const layout = await workspace.get(workspaceLayoutState);
    await applyStoreChange(workspace, (store) =>
      updateElements(store, layout, new Map([["system", { paths: ["bulk/N-0c1d2e3f4a5b.md"] }]])),
    );
    const carrying = workspace.peek(searchIndexState);
    expect(carrying).not.toBe(building);
    release();
    await command;
    await expect(building).resolves.toBeDefined();
    const carried = await searchIndex(workspace);
    expect(carried).toBe(await carrying);
    expect(searchElements(carried, "hail").hits.map((h) => h.element.id)).toEqual([N2]);
    expect(searchElements(carried, "bulk").total).toBe(600);
  });

  it("stops a build whose state was reset, and a search waits for the next one", async () => {
    const { workspace } = await loaded();
    const building = workspace.get(searchIndexState);
    const searching = searchIndex(workspace);
    await workspace.reset(metamodelState);
    await expect(building).rejects.toThrow(SearchBuildCancelled);
    // A watcher that resets the metamodel during a search does not fail it.
    const index = await searching;
    expect(index).not.toBe(await building.catch(() => undefined));
    expect(searchElements(index, "bulk").total).toBe(600);
    // At most `attempts` times.
    const once = searchIndex(workspace, 1);
    expect(workspace.peek(searchIndexState)).toBeDefined();
    await workspace.reset(metamodelState);
    await expect(once).resolves.toBe(index);
    const twice = searchIndex(workspace, 1);
    await workspace.reset(metamodelState);
    await expect(twice).rejects.toThrow(SearchBuildCancelled);
  });

  it("is not paused for a command that searches, and is read only through searchIndex", async () => {
    const { workspace } = await loaded();
    const index = await workspace.runCommand(() => searchIndex(workspace));
    expect(searchElements(index, "bulk").total).toBe(600);
    // The state is no export of the block: awaiting it directly would pause it for the command.
    expect(Object.keys(query)).not.toContain("searchIndexState");
    expect(Object.keys(query)).toContain("searchIndex");
  });
});

describe("search index over a large change (ADR-0008)", () => {
  it("is built again, not carried, after a change of more than SEARCH_CARRY_LIMIT UUIDs", async () => {
    const fixture = await createFixtureWorkspace({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\n",
        "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
        "needs/N-545b7b379da2.md": need(N1, "Wind"),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const index = await searchIndex(workspace);
    await fixture.write("needs/N-0c1d2e3f4a5b.md", need(N2, "Hail"));
    const later = new Workspace(fixture.root);
    onTestFinished(() => later.close());
    const to = await later.get(elementStoreState);
    // A checkout: more UUIDs than the limit (only their number counts here).
    const ids = new Set(Array.from({ length: SEARCH_CARRY_LIMIT + 1 }, (_, n) => String(n)));
    const update: StoreUpdate = {
      from: index.store,
      to,
      files: new Map(),
      ids,
      repositories: to.repositories ?? [],
    };
    const next = await nextSearchIndex(index, update);
    expect(next.engine).not.toBe(index.engine);
    expect(next.store).toBe(to);
    expect(searchElements(next, "hail").hits.map((h) => h.element.id)).toEqual([N2]);
    // The index before is not changed.
    expect(searchElements(index, "hail").total).toBe(0);
  });
});
