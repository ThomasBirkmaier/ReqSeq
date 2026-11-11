// element.assignCriterionKeys (SR-204 AK3) into a folder that is not writable (SR-018 AK2), on
// fixtures/SR-001/two-elements. `isWritableFolder` asks `access(W_OK)`, which is always true for root
// (as in a container) and unknown on Windows, so the test decides which folders are not writable.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type * as layout from "../../workspace/index.js";

/** Folders (relative to `root`, `/` as separator) that count as not writable. */
const locked = vi.hoisted(() => ({ root: "", folders: [] as string[] }));

vi.mock("../../workspace/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof layout>();
  return {
    ...actual,
    isWritableFolder: (folder: string): Promise<boolean> =>
      Promise.resolve(
        !locked.folders.includes(path.relative(locked.root, folder).split(path.sep).join("/") || "."),
      ),
  };
});

/** A requirement without keys in a folder of its own, next to GUSTS of the fixture in requirements/. */
const OTHER = "other/SR-000000000a11.md";
const OTHER_TEXT =
  "---\nid: 20420420-0000-4000-8000-000000000a11\ntype: system-requirement\nstatus: draft\ntitle: Other\nrequirement-type: functional\nacceptance-criteria:\n  - Given it, then it holds.\n---\n";
const GUSTS = "requirements/SR-1d2e3f4a5b6c.md";

describe("element.assignCriterionKeys into a folder that is not writable", () => {
  it("refuses before any write, naming the folder", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-001/two-elements",
      files: { [OTHER]: OTHER_TEXT },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    locked.root = fixture.root;
    locked.folders = ["other"];
    const read = (): Promise<string[]> =>
      Promise.all([OTHER, GUSTS].map((f) => fs.readFile(fixture.path(f), "utf8")));
    const before = await read();
    const error = await invoke("element.assignCriterionKeys", { selection: {} }, { workspace }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CommandError);
    const { code, message, details } = error as CommandError;
    expect([code, message, details]).toEqual([
      "file.read-only",
      "Not written: folder other of repository system is not writable; nothing was written",
      { repository: "system", folder: "other" },
    ]);
    // The file in the writable folder is as it was too.
    expect(await read()).toEqual(before);
  });
});
