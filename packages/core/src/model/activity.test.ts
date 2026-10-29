import { createHash } from "node:crypto";
import dgram from "node:dgram";
import type * as NodeFs from "node:fs";
import type { FSWatcher } from "node:fs";
import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { ActivityAccess, ActivityFile } from "../generated/types.js";
import { loadContracts } from "../runtime/contracts.js";
import type { InvokeContext } from "../runtime/invoke.js";
import { invoke } from "../runtime/invoke.js";
import type * as Settled from "../runtime/settled.js";
import { settledValue } from "../runtime/settled.js";
import { Workspace } from "../runtime/workspace.js";
import * as WorkspaceBlock from "../workspace/index.js";
import type { ActivityWatch, ActivityWatchOptions, NotedAccess } from "./activity.js";
import {
  ACTIVITY_FILE,
  ACTIVITY_WRITE_MS,
  FOLLOWED_ACCESSES,
  accessSubject,
  lastAccess,
  noteAccess,
  readActivity,
  recordAccess,
  watchActivity,
} from "./activity.js";
import { elementStoreState } from "./store.js";
import { watchWorkspace } from "./watch.js";

// The real `watch`, wrapped so that a test can make the watch of the cache folder fail.
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof NodeFs>();
  return { ...original, watch: vi.fn(original.watch) };
});

// The real block, with `writeCacheFile` wrapped so that tests can count the writes of activity.json,
// and `readCacheFile` so that a test can hold a read back.
vi.mock("../workspace/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof WorkspaceBlock>();
  return {
    ...original,
    writeCacheFile: vi.fn(original.writeCacheFile),
    readCacheFile: vi.fn(original.readCacheFile),
  };
});

// The real one, wrapped so that a test can hold the look at the element store back.
vi.mock("../runtime/settled.js", async (importOriginal) => {
  const original = await importOriginal<typeof Settled>();
  return { settledValue: vi.fn(original.settledValue) };
});

const ONE: FixtureOptions = { fixture: "SR-004/one-repository" };
const ONE_ID = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const ONE_FILE = "requirements/SR-6328cee88fb3.md";
const IDENTIFIERS: FixtureOptions = { fixture: "enabler-305/identifiers" };
const SR_036 = "30500000-0000-4000-8000-0000000b0036";
const SR_037 = "30500000-0000-4000-8000-0000000b0037";
const HINTS: FixtureOptions = { fixture: "SR-026/hints" };

const tempFolder = async (): Promise<string> => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-activity-"));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }));
  return folder;
};

const fixture = async (options: FixtureOptions): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

/** A workspace on `root` with the cache folder `cache`, closed after the test. */
const open = (root: string, cache: string | undefined): Workspace => {
  const workspace = new Workspace(root, cache === undefined ? {} : { cacheFolder: cache });
  onTestFinished(() => workspace.close());
  return workspace;
};

interface Copy {
  readonly fixture: FixtureWorkspace;
  readonly cache: string;
  readonly workspace: Workspace;
}

const copy = async (options: FixtureOptions, root = ""): Promise<Copy> => {
  const created = await fixture(options);
  const cache = await tempFolder();
  return { fixture: created, cache, workspace: open(root === "" ? created.root : created.path(root), cache) };
};

const call = (
  workspace: Workspace,
  name: string,
  input: object,
  access?: InvokeContext["access"],
): Promise<unknown> => invoke(name, input, access === undefined ? { workspace } : { workspace, access });

/** The activity file after the workspace closed (closing writes the pending access). */
const recorded = async (opened: Copy): Promise<ActivityFile | undefined> => {
  await opened.workspace.close();
  const text = await WorkspaceBlock.readCacheFile(opened.cache, ACTIVITY_FILE);
  return text === undefined ? undefined : (JSON.parse(text) as ActivityFile);
};

const sha256Of = async (file: string): Promise<string> =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");

const writes = (): number =>
  vi.mocked(WorkspaceBlock.writeCacheFile).mock.calls.filter(([, name]) => name === ACTIVITY_FILE).length;

