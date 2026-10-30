// Separate working copies of one repository (SR-081 AK3): two clones create 100 elements each, the test
// merges them with Git (never ReqSeq, D-036), and the check finds no duplicate IDs (SR-088) and nothing
// that a cache kept from before the merge.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { cloneFixtureWorkspace, createFixtureWorkspace, untilWatching } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { duplicateIdProblemsState } from "./duplicates.js";
import { RACY_MS } from "./model-cache.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import { watchWorkspace } from "./watch.js";

/** New elements per copy (SR-081 AK3). */
const PER_COPY = 100;

/** The fixture repository holds one element. */
const FIXTURE_ELEMENTS = 1;

/** Bound of SR-007 AK2 for a pull: the watcher shows it within 10 s. */
const PULL_LIMIT_MS = 10_000;

/** A Git repository with the fixture and one clone of it per copy, removed after the test. */
const copies = async (
  count: number,
): Promise<{ readonly origin: FixtureWorkspace; readonly clones: readonly FixtureWorkspace[] }> => {
  const origin = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
  onTestFinished(() => origin.cleanup());
  const clones: FixtureWorkspace[] = [];
  for (let i = 0; i < count; i++) {
    const clone = await cloneFixtureWorkspace(origin);
    onTestFinished(() => clone.cleanup());
    clones.push(clone);
  }
  return { origin, clones };
};

/** A workspace on the copy, closed (with its watcher) before the copy is removed. */
const open = (copy: FixtureWorkspace, cacheFolder?: string): Workspace => {
  const workspace = new Workspace(copy.root, cacheFolder === undefined ? {} : { cacheFolder });
  onTestFinished(() => workspace.close());
  return workspace;
};

/** Creates `count` needs one after the other, as an agent would, and commits them; returns their UUIDs. */
const createNeeds = async (copy: FixtureWorkspace, label: string, count: number): Promise<string[]> => {
  const workspace = new Workspace(copy.root);
  const ids: string[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const output = (await invoke(
        "element.create",
        { type: "need", title: `${label} need ${String(i + 1)}`, folder: "needs" },
        { workspace },
      )) as CommandOutput<"element.create">;
      ids.push(output.element.id);
    }
  } finally {
    await workspace.close();
  }
  await copy.commit(".", `${String(count)} needs from ${label}`);
  return ids;
};

/** Merges the main branch of `from` into `into` with Git, as a person does after a pull. */
const merge = async (into: FixtureWorkspace, from: FixtureWorkspace): Promise<void> => {
  await into.git(["fetch", "--quiet", from.root, "main"]);
  await into.git(["merge", "--quiet", "--no-edit", "FETCH_HEAD"]);
};

/** UUID, file and content hash of every element, in store order. */
const elementsOf = (store: ElementStore): readonly (readonly [string, string, string])[] =>
  store.elements.map((e) => [e.id, `${e.repository}/${e.file}`, e.snapshot.sha256] as const);

