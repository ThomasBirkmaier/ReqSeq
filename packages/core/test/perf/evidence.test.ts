// E4 (#583): the evidence commands in the generated workspace of N-036 (50,000 elements, 200,000
// relations) with the records a project of that size keeps (`withEvidenceRecords` of the testkit:
// JUnit files of three CI runs, Markdown verification records, about 10,000 elements with validation
// records). ADR-0011: tests tagged `[SR-082/AKn]` assert their threshold after `measure` recorded the
// time; untagged rows only record. The thresholds are those of SR-082 (N-036): AK3 „Gegeben derselbe
// Arbeitsbereich, wenn ein Element geöffnet wird, dann ist es nach höchstens 200 ms sichtbar.“ and
// AK4 „Gegeben derselbe Arbeitsbereich, wenn ein Filter angewendet oder eine Kette berechnet wird,
// dann erscheint das Ergebnis nach höchstens 500 ms.“ No SR names a time for `evidence.status`,
// `evidence.coverage`, `evidence.degree` or `data.export`, nor says whether AK4 covers the first
// filter after the start (spec question #693): those rows carry AK4's 500 ms as a threshold for
// comparison, untagged, so the record shows them as exceeded without failing the run.
// `workspace.check` and the start are recorded with SR-020's 60 s and SR-082 AK1/AK2's 3 s/30 s,
// untagged, as in large-workspace.test.ts (the tagged tests of those are at the access level).
//
// "Cold" is the first use after a start: a new `Workspace` on the same files, its model loaded as
// `warmWorkspace` loads it but without the background search index (`warmModel`, so no build competes
// for the cores), and its evidence files read (a row of its own), so the cold rows hold the status
// state (`verificationState`: the walk and one batch of current versions) and nothing else. At most
// one workspace is open at a time, so the heap holds one store.
import type { GeneratedEvidence, LargeFixtureWorkspace } from "@logreq/testkit";
import {
  generateLargeWorkspace,
  measure,
  measurePeakMemory,
  memoryIncrease,
  recordValue,
  thresholdMessage,
  withEvidenceRecords,
  writeLargeWorkspace,
} from "@logreq/testkit";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandName, CommandOutput } from "../../src/catalog.js";
import {
  evidenceIndexState,
  evidenceReadState,
  evidenceRecordsState,
  verificationState,
} from "../../src/evidence/index.js";
import { MODEL_CACHE_FILE, RACY_MS } from "../../src/model/model-cache.js";
import { applyStoreChange, elementStoreState, updateElements, warmModel } from "../../src/model/index.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK3. */
const OPEN_MS = 200;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** SR-020 AK1, for `workspace.check` in process (recorded, untagged). */
const CHECK_MS = 60_000;
/** The largest page (catalog). */
const MAX_LIMIT = 5000;

/** Rows #693 asks about: SR-082 AK4's 500 ms as a threshold for comparison only (untagged, never asserted). */
const COMPARE_AK4 = "untagged; threshold for comparison only (#693)";
const COMPARED = { thresholdMs: RESULT_MS } as const;

type Output<K extends CommandName> = CommandOutput<K>;