describe("recording the last API or MCP access (SR-117)", () => {
  it("[SR-117/AK1] an MCP or API read of one element writes it as the last access of the copy", async () => {
    const opened = await copy(ONE);
    await call(opened.workspace, "element.get", { ref: "SR-e88fb3" }, "mcp");
    const file = await recorded(opened);
    expect(file).toEqual({
      version: 1,
      process: expect.stringMatching(new RegExp(`^${String(process.pid)}-[0-9a-f]{8}$`)) as unknown,
      seq: 1,
      sha256: await sha256Of(opened.fixture.path(ONE_FILE)),
      access: {
        access: "mcp",
        command: "element.get",
        effect: "read",
        at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/) as unknown,
        element: { id: ONE_ID, repository: "system" },
      },
    });

    const api = await copy(ONE);
    await call(api.workspace, "trace.chain", { ref: ONE_ID.toUpperCase() }, "api");
    expect((await recorded(api))?.access).toMatchObject({ access: "api", command: "trace.chain" });
  });

  it("[SR-117/AK1] a read names the copy its repository picks when two repositories share the UUID", async () => {
    const opened = await copy({ fixture: "SR-004/three-repositories" }, "system");
    const source = opened.fixture.path("system/requirements/SR-4b4da63a2dd1.md");
    await fs.copyFile(source, opened.fixture.path("sensor/SR-4b4da63a2dd1.md"));
    const id = /^id: (.+)$/m.exec(await fs.readFile(source, "utf8"))?.[1] ?? "";
    await call(opened.workspace, "element.get", { ref: id, repository: "sensor" }, "mcp");
    expect((await recorded(opened))?.access.element).toEqual({ id, repository: "sensor" });

    // Without the repository the call fails (ref.ambiguous) and records nothing.
    const again = await copy({ fixture: "SR-004/three-repositories" }, "system");
    await fs.copyFile(
      again.fixture.path("system/requirements/SR-4b4da63a2dd1.md"),
      again.fixture.path("sensor/SR-4b4da63a2dd1.md"),
    );
    await expect(call(again.workspace, "element.get", { ref: id }, "mcp")).rejects.toThrow(CommandError);
    expect(await recorded(again)).toBeUndefined();
  });

  it("[SR-117/AK1] a change records its subject, else the one element it wrote", async () => {
    const update = await copy(IDENTIFIERS);
    await call(update.workspace, "element.update", { ref: "SR-037", title: "Show IDs" }, "mcp");
    expect((await recorded(update))?.access).toMatchObject({
      command: "element.update",
      effect: "write-files",
      element: { id: SR_037 },
    });
    expect((await readActivity(update.cache))?.sha256).toBe(
      await sha256Of(update.fixture.path("requirements/SR-0000000b0037.md")),
    );

    // The identifier it was called with names nothing after the run: the written element counts.
    const renamed = await copy(IDENTIFIERS);
    await call(renamed.workspace, "element.update", { ref: "SR-036", set: { "spec-id": "SR-136" } }, "mcp");
    expect((await recorded(renamed))?.access.element.id).toBe(SR_036);

    const relation = await copy(IDENTIFIERS);
    await call(
      relation.workspace,
      "relation.add",
      { source: "D-047", kind: "derives-from", target: "N-001" },
      "api",
    );
    expect((await recorded(relation))?.access).toMatchObject({
      command: "relation.add",
      element: { id: "30500000-0000-4000-8000-0000000c0047" },
    });

    const created = await copy(IDENTIFIERS);
    const output = (await call(
      created.workspace,
      "element.create",
      { type: "system-requirement", title: "Follow agents" },
      "mcp",
    )) as CommandOutput<"element.create">;
    expect((await recorded(created))?.access.element.id).toBe(output.element.id);

    const status = await copy(IDENTIFIERS);
    await call(status.workspace, "element.setStatus", { refs: ["SR-036"], status: "obsolete" }, "mcp");
    expect((await recorded(status))?.access.element.id).toBe(SR_036);

    const two = await copy(IDENTIFIERS);
    await call(two.workspace, "element.setStatus", { refs: ["SR-036", "SR-037"], status: "obsolete" }, "mcp");
    expect(await recorded(two)).toBeUndefined();
  });

  it("[SR-117/AK1] confirming a hint records the element whose file it wrote", async () => {
    const opened = await copy(HINTS);
    const { hints } = (await call(opened.workspace, "hint.list", {}, "mcp")) as CommandOutput<"hint.list">;
    const hint = hints.find((p) => p.hintId !== undefined);
    expect(hint).toBeDefined();
    await call(opened.workspace, "hint.confirm", { hintIds: [hint?.hintId] }, "mcp");
    expect((await recorded(opened))?.access).toMatchObject({
      command: "hint.confirm",
      element: { id: hint?.elementId },
    });
  });

  it("records nothing for the command line, the app, a call without access or without a cache folder", async () => {
    expect(FOLLOWED_ACCESSES).toEqual(["api", "mcp"]);
    for (const access of ["cli", "app", undefined] as const) {
      const opened = await copy(ONE);
      await call(opened.workspace, "element.get", { ref: "SR-e88fb3" }, access);
      expect([access, await recorded(opened)]).toEqual([access, undefined]);
    }
    const created = await fixture(ONE);
    const workspace = open(created.root, undefined);
    await call(workspace, "element.get", { ref: "SR-e88fb3" }, "mcp");
    expect(await noteAccess(workspace, mcpCall("element.get"), { ref: ONE_ID }, {})).toBeUndefined();
  });

  it("records nothing for a failed call, a read that names no one element, or a write of other files", async () => {
    const opened = await copy(ONE);
    await expect(call(opened.workspace, "element.get", { ref: "SR-000000" }, "mcp")).rejects.toThrow(
      CommandError,
    );
    await call(opened.workspace, "element.list", {}, "mcp");
    await call(opened.workspace, "element.search", { query: "wind" }, "mcp");
    await call(opened.workspace, "workspace.status", {}, "mcp");
    await call(opened.workspace, "workspace.activity", {}, "mcp");
    await call(opened.workspace, "filter.save", { name: "drafts", where: { status: ["draft"] } }, "mcp");
    expect(await recorded(opened)).toBeUndefined();
  });

  it("writes only into a cache folder outside every repository", async () => {
    const created = await fixture(ONE);
    const inside = created.path(".cache");
    const workspace = open(created.root, inside);
    await call(workspace, "element.get", { ref: "SR-e88fb3" }, "mcp");
    await workspace.close();
    expect(await WorkspaceBlock.readCacheFile(inside, ACTIVITY_FILE)).toBeUndefined();
  });

  it("takes no subject from an input without properties or required fields", () => {
    const entry = loadContracts().entry("element.get");
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      expect(accessSubject({ ...entry, input: { type: "object" } })).toEqual({
        ref: undefined,
        repository: undefined,
        written: false,
      });
    }
  });

  it("names the subject of every command of the product catalog from its entry alone", () => {
    const subjects = Object.fromEntries(
      loadContracts().commands.map((entry) => {
        const { ref, repository, written } = accessSubject(entry);
        const named = ref === undefined ? [] : [repository === undefined ? ref : `${ref} (${repository})`];
        const parts = [...named, ...(written ? ["written element"] : [])];
        return [entry.name, parts.length === 0 ? "none" : parts.join(", else ")];
      }),
    );
    // A new command shows its choice here (point 3 of the plan review). A repository argument only
    // picks among several records the reference names, so relation.remove's (the repository of the
    // targets) never moves its source to another element.
    expect(subjects).toEqual({
      "workspace.init": "written element",
      "workspace.status": "none",
      "workspace.check": "none",
      "workspace.activity": "none",
      "workspace.recent": "none",
      "metamodel.get": "none",
      "element.create": "written element",
      "element.get": "ref (repository)",
      "element.resolve": "ref (repository)",
      "element.list": "none",
      "element.facets": "none",
      "element.update": "ref (repository), else written element",
      "element.setStatus": "written element",
      "element.supersede": "ref, else written element",
      "element.bulkUpdate": "written element",
      "element.addAttachment": "ref, else written element",
      "relation.options": "ref",
      "relation.add": "source, else written element",
      "relation.remove": "source (repository), else written element",
      "trace.chain": "ref",
      "trace.related": "none",
      "trace.affected": "ref",
      "trace.neighbourhood": "ref (repository)",
      "trace.graph": "ref (repository)",
      "trace.matrix": "none",
      "hint.list": "none",
      "hint.confirm": "written element",
      "element.search": "none",
      "filter.list": "none",
      "filter.save": "written element",
      "evidence.list": "ref",
      "evidence.record": "ref, else written element",
      "evidence.enrichJunit": "written element",
      "evidence.status": "none",
      "evidence.coverage": "none",
      "evidence.degree": "none",
      "evidence.withoutPassedTest": "none",
      "data.export": "none",
      "data.store": "written element",
      "variant.diff": "variant",
      "variant.exclude": "variant, else written element",
      "baseline.create": "written element",
      "baseline.list": "none",
      "baseline.get": "none",
      "baseline.compare": "ref",
      "reqif.analyze": "none",
      "reqif.import": "written element",
      "reqif.saveMapping": "written element",
      "reqif.export": "written element",
    });
  });

  it("records a created element in another repository than the main one", async () => {
    const opened = await copy({ fixture: "SR-004/three-repositories" }, "system");
    const output = (await call(
      opened.workspace,
      "element.create",
      { type: "system-requirement", title: "Follow agents", repository: "sensor" },
      "mcp",
    )) as CommandOutput<"element.create">;
    expect((await recorded(opened))?.access.element).toEqual({ id: output.element.id, repository: "sensor" });
  });

  it("notes an element only from states that are built, and nothing once the workspace closes", async () => {
    const opened = await copy(ONE);
    const { workspace } = opened;
    await workspace.get(WorkspaceBlock.workspaceLayoutState);
    expect(await noteAccess(workspace, mcpCall("element.get"), { ref: ONE_ID }, {})).toBeUndefined();
    const store = workspace.get(elementStoreState);
    await store;
    // Without short IDs only a UUID resolves.
    expect(await noteAccess(workspace, mcpCall("element.get"), { ref: "SR-e88fb3" }, {})).toBeUndefined();
    expect(
      (await noteAccess(workspace, mcpCall("element.get"), { ref: ONE_ID }, {}))?.access.element.id,
    ).toBe(ONE_ID);
    const unknown = "e8df96ea-a168-4d90-8d65-000000000000";
    expect(await noteAccess(workspace, mcpCall("element.get"), { ref: unknown }, {})).toBeUndefined();
    await call(workspace, "element.get", { ref: "SR-e88fb3", repository: "system" }, "mcp");
    expect(
      (await noteAccess(workspace, mcpCall("element.get"), { ref: "SR-e88fb3", repository: "system" }, {}))
        ?.access.element.id,
    ).toBe(ONE_ID);
    // A store without what each file contributed tells no written element.
    const files = { files: [ONE_FILE] };
    expect((await noteAccess(workspace, mcpCall("element.setStatus"), {}, files))?.access.element.id).toBe(
      ONE_ID,
    );
    expect(await noteAccess(workspace, mcpCall("element.setStatus"), {}, {})).toBeUndefined();
    const { repositories: _repositories, ...bare } = await store;
    expect(await workspace.replace(elementStoreState, store, Promise.resolve(bare))).toBe(true);
    expect(await noteAccess(workspace, mcpCall("element.setStatus"), {}, files)).toBeUndefined();

    const noting = noteAccess(workspace, mcpCall("element.get"), { ref: ONE_ID }, {});
    const closing = workspace.close();
    expect(await noting).toBeUndefined();
    await closing;
  });

  it("writes a burst of accesses as at most one file per 100 ms, the latest last, and flushes on close", async () => {
    const opened = await copy(IDENTIFIERS);
    // The first read builds the states; the burst then starts with a write at once.
    await call(opened.workspace, "element.get", { ref: "SR-036" });
    const before = writes();
    const started = Date.now();
    for (let i = 0; i < 50; i += 1) {
      await call(opened.workspace, "element.get", { ref: i % 2 === 0 ? "SR-036" : "SR-037" }, "mcp");
    }
    await call(opened.workspace, "trace.chain", { ref: "N-001" }, "mcp");
    const elapsed = Date.now() - started;
    const allowed = 1 + Math.ceil(elapsed / ACTIVITY_WRITE_MS);
    const file = await recorded(opened);
    expect(writes() - before).toBeLessThanOrEqual(allowed + 1);
    expect(file?.access).toMatchObject({
      command: "trace.chain",
      element: { id: "30500000-0000-4000-8000-0000000a0001" },
    });
    expect(file?.seq).toBe(writes() - before);
  });

  it("writes an access noted within 100 ms of the last write once the 100 ms are over, before close", async () => {
    // The burst above reaches the timer only when the timer fires before close; on a fast machine close
    // writes the pending access first (#511). Here the clock stands still: the second access always
    // waits for the timer, and only the timer writes it.
    const opened = await copy(IDENTIFIERS);
    const { workspace } = opened;
    await call(workspace, "element.get", { ref: "SR-036" });
    const first = await noteAccess(workspace, mcpCall("element.get"), { ref: SR_036 }, {});
    const second = await noteAccess(workspace, mcpCall("element.get"), { ref: SR_037 }, {});
    const before = writes();
    // `vi.waitFor` would move fake time on, so this waits on real turns of the event loop, for at most
    // 10 s of real time (`performance` is not faked).
    const until = async (done: () => Promise<boolean> | boolean): Promise<void> => {
      const end = performance.now() + 10_000;
      while (performance.now() < end && !(await done())) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    recordAccess(workspace, Promise.resolve(first));
    recordAccess(workspace, Promise.resolve(second));
    await until(() => vi.getTimerCount() === 1);
    expect(vi.getTimerCount()).toBe(1);
    expect(writes() - before).toBe(1);
    expect((await readActivity(opened.cache))?.access.element.id).toBe(SR_036);

    vi.advanceTimersByTime(ACTIVITY_WRITE_MS);
    await until(async () => (await readActivity(opened.cache))?.seq === 2);
    expect(writes() - before).toBe(2);
    expect((await readActivity(opened.cache))?.access.element.id).toBe(SR_037);
  });

  it("drops an access noted after the workspace closed, and a write that fails", async () => {
    const opened = await copy(ONE);
    await call(opened.workspace, "element.get", { ref: "SR-e88fb3" });
    const noted: NotedAccess | undefined = await noteAccess(
      opened.workspace,
      mcpCall("element.get"),
      { ref: ONE_ID },
      {},
    );
    expect(noted?.access.element.id).toBe(ONE_ID);
    await opened.workspace.close();
    recordAccess(opened.workspace, Promise.resolve(noted));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await WorkspaceBlock.readCacheFile(opened.cache, ACTIVITY_FILE)).toBeUndefined();
    // On a closed workspace nothing is noted either.
    expect(await noteAccess(opened.workspace, mcpCall("element.get"), { ref: ONE_ID }, {})).toBeUndefined();
  });
});

