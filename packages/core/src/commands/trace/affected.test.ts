// trace.affected through `invoke` (SR-024, SR-006 AK2, SR-013 AK3) on fixtures/SR-024/affected:
// input, errors and the output the catalog checks. The walk itself: trace/affected.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { writeFile } from "node:fs/promises";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceRecordsState } from "../../evidence/index.js";
import { STANDARD_MODEL_TEXT as STANDARD } from "../../metamodel/standard-model.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"trace.affected">;

const P = "5c0e1d2a-0024-4024-8024-00000000";
const SEE_WIND = `${P}a001`;
const SPEED = `${P}b001`;
const GUSTS = `${P}b002`;
const DIRECTION = `${P}b003`;
const STORMS = `${P}b004`;
const ANEMOMETER = `${P}d001`;

const AFFECTED: FixtureOptions = { fixture: "SR-024/affected" };

const open = async (options: FixtureOptions = AFFECTED): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** A verification record of `element` at `version` on `date`. */
const record = (element: string, version: string, date: string): EvidenceRecord => ({
  kind: "verification",
  element,
  version,
  method: "test",
  item: `build-${date.slice(5, 10)}`,
  result: "passed",
  date,
});

/** Gives `workspace` the evidence records `records` (#127 option 1). */
const withRecords = async (workspace: Workspace, records: readonly EvidenceRecord[]): Promise<void> => {
  const empty = workspace.get(evidenceRecordsState);
  expect(await empty).toEqual([]);
  await workspace.replace(evidenceRecordsState, empty, Promise.resolve(records));
};

