// The view rule (SR-041, SR-043) on fixtures/SR-043/example, the „Beispielbestand“ of SR-043:
// core requirements K1 to K4; variant A (Coast) replaces K1 by A1 (validity [A]), excludes K2 and
// adds A2 (validity [A]); variants B (Mountain) and C (Desert) change nothing; need N1 (parent of
// every requirement), decision D1 and package P1. Store order: decisions, needs, packages,
// requirements, variants. The cases of single AKs are written on top of it.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { isCoreRequirement } from "./core.js";
import { removersOf, ruleTargetsOf, viewRuleIndexOf, viewRuleOf } from "./view-rule.js";

const P = "43043043-0000-4000-8000-0000000000";
const NAMES: Readonly<Record<string, string>> = {
  a1: "K1",
  a2: "K2",
  a3: "K3",
  a4: "K4",
  b1: "A1",
  b2: "A2",
  c1: "A",
  c2: "B",
  c3: "C",
  d1: "N1",
  e1: "D1",
  f1: "P1",
};
const name = (id: string): string => NAMES[id.slice(-2)] ?? id.slice(-2);
const V = "n1:67ebd0624004c969";
const A = `{ id: ${P}c1, version: ${V}, title: Coast }`;
const B = `{ id: ${P}c2, version: ${V}, title: Mountain }`;
const to = (tail: string): string => `{ id: ${P}${tail}, version: ${V}, title: T }`;
/** The non-requirements every view holds (SR-043 AK10). */
const OTHERS = ["D1", "N1", "P1"];
const VARIANTS = ["A", "B", "C"];

/** A system requirement with tail `tail` and the frontmatter lines `lines`. */
const requirement = (tail: string, lines: string): Record<string, string> => ({
  [`requirements/SR-0000000000${tail}.md`]: `---\nid: ${P}${tail}\ntype: system-requirement\nstatus: draft\ntitle: R ${tail}\n${lines}---\n`,
});

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-043/example", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The names of the elements `element.list` gives in `view`, with `where` if given. */
const list = async (workspace: Workspace, view: string, where?: unknown): Promise<string[]> => {
  const selection = { view, ...(where === undefined ? {} : { where }) };
  const out = (await invoke(
    "element.list",
    { selection, limit: 500 },
    { workspace },
  )) as CommandOutput<"element.list">;
  return out.elements.map((e) => name(e.id));
};

