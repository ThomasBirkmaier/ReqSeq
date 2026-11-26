// baseline.prepare through `invoke` (SR-242) on fixtures/SR-061/export (Git repositories `system` and
// `sensor`): three warnings and no error in the check (one about a type without acceptance criteria,
// SR-230 AK5), the baseline „Release 1“ without stored selection, `broken.yaml` that is no valid baseline, and the variants Coast (c1) and Inland (c2). Each number is
// compared with the command that gives it (D-082). Also the next steps of a read-only workspace (SR-226).
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { rm } from "node:fs/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, InvokedOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const ID = "61061061-0000-4000-8000-0000000000";

const fixture = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-061/export", git: ["system", "sensor"] });
  onTestFinished(() => ws.cleanup());
  return ws;
};

const call = async <N extends CommandName>(
  ws: FixtureWorkspace,
  name: N,
  input: object,
): Promise<InvokedOutput<N>> => {
  const workspace = new Workspace(ws.path("system"));
  try {
    return (await invoke(name, input, { workspace })) as InvokedOutput<N>;
  } finally {
    await workspace.close();
  }
};

/** The UUIDs `element.list` gives for the number `field` of `command` with `input` (SR-224 AK4). */
const counted = async (
  ws: FixtureWorkspace,
  command: string,
  input: object,
  field: string,
): Promise<string[]> =>
  (
    await call(ws, "element.list", { selection: { output: { command, input, count: { field } } } })
  ).elements?.map((e) => e.id) ?? [];

/** The step Create baseline with `selection`, only the name open (SR-242 AK4). */
const create = (selection: object): object => ({
  command: "baseline.create",
  input: { selection },
  open: ["name"],
});
const CHANGES = { command: "baseline.changes", input: {}, open: [] };

