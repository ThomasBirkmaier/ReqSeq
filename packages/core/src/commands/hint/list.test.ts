// hint.list and the hints at the element (SR-026) on fixtures/SR-026/hints: needs N1 and N2 (N2 with
// an unknown property), variants VA, VB and the superseded VO, packages P1 and P2, and requirements
// R1 (valid in VA, in P1, derives from N1 and references it in its text, both with a made-up stored
// version), R2 (no validity, in P2, no acceptance criteria, a relation to a missing UUID), R3 (valid
// in VB and VO, refines the superseded OLD), and R4, a safety requirement (a subtype of system
// requirement) valid in VB, in P1, with an unknown property. Every other stored version is current.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { HintFilter } from "../../hints/index.js";
import { HINT_STATES, hintsOf, isHint } from "../../hints/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { STANDARD_MODEL_TEXT as STANDARD } from "../../metamodel/standard-model.js";
import {
  currentVersionsIfBuilt,
  currentVersionsOf,
  currentVersionsState,
  elementStoreState,
} from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { FINDING_STATES } from "../workspace/check.js";

type Output = CommandOutput<"hint.list">;
type Shown = CommandOutput<"element.get">;

const P = "26a0b000-0000-4000-8000-0000000000";
const N1 = `${P}a1`;
const N2 = `${P}a2`;
const VA = `${P}c1`;
const VB = `${P}c2`;
const VO = `${P}c3`;
const P1 = `${P}d1`;
const P2 = `${P}d2`;
const R1 = `${P}b1`;
const R2 = `${P}b2`;
const R3 = `${P}b3`;
const R4 = `${P}b4`;
const OLD = `${P}b9`;
const R1_FILE = "requirements/SR-0000000000b1.md";

const HINTS: FixtureOptions = { fixture: "SR-026/hints" };

const fixture = async (options: FixtureOptions = HINTS): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const opened = async (options: FixtureOptions = HINTS): Promise<Workspace> =>
  open((await fixture(options)).root);

const list = async (workspace: Workspace, input: Record<string, unknown> = {}): Promise<Output> =>
  (await invoke("hint.list", input, { workspace })) as Output;

const listError = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await list(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected hint.list to fail");
};

const get = async (workspace: Workspace, input: Record<string, unknown>): Promise<Shown["element"]> =>
  ((await invoke("element.get", input, { workspace })) as Shown).element;

/** Each hint as `[code, element, target]`. */
const rows = (hints: readonly Problem[]): unknown[] => hints.map((h) => [h.code, h.elementId, h.targetId]);

/** The hints of the fixture, in the order of workspace.check. */
const REQUIRED_R2 = ["element.missing-required", R2, undefined];
const UNKNOWN_N2 = ["element.unknown-property", N2, undefined];
const UNKNOWN_R4 = ["element.unknown-property", R4, undefined];
const SUPERSEDED_R3 = ["relation.target-superseded", R3, OLD];
const VALIDITY_R3 = ["variant.superseded-in-validity", R3, VO];
const NO_PARENT_R4 = ["trace.no-parent", R4, undefined];
const OUTDATED_R1 = ["relation.outdated", R1, N1];
const ALL = [
  REQUIRED_R2,
  UNKNOWN_N2,
  UNKNOWN_R4,
  SUPERSEDED_R3,
  VALIDITY_R3,
  NO_PARENT_R4,
  OUTDATED_R1,
  OUTDATED_R1,
];

/** The committer date of HEAD as ADR-0005 writes a version date. */
const headDate = async (ws: FixtureWorkspace): Promise<string> =>
  new Date(Number((await ws.git(["show", "-s", "--format=%ct", "HEAD"])).trim()) * 1000)
    .toISOString()
    .replace(".000Z", "Z");