/** The problems `workspace.check` gives whose code starts with `code`. */
const check = async (
  workspace: Workspace,
  code: string,
): Promise<CommandOutput<"workspace.check">["problems"]> =>
  ((await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">).problems.filter(
    (p) => p.code.startsWith(code),
  );

const VIEW_A = ["D1", "N1", "P1", "K3", "K4", "A1", "A2", ...VARIANTS];
const CORE = ["D1", "N1", "P1", "K1", "K2", "K3", "K4", ...VARIANTS];

describe("the view rule (SR-041, SR-043)", () => {
  it("[SR-043/AK1] the view of A is exactly K3, K4, A1, A2 besides the elements without validity property", async () => {
    const ws = await open();
    expect(await list(ws, "VAR-0000c1")).toEqual(VIEW_A);
  });

  it("[SR-043/AK1] a child of the excluded K2 without validity stays in A", async () => {
    const ws = await open(requirement("a5", `derives-from: [${to("a2")}]\n`));
    expect(await list(ws, "VAR-0000c1")).toEqual([...VIEW_A.slice(0, 5), "a5", "A1", "A2", ...VARIANTS]);
  });

  it("[SR-041/AK1] the view of A lists SR-A instead of SR-K", async () => {
    const ws = await open();
    const view = await list(ws, "VAR-0000c1");
    expect([view.includes("A1"), view.includes("K1")]).toEqual([true, false]);
  });

  it("[SR-041/AK3] the core view and the view of B keep SR-K", async () => {
    const ws = await open();
    expect(await list(ws, "core")).toEqual(CORE);
    expect(await list(ws, "VAR-0000c2")).toEqual(CORE);
  });

  it("[SR-041/AK4] SR-A with validity [A, B] replaces SR-K in A and B, not in C", async () => {
    const ws = await open(requirement("b3", `validity: [${A}, ${B}]\nreplaces: [${to("a3")}]\n`));
    expect(await list(ws, "VAR-0000c1")).toEqual(["D1", "N1", "P1", "K4", "A1", "A2", "b3", ...VARIANTS]);
    expect(await list(ws, "VAR-0000c2")).toEqual(["D1", "N1", "P1", "K1", "K2", "K4", "b3", ...VARIANTS]);
    expect(await list(ws, "VAR-0000c3")).toEqual(CORE);
  });

  it("[SR-041/AK6] a replaces from a requirement without validity removes SR-K from no view", async () => {
    const ws = await open(requirement("a5", `replaces: [${to("a4")}]\n`));
    for (const view of ["core", "VAR-0000c1", "VAR-0000c2", "VAR-0000c3"]) {
      expect(await list(ws, view)).toContain("K4");
    }
  });

  it("[SR-041/AK7] two replacements of SR-K in A both appear and give no hint", async () => {
    const ws = await open(requirement("b3", `validity: [${A}]\nreplaces: [${to("a1")}, ${to("a1")}]\n`));
    expect(await list(ws, "VAR-0000c1")).toEqual([...VIEW_A.slice(0, 7), "b3", ...VARIANTS]);
    const store = await ws.get(elementStoreState);
    const rule = viewRuleOf(
      { workspace: ws, store, metamodel: await ws.get(metamodelState) },
      {
        kind: "variant",
        variant: { id: `${P}c1`, repository: "system" },
      },
    );
    const [k1] = store.byId.get(`${P}a1`) ?? [];
    expect(k1 && rule.replacedBy(k1).map((e) => name(e.id))).toEqual(["A1", "b3"]);
    expect(rule.replacedOf().map((r) => [name(r.core.id), name(r.replacement.id)])).toEqual([
      ["K1", "A1"],
      ["K1", "b3"],
    ]);
    expect(rule.addedOf().map((e) => name(e.id))).toEqual(["A2"]);
    expect(rule.excludedOf().map((e) => name(e.id))).toEqual(["K2"]);
    expect(await check(ws, "variant.")).toEqual([]);
  });

  it("[SR-041/AK8] a replaces from SR-A onto a requirement with validity or a need changes no view and gives variant.target-not-core at the entry's line", async () => {
    const ws = await open(
      requirement("b3", `validity: [${A}]\nreplaces:\n  - ${to("b2")}\n  - ${to("d1")}\n  - Coast\n`),
    );
    expect(await list(ws, "VAR-0000c1")).toEqual([...VIEW_A.slice(0, 7), "b3", ...VARIANTS]);
    const problems = await check(ws, "variant.target-not-core");
    expect(problems.map((p) => [p.file, p.line, name(p.targetId ?? ""), p.severity])).toEqual([
      ["requirements/SR-0000000000b3.md", 8, "A2", "warning"],
      ["requirements/SR-0000000000b3.md", 9, "N1", "warning"],
    ]);
    expect(problems[1]?.message).toBe(
      "System Requirement SR-0000b3 replaces Need N-0000d1, which is no core requirement (it has a validity or its type has no validity property); this changes no view",
    );
    // At the element too, and in hint.list for the variant whose view holds it.
    const shown = (await invoke(
      "element.get",
      { ref: "SR-0000b3" },
      { workspace: ws },
    )) as CommandOutput<"element.get">;
    expect((shown.element.problems ?? []).filter((p) => p.code === "variant.target-not-core")).toHaveLength(
      2,
    );
    const hints = async (variant: string): Promise<number> =>
      (
        (await invoke(
          "hint.list",
          { variant, kind: ["variant.target-not-core"] },
          { workspace: ws },
        )) as CommandOutput<"hint.list">
      ).hints.length;
    expect([await hints("VAR-0000c1"), await hints("VAR-0000c2")]).toEqual([2, 0]);
  });

  it("[SR-041/AK9] a replacing requirement with an invalid status still replaces", async () => {
    const ws = await open();
    const out = (await invoke(
      "element.setStatus",
      { refs: ["SR-0000b1"], status: "obsolete" },
      { workspace: ws },
    )) as CommandOutput<"element.setStatus">;
    expect([out.files, out.problems ?? []]).toEqual([["requirements/SR-0000000000b1.md"], []]);
    expect(await list(ws, "VAR-0000c1")).toEqual(VIEW_A);
  });

  it("[SR-043/AK2] element.search in the view of A finds only K3, K4, A1, A2", async () => {
    const ws = await open();
    const search = async (query: string): Promise<string[]> =>
      (
        (await invoke(
          "element.search",
          { query, selection: { view: "VAR-0000c1" } },
          { workspace: ws },
        )) as CommandOutput<"element.search">
      ).hits.map((h) => name(h.id));
    // K1 is replaced by A1, K2 („Measure the wind“) is excluded; D1 is a decision.
    expect([await search("response time"), await search("measure"), await search("wind")]).toEqual([
      ["A1"],
      ["D1", "K3"],
      [],
    ]);
  });

  it("[SR-043/AK3] element.list with a filter in the view of A holds only K3, K4, A1, A2", async () => {
    const ws = await open();
    expect(await list(ws, "VAR-0000c1", { type: ["system-requirement"] })).toEqual(["K3", "K4", "A1", "A2"]);
  });

  it("[SR-043/AK8] data.export in the view of A holds exactly K3, K4, A1, A2", async () => {
    const ws = await open();
    const out = (await invoke(
      "data.export",
      { selection: { view: "VAR-0000c1", where: { type: ["system-requirement"] } } },
      { workspace: ws },
    )) as CommandOutput<"data.export">;
    expect(out.elements.map((e) => name(e.id))).toEqual(["K3", "K4", "A1", "A2"]);
  });

  it("[SR-043/AK9] the core view holds only requirements without validity", async () => {
    const ws = await open();
    expect(await list(ws, "core", { type: ["system-requirement"] })).toEqual(["K1", "K2", "K3", "K4"]);
  });

  it("[SR-043/AK10] needs, decisions and packages are in every view", async () => {
    const ws = await open();
    for (const view of ["core", "VAR-0000c1", "VAR-0000c2", "VAR-0000c3"]) {
      expect((await list(ws, view)).slice(0, 3)).toEqual(OTHERS);
    }
  });

  it("[SR-043/AK10] a need with a stray validity entry is in every view and added in none", async () => {
    const ws = await open({
      "needs/N-0000000000d1.md": `---\nid: ${P}d1\ntype: need\nstatus: draft\ntitle: See the weather\nvalidity: [${A}]\n---\n`,
    });
    for (const view of ["core", "VAR-0000c1", "VAR-0000c2", "VAR-0000c3"]) {
      expect((await list(ws, view)).slice(0, 3)).toEqual(OTHERS);
    }
    const rule = viewRuleOf(
      { workspace: ws, store: await ws.get(elementStoreState), metamodel: await ws.get(metamodelState) },
      { kind: "variant", variant: { id: `${P}c1`, repository: "system" } },
    );
    expect(rule.addedOf().map((e) => name(e.id))).toEqual(["A2"]);
  });

  it("an excluded and replaced core requirement is excluded only, and its replacement is added", async () => {
    const ws = await open(requirement("b3", `validity: [${A}]\nreplaces: [${to("a2")}]\n`));
    const store = await ws.get(elementStoreState);
    const metamodel = await ws.get(metamodelState);
    const rule = viewRuleOf(
      { workspace: ws, store, metamodel },
      { kind: "variant", variant: { id: `${P}c1`, repository: "system" } },
    );
    expect(rule.addedOf().map((e) => name(e.id))).toEqual(["A2", "b3"]);
    const [k2] = store.byId.get(`${P}a2`) ?? [];
    expect(k2 && [rule.excludes(k2), rule.replacedBy(k2)]).toEqual([true, []]);
    // A record read again from its file (element.get) is looked up by repository and UUID.
    const [k1] = store.byId.get(`${P}a1`) ?? [];
    const again = k1 && { ...k1 };
    expect(again && [rule.includes(again), rule.replacedBy(again).map((e) => name(e.id))]).toEqual([
      false,
      ["A1"],
    ]);
    expect(k2 && rule.excludes({ ...k2 })).toBe(true);
    // The rule and the index are kept per store and metamodel; the core rule changes nothing.
    expect(viewRuleIndexOf(ws, store, metamodel)).toBe(viewRuleIndexOf(ws, store, metamodel));
    const core = viewRuleOf({ workspace: ws, store, metamodel }, { kind: "core" });
    expect(k2 && [core.includes(k2), core.excludes(k2), core.replacedBy(k2)]).toEqual([true, false, []]);
    expect([core.addedOf(), core.replacedOf(), core.excludedOf()]).toEqual([[], [], []]);
  });

  it("removersOf names the variants that may remove a core requirement, and none for a target that is not core", async () => {
    const ws = await open(
      requirement("b3", `validity: [${B}, free]\nreplaces: [${to("a3")}, ${to("d1")}, ${to("ff")}]\n`),
    );
    const store = await ws.get(elementStoreState);
    const index = viewRuleIndexOf(ws, store, await ws.get(metamodelState));
    const of = (tail: string): string[] => {
      const [element] = store.byId.get(`${P}${tail}`) ?? [];
      return element === undefined ? ["?"] : removersOf(index, element).map((key) => name(key.slice(-36)));
    };
    expect([of("a1"), of("a2"), of("a3"), of("d1"), of("a4")]).toEqual([["A"], ["A"], ["B"], [], []]);
    // What a change of b3 reaches: the targets that resolve, core or not.
    const sources = store.byId.get(`${P}b3`) ?? [];
    expect(ruleTargetsOf(index, sources).map((e) => name(e.id))).toEqual(["K3", "N1"]);
  });

  it("reads replacement and exclusion by meaning, whatever their keys, and a value of the wrong shape is not core", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-043/example" });
    onTestFinished(() => fixture.cleanup());
    for (const file of [
      "metamodel/model.yaml",
      "requirements/SR-0000000000b1.md",
      "variants/VAR-0000000000c1.md",
    ]) {
      const text = await fs.readFile(fixture.path(file), "utf8");
      await fixture.write(
        file,
        text
          .replace("key: replaces", "key: swaps")
          .replace("key: excludes", "key: drops")
          .replace(/^replaces:/m, "swaps:")
          .replace(/^excludes:/m, "drops:"),
      );
    }
    const ws = new Workspace(fixture.root);
    onTestFinished(() => ws.close());
    expect(await list(ws, "VAR-0000c1")).toEqual(VIEW_A);
    const metamodel = await ws.get(metamodelState);
    const [k1] = (await ws.get(elementStoreState)).byId.get(`${P}a1`) ?? [];
    expect(
      k1 && [
        isCoreRequirement({ metamodel }, k1),
        isCoreRequirement({ metamodel }, { ...k1, data: { ...k1.data, validity: "A" } }),
      ],
    ).toEqual([true, false]);
  });

  it("a target in a repository that is not here acts in no view and gives no hint, and the list is incomplete", async () => {
    const ws = await open({
      "reqseq-workspace.yaml":
        'reqseq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n  - { name: away, url: "git@git.example.com:ws/away.git" }\nmetamodel: { repository: system, path: metamodel }\n',
      ...requirement(
        "b3",
        `validity: [${A}]\nreplaces: [{ id: ${P}a3, repository: away, version: ${V}, title: T }]\n`,
      ),
    });
    const out = (await invoke(
      "element.list",
      { selection: { view: "VAR-0000c1" } },
      { workspace: ws },
    )) as CommandOutput<"element.list">;
    expect([out.incomplete, out.elements.map((e) => name(e.id)).includes("K3")]).toEqual([true, true]);
    expect(await check(ws, "variant.target-not-core")).toEqual([]);
  });

  it("gives no variant.target-not-core while the metamodel is not valid", async () => {
    const ws = await open({
      ...requirement("b3", `validity: [${A}]\nreplaces: [${to("d1")}]\n`),
      "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: nope\n",
    });
    expect(await check(ws, "variant.target-not-core")).toEqual([]);
  });

  it("an exclusion of a requirement with validity changes no view and gives variant.target-not-core", async () => {
    const ws = await open({
      "variants/VAR-0000000000c1.md": `---\nid: ${P}c1\ntype: variant\nstatus: draft\ntitle: Coast\nexcludes: [${to("a2")}, ${to("b2")}]\n---\n`,
    });
    expect(await list(ws, "VAR-0000c1")).toEqual(VIEW_A);
    const problems = await check(ws, "variant.target-not-core");
    expect(problems.map((p) => p.message.split(",")[0])).toEqual([
      "Variant VAR-0000c1 excludes System Requirement SR-0000b2",
    ]);
  });
});