/** The current version of an element, as element.get gives it. */
const versionOf = async (workspace: Workspace, ref: string): Promise<string> => {
  const { version } = ((await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">)
    .element;
  expect(version).toBeTypeOf("string");
  return String(version);
};

const affected = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("trace.affected", input, { workspace })) as Output;

const affectedError = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await affected(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected trace.affected to fail");
};

/** Entries as `[short ID, distance, via]`. */
const rows = (output: Output): unknown[] =>
  output.affected.map((a) => [a.shortId, a.distance, a.via.kind === "relation" ? a.via.key : "reference"]);

/** A path as UUIDs, each in the repository `system` of the fixture. */
const way = (...ids: readonly string[]): { id: string; repository: string }[] =>
  ids.map((id) => ({ id, repository: "system" }));

describe("trace.affected (SR-024)", () => {
  it("[SR-024/AK1] lists every element with a relation or a reference to the element, with way and distance", async () => {
    const workspace = await open();
    const output = await affected(workspace, { ref: "SR-00b001" });
    expect(rows(output)).toEqual([
      ["SR-00b002", 1, "derives-from"],
      ["SR-00b003", 1, "reference"],
      ["SR-00b004", 2, "derives-from"],
    ]);
    expect(output.affected[2]).toEqual({
      id: STORMS,
      shortId: "SR-00b004",
      type: "system-requirement",
      title: "Warn of storms",
      repository: "system",
      file: "requirements/SR-00000000b004.md",
      distance: 2,
      path: way(SPEED, GUSTS, STORMS),
      via: { kind: "relation", key: "derives-from" },
    });
    expect(output.affected[1]?.path).toEqual(way(SPEED, DIRECTION));
    expect([output.total, output.records, output.incomplete]).toEqual([3, [], false]);
  });

  it("[SR-024/AK1] gives one page of the affected elements in their order, with the total", async () => {
    const workspace = await open();
    const all = await affected(workspace, { ref: SEE_WIND });
    const page = await affected(workspace, { ref: SEE_WIND, limit: 2, offset: 1 });
    expect([page.affected, page.total]).toEqual([all.affected.slice(1, 3), 4]);
    const last = await affected(workspace, { ref: SEE_WIND, limit: 2, offset: 3 });
    expect(last.affected.map((a) => a.shortId)).toEqual(["SR-00b004"]);
    expect((await affected(workspace, { ref: SEE_WIND, offset: 9 })).affected).toEqual([]);
  });

  it("[SR-024/AK1] follows the chain down from a need, each element once at its shortest distance", async () => {
    const workspace = await open();
    const output = await affected(workspace, { ref: SEE_WIND });
    expect(rows(output)).toEqual([
      ["SR-00b001", 1, "derives-from"],
      ["SR-00b003", 1, "derives-from"],
      ["SR-00b002", 2, "derives-from"],
      ["SR-00b004", 3, "derives-from"],
    ]);
    expect(output.affected.map((a) => a.path)).toEqual([
      way(SEE_WIND, SPEED),
      way(SEE_WIND, DIRECTION),
      way(SEE_WIND, SPEED, GUSTS),
      way(SEE_WIND, SPEED, GUSTS, STORMS),
    ]);
  });

  it("[SR-024/AK1] counts every relation directly, also one that is no derivation, then goes on along the chain", async () => {
    const workspace = await open();
    // based-on (a relation kind without a meaning) and packages (a relation-valued property).
    expect(rows(await affected(workspace, { ref: ANEMOMETER }))).toEqual([
      ["SR-00b001", 1, "based-on"],
      ["SR-00b002", 2, "derives-from"],
      ["SR-00b003", 2, "reference"],
      ["SR-00b004", 3, "derives-from"],
    ]);
    expect(rows(await affected(workspace, { ref: "PKG-00e001" }))[0]).toEqual(["SR-00b001", 1, "packages"]);
    // A replacement points directly at the gusts; it is no step of the chain further on.
    expect(rows(await affected(workspace, { ref: GUSTS }))).toEqual([
      ["SR-00b004", 1, "derives-from"],
      ["SR-00b005", 1, "replaces"],
    ]);
    const fromSpeed = await affected(workspace, { ref: SPEED });
    expect(fromSpeed.affected.map((a) => a.shortId)).not.toContain("SR-00b005");
    // Nothing points at the storm warning.
    expect(await affected(workspace, { ref: STORMS })).toEqual({
      affected: [],
      total: 0,
      records: [],
      incomplete: false,
    });
  });

  it("[SR-006/AK2] is incomplete while a repository of the workspace file is not on this machine", async () => {
    const workspace = await open({
      ...AFFECTED,
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          '  - { name: vault, url: "git@git.example.com:ws/vault.git", path: ../vault }\n' +
          "metamodel: { repository: system, path: metamodel }\n",
      },
    });
    const output = await affected(workspace, { ref: "SR-00b001" });
    expect([output.affected.length, output.incomplete]).toEqual([3, true]);
  });

  it("[SR-024/AK4] lists the records of an older version of the element from the evidence folders, newest first", async () => {
    const workspace = await open();
    const current = await versionOf(workspace, "SR-00b001");
    const older = record(SPEED, "n1:1111111111111111", "2026-09-01T08:00:00Z");
    const oldest = record(SPEED, "n1:0000000000000000", "2026-08-01T08:00:00Z");
    const now = record(SPEED, current, "2026-10-01T08:00:00Z");
    await withRecords(workspace, [
      oldest,
      now,
      older,
      record(GUSTS, "n1:2222222222222222", "2026-09-02T08:00:00Z"),
    ]);
    const output = await affected(workspace, { ref: "SR-00b001" });
    expect(output.records).toEqual([older, oldest]);
    expect(rows(output)).toHaveLength(3);
    expect((await affected(workspace, { ref: "SR-00b004" })).records).toEqual([]);
  });

  it("[SR-024/AK4] lists no record as old while the current version of the element cannot be computed", async () => {
    const fixture = await createFixtureWorkspace(AFFECTED);
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    await withRecords(workspace, [record(SPEED, "n1:1111111111111111", "2026-09-01T08:00:00Z")]);
    expect((await affected(workspace, { ref: "SR-00b002" })).records).toEqual([]);
    // The file no longer holds the element; the store has not seen the change (no watcher).
    await writeFile(fixture.path("requirements/SR-00000000b001.md"), "No element any more.\n");
    expect((await affected(workspace, { ref: "SR-00b001" })).records).toEqual([]);
  });

  it("[SR-024/AK1] names an unknown element", async () => {
    const workspace = await open();
    const unknown = await affectedError(workspace, { ref: "SR-ffffff" });
    expect(unknown.code).toBe("ref.unknown");
  });

  it("[SR-013/AK3] reports which meaning is missing when no relation kind has the meaning derivation", async () => {
    const withoutDerivation = await open({
      ...AFFECTED,
      files: {
        "metamodel/standard-model.yaml": STANDARD.replaceAll("    meaning: derivation\n", ""),
      },
    });
    const error = await affectedError(withoutDerivation, { ref: "SR-00b001" });
    expect(error.code).toBe("metamodel.meaning-unassigned");
    expect(error.message).toContain("trace.affected");
  });
});