describe("evidence commands with 50,000 elements and their records (N-036, E4 #583)", () => {
  let evidence: GeneratedEvidence;
  let fixture: LargeFixtureWorkspace | undefined;
  let current: Workspace | undefined;
  /** The cache folder of the copy (ADR-0008), outside every repository, as the CLI and the servers pass it. */
  let cacheFolder = "";

  /** Opens a workspace on the files with the cache folder and loads the model; none may be open. */
  const start = async (): Promise<Workspace> => {
    const opened = new Workspace(fixture?.workspaceRoot ?? "", { cacheFolder });
    await warmModel(opened);
    current = opened;
    return opened;
  };

  /**
   * Closes the open workspace (which waits for the model cache to be written) and opens a new one on
   * the same files with the cache folder, as a server starts (`warmModel`, see the file comment).
   */
  const reopen = async (): Promise<Workspace> => {
    await current?.close();
    current = undefined;
    return start();
  };

  const ws = (): Workspace => {
    if (current === undefined) {
      throw new Error("no workspace");
    }
    return current;
  };

  /** Reads the evidence files of a newly opened workspace (its own row in the first test). */
  const readEvidence = async (opened: Workspace): Promise<void> => {
    await opened.get(evidenceIndexState);
  };

  const run = async <K extends CommandName>(
    command: K,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Output<K>> => (await invoke(command, input, { workspace: ws() })) as Output<K>;

  /**
   * Records a memory row next to a time row (as the heap rows of the search index): what the call
   * added. The generated tree stays in the heap here (the tests need its IDs); the increase does not
   * hold it.
   */
  const recordMemory = async (
    name: string,
    peak: Parameters<typeof memoryIncrease>[0],
    basis: string,
  ): Promise<void> => {
    await recordValue(`${name}: ${memoryIncrease(peak)}`, 0, { basis });
  };

  const byType = (type: string): readonly string[] =>
    evidence.workspace.elements.filter((e) => e.type === type).map((e) => e.id);

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const generated = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    evidence = withEvidenceRecords(generated);
    fixture = await writeLargeWorkspace(evidence.workspace);
    cacheFolder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-e4-cache-"));
    getCommandRuntime();
    // Files settled before the start, so the model cache takes every one (`RACY_MS`).
    await new Promise((resolve) => setTimeout(resolve, 2 * RACY_MS));
    // The start with about 18,800 record files, which the element store reads as Markdown files too.
    const records = evidence.counts.markdownVerification + evidence.counts.markdownValidation;
    await measure(
      `start with ${String(records)} Markdown record files in the repository: model loaded, no cache`,
      start,
      {
        basis: "SR-082 AK2, N-036 (warmModel in process, untagged; the app adds its own time)",
        thresholdMs: 30_000,
      },
    );
    expect((await ws().get(elementStoreState)).elements).toHaveLength(ELEMENTS);
    // Closed outside the measurement: `close()` waits for the model cache to be written.
    await ws().close();
    current = undefined;
    await fs.access(path.join(cacheFolder, MODEL_CACHE_FILE));
    await measure(
      `start with ${String(records)} Markdown record files in the repository: model loaded through the model cache`,
      start,
      {
        basis: "SR-082 AK1, N-036 (warmModel in process, untagged; the app adds its own time)",
        thresholdMs: 3_000,
      },
    );
    expect((await ws().get(elementStoreState)).elements).toHaveLength(ELEMENTS);
  }, 900_000);

  afterAll(async () => {
    await current?.close();
    await fixture?.cleanup();
    await fs.rm(cacheFolder, { recursive: true, force: true });
  });

  it("records reading every evidence file and building the evidence index (SR-028, SR-093)", async () => {
    const { counts } = evidence;
    const mb = (counts.junitBytes / 1e6).toFixed(1);
    const files = counts.junitFiles + counts.markdownVerification + counts.markdownValidation;
    const name = `evidence: read every evidence file (${String(files)} files: ${String(counts.junitFiles)} JUnit of ${mb} MB, ${String(counts.markdownVerification + counts.markdownValidation)} Markdown)`;
    const basis = "SR-028, SR-093, ADR-0012 (evidenceReadState: walk, 16 reads at a time, readers)";
    const peak = await measurePeakMemory(() => ws().get(evidenceReadState));
    await recordValue(name, peak.ms, { basis });
    await recordMemory("evidence: read every evidence file", peak, basis);
    const read = peak.result;
    expect(read.problems).toEqual([]);
    expect(read.incomplete).toBe(false);
    expect(read.skipped).toHaveLength(counts.skipped);
    expect(read.records).toHaveLength(
      counts.junitRecords + counts.markdownVerification + counts.markdownValidation,
    );
    const { result: index } = await measure(
      `evidence index: records by element and test cases (${String(read.records.length)} records)`,
      () => ws().get(evidenceIndexState),
      { basis: "SR-033 plan review S1c (evidenceIndexState on its own; recorded)" },
    );
    expect(index.testCases.size).toBe(counts.testCases);
  });

  it("[SR-082/AK4] applies the filter on the verification status within 500 ms once its state is built (SR-031, SR-034)", async () => {
    const where = { verification: ["verified"] };
    const { result: cold } = await measure(
      "filter verification [verified], first page: first filter after the start (status state built: walk and one version batch)",
      () => run("element.list", { selection: { where } }),
      { basis: `SR-082 AK4, SR-031, SR-034 (cold; ${COMPARE_AK4})`, ...COMPARED },
    );
    const { result: warm, measurement } = await measure(
      "filter verification [verified], first page: again (status state kept)",
      () => run("element.list", { selection: { where } }),
      { basis: "SR-082 AK4 (element.list with the condition verification, warm)", thresholdMs: RESULT_MS },
    );
    expect(warm).toEqual(cold);
    expect(warm.total).toBeGreaterThan(evidence.automated.length / 4);
    expect(warm.elements.every((e) => e.type === "system-requirement")).toBe(true);
    const status = await ws().get(verificationState);
    expect(status.versionBatches()).toBe(1);
    // The filter of SR-069 AK3 "ohne Nachweis" asks only whether a record exists (review of #557, N2).
    const { result: without, measurement: withoutEvidence } = await measure(
      "filter system requirements without evidence (relation direction evidence, exists false), first page (status state kept)",
      () =>
        run("element.list", {
          selection: {
            where: {
              all: [{ type: ["system-requirement"] }, { relation: { direction: "evidence" }, exists: false }],
            },
          },
        }),
      {
        basis: "SR-069 AK3, SR-082 AK4 (element.list with the condition no evidence, warm)",
        thresholdMs: RESULT_MS,
      },
    );
    // Those without any record, and those whose every execution was skipped.
    const requirements = byType("system-requirement").length;
    expect(without.total).toBeGreaterThanOrEqual(
      requirements - evidence.automated.length - evidence.manual.length,
    );
    expect(without.total).toBeLessThan(requirements / 2);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
    expect(withoutEvidence.ms, thresholdMessage(withoutEvidence)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] applies the filter on the validation status within 500 ms once its state is built (SR-038)", async () => {
    await reopen();
    await readEvidence(ws());
    const where = { validation: ["validated"] };
    const { result: cold } = await measure(
      "filter validation [validated], first page: first filter after the start (status state built)",
      () => run("element.list", { selection: { where } }),
      { basis: `SR-082 AK4, SR-038 (cold; ${COMPARE_AK4})`, ...COMPARED },
    );
    const { result: warm, measurement } = await measure(
      "filter validation [validated], first page: again (status state kept)",
      () => run("element.list", { selection: { where } }),
      { basis: "SR-082 AK4 (element.list with the condition validation, warm)", thresholdMs: RESULT_MS },
    );
    expect(warm).toEqual(cold);
    expect(warm.total).toBeGreaterThan(evidence.validated.length / 4);
    expect(warm.total).toBeLessThan(evidence.validated.length);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("records evidence.status pages of the system requirements and of the needs (SR-031, SR-034, SR-038)", async () => {
    await reopen();
    await readEvidence(ws());
    const requirements = { selection: { where: { type: ["system-requirement"] } }, limit: 200 };
    const { result: cold } = await measure(
      "evidence.status, first page (200) of the system requirements: first after the start",
      () => run("evidence.status", requirements),
      { basis: `SR-031, SR-034 (cold; ${COMPARE_AK4})`, ...COMPARED },
    );
    const { result: warm } = await measure(
      "evidence.status, first page (200) of the system requirements: again",
      () => run("evidence.status", requirements),
      { basis: `SR-031, SR-034 (warm; ${COMPARE_AK4})`, ...COMPARED },
    );
    expect(warm).toEqual(cold);
    expect(warm.total).toBe(byType("system-requirement").length);
    expect(warm.elements).toHaveLength(200);
    expect(warm.elements.every((e) => (e.verification?.length ?? 0) > 0)).toBe(true);
    const { result: needs } = await measure(
      "evidence.status, first page (200) of the needs (validation status)",
      () => run("evidence.status", { selection: { where: { type: ["need"] } }, limit: 200 }),
      { basis: `SR-038 (${COMPARE_AK4})`, ...COMPARED },
    );
    expect(needs.elements.every((e) => e.validation !== undefined)).toBe(true);
    // A page of needs reads no version batch of its own (SR-038 plan §11); the first page of the
    // requirements read one for the recorded children below its parents (SR-034).
    expect((await ws().get(verificationState)).versionBatches()).toBe(1);
    const { result: last } = await measure(
      "evidence.status, last page (5,000) of the system requirements",
      () =>
        run("evidence.status", {
          ...requirements,
          limit: MAX_LIMIT,
          offset: byType("system-requirement").length - MAX_LIMIT,
        }),
      { basis: `SR-031 (a page of the largest size; ${COMPARE_AK4})`, ...COMPARED },
    );
    expect(last.elements).toHaveLength(MAX_LIMIT);
  });

  /**
   * Opens an element as the app shows it (#542): `element.get` and the parents line at the same
   * time; SR-082 AK3 is the time of both (open-filter-chain.test.ts).
   */
  const open = async (id: string): Promise<Output<"element.get">["element"]> => {
    const [answer] = await Promise.all([
      run("element.get", { ref: id }),
      run("trace.neighbourhood", {
        ref: id,
        direction: "up",
        meanings: ["derivation"],
        allLevels: true,
        limit: 200,
      }),
    ]);
    return answer.element;
  };

  it("[SR-082/AK3] opens the top requirement of the tree within 200 ms: first open, again, right after one changed file (SR-034)", async () => {
    await reopen();
    await readEvidence(ws());
    const top = evidence.parents[0] ?? "";
    const { result: cold, measurement: first } = await measure(
      "element.get of the top system requirement with its parents line: first after the start (walk below it, one version batch)",
      () => open(top),
      {
        basis: "SR-082 AK3, SR-034 plan review B1.4 (the first open after the start; #698)",
        thresholdMs: OPEN_MS,
      },
    );
    const batches = (await ws().get(verificationState)).versionBatches();
    expect(batches).toBe(1);
    const { result: warm, measurement } = await measure(
      "element.get of the top system requirement with its parents line: again (status state kept)",
      () => open(top),
      {
        basis: "SR-082 AK3 (element.get of a requirement whose status comes from its children, warm)",
        thresholdMs: OPEN_MS,
      },
    );
    expect(warm).toEqual(cold);
    expect(warm.id).toBe(top);
    expect(["indirect", "open"]).toContain(warm.verification?.[0]?.status);
    expect((await ws().get(verificationState)).versionBatches()).toBe(batches);
    // The status state alone built again, with the current versions and the incoming index kept: the
    // walks below the top in the core, the neutral view and each variant above its seeds (#698), and
    // the version batch from the kept current versions.
    await ws().reset(verificationState);
    const { result: rebuilt } = await measure(
      "element.get of the top system requirement with its parents line: after a reset of the status state (current versions and incoming index kept)",
      () => open(top),
      { basis: "SR-082 AK3, #698 (the walk of the status state; recorded, compare 200 ms)" },
    );
    expect(rebuilt).toEqual(warm);

    // One element file changed outside LogReq (review of #581, N3): the watcher's batch replaces the
    // store, which resets the status state, so the next open of the top is cold again.
    const store = await ws().get(elementStoreState);
    const layout = await ws().get(workspaceLayoutState);
    const changed = store.elements.find((e) => e.id === evidence.automated.at(-1));
    if (changed === undefined) {
      throw new Error("the last automated requirement is not in the store");
    }
    const folder = layout.repositories.find((r) => r.name === changed.repository)?.folder ?? "";
    const file = path.join(folder, changed.file);
    await fs.writeFile(file, `${await fs.readFile(file, "utf8")}\nChanged outside LogReq.\n`);
    await measure(
      "store update of one changed element file (watcher batch; #558)",
      () =>
        applyStoreChange(ws(), (now) =>
          updateElements(now, layout, new Map([[changed.repository, { paths: [changed.file] }]])),
        ),
      { basis: "SR-007 AK1, #558 (recorded; part of what follows a change)" },
    );
    const { result: after, measurement: afterChange } = await measure(
      "element.get of the top system requirement with its parents line: right after one changed file",
      () => open(top),
      {
        basis: "SR-082 AK3, review of #581 N3 (status state reset by the store change)",
        thresholdMs: OPEN_MS,
      },
    );
    expect(after.id).toBe(top);
    expect(first.ms, thresholdMessage(first)).toBeLessThanOrEqual(OPEN_MS);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);
    expect(afterChange.ms, thresholdMessage(afterChange)).toBeLessThanOrEqual(OPEN_MS);
  });

  it("[SR-082/AK3] opens a need with validation records within 200 ms on its first open (SR-038)", async () => {
    const needs = new Set(byType("need"));
    const [warmed, need] = evidence.validated.filter((id) => needs.has(id));
    // Another need first, so the states every open shares are built; `need` itself is opened once.
    await open(warmed ?? "");
    const { result: shown, measurement } = await measure(
      "element.get of a need with validation records, with its parents line: its first open",
      () => open(need ?? ""),
      {
        basis: "SR-082 AK3, SR-038 (element.get of a need: its own records, the version shown)",
        thresholdMs: OPEN_MS,
      },
    );
    expect(shown.id).toBe(need);
    expect(shown.validation).toBeDefined();
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);
  });

  it("[SR-082/AK3] opens an automated requirement within 200 ms on its first open (SR-031)", async () => {
    // A leaf with JUnit records, not opened before; the status state is built (the opens above).
    const leaf = evidence.automated[0] ?? "";
    const { result: shown, measurement } = await measure(
      "element.get of an automated requirement with its records, with its parents line: its first open",
      () => open(leaf),
      {
        basis: "SR-082 AK3, SR-031 (element.get of a requirement with own records, status state built)",
        thresholdMs: OPEN_MS,
      },
    );
    expect(shown.id).toBe(leaf);
    expect(shown.verification?.[0]?.status).toBeDefined();
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);
  });

  it("[SR-082/AK3] opens a requirement within 200 ms right after recording evidence for it (SR-030)", async () => {
    const id = evidence.manual[0] ?? "";
    const before = await ws().get(evidenceRecordsState);
    const read = ws().peek(evidenceReadState);
    const { result: recorded } = await measure(
      "evidence.record of an inspection (new Markdown record file)",
      () =>
        run("evidence.record", {
          ref: id,
          kind: "verification",
          method: "inspection",
          result: "passed",
          item: "sample-e4",
        }),
      { basis: "SR-030 (recorded)" },
    );
    expect(recorded.problems).toEqual([]);
    // The record was put into the read state in memory (`withRecord`); a reset would leave it unbuilt.
    const replaced = ws().peek(evidenceReadState);
    expect(replaced).toBeDefined();
    expect(replaced).not.toBe(read);
    expect((await replaced)?.records).toHaveLength(before.length + 1);
    const { result: shown, measurement } = await measure(
      "element.get of a requirement with its parents line right after evidence.record for it",
      () => open(id),
      {
        basis:
          "SR-082 AK3, SR-030 plan review S1 (the record is put into the read state, no evidence file read)",
        thresholdMs: OPEN_MS,
      },
    );
    expect(shown.verification?.[0]?.status).toBe("verified");
    expect(ws().peek(evidenceReadState)).toBe(replaced);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);
  });

  it("[SR-082/AK4] computes a chain with the evidence of each node within 500 ms (SR-033)", async () => {
    const need = byType("need")[0] ?? "";
    const chainOf = (input: Readonly<Record<string, unknown>>): Promise<Output<"trace.chain">> =>
      run("trace.chain", { ref: need, ...input });
    const { result: both, measurement } = await measure(
      "trace.chain of the first need with evidence per node, first page (both directions)",
      () => chainOf({}),
      { basis: "SR-082 AK4, SR-033 (trace.chain through the catalog, first page)", thresholdMs: RESULT_MS },
    );
    const { result: down, measurement: downward } = await measure(
      "trace.chain of the first need with evidence per node, first page (down)",
      () => chainOf({ direction: "down" }),
      { basis: "SR-082 AK4, SR-033 (trace.chain down, first page)", thresholdMs: RESULT_MS },
    );
    expect(both.nodes).toHaveLength(200);
    expect(both.evidence.length).toBeGreaterThan(0);
    expect(down.evidence.length).toBeGreaterThan(0);
    expect(both.total).toBeGreaterThan(40_200);
    const { result: deep } = await measure(
      "trace.chain of the first need with evidence per node, page (200) at offset 40,000",
      () => chainOf({ offset: 40_000 }),
      { basis: `SR-033 plan review S1c (${COMPARE_AK4})`, ...COMPARED },
    );
    expect(deep.nodes).toHaveLength(200);
    const peak = await measurePeakMemory(() => chainOf({ limit: MAX_LIMIT }));
    const json = JSON.stringify(peak.result);
    const basis = "SR-033 plan review S1c (a page of the largest size; recorded)";
    await recordValue(
      `trace.chain of the first need with evidence per node, page of 5,000: ${(json.length / 1e6).toFixed(1)} MB of JSON, ${String(peak.result.evidence.length)} evidence entries`,
      peak.ms,
      { basis },
    );
    await recordMemory("trace.chain of the first need, page of 5,000", peak, basis);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
    expect(downward.ms, thresholdMessage(downward)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("records evidence.coverage, evidence.degree and data.export of the whole workspace (SR-036, SR-037)", async () => {
    const { result: coverage } = await measure(
      "evidence.coverage of every element (levels of the needs and the system requirements)",
      () => run("evidence.coverage", {}),
      { basis: `SR-036 (${COMPARE_AK4})`, ...COMPARED },
    );
    const requirementLevel = coverage.levels.find((l) => l.type === "system-requirement");
    expect(requirementLevel?.total).toBeGreaterThan(0);
    expect(requirementLevel?.withEvidence).toBeGreaterThan(0);
    await recordValue(
      `evidence.coverage of every element: ${(JSON.stringify(coverage).length / 1e6).toFixed(1)} MB of JSON`,
      0,
      { basis: "SR-036 (output size; recorded)" },
    );
    const { result: degree } = await measure(
      "evidence.degree of every system requirement (core)",
      () => run("evidence.degree", { selection: { where: { type: ["system-requirement"] } } }),
      { basis: `SR-037 (${COMPARE_AK4})`, ...COMPARED },
    );
    // The requirements with a status in the core: those with a validity apply only in their variants.
    expect(degree.degree.total).toBeGreaterThan(byType("system-requirement").length / 2);
    expect(degree.degree.total).toBeLessThanOrEqual(byType("system-requirement").length);
    const peak = await measurePeakMemory(() => run("data.export", {}));
    const basis = `data.export with verification status and records (${COMPARE_AK4})`;
    await recordValue("data.export of the whole workspace", peak.ms, { basis, ...COMPARED });
    await recordMemory("data.export of the whole workspace", peak, basis);
    // Its JSON size, counted element by element: the whole may not fit into one string (V8 holds at
    // most about 512 MB in one), which an adapter needs to send it.
    const { elements, ...rest } = peak.result;
    const bytes = elements.reduce(
      (sum, e) => sum + JSON.stringify(e).length + 1,
      JSON.stringify(rest).length,
    );
    await recordValue(`data.export of the whole workspace: ${(bytes / 1e6).toFixed(0)} MB of JSON`, 0, {
      basis: "data.export (output size; recorded)",
    });
    expect(peak.result.elements.length).toBeGreaterThanOrEqual(ELEMENTS);
  });

  it("records workspace.check with the evidence records (SR-020: 60 s, SR-025 AK4)", async () => {
    const { result: out } = await measure(
      "workspace.check with the evidence records (every finding state, evidence problems and outdated evidence)",
      () => run("workspace.check", {}),
      {
        basis: "SR-020, SR-025 AK4, in process (the store is loaded; AK1 is the CLI measurement)",
        thresholdMs: CHECK_MS,
      },
    );
    expect(out.problems.filter((p) => p.severity === "error")).toEqual([]);
  });
});
