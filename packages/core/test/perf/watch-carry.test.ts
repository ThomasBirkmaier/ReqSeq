// The carry of one changed file in a long-running process (#215) in the performance suite (ADR-0011)
// on the generated workspace of N-036 (50,000 elements, 200,000 relations): a server workspace warmed
// as the app keeps it (model, incoming index, search index, findings of `workspace.check`, the
// verification status, the outdated hints and the current versions) and its watcher. For each kind of
// change (an edit, an atomic save as editors make it, a new file, a deleted file, a moved file, an
// edit of the file whose targets have the longest incoming lists) it records the time from the write
// of the file until `onChange`, until `element.get` of the changed element has answered after it (the
// path of SR-117 AK1), and until every carried state has settled, each as median, p90 and maximum, and
// the CPU the process spent meanwhile. Per carry hook it records the part that blocks inside
// `Workspace.replace` and the time until its value settled. Recorded only (baseline of #215); the
// threshold of 150 ms on the `element.get` row follows with the last change of #215.
import type { GeneratedWorkspace, LargeFixtureWorkspace } from "@reqseq/testkit";
import { generateLargeWorkspace, recordValue, untilWatching, writeLargeWorkspace } from "@reqseq/testkit";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verificationState } from "../../src/evidence/verification.js";
import { outdatedRelationsState } from "../../src/hints/outdated.js";
import { STANDARD_MODEL_TEXT, metamodelState } from "../../src/metamodel/index.js";
import { currentVersions, currentVersionsState } from "../../src/model/current-versions.js";
import { duplicateIdProblemsState } from "../../src/model/duplicates.js";
import { duplicateIdentifierProblemsState } from "../../src/model/identifiers.js";
import { incomingFor, incomingState } from "../../src/model/incoming.js";
import { relationLimitProblemsState } from "../../src/model/relation-limits.js";
import { relationTypeProblemsState } from "../../src/model/relation-types.js";
import { requiredProblemsState } from "../../src/model/required.js";
import { shortIdState } from "../../src/model/short-id.js";
import { statementProblemsState } from "../../src/model/statement-findings.js";
import { statusProblemsState } from "../../src/model/status-findings.js";
import type { RepositoryChanges } from "../../src/model/store.js";
import { elementStoreState, storeUpdate, updateElements } from "../../src/model/store.js";
import { unknownProblemsState } from "../../src/model/unknown.js";
import { valueKindProblemsState } from "../../src/model/values.js";
import type { WorkspaceWatcher } from "../../src/model/watch.js";
import { watchWorkspace } from "../../src/model/watch.js";
import { searchIndexState, searchIndex } from "../../src/query/search-state.js";
import { invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import type { StateChange, WorkspaceState } from "../../src/runtime/workspace.js";
import { Workspace } from "../../src/runtime/workspace.js";
import type { WorkspaceLayout } from "../../src/workspace/index.js";
import { availableRepositories, workspaceLayoutState } from "../../src/workspace/index.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
const basis = "SR-117 AK1, SR-007, N-036 (#215; recorded, baseline)";
/** Changes of each kind; the first `WARM_UP` edits are not counted (JIT). */
const RUNS = 20;
const WARM_UP = 2;

/** The states with a `carry` hook over a change of the store that a server or the app keeps. */
const CARRIED: readonly WorkspaceState<unknown>[] = [
  incomingState,
  shortIdState,
  searchIndexState,
  currentVersionsState,
  verificationState,
  outdatedRelationsState,
  duplicateIdProblemsState,
  duplicateIdentifierProblemsState,
  relationTypeProblemsState,
  relationLimitProblemsState,
  requiredProblemsState,
  statementProblemsState,
  statusProblemsState,
  unknownProblemsState,
  valueKindProblemsState,
];

/** What the carry hooks of one store change cost: per hook, the blocking part and when its value settled. */
interface HookTimes {
  readonly blocking: Map<string, number>;
  readonly settled: Map<string, Promise<number>>;
}

/** The hook times of the store change that runs now; set by a scenario before it writes a file. */
let current: HookTimes | undefined;

/**
 * Wraps the `carry` hook of each state so that a store change records its cost (`current`): the
 * synchronous part, which blocks `Workspace.replace`, and the time from the call until the value it
 * gives settled. The hooks themselves are not changed.
 */
const instrument = (): (() => void) => {
  const restore: (() => void)[] = [];
  for (const state of CARRIED) {
    // Bound: the hooks are arrow functions, so the bound one is the same hook.
    const carry = state.carry?.bind(state);
    if (carry === undefined) {
      throw new Error(`${state.name} has no carry hook`);
    }
    state.carry = (value: unknown, change: StateChange, workspace: Workspace): unknown => {
      const times = change.key === elementStoreState ? current : undefined;
      const started = performance.now();
      const next = carry(value, change, workspace);
      const blocked = performance.now() - started;
      if (times !== undefined) {
        times.blocking.set(state.name, blocked);
        times.settled.set(
          state.name,
          Promise.resolve(next).then(
            () => performance.now() - started,
            () => performance.now() - started,
          ),
        );
      }
      return next;
    };
    restore.push(() => {
      state.carry = carry;
    });
  }
  return () => {
    for (const undo of restore) {
      undo();
    }
  };
};

const stats = (values: readonly number[]): { median: number; p90: number; max: number } => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    Number(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  return { median: at(0.5), p90: at(0.9), max: Number(sorted[sorted.length - 1]) };
};

/** Records median, p90 and maximum of `values` as three rows. */
const recordStats = async (name: string, values: readonly number[]): Promise<void> => {
  const { median, p90, max } = stats(values);
  await recordValue(`${name} (median)`, median, { basis });
  await recordValue(`${name} (p90)`, p90, { basis });
  await recordValue(`${name} (max)`, max, { basis });
};

/** One change of files, as a scenario makes it: what to write, and which element to read after it. */
interface Change {
  /** Changes the files. */
  readonly apply: () => Promise<void>;
  /** The UUID that `element.get` reads once the change is in place. */
  readonly read: string;
}

describe("the carry of one changed file in a server (N-036, #215)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace;
  let workspace: Workspace;
  let layout: WorkspaceLayout;
  let watcher: WorkspaceWatcher;
  let undo: () => void;
  /** Files used once: an element is changed by at most one scenario. */
  let next = 0;

  const folderOf = (repository: string): string => {
    const found = availableRepositories(layout).find((r) => r.name === repository);
    if (found === undefined) {
      throw new Error(`no repository ${repository}`);
    }
    return found.folder;
  };
  const absolute = (repository: string, file: string): string =>
    path.join(folderOf(repository), ...file.split("/"));
  /** A system requirement not used by another change yet. */
  const fresh = (): { readonly id: string; readonly repository: string; readonly file: string } => {
    const requirements = tree.elements.filter((e) => e.type === "system-requirement");
    const element = requirements[next++ % requirements.length];
    if (element === undefined) {
      throw new Error("no system requirement");
    }
    return element;
  };

  /**
   * Builds what the app keeps (search index, findings, verification status, outdated hints, current
   * versions); again before each change, since a hook may reset its state (a new UUID resets the
   * outdated hints) and the app builds it again on its next use.
   */
  const warm = async (): Promise<void> => {
    await searchIndex(workspace);
    await invoke("workspace.check", {}, { workspace });
    await invoke("evidence.status", { limit: 1 }, { workspace });
    await invoke("hint.list", {}, { workspace });
    await currentVersions(workspace);
    for (const state of CARRIED) {
      expect(workspace.peek(state), `${state.name} is warmed`).toBeDefined();
    }
  };

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    tree = generateLargeWorkspace({
      version,
      elements: ELEMENTS,
      relations: RELATIONS,
      metamodel: STANDARD_MODEL_TEXT,
    });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    layout = await workspace.get(workspaceLayoutState);
    // Warmed as the app keeps it: model and incoming index, search index, findings, verification
    // status, outdated hints, current versions; then the watcher.
    await warmWorkspace(workspace, 0);
    await warm();
    watcher = watchWorkspace(workspace);
    await watcher.ready;
    const main = availableRepositories(layout)[0]?.folder ?? "";
    await untilWatching({
      probe: (attempt) => fs.writeFile(path.join(main, "probe.md"), `# Probe ${String(attempt)}\n`),
      seen: async () =>
        (await workspace.get(elementStoreState)).nonElements.some((f) => f.file === "probe.md"),
    });
    await watcher.settled();
    undo = instrument();
  }, 900_000);

  afterAll(async () => {
    undo();
    await workspace.close();
    await fixture.cleanup();
  });

  /**
   * Makes `count` changes of one kind, one after the other, and records per change: write →
   * `onChange`, write → `onChange` → `element.get` answered, write → every carried state settled,
   * and the CPU of the process from the write until then. Gives the hook times of each change.
   */
  const scenario = async (
    label: string,
    count: number,
    make: () => Change,
    warmUp = 0,
  ): Promise<HookTimes[]> => {
    const onChange: number[] = [];
    const read: number[] = [];
    const settled: number[] = [];
    const cpu: number[] = [];
    const hooks: HookTimes[] = [];
    for (let run = 0; run < count + warmUp; run++) {
      await warm();
      await watcher.settled();
      const change = make();
      const times: HookTimes = { blocking: new Map(), settled: new Map() };
      current = times;
      const heard = new Promise<void>((resolve) => {
        const off = watcher.onChange(() => {
          off();
          resolve();
        });
      });
      const cpuBefore = process.cpuUsage();
      const started = performance.now();
      await change.apply();
      await heard;
      const changed = performance.now() - started;
      await invoke("element.get", { ref: change.read }, { workspace });
      const answered = performance.now() - started;
      await Promise.all(times.settled.values());
      await watcher.settled();
      const done = performance.now() - started;
      const used = process.cpuUsage(cpuBefore);
      current = undefined;
      // The carry ran: every warmed state has a hook time.
      expect([...times.blocking.keys()].sort(), `${label}: hooks`).toEqual(CARRIED.map((s) => s.name).sort());
      if (run >= warmUp) {
        onChange.push(changed);
        read.push(answered);
        settled.push(done);
        cpu.push((used.user + used.system) / 1000);
        hooks.push(times);
      }
    }
    await recordStats(`watcher: file write → onChange, ${label} (N-036)`, onChange);
    await recordStats(`watcher: file write → onChange → element.get, ${label} (N-036)`, read);
    await recordStats(`watcher: file write → every carried state settled, ${label} (N-036)`, settled);
    await recordStats(`watcher: CPU of the process from the write until settled, ${label} (N-036)`, cpu);
    return hooks;
  };

  /** An element file as the generator wrote it, with one more line of text. */
  const edited = async (repository: string, file: string): Promise<string> =>
    `${await fs.readFile(absolute(repository, file), "utf8")}\nOne more line.\n`;

  it("records an edit of one element file, and what each carry hook costs", async () => {
    const hooks = await scenario(
      "one element file edited",
      RUNS,
      () => {
        const { id, repository, file } = fresh();
        return {
          read: id,
          apply: async () => fs.writeFile(absolute(repository, file), await edited(repository, file)),
        };
      },
      WARM_UP,
    );
    for (const name of CARRIED.map((s) => s.name)) {
      await recordStats(
        `carry hook ${name}, one element file edited: blocking part`,
        hooks.map((h) => Number(h.blocking.get(name))),
      );
      const after = await Promise.all(hooks.map((h) => h.settled.get(name) ?? Promise.resolve(0)));
      await recordValue(
        `carry hook ${name}, one element file edited: settled after (median)`,
        stats(after).median,
        {
          basis,
        },
      );
    }
  });

  it("records an atomic save, a new, a deleted and a moved file", async () => {
    await scenario("an atomic save (a new file renamed over it)", RUNS, () => {
      const { id, repository, file } = fresh();
      return {
        read: id,
        apply: async () => {
          const target = absolute(repository, file);
          await fs.writeFile(`${target}.swp`, await edited(repository, file));
          await fs.rename(`${target}.swp`, target);
        },
      };
    });
    await scenario("one new element file", RUNS, () => {
      const { repository, file } = fresh();
      const id = randomUUID();
      return {
        read: id,
        apply: async () => {
          const text = await fs.readFile(absolute(repository, file), "utf8");
          const copy = text.replace(/^id: .*$/mu, `id: ${id}`);
          await fs.writeFile(absolute(repository, `${path.posix.dirname(file)}/new-${id}.md`), copy);
        },
      };
    });
    await scenario("one element file deleted", RUNS, () => {
      const gone = fresh();
      // The deleted element cannot be read: its first target's element is read instead.
      const other = fresh();
      return { read: other.id, apply: () => fs.rm(absolute(gone.repository, gone.file)) };
    });
    await scenario("one element file moved to another folder", RUNS, () => {
      const { id, repository, file } = fresh();
      return {
        read: id,
        apply: async () => {
          const folder = path.join(folderOf(repository), "moved");
          await fs.mkdir(folder, { recursive: true });
          await fs.rename(absolute(repository, file), path.join(folder, path.posix.basename(file)));
        },
      };
    });
  });

  it("records an edit of the file whose targets have the longest incoming lists", async () => {
    const store = await workspace.get(elementStoreState);
    const index = incomingFor(workspace, store, await workspace.get(metamodelState));
    // The sources of the target with the longest list (a hub every element names), one per change.
    const hub = [...index.relationsById.values()].reduce((a, b) => (b.length > a.length ? b : a));
    const sources = [...new Set(hub.map((link) => link.source))].slice(0, RUNS);
    let at = 0;
    await scenario("an edit of a file whose target has the longest incoming list", sources.length, () => {
      const source = sources[at++];
      if (source === undefined) {
        throw new Error("too few sources");
      }
      return {
        read: source.id,
        apply: async () =>
          fs.writeFile(
            absolute(source.repository, source.file),
            await edited(source.repository, source.file),
          ),
      };
    });
  });

  it("records the store steps of one edited file on their own", async () => {
    const update: number[] = [];
    const diff: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const { repository, file } = fresh();
      const store = await workspace.get(elementStoreState);
      // The watcher applies the edit first, so that it does not run alongside the timed steps; they
      // then compute the same update again from the store before it, which is not installed.
      const heard = new Promise<void>((resolve) => {
        const off = watcher.onChange(() => {
          off();
          resolve();
        });
      });
      await fs.writeFile(absolute(repository, file), await edited(repository, file));
      await heard;
      await watcher.settled();
      const changes = new Map<string, RepositoryChanges>([[repository, { paths: [file] }]]);
      let started = performance.now();
      const after = await updateElements(store, layout, changes);
      update.push(performance.now() - started);
      if (after === undefined) {
        throw new Error("the edit changed nothing");
      }
      started = performance.now();
      expect(storeUpdate(store, after)?.files.get(repository)?.has(file)).toBe(true);
      diff.push(performance.now() - started);
    }
    await recordStats("one element file edited, on its own: updateElements (N-036)", update);
    await recordStats("one element file edited, on its own: storeUpdate (N-036)", diff);
  });
});
