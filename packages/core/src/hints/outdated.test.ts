// Outdated relations and inline references (SR-025) in `workspace.check`, on fixtures/SR-025/outdated:
// requirement A derives from the need N, is valid in the variant V (a relation-valued property,
// ADR-0004) and references N in its text; requirement B refines A. Every stored version is current.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import {
  applyStoreChange,
  buildIncomingIndex,
  currentVersionsState,
  elementStoreState,
  incomingFor,
  incomingState,
  shortIdState,
  updateElement,
  updateElements,
} from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { parseHintId } from "./hint-id.js";
import type { OutdatedFinding } from "./outdated.js";
import { datedProblems, outdatedFindingsOf, outdatedRelationsState } from "./outdated.js";

type Output = CommandOutput<"workspace.check">;

const P = "5e025a7d-2b4f-4c61-9d08-0";
const N = `${P}a0000000001`;
const A = `${P}b0000000001`;
const B = `${P}b0000000002`;
const V = `${P}c0000000001`;
const N_FILE = "needs/N-0a0000000001.md";
const V_FILE = "variants/V-0c0000000001.md";
const A_FILE = "requirements/SR-0b0000000001.md";
const B_FILE = "requirements/SR-0b0000000002.md";
/** The versions the fixture stores: the current ones. */
const N_VERSION = "n1:4a120bac998acdc8";
const V_VERSION = "n1:b3f17e3d2a46ea1e";
const A_VERSION = "n1:c432bd0d8bcd0958";
/** Where A is stored, as hint IDs name it: repository, file (percent-encoded) and UUID. */
const AT_A = `system/${encodeURIComponent(A_FILE)}/${A}`;
const A_PLACE = { sourceRepository: "system", file: A_FILE, source: A };

const FIXTURE_FOLDER = path.resolve(import.meta.dirname, "../../../../fixtures/SR-025/outdated");

/** The files of fixtures/SR-025/outdated below `prefix`, for a workspace of several repositories. */
const fixtureFiles = async (prefix: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    await Promise.all(
      ["logreq-workspace.yaml", "metamodel/standard-model.yaml", N_FILE, V_FILE, A_FILE, B_FILE].map(
        async (file) =>
          [`${prefix}${file}`, await readFile(path.join(FIXTURE_FOLDER, file), "utf8")] as const,
      ),
    ),
  );

const fixture = async (
  options: Parameters<typeof createFixtureWorkspace>[0] = {},
): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-025/outdated", ...options });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const check = async (workspace: Workspace): Promise<Output> =>
  (await invoke("workspace.check", {}, { workspace })) as Output;

/** The committer date of HEAD as ADR-0005 writes a version date. */
const headDate = async (ws: FixtureWorkspace): Promise<string> =>
  new Date(Number((await ws.git(["show", "-s", "--format=%ct", "HEAD"])).trim()) * 1000)
    .toISOString()
    .replace(".000Z", "Z");

const need = (text: string): string =>
  `---\nid: ${N}\ntype: need\nstatus: approved\ntitle: See the wind\n---\n\n${text}\n`;
const variant = (text: string): string =>
  `---\nid: ${V}\ntype: variant\nstatus: draft\ntitle: Pro\n---\n\n${text}\n`;

/** Requirement A with the given stored versions (`undefined`: the key is left out of the item or link). */
const requirementA = (
  versions: { readonly validity?: string; readonly derives?: string; readonly link?: string } = {},
  extra = "",
): string => {
  const item = (id: string, version: string | undefined, title: string): string =>
    `  - { id: ${id}${version === undefined ? "" : `, version: ${version}`}, title: ${title} }`;
  const link = versions.link === undefined ? "" : `?version=${versions.link}`;
  return [
    "---",
    `id: ${A}`,
    "type: system-requirement",
    "status: draft",
    "title: Show wind speed",
    "requirement-type: functional",
    "acceptance-criteria:",
    "  - Given wind, when it is measured, then the station shows its speed.",
    "validity:",
    item(V, versions.validity, "Pro"),
    "derives-from:",
    item(N, versions.derives, "See the wind"),
    "---",
    "",
    `So that the operator can [See the wind](logreq:${N}${link}).${extra}`,
    "",
  ].join("\n");
};

