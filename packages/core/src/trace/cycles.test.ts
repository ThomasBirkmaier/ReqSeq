import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { CYCLE_NAMES_SHOWN, cycleFindings, derivationCycleProblemsState } from "./cycles.js";
import type { DerivationLink } from "./graph.js";
import { derivationGraph, traceContext } from "./graph.js";
import type { GraphEdge } from "./walk.js";

/**
 * The current version of every `requirement(id)` without text: the id and relation kinds are no
 * content (ADR-0005), so the relations these tests write are not outdated (SR-025).
 */
const V = "n1:7ca5d406afb00989";

/** The UUIDs of fixtures/SR-090/cycle: the need, A, B, C (the cycle) and D (derives from A). */
const P = "5e9c0a7d-2b4f-4c61-9d08-0";
const NEED = `${P}a0000000001`;
const A = `${P}b0000000001`;
const B = `${P}b0000000002`;
const C = `${P}b0000000003`;

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const workspaceFile = (repositories: readonly string[] = []): string =>
  [
    "reqseq-workspace: 1",
    "name: Cycles",
    "repositories:",
    "  - { name: system, url: git@example.com:system.git, main: true }",
    ...repositories,
    "metamodel: { repository: system, path: metamodel }",
    "",
  ].join("\n");

const PLATFORM = "  - { name: platform, url: git@example.com:platform.git, path: ../platform }";
/** Listed in the workspace file, not on this machine. */
const AWAY = "  - { name: away, url: git@example.com:away.git, path: ../away }";

/** A system requirement with `relations` as frontmatter lines (e.g. `derives-from:` and its items). */
const requirement = (id: string, relations: readonly string[] = [], text = ""): string =>
  [
    "---",
    `id: ${id}`,
    "type: system-requirement",
    "status: draft",
    "title: T",
    "requirement-type: functional",
    "acceptance-criteria: [Given, when, then.]",
    ...relations,
    "---",
    text,
  ].join("\n");

/** `derives-from` with one item per target (`id` or `[id, repository]`). */
const derivesFrom = (...targets: readonly (string | readonly [string, string])[]): string[] => [
  "derives-from:",
  ...targets.map((t) =>
    typeof t === "string"
      ? `  - { id: ${t}, version: ${V} }`
      : `  - { id: ${t[0]}, version: ${V}, repository: ${t[1]} }`,
  ),
];

/** A file name for `id` (D-056: the prefix and the last 12 digits). */
const file = (id: string): string => `requirements/SR-${id.slice(-12)}.md`;

const BASE = {
  "system/reqseq-workspace.yaml": workspaceFile(),
  "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
};

const openRoot = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const open = async (files: Readonly<Record<string, string>>): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ files: { ...BASE, ...files } });
  onTestFinished(() => fixture.cleanup());
  return openRoot(fixture.path("system"));
};

/** Requirements of repository system, each with its derivations. */
const requirements = (byId: Readonly<Record<string, readonly string[]>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(byId).map(([id, lines]) => [`system/${file(id)}`, requirement(id, lines)]),
  );

const cycles = (workspace: Workspace): Promise<readonly Problem[]> =>
  workspace.get(derivationCycleProblemsState);

/** Element and target of each problem. */
const members = (problems: readonly Problem[]): (readonly [string | undefined, string | undefined])[] =>
  problems.map((p) => [p.elementId, p.targetId] as const);

const check = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>> = {},
): Promise<CommandOutput<"workspace.check">> =>
  (await invoke("workspace.check", input, { workspace })) as CommandOutput<"workspace.check">;

