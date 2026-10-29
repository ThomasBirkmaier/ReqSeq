import fs from "node:fs/promises";
import { availableParallelism } from "node:os";
import { MessageChannel } from "node:worker_threads";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Contribution } from "./contribution.js";
import type { ReadAnswer, ReadJob, ReadRequest } from "./read-pool.js";
import { READ_CHUNK, READ_WORKER, openReadPool, readWorkers, serveReads } from "./read-pool.js";
import type { ElementStore } from "./store.js";
import { loadElements } from "./store.js";

const fixture = async (options: Parameters<typeof createFixtureWorkspace>[0]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

const layoutOf = async (root: string): Promise<WorkspaceLayout> => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace.get(workspaceLayoutState);
};

const uuid = (n: number): string => `6b1f1b9e-2a39-4c4c-9a4e-${n.toString(16).padStart(12, "0")}`;

const element = (id: string, extra = ""): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: T\n${extra}---\n\nText.\n`;

/** More files than one chunk, so that each worker reads several. */
const MANY = READ_CHUNK * 2 + 17;

/** A workspace of two repositories with every kind of file the store tells apart. */
const everyKindOfFile = async (): Promise<FixtureWorkspace> => {
  const files: Record<string, string | Uint8Array> = {
    "reqseq-workspace.yaml":
      "reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: sub, url: y, path: vendor/sub }\nmetamodel: { repository: system, path: metamodel }\n",
    "vendor/sub/SR-a.md": element(uuid(1)),
    "vendor/sub/copy/SR-a.md": element(uuid(1)),
    "bad/yaml.md": "---\nid: a\n  title: x\n---\n",
    "bad/unclosed.md": "---\nid: a\n",
    "bad/conflict.md": `---\nid: ${uuid(2)}\n<<<<<<< HEAD\nx: 1\n=======\nx: 2\n>>>>>>> b\n---\n`,
    "bad/id.md": "---\nid: not-a-uuid\ntype: system-requirement\n---\n",
    "bad/type.md": `---\nid: ${uuid(3)}\ntype: [x]\n---\n`,
    "bad/latin1.md": new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xe4, 0x0a, 0x2d, 0x2d, 0x2d, 0x0a]),
    "odd/warning.md": element(uuid(4), "x: !unknown 1\n"),
    "odd/bom.md": `\uFEFF${element(uuid(5))}`,
    "odd/crlf.md": element(uuid(6)).replaceAll("\n", "\r\n"),
    "odd/values.md": element(
      uuid(7),
      'zero: -0\nnan: .nan\n"__proto__": { polluted: true }\nlist: [1, "2", null]\n',
    ),
    "odd/Big.MD": element(uuid(8)),
    "docs/plain.md": "# Just Markdown\n",
    "docs/list.md": "---\n- a\n---\n",
    "docs/only-id.md": `---\nid: ${uuid(9)}\n---\n`,
    "docs/empty.md": "---\n---\n",
  };
  for (let i = 0; i < MANY; i++) {
    files[`requirements/SR-${String(i).padStart(4, "0")}.md`] = element(uuid(100 + i), `n: ${String(i)}\n`);
  }
  const ws = await fixture({ files });
  await fs.symlink(ws.path("odd/bom.md"), ws.path("odd/link.md"));
  return ws;
};

/** A worker entry made of `code`, for workers that misbehave. */
const script = (code: string): URL => new URL(`data:text/javascript,${encodeURIComponent(code)}`);

/** Answers each job, after an answer with an id no call has. */
const stray = `import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ id }) => {
  parentPort.postMessage({ id: -1, contributions: [] });
  parentPort.postMessage({ id, contributions: [] });
});`;

const nowhere: ReadRequest = { repository: { name: "system", folder: "/nowhere" }, files: ["a.md"] };

/** A signal whose `throwIfAborted` throws from its `at`-th call on; `checks` counts the calls. */
const abortAt = (at: number): { signal: AbortSignal; checks: () => number } => {
  let calls = 0;
  const signal = {
    throwIfAborted: () => {
      calls += 1;
      if (calls >= at) {
        throw new Error("stop");
      }
    },
  } as unknown as AbortSignal;
  return { signal, checks: () => calls };
};

const contributions = (store: ElementStore): Contribution[] =>
  (store.repositories ?? []).flatMap((r) => [...r.files.values()]);

const fileOrder = (store: ElementStore): string[][] =>
  (store.repositories ?? []).map((r) => [...r.files.keys()]);

describe("read pool (ADR-0008, N-036)", () => {
  it("gives the same store in worker threads as in this thread", async () => {
    const layout = await layoutOf((await everyKindOfFile()).root);
    const inThread = await loadElements(layout);
    const pooled = await loadElements(layout, undefined, { workers: 2, workerThreshold: 1 });
    expect(pooled).toEqual(inThread);
    expect(fileOrder(pooled)).toEqual(fileOrder(inThread));
    expect(JSON.stringify(pooled)).toBe(JSON.stringify(inThread));
    expect(pooled.elements).toHaveLength(MANY + 6);
    expect(new Set(pooled.problems.map((p) => p.code))).toEqual(
      new Set([
        "file.skipped",
        "file.invalid-yaml",
        "file.conflict-markers",
        "element.invalid",
        "file.unreadable",
        "file.yaml-warning",
      ]),
    );
    // Values a structured clone must keep: -0, NaN, an own `__proto__` key.
    const values = pooled.elements.find((e) => e.file === "odd/values.md")?.data ?? {};
    expect(Object.is(values["zero"], -0)).toBe(true);
    expect(values["nan"]).toBeNaN();
    expect(Object.hasOwn(values, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    // Snapshots are frozen and shared with the element, as `makeSnapshot` and the store make them.
    for (const store of [inThread, pooled]) {
      for (const c of contributions(store)) {
        expect(c.snapshot === undefined || Object.isFrozen(c.snapshot)).toBe(true);
        expect(c.kind !== "element" || c.element.snapshot === c.snapshot).toBe(true);
      }
    }
  });

  it("reads with the default number of workers the same store", async () => {
    const layout = await layoutOf((await everyKindOfFile()).root);
    expect(await loadElements(layout, undefined, { workerThreshold: 1 })).toEqual(await loadElements(layout));
  });

  it("rejects a load aborted before it starts", async () => {
    const layout = await layoutOf((await everyKindOfFile()).root);
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(loadElements(layout, controller.signal, { workers: 1, workerThreshold: 1 })).rejects.toThrow(
      "stop",
    );
  });

  it("stops sending chunks when the signal is aborted during a load", async () => {
    const layout = await layoutOf((await everyKindOfFile()).root);
    // Aborts at the third check: the one before the pool starts, then after the first chunk.
    const { signal, checks } = abortAt(3);
    await expect(loadElements(layout, signal, { workers: 1, workerThreshold: 1 })).rejects.toThrow("stop");
    expect(checks()).toBe(3);
  });

  it("reads no file for an empty list and starts at least one worker", async () => {
    const ws = await fixture({ files: { "a.md": element(uuid(1)) } });
    const pool = openReadPool(0);
    try {
      expect(pool.size).toBe(1);
      const empty: ReadRequest = { repository: { name: "system", folder: "/nowhere" }, files: [] };
      expect(await pool.read([empty])).toEqual([[empty, new Map()]]);
      const [read] = await pool.read([{ repository: { name: "system", folder: ws.root }, files: ["a.md"] }]);
      expect(read?.[1].get("a.md")).toMatchObject({ kind: "element", element: { id: uuid(1) } });
    } finally {
      await pool.close();
    }
  });

  it("answers reads that overlap on one pool each with its own files", async () => {
    const ws = await fixture({
      files: Object.fromEntries(
        Array.from({ length: READ_CHUNK * 2 }, (_, i) => [`SR-${String(i)}.md`, element(uuid(i + 1))]),
      ),
    });
    const files = Array.from({ length: READ_CHUNK * 2 }, (_, i) => `SR-${String(i)}.md`);
    const repository = { name: "system", folder: ws.root };
    const pool = openReadPool(2);
    try {
      const [first, second] = await Promise.all([
        pool.read([{ repository, files: files.slice(0, READ_CHUNK + 3) }]),
        pool.read([{ repository, files: files.slice(READ_CHUNK + 3) }]),
      ]);
      expect([...(first[0]?.[1].keys() ?? [])].sort()).toEqual(files.slice(0, READ_CHUNK + 3).sort());
      expect([...(second[0]?.[1].keys() ?? [])].sort()).toEqual(files.slice(READ_CHUNK + 3).sort());
    } finally {
      await pool.close();
    }
  });

  it("ignores an answer that belongs to no call", async () => {
    const pool = openReadPool(1, script(stray));
    try {
      const request: ReadRequest = { repository: { name: "system", folder: "/nowhere" }, files: ["a.md"] };
      expect(await pool.read([request])).toEqual([[request, new Map()]]);
    } finally {
      await pool.close();
    }
  });

  it("rejects every read once a worker failed", async () => {
    const pool = openReadPool(1, script("throw new Error('broken worker')"));
    try {
      await expect(pool.read([nowhere])).rejects.toThrow("broken worker");
      await expect(pool.read([nowhere])).rejects.toThrow("broken worker");
    } finally {
      await pool.close();
    }
  });

  it("rejects a read when a worker stops", async () => {
    const pool = openReadPool(1, script("process.exit(3)"));
    try {
      await expect(pool.read([nowhere])).rejects.toThrow("A read worker stopped with exit code 3");
    } finally {
      await pool.close();
    }
  });
});

describe("readWorkers", () => {
  it("is one per core minus one, at least one", () => {
    expect(readWorkers(4)).toBe(3);
    expect(readWorkers(2)).toBe(1);
    expect(readWorkers(1)).toBe(1);
    expect(readWorkers()).toBe(Math.max(1, availableParallelism() - 1));
  });
});

describe("serveReads", () => {
  it("does nothing without a port or in a thread that is no read worker", async () => {
    expect(() => {
      serveReads(null, READ_WORKER);
    }).not.toThrow();
    const { port1, port2 } = new MessageChannel();
    onTestFinished(() => {
      port1.close();
    });
    serveReads(port1, { some: "other pool's data" });
    expect(port1.listenerCount("message")).toBe(0);
    port2.close();
    // The entry of a worker, loaded in a Vitest fork (no parent port, other data): it serves nothing.
    await expect(import("./read-worker.js")).resolves.toBeDefined();
  });

  it("answers each job in a read worker with the contributions of its files", async () => {
    const ws = await fixture({ files: { "a.md": element(uuid(1)), "b.md": "# Text\n" } });
    const { port1, port2 } = new MessageChannel();
    onTestFinished(() => {
      port1.close();
    });
    serveReads(port1, READ_WORKER);
    const answer = new Promise<ReadAnswer>((resolve) => port2.once("message", resolve));
    const job: ReadJob = { id: 7, repository: { name: "system", folder: ws.root }, files: ["a.md", "b.md"] };
    port2.postMessage(job);
    const {
      id,
      contributions: [a, b],
    } = await answer;
    expect(id).toBe(7);
    expect(a?.[0]).toBe("a.md");
    expect(a?.[1]).toMatchObject({ kind: "element", element: { id: uuid(1), repository: "system" } });
    expect(b).toEqual(["b.md", { kind: "not-element", file: "b.md", warnings: [] }]);
  });
});