const mcpCall = (command: string) => {
  const entry = loadContracts().entry(command);
  if (entry === undefined) {
    throw new Error(`no command ${command}`);
  }
  return { command, effect: entry.effect, access: "mcp" as const, subject: accessSubject(entry) };
};

describe("recording never changes a result (SR-080 AK2, point 5 of the plan review)", () => {
  /** A cache folder whose write fails: a file in its place. */
  const brokenCache = async (): Promise<string> => {
    const folder = path.join(await tempFolder(), "cache");
    await fs.writeFile(folder, "not a folder");
    return folder;
  };

  const outcome = async (promise: Promise<unknown>): Promise<unknown> => {
    try {
      return { output: await promise };
    } catch (error) {
      return { error: error instanceof CommandError ? error.toJSON() : String(error) };
    }
  };

  it("gives the same outputs and errors with a failing record as without access", async () => {
    const calls: readonly (readonly [string, object])[] = [
      ["element.get", { ref: "SR-036" }],
      ["element.update", { ref: "SR-037", title: "Show IDs" }],
      ["element.get", { ref: "SR-999999" }],
    ];
    const recordedCopy = await fixture(IDENTIFIERS);
    const plainCopy = await fixture(IDENTIFIERS);
    const before = writes();
    const withRecord = open(recordedCopy.root, await brokenCache());
    const plain = open(plainCopy.root, undefined);
    for (const [name, input] of calls) {
      const a = await outcome(call(withRecord, name, input, "mcp"));
      const b = await outcome(call(plain, name, input));
      expect([name, a]).toEqual([name, b]);
    }
    await withRecord.close();
    // The record was attempted in this test, and failed: the cache folder is a file.
    expect(writes() - before).toBeGreaterThan(0);
  });
});

