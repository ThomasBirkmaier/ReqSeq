// SR-026 AK3: every hint `hint.list` lists for an element is shown at it (`element.get`), whatever
// its kind, and both computed for the element alone (the whole-workspace states not built) and from
// those states once they are. On fixtures that between them have every kind of hint of stage 2:
// outdated relations and references, superseded variants in a validity (SR-040), relations to
// superseded elements (SR-072), unknown properties and types, required properties without a value,
// values of the wrong kind, relations the metamodel does not allow, and cycles of derivations; and
// outdated evidence through its seam (SR-025 AK4, #127 option 1).
import { readFile } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { STANDARD_MODEL_TEXT as STANDARD } from "../metamodel/standard-model.js";
import { elementStoreState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { derivationCycleProblemsState } from "../trace/index.js";
import type { EvidenceRecord } from "../evidence/index.js";
import { evidenceRecordsState } from "../evidence/index.js";
import { outdatedEvidenceProblemsState } from "./evidence.js";
import { isHint } from "./list.js";

type Shown = CommandOutput<"element.get">;

const open = async (options: FixtureOptions, root = ""): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === "" ? fixture.root : `${fixture.root}/${root}`);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** A hint without its dates, which `element.get` gives only with `versionDate`, in a stable order. */
const undated = (hints: readonly Problem[]): Problem[] =>
  hints
    .map(({ storedDate: _stored, currentDate: _current, ...hint }) => ({
      ...hint,
      message: hint.message.replace(/: stored version from .*$/, ""),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

const listed = async (workspace: Workspace, ref: string): Promise<Problem[]> =>
  undated(((await invoke("hint.list", { ref }, { workspace })) as CommandOutput<"hint.list">).hints);

const shown = async (workspace: Workspace, ref: string): Promise<Problem[]> =>
  undated(
    ((await invoke("element.get", { ref }, { workspace })) as Shown).element.problems?.filter(isHint) ?? [],
  );

/** The UUIDs of the store that name one element each (`hint.list` refuses a shared one as ambiguous). */
const uniqueIds = async (workspace: Workspace): Promise<string[]> => {
  const store = await workspace.get(elementStoreState);
  return [...store.byId].filter(([, records]) => records.length === 1).map(([id]) => id);
};

/**
 * Per element, the hints `element.get` shows before any whole-workspace state is built, then those
 * `hint.list` lists, then those `element.get` shows from the built states; all three must agree.
 * Returns the codes of every hint listed.
 */
const sameAtElement = async (options: FixtureOptions, root = ""): Promise<Set<string>> => {
  const fresh = await open(options, root);
  const ids = await uniqueIds(fresh);
  const alone = new Map<string, Problem[]>();
  for (const id of ids) {
    alone.set(id, await shown(fresh, id));
  }
  const workspace = await open(options, root);
  const codes = new Set<string>();
  for (const id of ids) {
    const hints = await listed(workspace, id);
    for (const hint of hints) {
      codes.add(hint.code);
    }
    expect(alone.get(id), `element.get ${id}, states not built`).toEqual(hints);
    expect(await shown(workspace, id), `element.get ${id}, states built`).toEqual(hints);
  }
  return codes;
};

describe("hints at the element equal the hints hint.list lists for it (SR-026 AK3)", () => {
  it("[SR-026/AK3] outdated relations, superseded variants and targets, unknown and required properties", async () => {
    expect([...(await sameAtElement({ fixture: "SR-026/hints" }))].sort()).toEqual([
      "element.missing-required",
      "element.unknown-property",
      "relation.outdated",
      "relation.target-superseded",
      "variant.superseded-in-validity",
    ]);
  });

  it("[SR-026/AK3] cycles of derivations", async () => {
    const codes = await sameAtElement({ fixture: "SR-090/cycle" });
    expect(codes.has("trace.cycle")).toBe(true);
  });

  it("[SR-026/AK3] values of the wrong kind, relations the metamodel does not allow, unknown types, and the fixtures of SR-072 and SR-040", async () => {
    const codes = new Set([
      ...(await sameAtElement({ fixture: "SR-085/value-kinds" }, "system")),
      ...(await sameAtElement({ fixture: "SR-086/relation-types" }, "system")),
      ...(await sameAtElement({ fixture: "SR-016/unknown" })),
      ...(await sameAtElement({ fixture: "SR-072/supersede" })),
      ...(await sameAtElement({ fixture: "SR-040/validity" })),
    ]);
    for (const code of ["element.wrong-value-kind", "relation.not-allowed", "element.unknown-type"]) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it("[SR-026/AK3] shows a cycle from the walk up and from the kept state alike", async () => {
    const workspace = await open({ fixture: "SR-090/cycle" });
    const ids = await uniqueIds(workspace);
    const before = await Promise.all(ids.map((id) => shown(workspace, id)));
    expect(before.flat().some((p) => p.code === "trace.cycle")).toBe(true);
    await workspace.get(derivationCycleProblemsState);
    expect(await Promise.all(ids.map((id) => shown(workspace, id)))).toEqual(before);
  });

  it("[SR-026/AK3] shows a kept cycle at its relation as the file holds it now", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-090/cycle" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const A = "5e9c0a7d-2b4f-4c61-9d08-0b0000000001";
    const FILE = "requirements/SR-0b0000000001.md";
    const lineOfCycle = async (): Promise<number | undefined> =>
      (await shown(workspace, A)).find((p) => p.code === "trace.cycle")?.line;
    await workspace.get(derivationCycleProblemsState);
    expect(await lineOfCycle()).toBe(11);
    const text = await readFile(fixture.path(FILE), "utf8");
    // One more line above the relation to B: the hint follows it.
    await fixture.write(FILE, text.replace("acceptance-criteria:\n", "acceptance-criteria:\n  - Another.\n"));
    expect(await lineOfCycle()).toBe(12);
    // The relation to B is gone from the file: the hint stays at the line the kept state located.
    await fixture.write(
      FILE,
      text.replace("  - { id: 5e9c0a7d-2b4f-4c61-9d08-0b0000000002, version: n1:271d0e4683aa4263 }\n", ""),
    );
    expect(await lineOfCycle()).toBe(11);
  });

  it("[SR-026/AK3] shows no cycle without a relation kind with the meaning derivation", async () => {
    const workspace = await open({
      fixture: "SR-090/cycle",
      files: { "metamodel/standard-model.yaml": STANDARD.replaceAll("    meaning: derivation\n", "") },
    });
    const ids = await uniqueIds(workspace);
    const all = (await Promise.all(ids.map((id) => shown(workspace, id)))).flat();
    expect(all.filter((p) => p.code === "trace.cycle")).toEqual([]);
  });

  it("[SR-026/AK3] [SR-025/AK4] shows outdated evidence at its element, alone and from the kept state", async () => {
    const A = "5e025a7d-2b4f-4c61-9d08-0b0000000001";
    const records: EvidenceRecord[] = [
      {
        kind: "verification",
        element: A,
        version: "n1:0000000000000000",
        date: "2026-01-02T10:00:00Z",
        result: "passed",
        repository: "system",
        file: "evidence/results.xml",
        line: 7,
      },
    ];
    const seeded = async (): Promise<Workspace> => {
      const workspace = await open({ fixture: "SR-025/outdated" });
      const empty = workspace.get(evidenceRecordsState);
      await workspace.replace(evidenceRecordsState, empty, Promise.resolve(records));
      return workspace;
    };
    const alone = await shown(await seeded(), A);
    expect(alone.map((p) => [p.code, p.file, p.line, p.elementFile])).toEqual([
      ["evidence.outdated", "evidence/results.xml", 7, "requirements/SR-0b0000000001.md"],
    ]);
    const workspace = await seeded();
    expect(await listed(workspace, A)).toEqual(alone);
    expect(await workspace.get(outdatedEvidenceProblemsState)).toHaveLength(1);
    expect(await shown(workspace, A)).toEqual(alone);
  });
});
