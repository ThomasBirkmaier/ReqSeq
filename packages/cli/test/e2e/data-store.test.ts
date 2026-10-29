// `reqseq data store` end to end (SR-062): the built binary on fixtures/SR-061/export (two Git
// repositories `system` and `sensor`, cwd `system`). AK1: a pipeline call with a target folder writes
// `<commit>.jsonl`, one element per line (#319); AK2: two stored states are read as one table of lines
// and evaluated from the files alone, with `node:fs`, `JSON.parse` and the schema files on disk (the Ajv setup of scripts/contracts, ADR-0003), without any
// `@reqseq/*` module and after the workspace is gone. Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

/** A Git copy of the fixture; its workspace is `system/`. */
const fixture = async (git = true): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({
    fixture: "SR-061/export",
    ...(git ? { git: ["system", "sensor"] } : {}),
  });
  fixtures.push(ws);
  return ws;
};

/** `reqseq <args>` with cwd `system`. */
const inSystem = (ws: FixtureWorkspace, args: readonly string[]): Promise<Run> =>
  run(args, { cwd: ws.path("system") });

/** A temporary folder outside every fixture, removed after the test. */
const tempFolder = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-states-")));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
};

/** A validator of Ajv: the check, and the errors of the last call. */
interface Validate {
  (data: unknown): boolean;
  errors?: unknown;
}

/** What scripts/contracts/load.mjs gives (ADR-0003): one Ajv with every schema of schemas/, strict, with formats. */
interface ContractsModule {
  readonly loadContracts: () => { readonly ajv: { getSchema: (id: string) => Validate | undefined } };
  readonly BASE: string;
}

/** The validator of `schema` (a file of schemas/) as scripts/contracts sets it up, from the files on disk. */
const schemaValidator = async (schema: string): Promise<Validate | undefined> => {
  // A URL, not a module path: the script is no part of the package and has no types.
  const load = new URL("../../../../scripts/contracts/load.mjs", import.meta.url).href;
  const { loadContracts, BASE } = (await import(load)) as ContractsModule;
  return loadContracts().ajv.getSchema(`${BASE}${schema}`);
};

/** What the evaluation reads of a line of a stored file: only fields of `$defs/line`. */
interface StoredLine {
  readonly "reqseq-data": number;
  readonly commit?: string;
  readonly dirty: boolean;
  readonly id: string;
  readonly shortId: string;
  readonly title: string;
  readonly repository: string;
  readonly verification?: readonly { readonly view: string; readonly status: string }[];
  readonly relations: readonly {
    readonly id: string;
    readonly repository?: string;
    readonly targetState: string;
  }[];
}

/** The lines of a stored file, each parsed; the text ends with a line break. */
const linesOf = (text: string): StoredLine[] => {
  expect(text.endsWith("\n")).toBe(true);
  return text
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line) as StoredLine);
};

/**
 * A raw JUnit file with one passing test case of SR-0000b3 in the variant Mountain (VAR-0000c2, the only
 * view SR-0000b3 is valid for), not enriched yet.
 */
const RAW_JUNIT =
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="direction.test.ts">\n' +
  '    <testcase classname="direction.test.ts" name="[SR-0000b3] shows the wind direction"><properties>' +
  '<property name="reqseq:variant" value="61061061-0000-4000-8000-0000000000c2"/></properties></testcase>\n' +
  "  </testsuite>\n</testsuites>\n";

