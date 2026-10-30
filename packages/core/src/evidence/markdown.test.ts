// SR-028 "Nachweis-Datensätze als Markdown lesen": the Markdown reader of the evidence block
// (`markdown.ts`), on fixtures/SR-028/records (the requirements in repository `system`, the records in
// the evidence folder of repository `ci-results`, the repository of another tool) and on bytes.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { parseDocument } from "yaml";
import type { FixtureWorkspace } from "@reqseq/testkit";
import type { MockInstance } from "vitest";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { outdatedEvidenceProblemsState } from "../hints/index.js";
import { keyLinesOf } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import { evidenceIndexState } from "./by-element.js";
import type { EvidenceFile } from "./folders.js";
import { MARKDOWN_READER, readMarkdownRecord } from "./markdown.js";
import type { EvidenceRecord } from "./record.js";
import { EVIDENCE_READERS, evidenceReadState, evidenceRecordsState } from "./state.js";

/** Requirement A (current record) and B (record of an older version) of the fixture. */
const A = "3c3c3c3c-3333-4333-8333-0d0000000001";
const B = "3c3c3c3c-3333-4333-8333-0d0000000002";
const A_VERSION = "n1:de6d3ed288b0f3de";
const B_VERSION = "n1:7db6e9d75d39b846";

const WORKSPACE_FILE =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  '  - { name: ci-results, url: "git@git.example.com:ci/ci-results.git" }\n' +
  "metamodel: { repository: system, path: metamodel }\nevidence:\n" +
  "  - { repository: ci-results, path: evidence }\n";

/** fixtures/SR-028/records with `files` written on top, opened in `system/`. */
const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ ws: FixtureWorkspace; workspace: Workspace }> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-028/records", files });
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(async () => {
    await workspace.close();
    await ws.cleanup();
  });
  return { ws, workspace };
};

/** The record of requirement A in the fixture, as the reader gives it. */
const RECORD_A: EvidenceRecord = {
  element: A,
  version: A_VERSION,
  kind: "verification",
  method: "test",
  item: "build-512",
  result: "passed",
  date: "2026-10-20T14:00:00Z",
  evidence: "https://ci.example.com/runs/512",
  testCase: "wind speed in km/h",
  source: "markdown",
  repository: "ci-results",
  file: "evidence/2026-10-20-SR-000001-test.md",
  line: 1,
};

const RECORD_B: EvidenceRecord = {
  element: B,
  version: "n1:00000000000000b2",
  kind: "verification",
  method: "inspection",
  item: "Display sample B2",
  result: "passed",
  date: "2026-10-21T09:00:00Z",
  source: "markdown",
  repository: "ci-results",
  file: "evidence/nightly/2026-10-21-SR-000002-inspection.md",
  line: 1,
};

const FILE: EvidenceFile = {
  repository: "results",
  file: "evidence/r.md",
  absolute: "/nowhere/evidence/r.md",
  ext: "md",
};

const read = (text: string | Uint8Array): ReturnType<typeof readMarkdownRecord> =>
  readMarkdownRecord(FILE, typeof text === "string" ? new TextEncoder().encode(text) : text);

/** A valid verification record of A as frontmatter lines, with `extra` lines added before the end. */
const record = (extra = "", eol = "\n"): string =>
  [
    "---",
    "reqseq-record: 1",
    "kind: verification",
    `element: ${A}`,
    `version: ${A_VERSION}`,
    "method: analysis",
    "item: model v3",
    "result: failed",
    "date: 2026-10-22T08:15:00+02:00",
    ...(extra === "" ? [] : extra.split("\n")),
    "---",
    "",
    "Text.",
    "",
  ].join(eol);

/**
 * The characters of `text` that the string methods which search or copy it scan while `run` runs:
 * `indexOf` up to its match (or the end), `slice` and `substring` their part, and the whole text for
 * `split`, `lastIndexOf` and `includes`. The spies call through; calls on other strings do not count
 * (a spy may see its receiver boxed, so it is compared as a string).
 */
