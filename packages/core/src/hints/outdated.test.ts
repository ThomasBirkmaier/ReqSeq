// Outdated relations and inline references (SR-025) in `workspace.check`, on fixtures/SR-025/outdated:
// requirement A derives from the need N, is valid in the variant V (a relation-valued property,
// ADR-0004) and references N in its text; requirement B refines A. Every stored version is current.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import {
  applyStoreChange,
  buildIncomingIndex,
  currentFormsOf,
  currentVersionsState,
  elementStoreState,
  incomingFor,
  incomingState,
  NORMAL_FORM,
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
import { readStored } from "../runtime/read-first.test-helper.js";
import { WRITTEN_VERSION } from "../model/version-forms.test-helper.js";

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
const N_VERSION = "n1:323df2732ed684b0";
const V_VERSION = "n1:b72330c9018ce26f";
const A_VERSION = "n1:e73a2cb229cfa29d";
/** Where A is stored, as hint IDs name it: repository, file (percent-encoded) and UUID. */
const AT_A = `system/${encodeURIComponent(A_FILE)}/${A}`;
const A_PLACE = { code: "relation.outdated", sourceRepository: "system", file: A_FILE, source: A };

const FIXTURE_FOLDER = path.resolve(import.meta.dirname, "../../../../fixtures/SR-025/outdated");

/** The files of fixtures/SR-025/outdated below `prefix`, for a workspace of several repositories. */
const fixtureFiles = async (prefix: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    await Promise.all(
      ["reqseq-workspace.yaml", "metamodel/standard-model.yaml", N_FILE, V_FILE, A_FILE, B_FILE].map(
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

const check = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("workspace.check", input, { workspace })) as Output;

/** The committer date of HEAD as ADR-0005 writes a version date. */
const headDate = async (ws: FixtureWorkspace): Promise<string> =>
  new Date(Number((await ws.git(["show", "-s", "--format=%ct", "HEAD"])).trim()) * 1000)
    .toISOString()
    .replace(".000Z", "Z");

/** The object name of HEAD, which started the versions of its commit (#252). */
const headCommit = async (ws: FixtureWorkspace): Promise<string> =>
  (await ws.git(["rev-parse", "HEAD"])).trim();

const defined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  return value as T;
};

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
    `So that the operator can [See the wind](reqseq:${N}${link}).${extra}`,
    "",
  ].join("\n");
};

/** Changes the text of N and of V, so that every relation of A to them is outdated (A itself keeps its version). */
const changeTargets = async (ws: FixtureWorkspace): Promise<void> => {
  await ws.write(N_FILE, need("The operator sees wind speed and direction at a glance."));
  await ws.write(V_FILE, variant("The station for professional users."));
};

/** Any version of the form the tool writes: the new versions of the changed targets. */
const NEW_VERSION: unknown = expect.stringMatching(WRITTEN_VERSION);

const outdated = (out: Output): Problem[] => out.problems.filter((p) => p.code === "relation.outdated");