describe("the last access as workspace.activity gives it", () => {
  it("gives the recorded access, and null without one, without a cache folder or for a broken file", async () => {
    const opened = await copy(ONE);
    expect(await call(opened.workspace, "workspace.activity", {})).toEqual({ activity: null });
    await call(opened.workspace, "element.get", { ref: "SR-e88fb3" }, "api");
    const file = await recorded(opened);
    const reader = open(opened.fixture.root, opened.cache);
    expect(await call(reader, "workspace.activity", {}, "mcp")).toEqual({ activity: file?.access });

    for (const text of ["{", JSON.stringify({ ...file, version: 2 }), `${" ".repeat(5000)}{}`]) {
      await fs.writeFile(path.join(opened.cache, ACTIVITY_FILE), text);
      expect(await lastAccess(reader)).toBeUndefined();
    }
    await fs.rm(path.join(opened.cache, ACTIVITY_FILE));
    await fs.mkdir(path.join(opened.cache, ACTIVITY_FILE));
    expect(await readActivity(opened.cache)).toBeUndefined();
    await fs.rm(opened.cache, { recursive: true });
    await fs.writeFile(opened.cache, "a file in place of the folder");
    expect(await readActivity(opened.cache)).toBeUndefined();

    const none = open(opened.fixture.root, undefined);
    expect(await call(none, "workspace.activity", {})).toEqual({ activity: null });
  });
});