const scannedBy = (text: string, run: () => unknown): number => {
  const proto = String.prototype;
  const spies: StringSpies = {
    indexOf: vi.spyOn(proto, "indexOf"),
    slice: vi.spyOn(proto, "slice"),
    substring: vi.spyOn(proto, "substring"),
    whole: [vi.spyOn(proto, "split"), vi.spyOn(proto, "lastIndexOf"), vi.spyOn(proto, "includes")],
  };
  try {
    run();
    return scannedOf(text, spies);
  } finally {
    // After reading the calls: restoring a spy clears what it recorded.
    for (const spy of [spies.indexOf, spies.slice, spies.substring, ...spies.whole]) {
      spy.mockRestore();
    }
  }
};

/** The spies `scannedBy` sets on the string methods. */
interface StringSpies {
  readonly indexOf: MockInstance<typeof String.prototype.indexOf>;
  readonly slice: MockInstance<typeof String.prototype.slice>;
  readonly substring: MockInstance<typeof String.prototype.substring>;
  /** `split`, `lastIndexOf`, `includes`: each call counts the whole text. */
  readonly whole: readonly MockInstance[];
}

/** One recorded call on the counted text. */
interface Call<A> {
  readonly args: A;
  readonly result: unknown;
}

/** What `scannedBy` counts, from the calls the spies recorded on `text`. */
const scannedOf = (text: string, spies: StringSpies): number => {
  const { length } = text;
  /** Characters of the part from `a` to `b` (a negative index counts from the end, as `slice` does). */
  const part = (a = 0, b = length): number => {
    const at = (i: number): number => Math.min(length, i < 0 ? Math.max(0, length + i) : i);
    return Math.max(0, at(b) - at(a));
  };
  const on = <A>(mock: { calls: A[]; contexts: unknown[]; results: { value: unknown }[] }): Call<A>[] =>
    mock.calls.flatMap((args, i) =>
      String(mock.contexts[i]) === text ? [{ args, result: mock.results[i]?.value }] : [],
    );
  let scanned = 0;
  for (const { args, result } of on(spies.indexOf.mock)) {
    const [search, from = 0] = args;
    scanned += part(from, result === -1 ? length : Number(result) + search.length);
  }
  for (const { args } of on(spies.slice.mock)) {
    scanned += part(...args);
  }
  for (const { args } of on(spies.substring.mock)) {
    const [a, b = length] = args;
    scanned += part(Math.min(a, b), Math.max(a, b));
  }
  for (const spy of spies.whole) {
    scanned += on(spy.mock).length * length;
  }
  return scanned;
};

