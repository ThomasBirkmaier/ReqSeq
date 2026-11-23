// trace.neighbourhood through `invoke` (SR-107, D-031): the data of the four acceptance
// criteria on fixtures/SR-107/neighbourhood. The walks themselves: trace/neighbourhood.test.ts.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"trace.neighbourhood">;

const P = "5e107a7d-2b4f-4c61-9d08-";
const ID = {
  N1: `${P}0a0000000001`,
  N2: `${P}0a0000000002`,
  D1: `${P}0d0000000001`,
  D2: `${P}0d0000000002`,
  P1: `${P}0e0000000001`,
  S1: `${P}0b0000000001`,
  S2: `${P}0b0000000002`,
  E: `${P}0b0000000003`,
  C1: `${P}0c0000000001`,
  V1: `${P}0f0000000001`,
} as const;
type Name = keyof typeof ID;
const NAME = new Map<string, Name>((Object.entries(ID) as [Name, string][]).map(([name, id]) => [id, name]));
const nameOf = (id: string): string => NAME.get(id) ?? id;

const NEIGHBOURHOOD: FixtureOptions = { fixture: "SR-107/neighbourhood" };

/** A workspace file that lists a second repository, `vault`, which is not on this machine (SR-006). */
const WITH_VAULT =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
  '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
  "metamodel: { repository: system, path: metamodel }\n";

interface Opened {
  readonly workspace: Workspace;
}

const open = async (
  options: FixtureOptions = NEIGHBOURHOOD,
  change?: (fixture: FixtureWorkspace) => Promise<void>,
): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  await change?.(fixture);
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { workspace };
};

const neighbourhood = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("trace.neighbourhood", input, { workspace })) as Output;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await neighbourhood(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected trace.neighbourhood to fail");
};

/** Nodes as `[name, depth, direction, expanded]`; `-` for the root's missing direction. */
const nodes = (output: Output): unknown[] =>
  output.nodes.map((n) => [nameOf(n.id), n.depth, n.direction ?? "-", n.expanded]);

/** Edges as `[source, target, link, kind, meaning, direction, repeated, outdated]`; `-` for an absent field. */
const edges = (output: Output): unknown[] =>
  output.edges.map((e) => [
    nameOf(e.source),
    nameOf(e.target),
    e.link,
    e.kind ?? "-",
    e.meaning ?? "-",
    e.direction,
    e.repeated,
    e.outdated,
  ]);

/** The pairs of source and target of the edges. */
const pairs = (output: Output): unknown[] => output.edges.map((e) => [nameOf(e.source), nameOf(e.target)]);

const version = (id: string): string => (id === ID.C1 ? "n1:6aafbfe9e33ccbc5" : "n1:0000000000000000");

/** Changes the text of D1 and D2, so that S1's `based-on` D1 and E's reference to D2 are outdated (SR-025). */
const changeTargets = async (ws: FixtureWorkspace): Promise<void> => {
  await ws.write(
    "decisions/D-0d0000000001.md",
    "---\nid: 5e107a7d-2b4f-4c61-9d08-0d0000000001\ntype: decision\nstatus: approved\ntitle: Use a cup anemometer\n---\n\nA cup anemometer with three cups measures the wind speed.\n",
  );
  await ws.write(
    "decisions/D-0d0000000002.md",
    "---\nid: 5e107a7d-2b4f-4c61-9d08-0d0000000002\ntype: decision\nstatus: approved\ntitle: Show values in SI units\n---\n\nSpeeds are shown in metres per second, temperatures in degrees Celsius.\n",
  );
};

const N1_FILE = "needs/N-0a0000000001.md";
const N1_TEXT =
  "---\nid: 5e107a7d-2b4f-4c61-9d08-0a0000000001\ntype: need\nstatus: approved\ntitle: See the wind\n";

