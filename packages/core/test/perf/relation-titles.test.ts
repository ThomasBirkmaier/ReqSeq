// Performance suite (ADR-0011): refreshing the stored titles of relation targets on a write
// (decision on spec question #307, `relation-titles.ts`). One requirement derives from 1,000 needs
// that were all renamed since, so a save of it refreshes 1,000 stale titles. The refresh is one pass
// of the lossless writer per file, so it stays within 1 s (N-036: the cost grows with the relations
// of the written file, not with their square). The whole save is recorded next to a save of the
// same file with every title current. Correctness is asserted as usual.
import fs from "node:fs";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace, measure } from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { editElementFile } from "../../src/files/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import { elementStoreState } from "../../src/model/index.js";
import { withCurrentTitles } from "../../src/model/relation-titles.js";
import { readUnchanged } from "../../src/model/write.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";

const TARGETS = 1000;
const REFRESH_MS = 1000;
const A = "5e025a7d-2b4f-4c61-9d08-0b0000000001";
const A_FILE = "requirements/SR-0b0000000001.md";
/** The same requirement with every title current: the save without a refresh, for comparison. */
const C = "5e025a7d-2b4f-4c61-9d08-0b00000000c1";
const C_FILE = "requirements/SR-0b00000000c1.md";
/** The UUID of the i-th need. */
const needId = (i: number): string => `9a0b1c2d-3e4f-4a5b-8c6d-${i.toString(16).padStart(12, "0")}`;

describe("stored titles of 1,000 renamed targets refreshed on one save (decision on #307, N-036)", () => {
  let fixture: FixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  const opened = (): Workspace => {
    if (workspace === undefined) {
      throw new Error("the workspace is not open");
    }
    return workspace;
  };

  beforeAll(async () => {
    const files: Record<string, string> = {};
    const entries: string[] = [];
    const current: string[] = [];
    for (let i = 0; i < TARGETS; i++) {
      const id = needId(i);
      files[`needs/N-${id.slice(-12)}.md`] =
        `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: Need ${String(i)} renamed\n---\n\nNeed ${String(i)}.\n`;
      entries.push(`  - { id: ${id}, version: n1:0000000000000000, title: Need ${String(i)} }`);
      current.push(`  - { id: ${id}, version: n1:0000000000000000, title: Need ${String(i)} renamed }`);
    }
    const requirement = (id: string, relations: readonly string[]): string =>
      [
        "---",
        `id: ${id}`,
        "type: system-requirement",
        "status: draft",
        "title: Show wind speed",
        "requirement-type: functional",
        "derives-from:",
        ...relations,
        "---",
        "",
        "Text.",
        "",
      ].join("\n");
    files[A_FILE] = requirement(A, entries);
    files[C_FILE] = requirement(C, current);
    fixture = await createFixtureWorkspace({ fixture: "SR-025/outdated", files });
    workspace = new Workspace(fixture.root);
    getCommandRuntime();
    expect((await workspace.get(elementStoreState)).elements.length).toBeGreaterThan(TARGETS);
  });

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  it("saves one element with 1,000 current relation titles (for comparison)", async () => {
    const { result } = await measure(
      "element.update: save one element with 1,000 relations, no stale title",
      () =>
        invoke("element.update", { ref: C, set: { "requirement-type": "quality" } }, { workspace: opened() }),
      { basis: "N-036 (reference for the save with 1,000 stale titles)" },
    );
    expect((result as CommandOutput<"element.update">).files).toEqual([C_FILE]);
  });

  it("refreshes 1,000 stale titles of one planned file within 1 s, and saves it", async () => {
    const current = opened();
    const [layout, metamodel, store] = await Promise.all([
      current.get(workspaceLayoutState),
      current.get(metamodelState),
      current.get(elementStoreState),
    ]);
    const record = store.byId.get(A)?.[0];
    if (record === undefined) {
      throw new Error("A is not in the store");
    }
    const unchanged = await readUnchanged(current, layout, record);
    const { bytes } = editElementFile(unchanged.current.file, {
      edits: [{ kind: "set", key: "requirement-type", value: "quality" }],
    });
    // Recorded with its threshold only (ADR-0011: untagged measurements do not assert); the pass count in
    // relation-titles-passes.test.ts guards the cost in the required suite.
    const { result: refreshed } = await measure(
      "withCurrentTitles: refresh 1,000 stale relation titles of one planned file",
      () => withCurrentTitles({ metamodel, store }, [{ ...unchanged, bytes }]),
      { basis: "N-036, decision on #307 (one writer pass per file)", thresholdMs: REFRESH_MS },
    );
    expect(new TextDecoder().decode(refreshed[0]?.bytes).match(/renamed \}/g)).toHaveLength(TARGETS);
    // The whole save, recorded next to the one without a stale title.
    const { result } = await measure(
      "element.update: save one element with 1,000 stale relation titles",
      () =>
        invoke("element.update", { ref: A, set: { "requirement-type": "quality" } }, { workspace: opened() }),
      { basis: "N-036, decision on #307 (compare with the save without a stale title)" },
    );
    expect((result as CommandOutput<"element.update">).files).toEqual([A_FILE]);
    const text = fs.readFileSync(fixture?.path(A_FILE) ?? "", "utf8");
    expect(text.match(/renamed \}/g)).toHaveLength(TARGETS);
  });
});
