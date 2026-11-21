// `resolveSelection` with `selection.baseline` (selection.ts, SR-101, SR-061 AK2): every command
// that takes a selection takes it (#1353). On fixtures/SR-061/export (its README lists the baselines and the expected selections);
// what data.export makes of it: commands/data/export.test.ts.
import { rm } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandError } from "../catalog.js";
import {
  COPIED,
  COPIED_FILES,
  GUSTS_COPY,
  GUSTS_FILE,
  openCopied,
  openCopiedFile,
} from "../commands/copied.test-helper.js";
import type { ElementSelection } from "../generated/types.js";
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

/** The context of a command that names no `selection.output` (its tests: commands/element/list-output.test.ts, runtime/output-elements.test.ts). */
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

describe("selection by UUID and repository (inRepository, #2024)", () => {
  /** A need of fixtures/SR-089/missing-targets, in `system` only. */
  const NEED = "7d2c9e4f-1a3b-4c5d-8e6f-0a1b2c3d4e5f";
  const where = (elements: readonly { readonly repository: string; readonly file: string }[]): string[] =>
    elements.map((e) => `${e.repository}:${e.file}`);
  const errorOf = async (workspace: Workspace, selection: ElementSelection): Promise<unknown> =>
    resolveSelection(callerOf(workspace), selection, "element.list").then(
      () => undefined,
      (e: unknown) => (e as CommandError).toJSON(),
    );

  it("[SR-101/AK-w8dm] selects the copy of a UUID in the repository named, which ids refuses as ambiguous", async () => {
    const workspace = await openCopied();
    const caller = callerOf(workspace);
    const sensor = await resolveSelection(
      caller,
      { inRepository: [{ id: GUSTS_COPY.toUpperCase(), repository: "sensor" }] },
      "element.list",
    );
    expect(where(sensor.elements)).toEqual([`sensor:${GUSTS_FILE}`]);
    const both = await resolveSelection(
      caller,
      {
        inRepository: [
          { id: GUSTS_COPY, repository: "sensor" },
          { id: GUSTS_COPY, repository: "system" },
          { id: GUSTS_COPY, repository: "sensor" },
        ],
      },
      "element.list",
    );
    // Store order, each once.
    expect(where(both.elements)).toEqual([`system:${GUSTS_FILE}`, `sensor:${GUSTS_FILE}`]);
    expect(await errorOf(workspace, { ids: [GUSTS_COPY] })).toMatchObject({ code: "ref.ambiguous" });
    expect((await resolveSelection(caller, { inRepository: [] }, "element.list")).elements).toEqual([]);
  });

  it("[SR-101/AK-w8dm] holds with every other part of the selection, ids included", async () => {
    const workspace = await openCopied();
    const caller = callerOf(workspace);
    const inRepository = [
      { id: GUSTS_COPY, repository: "sensor" },
      { id: NEED, repository: "system" },
    ];
    const withIds = await resolveSelection(
      caller,
      { inRepository, ids: [NEED, "SR-c4d5e6f7a8b9"] },
      "element.list",
    );
    expect(withIds.elements.map((e) => e.id)).toEqual([NEED]);
    const withWhere = await resolveSelection(
      caller,
      { inRepository, where: { type: ["system-requirement"] } },
      "element.list",
    );
    expect(where(withWhere.elements)).toEqual([`sensor:${GUSTS_FILE}`]);
  });

  it("[SR-101/AK-w8dm] selects both copies of a UUID in one repository", async () => {
    const selected = await resolveSelection(
      callerOf(await openCopiedFile()),
      { inRepository: [{ id: COPIED, repository: "system" }] },
      "element.list",
    );
    expect(selected.elements.map((e) => e.file).sort()).toEqual([...COPIED_FILES].sort());
  });

  it("[SR-101/AK-w8dm] refuses an item that names no element, as an ids item", async () => {
    const workspace = await openCopied();
    expect(await errorOf(workspace, { inRepository: [{ id: GUSTS_COPY, repository: "vault" }] })).toEqual({
      code: "ref.unknown",
      message: `${GUSTS_COPY} names no element in repository vault; see the candidates for where it is`,
      details: {
        ref: GUSTS_COPY,
        repository: "vault",
        candidates: [
          { id: GUSTS_COPY, repository: "system", file: GUSTS_FILE },
          { id: GUSTS_COPY, repository: "sensor", file: GUSTS_FILE },
        ],
      },
    });
    const unknown = "0f0e0d0c-0b0a-4908-8706-050403020100";
    expect(await errorOf(workspace, { inRepository: [{ id: unknown, repository: "system" }] })).toEqual({
      code: "ref.unknown",
      message: `No element has the UUID "${unknown}"`,
      details: { ref: unknown },
    });
  });
});
