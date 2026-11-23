// baseline.changes through `invoke` (SR-241) on fixtures/SR-061/export (Git repositories `system` and
// `sensor`): its `release-1.yaml` stores no selection, `broken.yaml` is no valid baseline, and it has two
// open hints, an unknown property and an outdated relation (confirmable, D-042). Each number is compared
// with the command that gives it (D-082), and the next steps of a read-only workspace (SR-226).
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { rm } from "node:fs/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, InvokedOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const ID = "61061061-0000-4000-8000-0000000000";
const EXPORT: FixtureOptions = { fixture: "SR-061/export", git: ["system", "sensor"] };

/** A baseline of `ids` in the layout of ADR-0018, at the commit `commit` of `system`. */
const baseline = (
  name: string,
  date: string,
  commit: string,
  selection = "  package: { id: X, title: Display }",
  version = "n1:697a2ad17ed49170",
): string =>
  [
    "reqseq-baseline: 1",
    `name: ${name}`,
    `date: ${date}`,
    "selection:",
    selection.replace("X", `${ID}d1`),
    "repositories:",
    `  - { name: system, commit: ${commit} }`,
    "elements:",
    `  - { id: ${ID}b1, version: ${version} }`,
    "",
  ].join("\n");

const fixture = async (options: FixtureOptions = EXPORT): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace(options);
  onTestFinished(() => ws.cleanup());
  return ws;
};

const call = async <N extends CommandName>(
  ws: FixtureWorkspace,
  name: N,
  input: object,
  root = "system",
): Promise<InvokedOutput<N>> => {
  const workspace = new Workspace(ws.path(root));
  try {
    return (await invoke(name, input, { workspace })) as InvokedOutput<N>;
  } finally {
    await workspace.close();
  }
};

