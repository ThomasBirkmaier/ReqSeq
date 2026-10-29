// SR-062 and #697 in the performance suite (ADR-0011): `logreq data store` as a pipeline runs it, a
// new process of the built CLI on the generated workspace of N-036 (50,000 elements, 200,000
// relations) with the evidence records a project of that size keeps (`withEvidenceRecords`), every
// repository a Git repository. The data of that state is larger than one string can hold (about
// 0.5 GB of JSON, V8 holds at most about 512 MB in one string), so the file is written in chunks
// (`jsonChunks`, core files block). Runs with `pnpm test:perf` after `pnpm build`, nightly and on pull
// requests labelled `perf`, never in the required test run. SR-062 names no time: the rows record the
// time of the whole process, the peaks of its memory (`support/peak-memory.mjs`, default heap flags)
// and the bytes of the file; the tagged test asserts that the file is delivered (exit code, name,
// frame), the second run that a data file of that size is replaced (review B1). A last row records
// `jsonChunks` of the same export in this process (time, chunks, largest chunk).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CommandOutput, VersionValue } from "@logreq/core";
import { Workspace, computeVersion, invoke, jsonChunks } from "@logreq/core";
import type { VersionFunction } from "@logreq/testkit";
import {
  createFixtureWorkspace,
  defaultStandardModelFile,
  generateLargeWorkspace,
  measure,
  recordValue,
  withEvidenceRecords,
  writeLargeWorkspace,
} from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logreq, requireBuiltCli } from "../support/logreq.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
const MB = 1e6;

type Metamodel = CommandOutput<"metamodel.get">;

/** The standard model as `metamodel.get` gives it for a workspace with the generator's model file. */
const standardModel = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({
    files: {
      "logreq-workspace.yaml":
        'logreq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
      "metamodel/standard-model.yaml": await fs.readFile(defaultStandardModelFile, "utf8"),
    },
  });
  const workspace = new Workspace(fixture.root);
  try {
    return (await invoke("metamodel.get", {}, { workspace })) as Metamodel;
  } finally {
    await workspace.close();
    await fixture.cleanup();
  }
};

/** Core's version (ADR-0005) for the generator, from the effective properties of each type. */
const versionOf =
  (metamodel: Metamodel): VersionFunction =>
  ({ type, text, properties }) => {
    const keys = new Set(metamodel.types.find((t) => t.key === type)?.properties ?? []);
    return computeVersion({
      text,
      properties: properties as Readonly<Record<string, VersionValue>>,
      definitions: metamodel.properties
        .filter((p) => keys.has(p.key))
        .map((p) => ({
          key: p.key,
          kind: p.kind,
          ...(p.content === undefined ? {} : { content: p.content }),
        })),
      files: [],
    });
  };

/** The peaks `support/peak-memory.mjs` wrote. */
interface PeakMemory {
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly maxRss: number;
}

const peakMemoryPreload = pathToFileURL(
  path.join(import.meta.dirname, "..", "support", "peak-memory.mjs"),
).href;

/** The first and the last bytes of a file. */
const edges = async (file: string, length: number): Promise<{ head: string; tail: string }> => {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(length);
    const tail = Buffer.alloc(length);
    await handle.read(head, 0, length, 0);
    await handle.read(tail, 0, length, size - length);
    return { head: head.toString("utf8"), tail: tail.toString("utf8") };
  } finally {
    await handle.close();
  }
};