describe("SR-028 reading Markdown records", () => {
  it("[SR-028/AK1] reads every record in the evidence folders of the workspace file, nested folders included", async () => {
    const own = record().replace("item: model v3", "item: model v4");
    const { workspace } = await open({
      "system/reqseq-workspace.yaml": `${WORKSPACE_FILE}  - { repository: system, path: verification }\n`,
      "system/verification/deep/er/2026-10-22-SR-000001-analysis.md": own,
    });
    expect(EVIDENCE_READERS).toContain(MARKDOWN_READER);
    const out = await workspace.get(evidenceReadState);
    expect(out.records).toEqual([
      RECORD_A,
      RECORD_B,
      {
        element: A,
        version: A_VERSION,
        kind: "verification",
        method: "analysis",
        item: "model v4",
        result: "failed",
        date: "2026-10-22T08:15:00+02:00",
        source: "markdown",
        repository: "system",
        file: "verification/deep/er/2026-10-22-SR-000001-analysis.md",
        line: 1,
      },
    ]);
    expect(out.problems).toEqual([]);
    expect(out.incomplete).toBe(false);
  });

  it("[SR-028/AK1] reads the records of an evidence folder in the repository of another tool", async () => {
    const { workspace } = await open();
    // `ci-results` holds no element, only the records of the CI (the evidence location of the fixture).
    expect(await workspace.get(evidenceRecordsState)).toEqual([RECORD_A, RECORD_B]);
  });

  it("[SR-028/AK2] assigns a record to its element by UUID and version", async () => {
    const { workspace } = await open();
    const index = await workspace.get(evidenceIndexState);
    expect(index.byElement.get(A)).toEqual([RECORD_A]);
    expect(index.byElement.get(B)).toEqual([RECORD_B]);
    // By version: A's record is of its current version, B's of an older one (SR-025 AK4 reads it so).
    const outdated = await workspace.get(outdatedEvidenceProblemsState);
    expect(outdated.map((p) => [p.code, p.elementId, p.file, p.storedVersion, p.currentVersion])).toEqual([
      ["evidence.outdated", B, RECORD_B.file, "n1:00000000000000b2", B_VERSION],
    ]);
  });

  it("[SR-028/AK2] a Markdown file without reqseq-record in an evidence folder is no record", async () => {
    const { workspace } = await open({
      "ci-results/evidence/notes.md": "# Notes\n\nNo frontmatter at all.\n",
      "ci-results/evidence/list.md": "---\n- reqseq-record\n---\n",
      "ci-results/evidence/odd.md": "---\ntitle: !odd x\n---\n",
    });
    // README.md of the fixture has frontmatter without the key; odd.md's YAML warning is not shown either.
    const out = await workspace.get(evidenceReadState);
    expect(out.records).toEqual([RECORD_A, RECORD_B]);
    expect(out.problems).toEqual([]);
    expect(read("---\ntitle: README\n---\n")).toEqual({ records: [] });
  });

  it("reads a validation record without method and item", () => {
    const text = record()
      .replace("kind: verification", "kind: validation")
      .replace("method: analysis\n", "")
      .replace("item: model v3\n", "");
    const extra = "evidence: ../belege/a.pdf\ntest-case: TC-7";
    expect(read(text.replace("---\n\nText", `${extra}\n---\n\nText`))).toEqual({
      records: [
        {
          element: A,
          version: A_VERSION,
          kind: "validation",
          result: "failed",
          date: "2026-10-22T08:15:00+02:00",
          evidence: "../belege/a.pdf",
          testCase: "TC-7",
          source: "markdown",
          repository: "results",
          file: "evidence/r.md",
          line: 1,
        },
      ],
    });
  });

  it("an invalid record gives evidence.invalid-record with the line of the failing key and no record", () => {
    const text = record().replace("result: failed", "result: maybe").replace("item: model v3\n", "");
    expect(read(text)).toEqual({
      records: [],
      problems: [
        {
          code: "evidence.invalid-record",
          severity: "error",
          repository: "results",
          file: "evidence/r.md",
          line: 1,
          message: "Invalid evidence record, not counted: (root) must have required property 'item'",
        },
        {
          code: "evidence.invalid-record",
          severity: "error",
          repository: "results",
          file: "evidence/r.md",
          line: 7,
          message: "Invalid evidence record, not counted: /result must be equal to one of the allowed values",
        },
      ],
    });
    // `reqseq-record` of another value is a faulty record, not a file to skip.
    expect(read(record().replace("reqseq-record: 1", "reqseq-record: 2")).problems).toMatchObject([
      { code: "evidence.invalid-record", line: 2 },
    ]);
  });

  it("a record without kind names only the missing kind, not a rule of one kind", () => {
    const text = record()
      .replace("kind: verification\n", "")
      .replace("---\n\nText", `variant: ${B}\n---\n\nText`);
    expect(read(text).problems?.map((p) => [p.line, p.message])).toEqual([
      [1, "Invalid evidence record, not counted: (root) must have required property 'kind'"],
    ]);
    const bare = text.replace("method: analysis\n", "").replace("item: model v3\n", "");
    expect(read(bare).problems?.map((p) => p.message)).toEqual([
      "Invalid evidence record, not counted: (root) must have required property 'kind'",
    ]);
  });

  it("a key the format does not know gives a warning and the record counts", () => {
    const out = read(record("tool: pytest-reqseq\nrun:\n  id: 7"));
    expect(out.records).toHaveLength(1);
    expect(out.records[0]).not.toHaveProperty("tool");
    expect(out.problems).toEqual([
      {
        code: "evidence.invalid-record",
        severity: "warning",
        repository: "results",
        file: "evidence/r.md",
        line: 10,
        message:
          'The evidence record has the key "tool", which the format does not know; the record is read without it',
      },
      {
        code: "evidence.invalid-record",
        severity: "warning",
        repository: "results",
        file: "evidence/r.md",
        line: 11,
        message:
          'The evidence record has the key "run", which the format does not know; the record is read without it',
      },
    ]);
    // With an unknown key and a faulty one, the record is not counted, and the warning says so; the
    // problems are in the order of the lines (Ajv reports the unknown key first).
    const faulty = read(record('tool: x\n"": y\n1: z').replace("method: analysis", "method: guess"));
    expect(faulty.records).toEqual([]);
    expect(faulty.problems?.map((p) => [p.line, p.severity, p.message])).toEqual(
      [
        [
          6,
          "error",
          "Invalid evidence record, not counted: /method must be equal to one of the allowed values",
        ],
        [
          10,
          "warning",
          'The evidence record has the key "tool", which the format does not know; the record is not counted for its other errors',
        ],
        [
          11,
          "warning",
          'The evidence record has the key "", which the format does not know; the record is not counted for its other errors',
        ],
        // A key that is no string has no line of its own: the record as a whole.
        [
          1,
          "warning",
          'The evidence record has the key "1", which the format does not know; the record is not counted for its other errors',
        ],
      ].sort((x, y) => Number(x[0]) - Number(y[0])),
    );
  });

  it("finds the lines of many unknown keys in one pass", () => {
    const keys = (n: number): string =>
      Array.from({ length: n }, (_, i) => `extra-${String(i)}: ${String(i)}`).join("\n");
    const out = read(record(keys(500)));
    expect(out.problems).toHaveLength(500);
    expect(out.problems?.map((p) => p.line)).toEqual(Array.from({ length: 500 }, (_, i) => 10 + i));
    // The line lookup alone: 20,000 unknown keys took 69 s with a search per key (review of #556).
    // Linear: the characters of the frontmatter that string methods scan during one call stay within
    // a small multiple of its length; a search per key scans thousands of times that. Counted, not
    // timed, so the result does not depend on the load of the machine (#578). (The YAML parse is the
    // files block's; its duplicate key check is left out so the test looks at the lookup only.)
    const frontmatter = `${keys(40_000)}\nextra-0: again\n`;
    const large = { document: parseDocument(frontmatter, { uniqueKeys: false }), frontmatter };
    const scanned = scannedBy(frontmatter, () => keyLinesOf(large));
    expect(scanned).toBeGreaterThanOrEqual(frontmatter.length);
    expect(scanned).toBeLessThan(3 * frontmatter.length);
    const lines = keyLinesOf(large);
    expect(lines.get("extra-39999")).toBe(40_001);
    // A key written twice (no element file parses with one) keeps its first line.
    expect(lines.get("extra-0")).toBe(2);
  });

  it("reads a record with CRLF line endings and a byte order mark", () => {
    const crlf = record("", "\r\n");
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(crlf)]);
    expect(read(bytes)).toEqual(read(record()));
    expect(read(bytes).records).toHaveLength(1);
    expect(read(crlf.replace("result: failed", "result: x")).problems).toMatchObject([{ line: 8 }]);
  });

  it("a record file that does not parse gives the problem of the files block, with its repository", () => {
    expect(read(`${record()}<<<<<<< HEAD\n=======\n>>>>>>> main\n`)).toEqual({
      records: [],
      problems: [
        {
          code: "file.conflict-markers",
          severity: "error",
          repository: "results",
          file: "evidence/r.md",
          line: 13,
          message: "File has an unresolved Git merge conflict starting at line 13",
        },
      ],
    });
    expect(read("---\nreqseq-record: [1\n---\n").problems).toMatchObject([
      { code: "file.invalid-yaml", repository: "results", file: "evidence/r.md", line: 2 },
    ]);
  });

  it("keeps the YAML warnings of a record", () => {
    expect(read(record("test-case: !odd TC-1")).problems).toMatchObject([
      { code: "file.yaml-warning", severity: "warning", repository: "results", file: "evidence/r.md" },
    ]);
  });
});