const failure = async (ws: FixtureWorkspace, input: object): Promise<CommandError> => {
  const error = await call(ws, "baseline.changes", input).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** `counts` of baseline.get for `name`, without `added` and `removed` when it stores no selection. */
const countsOf = async (ws: FixtureWorkspace, name: string): Promise<Record<string, number>> => {
  const got = await call(ws, "baseline.get", { baseline: name });
  const { added, removed, ...rest } = got.counts;
  return got.selectionKnown ? { ...rest, added, removed } : rest;
};

/** R1 of 2026-11-02 and R2 of 2026-11-09 next to the fixture's own baselines. */
const twoBaselines = async (): Promise<FixtureWorkspace> => {
  const ws = await fixture();
  const head = await ws.head("system");
  await ws.write("system/baselines/r1.yaml", baseline("R1", "2026-11-02T10:00:00Z", head));
  await ws.write("system/baselines/r2.yaml", baseline("R2", "2026-11-09T10:00:00Z", head));
  return ws;
};

describe("baseline.changes", () => {
  it("[SR-241/AK-p7s5] compares with the newest baseline by date and time, else with the one given, with the numbers of baseline.get", async () => {
    const ws = await twoBaselines();
    const newest = await call(ws, "baseline.changes", {});
    expect(newest.baseline).toEqual({
      name: "R2",
      file: "baselines/r2.yaml",
      repository: "system",
      date: "2026-11-09T10:00:00Z",
      selectionKnown: true,
      counts: await countsOf(ws, "R2"),
    });
    const given = await call(ws, "baseline.changes", { baseline: "R1" });
    expect([given.baseline?.name, given.baseline?.counts]).toEqual(["R1", await countsOf(ws, "R1")]);
    // At the same date and time the last file name wins; a name another file shares is given by its file name.
    await ws.write(
      "system/baselines/r3.yaml",
      baseline("R2", "2026-11-09T10:00:00Z", await ws.head("system"), undefined, "n1:0000000000000000"),
    );
    const tie = await call(ws, "baseline.changes", {});
    expect(tie.baseline?.file).toBe("baselines/r3.yaml");
    expect(tie.next).toContainEqual({
      command: "baseline.compare",
      input: { baseline: "r3.yaml" },
      open: ["ref"],
    });
  });

  it("[SR-241/AK-p7s5] names the view of a baseline over a variant, and the variant", async () => {
    const ws = await fixture();
    await ws.write(
      "system/baselines/coast.yaml",
      baseline("Coast 1", "2026-11-09T10:00:00Z", await ws.head("system"), `  view: ${ID}c1`),
    );
    const out = await call(ws, "baseline.changes", {});
    expect([out.baseline?.view, out.names?.map((n) => n.id)]).toEqual([`${ID}c1`, [`${ID}c1`]]);
  });

  it("[SR-241/AK-rnfc] lists every open hint and the number per kind as hint.list without a filter", async () => {
    const ws = await fixture();
    const out = await call(ws, "baseline.changes", {});
    const hints = await call(ws, "hint.list", {});
    expect(out.hintKinds.map((k) => k.code)).toEqual(["element.unknown-property", "relation.outdated"]);
    expect([out.hints, out.hintKinds, out.hintTotal]).toEqual([hints.hints, hints.kinds, hints.total]);
    // The page of the hints, as hint.list pages them; the numbers count all.
    const page = await call(ws, "baseline.changes", { limit: 1, offset: 1 });
    expect([page.hints, page.hintTotal]).toEqual([
      (await call(ws, "hint.list", { limit: 1, offset: 1 })).hints,
      2,
    ]);
  });

  it("[SR-241/AK-rnfc] names no kind without an open hint", async () => {
    const ws = await fixture({ fixture: "SR-043/example", git: true });
    const out = await call(ws, "baseline.changes", {}, ".");
    expect([out.hints, out.hintKinds, out.hintTotal]).toEqual([[], [], 0]);
  });

  it("[SR-241/AK-z038] names Confirm hints, Compare baseline with the baseline and Prepare baseline as next steps", async () => {
    const ws = await fixture();
    const out = await call(ws, "baseline.changes", {});
    expect(out.baseline?.counts.changed).toBeGreaterThan(0);
    expect(out.next).toEqual([
      { command: "hint.confirm", input: {}, open: ["hintIds"] },
      { command: "baseline.compare", input: { baseline: "Release 1" }, open: ["ref"] },
      { command: "baseline.prepare", input: {}, open: [] },
    ]);
  });

  it("[SR-241/AK-z038] leaves out Confirm hints without a confirmable hint and Compare baseline without a changed element", async () => {
    const ws = await fixture({ fixture: "SR-043/example", git: true });
    await call(ws, "baseline.create", { name: "Now", selection: {} }, ".");
    const out = await call(ws, "baseline.changes", {}, ".");
    expect(out.next).toEqual([{ command: "baseline.prepare", input: {}, open: [] }]);
  });

  it("[SR-241/AK-xjjt] says that there is no baseline yet, with the open hints and Prepare baseline and Confirm hints", async () => {
    const ws = await fixture();
    await rm(ws.path("system/baselines"), { recursive: true });
    const out = await call(ws, "baseline.changes", {});
    expect(out.answer).toBe("The workspace has no baseline; 2 open hints.");
    expect(out.baseline).toBeUndefined();
    expect(out.hints).toEqual((await call(ws, "hint.list", {})).hints);
    expect(out.next).toEqual([
      { command: "hint.confirm", input: {}, open: ["hintIds"] },
      { command: "baseline.prepare", input: {}, open: [] },
    ]);
  });

  it("[SR-241/AK-z038] [SR-241/AK-xjjt] [SR-226/AK-t0mt] names no write step while the workspace is read-only", async () => {
    const ws = await fixture();
    await ws.write(
      "system/metamodel/broken.yaml",
      "reqseq-metamodel: 1\nstatuses:\n  - key: draft\n    name: [Draft\n",
    );
    const read = async (): Promise<string[]> =>
      (await call(ws, "baseline.changes", {})).next.map((step) => step.command);
    expect(await read()).toEqual(["baseline.compare", "baseline.prepare"]);
    await rm(ws.path("system/baselines"), { recursive: true });
    expect(await read()).toEqual(["baseline.prepare"]);
  });

  it("[SR-241/AK-r3xg] says that nothing changed since the baseline, every number but the unchanged ones 0", async () => {
    const ws = await fixture({ fixture: "SR-043/example", git: true });
    await call(ws, "baseline.create", { name: "Now", selection: {} }, ".");
    const out = await call(ws, "baseline.changes", { baseline: "Now" }, ".");
    expect(out.answer).toBe(
      `Nothing changed since baseline Now of ${String(out.baseline?.date.slice(0, 10))}; no open hint.`,
    );
    const { unchanged, ...others } = out.baseline?.counts ?? { unchanged: 0 };
    expect([unchanged > 0, Object.values(others)]).toEqual([true, [0, 0, 0, 0, 0, 0]]);
  });

  it("[SR-241/AK-h6wy] marks the output incomplete without a repository, and passes on the problems of baseline.get", async () => {
    const ws = await fixture();
    await rm(ws.path("sensor"), { recursive: true });
    const out = await call(ws, "baseline.changes", {});
    const got = await call(ws, "baseline.get", { baseline: "Release 1" });
    expect(out.incomplete).toBe(true);
    expect(out.problems?.slice(0, got.problems?.length)).toEqual(got.problems);
    expect(got.problems?.map((p) => p.code)).toEqual(["baseline.repository-commit-differs"]);
  });

  it("[SR-241/AK-h6wy] says that a baseline without stored selection counts nothing added or removed, and has no such numbers", async () => {
    const ws = await fixture();
    const out = await call(ws, "baseline.changes", {});
    expect(out.baseline).toMatchObject({ name: "Release 1", selectionKnown: false });
    expect(Object.keys(out.baseline?.counts ?? {})).toEqual([
      "unchanged",
      "changed",
      "superseded",
      "missing",
      "inaccessible",
    ]);
    expect(out.answer).toBe(
      "Since baseline Release 1 of 2026-10-23, 1 changed and 1 missing; it stores no selection, so nothing is counted as added or removed; 2 open hints; 4 problems.",
    );
  });

  it("[SR-241/AK-jfjs] refuses an unknown or ambiguous baseline as baseline.get does, naming the reason", async () => {
    const ws = await twoBaselines();
    const unknown = await failure(ws, { baseline: "nope" });
    const expected = (await call(ws, "baseline.get", { baseline: "nope" }).catch(
      (e: unknown) => e,
    )) as CommandError;
    expect(unknown.toJSON()).toEqual({
      ...expected.toJSON(),
      details: { ...expected.details, command: "baseline.changes" },
    });
    expect(unknown.details?.["reason"]).toBe("unknown-baseline");
    await ws.write(
      "system/baselines/r1-copy.yaml",
      baseline("R1", "2026-11-03T10:00:00Z", await ws.head("system")),
    );
    expect((await failure(ws, { baseline: "R1" })).details?.["reason"]).toBe("ambiguous-baseline");
  });

  it("[SR-241/AK-jfjs] compares with the newest readable baseline and names the file that cannot be read as baseline.list", async () => {
    const ws = await twoBaselines();
    // Its header is the newest, its entries are no list.
    await ws.write(
      "system/baselines/r9.yaml",
      "reqseq-baseline: 1\nname: R9\ndate: 2026-11-19T10:00:00Z\nrepositories: []\nelements: none\n",
    );
    const out = await call(ws, "baseline.changes", {});
    const list = await call(ws, "baseline.list", {});
    expect(out.baseline?.name).toBe("R2");
    expect(list.problems?.map((p) => p.file)).toContain("baselines/r9.yaml");
    expect(out.problems?.slice(-(list.problems?.length ?? 0))).toEqual(list.problems);
  });

  it("[SR-224/AK-h9kx] the numbers of the baseline give the elements baseline.get counts", async () => {
    const ws = await fixture();
    const list = async (command: string, input: object, field: string): Promise<string[]> =>
      (
        await call(ws, "element.list", { selection: { output: { command, input, count: { field } } } })
      ).elements?.map((e) => e.id) ?? [];
    expect(await list("baseline.changes", {}, "baseline.counts.changed")).toEqual(
      await list("baseline.get", { baseline: "Release 1" }, "counts.changed"),
    );
    await rm(ws.path("system/baselines"), { recursive: true });
    expect(await list("baseline.changes", {}, "baseline.counts.changed")).toEqual([]);
  });
});
