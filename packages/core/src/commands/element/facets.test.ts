// element.facets (#425) on fixtures/SR-069/filter (summary at the top of list.test.ts), with extra
// files where a value must be shared or odd:
// - SR b6 (draft, topic Timing, requirement-type written as the name "Functional", in P1);
// - SR b7 (status review, which the metamodel does not know; topic a mapping; packages: an unknown
//   UUID and P1 twice; requirement-type made-up);
// - SR b8 (topic a list Timing and Wind);
// - package P3 (approved; topic Timing, which the type package does not have).
// The consistency test is the strongest guard: whatever the facets count, the filter engine of
// element.list selects exactly those elements.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.facets">;
type Facet = Output["properties"][number];

const P = "69069069-0000-4000-8000-0000000000";
const P1 = `${P}d1`;

const sr = (tail: string, lines: string): string =>
  `---\nid: ${P}${tail}\ntype: system-requirement\ntitle: Extra ${tail}\nacceptance-criteria: [Given ${tail}]\n${lines}---\n`;

const EXTRA: Readonly<Record<string, string>> = {
  "requirements/SR-0000000000b6.md": sr(
    "b6",
    `status: draft\nrequirement-type: Functional\ntopic: Timing\npackages:\n  - { id: ${P1}, version: n1:1111111111111111 }\n`,
  ),
  "requirements/SR-0000000000b7.md": sr(
    "b7",
    `status: review\nrequirement-type: made-up\ntopic: { nested: true }\npackages:\n  - { id: 69069069-0000-4000-8000-0000000000ff, version: n1:1111111111111111 }\n  - { id: ${P1}, version: n1:1111111111111111 }\n  - { id: ${P1}, version: n1:1111111111111111 }\n`,
  ),
  "requirements/SR-0000000000b8.md": sr(
    "b8",
    "status: approved\nrequirement-type: functional\ntopic: [Timing, Wind]\n",
  ),
  "packages/PKG-0000000000d3.md": `---\nid: ${P}d3\ntype: package\nstatus: approved\ntitle: Extra package\ntopic: Timing\n---\n`,
};

/** Odd values: every kind of scalar in one text property, a number in a choice, an untitled target, a free validity name, an unknown type. */
const odd = (tail: string, lines: string): [string, string] => [
  `requirements/SR-00000000${tail}.md`,
  sr(tail, `status: approved\n${lines}`),
];
const ODD: Readonly<Record<string, string>> = Object.fromEntries([
  odd(
    "01",
    "topic: 7\nrequirement-type: 5\nvalidity: [Alpine]\npackages:\n  - { id: 69069069-0000-4000-8000-0000000000d4, version: n1:1111111111111111 }\n",
  ),
  odd("02", "topic: 3\n"),
  odd("03", "topic: true\n"),
  odd("04", "topic: timing\n"),
  odd("05", "topic: false\n"),
  odd("06", "topic: Aardvark\n"),
  ["packages/PKG-0000000000d4.md", `---\nid: ${P}d4\ntype: package\nstatus: approved\n---\n`],
  ["requirements/MYS-0000000000e9.md", `---\nid: ${P}e9\ntype: mystery\ntitle: Unknown type\n---\n`],
]);

const FILTER: FixtureOptions = { fixture: "SR-069/filter" };
const WITH_EXTRA: FixtureOptions = { ...FILTER, files: EXTRA };
const WITH_ODD: FixtureOptions = { ...FILTER, files: { ...EXTRA, ...ODD } };

const open = async (options: FixtureOptions = FILTER): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const facets = async (workspace: Workspace, input: Record<string, unknown> = {}): Promise<Output> =>
  (await invoke("element.facets", input, { workspace })) as Output;

const facet = (output: Output, key: string): Facet => {
  const found = output.properties.find((p) => p.key === key);
  if (found === undefined) {
    throw new Error(`no facet for ${key}`);
  }
  return found;
};

const SYSTEM = { selection: { where: { type: ["system-requirement"] } } };

const STANDARD_MODEL = fileURLToPath(
  new URL("../../../../../fixtures/SR-069/filter/metamodel/standard-model.yaml", import.meta.url),
);