describe("trace.neighbourhood (SR-107)", () => {
  it("[SR-107/AK-r2x1] lists every parent up to the top need, each with title and ID", async () => {
    const { workspace } = await open();
    const output = await neighbourhood(workspace, {
      ref: ID.C1,
      direction: "up",
      meanings: ["derivation"],
      allLevels: true,
    });
    expect(output.root).toBe(ID.C1);
    expect(nodes(output)).toEqual([
      ["C1", 0, "-", true],
      ["S1", 1, "up", true],
      ["S2", 1, "up", true],
      ["N1", 2, "up", true],
      ["N2", 2, "up", true],
    ]);
    expect(output.total).toBe(5);
    expect(output.nodes.map((n) => n.title)).toEqual([
      "Count anemometer turns",
      "Show wind speed",
      "Show wind direction",
      "See the wind",
      "Keep the station running",
    ]);
    expect(output.nodes.map((n) => n.type)).toEqual([
      "component-requirement",
      "system-requirement",
      "system-requirement",
      "need",
      "need",
    ]);
    expect(output.nodes.map((n) => n.shortId)).toEqual([
      "CR-c0000000001",
      "SR-b0000000001",
      "SR-b0000000002",
      "N-a0000000001",
      "N-a0000000002",
    ]);
    expect(edges(output)).toEqual([
      ["C1", "S1", "relation", "derives-from", "derivation", "up", false, false],
      ["C1", "S2", "relation", "derives-from", "derivation", "up", false, false],
      ["S1", "N1", "relation", "derives-from", "derivation", "up", false, false],
      ["S2", "N1", "relation", "derives-from", "derivation", "up", true, false],
      ["S2", "N2", "relation", "derives-from", "derivation", "up", false, false],
    ]);
    expect(output.edges.some((e) => e.source === ID.N1 || e.source === ID.N2)).toBe(false);
    expect(output.incomplete).toBe(false);
  });

  it("names the root in `names` on every page, also one whose nodes do not hold it (#1874)", async () => {
    const { workspace } = await open();
    const later = await neighbourhood(workspace, { ref: ID.N1, direction: "down", offset: 1 });
    expect(later.nodes.map((node) => node.id)).not.toContain(ID.N1);
    expect(later.names?.map((name) => [name.id, name.shortId])).toEqual([[ID.N1, "N-a0000000001"]]);
  });

  it("[SR-107/AK-bhct] gives the children level by level from the same root", async () => {
    const { workspace } = await open();
    const base = { ref: ID.N1, direction: "down", meanings: ["derivation"] };
    const first = await neighbourhood(workspace, base);
    expect(nodes(first)).toEqual([
      ["N1", 0, "-", true],
      ["S1", 1, "down", false],
      ["S2", 1, "down", false],
    ]);
    expect(first.total).toBe(3);
    expect(edges(first)).toEqual([
      ["S1", "N1", "relation", "derives-from", "derivation", "down", false, false],
      ["S2", "N1", "relation", "derives-from", "derivation", "down", false, false],
    ]);
    const second = await neighbourhood(workspace, { ...base, maxDepth: 2 });
    expect(nodes(second)).toEqual([
      ["N1", 0, "-", true],
      ["S1", 1, "down", true],
      ["S2", 1, "down", true],
      ["C1", 2, "down", false],
    ]);
    expect(second.total).toBe(4);
    expect(edges(second)).toEqual([
      ["S1", "N1", "relation", "derives-from", "derivation", "down", false, false],
      ["S2", "N1", "relation", "derives-from", "derivation", "down", false, false],
      ["C1", "S1", "relation", "derives-from", "derivation", "down", false, false],
      ["C1", "S2", "relation", "derives-from", "derivation", "down", true, false],
    ]);
  });

  it("[SR-107/AK-bhct] gives the incoming relations and references of every kind, each with its kind", async () => {
    const { workspace } = await open();
    const output = await neighbourhood(workspace, { ref: ID.S1, direction: "down" });
    expect(nodes(output)).toEqual([
      ["S1", 0, "-", true],
      ["C1", 1, "down", false],
      ["V1", 1, "down", false],
      ["E", 1, "down", false],
    ]);
    expect(output.total).toBe(4);
    expect(edges(output)).toEqual([
      ["C1", "S1", "relation", "derives-from", "derivation", "down", false, false],
      ["V1", "S1", "relation", "excludes", "exclusion", "down", false, false],
      ["E", "S1", "reference", "-", "reference", "down", false, false],
    ]);
  });

  it("[SR-107/AK-ntyw] marks the second edge into a child with two parents as repeated", async () => {
    const { workspace } = await open();
    const output = await neighbourhood(workspace, {
      ref: ID.N1,
      direction: "down",
      meanings: ["derivation"],
      maxDepth: 2,
    });
    expect(output.nodes.filter((n) => n.id === ID.C1)).toHaveLength(1);
    expect(output.edges.filter((e) => e.source === ID.C1).map((e) => [nameOf(e.target), e.repeated])).toEqual(
      [
        ["S1", false],
        ["S2", true],
      ],
    );
  });

  it("[SR-107/AK-b9c5] marks an outdated relation and an outdated reference as outdated", async () => {
    const { workspace } = await open(NEIGHBOURHOOD, changeTargets);
    const up = await neighbourhood(workspace, { ref: ID.S1, direction: "up" });
    expect(nodes(up)).toEqual([
      ["S1", 0, "-", true],
      ["P1", 1, "up", false],
      ["N1", 1, "up", false],
      ["D1", 1, "up", false],
    ]);
    expect(edges(up)).toEqual([
      ["S1", "P1", "relation", "packages", "-", "up", false, false],
      ["S1", "N1", "relation", "derives-from", "derivation", "up", false, false],
      ["S1", "D1", "relation", "based-on", "-", "up", false, true],
    ]);
    expect(up.edges.map((e) => e.property)).toEqual([true, undefined, undefined]);
    const down = await neighbourhood(workspace, { ref: ID.D2, direction: "down" });
    expect(nodes(down)).toEqual([
      ["D2", 0, "-", true],
      ["E", 1, "down", false],
    ]);
    expect(edges(down)).toEqual([["E", "D2", "reference", "-", "reference", "down", false, true]]);
    // The same rule as the hints (SR-025): the outdated edges are the pairs of `relation.outdated`.
    const hints = (await invoke(
      "hint.list",
      { kind: ["relation.outdated"] },
      { workspace },
    )) as CommandOutput<"hint.list">;
    const hinted = hints.hints.map((h) => [nameOf(h.elementId ?? ""), nameOf(h.targetId ?? "")]);
    const outdated = [...up.edges, ...down.edges].filter((e) => e.outdated);
    expect(hinted).toHaveLength(2);
    expect(outdated.map((e) => [nameOf(e.source), nameOf(e.target)])).toEqual(expect.arrayContaining(hinted));
    expect(outdated).toHaveLength(hinted.length);
  });

  it("[SR-107/AK-b9c5] marks no link outdated whose target has no current version", async () => {
    // A value that counts and has no normal form (`.inf`, ADR-0005): D1 has no current version.
    const { workspace } = await open(NEIGHBOURHOOD, async (ws) => {
      await ws.write(
        "metamodel/weight.yaml",
        "reqseq-metamodel: 1\nproperties:\n  - { key: weight, name: Weight, kind: number, content: true }\n" +
          "types:\n  - { key: weighted, name: Weighted, prefix: W, extends: decision, properties: [weight] }\n",
      );
      await ws.write(
        "decisions/D-0d0000000001.md",
        "---\nid: 5e107a7d-2b4f-4c61-9d08-0d0000000001\ntype: weighted\nstatus: approved\ntitle: Use a cup anemometer\nweight: .inf\n---\n\nText.\n",
      );
    });
    const output = await neighbourhood(workspace, { ref: ID.S1, direction: "up" });
    expect(edges(output)[2]).toEqual(["S1", "D1", "relation", "based-on", "-", "up", false, false]);
  });

  it("filters by kind key and by meaning", async () => {
    const { workspace } = await open();
    expect(
      edges(await neighbourhood(workspace, { ref: ID.S1, direction: "up", kinds: ["based-on"] })),
    ).toEqual([["S1", "D1", "relation", "based-on", "-", "up", false, false]]);
    const mixed = await neighbourhood(workspace, {
      ref: ID.S1,
      direction: "up",
      kinds: ["packages"],
      meanings: ["derivation"],
    });
    expect(pairs(mixed)).toEqual([
      ["S1", "P1"],
      ["S1", "N1"],
    ]);
    expect(
      edges(await neighbourhood(workspace, { ref: ID.E, direction: "up", meanings: ["reference"] })),
    ).toEqual([
      ["E", "S1", "reference", "-", "reference", "up", false, false],
      ["E", "D2", "reference", "-", "reference", "up", false, false],
    ]);
    const members = await neighbourhood(workspace, { ref: ID.P1, direction: "down" });
    expect(edges(members)).toEqual([
      ["S1", "P1", "relation", "packages", "-", "down", false, false],
      ["S2", "P1", "relation", "packages", "-", "down", false, false],
    ]);
    expect(members.edges.map((e) => e.property)).toEqual([true, true]);
    const none = await neighbourhood(workspace, { ref: ID.S1, kinds: [], meanings: [] });
    expect(nodes(none)).toEqual([["S1", 0, "-", true]]);
    expect(none.edges).toEqual([]);
  });

  it("rejects an unknown kind and maxDepth together with allLevels", async () => {
    const { workspace } = await open();
    const unknown = await failure(workspace, { ref: ID.S1, kinds: ["nope", "based-on"] });
    expect(unknown.code).toBe("input.invalid");
    expect(unknown.details).toMatchObject({
      unknown: ["nope"],
      kinds: [
        "validity",
        "packages",
        "refines",
        "derives-from",
        "based-on",
        "supersedes",
        "replaces",
        "excludes",
      ],
    });
    const both = await failure(workspace, { ref: ID.S1, maxDepth: 2, allLevels: true });
    expect(both.code).toBe("input.invalid");
    expect(both.message).toBe("give maxDepth or allLevels, not both");
    expect((await failure(workspace, { ref: "SR-ffffff" })).code).toBe("ref.unknown");
  });

  it("maxDepth 0 gives the root only", async () => {
    const { workspace } = await open();
    const output = await neighbourhood(workspace, { ref: ID.S1, maxDepth: 0 });
    expect(nodes(output)).toEqual([["S1", 0, "-", false]]);
    expect(output.total).toBe(1);
    expect(output.edges).toEqual([]);
  });

  it("pages nodes, and each edge is on the page of the node it leads to", async () => {
    const { workspace } = await open();
    const base = { ref: ID.N1, direction: "down", meanings: ["derivation"], maxDepth: 2 };
    const whole = await neighbourhood(workspace, base);
    const first = await neighbourhood(workspace, { ...base, limit: 2, offset: 0 });
    expect(first.nodes.map((n) => nameOf(n.id))).toEqual(["N1", "S1"]);
    expect(pairs(first)).toEqual([["S1", "N1"]]);
    expect(first.total).toBe(4);
    const second = await neighbourhood(workspace, { ...base, limit: 2, offset: 2 });
    expect(second.nodes.map((n) => nameOf(n.id))).toEqual(["S2", "C1"]);
    expect(edges(second).map((e) => [(e as unknown[])[0], (e as unknown[])[1], (e as unknown[])[6]])).toEqual(
      [
        ["S2", "N1", false],
        ["C1", "S1", false],
        ["C1", "S2", true],
      ],
    );
    expect(second.total).toBe(4);
    expect([...first.edges, ...second.edges]).toEqual(whole.edges);
  });

  it("marks the edges of a cycle as cyclic and the edge back to the root as repeated", async () => {
    const { workspace } = await open(NEIGHBOURHOOD, async (ws) => {
      await ws.write(
        N1_FILE,
        `${N1_TEXT}refines:\n  - { id: ${ID.C1}, version: ${version(ID.C1)} }\n---\n\nThe operator sees the wind at a glance.\n`,
      );
    });
    const output = await neighbourhood(workspace, {
      ref: ID.C1,
      direction: "up",
      meanings: ["derivation"],
      allLevels: true,
    });
    expect(output.edges.map((e) => [nameOf(e.source), nameOf(e.target), e.repeated, e.cyclic])).toEqual([
      ["C1", "S1", false, true],
      ["C1", "S2", false, true],
      ["S1", "N1", false, true],
      ["S2", "N1", true, true],
      ["S2", "N2", false, false],
      ["N1", "C1", true, true],
    ]);
  });

  it("drops elements that do not apply in a view", async () => {
    const { workspace } = await open(NEIGHBOURHOOD, async (ws) => {
      await ws.write(
        "components/CR-0c0000000001.md",
        `---\nid: ${ID.C1}\ntype: component-requirement\nstatus: draft\ntitle: Count anemometer turns\n` +
          `requirement-type: functional\nacceptance-criteria:\n  - Given the cups turn, when a second has passed, then the turns are counted.\n` +
          `derives-from:\n  - { id: ${ID.S1}, version: n1:9bb10523fac3b72b, title: Show wind speed }\n` +
          `validity:\n  - { id: ${ID.V1}, version: n1:bea85cc711f2365c }\n---\n\nThe anemometer counts its turns.\n`,
      );
    });
    const output = await neighbourhood(workspace, { ref: ID.S1, direction: "down", view: "core" });
    expect(output.nodes.map((n) => nameOf(n.id))).toEqual(["S1", "V1", "E"]);
    expect(pairs(output)).toEqual([
      ["V1", "S1"],
      ["E", "S1"],
    ]);
  });

  it("is incomplete while a repository is not on this machine", async () => {
    const { workspace } = await open({
      ...NEIGHBOURHOOD,
      files: {
        "reqseq-workspace.yaml": WITH_VAULT,
        "requirements/SR-0b0000000002.md":
          `---\nid: ${ID.S2}\ntype: system-requirement\nstatus: draft\ntitle: Show wind direction\nrequirement-type: functional\n` +
          `acceptance-criteria:\n  - Given wind, when it is measured, then the station shows its direction.\n` +
          `derives-from:\n  - { id: ${ID.N1}, version: n1:323df2732ed684b0 }\n  - { id: ${ID.N2}, version: n1:de3240337a4f49a7 }\n` +
          `  - { id: ${P}0f00000000ff, version: n1:0000000000000000, repository: vault }\n---\n\nThe station shows the wind direction.\n`,
      },
    });
    expect((await neighbourhood(workspace, { ref: ID.N1, direction: "down" })).incomplete).toBe(true);
    const up = await neighbourhood(workspace, { ref: ID.S2, direction: "up", meanings: ["derivation"] });
    expect(up.nodes.map((n) => nameOf(n.id))).toEqual(["S2", "N1", "N2"]);
    expect(up.incomplete).toBe(true);
  });
  it("picks the copy of a duplicated UUID in the given repository", async () => {
    const id = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    const file = "anemometer/SR-1e0f9a8b7c6d.md";
    const fixture = await createFixtureWorkspace({ fixture: "SR-089/missing-targets" });
    onTestFinished(() => fixture.cleanup());
    await fs.mkdir(fixture.path("system/anemometer"), { recursive: true });
    await fs.copyFile(fixture.path(`sensor/${file}`), fixture.path(`system/${file}`));
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    expect((await failure(workspace, { ref: id })).code).toBe("ref.ambiguous");
    for (const repository of ["system", "sensor"]) {
      const output = await neighbourhood(workspace, { ref: id, repository });
      expect([output.root, output.nodes[0]?.repository]).toEqual([id, repository]);
    }
    const none = await failure(workspace, { ref: id, repository: "vault" });
    expect([none.code, none.details]).toMatchObject(["ref.unknown", { ref: id }]);
  });
});

