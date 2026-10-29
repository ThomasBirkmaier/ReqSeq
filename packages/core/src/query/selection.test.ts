// `resolveSelection` with `selection.baseline` (selection.ts, SR-061 AK2, B1 of the plan review):
// only a command that opts in takes it (data.export); every other one refuses it, naming itself and
// stage 5. On fixtures/SR-061/export (its README lists the baselines and the expected selections);
// what data.export makes of it: commands/data/export.test.ts.
import { rm } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../catalog.js";
import { Workspace } from "../runtime/workspace.js";
import { resolveSelection } from "./selection.js";

const fixture = async (files: Readonly<Record<string, string>> = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-061/export", files });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (ws: FixtureWorkspace): Workspace => {
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

const shortIds = (ids: readonly { readonly id: string }[]): string[] => ids.map((e) => e.id.slice(-2));

describe("selection by baseline", () => {
  it("is refused by a command that does not take it, naming the command and stage 5", async () => {
    const workspace = open(await fixture());
    const error = await resolveSelection(workspace, { baseline: "Release 1" }, "element.list").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).toJSON()).toEqual({
      code: "input.invalid",
      message:
        "selection.baseline: for element.list a selection by baseline comes with stage 5; leave it out",
      details: { command: "element.list", fields: ["selection.baseline"] },
    });
  });

  it("selects the elements the baseline lists that meet every other part too", async () => {
    const workspace = open(await fixture());
    const selected = await resolveSelection(
      workspace,
      { baseline: "release-1", package: "PKG-0000d1" },
      "data.export",
      { baseline: true },
    );
    expect(shortIds(selected.elements)).toEqual(["b1"]);
    expect(selected.incomplete).toBe(false);
  });

  it("names none while the baselines folder is in a repository that is not on this machine", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml":
        "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }\n' +
        "metamodel: { repository: system, path: metamodel }\nbaselines: { repository: sensor, path: baselines }\n",
    });
    await rm(ws.path("sensor"), { recursive: true });
    const error = await resolveSelection(open(ws), { baseline: "Release 1" }, "data.export", {
      baseline: true,
    }).catch((e: unknown) => e);
    expect((error as CommandError).toJSON()).toEqual({
      code: "input.invalid",
      message:
        'selection.baseline: no baseline is named "Release 1" and no baseline file has that name; the baselines folder is in repository sensor, which is not on this machine',
      details: { command: "data.export", fields: ["selection.baseline"] },
    });
  });
});
