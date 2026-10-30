// The hints since a variant's newest baseline (SR-103, N-036) in the performance suite, with the
// bounds of ADR-0018: the generated workspace of 50,000 elements with the variant rules pass of the
// testkit (100 variants), 50 of them with a newest baseline of every core requirement in their view
// (some 40,000 entries each, written as `baseline.create` writes) and one older, small one; variant A
// with 19 older baselines and 5,000 core requirements listed at another version (5,000 hints).
//
// - `hint.list --variant A`: A's hints with the baseline files not read yet (a new workspace on the
//   loaded model: the headers of 118 files, the newest of A in full), ≤ 1 s.
// - `workspace.check`: the since-baseline part for every variant, files not read yet, ≤ 10 s.
// - `element.get` of A in a running server (files kept), ≤ 200 ms (SR-082 AK3), also right after
//   one changed file elsewhere; `element.update` of A at most 75 ms above the save of a variant
//   without a baseline (median of 5 each).
// - `hint.list` by `ref` of a core requirement (≤ 200 ms, SR-026 AK3) and by type (≤ 500 ms,
//   SR-026 AK2) with these baselines present: neither computes since-baseline hints.
//
// Method: in process, on a workspace with the model loaded and the current versions built
// (`loaded()`), unlike ADR-0018's "one new CLI process per call". `hint.list` and `workspace.check`
// build the versions anyway, so the since-baseline part is measured after them. A cold CLI process
// (or the app before its background versions build ends) first waits for that build when it asks
// for the hints of a variant with a baseline, 4–5 s at N-036 (#259, `hints.md` "Cost").
import type { LargeFixtureWorkspace } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measure,
  measureMedian,
  thresholdMessage,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baselineText } from "../../src/baselines/index.js";
import type { CommandOutput } from "../../src/catalog.js";
import { sinceBaselineProblems } from "../../src/hints/index.js";
import type { SinceBaselineContext } from "../../src/hints/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import type { ElementRecord } from "../../src/model/index.js";
import { currentVersionOf, currentVersions, elementStoreState, shortIdState } from "../../src/model/index.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { isCoreRequirement, viewRuleOf } from "../../src/variants/index.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
const WITH_BASELINE = 50;
const OLDER_OF_A = 19;
const CHANGED_IN_A = 5000;
const LIST_MS = 1000;
const CHECK_MS = 10_000;
const GET_MS = 200;
const SAVE_EXTRA_MS = 75;
const SAVES = 5;
const TYPE_MS = 500;
const BASIS = "ADR-0018 performance bounds, SR-103, N-036";