/** An access arriving at a watch, with the time it took. */
const accesses = (): {
  readonly options: Pick<ActivityWatchOptions, "onAccess">;
  readonly seen: ActivityAccess[];
  next(): Promise<ActivityAccess>;
} => {
  const seen: ActivityAccess[] = [];
  const waiting: ((access: ActivityAccess) => void)[] = [];
  return {
    seen,
    options: {
      onAccess: (access) => {
        seen.push(access);
        waiting.shift()?.(access);
      },
    },
    next: () =>
      new Promise((resolve) => {
        waiting.push(resolve);
      }),
  };
};

const watching = async (workspace: Workspace, options: ActivityWatchOptions): Promise<ActivityWatch> => {
  const watch = watchActivity(workspace, options);
  onTestFinished(() => {
    watch.close();
  });
  expect(await watch.ready).toBeUndefined();
  await watchWorkspace(workspace).ready;
  return watch;
};

const quiet = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Another process of the copy: its own workspace on the same root and cache folder. */
const server = (opened: Copy): Workspace => open(opened.fixture.root, opened.cache);

const activityFile = (sha256: string, seq: number, id = SR_036): ActivityFile => ({
  version: 1,
  process: "1-0000abcd",
  seq,
  sha256,
  access: {
    access: "mcp",
    command: "element.get",
    effect: "read",
    at: "2026-10-27T09:30:00.000Z",
    element: { id, repository: "spec" },
  },
});