/** The UUID of the n-th added requirement. */
const added = (n: number): string => `${P}1a${String(n).padStart(10, "0")}`;

/** A requirement that derives from N1 (twice with `twice`), with `specId` as its identifier. */
const derived = (n: number, specId: string | undefined, twice = false): [string, string] => {
  const link = `  - { id: ${ID.N1}, version: n1:323df2732ed684b0 }\n`;
  return [
    `requirements/SR-1a${String(n).padStart(10, "0")}.md`,
    `---\nid: ${added(n)}\ntype: system-requirement\nstatus: draft\ntitle: Requirement ${String(n)}\n` +
      (specId === undefined ? "" : `spec-id: ${specId}\n`) +
      `requirement-type: functional\nacceptance-criteria:\n  - Given wind, when it blows, then it is shown.\n` +
      `derives-from:\n${link}${twice ? link : ""}---\n\nText.\n`,
  ];
};

/** The fixture's metamodel with `spec-id`, a property with the meaning `identifier`. */
const withIdentifier = async (fixture: FixtureWorkspace): Promise<void> => {
  const file = fixture.path("metamodel/standard-model.yaml");
  const model = (await fs.readFile(file, "utf8"))
    .replace("        topic,\n      ]", "        topic,\n        spec-id,\n      ]")
    .replace(
      "  - { key: source-identifier,",
      "  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }\n  - { key: source-identifier,",
    );
  await fs.writeFile(file, model);
};