describe("cycles in the derivations (SR-090)", () => {
  it("[SR-090/AK1] reports the cycle of A, B and C with every element of it, and no element outside it", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-090/cycle" });
    onTestFinished(() => fixture.cleanup());
    const workspace = openRoot(fixture.root);
    const problems = await cycles(workspace);
    // Short IDs (SR-084): A shares its last ten digits with the need, so it shows more of them.
    const a = "System Requirement SR-b0000000001";
    const b = "System Requirement SR-000002";
    const c = "System Requirement SR-000003";
    const names = `${a}, ${b}, ${c}`;
    expect(problems).toEqual([
      {
        code: "trace.cycle",
        severity: "warning",
        message: `${a} is in a cycle of derivations with 3 elements (${names}): its relation Derives from to ${b} leads back to it`,
        repository: "system",
        file: "requirements/SR-0b0000000001.md",
        // The second item of derives-from: the first one names the need, which is no part of the cycle.
        line: 11,
        elementId: A,
        targetId: B,
      },
      {
        code: "trace.cycle",
        severity: "warning",
        message: `${b} is in a cycle of derivations with 3 elements (${names}): its relation Derives from to ${c} leads back to it`,
        repository: "system",
        file: "requirements/SR-0b0000000002.md",
        line: 10,
        elementId: B,
        targetId: C,
      },
      {
        code: "trace.cycle",
        severity: "warning",
        message: `${c} is in a cycle of derivations with 3 elements (${names}): its relation Derives from to ${a} leads back to it`,
        repository: "system",
        file: "requirements/SR-0b0000000003.md",
        line: 10,
        elementId: C,
        targetId: A,
      },
    ]);
    expect(problems.map((p) => p.elementId)).not.toContain(NEED);
    // The check reports them (SR-019); they are warnings, so it is not ok with failOn warning: then the
    // CLI ends with exit code 1 (ADR-0009, #304).
    const out = await check(workspace, { failOn: "warning" });
    expect(out.ok).toBe(false);
    // With the short ID of each element (#315), as the messages name them.
    const shortIds = new Map([
      [A, "SR-b0000000001"],
      [B, "SR-000002"],
      [C, "SR-000003"],
    ]);
    expect(out.problems).toEqual(
      problems.map((p) => ({ ...p, elementShortId: shortIds.get(p.elementId ?? "") })),
    );
  });

  it("[SR-090/AK1] reports an element that derives from itself, through any relation kind with the meaning derivation", async () => {
    const S = uuid(1);
    const workspace = await open({
      "system/requirements/SR-000000000001.md": requirement(S, [`refines:\n  - { id: ${S}, version: ${V} }`]),
    });
    expect(await cycles(workspace)).toEqual([
      {
        code: "trace.cycle",
        severity: "warning",
        message: "System Requirement SR-000001 derives from itself through its relation Refines",
        repository: "system",
        file: "requirements/SR-000000000001.md",
        line: 9,
        elementId: S,
        targetId: S,
      },
    ]);
  });

  it("[SR-090/AK1] reports each cycle on its own, across repositories, in the order of their first element", async () => {
    const [X, Y, Q, R, T] = [1, 2, 3, 4, 5].map(uuid) as [string, string, string, string, string];
    const workspace = await open({
      "system/reqseq-workspace.yaml": workspaceFile([PLATFORM]),
      ...requirements({
        [X]: derivesFrom([Y, "platform"]),
        [Q]: derivesFrom(R),
        [R]: derivesFrom(Q),
        [T]: derivesFrom(X),
      }),
      // Y lies in another repository and points back into system.
      [`platform/${file(Y)}`]: requirement(Y, derivesFrom([X, "system"])),
    });
    const problems = await cycles(workspace);
    // The elements of one cycle together, each cycle where its first element is in the store.
    expect(members(problems)).toEqual([
      [X, Y],
      [Y, X],
      [Q, R],
      [R, Q],
    ]);
    expect(problems.map((p) => `${p.repository ?? ""}:${p.file ?? ""}`)).toEqual([
      `system:${file(X)}`,
      `platform:${file(Y)}`,
      `system:${file(Q)}`,
      `system:${file(R)}`,
    ]);
    expect(problems[0]?.message).toContain(
      "with 2 elements (System Requirement SR-000001, System Requirement SR-000002)",
    );
  });

  it("[SR-090/AK1] names every element of a cycle that has more than one way round once", async () => {
    // A derives from B, B from A and from C, C from B: one cycle of three elements.
    const [X, Y, Z] = [1, 2, 3].map(uuid) as [string, string, string];
    const workspace = await open(
      requirements({ [X]: derivesFrom(Y), [Y]: derivesFrom(X, Z), [Z]: derivesFrom(Y) }),
    );
    const problems = await cycles(workspace);
    expect(members(problems)).toEqual([
      [X, Y],
      [Y, X],
      [Z, Y],
    ]);
    expect(problems.every((p) => p.message.includes("with 3 elements"))).toBe(true);
  });

  it("[SR-090/AK1] takes each element's target from the cycle's edges: first relation kind of the metamodel, then first item", async () => {
    const [X, Y, Z] = [1, 2, 3].map(uuid) as [string, string, string];
    const workspace = await open({
      ...requirements({ [X]: derivesFrom(Y), [Z]: derivesFrom(Y) }),
      // Four ways from Y into the cycle; `refines` comes first in the standard model, X first in its list.
      [`system/${file(Y)}`]: requirement(Y, [
        ...derivesFrom(Z, X),
        `refines:\n  - { id: ${X}, version: ${V} }\n  - { id: ${Z}, version: ${V} }`,
      ]),
    });
    const problems = await cycles(workspace);
    expect(members(problems)).toEqual([
      [X, Y],
      [Y, X],
      [Z, Y],
    ]);
    expect(problems[1]?.line).toBe(12);
    expect(problems[1]?.message).toContain("its relation Refines to System Requirement SR-000001 ");
  });

  it("[SR-090/AK1] names every element of a cycle a caller puts together, also one without an edge in it", async () => {
    const [X, Y] = [1, 2].map(uuid) as [string, string];
    const workspace = await open(requirements({ [X]: derivesFrom(Y), [Y]: [] }));
    const graph = derivationGraph(await traceContext(workspace), "workspace.check");
    const store = await workspace.get(elementStoreState);
    const record = (id: string): ElementRecord => {
      const [found] = store.byId.get(id) ?? [];
      if (found === undefined) {
        throw new Error(`no element ${id}`);
      }
      return found;
    };
    const [x, y] = [record(X), record(Y)];
    const edge = (key: string, index: number | undefined): GraphEdge<DerivationLink> => ({
      from: x,
      to: y,
      link: { kind: "relation", source: x, key, index, item: { id: Y } },
    });
    // A key of no derivation kind ranks first and is named by its key.
    const findings = cycleFindings(graph, await workspace.get(shortIdState), {
      elements: [x, y],
      edges: [edge("note", undefined), edge("derives-from", 0)],
    });
    expect(findings.map((f) => [f.element.id, f.path, f.problem.targetId, f.problem.message])).toEqual([
      [
        X,
        ["note"],
        Y,
        "System Requirement SR-000001 is in a cycle of derivations with 2 elements (System Requirement SR-000001, System Requirement SR-000002): its relation note to System Requirement SR-000002 leads back to it",
      ],
      [
        Y,
        ["id"],
        undefined,
        "System Requirement SR-000002 is in a cycle of derivations with 2 elements (System Requirement SR-000001, System Requirement SR-000002)",
      ],
    ]);
  });

  it("[SR-090/AK1] names the first elements of a long cycle in the message and reports every element", async () => {
    const count = CYCLE_NAMES_SHOWN + 5;
    const ids = Array.from({ length: count }, (_, i) => uuid(i + 1));
    const workspace = await open(
      requirements(Object.fromEntries(ids.map((id, i) => [id, derivesFrom(ids[(i + 1) % count] ?? "")]))),
    );
    const problems = await cycles(workspace);
    expect(problems.map((p) => p.elementId)).toEqual(ids);
    const [first] = problems;
    expect(first?.message).toContain(`with ${String(count)} elements (System Requirement SR-000001, `);
    expect(first?.message).toContain(`System Requirement SR-0000${String(CYCLE_NAMES_SHOWN)}, and 5 more)`);
    expect(first?.message).not.toContain(`SR-0000${String(CYCLE_NAMES_SHOWN + 1)},`);
  });

  it("[SR-090/AK1] follows no other relation, no inline reference and no target it cannot name for sure", async () => {
    const [X, Y, Z, W, DUP, AWAY_ID] = [1, 2, 3, 4, 5, 6].map(uuid) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const workspace = await open({
      "system/reqseq-workspace.yaml": workspaceFile([AWAY]),
      // A replacement is no derivation, and neither is an inline reference (ADR-0004).
      [`system/${file(X)}`]: requirement(X, [
        ...derivesFrom(Y),
        `supersedes:\n  - { id: ${Y}, version: ${V} }`,
      ]),
      [`system/${file(Y)}`]: requirement(
        Y,
        [`supersedes:\n  - { id: ${X}, version: ${V} }`],
        `See [X](reqseq:${X}?version=${V}).`,
      ),
      // Z and its copy share a UUID (SR-088): a relation to it is ambiguous and leads nowhere.
      [`system/${file(Z)}`]: requirement(Z, derivesFrom(W)),
      [`system/copies/${file(Z)}`]: requirement(Z, derivesFrom(W)),
      [`system/${file(W)}`]: requirement(W, derivesFrom(Z, DUP, [AWAY_ID, "away"])),
    });
    expect(await cycles(workspace)).toEqual([]);
  });

  it("[SR-090/AK1] finds the cycle again after the store is read again, and none once it is broken", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-090/cycle" });
    onTestFinished(() => fixture.cleanup());
    const workspace = openRoot(fixture.root);
    expect(members(await cycles(workspace))).toEqual([
      [A, B],
      [B, C],
      [C, A],
    ]);
    // The current version of the need in fixtures/SR-090/cycle, so that the new relation is not outdated (SR-025).
    await fixture.write(
      "requirements/SR-0b0000000003.md",
      requirement(C, ["derives-from:", `  - { id: ${NEED}, version: n1:3bb0ba3cfe019202 }`]),
    );
    await workspace.reset(elementStoreState);
    expect(await cycles(workspace)).toEqual([]);
    // No cycle any more. C has other content now, so B's relation to it is outdated (SR-025): that
    // is the only finding left.
    const out = await check(workspace);
    expect(out.problems.map((p) => [p.code, p.elementId, p.targetId])).toEqual([["relation.outdated", B, C]]);
  });

  it("reports nothing against a metamodel that is not valid (#208, #220)", async () => {
    const [X, Y] = [1, 2].map(uuid) as [string, string];
    const workspace = await open({
      ...requirements({ [X]: derivesFrom(Y), [Y]: derivesFrom(X) }),
      "system/metamodel/broken.yaml": "properties: [\n",
    });
    expect(await cycles(workspace)).toEqual([]);
  });

  it("names the missing meaning derivation as info when no relation kind has it (SR-013 AK3, spec question #270)", async () => {
    const [X, Y] = [1, 2].map(uuid) as [string, string];
    const workspace = await open({
      "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT.replaceAll("    meaning: derivation\n", ""),
      ...requirements({ [X]: derivesFrom(Y), [Y]: derivesFrom(X) }),
    });
    const problems = await cycles(workspace);
    expect(problems).toEqual([
      {
        code: "metamodel.meaning-unassigned",
        severity: "info",
        message:
          "No relation kind of the metamodel has the meaning derivation, which workspace.check needs. Add `meaning: derivation` to a relation kind in the metamodel files.",
      },
    ]);
    const out = await check(workspace);
    expect(out.ok).toBe(true);
    expect(out.problems).toEqual(problems);
  });
});
