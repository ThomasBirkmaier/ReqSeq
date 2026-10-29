// `reqseq evidence record` end to end (SR-030): the built binary on fixtures/SR-030/record (see its
// README), from the root of a fresh Git copy per test. Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq, requireBuiltCli } from "../support/reqseq.js";

const S2 = "30303030-3030-4030-8030-00000000c002";
const DATE = "2026-10-27T10:00:00Z";
const INSPECTION = ["verification", "passed", "--method", "inspection", "--item", "unit 7", "--date", DATE];

interface Output {
  readonly files: readonly string[];
  readonly record: Readonly<Record<string, unknown>>;
  readonly problems: readonly unknown[];
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const open = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-030/record", git: true });
  fixtures.push(ws);
  return ws;
};

const run = (ws: FixtureWorkspace, args: readonly string[]): Promise<Run> => reqseq(args, { cwd: ws.root });

const json = async (ws: FixtureWorkspace, args: readonly string[]): Promise<unknown> => {
  const result = await run(ws, [...args, "--json"]);
  expect([result.code, result.stderr]).toEqual([0, ""]);
  return JSON.parse(result.stdout) as unknown;
};

/** The first line `reqseq element get <ref>` prints. */
const firstLine = async (ws: FixtureWorkspace, ref: string): Promise<string> =>
  (await run(ws, ["element", "get", ref])).stdout.split("\n")[0] ?? "";

describe("reqseq evidence record (SR-030)", () => {
  it("[SR-030/AK1] reqseq evidence record writes the UUID and current version of the requirement", async () => {
    const ws = await open();
    const { element } = (await json(ws, ["element", "get", "SR-00c002"])) as {
      element: { version: string };
    };
    const output = (await json(ws, ["evidence", "record", "SR-00c002", ...INSPECTION])) as Output;
    expect(output.record).toMatchObject({ element: S2, version: element.version });
    const text = await fs.readFile(ws.path("evidence/2026-10-27-SR-00c002-inspection.md"), "utf8");
    expect(text).toContain(`\nelement: ${S2}\nversion: ${element.version}\n`);
  });

  it("[SR-030/AK2] reqseq evidence record --folder reviews writes an open-format file there, and a new process reads it", async () => {
    const ws = await open();
    const output = (await json(ws, [
      "evidence",
      "record",
      "SR-00c002",
      ...INSPECTION,
      "--evidence",
      "photos/unit-7.jpg",
      "--folder",
      "reviews",
    ])) as Output;
    const file = "reviews/2026-10-27-SR-00c002-inspection.md";
    expect(output.files).toEqual([file]);
    const { version } = output.record as { version: string };
    expect(await fs.readFile(ws.path(file), "utf8")).toBe(
      `---\nreqseq-record: 1\nkind: verification\nelement: ${S2}\nversion: ${version}\nmethod: inspection\nitem: unit 7\nresult: passed\ndate: ${DATE}\nevidence: photos/unit-7.jpg\n---\n`,
    );
    const listed = (await json(ws, ["evidence", "list", "SR-00c002"])) as { records: { file: string }[] };
    expect(listed.records.map((r) => r.file)).toEqual([file]);
    // ReqSeq never writes to Git (D-036): the file is new and not committed.
    expect(await ws.git(["status", "--porcelain"])).toBe(`?? ${file}\n`);
  });

  it("[SR-030/AK3] reqseq element get shows a recorded validation in the validation status only", async () => {
    const ws = await open();
    expect(await firstLine(ws, "SR-00c001")).toBe(
      "SR-00c001  approved  Show wind speed  [verification: core verified]",
    );
    expect(await firstLine(ws, "N-00a001")).toBe("N-00a001  approved  Know the wind  [validation: open]");
    for (const ref of ["SR-00c001", "N-00a001"]) {
      const result = await run(ws, ["evidence", "record", ref, "validation", "failed", "--date", DATE]);
      expect([result.code, result.stderr]).toEqual([0, ""]);
    }
    expect(await firstLine(ws, "SR-00c001")).toBe(
      "SR-00c001  approved  Show wind speed  [verification: core verified]  [validation: failed]",
    );
    expect(await firstLine(ws, "N-00a001")).toBe("N-00a001  approved  Know the wind  [validation: failed]");
  });

  it("prints the file, the element and the version", async () => {
    const ws = await open();
    const result = await run(ws, ["evidence", "record", "SR-00c002", ...INSPECTION]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain("evidence/2026-10-27-SR-00c002-inspection.md");
    expect(result.stdout).toContain(`element: ${S2}`);
    expect(result.stdout).toMatch(/version: n1:[0-9a-f]{16}/);
  });

  it("exits with the error of an unknown element and of a verification without --item, writing nothing", async () => {
    const ws = await open();
    const unknown = await run(ws, ["evidence", "record", "SR-ffffff", "validation", "passed"]);
    expect([unknown.code, unknown.stderr]).toEqual([
      2,
      'error ref.unknown: No element has the short ID or identifier "SR-ffffff"\n',
    ]);
    const noItem = await run(ws, [
      "evidence",
      "record",
      "SR-00c002",
      "verification",
      "passed",
      "--method",
      "test",
    ]);
    expect([noItem.code, noItem.stderr]).toEqual([
      2,
      "error input.invalid: Invalid input for evidence.record: --item is required for a verification record\n",
    ]);
    expect(await ws.git(["status", "--porcelain"])).toBe("");
  });
});
