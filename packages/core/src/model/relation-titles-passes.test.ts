// The refresh of stored titles (`relation-titles.ts`, decision on #307) costs one pass of the
// lossless writer per written file, however many titles are stale (N-036), and a refused pass
// never blocks the write it is part of. The writer is wrapped so a test can count and fail calls.
import fs from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import type * as files from "../files/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

interface Control {
  calls: number;
  /** Called before each call of the writer with its 1-based number; may throw to make it fail. */
  before: (call: number) => void;
}

const control: Control = vi.hoisted(() => ({ calls: 0, before: () => undefined }));

vi.mock("../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    editElementFile: (...args: Parameters<typeof files.editElementFile>) => {
      control.calls += 1;
      control.before(control.calls);
      return actual.editElementFile(...args);
    },
  };
});

const P = "5e025a7d-2b4f-4c61-9d08-0";
const N = `${P}a0000000001`;
const A = `${P}b0000000001`;
const N_FILE = "needs/N-0a0000000001.md";
const A_FILE = "requirements/SR-0b0000000001.md";
const N_VERSION = "n1:323df2732ed684b0";
const STALE = 1000;

/** fixtures/SR-025/outdated with N renamed and A deriving from N `STALE` times, each with the old title. */
const open = async (): Promise<{ workspace: Workspace; text: string; read: () => string }> => {
  const entries = Array.from(
    { length: STALE },
    () => `  - { id: ${N}, version: ${N_VERSION}, title: See the wind }`,
  ).join("\n");
  const text = [
    "---",
    `id: ${A}`,
    "type: system-requirement",
    "status: draft",
    "title: Show wind speed",
    "requirement-type: functional",
    "derives-from:",
    entries,
    "---",
    "",
    "Text.",
    "",
  ].join("\n");
  const need = `---\nid: ${N}\ntype: need\nstatus: approved\ntitle: See the gusts\n---\n\nThe operator sees the wind at a glance.\n`;
  const ws = await createFixtureWorkspace({
    fixture: "SR-025/outdated",
    files: { [A_FILE]: text, [N_FILE]: need },
  });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  control.calls = 0;
  control.before = () => undefined;
  return { workspace, text, read: () => fs.readFileSync(ws.path(A_FILE), "utf8") };
};

describe("refreshing stored titles in one pass (decision on #307, N-036)", () => {
  it("refreshes 1,000 stale titles of one file with one more pass of the writer", async () => {
    const { workspace, text, read } = await open();
    await invoke("element.update", { ref: A, set: { "requirement-type": "quality" } }, { workspace });
    // One pass for the change, one for all stale titles.
    expect(control.calls).toBe(2);
    expect(read()).toBe(
      text
        .replace("requirement-type: functional", "requirement-type: quality")
        .replaceAll("title: See the wind }", "title: See the gusts }"),
    );
  });

  it("writes the change with the stored titles as they are when the writer refuses the refresh", async () => {
    const { workspace, text, read } = await open();
    control.before = (call) => {
      if (call === 2) {
        throw new CommandError("internal", "Not written: refused");
      }
    };
    const result = await invoke(
      "element.update",
      { ref: A, set: { "requirement-type": "quality" } },
      { workspace },
    );
    expect(result).toMatchObject({ files: [A_FILE] });
    expect(read()).toBe(text.replace("requirement-type: functional", "requirement-type: quality"));
  });
});
