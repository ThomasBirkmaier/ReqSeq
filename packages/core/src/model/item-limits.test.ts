import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { itemLimitFindings, itemLimitProblemsState } from "./item-limits.js";
import { elementStoreState } from "./store.js";
import { withoutTitles } from "../hints/titles.test-helper.js";

const ID = "17100000-0000-4000-8000-000000";
const SR1 = `${ID}c00001`;
const SR2 = `${ID}c00002`;
const MODEL = "metamodel/model.yaml";

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-171/max-items", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

/** The hint of the fixture's SR-c00001, or of another requirement `n` with `count` entries. */
const hint = (count = 4, n = 1, line = 6): Problem => ({
  code: "element.too-many-items",
  severity: "warning",
  message: `This System Requirement has ${String(count)} ${count === 1 ? "entry" : "entries"} in Acceptance criteria (acceptance-criteria); at most 3`,
  repository: "system",
  file: `requirements/SR-000000c0000${String(n)}.md`,
  line,
  elementId: `${ID}c0000${String(n)}`,
  key: "acceptance-criteria",
  count,
  limit: 3,
});

/** A hint as a command gives it, with the element's short ID (ThomasBirkmaier/ReqSeq-archive#315). */
const shown = (problem: Problem): Problem => ({
  ...problem,
  elementShortId: `SR-${String(problem.elementId).slice(-6)}`,
});

const check = async (workspace: Workspace): Promise<readonly Problem[]> =>
  ((await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">).problems;

describe("the most entries of a list property (SR-171)", () => {
  it("[SR-171/AK-qqsg] gives a hint with element, property, count and maximum for more entries than max-items", async () => {
    const { workspace } = await open();
    const problems = await check(workspace);
    expect(problems.filter((p) => p.code === "element.too-many-items")).toEqual([shown(hint())]);
    const hints = (await invoke("hint.list", {}, { workspace })) as CommandOutput<"hint.list">;
    expect(withoutTitles(hints.hints).filter((p) => p.code === "element.too-many-items")).toEqual([
      shown(hint()),
    ]);
  });

  it("[SR-171/AK-ptxs] gives no count hint for a list property without max-items, however many entries", async () => {
    const { fixture } = await open();
    const model = await fs.readFile(fixture.path(MODEL), "utf8");
    // SR-c00002 has seven keywords, which have no max-items; without it on the criteria, none at all.
    const { workspace } = await open({ [MODEL]: model.replace(", max-items: 3", "") });
    expect(await workspace.get(itemLimitProblemsState)).toEqual([]);
    expect((await check(workspace)).filter((p) => p.key !== undefined)).toEqual([]);
    const got = (await invoke("element.get", { ref: SR1 }, { workspace })) as CommandOutput<"element.get">;
    expect(got.element.problems).toEqual([]);
  });

  it("gives none for a status marked invalid, an unknown type, a property the type lacks or a value that is no list", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const [record] = store.byId.get(SR1) ?? [];
    if (record === undefined) {
      throw new Error("no SR-c00001");
    }
    expect(itemLimitFindings(record, metamodel).map((f) => f.path)).toEqual([["acceptance-criteria"]]);
    const criteria = record.data["acceptance-criteria"];
    const variants = [
      { ...record, data: { ...record.data, status: "rejected" } },
      { ...record, type: "gizmo" },
      { ...record, data: { ...record.data, "acceptance-criteria": "one text" } },
      { ...record, data: { ...record.data, "acceptance-criteria": undefined, extra: criteria } },
      // A note has no acceptance criteria: its four entries are an unknown property (SR-016), not too many.
      { ...record, type: "note" },
    ];
    expect(variants.flatMap((element) => itemLimitFindings(element, metamodel))).toEqual([]);
  });

  it("gives nothing against a metamodel that is not valid", async () => {
    const { fixture } = await open();
    const model = await fs.readFile(fixture.path(MODEL), "utf8");
    const { workspace } = await open({
      [MODEL]: model.replace("kind: text, many: true }", "kind: text, max-items: 1 }"),
    });
    expect((await workspace.get(metamodelState)).valid).toBe(false);
    expect(await workspace.get(itemLimitProblemsState)).toEqual([]);
  });

  it("[SR-171/AK-nx3d] is shown at the element and after a bulk update, and carried over saves as a fresh build finds it", async () => {
    const { fixture, workspace } = await open();
    const got = (await invoke("element.get", { ref: SR1 }, { workspace })) as CommandOutput<"element.get">;
    expect(got.element.problems).toEqual([shown(hint())]);
    await workspace.get(itemLimitProblemsState);
    const bulk = (await invoke(
      "element.bulkUpdate",
      {
        selection: { ids: [SR2] },
        property: "acceptance-criteria",
        operation: "add",
        value: ["Shown on the map."],
        confirm: true,
      },
      { workspace },
    )) as CommandOutput<"element.bulkUpdate">;
    expect(bulk.problems).toEqual([shown(hint(4, 2))]);
    await invoke(
      "element.update",
      { ref: SR1, set: { "acceptance-criteria": ["Shown in m/s."] } },
      { workspace },
    );
    expect(workspace.peek(itemLimitProblemsState)).toBeDefined();
    const fresh = new Workspace(fixture.root);
    onTestFinished(() => fresh.close());
    const carried = await workspace.get(itemLimitProblemsState);
    expect(carried).toEqual(await fresh.get(itemLimitProblemsState));
    expect(carried).toEqual([hint(4, 2)]);
  });

  it("[SR-171/AK-nx3d] element.create and element.update save more entries than max-items, and the check reports the hint", async () => {
    const { workspace } = await open();
    const four = ["Shown in m/s.", "Shown in knots.", "Shown on the map.", "Shown in red."];
    const created = (await invoke(
      "element.create",
      { type: "system-requirement", title: "Four criteria", properties: { "acceptance-criteria": four } },
      { workspace },
    )) as CommandOutput<"element.create">;
    expect(created.element.properties["acceptance-criteria"]).toEqual(four);
    const updated = (await invoke(
      "element.update",
      { ref: SR2, set: { "acceptance-criteria": four } },
      { workspace },
    )) as CommandOutput<"element.update">;
    expect(updated.element.properties["acceptance-criteria"]).toEqual(four);
    const counted = (await check(workspace))
      .filter((p) => p.code === "element.too-many-items")
      .map((p) => [p.elementId, p.count]);
    expect(counted).toEqual(
      expect.arrayContaining([
        [created.element.id, 4],
        [SR2, 4],
      ]),
    );
  });

  it("says entry for a count of one", async () => {
    const { fixture } = await open();
    const model = await fs.readFile(fixture.path(MODEL), "utf8");
    const { workspace } = await open({
      [MODEL]: model.replace("max-items: 3", "max-items: 0"),
      "requirements/SR-000000c00003.md": `---\nid: ${ID}c00003\ntype: system-requirement\nstatus: draft\ntitle: Gusts\nacceptance-criteria: [Shown.]\n---\n`,
    });
    const messages = (await workspace.get(itemLimitProblemsState)).map((p) => p.message);
    expect(messages).toContain(
      "This System Requirement has 1 entry in Acceptance criteria (acceptance-criteria); at most 0",
    );
  });
});
