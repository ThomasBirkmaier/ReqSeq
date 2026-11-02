// element.supersede writes the successor before the predecessor (#271), so an interruption between
// the two writes never leaves a retired element without a successor. The writer is wrapped so a test
// sees the order of the writes.
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type * as files from "../../files/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const control = vi.hoisted(() => ({ written: [] as string[] }));

vi.mock("../../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    writeFileAtomic: async (...args: Parameters<typeof files.writeFileAtomic>) => {
      control.written.push(args[1]);
      return actual.writeFileAtomic(...args);
    },
  };
});

const N_OLD = "needs/N-a1b2c3d4e5f6.md";
const N_NEW = "needs/N-b2c3d4e5f6a7.md";

const open = async (): Promise<{ workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-072/supersede" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  control.written = [];
  return { workspace };
};

const input = { ref: "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6", status: "obsolete", successor: "N-e5f6a7" };

describe("element.supersede write order", () => {
  it("writes the successor first and reports the predecessor first", async () => {
    const { workspace } = await open();
    const out = (await invoke("element.supersede", input, { workspace })) as { files: string[] };
    expect(control.written.map((file) => file.split(path.sep).join("/"))).toEqual([N_NEW, N_OLD]);
    expect(out.files).toEqual([N_OLD, N_NEW]);
  });
});