/** Changes the text of N and of V, so that every relation of A to them is outdated (A itself keeps its version). */
const changeTargets = async (ws: FixtureWorkspace): Promise<void> => {
  await ws.write(N_FILE, need("The operator sees wind speed and direction at a glance."));
  await ws.write(V_FILE, variant("The station for professional users."));
};

/** Any version of normal form 1: the new versions of the changed targets. */
const NEW_VERSION: unknown = expect.stringMatching(/^n1:[0-9a-f]{16}$/);

const outdated = (out: Output): Problem[] => out.problems.filter((p) => p.code === "relation.outdated");

describe("outdated relations and references (SR-025)", () => {
  it("[SR-025/AK1] reports nothing and is ok when every relation and reference is current", async () => {
    const ws = await fixture({ git: true });
    expect(await check(open(ws.root))).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-025/AK1] reports nothing without Git either", async () => {
    const ws = await fixture();
    expect(await check(open(ws.root))).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-025/AK2] names source, target and the dates of the stored and the current version, and is not ok", async () => {
    const ws = await fixture({ git: true });
    const stored = await headDate(ws);
    await changeTargets(ws);
    const out = await check(open(ws.root));
    expect(out.ok).toBe(false);
    const problems = outdated(out);
    expect(problems).toEqual([
      {
        code: "relation.outdated",
        severity: "warning",
        message: `Property Validity (validity) of System Requirement SR-b0000000001 points to an older version of Variant VAR-c0000000001: stored version from ${stored}, current version from no date (not committed, or Git cannot tell)`,
        repository: "system",
        file: A_FILE,
        line: 10,
        elementId: A,
        targetId: V,
        storedVersion: V_VERSION,
        currentVersion: NEW_VERSION,
        storedDate: stored,
        currentDate: null,
        hintId: `relation.outdated/${AT_A}/validity/${V}?version=${V_VERSION}`,
      },
      {
        code: "relation.outdated",
        severity: "warning",
        message: `Relation Derives from (derives-from) of System Requirement SR-b0000000001 points to an older version of Need N-a0000000001: stored version from ${stored}, current version from no date (not committed, or Git cannot tell)`,
        repository: "system",
        file: A_FILE,
        line: 12,
        elementId: A,
        targetId: N,
        storedVersion: N_VERSION,
        currentVersion: NEW_VERSION,
        storedDate: stored,
        currentDate: null,
        hintId: `relation.outdated/${AT_A}/derives-from/${N}?version=${N_VERSION}`,
      },
      {
        code: "relation.outdated",
        severity: "warning",
        message: `Reference in the text of System Requirement SR-b0000000001 points to an older version of Need N-a0000000001: stored version from ${stored}, current version from no date (not committed, or Git cannot tell)`,
        repository: "system",
        file: A_FILE,
        line: 15,
        elementId: A,
        targetId: N,
        storedVersion: N_VERSION,
        currentVersion: NEW_VERSION,
        storedDate: stored,
        currentDate: null,
        hintId: `relation.outdated/${AT_A}/@text/${N}?version=${N_VERSION}&n=1`,
      },
    ]);
    // Both relations to N name its one current version; it is not V's.
    expect(problems[1]?.currentVersion).toBe(problems[2]?.currentVersion);
    expect(problems[1]?.currentVersion).not.toBe(N_VERSION);
    expect(problems[0]?.currentVersion).not.toBe(V_VERSION);
    expect(out.problems).toEqual(problems);
  });

  it("[SR-025/AK2] gives the date of the commit of the current version once it is committed", async () => {
    const ws = await fixture({ git: true });
    const stored = await headDate(ws);
    await changeTargets(ws);
    await ws.commit();
    const current = await headDate(ws);
    expect(current).not.toBe(stored);
    const problems = outdated(await check(open(ws.root)));
    expect(problems.map((p) => [p.targetId, p.storedDate, p.currentDate])).toEqual([
      [V, stored, current],
      [N, stored, current],
      [N, stored, current],
    ]);
    expect(problems[0]?.message).toContain(`stored version from ${stored}, current version from ${current}`);
  });

  it("[SR-025/AK2] gives no dates without Git", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const problems = outdated(await check(open(ws.root)));
    expect(problems.map((p) => [p.storedDate, p.currentDate])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
  });

  it("[SR-025/AK2] reports a relation whose target changed after it was set in a later state of the same workspace", async () => {
    const ws = await fixture();
    const workspace = open(ws.root);
    expect((await check(workspace)).ok).toBe(true);
    // A new text of A makes B's refinement outdated; A's own relations stay current.
    await ws.write(
      A_FILE,
      requirementA({ validity: V_VERSION, derives: N_VERSION, link: N_VERSION }, " Now."),
    );
    await workspace.reset(elementStoreState);
    const problems = outdated(await check(workspace));
    expect(problems.map((p) => [p.elementId, p.targetId, p.file, p.line, p.storedVersion])).toEqual([
      [B, A, B_FILE, 10, A_VERSION],
    ]);
  });

  it("[SR-025/AK3] reports a relation no more once its stored version is the current one (what confirming writes, D-042)", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const before = outdated(await check(open(ws.root)));
    const [validity, derives, link] = before.map((p) => p.currentVersion);
    // Confirming the derivation writes the current version of N into that item only (SR-027 AK1).
    await ws.write(A_FILE, requirementA({ validity: V_VERSION, derives: derives ?? "", link: N_VERSION }));
    const after = outdated(await check(open(ws.root)));
    expect(after.map((p) => p.hintId)).toEqual([before[0]?.hintId, before[2]?.hintId]);
    // And all of them: nothing of A is left. The confirmed link changed A's text, so A has a new
    // version and B's refinement of A is outdated now (ADR-0004: a reference in the text counts).
    await ws.write(
      A_FILE,
      requirementA({ validity: validity ?? "", derives: derives ?? "", link: link ?? "" }),
    );
    expect(outdated(await check(open(ws.root))).map((p) => [p.elementId, p.targetId])).toEqual([[B, A]]);
  });

  it("does not report targets that are missing, ambiguous, not on this machine or of an unknown repository", async () => {
    const OLD = "n1:0000000000000000";
    const GONE = `${P}a0000000009`;
    const ws = await fixture({
      files: {
        "logreq-workspace.yaml":
          'logreq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "x", main: true }\n  - { name: away, url: "y", path: ../away }\nmetamodel: { repository: system, path: metamodel }\n',
        [B_FILE]: [
          "---",
          `id: ${B}`,
          "type: system-requirement",
          "status: draft",
          "title: Show wind speed in large digits",
          "requirement-type: functional",
          "acceptance-criteria:",
          "  - Given a wind speed, when it is shown, then its digits are at least 2 cm high.",
          "refines:",
          `  - { id: ${GONE}, version: ${OLD} }`,
          `  - { id: ${A}, version: ${OLD}, repository: away }`,
          `  - { id: ${A}, version: ${OLD}, repository: elsewhere }`,
          `  - { id: ${N}, version: ${OLD} }`,
          "---",
          "",
          `[Gone](logreq:${GONE}?version=${OLD}) [Away](logreq:${A}?version=${OLD}&repository=away) [N](logreq:${N}?version=${OLD})`,
          "",
        ].join("\n"),
        // N twice: a relation to it is ambiguous (SR-088).
        "copies/N-0a0000000001.md": need("A copy."),
      },
    });
    const problems = outdated(await check(open(ws.root)));
    expect(problems).toEqual([]);
  });

  it("does not report an item or a link without a valid stored version (SR-085 reports the item)", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    // A's text changes with its links, so B's refinement of A is outdated: only A's relations are looked at.
    const ofA = async (): Promise<Problem[]> =>
      outdated(await check(open(ws.root))).filter((p) => p.elementId === A);
    await ws.write(A_FILE, requirementA({ validity: "n1:not-a-version" }));
    expect(await ofA()).toEqual([]);
    // An item without a UUID names no target.
    await ws.write(
      A_FILE,
      requirementA({ validity: V_VERSION }).replace(
        `{ id: ${V}, version: ${V_VERSION}, title: Pro }`,
        "{ title: Pro }",
      ),
    );
    expect(await ofA()).toEqual([]);
    await ws.write(A_FILE, requirementA({ validity: V_VERSION, derives: N_VERSION, link: "old" }));
    expect((await ofA()).map((p) => p.targetId)).toEqual([V, N]);
  });

  it("gives the outdated relations and references of one element as the whole-workspace state does (for its view, SR-026)", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    const all = await workspace.get(outdatedRelationsState);
    const versions = await workspace.get(currentVersionsState);
    const layout = await workspace.get(workspaceLayoutState);
    const context = {
      layout,
      metamodel: await workspace.get(metamodelState),
      shortIds: await workspace.get(shortIdState),
      versions,
    };
    const a = versions.store.elements.find((e) => e.id === A);
    if (a === undefined) {
      throw new Error("A is not in the store");
    }
    const own = await outdatedFindingsOf(layout, a, context);
    expect(own).toEqual(all);
    expect(await datedProblems(workspace, own)).toEqual(await datedProblems(workspace, all));
    expect(await datedProblems(workspace, [])).toEqual([]);
  });

  it("gives items and links no line when the file changed since the store read it, and the parsed line for another layout", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    // Written in a flow sequence: the line of the item is the one the YAML parse gives (the key line).
    const flow = requirementA({ validity: V_VERSION, derives: N_VERSION, link: N_VERSION }).replace(
      `derives-from:\n  - { id: ${N}, version: ${N_VERSION}, title: See the wind }`,
      `derives-from: [{ id: ${N}, version: ${N_VERSION} }]`,
    );
    await ws.write(A_FILE, flow);
    const workspace = open(ws.root);
    const lines = (found: readonly OutdatedFinding[]): (number | undefined)[] =>
      found.filter((f) => f.element.id === A).map((f) => f.problem.line);
    expect(lines(await workspace.get(outdatedRelationsState))).toEqual([10, 11, 14]);
    // Changed on disk after the store read it: no line, for the items and for the link alike.
    await ws.write(A_FILE, `${flow}More.\n`);
    await workspace.reset(outdatedRelationsState);
    expect(lines(await workspace.get(outdatedRelationsState))).toEqual([undefined, undefined, undefined]);
  });

  it("gives files that share a source UUID (SR-088) hint IDs of their own", async () => {
    const ws = await fixture({
      files: { "copies/SR-0b0000000001.md": await readFile(path.join(FIXTURE_FOLDER, A_FILE), "utf8") },
    });
    await changeTargets(ws);
    const ids = outdated(await check(open(ws.root)))
      .filter((p) => p.targetId === N && p.hintId?.includes("derives-from") === true)
      .map((p) => p.hintId);
    expect(ids).toEqual([
      `relation.outdated/system/copies%2FSR-0b0000000001.md/${A}/derives-from/${N}?version=${N_VERSION}`,
      `relation.outdated/${AT_A}/derives-from/${N}?version=${N_VERSION}`,
    ]);
  });

  it("is carried over a save as a fresh build gives it, looking again at the sources of relations to the saved element", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    const before = await workspace.get(outdatedRelationsState);
    expect(before.map((f) => f.problem.targetId)).toEqual([V, N, N]);
    // The need gets its old text back: A's relations to it are current again, while A's file is unchanged.
    await updateElement(workspace, { ref: N, text: "The operator sees the wind at a glance." });
    const kept = workspace.peek(outdatedRelationsState);
    expect(kept).toBeDefined();
    const after = await workspace.get(outdatedRelationsState);
    const fresh = open(ws.root);
    const built = await fresh.get(outdatedRelationsState);
    const shape = (found: readonly OutdatedFinding[]): unknown[] =>
      found.map((f) => [f.element.file, f.target.id, f.stored, f.current, f.problem]);
    expect(shape(after)).toEqual(shape(built));
    expect(after.map((f) => f.problem.targetId)).toEqual([V]);
    // A save of B (no relation points at it) keeps A's findings as they are.
    await updateElement(workspace, { ref: B, text: "Refines how the wind speed is shown, again." });
    expect(shape(await workspace.get(outdatedRelationsState))).toEqual(shape(after));
  });

  it("is built again after a change of the store it cannot carry", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    await workspace.get(outdatedRelationsState);
    // Without the incoming index of the store before the change, the sources are not known.
    // A watcher batch (a save builds the index before it writes, SR-024).
    workspace.get(incomingState).delete(await workspace.get(elementStoreState));
    await ws.write(N_FILE, need("The operator sees the wind at a glance."));
    const layout = await workspace.get(workspaceLayoutState);
    await applyStoreChange(workspace, (store) =>
      updateElements(store, layout, new Map([["system", { paths: [N_FILE] }]])),
    );
    expect(workspace.peek(outdatedRelationsState)).toBeUndefined();
    expect((await workspace.get(outdatedRelationsState)).map((f) => f.problem.targetId)).toEqual([V]);
    // An index built with another metamodel counts as none: the findings are built anew, not carried.
    const store = await workspace.get(elementStoreState);
    workspace
      .get(incomingState)
      .set(store, buildIncomingIndex(store, { ...(await workspace.get(metamodelState)) }));
    await ws.write(N_FILE, need("The operator sees wind speed and direction at a glance."));
    await applyStoreChange(workspace, (from) =>
      updateElements(from, layout, new Map([["system", { paths: [N_FILE] }]])),
    );
    expect((await workspace.get(outdatedRelationsState)).map((f) => f.problem.targetId)).toEqual([V, N, N]);
    // The index of the new store was built again with the workspace's metamodel.
    expect(workspace.get(incomingState).get(await workspace.get(elementStoreState))?.metamodel).toBe(
      await workspace.get(metamodelState),
    );
    // A new element changes the short IDs: built again too.
    await workspace.get(outdatedRelationsState);
    await invoke("element.create", { type: "need", title: "Another need", text: "New." }, { workspace });
    expect(workspace.peek(outdatedRelationsState)).toBeUndefined();
  });

  it("reports outdated relations without asking for their dates when warnings are not shown", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const out = (await invoke(
      "workspace.check",
      { severity: "error" },
      { workspace: open(ws.root) },
    )) as Output;
    // Not ok for the warnings, which the filter leaves out.
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual([]);
  });

  it("does not report a target whose current version is unknown (its file no longer holds it)", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    await workspace.get(elementStoreState);
    // After the store read N, its file holds another element: N has no current version.
    await ws.write(N_FILE, need("Other.").replace(N, `${P}a0000000002`));
    const problems = await workspace.get(outdatedRelationsState);
    expect(problems.map((f) => f.problem.targetId)).toEqual([V]);
    await workspace.reset(currentVersionsState);
    expect((await workspace.get(outdatedRelationsState)).map((f) => f.problem.targetId)).toEqual([V]);
  });

  it("numbers identical links in the text in their hint IDs, and parses every hint ID back", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    await ws.write(
      A_FILE,
      requirementA(
        { validity: V_VERSION, derives: N_VERSION, link: N_VERSION },
        `\nAgain [See the wind](logreq:${N}?version=${N_VERSION}&repository=system) and [See the wind](logreq:${N}?version=${N_VERSION}).`,
      ),
    );
    // B's refinement of A is outdated too, since A's text changed; only A's relations are looked at.
    const problems = outdated(await check(open(ws.root))).filter((p) => p.elementId === A);
    expect(problems.map((p) => [p.line, p.hintId])).toEqual([
      [10, `relation.outdated/${AT_A}/validity/${V}?version=${V_VERSION}`],
      [12, `relation.outdated/${AT_A}/derives-from/${N}?version=${N_VERSION}`],
      [15, `relation.outdated/${AT_A}/@text/${N}?version=${N_VERSION}&n=1`],
      [16, `relation.outdated/${AT_A}/@text/${N}?version=${N_VERSION}&repository=system&n=1`],
      [16, `relation.outdated/${AT_A}/@text/${N}?version=${N_VERSION}&n=2`],
    ]);
    expect(problems.map((p) => parseHintId(p.hintId ?? ""))).toEqual([
      { kind: "relation", ...A_PLACE, key: "validity", target: V, version: V_VERSION },
      { kind: "relation", ...A_PLACE, key: "derives-from", target: N, version: N_VERSION },
      { kind: "reference", ...A_PLACE, target: N, version: N_VERSION, occurrence: 1 },
      { kind: "reference", ...A_PLACE, target: N, repository: "system", version: N_VERSION, occurrence: 1 },
      { kind: "reference", ...A_PLACE, target: N, version: N_VERSION, occurrence: 2 },
    ]);
  });

  it("names the repository of a target in another repository in the hint ID", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        ...(await fixtureFiles("system/")),
        "system/logreq-workspace.yaml":
          'logreq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "x", main: true }\n  - { name: sensor, url: "y", path: ../sensor }\nmetamodel: { repository: system, path: metamodel }\n',
        "sensor/SSR-0d0000000001.md": [
          "---",
          `id: ${P}d0000000001`,
          "type: system-requirement",
          "status: draft",
          "title: Measure",
          "requirement-type: functional",
          "acceptance-criteria: [Given, when, then.]",
          "derives-from:",
          `  - { id: ${N}, version: n1:0000000000000000, repository: system }`,
          "---",
          "",
        ].join("\n"),
      },
    });
    onTestFinished(() => ws.cleanup());
    const out = await check(open(ws.path("system")));
    const problems = outdated(out);
    expect(problems.map((p) => [p.repository, p.hintId])).toEqual([
      [
        "sensor",
        `relation.outdated/sensor/SSR-0d0000000001.md/${P}d0000000001/derives-from/${N}?version=n1:0000000000000000&repository=system`,
      ],
    ]);
    expect(parseHintId(problems[0]?.hintId ?? "")).toMatchObject({ repository: "system" });
  });

  it("reports nothing against a metamodel that is not valid (#208, #220)", async () => {
    const ws = await fixture({ files: { "metamodel/broken.yaml": "properties: [\n" } });
    await changeTargets(ws);
    const workspace = open(ws.root);
    expect(await workspace.get(outdatedRelationsState)).toEqual([]);
    expect(outdated(await check(workspace))).toEqual([]);
    // Carried over a save as well (when other commands built the states it depends on): still nothing.
    await Promise.all([workspace.get(currentVersionsState), workspace.get(shortIdState)]);
    incomingFor(workspace, await workspace.get(elementStoreState), await workspace.get(metamodelState));
    await updateElement(workspace, { ref: N, text: "The operator sees the wind at a glance." });
    expect(workspace.peek(outdatedRelationsState)).toBeDefined();
    expect(await workspace.get(outdatedRelationsState)).toEqual([]);
  });
});