describe("a reference written by the [[ search (SR-066)", () => {
  it("[SR-066/AK3] a reference in the text whose target changed is outdated like the relation to that target: same code, severity and versions", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const problems = outdated(await check(open(ws.root)));
    const relation = problems.find(
      (p) => p.hintId === `relation.outdated/${AT_A}/derives-from/${N}?version=${N_VERSION}`,
    );
    const reference = problems.find(
      (p) => p.hintId === `relation.outdated/${AT_A}/@text/${N}?version=${N_VERSION}&n=1`,
    );
    expect(relation).toBeDefined();
    expect(reference).toMatchObject({
      code: relation?.code,
      severity: relation?.severity,
      elementId: A,
      targetId: N,
      storedVersion: relation?.storedVersion,
      currentVersion: relation?.currentVersion,
    });
  });

  it("[SR-066/AK3] a reference that stores normal form 2 stays current when its target changes only the stored version of its own reference, and is outdated after a real change (ADR-0005)", async () => {
    const ws = await fixture();
    const withLink = (version: string, text = "The operator sees the wind."): string =>
      need(`${text} [Pro](reqseq:${V}?version=${version})`);
    await ws.write(N_FILE, withLink("n1:0000000000000000"));
    const formsOf = async (id: string) => {
      const versions = await open(ws.root).get(currentVersionsState);
      return defined(currentFormsOf(versions, defined(versions.store.byId.get(id)?.[0])));
    };
    const n = await formsOf(N);
    await ws.write(A_FILE, requirementA({ validity: V_VERSION, derives: N_VERSION, link: n.n2 }));
    const links = async (): Promise<unknown[]> =>
      outdated(await check(open(ws.root)))
        .filter((p) => p.elementId === A && p.place?.in === "text")
        .map((p) => [p.targetId, p.storedVersion]);
    expect(await links()).toEqual([]);
    // N stores another version of V in its own reference, as confirming writes it: n2 of N stays.
    await ws.write(N_FILE, withLink("n2:1111111111111111"));
    expect((await formsOf(N)).n2).toBe(n.n2);
    expect(await links()).toEqual([]);
    await ws.write(N_FILE, withLink("n2:1111111111111111", "The operator sees the gusts."));
    expect(await links()).toEqual([[N, n.n2]]);
  });

  it("[SR-066/AK3] trace.affected of a target lists an element that references it only in its text", async () => {
    const ws = await fixture();
    // A without its relation to N: the reference in the text is all that ties A to N.
    await ws.write(A_FILE, requirementA({ link: N_VERSION }).replace(/derives-from:\n.*\n/u, ""));
    const workspace = open(ws.root);
    expect((await readFile(path.join(ws.root, A_FILE), "utf8")).includes("derives-from")).toBe(false);
    const affected = (await invoke(
      "trace.affected",
      { ref: N },
      { workspace },
    )) as CommandOutput<"trace.affected">;
    expect(affected.affected.find((a) => a.id === A)?.via).toEqual({ kind: "reference" });
  });
});

