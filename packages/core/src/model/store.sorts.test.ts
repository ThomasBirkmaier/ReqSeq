// How often `withWrittenFiles` sorts a repository's files (#729): once per repository that got a
// new file, however many new files the write has. A module mock counts the sorts, so it needs a
// file of its own.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { FileSnapshot } from "../files/index.js";
import { writeFileAtomic } from "../files/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type * as PathOrder from "./path-order.js";
import { inPathOrder } from "./path-order.js";
import type { ElementStore, WrittenFile } from "./store.js";
import { elementStoreState, loadElements, withWrittenFiles } from "./store.js";
import { writtenElement } from "./write.js";

vi.mock("./path-order.js", async (importOriginal) => {
  const original = await importOriginal<typeof PathOrder>();
  return { ...original, inPathOrder: vi.fn(original.inPathOrder) };
});

const element = (id: string): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: T\n---\n\nText.\n`;

/** The UUID and file of the `i`th new element. */
const nth = (i: number, folder: string): { id: string; file: string } => {
  const tail = (0x100000000000 + i).toString(16).slice(-12);
  return { id: `00000000-0000-4000-8000-${tail}`, file: `${folder}/SR-${tail}.md` };
};

/** The three repositories of `SR-004/three-repositories`, read, and a way to write a file of one. */
const opened = async (): Promise<{
  before: ElementStore;
  layout: WorkspaceLayout;
  write: (repository: string, file: string, text: string, replaced?: FileSnapshot) => Promise<WrittenFile>;
}> => {
  const ws: FixtureWorkspace = await createFixtureWorkspace({ fixture: "SR-004/three-repositories" });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  const before = await workspace.get(elementStoreState);
  const layout = await workspace.get(workspaceLayoutState);
  const write = async (
    repository: string,
    file: string,
    text: string,
    replaced?: FileSnapshot,
  ): Promise<WrittenFile> => {
    await fs.mkdir(path.dirname(ws.path(`${repository}/${file}`)), { recursive: true });
    const snapshot = await writeFileAtomic(ws.path(repository), file, text, replaced ?? null);
    const written = writtenElement(repository, new TextEncoder().encode(text), snapshot);
    return { repository, file: written.file, replaced };
  };
  return { before, layout, write };
};

/** The sorts while `withWrittenFiles` takes `written`, and its result. */
const sorts = async (
  before: ElementStore,
  layout: WorkspaceLayout,
  written: readonly WrittenFile[],
): Promise<{ count: number; after: ElementStore | undefined }> => {
  vi.mocked(inPathOrder).mockClear();
  const after = await withWrittenFiles(before, layout, written);
  return { count: vi.mocked(inPathOrder).mock.calls.length, after };
};

describe("sorting the files of a write (#729)", () => {
  it("sorts a repository once, however many new files the write has", async () => {
    const { before, layout, write } = await opened();
    const created: WrittenFile[] = [];
    for (let i = 40; i > 0; i--) {
      const { id, file } = nth(i, i % 2 === 0 ? "z" : "a");
      created.push(await write("sensor", file, element(id)));
    }
    expect((await sorts(before, layout, created.slice(0, 4))).count).toBe(1);
    const { count, after } = await sorts(before, layout, created);
    expect(count).toBe(1);
    expect(after).toEqual(await loadElements(layout));
  });

  it("sorts each repository with a new file once, and none that only has changed files", async () => {
    const { before, layout, write } = await opened();
    const changed = before.elements.find((e) => e.repository === "system");
    if (changed === undefined) {
      throw new Error("the fixture has no element in system");
    }
    const update = await write("system", changed.file, element(changed.id), changed.snapshot);
    const written = [
      await write("product", nth(2, "b").file, element(nth(2, "b").id)),
      update,
      await write("sensor", nth(3, "c").file, element(nth(3, "c").id)),
      await write("product", nth(1, "a").file, element(nth(1, "a").id)),
    ];
    const { count, after } = await sorts(before, layout, written);
    expect(count).toBe(2);
    expect(after).toEqual(await loadElements(layout));
    expect(after?.elements.map((e) => [e.repository, e.file])).toEqual([
      ["system", changed.file],
      ["product", "N-929eca5f9cf4.md"],
      ["product", nth(1, "a").file],
      ["product", nth(2, "b").file],
      ["sensor", "anemometer/SR-481f080784bf.md"],
      ["sensor", nth(3, "c").file],
    ]);
    expect((await sorts(before, layout, [update])).count).toBe(0);
  });
});