describe("baseline.prepare", () => {
  it("[SR-242/AK-cq4q] names the errors and warnings of the check and the verification degree, with the problems of workspace.check", async () => {
    const ws = await fixture();
    const out = await call(ws, "baseline.prepare", {});
    expect(out.answer).toBe(
      "The check found 0 errors and 3 warnings; 0 of 2 requirements in view core verified or indirectly verified (0 %).",
    );
    expect(out.problems).toEqual((await call(ws, "workspace.check", {})).problems);
    expect(out.wholeWorkspace).toBeUndefined();
  });

  it("[SR-242/AK-cq4q] says that the problems are those of the whole workspace for a selection, and when it has no valid requirement", async () => {
    const ws = await fixture();
    const out = await call(ws, "baseline.prepare", { selection: { ids: [`${ID}a1`] } });
    expect(out.wholeWorkspace).toBe(true);
    expect(out.problems).toEqual((await call(ws, "workspace.check", {})).problems);
    expect(out.answer).toBe(
      "The check found 0 errors and 3 warnings; the selection has no valid requirement in view core.",
    );
  });

  it("[SR-242/AK-fncy] gives the numbers of evidence.degree and evidence.withoutPassedTest for the selection's view, each a number of elements", async () => {
    const ws = await fixture();
    const selection = { view: `${ID}c1` };
    const out = await call(ws, "baseline.prepare", { selection });
    const degree = await call(ws, "evidence.degree", { selection });
    const without = await call(ws, "evidence.withoutPassedTest", { view: `${ID}c1` });
    expect([out.degree, out.view, out.withoutPassedTest]).toEqual([
      degree.degree,
      degree.view,
      without.total,
    ]);
    expect(out.names?.map((n) => n.id)).toEqual([`${ID}c1`]);
    expect(await counted(ws, "baseline.prepare", { selection }, "degree.counts.open")).toEqual(
      await counted(ws, "evidence.degree", { selection }, "degree.counts.open"),
    );
    expect(await counted(ws, "baseline.prepare", { selection }, "withoutPassedTest")).toEqual(
      (
        await call(ws, "element.list", {
          selection: { output: { command: "evidence.withoutPassedTest", input: { view: `${ID}c1` } } },
        })
      ).elements?.map((e) => e.id) ?? [],
    );
  });

  it("[SR-242/AK-hss7] names the newest baseline with the numbers of baseline.get, its problems apart from the check's", async () => {
    const ws = await fixture();
    const out = await call(ws, "baseline.prepare", {});
    const got = await call(ws, "baseline.get", { baseline: "Release 1" });
    const { added: _added, removed: _removed, ...counts } = got.counts;
    expect(out.baseline).toEqual({
      name: "Release 1",
      file: "baselines/release-1.yaml",
      repository: "system",
      date: "2026-10-23T09:00:00Z",
      selectionKnown: false,
      counts,
      problems: got.problems,
    });
    expect(out.problems.map((p) => p.code)).not.toContain("baseline.repository-commit-differs");
    // The faulty file as baseline.list names it, apart too.
    expect(out.baselineFiles?.problems).toEqual((await call(ws, "baseline.list", {})).problems);
    expect(await counted(ws, "baseline.prepare", {}, "baseline.counts.changed")).toEqual(
      await counted(ws, "baseline.get", { baseline: "Release 1" }, "counts.changed"),
    );
  });

  it("[SR-242/AK-hss7] gives no problems at a baseline that baseline.get finds none for", async () => {
    const ws = await fixture();
    await ws.write(
      "system/baselines/now.yaml",
      [
        "reqseq-baseline: 1",
        "name: Now",
        "date: 2026-11-19T10:00:00Z",
        "selection:",
        `  package: { id: ${ID}d1, title: Display }`,
        "repositories:",
        `  - { name: system, commit: ${await ws.head("system")} }`,
        "elements:",
        `  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }`,
        "",
      ].join("\n"),
    );
    const out = await call(ws, "baseline.prepare", {});
    expect(out.baseline).toMatchObject({ name: "Now", selectionKnown: true });
    expect(out.baseline?.problems).toBeUndefined();
    expect((await call(ws, "baseline.get", { baseline: "Now" })).problems).toBeUndefined();
  });

  it("[SR-242/AK-hss7] has no baseline without one", async () => {
    const ws = await fixture();
    await rm(ws.path("system/baselines"), { recursive: true });
    const out = await call(ws, "baseline.prepare", {});
    expect([out.baseline, out.baselineFiles]).toEqual([undefined, undefined]);
    expect(await counted(ws, "baseline.prepare", {}, "baseline.counts.changed")).toEqual([]);
  });

  it("[SR-242/AK-rqjf] names Create baseline with the selection given, else with the whole workspace, and Show changes since baseline", async () => {
    const ws = await fixture();
    expect((await call(ws, "baseline.prepare", {})).next).toEqual([create({}), CHANGES]);
    const selection = { filter: "Functional", view: `${ID}c1` };
    expect((await call(ws, "baseline.prepare", { selection })).next).toEqual([create(selection), CHANGES]);
    await rm(ws.path("system/baselines"), { recursive: true });
    expect((await call(ws, "baseline.prepare", {})).next).toEqual([create({})]);
  });

  it("[SR-242/AK-rqjf] leaves out Create baseline for a selection baseline.create refuses", async () => {
    const ws = await fixture();
    await ws.write(
      "system/filters/inland.yaml",
      `reqseq-filter: 1\nname: Inland\nview: ${ID}c2\nwhere: { type: [system-requirement] }\n`,
    );
    const nextOf = async (selection: object): Promise<unknown> =>
      (await call(ws, "baseline.prepare", { selection })).next;
    expect(await nextOf({ baseline: "Release 1" })).toEqual([CHANGES]);
    expect(await nextOf({ output: { command: "element.list", input: {} } })).toEqual([CHANGES]);
    expect(await nextOf({ filter: "Inland", view: `${ID}c1` })).toEqual([CHANGES]);
    // The filter's own view is no other view.
    expect(await nextOf({ filter: "Inland", view: `${ID}c2` })).toEqual([
      create({ filter: "Inland", view: `${ID}c2` }),
      CHANGES,
    ]);
  });

  it("[SR-242/AK-rqjf] [SR-226/AK-t0mt] leaves out Create baseline while the workspace is read-only", async () => {
    const ws = await fixture();
    await ws.write(
      "system/metamodel/broken.yaml",
      "reqseq-metamodel: 1\nstatuses:\n  - key: draft\n    name: [Draft\n",
    );
    const out = await call(ws, "baseline.prepare", {});
    expect(out.next).toEqual([CHANGES]);
  });

  it("gives the number without a passed test in the core of a metamodel without the validity meaning", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-003/any-folder" });
    onTestFinished(() => ws.cleanup());
    const workspace = new Workspace(ws.root);
    try {
      const out = (await invoke("baseline.prepare", {}, { workspace })) as InvokedOutput<"baseline.prepare">;
      const without = (await invoke(
        "evidence.withoutPassedTest",
        {},
        { workspace },
      )) as InvokedOutput<"evidence.withoutPassedTest">;
      expect(out.view).toBe("core");
      expect(out.withoutPassedTest).toBe(without.total);
    } finally {
      await workspace.close();
    }
  });

  it("[SR-242/AK-tsww] marks the output incomplete when a repository is not here", async () => {
    const ws = await fixture();
    await rm(ws.path("sensor"), { recursive: true });
    expect((await call(ws, "baseline.prepare", {})).incomplete).toBe(true);
  });
});