describe("element.facets (#425)", () => {
  it("counts the statuses of the selection in metamodel order, then other statuses", async () => {
    const ws = await open();
    const plain = await facets(ws, SYSTEM);
    expect(plain.total).toBe(7);
    expect(plain.statuses).toEqual([
      { key: "draft", count: 3 },
      { key: "approved", count: 3 },
      { key: "obsolete", count: 1 },
    ]);
    const extra = await facets(await open(WITH_EXTRA), SYSTEM);
    expect(extra.statuses).toEqual([
      { key: "draft", count: 4 },
      { key: "approved", count: 4 },
      { key: "obsolete", count: 1 },
      { key: "review", count: 1 },
    ]);
  });

  it("gives only the properties a type of the selection has, in the order of the metamodel", async () => {
    const ws = await open();
    const needs = await facets(ws, { selection: { where: { type: ["need"] } } });
    expect(needs.properties.map((p) => p.key)).toEqual(["title", "rationale", "topic"]);
    const system = await facets(ws, SYSTEM);
    const keys = system.properties.map((p) => p.key);
    expect(keys).toContain("priority");
    expect(keys).toContain("packages");
    expect(keys.indexOf("title")).toBeLessThan(keys.indexOf("packages"));
    expect(keys).not.toContain("source-identifier-unknown");
    // `owner` is in a file but in no type: unknown properties are kept, not listed (SR-016).
    expect(keys).not.toContain("owner");
  });

  it("[SR-124/AK2] gives the values of a text property with few shared values, with counts and the elements without value", async () => {
    const ws = await open(WITH_EXTRA);
    const topic = facet(await facets(ws, SYSTEM), "topic");
    expect(topic).toMatchObject({ kind: "text", name: "Topic", count: 5, missing: 5, distinct: 2 });
    expect(topic.values).toEqual([
      { value: "Timing", count: 3 },
      { value: "Wind", count: 2 },
    ]);
  });

  it("[SR-124/AK3] leaves out the values of free text: too many distinct values, or none shared", async () => {
    const ws = await open(WITH_EXTRA);
    const out = await facets(ws, SYSTEM);
    expect(facet(out, "title").values).toBeUndefined();
    expect(facet(out, "title")).toMatchObject({ distinct: 10 });
    expect(facet(out, "title").distinctCapped).toBeUndefined();
    expect(facet(out, "acceptance-criteria").values).toBeUndefined();
    // No two elements share a value in the fixture alone (topic: Wind, Timing).
    expect(facet(await facets(await open(), SYSTEM), "topic").values).toBeUndefined();
    const narrow = await facets(ws, { ...SYSTEM, maxValues: 1 });
    expect(facet(narrow, "topic").values).toBeUndefined();
    expect(facet(narrow, "topic").distinct).toBe(2);
    // Counting stops after maxValues + 1 distinct values of free text: nobody needs the exact number.
    const capped = facet(await facets(ws, { ...SYSTEM, maxValues: 5 }), "title");
    expect([capped.distinct, capped.distinctCapped, capped.values]).toEqual([6, true, undefined]);
  });

  it("offers a few-valued property in a list that has only some of its values", async () => {
    const ws = await open(WITH_EXTRA);
    const out = await facets(ws, { selection: { ids: [`${P}b2`, `${P}b6`] } });
    expect(facet(out, "topic").values).toEqual([{ value: "Timing", count: 2 }]);
  });

  it("gives number values ascending", async () => {
    const out = await facets(await open(WITH_EXTRA), {
      selection: { where: { type: ["software-requirement"] } },
    });
    // priority 2 and 5 are not shared: no values; with one shared they would be listed.
    expect(facet(out, "priority")).toMatchObject({ kind: "number", count: 2, distinct: 2 });
    expect(facet(out, "priority").values).toBeUndefined();
    const same = await open({
      ...FILTER,
      files: {
        "requirements/SWR-0000000000f3.md": `---\nid: ${P}f3\ntype: software-requirement\nstatus: draft\ntitle: Third\nrequirement-type: functional\nacceptance-criteria: [Given f3]\npriority: 5\n---\n`,
        "requirements/SWR-0000000000f4.md": `---\nid: ${P}f4\ntype: software-requirement\nstatus: draft\ntitle: Fourth\nrequirement-type: functional\nacceptance-criteria: [Given f4]\npriority: 10\n---\n`,
      },
    });
    const shared = await facets(same, { selection: { where: { type: ["software-requirement"] } } });
    expect(facet(shared, "priority").values).toEqual([
      { value: 2, count: 1 },
      { value: 5, count: 2 },
      { value: 10, count: 1 },
    ]);
  });

  it("always gives choice values in metamodel order, with their names, and others as written", async () => {
    const out = await facets(await open(WITH_EXTRA), SYSTEM);
    const type = facet(out, "requirement-type");
    expect(type).toMatchObject({ kind: "choice", count: 10, missing: 0 });
    expect(type.values).toEqual([
      { value: "functional", count: 5, name: "Functional" },
      { value: "quality", count: 1, name: "Quality" },
      { value: "performance", count: 1, name: "Performance" },
      { value: "interface", count: 1, name: "Interface" },
      // "Functional" is a name `eq` maps to the key functional, "made-up" is no choice: taken as written.
      { value: "made-up", count: 1 },
    ]);
    expect(type.distinct).toBe(5);
  });

  it("gives relation targets by short ID with title and identifier, ordered by title", async () => {
    const out = await facets(await open(WITH_EXTRA), SYSTEM);
    const packages = facet(out, "packages");
    expect(packages).toMatchObject({ kind: "relation", count: 5, missing: 5, distinct: 2 });
    expect(packages.values).toEqual([
      { value: "PKG-0000d2", count: 2, title: "Display" },
      { value: "PKG-0000d1", count: 4, title: "Sensors" },
    ]);
    const validity = facet(await facets(await open(), SYSTEM), "validity");
    expect(validity.values).toEqual([
      { value: "VAR-0000c1", count: 1, title: "Coastal" },
      { value: "VAR-0000c2", count: 1, title: "Mountain" },
    ]);
  });

  it("does not offer a relation target that is not available, and counts the element as having a value", async () => {
    const out = await facets(await open(WITH_EXTRA), { selection: { ids: [`${P}b7`] } });
    const packages = facet(out, "packages");
    expect(packages).toMatchObject({ count: 1, missing: 0, distinct: 1 });
    expect(packages.values).toEqual([{ value: "PKG-0000d1", count: 1, title: "Sensors" }]);
    // A mapping where a text belongs is no value to filter on, but the element has one.
    expect(facet(out, "topic")).toMatchObject({ count: 1, missing: 0, distinct: 0 });
  });

  it("names the identifier of a relation target that has one", async () => {
    const ws = await open({
      ...WITH_EXTRA,
      files: {
        ...EXTRA,
        "metamodel/ids.yaml":
          "logreq-metamodel: 1\nproperties:\n  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }\ntypes:\n  - { key: package, name: Package, prefix: PKG, properties: [spec-id] }\n",
        "packages/PKG-0000000000d1.md": `---\nid: ${P1}\ntype: package\nstatus: approved\ntitle: Sensors\nspec-id: P-1\n---\n`,
      },
    });
    const packages = facet(await facets(ws, { selection: { ids: [`${P}b6`] } }), "packages");
    expect(packages.values).toEqual([{ value: "PKG-0000d1", count: 1, title: "Sensors", identifier: "P-1" }]);
  });

  it("gives values of every kind in order and takes a choice stored as a number as written", async () => {
    const ws = await open(WITH_ODD);
    const out = await facets(ws, SYSTEM);
    expect(facet(out, "topic").values).toEqual([
      { value: 3, count: 1 },
      { value: 7, count: 1 },
      { value: "Aardvark", count: 1 },
      { value: "Timing", count: 3 },
      { value: "timing", count: 1 },
      { value: "Wind", count: 2 },
      { value: false, count: 1 },
      { value: true, count: 1 },
    ]);
    expect(facet(out, "requirement-type").values?.map((v) => v.value)).toEqual([
      "functional",
      "quality",
      "performance",
      "interface",
      "made-up",
      5,
    ]);
    const packages = facet(out, "packages").values ?? [];
    expect(packages.map((v) => v.title)).toEqual([undefined, "Display", "Sensors"]);
    expect(facet(out, "validity").count).toBe(3);
  });

  it("takes a choice property without a list of choices as written", async () => {
    const ws = await open({
      ...FILTER,
      files: {
        "metamodel/graded.yaml":
          "logreq-metamodel: 1\ntypes:\n  - { key: graded, name: Graded, prefix: GRD, extends: system-requirement, properties: [grade] }\nproperties:\n  - { key: grade, name: Grade, kind: choice }\n",
        "requirements/GRD-0000000000a9.md": `---\nid: ${P}a9\ntype: graded\nstatus: draft\ntitle: Graded\nrequirement-type: functional\nacceptance-criteria: [Given a9]\ngrade: A\n---\n`,
      },
    });
    const grade = facet(await facets(ws, { selection: { where: { type: ["graded"] } } }), "grade");
    expect(grade.values).toEqual([{ value: "A", count: 1 }]);
  });

  it("names relation targets by short ID only when the metamodel has no title property", async () => {
    const model = (await fs.readFile(STANDARD_MODEL, "utf8")).replace("    meaning: title\n", "");
    const ws = await open({ ...FILTER, files: { "metamodel/standard-model.yaml": model } });
    const packages = facet(await facets(ws, SYSTEM), "packages");
    expect(packages.values).toEqual([
      { value: "PKG-0000d1", count: 2 },
      { value: "PKG-0000d2", count: 2 },
    ]);
  });

  it("every value it gives selects exactly the elements it counted", async () => {
    const ws = await open(WITH_ODD);
    const selections: readonly Record<string, unknown>[] = [
      {},
      { where: { type: ["system-requirement"] } },
      { where: { type: ["need", "system-requirement", "package"] } },
      { where: { status: ["draft"] } },
    ];
    const total = async (selection: Record<string, unknown>, extra?: unknown): Promise<number> => {
      const where =
        extra === undefined
          ? selection["where"]
          : selection["where"] === undefined
            ? extra
            : { all: [selection["where"], extra] };
      const next = { ...selection, ...(where === undefined ? {} : { where }) };
      return (
        (await invoke(
          "element.list",
          { selection: next, limit: 1 },
          { workspace: ws },
        )) as CommandOutput<"element.list">
      ).total;
    };
    for (const selection of selections) {
      const out = await facets(ws, { selection, maxValues: 100 });
      expect(await total(selection)).toBe(out.total);
      for (const status of out.statuses) {
        expect([status.key, await total(selection, { status: [status.key] })]).toEqual([
          status.key,
          status.count,
        ]);
      }
      for (const property of out.properties) {
        const key = property.key;
        expect([key, property.count + property.missing]).toEqual([key, out.total]);
        expect([key, await total(selection, { property: key, op: "missing" })]).toEqual([
          key,
          property.missing,
        ]);
        for (const { value, count } of property.values ?? []) {
          const eq = { property: key, op: "eq", value };
          expect([key, value, await total(selection, eq)]).toEqual([key, value, count]);
        }
      }
    }
  });

  it("counts an empty selection as nothing", async () => {
    const out = await facets(await open(), { selection: { where: { type: ["nope"] } } });
    expect(out).toEqual({ total: 0, statuses: [], properties: [], incomplete: false });
  });

  it("refuses a selection it cannot resolve like element.list", async () => {
    const ws = await open();
    const error = await facets(ws, { selection: { baseline: "v1" } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe("input.invalid");
    expect((error as CommandError).details?.["fields"]).toEqual(["selection.baseline"]);
  });

  it("marks the result incomplete when a repository of the workspace is missing", async () => {
    const ws = await open({
      ...FILTER,
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
          '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
          "metamodel: { repository: system, path: metamodel }\n",
      },
    });
    expect((await facets(ws)).incomplete).toBe(true);
  });
});