describe("logreq data store with 50,000 elements and their records (SR-062, N-036, #697)", () => {
  let root = "";
  let cleanup: (() => Promise<void>) | undefined;
  let out = "";
  let scratch = "";

  beforeAll(async () => {
    requireBuiltCli("pnpm test:perf");
    const version = versionOf(await standardModel());
    const generated = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    // Only what the tests need after the setup, so the generated tree can be collected.
    const fixture = await writeLargeWorkspace(withEvidenceRecords(generated).workspace, { git: true });
    root = fixture.workspaceRoot;
    cleanup = fixture.cleanup;
    out = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-sr-062-out-"));
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-sr-062-memory-"));
  }, 1_800_000);

  afterAll(async () => {
    await cleanup?.();
    for (const folder of [out, scratch]) {
      if (folder !== "") {
        await fs.rm(folder, { recursive: true, force: true });
      }
    }
  });

  /** `logreq data store --folder <out> --json` in a new process; returns its run and memory peaks. */
  const store = async (name: string) => {
    const memoryFile = path.join(scratch, `${String(Date.now())}.json`);
    const env = {
      LOGREQ_PEAK_MEMORY: memoryFile,
      NODE_OPTIONS: `${process.env["NODE_OPTIONS"] ?? ""} --import=${peakMemoryPreload}`.trim(),
    };
    const { result: run, measurement } = await measure(
      name,
      () => logreq(["data", "store", "--folder", out, "--json"], { cwd: root, env }),
      {
        basis: "SR-062 AK1, #697 (command line, from process start to exit; recorded, no limit in the spec)",
      },
    );
    const peak = JSON.parse(await fs.readFile(memoryFile, "utf8")) as PeakMemory;
    return { run, measurement, peak };
  };

  it("[SR-062/AK1] stores the data of the state at N-036 as a file named after the commit, and replaces it on the same commit", async () => {
    const first = await store("logreq data store --json at N-036 (new CLI process, file written in chunks)");
    expect(first.run.stderr).toBe("");
    expect(first.run.code).toBe(0);
    const output = JSON.parse(first.run.stdout) as CommandOutput<"data.store">;
    expect(output.problems).toEqual([]);
    expect(output.files).toEqual([expect.stringMatching(/[0-9a-f]{40}\.json$/)]);
    const file = output.files[0] ?? "";
    expect(path.dirname(file)).toBe(out);
    const { size } = await fs.stat(file);
    const { head, tail } = await edges(file, 17);
    expect(head).toBe('{"logreq-data":1,');
    expect(tail.endsWith("}\n")).toBe(true);
    const basis = "SR-062 AK1, #697 (recorded)";
    await recordValue(
      `logreq data store at N-036: file of ${(size / MB).toFixed(0)} MB; CLI process peak heap in use ${(first.peak.heapUsed / MB).toFixed(0)} MB (sampled), heap reserved ${(first.peak.heapTotal / MB).toFixed(0)} MB, resident memory ${(first.peak.maxRss / MB).toFixed(0)} MB`,
      0,
      { basis },
    );
    // The same commit again: the file of that commit is replaced; it is over the bound of a full parse,
    // so the guard and the refusal check its frame (review B1).
    const second = await store("logreq data store --json at N-036 again, replacing the file of the commit");
    expect(second.run.stderr).toBe("");
    expect(second.run.code).toBe(0);
    expect((JSON.parse(second.run.stdout) as CommandOutput<"data.store">).files).toEqual([file]);
    expect((await fs.readdir(out)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    await recordValue(
      `logreq data store at N-036, replacing: CLI process peak heap in use ${(second.peak.heapUsed / MB).toFixed(0)} MB (sampled), heap reserved ${(second.peak.heapTotal / MB).toFixed(0)} MB, resident memory ${(second.peak.maxRss / MB).toFixed(0)} MB`,
      0,
      { basis },
    );
  }, 1_800_000);

  it("records jsonChunks of the data.export of the whole workspace (time, chunks, largest chunk)", async () => {
    const workspace = new Workspace(root);
    try {
      const data = await invoke("data.export", {}, { workspace });
      const { result } = await measure(
        "jsonChunks of the data.export of the whole workspace (compact)",
        () => {
          let chunks = 0;
          let largest = 0;
          let length = 0;
          for (const chunk of jsonChunks(data, { indent: 0 })) {
            chunks += 1;
            largest = Math.max(largest, chunk.length);
            length += chunk.length;
          }
          return { chunks, largest, length };
        },
        { basis: "#697 (recorded)" },
      );
      await recordValue(
        `jsonChunks of the data.export of the whole workspace: ${String(result.chunks)} chunks, largest ${(result.largest / MB).toFixed(2)} M code units, ${(result.length / MB).toFixed(0)} M code units in all`,
        0,
        { basis: "#697 (recorded)" },
      );
      expect(result.chunks).toBeGreaterThan(1);
      expect(result.largest).toBeLessThan(4 * 1024 * 1024);
    } finally {
      await workspace.close();
    }
  }, 1_800_000);
});