describe("hints since a variant's newest baseline with 50,000 elements (SR-103, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let cacheFolder = "";
  const opened: Workspace[] = [];
  let a: ElementRecord;
  let core: ElementRecord;
  let elsewhere: ElementRecord;

  /** A workspace on the fixture with the model loaded and the current versions built, baselines not read (no search index in the background, as in a CLI process). */
  const loaded = async (): Promise<{
    readonly workspace: Workspace;
    readonly context: SinceBaselineContext;
  }> => {
    // One workspace at a time: two stores of 50,000 elements and 50 parsed baselines exceed the heap.
    await Promise.all(opened.splice(0).map((w) => w.close()));
    const workspace = new Workspace(String(fixture?.workspaceRoot), { cacheFolder });
    opened.push(workspace);
    await currentVersions(workspace);
    const context = {
      workspace,
      layout: await workspace.get(workspaceLayoutState),
      metamodel: await workspace.get(metamodelState),
      store: await workspace.get(elementStoreState),
      shortIds: await workspace.get(shortIdState),
    };
    return { workspace, context };
  };

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const tree = generateLargeWorkspace({
      version,
      elements: ELEMENTS,
      relations: RELATIONS,
      variantRules: {},
    });
    fixture = await writeLargeWorkspace(tree);
    cacheFolder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-since-baseline-cache-"));
    getCommandRuntime();
    const { context } = await loaded();
    const { store } = context;
    const versions = await currentVersions(context.workspace);
    const cores = store.elements.filter((e) => isCoreRequirement(context, e));
    const variants = store.elements.filter((e) => e.type === "variant").slice(0, WITH_BASELINE);
    [a] = variants as [ElementRecord];
    [core] = cores as [ElementRecord];
    [elsewhere] = store.elements.filter((e) => e.type !== "variant" && !isCoreRequirement(context, e)) as [
      ElementRecord,
    ];
    const folder = path.join(fixture.workspaceRoot, "baselines");
    await fs.mkdir(folder, { recursive: true });
    const write = async (
      name: string,
      date: string,
      variant: ElementRecord,
      entries: ElementRecord[],
    ): Promise<void> => {
      const elements = entries
        .map((e) => ({ id: e.id, version: String(currentVersionOf(versions, e)) }))
        .map((e, i) => (variant === a && i < CHANGED_IN_A ? { ...e, version: "n1:0000000000000000" } : e))
        .sort((x, y) => (x.id < y.id ? -1 : 1));
      const text = baselineText({
        "reqseq-baseline": 1,
        name,
        date,
        selection: { view: { id: variant.id, title: String(variant.data["title"]) } },
        repositories: [{ name: variant.repository, commit: "a".repeat(40) }],
        elements,
      });
      await fs.writeFile(path.join(folder, `${name}.yaml`), text);
    };
    for (const [i, variant] of variants.entries()) {
      const rule = viewRuleOf(context, { kind: "variant", variant });
      await write(
        `v${String(i)}-new`,
        "2026-11-09T10:00:00Z",
        variant,
        cores.filter((e) => rule.includes(e)),
      );
      const older = variant === a ? OLDER_OF_A : 1;
      for (let n = 0; n < older; n += 1) {
        await write(`v${String(i)}-old-${String(n)}`, "2026-11-02T10:00:00Z", variant, []);
      }
    }
  }, 900_000);

  afterAll(async () => {
    await Promise.all(opened.map((w) => w.close()));
    await fixture?.cleanup();
    await fs.rm(cacheFolder, { recursive: true, force: true });
  });

  it("lists the hints of one variant with the baseline files not read yet within 1 s", async () => {
    const { context } = await loaded();
    const { result, measurement } = await measure(
      "hint.list --variant A: since-baseline part, 118 baseline headers, the newest of A in full",
      () => sinceBaselineProblems(context, [a]),
      { basis: BASIS, thresholdMs: LIST_MS },
    );
    expect(result).toHaveLength(CHANGED_IN_A);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(LIST_MS);
  });

  it("gives the since-baseline part of workspace.check for every variant within 10 s", async () => {
    const { context } = await loaded();
    const { result, measurement } = await measure(
      "workspace.check: since-baseline part, 50 variants with a newest baseline in full",
      () => sinceBaselineProblems(context),
      { basis: BASIS, thresholdMs: CHECK_MS },
    );
    expect(result).toHaveLength(CHANGED_IN_A);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(CHECK_MS);
  });

  it("shows variant A with 5,000 since-baseline hints in a running server within 200 ms (SR-082 AK3)", async () => {
    const { workspace } = await loaded();
    const get = async (): Promise<CommandOutput<"element.get">> =>
      (await invoke("element.get", { ref: a.id }, { workspace })) as CommandOutput<"element.get">;
    await get();
    const { result, measurement } = await measure("element.get of A, files kept", get, {
      basis: BASIS,
      thresholdMs: GET_MS,
    });
    expect(
      result.element.problems?.filter((p) => p.code === "variant.core-changed-since-baseline"),
    ).toHaveLength(CHANGED_IN_A);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(GET_MS);
  });

  it("keeps element.get of A within 200 ms after a save elsewhere, and saves A at most 75 ms slower than a variant without a baseline", async () => {
    const { workspace, context } = await loaded();
    const [other] = context.store.elements.filter((e) => e.type === "variant").slice(WITH_BASELINE) as [
      ElementRecord,
    ];
    const get = async (): Promise<CommandOutput<"element.get">> =>
      (await invoke("element.get", { ref: a.id }, { workspace })) as CommandOutput<"element.get">;
    await get();
    await invoke("element.update", { ref: elsewhere.id, title: "Saved elsewhere" }, { workspace });
    const { result, measurement } = await measure("element.get of A after one changed file", get, {
      basis: BASIS,
      thresholdMs: GET_MS,
    });
    expect(
      result.element.problems?.filter((p) => p.code === "variant.core-changed-since-baseline"),
    ).toHaveLength(CHANGED_IN_A);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(GET_MS);
    // A save of any variant here takes some 150 ms without these hints (the store, the view rules);
    // the bound is on what A's baseline adds: its hints carried over and shown again.
    let n = 0;
    const save = (ref: string) => async (): Promise<unknown> => {
      n += 1;
      return invoke("element.update", { ref, title: `Saved ${String(n)}` }, { workspace });
    };
    const plain = await measureMedian(
      "element.update of a variant without a baseline (title)",
      save(other.id),
      {
        basis: BASIS,
        runs: SAVES,
      },
    );
    const saved = await measureMedian("element.update of A (title)", save(a.id), {
      basis: BASIS,
      thresholdMs: plain.measurement.ms + SAVE_EXTRA_MS,
      runs: SAVES,
    });
    expect(saved.measurement.ms, thresholdMessage(saved.measurement)).toBeLessThanOrEqual(
      plain.measurement.ms + SAVE_EXTRA_MS,
    );
  });

  it("lists the hints of a core requirement or a type without computing these hints (SR-026)", async () => {
    const { workspace } = await loaded();
    const list = async (input: Record<string, unknown>): Promise<CommandOutput<"hint.list">> =>
      (await invoke("hint.list", input, { workspace })) as CommandOutput<"hint.list">;
    // States and outdated relations first, as a running server has them.
    await list({ kind: ["relation.outdated"] });
    const own = await measure(
      "hint.list --ref <core requirement>, baselines present",
      () => list({ ref: core.id }),
      {
        basis: "SR-026 AK3, SR-103",
        thresholdMs: GET_MS,
      },
    );
    expect(own.measurement.ms, thresholdMessage(own.measurement)).toBeLessThanOrEqual(GET_MS);
    const typed = await measure(
      `hint.list --type ${core.type}, baselines present`,
      () => list({ type: [core.type] }),
      { basis: "SR-026 AK2, SR-103", thresholdMs: TYPE_MS },
    );
    expect(typed.measurement.ms, thresholdMessage(typed.measurement)).toBeLessThanOrEqual(TYPE_MS);
  });
});