describe("reqseq data store (SR-062)", () => {
  it("[SR-062/AK1] a pipeline call reqseq data store --folder out writes out/<commit>.jsonl, one element per line", async () => {
    const ws = await fixture();
    const commit = await ws.head("system");
    const result = await inSystem(ws, ["data", "store", "--folder", "out"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain(`out/${commit}.jsonl`);
    expect(await fs.readdir(ws.path("system/out"))).toEqual([`${commit}.jsonl`]);
    const text = await fs.readFile(ws.path(`system/out/${commit}.jsonl`), "utf8");
    // The same bytes as data export --jsonl of the state.
    const lines = await inSystem(ws, ["data", "export", "--jsonl"]);
    expect(text).toBe(lines.stdout);
    const stored = linesOf(text);
    expect(stored.map((l) => l.shortId)).toHaveLength(9);
    for (const line of stored) {
      expect([line.shortId, line["reqseq-data"], line.commit, line.dirty]).toEqual([
        line.shortId,
        2,
        commit,
        false,
      ]);
    }
  });

  it("[SR-062/AK1] reqseq data store without Git exits with 1 and writes nothing", async () => {
    const ws = await fixture(false);
    const result = await inSystem(ws, ["data", "store", "--folder", "out", "--json"]);
    expect(result.code).toBe(1);
    const out = JSON.parse(result.stdout) as {
      files: string[];
      problems: { code: string; severity: string }[];
    };
    expect(out.files).toEqual([]);
    expect(out.problems.map((p) => [p.code, p.severity])).toEqual([["git.unavailable", "error"]]);
    await expect(fs.stat(ws.path("system/out"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("takes the folder as a positional argument, gives files and problems as JSON, and exits with 2 for a refused folder", async () => {
    const ws = await fixture();
    const commit = await ws.head("system");
    const json = await inSystem(ws, ["data", "store", "states", "--json"]);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    expect(JSON.parse(json.stdout)).toEqual({ files: [`states/${commit}.jsonl`], problems: [] });
    const refused = await inSystem(ws, ["data", "store", "--folder", "out/.git"]);
    expect(refused.code).toBe(2);
    await expect(fs.stat(ws.path("system/out"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("[SR-062/AK2] two stored states are evaluated from the files alone, without ReqSeq or the workspace", async () => {
    const ws = await fixture();
    const states = await tempFolder();
    const target = path.join(states, "stored");
    await fs.mkdir(target);
    // 1. The pipeline stores state A.
    const commitA = await ws.head("system");
    const first = await inSystem(ws, ["data", "store", "--folder", target]);
    expect([first.code, first.stderr]).toEqual([0, ""]);
    // 2. A new state: an enriched test result for SR-0000b3, the check, a changed title, a commit.
    await ws.write("system/results/direction.xml", RAW_JUNIT);
    const enriched = await inSystem(ws, [
      "evidence",
      "enrich-junit",
      "results/direction.xml",
      "build-62",
      "--date",
      "2026-10-27T10:00:00Z",
      "--output",
      "evidence/ci/run-2.xml",
    ]);
    expect([enriched.code, enriched.stderr]).toEqual([0, ""]);
    const check = await inSystem(ws, ["workspace", "check"]);
    expect(check.stderr).toBe("");
    const b2 = ws.path("system/requirements/SR-0000000000b2.md");
    await fs.writeFile(
      b2,
      (await fs.readFile(b2, "utf8")).replace("title: Show the gusts", "title: Show each gust"),
    );
    const commitB = await ws.commit("system", "state B");
    // 3. The pipeline stores state B.
    const second = await inSystem(ws, ["data", "store", "--folder", target]);
    expect([second.code, second.stderr]).toEqual([0, ""]);
    // 4. The files leave the machine's workspace: copied out, and the fixture removed.
    const kept = path.join(states, "kept");
    await fs.cp(target, kept, { recursive: true });
    const fixturePath = ws.root;
    await ws.cleanup();
    fixtures.splice(fixtures.indexOf(ws), 1);
    // 5. The evaluation: node:fs, JSON.parse and the schema file, nothing of ReqSeq. Every file is
    // read into one table of lines (as DuckDB's read_json_auto('*.jsonl') does), grouped by commit.
    const validate = await schemaValidator("data-export.schema.json#/$defs/line");
    const names = (await fs.readdir(kept)).sort();
    expect(names).toEqual([`${commitA}.jsonl`, `${commitB}.jsonl`].sort());
    const table: StoredLine[] = [];
    for (const name of names) {
      const text = await fs.readFile(path.join(kept, name), "utf8");
      const lines = linesOf(text);
      // The name holds the commit every line carries: the identity of the state.
      expect([name, [...new Set(lines.map((l) => `${String(l.commit)}.jsonl`))]]).toEqual([name, [name]]);
      // The file names no path of the machine it was made on.
      expect(text.includes(fixturePath)).toBe(false);
      expect(text.includes(JSON.stringify(fixturePath).slice(1, -1))).toBe(false);
      table.push(...lines);
    }
    for (const line of table) {
      expect([line.shortId, validate?.(line), validate?.errors ?? null]).toEqual([line.shortId, true, null]);
    }
    const state = (commit: string): StoredLine[] => table.filter((l) => l.commit === commit && !l.dirty);
    const a = state(commitA);
    const b = state(commitB);
    expect([a.length, b.length]).toEqual([9, 9]);
    for (const lines of [a, b]) {
      // Every relation target that is available is in the same state, by id and repository.
      const known = new Set(lines.map((e) => `${e.repository}/${e.id}`));
      const targets = lines.flatMap((e) =>
        e.relations
          .filter((r) => r.targetState === "available")
          .map((r) => `${r.repository ?? e.repository}/${r.id}`),
      );
      expect(targets.length).toBeGreaterThan(0);
      expect(targets.filter((t) => !known.has(t))).toEqual([]);
    }
    expect(commitA).not.toBe(commitB);
    const verified = (lines: StoredLine[]): number =>
      lines.filter((e) => e.verification?.some((v) => v.status === "verified") === true).length;
    expect(verified(b)).toBe(verified(a) + 1);
    const title = (lines: StoredLine[]): string | undefined =>
      lines.find((e) => e.shortId === "SR-0000b2")?.title;
    expect([title(a), title(b)]).toEqual(["Show the gusts", "Show each gust"]);
  });
});
