// element.search when the element store is swapped between the selection and the search (a save or
// the watcher while the command waits for the index): the hits are records of the newer store, and
// the selection still restricts them, so a file the selection never saw is no hit. The swap is made
// right after `resolveSelection`, the only place where it can fall between the two (query/index.js
// is wrapped for this file only).
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type * as Query from "../../query/index.js";
import { applyStoreChange, elementStoreState, updateElements } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { workspaceLayoutState } from "../../workspace/index.js";

const hook = vi.hoisted(() => ({ afterSelection: undefined as (() => Promise<void>) | undefined }));

vi.mock("../../query/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof Query>();
  return {
    ...actual,
    resolveSelection: async (...args: Parameters<typeof actual.resolveSelection>) => {
      const selected = await actual.resolveSelection(...args);
      const after = hook.afterSelection;
      hook.afterSelection = undefined;
      await after?.();
      return selected;
    },
  };
});

const B2 = "69069069-0000-4000-8000-0000000000b2";
const GALE = "69069069-0000-4000-8000-0000000000a9";

describe("element.search over a store swapped while it runs", () => {
  it("restricts the hits of the newer store to the selection, also when it selects every element", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter" });
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    onTestFinished(() => ws.close());
    const search = async (input: Record<string, unknown>): Promise<CommandOutput<"element.search">> =>
      (await invoke("element.search", input, { workspace: ws })) as CommandOutput<"element.search">;
    expect((await search({ query: "gale" })).total).toBe(0);
    const before = await ws.get(elementStoreState);
    const swap = async (): Promise<void> => {
      await fs.writeFile(
        fixture.path("needs/N-0000000000a9.md"),
        `---\nid: ${GALE}\ntype: need\nstatus: draft\ntitle: Gale warnings\n---\n`,
      );
      await fs.appendFile(fixture.path("requirements/SR-0000000000b2.md"), "Gale force.\n");
      const layout = await ws.get(workspaceLayoutState);
      const changes = new Map([
        ["system", { paths: ["needs/N-0000000000a9.md", "requirements/SR-0000000000b2.md"] }],
      ]);
      await applyStoreChange(ws, (now) => updateElements(now, layout, changes));
    };
    hook.afterSelection = swap;
    const out = await search({ query: "gale" });
    expect(await ws.get(elementStoreState)).not.toBe(before);
    // The changed file counts with its new text; the new file was not in the selection.
    expect(out.hits.map((hit) => hit.id)).toEqual([B2]);
    // The next search selects from the new store.
    expect((await search({ query: "gale" })).hits.map((hit) => hit.id)).toEqual([GALE, B2]);
  });
});