describe("watching the last access (SR-117)", () => {
  it("[SR-117/AK1] reports an access another process records within 1 s, once", async () => {
    const opened = await copy(IDENTIFIERS);
    await opened.workspace.get(elementStoreState);
    const seen = accesses();
    await watching(opened.workspace, { ...seen.options, holdMs: 10_000 });
    const next = seen.next();
    const started = Date.now();
    await call(server(opened), "element.get", { ref: "SR-036" }, "mcp");
    expect((await next).element).toEqual({ id: SR_036, repository: "spec" });
    expect(Date.now() - started).toBeLessThan(1000);
    await quiet(300);
    expect(seen.seen).toHaveLength(1);
  });

  it("[SR-117/AK1] reports a change only once the store of the watching process holds it", async () => {
    const opened = await copy(IDENTIFIERS);
    await opened.workspace.get(elementStoreState);
    const seen = accesses();
    await watching(opened.workspace, { ...seen.options, holdMs: 10_000 });
    const file = opened.fixture.path("requirements/SR-0000000b0037.md");

    const changed = seen.next();
    await call(server(opened), "element.update", { ref: "SR-037", title: "Show IDs" }, "mcp");
    expect((await changed).element.id).toBe(SR_037);
    const store = await opened.workspace.get(elementStoreState);
    expect(store.byId.get(SR_037)?.[0]?.snapshot.sha256).toBe(await sha256Of(file));

    const created = seen.next();
    const output = (await call(
      server(opened),
      "element.create",
      { type: "system-requirement", title: "Follow agents" },
      "mcp",
    )) as CommandOutput<"element.create">;
    expect((await created).element.id).toBe(output.element.id);
    expect((await opened.workspace.get(elementStoreState)).byId.has(output.element.id)).toBe(true);
  });

  it("drops a held access for a newer one, and reports a held one after holdMs", async () => {
    const opened = await copy(IDENTIFIERS);
    const store = await opened.workspace.get(elementStoreState);
    const known = store.byId.get(SR_037)?.[0]?.snapshot.sha256 ?? "";
    const seen = accesses();
    await watching(opened.workspace, { ...seen.options, holdMs: 400 });
    const write = (file: ActivityFile): Promise<string> =>
      WorkspaceBlock.writeCacheFile(opened.cache, ACTIVITY_FILE, JSON.stringify(file));

    await write(activityFile("0".repeat(64), 1));
    await quiet(100);
    const next = seen.next();
    await write(activityFile(known, 2, SR_037));
    expect((await next).element.id).toBe(SR_037);
    await quiet(600);
    expect(seen.seen.map((a) => a.element.id)).toEqual([SR_037]);

    const late = seen.next();
    const started = Date.now();
    await write(activityFile("1".repeat(64), 3));
    expect((await late).element.id).toBe(SR_036);
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);

    // A change of the files while nothing is held reports nothing.
    const changed = new Promise<void>((resolve) => {
      const stop = watchWorkspace(opened.workspace).onChange(() => {
        stop();
        resolve();
      });
    });
    const element = opened.fixture.path("requirements/SR-0000000b0036.md");
    await fs.writeFile(element, (await fs.readFile(element, "utf8")).replace("Accept", "Take"));
    await changed;
    await quiet(50);
    expect(seen.seen).toHaveLength(2);
  });

  it("reports nothing that it was still reading or checking when it closed", async () => {
    const opened = await copy(IDENTIFIERS);
    const seen = accesses();
    const watch = await watching(opened.workspace, seen.options);
    const text = JSON.stringify(activityFile("4".repeat(64), 1));

    // Closed while the file is read.
    let read: (text: string) => void = () => undefined;
    const reading = new Promise<void>((started) => {
      vi.mocked(WorkspaceBlock.readCacheFile).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            read = resolve;
            started();
          }),
      );
    });
    await WorkspaceBlock.writeCacheFile(opened.cache, ACTIVITY_FILE, text);
    await reading;
    watch.close();
    read(text);
    await quiet(100);

    // Closed while the store is looked at.
    const second = await watching(opened.workspace, seen.options);
    let look: (value: undefined) => void = () => undefined;
    const looking = new Promise<void>((started) => {
      vi.mocked(settledValue).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            look = resolve;
            started();
          }),
      );
    });
    await WorkspaceBlock.writeCacheFile(
      opened.cache,
      ACTIVITY_FILE,
      JSON.stringify(activityFile("4".repeat(64), 2)),
    );
    await looking;
    second.close();
    look(undefined);
    await quiet(100);
    expect(seen.seen).toEqual([]);
  });

  it("reports at once while the store is not built, and ignores other files and the file at start", async () => {
    const opened = await copy(IDENTIFIERS);
    const write = (name: string, text: string): Promise<void> =>
      fs.writeFile(path.join(opened.cache, name), text);
    await write(ACTIVITY_FILE, JSON.stringify(activityFile("2".repeat(64), 1)));
    const seen = accesses();
    await watching(opened.workspace, seen.options);
    await write(ACTIVITY_FILE, JSON.stringify(activityFile("2".repeat(64), 1)));
    await write("model.json", "{}");
    await write(`.${ACTIVITY_FILE}.0123abcd.logreq-tmp`, "{");
    await write(ACTIVITY_FILE, "{");
    await write(ACTIVITY_FILE, JSON.stringify({ ...activityFile("2".repeat(64), 2), version: 2 }));
    await write(ACTIVITY_FILE, `${JSON.stringify(activityFile("2".repeat(64), 3))}${" ".repeat(5000)}`);
    await quiet(300);
    expect(seen.seen).toEqual([]);
    const next = seen.next();
    await write(ACTIVITY_FILE, JSON.stringify(activityFile("2".repeat(64), 4)));
    expect((await next).element.id).toBe(SR_036);
    expect(opened.workspace.peek(elementStoreState)).toBeUndefined();
  });

  it("says why it cannot watch: no usable cache folder, a folder that cannot be made, a closed workspace", async () => {
    const created = await fixture(ONE);
    const logged: string[] = [];
    const log = (message: string): void => {
      logged.push(message);
    };
    const onAccess = (): void => undefined;

    const none = watchActivity(open(created.root, undefined), { onAccess, log });
    expect(await none.ready).toBe("the working copy has no cache folder outside its repositories");

    const blocked = path.join(await tempFolder(), "file");
    await fs.writeFile(blocked, "");
    const broken = watchActivity(open(created.root, path.join(blocked, "cache")), { onAccess, log });
    expect(await broken.ready).toMatch(/^the cache folder cannot be watched: /);

    const missing = watchActivity(open(path.join(created.root, "nothing-here"), await tempFolder()), {
      onAccess,
    });
    expect(await missing.ready).toMatch(/^the workspace cannot be read: /);

    expect(logged).toEqual([
      "Agents cannot be followed: the working copy has no cache folder outside its repositories",
      expect.stringMatching(/^Agents cannot be followed: the cache folder cannot be watched: /) as unknown,
    ]);

    const closing = watchActivity(open(created.root, await tempFolder()), { onAccess });
    closing.close();
    expect(await closing.ready).toBeUndefined();
  });

  it("ends the watch on a watch error, and reports nothing after close", async () => {
    const opened = await copy(IDENTIFIERS);
    const seen = accesses();
    const logged: string[] = [];
    const watch = await watching(opened.workspace, {
      ...seen.options,
      log: (message) => {
        logged.push(message);
      },
    });
    const watches = vi.mocked(fsWatch).mock;
    const index = watches.calls.findIndex(([folder]) => folder === opened.cache);
    const watcher = watches.results[index]?.value as FSWatcher;
    watcher.emit("error", new Error("gone"));
    expect(logged).toEqual(["Agents cannot be followed: the cache folder is no longer watched: gone"]);
    watch.close();
    await WorkspaceBlock.writeCacheFile(
      opened.cache,
      ACTIVITY_FILE,
      JSON.stringify(activityFile("3".repeat(64), 9)),
    );
    await quiet(200);
    expect(seen.seen).toEqual([]);
  });
});