/** The groups as `[kind or link, property, meaning, count, shown]`; `-` for an absent field. */
const groups = (output: Output): unknown[] =>
  (output.incoming ?? []).map((g) => [
    g.kind ?? g.link,
    g.property ?? "-",
    g.meaning ?? "-",
    g.count,
    g.elements.map((e) => nameOf(e.id)),
  ]);

describe("trace.neighbourhood incoming by kind (SR-107 AK5, AK6)", () => {
  it("[SR-107/AK-qy39] counts every element of a kind and gives the first 100 by identifier, then short ID", async () => {
    const { workspace } = await open(NEIGHBOURHOOD, async (fixture) => {
      await withIdentifier(fixture);
      // SR-102 first in the store, SR-1 last: the order comes from the identifiers, not the files.
      const files = Array.from({ length: 102 }, (_, n) => derived(n, `SR-${String(102 - n)}`, n === 0));
      // A second SR-5 (short ID SR-000102) in a file before that of the first (SR-000097): the store order is
      // the reverse of the short IDs, so only the tie-break puts SR-000097 first.
      const [, second] = derived(102, "SR-5");
      files.push(["requirements/SR-0a0000000000.md", second], derived(103, undefined));
      for (const [file, text] of files) {
        await fixture.write(file, text);
      }
    });
    const output = await neighbourhood(workspace, { ref: ID.N1, direction: "down", limit: 1 });
    const [group] = output.incoming ?? [];
    expect([output.incoming?.length, group?.kind, group?.count, group?.elements.length]).toEqual([
      1,
      "derives-from",
      106,
      100,
    ]);
    const shown = group?.elements.map((e) => e.identifier) ?? [];
    expect(shown).toEqual([
      ...["SR-1", "SR-2", "SR-3", "SR-4", "SR-5", "SR-5"],
      ...Array.from({ length: 94 }, (_, n) => `SR-${String(n + 6)}`),
    ]);
    // The two with the same identifier by short ID; the one deriving twice once.
    const fives = group?.elements.filter((e) => e.identifier === "SR-5").map((e) => e.id);
    expect(fives).toEqual([added(97), added(102)]);
    expect(new Set(group?.elements.map((e) => e.id)).size).toBe(100);
    expect(group?.elements[0]).toEqual({
      id: added(101),
      shortId: expect.any(String) as string,
      identifier: "SR-1",
      type: "system-requirement",
      title: "Requirement 101",
      status: "draft",
      repository: "system",
    });
    // Not paged: another page gives the same groups.
    expect((await neighbourhood(workspace, { ref: ID.N1, direction: "down", offset: 50 })).incoming).toEqual(
      output.incoming,
    );
  });

  it("gives one group per key in metamodel order, the references last, each element once", async () => {
    const { workspace } = await open();
    expect(groups(await neighbourhood(workspace, { ref: ID.S1 }))).toEqual([
      ["derives-from", "-", "derivation", 1, ["C1"]],
      ["excludes", "-", "exclusion", 1, ["V1"]],
      ["reference", "-", "reference", 1, ["E"]],
    ]);
    expect(groups(await neighbourhood(workspace, { ref: ID.P1, direction: "down" }))).toEqual([
      ["packages", true, "-", 2, ["S1", "S2"]],
    ]);
  });

  it("keeps the elements of a view and a successor in any view (SR-107 AK5, SR-072 AK3)", async () => {
    const successor = added(900);
    const { workspace } = await open(NEIGHBOURHOOD, async (fixture) => {
      await fixture.write(
        "requirements/SR-1a0000000900.md",
        `---\nid: ${successor}\ntype: system-requirement\ntitle: See the gusts\n` +
          `requirement-type: functional\nacceptance-criteria:\n  - Given gusts, when they blow, then they are shown.\n` +
          `supersedes:\n  - { id: ${ID.N1}, version: n1:323df2732ed684b0 }\n---\n\nText.\n`,
      );
      await fixture.write(
        "variants/V-0f0000000001.md",
        `---\nid: ${ID.V1}\ntype: variant\nstatus: draft\ntitle: Indoor display\nexcludes:\n` +
          `  - { id: ${ID.S1}, version: n1:9bb10523fac3b72b }\n  - { id: ${successor} }\n---\n\nIndoor.\n`,
      );
    });
    const output = await neighbourhood(workspace, { ref: ID.N1, direction: "down", view: ID.V1 });
    expect(groups(output)).toEqual([
      ["derives-from", "-", "derivation", 1, ["S2"]],
      ["supersedes", "-", "succession", 1, [successor]],
    ]);
    // Without a status, none is given.
    expect(output.incoming?.[1]?.elements[0]?.status).toBeUndefined();
  });

  it("gives no groups when the root's incoming links were not looked at", async () => {
    const { workspace } = await open();
    expect((await neighbourhood(workspace, { ref: ID.N1, direction: "up" })).incoming).toBeUndefined();
    expect((await neighbourhood(workspace, { ref: ID.N1, maxDepth: 0 })).incoming).toBeUndefined();
    expect((await neighbourhood(workspace, { ref: ID.S1, allLevels: true })).incoming).toHaveLength(3);
  });

  it("[SR-224/AK-h9kx] the count of a group gives all its elements through element.list", async () => {
    const { workspace } = await open({
      ...NEIGHBOURHOOD,
      files: { "reqseq-workspace.yaml": WITH_VAULT },
    });
    const list = async (input: object, key: object): Promise<[string[], boolean | undefined]> => {
      const output = (await invoke(
        "element.list",
        {
          selection: {
            output: {
              command: "trace.neighbourhood",
              input,
              count: { field: "incoming[].count", key: [key] },
            },
          },
        },
        { workspace },
      )) as CommandOutput<"element.list">;
      return [output.elements?.map((e) => nameOf(e.id)) ?? [], output.incomplete];
    };
    expect(await list({ ref: ID.P1 }, { link: "relation", kind: "packages" })).toEqual([["S1", "S2"], true]);
    expect(await list({ ref: ID.S1 }, { link: "reference" })).toEqual([["E"], true]);
    expect(await list({ ref: ID.S1 }, { link: "relation", kind: "nope" })).toEqual([[], true]);
    expect(await list({ ref: ID.S1, direction: "up" }, { link: "reference" })).toEqual([[], true]);
    const here = (await open()).workspace;
    const view = (await invoke(
      "element.list",
      {
        selection: {
          output: {
            command: "trace.neighbourhood",
            input: { ref: ID.N1, view: ID.V1 },
            count: { field: "incoming[].count", key: [{ link: "relation", kind: "derives-from" }] },
          },
        },
      },
      { workspace: here },
    )) as CommandOutput<"element.list">;
    expect([view.elements?.map((e) => nameOf(e.id)), view.incomplete ?? false]).toEqual([["S2"], false]);
  });
});