describe("hint.list (SR-026)", () => {
  it("[SR-026/AK1] lists every open hint with its kind, the element it is about, its target and its reason", async () => {
    const ws = await fixture({ ...HINTS, git: true });
    const output = await list(open(ws.root));
    expect(output.incomplete).toBe(false);
    expect(rows(output.hints)).toEqual(ALL);
    const date = await headDate(ws);
    const [outdatedItem, outdatedLink] = output.hints.slice(-2);
    expect(outdatedItem).toEqual({
      code: "relation.outdated",
      severity: "warning",
      message: `Relation Derives from (derives-from) of System Requirement SR-0000b1 points to an older version of Need N-0000a1: stored version from no date (not committed, or Git cannot tell), current version from ${date}`,
      repository: "system",
      file: R1_FILE,
      line: 14,
      elementId: R1,
      elementShortId: "SR-0000b1",
      targetId: N1,
      storedVersion: "n1:0000000000000000",
      currentVersion: "n1:d809de2e934d94f3",
      storedDate: null,
      currentDate: date,
      hintId: `relation.outdated/system/${encodeURIComponent(R1_FILE)}/${R1}/derives-from/${N1}?version=n1:0000000000000000`,
    });
    expect(outdatedLink?.line).toBe(17);
    expect(outdatedLink?.message).toMatch(/^Reference in the text of/);
    // Every hint names its element with repository, file and short ID (#310), and gives a reason.
    for (const hint of output.hints) {
      expect([hint.severity, hint.repository, typeof hint.file]).toEqual(["warning", "system", "string"]);
      expect(hint.elementShortId).toMatch(/^[A-Z]+-0000[a-f0-9]{2}$/);
      expect(hint.message).not.toBe("");
    }
    expect(output.hints.find((h) => h.code === "variant.superseded-in-validity")?.message).toMatch(
      /lists Variant VAR-0000c3, which is superseded/,
    );
  });

  it("[SR-026/AK1] lists only hints: warnings about an element, no errors such as a missing target", async () => {
    const workspace = await opened();
    const check = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(check.problems.map((p) => p.code)).toContain("relation.missing-target");
    expect((await list(workspace)).hints).toEqual(check.problems.filter(isHint));
  });

  it("[SR-026/AK1] gives the hints of workspace.check, also of a workspace with one finding of each kind", async () => {
    const workspace = await opened({ fixture: "SR-019/findings" });
    const check = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    const hints = check.problems.filter(isHint);
    expect(hints.length).toBeGreaterThan(5);
    expect((await list(workspace)).hints).toEqual(hints);
    // The finding states it leaves out give no hint (duplicate IDs, missing targets, evidence records).
    expect(FINDING_STATES.filter((s) => !(HINT_STATES as readonly unknown[]).includes(s))).toHaveLength(3);
    expect(HINT_STATES.every((s) => (FINDING_STATES as readonly unknown[]).includes(s))).toBe(true);
  });

  it("[SR-040/AK3] lists a hint for each requirement whose validity lists a superseded variant", async () => {
    const output = await list(await opened(), { kind: ["variant.superseded-in-validity"] });
    expect(rows(output.hints)).toEqual([VALIDITY_R3]);
  });

  it("[SR-072/AK2] lists a hint for each relation to a superseded element", async () => {
    const output = await list(await opened(), { kind: ["relation.target-superseded"] });
    expect(rows(output.hints)).toEqual([SUPERSEDED_R3]);
  });

  it("[SR-026/AK2] filters by kind", async () => {
    const workspace = await opened();
    expect(rows((await list(workspace, { kind: ["relation.outdated"] })).hints)).toEqual([
      OUTDATED_R1,
      OUTDATED_R1,
    ]);
    expect(
      rows((await list(workspace, { kind: ["element.unknown-property", "element.missing-required"] })).hints),
    ).toEqual([REQUIRED_R2, UNKNOWN_N2, UNKNOWN_R4]);
    expect((await list(workspace, { kind: ["trace.cycle"] })).hints).toEqual([]);
  });

  it("[SR-026/AK2] filters by type, a type that extends it included", async () => {
    const workspace = await opened();
    expect(rows((await list(workspace, { type: ["need"] })).hints)).toEqual([UNKNOWN_N2]);
    expect(rows((await list(workspace, { type: ["safety-requirement"] })).hints)).toEqual([
      UNKNOWN_R4,
      NO_PARENT_R4,
    ]);
    expect(rows((await list(workspace, { type: ["system-requirement"] })).hints)).toEqual(
      ALL.filter((r) => r !== UNKNOWN_N2),
    );
    expect(rows((await list(workspace, { type: ["need", "safety-requirement"] })).hints)).toEqual([
      UNKNOWN_N2,
      UNKNOWN_R4,
      NO_PARENT_R4,
    ]);
    expect((await list(workspace, { type: ["variant"] })).hints).toEqual([]);
  });

  it("[SR-026/AK2] filters by package", async () => {
    const workspace = await opened();
    expect(rows((await list(workspace, { package: "PKG-0000d1" })).hints)).toEqual([
      UNKNOWN_R4,
      NO_PARENT_R4,
      OUTDATED_R1,
      OUTDATED_R1,
    ]);
    expect(rows((await list(workspace, { package: P2 })).hints)).toEqual([REQUIRED_R2]);
  });

  it("[SR-026/AK2] filters by variant: the elements without a validity and those whose validity lists it", async () => {
    const workspace = await opened();
    expect(rows((await list(workspace, { variant: VA })).hints)).toEqual([
      REQUIRED_R2,
      UNKNOWN_N2,
      OUTDATED_R1,
      OUTDATED_R1,
    ]);
    expect(rows((await list(workspace, { variant: "VAR-0000c2" })).hints)).toEqual([
      REQUIRED_R2,
      UNKNOWN_N2,
      UNKNOWN_R4,
      SUPERSEDED_R3,
      VALIDITY_R3,
      NO_PARENT_R4,
    ]);
  });

  it("[SR-026/AK2] filters by element, and combines the filters", async () => {
    const workspace = await opened();
    expect(rows((await list(workspace, { ref: "SR-0000b3" })).hints)).toEqual([SUPERSEDED_R3, VALIDITY_R3]);
    expect(rows((await list(workspace, { ref: N1 })).hints)).toEqual([]);
    expect(
      rows(
        (
          await list(workspace, {
            type: ["system-requirement"],
            variant: VB,
            kind: ["element.unknown-property"],
          })
        ).hints,
      ),
    ).toEqual([UNKNOWN_R4]);
    expect(
      (await list(workspace, { package: P1, variant: VA, kind: ["element.unknown-property"] })).hints,
    ).toEqual([]);
  });

  it("refuses an element that is no package or no variant, and an unknown one", async () => {
    const workspace = await opened();
    expect(await listError(workspace, { package: VA })).toMatchObject({
      code: "input.invalid",
      details: { command: "hint.list", fields: ["package"] },
    });
    expect(await listError(workspace, { variant: P1 })).toMatchObject({
      code: "input.invalid",
      details: { command: "hint.list", fields: ["variant"] },
    });
    expect((await listError(workspace, { ref: "SR-ffffff" })).code).toBe("ref.unknown");
    expect((await listError(workspace, { package: "PKG-ffffff" })).code).toBe("ref.unknown");
  });

  it("[SR-013/AK3] names the meaning packages the package filter needs", async () => {
    const workspace = await opened({
      ...HINTS,
      files: { "metamodel/standard-model.yaml": STANDARD.replace("    meaning: packages\n", "") },
    });
    expect(await listError(workspace, { package: P1 })).toMatchObject({
      code: "metamodel.meaning-unassigned",
      details: { meaning: "packages", command: "hint.list" },
    });
    // Without the filter the list needs no meaning.
    expect((await list(workspace)).hints.length).toBeGreaterThan(0);
  });

  it("matches no element by package when the property with the meaning packages holds no relations", async () => {
    const relation =
      "    kind: relation\n    many: true\n    target-types: [package]\n    meaning: packages\n";
    expect(STANDARD).toContain(relation);
    const workspace = await opened({
      ...HINTS,
      files: {
        "metamodel/standard-model.yaml": STANDARD.replace(
          relation,
          "    kind: text\n    meaning: packages\n",
        ),
      },
    });
    expect((await list(workspace, { package: P1 })).hints).toEqual([]);
  });

  it("[SR-006/AK2] is incomplete while a repository is not on this machine", async () => {
    const workspace = await opened({
      ...HINTS,
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          '  - { name: away, url: "git@git.example.com:ws/away.git", path: ../away }\n' +
          "metamodel: { repository: system, path: metamodel }\n",
      },
    });
    const output = await list(workspace);
    expect(output.incomplete).toBe(true);
    expect(rows(output.hints)).toEqual(ALL);
  });

  it("lists no hints while the metamodel is not valid (#208, #220 option 1)", async () => {
    const workspace = await opened({
      ...HINTS,
      files: { "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: 5\n" },
    });
    expect((await workspace.get(metamodelState)).valid).toBe(false);
    expect(await list(workspace)).toEqual({ hints: [], incomplete: false });
  });

  it("matches the element of a hint by its UUID, repository and file, or the only record of its UUID", async () => {
    const workspace = await opened();
    const [metamodel, store] = await Promise.all([
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
    ]);
    const stray: Problem = {
      code: "element.unknown-property",
      severity: "warning",
      message: "stray",
      repository: "system",
      file: "elsewhere.md",
      elementId: "26a0b000-0000-4000-8000-0000000000ee",
    };
    // A file that holds no record of the UUID: the only record of the UUID is meant.
    const elsewhere: Problem = { ...stray, elementId: N2, file: "needs/elsewhere.md" };
    const context = { metamodel, store };
    expect(await hintsOf(workspace, context, { types: ["need"] }, [stray, elsewhere], [])).toEqual([
      elsewhere,
    ]);
    // No record of the UUID: no element filter matches it.
    expect(await hintsOf(workspace, context, { types: ["need"] }, [stray], [])).toEqual([]);
    expect(await hintsOf(workspace, context, {}, [stray], [])).toEqual([stray]);
  });

  it("matches outdated evidence by the element it names, not by its record file", async () => {
    const workspace = await opened();
    const [metamodel, store] = await Promise.all([
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
    ]);
    const evidence: Problem = {
      code: "evidence.outdated",
      severity: "warning",
      message: "The newest verification record of SAF-0000b4 is for an older version",
      repository: "system",
      file: "evidence/results.xml",
      line: 3,
      elementId: R4,
      elementRepository: "system",
      elementFile: "requirements/SAF-0000000000b4.md",
      storedVersion: "n1:0000000000000000",
      currentVersion: "n1:1111111111111111",
    };
    const context = { metamodel, store };
    const pkg = store.byId.get(P1)?.[0];
    const own = store.byId.get(R4)?.[0];
    expect(pkg).toBeDefined();
    expect(own).toBeDefined();
    const filters: HintFilter[] = [
      { types: ["safety-requirement"] },
      ...(own === undefined ? [] : [{ ref: own }]),
      ...(pkg === undefined ? [] : [{ package: { element: pkg, key: { key: "packages", many: true } } }]),
    ];
    expect(filters).toHaveLength(3);
    for (const filter of filters) {
      expect(await hintsOf(workspace, context, filter, [evidence], [])).toEqual([evidence]);
    }
    expect(await hintsOf(workspace, context, { types: ["need"] }, [evidence], [])).toEqual([]);
  });
});

