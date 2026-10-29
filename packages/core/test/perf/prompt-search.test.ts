// SR-108 AK5 in the performance suite (ADR-0011): "Gegeben 50.000 Elemente, wenn ein Zeichen getippt
// wird, dann sind die Treffer nach höchstens 100 ms aktualisiert."
//
// Measured on exactly the search that the app's command prompt sends for each key it gets (#404): the
// `element.search` of `findElements` (packages/app/src/renderer/actions.ts), with the typed text so far,
// `fields: ["id", "title"]` and `limit: 20`, and the same with `selection.where.type` as the argument
// step "target" of a relation sends it (the path that the summary of `relation.options` prescribes for
// SR-067). A warm server as in search-speed.test.ts (SR-098): the command runtime, the model and the
// search index are ready. Every prefix of a typed word or phrase is one search; each runs `RUNS` times
// and its median must stay within 100 ms: every prefix has its own row and threshold, so the slowest
// decides.
//
// Assumption (as in #388 for SR-098): what is measured is core, the time from the call to the answer.
// IPC between the app's windows and rendering the hits are not measured; neither is the fuzzy ranking
// of the app, which works on at most 20 hits.
import type { GeneratedWorkspace, LargeFixtureWorkspace } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measureMedian,
  recordValue,
  thresholdMessage,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { metamodelState, relationOptions } from "../../src/metamodel/index.js";
import type { ElementRecord } from "../../src/model/index.js";
import { elementStoreState } from "../../src/model/index.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-108 AK5. */
const PROMPT_MS = 100;
/** Runs per prefix; the median counts. */
const RUNS = 7;

type Search = CommandOutput<"element.search">;

/**
 * Words and a phrase of the generated titles ("Show wind speed on the display 123"), typed letter by letter.
 * A query word of one letter matches nothing (element.search), so the first key is a cheap search.
 */
const TYPED = ["temperature", "wind speed", "report humidity in the log"];

/** Every prefix of `text` from one character, as the prompt sees them while it is typed. */
const prefixes = (text: string): string[] =>
  Array.from({ length: text.length }, (_, at) => text.slice(0, at + 1)).filter(
    (prefix) => prefix.trim() === prefix,
  );

/**
 * The hardest restriction a "target" step can send: the restricted search builds the set of every
 * selected element per search (search-index.ts, `within`), so its cost grows with the selection. Of
 * the target types of every relation kind from every type of the metamodel (`relationOptions`, as
 * `relation.options` offers them), and of every single type, the one that covers the most elements
 * without covering all of them (all of them is the unrestricted search, measured on its own).
 */
const largestRestriction = (
  metamodel: Metamodel,
  elements: readonly Pick<ElementRecord, "type">[],
): readonly string[] => {
  const counts = new Map<string, number>();
  for (const record of elements) {
    counts.set(record.type, (counts.get(record.type) ?? 0) + 1);
  }
  const candidates: (readonly string[])[] = metamodel.effectiveTypes.flatMap((type) => [
    [type.key],
    ...relationOptions(metamodel, type.key).map((option) => option.targetTypes),
  ]);
  let best: { readonly types: readonly string[]; readonly covered: number } | undefined;
  for (const candidate of candidates) {
    const covered = candidate.reduce((sum, key) => sum + (counts.get(key) ?? 0), 0);
    if (covered < elements.length && covered > (best?.covered ?? 0)) {
      best = { types: candidate, covered };
    }
  }
  if (best === undefined) {
    throw new Error("no restriction that leaves elements out");
  }
  return best.types;
};

describe("the command prompt's search with 50,000 elements (SR-108 AK5, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  /** The restriction of the "target" step that is measured: see `largestRestriction`. */
  let types: readonly string[];

  beforeAll(async () => {
    tree = generateLargeWorkspace({
      version: versionOf(await standardModel()),
      elements: ELEMENTS,
      relations: RELATIONS,
    });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    // As a server starts (SR-082): the command runtime, the model, then the search index.
    getCommandRuntime();
    await warmWorkspace(workspace, 0);
    const store = await workspace.get(elementStoreState);
    expect(store.elements).toHaveLength(ELEMENTS);
    types = largestRestriction(await workspace.get(metamodelState), store.elements);
    // A search to make sure the index is ready before the first measured one (a warm server).
    await invoke("element.search", { query: "th", fields: ["id", "title"], limit: 20 }, { workspace });
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  /** What `findElements` sends, plus the selection of a "target" step when `where` is given. */
  const promptSearch = async (query: string, types?: readonly string[]): Promise<Search> => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    const input: Readonly<Record<string, unknown>> = {
      query,
      fields: ["id", "title"],
      limit: 20,
      ...(types === undefined ? {} : { selection: { where: { type: [...types] } } }),
    };
    return (await invoke("element.search", input, { workspace })) as Search;
  };

  const measureEveryPrefix = async (label: string, types: readonly string[] | undefined): Promise<void> => {
    const measurements = [];
    const singles: number[] = [];
    for (const word of TYPED) {
      for (const prefix of prefixes(word)) {
        const { result, measurement, times } = await measureMedian(
          `prompt search ${label}: typing ${JSON.stringify(word)}, after ${JSON.stringify(prefix)}, 20 hits`,
          () => promptSearch(prefix, types),
          {
            basis: `SR-108 AK5 (element.search as the command prompt sends it, ${label}; warm server; median of ${String(RUNS)} runs)`,
            thresholdMs: PROMPT_MS,
            runs: RUNS,
          },
        );
        if (prefix === word) {
          expect(result.total, `${label} ${prefix}`).toBeGreaterThan(0);
        }
        expect(result.hits.length, prefix).toBeLessThanOrEqual(20);
        measurements.push(measurement);
        singles.push(...times);
      }
    }
    await recordValue(
      `prompt search ${label}: slowest single run of ${String(singles.length)}`,
      Math.max(...singles),
      {
        basis: "SR-108 AK5 (recorded: single runs include GC and scheduler pauses)",
      },
    );
    for (const measurement of measurements) {
      expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(PROMPT_MS);
    }
  };

  it("[SR-108/AK5] updates the hits of every typed character within 100 ms (median of 7 runs)", async () => {
    await measureEveryPrefix("(id and title, 20 hits)", undefined);
  });

  it("[SR-108/AK5] updates the hits of a target step, limited to the allowed types, within 100 ms (median of 7 runs)", async () => {
    const all = await promptSearch("wind");
    const limited = await promptSearch("wind", types);
    expect(limited.total).toBeGreaterThan(0);
    expect(limited.total).toBeLessThan(all.total);
    await measureEveryPrefix(`(selection.where.type: ${types.join(", ")})`, types);
  });
});
