// The neighbourhood walks of SR-107 (neighbourhood.ts) on a workspace with every kind of target:
// one in the same repository, another repository, a repository that is not on this machine or not in
// the workspace file, a missing and an ambiguous one. The data of the acceptance criteria:
// commands/trace/neighbourhood.test.ts.
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { NeighbourhoodFilter, NeighbourhoodOptions } from "./neighbourhood.js";
import { neighbourhoodContext, neighbourhoodOutput, traceNeighbourhood } from "./neighbourhood.js";
import { traceContext } from "./graph.js";

const V = "n1:1111111111111111";
const CURRENT = "n1:2222222222222222";
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const N1 = uuid(1);
const N2 = uuid(2);
const S1 = uuid(3);
const S2 = uuid(4);
const P1 = uuid(5);
const PKG1 = uuid(6);
const DUP = uuid(7);
const MISSING = uuid(8);
const A1 = uuid(9);
const U1 = uuid(10);
const X1 = uuid(11);
const IDS = { N1, N2, S1, S2, P1, PKG1, DUP, MISSING, A1, U1, X1 };
const nameOf = (id: string): string => Object.entries(IDS).find(([, value]) => value === id)?.[0] ?? id;

const WORKSPACE = [
  "logreq-workspace: 1",
  "name: Neighbourhood",
  "repositories:",
  "  - { name: system, url: git@example.com:system.git, main: true }",
  "  - { name: platform, url: git@example.com:platform.git, path: ../platform }",
  // Listed in the workspace file, not on this machine.
  "  - { name: away, url: git@example.com:away.git, path: ../away }",
  "metamodel: { repository: system, path: metamodel }",
  "",
].join("\n");

/** A relation-valued property with one target (not `many`), next to the standard model. */
const EXTRA_MODEL = [
  "logreq-metamodel: 1",
  "properties:",
  "  - { key: predecessor, name: Predecessor, kind: relation }",
  "",
].join("\n");

const element = (id: string, type: string, frontmatter: readonly string[] = [], text = ""): string =>
  ["---", `id: ${id}`, `type: ${type}`, "status: draft", "title: T", ...frontmatter, "---", text].join("\n");

const S1_FILE = element(
  S1,
  "system-requirement",
  [
    "derives-from:",
    `  - { id: ${N1}, version: ${V}, title: T }`,
    "  - just text",
    `  - { id: ${P1}, version: n2:1111111111111111, repository: platform }`,
    // A repository that is not on this machine, one that is no text, one the workspace file lacks.
    `  - { id: ${A1}, version: ${V}, repository: away }`,
    `  - { id: ${N1}, repository: 5 }`,
    `  - { id: ${U1}, version: ${V}, repository: nowhere }`,
    // Missing, and shared by two files of the repository.
    `  - { id: ${MISSING}, version: ${V} }`,
    `  - { id: ${DUP}, version: ${V} }`,
    `packages:\n  - { id: ${PKG1}, version: ${V} }`,
    `predecessor: { id: ${N2}, version: ${V} }`,
    // One target where a list belongs: the value-kind check reports it (SR-085); not followed.
    `based-on: { id: ${N1}, version: ${V} }`,
    // Not a key of the metamodel.
    `unknown-key:\n  - { id: ${N1}, version: ${V} }`,
    "rationale: Because",
  ],
  [
    "",
    `See [the need](logreq:${N1}?version=${V}).`,
    `And [P](logreq:${P1}?version=${V}&repository=platform), [old P](logreq:${P1}),`,
    `[gone](logreq:${MISSING}?version=${V}), [twice](logreq:${DUP}?version=${V}) and [A](logreq:${A1}?repository=away).`,
    "",
  ].join("\n"),
);

const FILES = {
  "system/logreq-workspace.yaml": WORKSPACE,
  "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
  "system/metamodel/extra.yaml": EXTRA_MODEL,
  "system/needs/N-000000000001.md": element(N1, "need"),
  "system/needs/N-000000000002.md": element(N2, "need"),
  "system/requirements/SR-000000000003.md": S1_FILE,
  // A list where one target belongs and a loop: not followed, and a step to itself.
  "system/requirements/SR-000000000004.md": element(S2, "system-requirement", [
    "derives-from:",
    `  - { id: ${S2}, version: ${V} }`,
    `predecessor:\n  - { id: ${N1}, version: ${V} }`,
  ]),
  "system/packages/PKG-000000000006.md": element(PKG1, "package"),
  // Two files with one UUID (SR-088).
  "system/needs/N-000000000007.md": element(DUP, "need"),
  "system/needs/copy/N-000000000007.md": element(DUP, "need"),
  "platform/needs/N-000000000005.md": element(P1, "need"),
  // The UUID of N2 in another repository too: each copy is the one record of it in its repository.
  "platform/needs/N-000000000002.md": element(N2, "need"),
  // A source in another repository that points back into the first.
  "platform/requirements/SR-000000000011.md": element(X1, "system-requirement", [
    `derives-from:\n  - { id: ${S1}, version: ${V}, repository: system }`,
  ]),
};

