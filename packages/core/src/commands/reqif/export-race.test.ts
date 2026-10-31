// reqif.export (SR-052) reads each image again before it copies it: an image changed or removed
// after the export read it is refused, not copied. The second read is where the test changes it.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../../catalog.js";
import type * as files from "../../files/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const IMAGE = "requirements/SR-0000000052a1/anemometer.png";
const race = vi.hoisted(() => ({
  change: (absolute: string): Promise<void> => Promise.reject(new Error(`no change set for ${absolute}`)),
  reads: 0,
}));

vi.mock("../../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    readFileSnapshot: async (root: string, file: string) => {
      if (file === IMAGE && ++race.reads === 2) {
        await race.change(path.join(root, file));
      }
      return actual.readFileSnapshot(root, file);
    },
  };
});

describe("reqif.export of an image that changes (SR-052)", () => {
  it.each([
    ["changed", (absolute: string) => fs.writeFile(absolute, "changed")],
    ["removed", (absolute: string) => fs.rm(absolute)],
  ])("refuses an image %s since it was read, writing no file", async (_name, change) => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-052/package" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    race.reads = 0;
    race.change = async (absolute) => {
      await change(absolute);
    };
    const error = await invoke(
      "reqif.export",
      { output: "s6.reqif", selection: { ids: ["52052052-0000-4000-8000-0000000052a1"] } },
      { workspace },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect([(error as CommandError).code, (error as CommandError).details?.["file"]]).toEqual([
      "file.changed-on-disk",
      IMAGE,
    ]);
    await expect(fs.stat(fixture.path("s6.reqif"))).rejects.toThrow();
    await expect(fs.stat(fixture.path("s6-images"))).rejects.toThrow();
  });
});
