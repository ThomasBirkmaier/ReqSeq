// Tests for behaviour that the mutation run of #704 found untested in store.ts: the order of paths,
// a file read again that did not parse before and after, with another result, and snapshots of a
// write that differ from the store's in one field only.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { FileSnapshot } from "../files/index.js";
import type { ElementStore } from "./store.js";
import {
  byPath,
  elementStoreState,
  loadElements,
  StoreFallback,
  updateElements,
  withWrittenFiles,
} from "./store.js";
import { writtenElement } from "./write.js";

describe("byPath", () => {
  it("orders paths by UTF-16 code units, as the file listing does", () => {
    expect(byPath("a", "b")).toBe(-1);
    expect(byPath("b", "a")).toBe(1);
    expect(byPath("a", "a")).toBe(0);
    expect(["b/x.md", "a/é.md", "a/z.md", "B.md"].sort(byPath)).toEqual([
      "B.md",
      "a/z.md",
      "a/é.md",
      "b/x.md",
    ]);
  });
});

describe("updating the element store file by file (SR-007)", () => {
  const FAULTY = "notes/faulty.md";

  const problemsOf = (store: ElementStore): unknown[] => store.problems.filter((p) => p.file === FAULTY);

  it("takes the new result of a file that did not parse before and does not parse after", async () => {
    const ws = await createFixtureWorkspace({
      fixture: "SR-007/external-changes",
      files: { [FAULTY]: "---\nid: [\n---\n" },
    });
    onTestFinished(() => ws.cleanup());
    const workspace = new Workspace(ws.root);
    onTestFinished(() => workspace.close());
    const layout = await workspace.get(workspaceLayoutState);
    const before = await workspace.get(elementStoreState);
    expect(problemsOf(before)).toHaveLength(1);
    await ws.write(FAULTY, "---\ntitle: T\nid: [\n---\n");
    const next = await updateElements(before, layout, new Map([["system", { paths: [FAULTY] }]]));
    expect(next).toBeDefined();
    expect(next).toEqual(await loadElements(layout));
    expect(problemsOf(next ?? before)).not.toEqual(problemsOf(before));
  });
});

describe("withWrittenFiles with snapshots that differ in one field (#166)", () => {
  const REQUIREMENT = "5cb1e198-1130-4a13-9d25-88cc6ebc472a";
  const REQUIREMENT_FILE = "requirements/SR-88cc6ebc472a.md";

  /** The fixture's store, the snapshot of the requirement in it, and a write of the same bytes. */
  const opened = async (): Promise<{
    before: ElementStore;
    old: FileSnapshot;
    apply: (snapshot: FileSnapshot, replaced: FileSnapshot) => Promise<ElementStore | undefined>;
  }> => {
    const ws = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => ws.cleanup());
    const workspace = new Workspace(ws.root);
    onTestFinished(() => workspace.close());
    const layout = await workspace.get(workspaceLayoutState);
    const before = await workspace.get(elementStoreState);
    const old = before.elements.find((e) => e.id === REQUIREMENT)?.snapshot;
    if (old === undefined) {
      throw new Error("expected the requirement in the store");
    }
    const bytes = new Uint8Array(await fs.readFile(ws.path(REQUIREMENT_FILE)));
    const apply = (snapshot: FileSnapshot, replaced: FileSnapshot): Promise<ElementStore | undefined> =>
      withWrittenFiles(before, layout, [
        { repository: "system", file: writtenElement("system", bytes, snapshot).file, replaced },
      ]);
    return { before, old, apply };
  };

  it("applies a write whose snapshot differs from the store's in the modification time or the size only", async () => {
    const { before, old, apply } = await opened();
    const later = { ...old, mtimeMs: old.mtimeMs + 1000 };
    const afterTime = await apply(later, old);
    expect(afterTime?.elements.find((e) => e.id === REQUIREMENT)?.snapshot).toEqual(later);
    const larger = { ...old, size: old.size + 1 };
    const afterSize = await apply(larger, old);
    expect(afterSize?.elements.find((e) => e.id === REQUIREMENT)?.snapshot).toEqual(larger);
    expect(before.elements.find((e) => e.id === REQUIREMENT)?.snapshot).toBe(old);
  });

  it("falls back when the write replaced a snapshot of another path than the store holds", async () => {
    const { old, apply } = await opened();
    const later = { ...old, mtimeMs: old.mtimeMs + 1000 };
    await expect(apply(later, { ...old, path: "requirements/SR-other.md" })).rejects.toThrow(StoreFallback);
  });
});