interface Opened {
  readonly workspace: Workspace;
  readonly record: (id: string, repository?: string) => ElementRecord;
}

const open = async (): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ files: FILES });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  const store = await workspace.get(elementStoreState);
  return {
    workspace,
    record: (id, repository = "system") => {
      const found = (store.byId.get(id) ?? []).find((r) => r.repository === repository);
      if (found === undefined) {
        throw new Error(`no element ${id}`);
      }
      return found;
    },
  };
};

const walkOf = async (
  { workspace, record }: Opened,
  id: string,
  filter: NeighbourhoodFilter,
  options: NeighbourhoodOptions,
  repository?: string,
) =>
  traceNeighbourhood(
    neighbourhoodContext(await traceContext(workspace), filter),
    record(id, repository),
    options,
  );

/** Edges of a walk as `[source, target, key or "reference", cyclic]`; the link stored by `source` points at `target`. */
const stepsOf = (walked: ReturnType<typeof traceNeighbourhood>, which: "up" | "down"): unknown[] =>
  (walked.walks.find((w) => w.direction === which)?.result.edges ?? []).map((e) => [
    nameOf(e.link.source.id),
    nameOf((which === "up" ? e.to : e.from).id),
    e.link.kind === "relation" ? e.link.key : "reference",
    e.cyclic,
  ]);