describe("hints at the element (SR-026 AK3)", () => {
  it("[SR-026/AK3] element.get shows the outdated relation and reference of an element, with their lines", async () => {
    // More needs, so that R1's three targets are a small share of the store (`currentVersionsOf`).
    const needs = Object.fromEntries(
      [1, 2, 3, 4].map((i) => [
        `needs/N-0000000000e${String(i)}.md`,
        `---\nid: ${P}e${String(i)}\ntype: need\nstatus: draft\ntitle: More ${String(i)}\n---\n`,
      ]),
    );
    const workspace = await opened({ ...HINTS, files: needs });
    const element = await get(workspace, { ref: R1 });
    const outdated = (element.problems ?? []).filter((p) => p.code === "relation.outdated");
    expect(outdated.map((p) => [p.targetId, p.line])).toEqual([
      [N1, 14],
      [N1, 17],
    ]);
    // Without versionDate no git runs: the message names no dates.
    expect(outdated[0]?.message).toBe(
      "Relation Derives from (derives-from) of System Requirement SR-0000b1 points to an older version of Need N-0000a1",
    );
    // A single element never builds the versions of the whole workspace (ADR-0008).
    expect(workspace.peek(currentVersionsState)).toBeUndefined();
    // The same hints as the list, apart from the dates.
    const listed = (await list(workspace, { ref: R1 })).hints;
    const undated = listed.map(({ storedDate: _s, currentDate: _c, ...p }) => ({
      ...p,
      message: p.message.replace(/: stored version from .*$/, ""),
    }));
    expect(outdated).toEqual(undated);
  });

  it("[SR-026/AK3] element.get with versionDate names the dates, as hint.list does, also once the versions are built", async () => {
    const ws = await fixture({ ...HINTS, git: true });
    const workspace = open(ws.root);
    const listed = (await list(workspace, { ref: R1 })).hints;
    expect(await currentVersionsIfBuilt(workspace)).toBeDefined();
    const element = await get(workspace, { ref: R1, versionDate: true });
    expect((element.problems ?? []).filter((p) => p.code === "relation.outdated")).toEqual(listed);
    expect(listed[0]?.currentDate).toBe(await headDate(ws));
  });

  it("[SR-026/AK3] element.get shows the other hints of the element too, and none on an element without", async () => {
    const workspace = await opened();
    expect(rows((await get(workspace, { ref: R3 })).problems ?? [])).toEqual([SUPERSEDED_R3, VALIDITY_R3]);
    expect((await get(workspace, { ref: N1 })).problems).toEqual([]);
  });

  it("[SR-026/AK3] element.update and element.create show the outdated hints of the element they wrote", async () => {
    const workspace = await opened();
    const shown = await get(workspace, { ref: R1 });
    const updated = (
      (await invoke(
        "element.update",
        { ref: R1, title: "Show wind speed" },
        { workspace },
      )) as CommandOutput<"element.update">
    ).element;
    expect(updated.problems).toEqual(shown.problems);
    expect(updated.problems?.filter((p) => p.code === "relation.outdated").map((p) => p.line)).toEqual([
      14, 17,
    ]);
    const created = (
      (await invoke(
        "element.create",
        {
          type: "need",
          title: "Feel the wind",
          folder: "needs",
          text: `Like [See the wind](reqseq:${N1}?version=n1:0000000000000000).`,
        },
        { workspace },
      )) as CommandOutput<"element.create">
    ).element;
    // A new link stores the current version (ADR-0004): nothing is outdated.
    expect(created.problems).toEqual([]);
  });

  it("uses the kept versions only once their build has ended, and reads the targets' versions meanwhile", async () => {
    const workspace = await opened();
    const store = await workspace.get(elementStoreState);
    const building = workspace.get(currentVersionsState);
    expect(await currentVersionsIfBuilt(workspace)).toBeUndefined();
    const [n1] = store.byId.get(N1) ?? [];
    expect(n1).toBeDefined();
    const own = await currentVersionsOf(workspace, n1 === undefined ? [] : [n1]);
    const built = await building;
    expect(await currentVersionsIfBuilt(workspace)).toBe(built);
    expect(n1 === undefined ? undefined : own.get(n1)).toEqual(
      n1 === undefined ? undefined : built.byRecord.get(n1),
    );
  });

  it("[SR-026/AK3] shows a hint at the element as its file holds it now", async () => {
    const ws = await fixture();
    const workspace = open(ws.root);
    await workspace.get(elementStoreState);
    const text = await readFile(path.join(ws.root, R1_FILE), "utf8");
    await ws.write(
      R1_FILE,
      text.replace("title: Show wind speed\n", "title: Show wind speed\nrationale: Safety\n"),
    );
    const element = await get(workspace, { ref: R1 });
    expect((element.problems ?? []).filter((p) => p.code === "relation.outdated").map((p) => p.line)).toEqual(
      [15, 18],
    );
  });
});