describe("outdated relations and references (SR-025)", () => {
  it("[SR-025/AK1] reports nothing and is ok when every relation and reference is current, stored in normal form 1 as an earlier version of the tool wrote it", async () => {
    const ws = await fixture({ git: true });
    // The fixture stores the n1 versions of the unchanged targets; the tool writes n2 (ADR-0005).
    expect(await readFile(path.join(ws.root, A_FILE), "utf8")).toContain(`version: ${N_VERSION}`);
    expect(NORMAL_FORM).toBe("n2");
    expect(await check(open(ws.root))).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-025/AK1] reports nothing when every relation and reference stores the current version in normal form 2 (ADR-0005)", async () => {
    const ws = await fixture();
    const formsOf = async (id: string) => {
      const versions = await open(ws.root).get(currentVersionsState);
      return defined(currentFormsOf(versions, defined(versions.store.byId.get(id)?.[0])));
    };
    const [n, v] = [await formsOf(N), await formsOf(V)];
    await ws.write(A_FILE, requirementA({ validity: v.n2, derives: n.n2, link: n.n2 }));
    const a = await formsOf(A);
    const b = await readFile(path.join(FIXTURE_FOLDER, B_FILE), "utf8");
    await ws.write(B_FILE, b.replace(A_VERSION, a.n2));
    expect(await check(open(ws.root))).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("reports a stored version of normal form 2 that is not the current one, with the current version confirm writes (ADR-0005)", async () => {
    const ws = await fixture();
    const versions = await open(ws.root).get(currentVersionsState);
    const v = defined(currentFormsOf(versions, defined(versions.store.byId.get(V)?.[0])));
    const n = defined(currentFormsOf(versions, defined(versions.store.byId.get(N)?.[0])));
    await ws.write(A_FILE, requirementA({ validity: v.n2, derives: "n2:0000000000000000" }));
    const fromA = outdated(await check(open(ws.root))).filter((p) => p.elementId === A);
    expect(fromA.map((p) => [p.targetId, p.storedVersion, p.currentVersion])).toEqual([
      [N, "n2:0000000000000000", n[NORMAL_FORM]],
    ]);
  });

  it("[SR-025/AK1] reports nothing without Git either", async () => {
    const ws = await fixture();
    expect(await check(open(ws.root))).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-025/AK2] names source, target and the dates of the stored and the current version, and is not ok", async () => {
    const ws = await fixture({ git: true });
    const stored = await headDate(ws);
    const storedCommit = await headCommit(ws);
    await changeTargets(ws);
    const workspace = open(ws.root);
    // "Exit-Code ungleich 0" for an outdated relation, a warning: with failOn warning (ThomasBirkmaier/ReqSeq-archive#304, option 1;
    // SR-025 AK2 gets a new version after the spec moves into ReqSeq). By default it is ok.
    const out = await check(workspace, { failOn: "warning" });
    expect(out.ok).toBe(false);
    expect(await check(workspace)).toEqual({ ...out, ok: true });
    const problems = outdated(out);
    expect(problems).toEqual([
      {
        code: "relation.outdated",
        severity: "warning",
        message: `Property Validity (validity) of System Requirement SR-b0000000001 points to an older version of Variant VAR-c0000000001: stored version from ${stored} (${storedCommit.slice(0, 12)}), current version from no date (not committed, or Git cannot tell)`,
        repository: "system",
        file: A_FILE,
        line: 10,
        elementId: A,
        elementShortId: "SR-b0000000001",
        targetId: V,
        targetRepository: "system",
        targetShortId: "VAR-c0000000001",
        storedVersion: V_VERSION,
        currentVersion: NEW_VERSION,
        storedDate: stored,
        currentDate: null,
        storedCommit,
        currentCommit: null,
        hintId: `relation.outdated/${AT_A}/validity/${V}?version=${V_VERSION}`,
        key: "validity",
        place: { in: "relation" },
      },
      {
        code: "relation.outdated",
        severity: "warning",
        message: `Relation Derives from (derives-from) of System Requirement SR-b0000000001 points to an older version of Need N-a0000000001: stored version from ${stored} (${storedCommit.slice(0, 12)}), current version from no date (not committed, or Git cannot tell)`,
        repository: "system",
        file: A_FILE,
        line: 12,
        elementId: A,
        elementShortId: "SR-b0000000001",
        targetId: N,
        targetRepository: "system",
        targetShortId: "N-a0000000001",
        storedVersion: N_VERSION,
        currentVersion: NEW_VERSION,
        storedDate: stored,
        currentDate: null,
        storedCommit,
        currentCommit: null,
        hintId: `relation.outdated/${AT_A}/derives-from/${N}?version=${N_VERSION}`,
        key: "derives-from",
        place: { in: "relation" },
      },
      {
        code: "relation.outdated",
        severity: "warning",
        message: `Reference in the text of System Requirement SR-b0000000001 points to an older version of Need N-a0000000001: stored version from ${stored} (${storedCommit.slice(0, 12)}), current version from no date (not committed, or Git cannot tell)`,
        repository: "system",
        file: A_FILE,
        line: 15,
        elementId: A,
        elementShortId: "SR-b0000000001",
        targetId: N,
        targetRepository: "system",
        targetShortId: "N-a0000000001",
        storedVersion: N_VERSION,
        currentVersion: NEW_VERSION,
        storedDate: stored,
        currentDate: null,
        storedCommit,
        currentCommit: null,
        hintId: `relation.outdated/${AT_A}/@text/${N}?version=${N_VERSION}&n=1`,
        // An inline reference in the text: no key (#222).
        place: { in: "text", occurrence: 1 },
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
    const storedCommit = await headCommit(ws);
    await changeTargets(ws);
    await ws.commit();
    const current = await headDate(ws);
    const currentCommit = await headCommit(ws);
    expect(current).not.toBe(stored);
    const problems = outdated(await check(open(ws.root)));
    expect(problems.map((p) => [p.targetId, p.storedDate, p.currentDate])).toEqual([
      [V, stored, current],
      [N, stored, current],
      [N, stored, current],
    ]);
    // The commits that started both versions, for `git diff` (#252).
    expect(problems.map((p) => [p.storedCommit, p.currentCommit])).toEqual([
      [storedCommit, currentCommit],
      [storedCommit, currentCommit],
      [storedCommit, currentCommit],
    ]);
    expect(problems[0]?.message).toContain(
      `stored version from ${stored} (${storedCommit.slice(0, 12)}), current version from ${current} (${currentCommit.slice(0, 12)})`,
    );
  });

  it("[SR-015/AK4] names a later change of the metamodel when the stored version has no date (#252, P-2-09)", async () => {
    // N has a rationale from the start; the stored versions are those without it counting.
    const ws = await fixture({
      git: true,
      files: {
        [N_FILE]: need("The operator sees the wind at a glance.").replace(
          "---\n\n",
          "rationale: Gusts.\n---\n\n",
        ),
      },
    });
    expect(outdated(await check(open(ws.root)))).toEqual([]);
    const fileStart = await headCommit(ws);
    const model = await readFile(path.join(FIXTURE_FOLDER, "metamodel/standard-model.yaml"), "utf8");
    const marked = model.replace(
      "  - key: rationale\n    name: Rationale\n    kind: text\n",
      "$&    content: true\n",
    );
    expect(marked).not.toBe(model);
    await ws.write("metamodel/standard-model.yaml", marked);
    await ws.commit();
    const change = await headCommit(ws);
    const changeDate = await headDate(ws);
    const problems = outdated(await check(open(ws.root))).filter((p) => p.targetId === N);
    expect(problems.map((p) => [p.storedCommit, p.currentCommit, p.currentDate === null])).toEqual([
      [null, fileStart, false],
      [null, fileStart, false],
    ]);
    expect(problems[0]?.message).toContain(
      `stored version from no date, current version from ${String(problems[0]?.currentDate)} (${fileStart.slice(0, 12)}) (not committed, or Git cannot tell; the metamodel changed on ${changeDate} (${change.slice(0, 12)}), and older commits are read with today's metamodel)`,
    );
  });

  it("[SR-004/AK6] reads and writes the elements of a repository without Git, gives no dates, and the outdated hint says Git cannot read it", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    const problems = outdated(await check(workspace));
    expect(problems.map((p) => p.targetId)).toEqual([V, N, N]);
    for (const problem of problems) {
      expect([problem.storedDate, problem.currentDate]).toEqual([null, null]);
      expect(problem.message).toMatch(/: neither version has a date \(Git cannot read the repository\)$/);
    }
    await invoke(
      "element.update",
      await readStored({ ref: B, text: "Refines it, written without Git." }, workspace),
      {
        workspace,
      },
    );
    expect(await readFile(path.join(ws.root, B_FILE), "utf8")).toContain("Refines it, written without Git.");
  });

  it("[SR-025/AK2] gives no dates without Git", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const problems = outdated(await check(open(ws.root)));
    expect(problems.map((p) => [p.storedDate, p.currentDate, p.storedCommit, p.currentCommit])).toEqual([
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
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
    // And all of them: nothing of A is left. The confirmed link changed A's text and so its n1
    // version, which B's refinement of A stores: it is outdated now, once (ADR-0005 "Rings"); the
    // n2 version of A, which confirming writes, stays.
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
        "reqseq-workspace.yaml":
          'reqseq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "x", main: true }\n  - { name: away, url: "y", path: ../away }\nmetamodel: { repository: system, path: metamodel }\n',
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
          `[Gone](reqseq:${GONE}?version=${OLD}) [Away](reqseq:${A}?version=${OLD}&repository=away) [N](reqseq:${N}?version=${OLD})`,
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

  it("[SR-025/AK5] reports no outdated relation or reference of a source with an invalid status, in the check, hint.list, element.get and hint.confirm; trace.graph keeps them visible", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    const before = outdated(await check(workspace)).filter((p) => p.elementId === A);
    expect(before.map((p) => p.targetId)).toEqual([V, N, N]);
    // A becomes obsolete (D-044) while the workspace is open: the state is carried over the write.
    await invoke("element.setStatus", { refs: [A], status: "obsolete" }, { workspace });
    const fromA = (problems: readonly Problem[]): Problem[] =>
      problems.filter((p) => p.elementId === A && p.code === "relation.outdated");
    expect(fromA((await check(workspace)).problems)).toEqual([]);
    expect(fromA((await check(open(ws.root))).problems)).toEqual([]);
    const listed = (await invoke("hint.list", {}, { workspace })) as CommandOutput<"hint.list">;
    expect(listed.hints.filter((h) => h.elementId === A && h.code === "relation.outdated")).toEqual([]);
    const shown = (await invoke("element.get", { ref: A }, { workspace })) as CommandOutput<"element.get">;
    expect(fromA(shown.element.problems ?? [])).toEqual([]);
    const confirmed = (await invoke(
      "hint.confirm",
      { hintIds: [defined(before[1]).hintId] },
      { workspace },
    )) as CommandOutput<"hint.confirm">;
    expect((confirmed.problems ?? []).map((p) => p.code)).toEqual(["hint.not-found"]);
    // In the chain the relations stay visible: outdated edges, and A carries both marks.
    const graph = (await invoke("trace.graph", { ref: A }, { workspace })) as CommandOutput<"trace.graph">;
    expect(graph.edges.filter((e) => e.source === A && e.outdated).map((e) => [e.target, e.link])).toEqual([
      [V, "relation"],
      [N, "relation"],
      [N, "reference"],
    ]);
    expect(graph.nodes.find((n) => n.id === A)?.marks).toEqual(["outdated", "superseded"]);
    // Back to a valid status, the hints are reported again.
    await invoke("element.setStatus", { refs: [A], status: "draft" }, { workspace });
    expect(fromA((await check(workspace)).problems).map((p) => p.hintId)).toEqual(
      before.map((p) => p.hintId),
    );
  });

  it("is carried over a save as a fresh build gives it, looking again at the sources of relations to the saved element", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    const before = await workspace.get(outdatedRelationsState);
    expect(before.map((f) => f.problem.targetId)).toEqual([V, N, N]);
    // The need gets its old text back: A's relations to it are current again, while A's file is unchanged.
    await updateElement(
      workspace,
      await readStored({ ref: N, text: "The operator sees the wind at a glance." }, workspace),
    );
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
    await updateElement(
      workspace,
      await readStored({ ref: B, text: "Refines how the wind speed is shown, again." }, workspace),
    );
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
      { severity: "error", failOn: "warning" },
      { workspace: open(ws.root) },
    )) as Output;
    // Not ok for the warnings with failOn warning, though the filter leaves them out; counted as hidden.
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual([]);
    expect(out.hidden).toEqual({ below: "error", warning: 3, info: 0 });
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
        `\nAgain [See the wind](reqseq:${N}?version=${N_VERSION}&repository=system) and [See the wind](reqseq:${N}?version=${N_VERSION}).`,
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
        "system/reqseq-workspace.yaml":
          'reqseq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "x", main: true }\n  - { name: sensor, url: "y", path: ../sensor }\nmetamodel: { repository: system, path: metamodel }\n',
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

  it("reports nothing against a metamodel that is not valid (ThomasBirkmaier/ReqSeq-archive#208, ThomasBirkmaier/ReqSeq-archive#220)", async () => {
    const ws = await fixture({ files: { "metamodel/broken.yaml": "properties: [\n" } });
    await changeTargets(ws);
    const workspace = open(ws.root);
    expect(await workspace.get(outdatedRelationsState)).toEqual([]);
    expect(outdated(await check(workspace))).toEqual([]);
    // Carried over a save as well (when other commands built the states it depends on): still nothing.
    await Promise.all([workspace.get(currentVersionsState), workspace.get(shortIdState)]);
    incomingFor(workspace, await workspace.get(elementStoreState), await workspace.get(metamodelState));
    await updateElement(
      workspace,
      await readStored({ ref: N, text: "The operator sees the wind at a glance." }, workspace),
    );
    expect(workspace.peek(outdatedRelationsState)).toBeDefined();
    expect(await workspace.get(outdatedRelationsState)).toEqual([]);
  });
});