describe("neighbourhood (SR-107)", () => {
  it("follows what the file stores, in key order and then text order, and skips what cannot be reached", async () => {
    const opened = await open();
    const walked = await walkOf(opened, S1, {}, { direction: "up", maxDepth: 1 });
    expect(stepsOf(walked, "up")).toEqual([
      ["S1", "N1", "derives-from", false],
      ["S1", "P1", "derives-from", false],
      ["S1", "PKG1", "packages", false],
      ["S1", "N2", "predecessor", false],
      ["S1", "N1", "reference", false],
      ["S1", "P1", "reference", false],
      ["S1", "P1", "reference", false],
    ]);
    // A repository that is not on this machine or not in the workspace file: incomplete.
    expect(walked.incomplete).toBe(true);
    expect(walked.rootExpanded).toBe(true);
  });

  it("follows only the keys and meanings asked for, and is complete when it never looks at the gaps", async () => {
    const opened = await open();
    const only = async (filter: NeighbourhoodFilter) =>
      walkOf(opened, S1, filter, { direction: "up", maxDepth: 1 });
    const predecessor = await only({ kinds: ["predecessor"] });
    expect(stepsOf(predecessor, "up")).toEqual([["S1", "N2", "predecessor", false]]);
    expect(predecessor.incomplete).toBe(false);
    const references = await only({ meanings: ["reference"] });
    expect(stepsOf(references, "up").map((s) => (s as unknown[])[2])).toEqual([
      "reference",
      "reference",
      "reference",
    ]);
    expect(references.incomplete).toBe(true);
    const replacement = await only({ kinds: [], meanings: ["replacement", "exclusion"] });
    expect(stepsOf(replacement, "up")).toEqual([]);
    expect(replacement.incomplete).toBe(false);
    const derivation = await only({ meanings: ["derivation"] });
    expect(stepsOf(derivation, "up")).toEqual([
      ["S1", "N1", "derives-from", false],
      ["S1", "P1", "derives-from", false],
    ]);
  });

  it("follows what points at an element, relations first and then references, across repositories", async () => {
    const opened = await open();
    const walked = await walkOf(opened, N1, {}, { direction: "down" }, "system");
    // S1's derives-from (and its reference); S2's predecessor is a list where one target belongs;
    // then, from S1, X1 in the other repository.
    expect(stepsOf(walked, "down")).toEqual([
      ["S1", "N1", "derives-from", false],
      ["S1", "N1", "reference", false],
      ["X1", "S1", "derives-from", false],
    ]);
    // An unavailable repository makes a step down incomplete.
    expect(walked.incomplete).toBe(true);
    const platform = await walkOf(opened, P1, {}, { direction: "down", maxDepth: 1 }, "platform");
    expect(stepsOf(platform, "down")).toEqual([
      ["S1", "P1", "derives-from", false],
      ["S1", "P1", "reference", false],
      ["S1", "P1", "reference", false],
    ]);
    const deeper = await walkOf(opened, P1, { kinds: ["derives-from"] }, { direction: "down" }, "platform");
    expect(stepsOf(deeper, "down").map((s) => (s as unknown[]).slice(0, 2))).toEqual([
      ["S1", "P1"],
      ["X1", "S1"],
    ]);
  });

  it("follows no link to an element whose UUID two files of its repository share", async () => {
    const opened = await open();
    const walked = await walkOf(opened, DUP, {}, { direction: "down" });
    expect(stepsOf(walked, "down")).toEqual([]);
    // A record of the UUID in another repository does not make it ambiguous.
    const other = await walkOf(opened, N2, {}, { direction: "down", maxDepth: 1 });
    expect(stepsOf(other, "down")).toEqual([["S1", "N2", "predecessor", false]]);
  });

  it("finds nothing below an element that is not in the store", async () => {
    const opened = await open();
    const stranger: ElementRecord = { ...opened.record(N1), id: uuid(99) };
    const walked = traceNeighbourhood(
      neighbourhoodContext(await traceContext(opened.workspace), {}),
      stranger,
      { direction: "down" },
    );
    expect(stepsOf(walked, "down")).toEqual([]);
  });

  it("marks a link from an element to itself as cyclic, and stays within a view", async () => {
    const opened = await open();
    const loop = await walkOf(opened, S2, {}, { direction: "both" });
    expect(stepsOf(loop, "up")).toEqual([["S2", "S2", "derives-from", true]]);
    expect(stepsOf(loop, "down")).toEqual([["S2", "S2", "derives-from", true]]);
    const none = await walkOf(
      opened,
      S1,
      {},
      { direction: "up", includes: (e) => e.id === S1 || e.id === N2 },
    );
    expect(stepsOf(none, "up")).toEqual([["S1", "N2", "predecessor", false]]);
  });

  describe("neighbourhoodOutput", () => {
    const outputOf = async (
      opened: Opened,
      page: { limit: number; offset: number },
      versions: Readonly<Record<string, string>>,
      asked: ElementRecord[][] = [],
    ) => {
      const walked = await walkOf(opened, S1, {}, { direction: "up", maxDepth: 1 });
      const { workspace } = opened;
      return neighbourhoodOutput(
        walked,
        { metamodel: await workspace.get(metamodelState), shortIds: await workspace.get(shortIdState) },
        page,
        (targets) => {
          asked.push([...targets]);
          return Promise.resolve((e) => versions[e.id]);
        },
      );
    };

    it("[SR-025] marks a link outdated when it stores a version of normal form 1 that is not the current one", async () => {
      const opened = await open();
      const asked: ElementRecord[][] = [];
      const output = await outputOf(
        opened,
        { limit: 100, offset: 0 },
        { [N1]: CURRENT, [P1]: CURRENT, [PKG1]: V, [N2]: CURRENT },
        asked,
      );
      expect(
        output.edges.map((e) => [
          nameOf(e.source),
          nameOf(e.target),
          e.link,
          e.kind,
          e.property,
          e.meaning,
          e.repeated,
          e.outdated,
        ]),
      ).toEqual([
        ["S1", "N1", "relation", "derives-from", undefined, "derivation", false, true],
        // Stored: a version of another normal form.
        ["S1", "P1", "relation", "derives-from", undefined, "derivation", false, false],
        // Stored: the current version.
        ["S1", "PKG1", "relation", "packages", true, undefined, false, false],
        ["S1", "N2", "relation", "predecessor", true, undefined, false, true],
        // The references to N1 and to P1 with `repository` store a version; the one without none.
        ["S1", "N1", "reference", undefined, undefined, "reference", true, true],
        ["S1", "P1", "reference", undefined, undefined, "reference", true, true],
        ["S1", "P1", "reference", undefined, undefined, "reference", true, false],
      ]);
      // Once, with each target once.
      expect(asked.map((targets) => targets.map((t) => nameOf(t.id)))).toEqual([["N1", "P1", "PKG1", "N2"]]);
    });

    it("has no outdated link when the target has no current version", async () => {
      const output = await outputOf(await open(), { limit: 100, offset: 0 }, {});
      expect(output.edges.some((e) => e.outdated)).toBe(false);
    });

    it("gives a page after the root without the root", async () => {
      const output = await outputOf(await open(), { limit: 2, offset: 2 }, {});
      expect(output.total).toBe(5);
      expect(output.nodes.map((n) => nameOf(n.id))).toEqual(["P1", "PKG1"]);
      expect(output.edges.map((e) => nameOf(e.target))).toEqual(["P1", "PKG1", "P1", "P1"]);
      expect(output.incomplete).toBe(true);
    });
  });
});
