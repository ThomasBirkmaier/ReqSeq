// `resolveSelection` with `selection.baseline` (selection.ts, SR-101, SR-061 AK2): every command
// that takes a selection takes it (#1353). On fixtures/SR-061/export (its README lists the baselines and the expected selections);
// what data.export makes of it: commands/data/export.test.ts.
import { rm } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandError } from "../catalog.js";
import { Workspace } from "../runtime/workspace.js";
import type { SelectionContext } from "./selection.js";
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

/** The context of a command that names no `selection.output` (its tests: output-selection.test.ts). */
const callerOf = (workspace: Workspace): SelectionContext => ({
  workspace,
  readOutputElements: () => Promise.reject(new Error("no selection.output here")),
});

const shortIds = (ids: readonly { readonly id: string }[]): string[] => ids.map((e) => e.id.slice(-2));

describe("selection by baseline", () => {
  it("selects the elements the baseline lists, as they are now, for every command that takes a selection (#1353)", async () => {
    const workspace = open(await fixture());
    for (const command of [
      "element.list",
      "evidence.coverage",
      "element.bulkUpdate",
      "data.export",
    ] as const) {
      const selected = await resolveSelection(callerOf(workspace), { baseline: "Release 1" }, command);
      expect(shortIds(selected.elements)).toEqual(["a1", "b1", "b3"]);
    }
  });

  it("selects the elements the baseline lists that meet every other part too", async () => {
    const workspace = open(await fixture());
    const selected = await resolveSelection(
      callerOf(workspace),
      { baseline: "release-1", package: "PKG-0000d1" },
      "data.export",
    );
    expect(shortIds(selected.elements)).toEqual(["b1"]);
    expect(selected.incomplete).toBe(false);
  });

  it("names none while the baselines folder is in a repository that is not on this machine", async () => {
    const ws = await fixture({
      "system/reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }\n' +
        "metamodel: { repository: system, path: metamodel }\nbaselines: { repository: sensor, path: baselines }\n",
    });
    await rm(ws.path("sensor"), { recursive: true });
    const error = await resolveSelection(callerOf(open(ws)), { baseline: "Release 1" }, "data.export").catch(
      (e: unknown) => e,
    );
    expect((error as CommandError).toJSON()).toEqual({
      code: "input.invalid",
      message:
        'selection.baseline: no baseline is named "Release 1" and no baseline file has that name; the baselines folder is in repository sensor, which is not on this machine',
      details: { command: "data.export", fields: ["selection.baseline"] },
    });
  });
});
