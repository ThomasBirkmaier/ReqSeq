// perspective.save (SR-213 AK3) replaces a perspective file only while it is unchanged since it was
// read: a change made after the read is refused, not overwritten. The read is where the test changes it.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../../catalog.js";
import type * as files from "../../files/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const FILE = "perspectives/mine.yaml";
const race = vi.hoisted(() => ({ change: undefined as ((absolute: string) => Promise<void>) | undefined }));

vi.mock("../../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    readYamlFile: async (root: string, file: string) => {
      const read = await actual.readYamlFile(root, file);
      if (file === FILE && race.change !== undefined) {
        await race.change(path.join(root, file));
      }
      return read;
    },
  };
});

describe("perspective.save of a file that changes (SR-213)", () => {
  it("refuses a perspective file changed on disk since it was read, keeping the change", async () => {
    const mine = "reqseq-perspective: 1\nname: Mine\nwhere: { all: [] }\n";
    const theirs = "reqseq-perspective: 1\nname: Mine\nwhere: { status: [draft] }\n";
    const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter", files: { [FILE]: mine } });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    race.change = (absolute) => fs.writeFile(absolute, theirs);
    onTestFinished(() => {
      race.change = undefined;
    });
    const error = await invoke("perspective.save", { name: "Mine", where: { any: [] } }, { workspace }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe("file.changed-on-disk");
    expect(await fs.readFile(fixture.path(FILE), "utf8")).toBe(theirs);
  });
});