describe("a watch that goes on or ends on its own", () => {
  const watcherOf = (folder: string): FSWatcher => {
    const watches = vi.mocked(fsWatch).mock;
    const index = watches.calls.findIndex(([watched]) => watched === folder);
    return watches.results[index]?.value as FSWatcher;
  };

  it("ends the watch with a log line when the cache folder is removed, not for a file of its name", async () => {
    const opened = await copy(IDENTIFIERS);
    const logged: string[] = [];
    await watching(opened.workspace, {
      onAccess: () => undefined,
      log: (message) => {
        logged.push(message);
      },
    });
    const watcher = watcherOf(opened.cache);
    const name = path.basename(opened.cache);
    watcher.emit("change", "rename", name);
    await quiet(100);
    expect(logged).toEqual([]);

    await fs.rm(opened.cache, { recursive: true, force: true, maxRetries: 3 });
    // The event the OS gives for the removed folder itself (Linux: `rename` with its name), sent here
    // twice as well so that every platform takes this path and a repeated report logs only once.
    watcher.emit("change", "rename", name);
    watcher.emit("change", "rename", name);
    await vi.waitFor(() => {
      expect(logged).toContain("Agents cannot be followed: the cache folder was removed");
    });
    await quiet(100);
    expect(logged).toEqual(["Agents cannot be followed: the cache folder was removed"]);
  });

  it("logs what a throwing onAccess throws, and goes on reporting", async () => {
    const opened = await copy(IDENTIFIERS);
    const logged: string[] = [];
    const reported: number[] = [];
    await watching(opened.workspace, {
      onAccess: () => {
        reported.push(reported.length);
        if (reported.length === 1) {
          throw new Error("the port is gone");
        }
      },
      log: (message) => {
        logged.push(message);
      },
    });
    const write = (seq: number): Promise<string> =>
      WorkspaceBlock.writeCacheFile(
        opened.cache,
        ACTIVITY_FILE,
        JSON.stringify(activityFile("5".repeat(64), seq)),
      );
    // Each report waits for a watcher event of the cache folder, which macOS runners can deliver
    // later than vi.waitFor's default of 1 s; how fast is not what this test shows.
    await write(1);
    await vi.waitFor(
      () => {
        expect(logged).toEqual(["An agent's access could not be reported: Error: the port is gone"]);
      },
      { timeout: 5000 },
    );
    await write(2);
    await vi.waitFor(
      () => {
        expect(reported).toHaveLength(2);
      },
      { timeout: 5000 },
    );
    expect(logged).toHaveLength(1);
  });
});

describe("following opens no network connection (SR-117 AK6)", () => {
  it("[SR-117/AK6] recording and watching open no network connection", async () => {
    const spies = [
      vi.spyOn(net.Socket.prototype, "connect"),
      vi.spyOn(net.Server.prototype, "listen"),
      vi.spyOn(dgram, "createSocket"),
      vi.spyOn(http, "request"),
      vi.spyOn(https, "request"),
      vi.spyOn(tls, "connect"),
    ];
    onTestFinished(() => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    });
    const opened = await copy(IDENTIFIERS);
    await opened.workspace.get(elementStoreState);
    const seen = accesses();
    await watching(opened.workspace, seen.options);
    const next = seen.next();
    await call(server(opened), "element.update", { ref: "SR-036", title: "Accept IDs" }, "mcp");
    expect((await next).element.id).toBe(SR_036);
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