/** The findings of the whole workspace: what `workspace.check` reports (SR-019). */
const findings = async (workspace: Workspace): Promise<readonly Problem[]> =>
  ((await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">).problems;

/** Polls `condition` every 10 ms until it holds; fails after `limitMs`. */
const within = async (limitMs: number, condition: () => Promise<boolean>): Promise<void> => {
  const deadline = performance.now() + limitMs;
  while (!(await condition())) {
    if (performance.now() > deadline) {
      throw new Error(`condition not met within ${String(limitMs)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/**
 * Every file below `folder`, without descending into `.git`: Git may change it meanwhile (a `gc
 * --auto` after a commit removes folders of `.git/objects`), and a recursive `readdir` that walks
 * into it fails with ENOENT (#434).
 */
const filesOutsideGit = async (folder: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory() && entry.name !== ".git") {
      files.push(...(await filesOutsideGit(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
};

// 200 writes and a few Git calls: several seconds on slow CI machines (Windows).
describe("separate copies merged with Git (SR-081)", { timeout: 60_000 }, () => {
  it("[SR-081/AK3] two copies create 100 elements each; after a Git merge the check finds no duplicate IDs", async () => {
    const { origin, clones } = await copies(2);
    const [a, b] = clones as [FixtureWorkspace, FixtureWorkspace];
    // Both copies work at the same time, each on its own files.
    const [idsA, idsB] = await Promise.all([createNeeds(a, "A", PER_COPY), createNeeds(b, "B", PER_COPY)]);

    await merge(a, b);
    // Every element has its own file (named from its UUID, D-056): Git merges without a conflict,
    // and ReqSeq left nothing in the working tree (its caches lie outside the copy, AK2).
    expect(await a.git(["status", "--porcelain"])).toBe("");

    const workspace = open(a);
    const store = await workspace.get(elementStoreState);
    expect(store.elements).toHaveLength(FIXTURE_ELEMENTS + 2 * PER_COPY);
    expect(new Set([...idsA, ...idsB]).size).toBe(2 * PER_COPY);
    for (const id of [...idsA, ...idsB]) {
      expect(store.byId.get(id), id).toHaveLength(1);
    }
    // No UUID is in two files (SR-088), and no short ID names two elements (SR-084).
    expect(await workspace.get(duplicateIdProblemsState)).toEqual([]);
    const shortIds = await workspace.get(shortIdState);
    expect(new Set(store.elements.map((e) => shortIds.of(e))).size).toBe(store.elements.length);
    // The 200 new needs add no finding: the check finds what it finds in the fixture alone (two
    // warnings of its system requirement).
    expect(await findings(workspace)).toEqual(await findings(open(origin)));
  });

  it("[SR-081/AK3] a copy kept open across the merge finds the same as a fresh read: no findings from caches", async () => {
    const [a, b] = (await copies(2)).clones as [FixtureWorkspace, FixtureWorkspace];
    await Promise.all([createNeeds(a, "A", PER_COPY), createNeeds(b, "B", PER_COPY)]);

    // A runs on, as the API or the MCP server does: its store and the findings built on it are kept in
    // memory, and the watcher keeps them current (SR-007).
    const running = open(a);
    expect(await running.get(elementStoreState)).toMatchObject({
      elements: { length: FIXTURE_ELEMENTS + PER_COPY },
    });
    expect(await running.get(duplicateIdProblemsState)).toEqual([]);
    await watchWorkspace(running).ready;
    await untilWatching({
      probe: (attempt) => a.write("probe.md", `# Probe ${String(attempt)}\n`),
      seen: async () => (await running.get(elementStoreState)).nonElements.some((f) => f.file === "probe.md"),
    });
    await a.git(["clean", "--quiet", "--force", "--", "probe.md"]);

    await merge(a, b);
    await within(PULL_LIMIT_MS, async () => {
      const store = await running.get(elementStoreState);
      return store.elements.length === FIXTURE_ELEMENTS + 2 * PER_COPY && store.nonElements.length === 0;
    });
    await watchWorkspace(running).settled();

    const fresh = open(a);
    const [kept, read] = await Promise.all([running.get(elementStoreState), fresh.get(elementStoreState)]);
    expect(elementsOf(kept)).toEqual(elementsOf(read));
    expect(await findings(running)).toEqual(await findings(fresh));
    expect(await running.get(duplicateIdProblemsState)).toEqual([]);
  });

  it("[SR-081/AK3] a copy that starts again with its model cache after the merge finds the same as a fresh read", async () => {
    const [a, b] = (await copies(2)).clones as [FixtureWorkspace, FixtureWorkspace];
    await Promise.all([createNeeds(a, "A", PER_COPY), createNeeds(b, "B", PER_COPY)]);
    const cache = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-081-model-cache-"));
    onTestFinished(() => fs.rm(cache, { recursive: true, force: true }));
    // The files of A are older than the racy window of the cache (ADR-0008), as after a while of work.
    const when = new Date(Date.now() - 60_000);
    for (const file of await filesOutsideGit(a.root)) {
      await fs.utimes(file, when, when);
    }
    // Their change times (set by utimes) must settle too before the cache takes them.
    await new Promise((resolve) => setTimeout(resolve, RACY_MS + 100));
    const before = new Workspace(a.root, { cacheFolder: cache });
    expect((await before.get(elementStoreState)).elements).toHaveLength(FIXTURE_ELEMENTS + PER_COPY);
    await before.close();

    await merge(a, b);
    const cached = open(a, cache);
    const fresh = open(a);
    const [kept, read] = await Promise.all([cached.get(elementStoreState), fresh.get(elementStoreState)]);
    expect(kept.elements).toHaveLength(FIXTURE_ELEMENTS + 2 * PER_COPY);
    expect(kept).toStrictEqual(read);
    expect(await findings(cached)).toEqual(await findings(fresh));
    expect(await cached.get(duplicateIdProblemsState)).toEqual([]);
  });
});
