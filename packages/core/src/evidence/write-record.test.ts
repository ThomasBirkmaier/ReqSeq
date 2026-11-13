// The rules of `evidence.record` below the command (SR-030, `write-record.ts`): names, folders and the
// walk rules, the read back, the seams for a faulty render and a name taken meanwhile, and the evidence
// state after the write (S1 of the plan review). Mostly on fixtures/SR-030/record (see its README); the
// variants on fixtures/SR-040/validity with an evidence location added. The tagged tests of the AKs are
// in commands/evidence/record.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { writeFileAtomic } from "../files/index.js";
import { elementStoreState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { MARKDOWN_READER } from "./markdown.js";
import type { EvidenceRecord } from "./record.js";
import { evidenceReadState, evidenceRecordsState, readEvidence } from "./state.js";
import type { PlacedRecord, RecordDeps, RecordFields } from "./write-record.js";
import {
  recordDate,
  recordEvidence,
  recordFileName,
  recordViolations,
  renderRecordFile,
  withRecord,
} from "./write-record.js";

type Output = CommandOutput<"evidence.record">;

const U = (tail: string): string => `30303030-3030-4030-8030-00000000${tail}`;
const S2 = U("c002");
const DATE = "2026-10-27T10:00:00Z";
const INSPECTION = {
  kind: "verification",
  result: "passed",
  method: "inspection",
  item: "unit 7",
  date: DATE,
} as const;

const REPOSITORIES =
  'repositories:\n  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n';

/** A workspace file of the SR-030 fixture with `rest` (evidence, ignore, more repositories) appended. */
const workspaceFile = (rest: string, repositories = ""): string =>
  `reqseq-workspace: 1\nname: Weather station\n${REPOSITORIES}${repositories}metamodel: { repository: system, path: metamodel }\n${rest}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const open = async (
  files: Readonly<Record<string, string>> = {},
  fixture = "SR-030/record",
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const options: FixtureOptions = { fixture, files };
  const opened = await createFixtureWorkspace(options);
  const workspace = new Workspace(opened.root);
  onTestFinished(async () => {
    await workspace.close();
    await opened.cleanup();
  });
  return { fixture: opened, workspace };
};

const record = (workspace: Workspace, input: Readonly<Record<string, unknown>>): Promise<Output> =>
  invoke("evidence.record", input, { workspace }) as Promise<Output>;

const failure = async (action: () => Promise<unknown>): Promise<CommandError> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a CommandError");
};

/** Every file and folder below the fixture root (relative, `/`), except the repository's own `.git` (a created `evidence/.git` shows). */
const entriesOf = async (fixture: FixtureWorkspace): Promise<string[]> =>
  (await fs.readdir(fixture.root, { recursive: true, withFileTypes: true }))
    .map((e) => path.relative(fixture.root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .filter((file) => file !== ".git" && !file.startsWith(".git/"))
    .sort();

/** Expects `action` to fail with `input.invalid` (and `reason` when given) and to leave no file or folder behind. */
const refusedLeavingNothing = async (
  fixture: FixtureWorkspace,
  action: () => Promise<unknown>,
  reason?: string,
): Promise<CommandError> => {
  const before = await entriesOf(fixture);
  const error = await failure(action);
  expect(error.code).toBe("input.invalid");
  if (reason !== undefined) {
    expect(error.details).toMatchObject({ reason });
  }
  expect(await entriesOf(fixture)).toEqual(before);
  return error;
};

const DEFAULT_DEPS: RecordDeps = { render: renderRecordFile, write: writeFileAtomic, now: () => new Date() };

describe("record files (SR-030, pure)", () => {
  it("names a file by day, short ID and method, validation for a validation record, -n from the second", () => {
    expect(recordFileName("2026-10-27", "SR-00c002", "inspection", 1)).toBe(
      "2026-10-27-SR-00c002-inspection.md",
    );
    expect(recordFileName("2026-10-27", "N-00a001", "validation", 3)).toBe(
      "2026-10-27-N-00a001-validation-3.md",
    );
  });

  it("gives the time of the call in UTC with whole seconds", () => {
    expect(recordDate(new Date("2026-10-27T10:00:00.789Z"))).toBe("2026-10-27T10:00:00Z");
  });

  it("renders the frontmatter in schema order with reqseq-record first, absent fields left out, LF and no body", () => {
    const fields: RecordFields = {
      "test-case": "TC-1",
      date: DATE,
      result: "passed",
      kind: "verification",
      element: S2,
      version: "n1:8a2f8c93f0261f80",
      method: "test",
      item: "build-30",
    };
    expect(renderRecordFile(fields)).toBe(
      `---\nreqseq-record: 1\nkind: verification\nelement: ${S2}\nversion: n1:8a2f8c93f0261f80\nmethod: test\nitem: build-30\nresult: passed\ndate: ${DATE}\ntest-case: TC-1\n---\n`,
    );
  });

  it("names the input field of each violation of the format, test-case as testCase", () => {
    const base = {
      kind: "verification",
      element: S2,
      version: "n1:8a2f8c93f0261f80",
      result: "passed",
      date: DATE,
    };
    expect(recordViolations({ ...base, method: "test", item: "x" } as RecordFields)).toEqual([]);
    expect(
      recordViolations({ ...base, item: "x", "test-case": 5 } as unknown as RecordFields).map((v) => [
        v.field,
        v.message,
      ]),
    ).toEqual([
      ["method", "method is required for a verification record"],
      ["testCase", "testCase must be string"],
    ]);
  });
});

describe("evidence.record (SR-030)", () => {
  it("names a validation record validation, with or without a method, and the day of the date's own offset", async () => {
    const { workspace } = await open();
    expect(
      (await record(workspace, { ref: "N-00a001", kind: "validation", result: "passed", date: DATE })).files,
    ).toEqual(["evidence/2026-10-27-N-00a001-validation.md"]);
    const late = await record(workspace, {
      ref: "SR-00c002",
      kind: "validation",
      method: "test",
      result: "failed",
      date: "2026-10-27T23:30:00-05:00",
    });
    expect(late.files).toEqual(["evidence/2026-10-27-SR-00c002-validation.md"]);
    expect(late.record).toMatchObject({
      kind: "validation",
      method: "test",
      date: "2026-10-27T23:30:00-05:00",
    });
  });

  it("gives a taken name -2, -3, also when it differs only in case, and never replaces a file", async () => {
    const taken = "---\nnot: a record\n---\n";
    const { fixture, workspace } = await open({ "evidence/2026-10-27-sr-00C002-INSPECTION.md": taken });
    expect((await record(workspace, { ref: "SR-00c002", ...INSPECTION })).files).toEqual([
      "evidence/2026-10-27-SR-00c002-inspection-2.md",
    ]);
    expect((await record(workspace, { ref: "SR-00c002", ...INSPECTION })).files).toEqual([
      "evidence/2026-10-27-SR-00c002-inspection-3.md",
    ]);
    expect(await fs.readFile(fixture.path("evidence/2026-10-27-sr-00C002-INSPECTION.md"), "utf8")).toBe(
      taken,
    );
  });

  it("takes the next name when the file is created meanwhile, and gives up after three names", async () => {
    const { fixture, workspace } = await open();
    const meanwhile = "made by someone else\n";
    let calls = 0;
    const racing: RecordDeps["write"] = async (root, file, bytes, expected) => {
      calls += 1;
      if (calls === 1) {
        await fs.writeFile(path.join(root, file), meanwhile);
      }
      return writeFileAtomic(root, file, bytes, expected);
    };
    const output = await recordEvidence(
      workspace,
      { ref: "SR-00c002", ...INSPECTION },
      { ...DEFAULT_DEPS, write: racing },
    );
    expect(output.files).toEqual(["evidence/2026-10-27-SR-00c002-inspection-2.md"]);
    expect(await fs.readFile(fixture.path("evidence/2026-10-27-SR-00c002-inspection.md"), "utf8")).toBe(
      meanwhile,
    );
    const names: string[] = [];
    const taken: RecordDeps["write"] = (_root, file) => {
      names.push(file);
      return Promise.reject(new CommandError("file.changed-on-disk", `Not written: ${file} already exists`));
    };
    const error = await failure(() =>
      recordEvidence(
        workspace,
        { ref: "SR-00c002", ...INSPECTION, folder: "reviews" },
        { ...DEFAULT_DEPS, write: taken },
      ),
    );
    expect(error.code).toBe("file.changed-on-disk");
    expect(names).toEqual([
      "reviews/2026-10-27-SR-00c002-inspection.md",
      "reviews/2026-10-27-SR-00c002-inspection-2.md",
      "reviews/2026-10-27-SR-00c002-inspection-3.md",
    ]);
    // Any other error of the write is not retried.
    const broken: RecordDeps["write"] = () => Promise.reject(new Error("disk"));
    await expect(
      recordEvidence(workspace, { ref: "SR-00c002", ...INSPECTION }, { ...DEFAULT_DEPS, write: broken }),
    ).rejects.toThrow("disk");
  });

  it("fills in the time of the call, UTC in whole seconds, when no date is given", async () => {
    const { workspace } = await open();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T01:02:03.456Z"));
    const output = await record(workspace, { ref: "SR-00c002", ...INSPECTION, date: undefined });
    expect([output.record.date, output.files]).toEqual([
      "2026-10-28T01:02:03Z",
      ["evidence/2026-10-28-SR-00c002-inspection.md"],
    ]);
  });

  it("refuses a verification without method or item, naming the input field, and writes nothing", async () => {
    const { fixture, workspace } = await open();
    const error = await refusedLeavingNothing(fixture, () =>
      record(workspace, { ref: "SR-00c002", kind: "verification", result: "passed", date: DATE }),
    );
    expect(error.message).toBe(
      "Invalid input for evidence.record: method is required for a verification record; item is required for a verification record",
    );
    expect(error.details).toMatchObject({
      command: "evidence.record",
      errors: [
        { path: "", field: "method", keyword: "required" },
        { path: "", field: "item", keyword: "required" },
      ],
    });
  });

  it("[SR-028/AK-hdkt] refuses a verification of a need and any record of a use case (D-012), writing nothing", async () => {
    const { fixture, workspace } = await open();
    const need = await refusedLeavingNothing(
      fixture,
      () => record(workspace, { ref: "N-00a001", ...INSPECTION }),
      "D-012",
    );
    expect(need.message).toBe(
      "N-00a001 is of type need: a verification record names a requirement, a validation record a need or a requirement (D-012)",
    );
    for (const kind of ["verification", "validation"]) {
      await refusedLeavingNothing(
        fixture,
        () => record(workspace, { ref: "UC-00e001", ...INSPECTION, kind }),
        "D-012",
      );
    }
  });

  it("gives file.faulty and writes nothing when the element has no current version", async () => {
    const { fixture, workspace } = await open();
    await workspace.get(elementStoreState);
    // The file no longer holds the element the store read.
    await fs.writeFile(
      fixture.path("requirements/SR-00000000c002.md"),
      "---\nid: 30303030-3030-4030-8030-00000000ffff\ntype: system-requirement\nstatus: draft\ntitle: Other\n---\n",
    );
    const before = await entriesOf(fixture);
    const error = await failure(() => record(workspace, { ref: S2, ...INSPECTION }));
    expect([error.code, error.details]).toEqual(["file.faulty", { elementId: S2, reason: "not-in-file" }]);
    expect(await entriesOf(fixture)).toEqual(before);
  });

  it("writes item, evidence and test case that look like other YAML values as the text given", async () => {
    const { workspace } = await open();
    const output = await record(workspace, {
      ref: "SR-00c002",
      ...INSPECTION,
      item: "yes",
      evidence: "see: # the photo, 'quoted' \"too\"",
      testCase: "2026-10-27",
    });
    expect(output.record).toMatchObject({
      item: "yes",
      evidence: "see: # the photo, 'quoted' \"too\"",
      testCase: "2026-10-27",
    });
    const multi = await record(workspace, {
      ref: "SR-00c002",
      ...INSPECTION,
      item: "unit 7\nrev. B",
      testCase: "null",
    });
    expect(multi.record).toMatchObject({ item: "unit 7\nrev. B", testCase: "null" });
  });

  it("refuses a render that does not read back with internal, and creates nothing", async () => {
    const { fixture, workspace } = await open();
    const before = await entriesOf(fixture);
    for (const render of [
      (): string => "---\nreqseq-record: 1\n---\n",
      (fields: RecordFields): string => renderRecordFile({ ...fields, result: "failed" }),
      (fields: RecordFields): string => renderRecordFile(fields).replace("---\n", "---\nextra: 1\n"),
    ]) {
      const error = await failure(() =>
        recordEvidence(
          workspace,
          { ref: "SR-00c002", ...INSPECTION, folder: "reviews/2026" },
          { ...DEFAULT_DEPS, render },
        ),
      );
      expect([error.code, error.message]).toEqual([
        "internal",
        "The record does not read back as intended; nothing written",
      ]);
    }
    expect(await entriesOf(fixture)).toEqual(before);
  });
});

describe("evidence.record folders (SR-030 AK2)", () => {
  it("writes into the first evidence location by default and creates a missing folder below a location", async () => {
    const { fixture, workspace } = await open();
    expect((await record(workspace, { ref: "SR-00c002", ...INSPECTION })).files).toEqual([
      "evidence/2026-10-27-SR-00c002-inspection.md",
    ]);
    expect(
      (await record(workspace, { ref: "SR-00c002", ...INSPECTION, folder: "./reviews/2026/" })).files,
    ).toEqual(["reviews/2026/2026-10-27-SR-00c002-inspection.md"]);
    expect((await fs.stat(fixture.path("reviews/2026"))).isDirectory()).toBe(true);
  });

  it("creates a location that does not exist yet, and passes over locations whose repository is not on this machine", async () => {
    const { workspace } = await open({
      "reqseq-workspace.yaml": workspaceFile(
        "evidence:\n  - { repository: tests, path: evidence }\n  - { repository: unknown, path: evidence }\n  - { repository: system, path: records }\n",
        '  - { name: tests, url: "git@git.example.com:ws/tests.git", path: ../no-such-repository-sr030 }\n',
      ),
    });
    expect((await record(workspace, { ref: "SR-00c002", ...INSPECTION })).files).toEqual([
      "records/2026-10-27-SR-00c002-inspection.md",
    ]);
    const error = await failure(() =>
      record(workspace, { ref: "SR-00c002", ...INSPECTION, folder: "../no-such-repository-sr030/evidence" }),
    );
    expect([error.code, error.message]).toEqual([
      "input.invalid",
      "Repository tests of ../no-such-repository-sr030/evidence is not available on this machine",
    ]);
  });

  it("takes the folder workspace.status gives each location: the root, a folder, another repository, none for an unlisted one (SR-215)", async () => {
    const { workspace } = await open({
      "reqseq-workspace.yaml": workspaceFile(
        "evidence:\n  - { repository: system, path: . }\n  - { repository: system, path: records/ }\n  - { repository: tests, path: evidence }\n  - { repository: unknown, path: evidence }\n",
        '  - { name: tests, url: "git@git.example.com:ws/tests.git", path: ../no-such-repository-sr030 }\n',
      ),
    });
    const status = (await invoke("workspace.status", {}, { workspace })) as CommandOutput<"workspace.status">;
    expect(status.evidence.map((location) => location.folder)).toEqual([
      ".",
      "records",
      "../no-such-repository-sr030/evidence",
      undefined,
    ]);
    // Each folder of a repository on this machine is one evidence.record takes, as it is.
    expect((await record(workspace, { ref: "SR-00c002", ...INSPECTION, folder: "." })).files).toEqual([
      "2026-10-27-SR-00c002-inspection.md",
    ]);
    expect((await record(workspace, { ref: "SR-00c002", ...INSPECTION, folder: "records" })).files).toEqual([
      "records/2026-10-27-SR-00c002-inspection.md",
    ]);
  });

  it("refuses when no location can take the record", async () => {
    const { fixture, workspace } = await open({ "reqseq-workspace.yaml": workspaceFile("") });
    const none = await refusedLeavingNothing(
      fixture,
      () => record(workspace, { ref: "SR-00c002", ...INSPECTION }),
      "no-evidence-location",
    );
    expect(none.message).toBe(
      "The workspace file lists no evidence location, so a record has no folder that is read",
    );
    const away = await open({
      "reqseq-workspace.yaml": workspaceFile(
        "evidence:\n  - { repository: tests, path: evidence }\n",
        '  - { name: tests, url: "git@git.example.com:ws/tests.git", path: ../no-such-repository-sr030 }\n',
      ),
    });
    const unavailable = await refusedLeavingNothing(
      away.fixture,
      () => record(away.workspace, { ref: "SR-00c002", ...INSPECTION }),
      "not-available",
    );
    expect(unavailable.message).toBe(
      "No evidence location lies in a repository on this machine (../no-such-repository-sr030/evidence); give folder in an available one",
    );
  });

  it("refuses a folder below no evidence location, compared segment by segment, and writes nothing", async () => {
    const { fixture, workspace } = await open();
    for (const folder of ["requirements", "evidence2", "evidence/../requirements", "..", "/tmp", ".git"]) {
      const error = await refusedLeavingNothing(
        fixture,
        () => record(workspace, { ref: "SR-00c002", ...INSPECTION, folder }),
        "not-evidence",
      );
      expect(error.message).toBe(
        `${folder} is no evidence location and lies below none, so its records would not be read; the locations are: evidence, reviews`,
      );
    }
  });

  it("refuses a folder the walk would not read (.git, node_modules, ignored, a link) and creates no folder (B1)", async () => {
    const { fixture, workspace } = await open({
      "reqseq-workspace.yaml": workspaceFile(
        "evidence:\n  - { repository: system, path: evidence }\nignore:\n  - evidence/drafts/**\n",
      ),
    });
    await fs.symlink(fixture.path("requirements"), fixture.path("evidence/linked"), "dir");
    for (const [folder, rule] of [
      ["evidence/new/.git/x", "skipped-name"],
      ["evidence/new/node_modules", "skipped-name"],
      ["evidence/.git", "skipped-name"],
      ["evidence/drafts", "ignored"],
      ["evidence/linked", "link"],
    ] as const) {
      const error = await refusedLeavingNothing(fixture, () =>
        record(workspace, { ref: "SR-00c002", ...INSPECTION, folder }),
      );
      expect([folder, error.details]).toMatchObject([folder, { reason: "not-listed", rule }]);
    }
  });

  it("takes a location at the repository root, and the most specific of nested locations", async () => {
    const { workspace } = await open({
      "reqseq-workspace.yaml": workspaceFile(
        "evidence:\n  - { repository: system, path: . }\n  - { repository: system, path: evidence/manual }\n",
      ),
    });
    expect((await record(workspace, { ref: "SR-00c002", ...INSPECTION })).files).toEqual([
      "2026-10-27-SR-00c002-inspection.md",
    ]);
    expect(
      (await record(workspace, { ref: "SR-00c002", ...INSPECTION, folder: "evidence/manual/x" })).record,
    ).toMatchObject({
      repository: "system",
      file: "evidence/manual/x/2026-10-27-SR-00c002-inspection.md",
    });
    const error = await failure(() =>
      record(workspace, { ref: "SR-00c002", ...INSPECTION, folder: "../elsewhere" }),
    );
    expect(error.message).toBe(
      "../elsewhere is no evidence location and lies below none, so its records would not be read; the locations are: ., evidence/manual",
    );
  });
});

describe("evidence.record variants (SR-030, SR-040)", () => {
  const variants = (): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> =>
    open(
      {
        "reqseq-workspace.yaml": `reqseq-workspace: 1\nname: Weather station\n${REPOSITORIES}metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n`,
        "evidence/.keep": "",
      },
      "SR-040/validity",
    );
  const COAST = "40a0e000-0000-4000-8000-a1a1a1a1a1a1";
  const TEST = { kind: "verification", result: "passed", method: "test", item: "build-40", date: DATE };

  it("writes the UUID of a variant the element applies in, and no variant when none is given", async () => {
    const { workspace } = await variants();
    expect(
      (await record(workspace, { ref: "SR-000ab2", ...TEST, variant: "VAR-a1a1a1" })).record.variant,
    ).toBe(COAST);
    expect((await record(workspace, { ref: "SR-000a11", ...TEST })).record).not.toHaveProperty("variant");
  });

  it("names a variant's record by the element's and the variant's short ID, apart from the core's (#647)", async () => {
    const { workspace } = await variants();
    const files = async (variant?: string, ref = "SR-000ab2"): Promise<readonly string[]> =>
      (await record(workspace, { ref, ...TEST, ...(variant === undefined ? {} : { variant }) })).files;
    const day = DATE.slice(0, 10);
    // SR-000ab2 does not apply in the core, so its core record would count nowhere (SR-047 AK5).
    expect(await files(undefined, "SR-000a11")).toEqual([`evidence/${day}-SR-000a11-test.md`]);
    expect(await files("VAR-a1a1a1")).toEqual([`evidence/${day}-SR-000ab2-VAR-a1a1a1-test.md`]);
    // Given by UUID, as the app gives it: the name has the short ID all the same.
    expect(await files(COAST)).toEqual([`evidence/${day}-SR-000ab2-VAR-a1a1a1-test-2.md`]);
    expect(recordFileName(day, "SR-000ab2", "test", 3, "VAR-a1a1a1")).toBe(
      `${day}-SR-000ab2-VAR-a1a1a1-test-3.md`,
    );
  });

  it("refuses core, in any case and for either kind, since it names no variant, and writes nothing (#464)", async () => {
    const { fixture, workspace } = await variants();
    for (const input of [
      { ref: "SR-000a11", ...TEST, variant: "core" },
      { ref: "SR-000ab2", ...TEST, variant: "Core" },
      { ref: "SR-000a11", kind: "validation", result: "passed", date: DATE, variant: "core" },
    ]) {
      const error = await refusedLeavingNothing(
        fixture,
        () => record(workspace, input),
        "core-is-no-variant",
      );
      expect([error.message, error.details]).toEqual([
        `${input.variant} is no variant: variant takes a variant, an element whose type has the meaning variant; leave it out for a record of the core`,
        { command: "evidence.record", fields: ["variant"], reason: "core-is-no-variant" },
      ]);
    }
  });

  it("takes any variant for an element whose type has no validity property, a stray validity notwithstanding (SR-043 AK10, #464)", async () => {
    // The system requirement type without `validity`: SR-000ab2 keeps its entries (Coast, Mountain),
    // which the views pass over, so it is in the view of Desert too.
    const metamodel = await fs.readFile(
      path.join(import.meta.dirname, "../../../../fixtures/SR-040/validity/metamodel/standard-model.yaml"),
      "utf8",
    );
    const { workspace } = await open(
      {
        "reqseq-workspace.yaml": `reqseq-workspace: 1\nname: Weather station\n${REPOSITORIES}metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n`,
        "evidence/.keep": "",
        "metamodel/standard-model.yaml": metamodel.replace(/(acceptance-criteria,\s*)validity,/, "$1"),
      },
      "SR-040/validity",
    );
    expect(
      (await record(workspace, { ref: "SR-000ab2", ...TEST, variant: "VAR-c3c3c3" })).record.variant,
    ).toBe("40a0e000-0000-4000-8000-c3c3c3c3c3c3");
  });

  it("[SR-038/AK-zv5h] refuses a validation record with a variant, names the reason and writes nothing", async () => {
    const { fixture, workspace } = await variants();
    const VALIDATION = { ref: "SR-000ab2", kind: "validation", result: "passed", date: DATE } as const;
    const error = await refusedLeavingNothing(fixture, () =>
      record(workspace, { ...VALIDATION, variant: "VAR-a1a1a1" }),
    );
    expect([error.code, error.message, error.details]).toEqual([
      "input.invalid",
      "Not written: a validation record names no variant, it holds for the core (D-007, SR-038 AK4)",
      { command: "evidence.record", fields: ["variant"], reason: "validation-with-variant", variant: COAST },
    ]);
  });

  it("[SR-047/AK-vd3h] refuses a variant not in the element's validity, naming the reason, and an element that is no variant", async () => {
    const { fixture, workspace } = await variants();
    // Given by UUID, as the app gives it: the message names short IDs, the details the variant (SR-047 AK4).
    const desert = await refusedLeavingNothing(
      fixture,
      () =>
        record(workspace, {
          ref: "40a0e000-0000-4000-8000-000000000ab2",
          ...TEST,
          variant: "40a0e000-0000-4000-8000-c3c3c3c3c3c3",
        }),
      "not-valid-in-variant",
    );
    expect([desert.message, desert.details?.["variant"]]).toEqual([
      "SR-000ab2 does not apply in VAR-c3c3c3, so a record for it there would count nowhere (SR-040)",
      "40a0e000-0000-4000-8000-c3c3c3c3c3c3",
    ]);
    const error = await refusedLeavingNothing(fixture, () =>
      record(workspace, { ref: "SR-000ab2", ...TEST, variant: "SR-000a11" }),
    );
    expect(error.message).toBe(
      "SR-000a11 is no variant: variant takes a variant, an element whose type has the meaning variant",
    );
  });
});

describe("evidence.record and the evidence state (S12, S1 of the plan review)", () => {
  it("adds the record to a built read at its walk position, so the next element.get reads no evidence file", async () => {
    const { workspace } = await open({
      "reqseq-workspace.yaml": workspaceFile(
        "evidence:\n  - { repository: system, path: evidence }\n  - { repository: system, path: evidence/manual }\n  - { repository: system, path: missing }\n",
      ),
      "evidence/2026-12-01-SR-00c002-test.md": `---\nreqseq-record: 1\nkind: verification\nelement: ${S2}\nversion: n1:8a2f8c93f0261f80\nmethod: test\nitem: x\nresult: failed\ndate: 2026-12-01T10:00:00Z\n---\n`,
    });
    const layout = await workspace.get(workspaceLayoutState);
    await workspace.get(evidenceRecordsState);
    const read = vi.spyOn(MARKDOWN_READER, "read");
    for (const folder of ["evidence", "missing/new", "evidence/manual", "evidence/a"]) {
      read.mockClear();
      await record(workspace, { ref: "SR-00c002", ...INSPECTION, folder });
      const state = await workspace.get(evidenceReadState);
      // A full reset instead of the replace would rebuild the state here, through the reader.
      expect(read).not.toHaveBeenCalled();
      // Compared only now: readEvidence uses the reader, and the next mockClear drops those calls.
      expect(state).toEqual(await readEvidence(layout));
    }
    read.mockClear();
    await invoke("element.get", { ref: "SR-00c002" }, { workspace });
    await invoke("evidence.status", {}, { workspace });
    expect(read).not.toHaveBeenCalled();
    expect((await workspace.get(evidenceRecordsState)).map((r) => r.file)).toEqual([
      "evidence/2026-10-01-SR-00c001-test.md",
      "evidence/2026-10-27-SR-00c002-inspection.md",
      "evidence/2026-12-01-SR-00c002-test.md",
      "evidence/a/2026-10-27-SR-00c002-inspection.md",
      "evidence/manual/2026-10-27-SR-00c002-inspection.md",
      "missing/new/2026-10-27-SR-00c002-inspection.md",
    ]);
  });

  it("keeps both records of two calls at once in the evidence state (#308)", async () => {
    const { workspace } = await open();
    const layout = await workspace.get(workspaceLayoutState);
    await workspace.get(evidenceRecordsState);
    // Both files are written before either call updates the state, so both start from the same read.
    let written = 0;
    let release = (): void => undefined;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write: RecordDeps["write"] = async (...args) => {
      const result = await writeFileAtomic(...args);
      written += 1;
      if (written === 2) {
        release();
      }
      await both;
      return result;
    };
    const deps = { ...DEFAULT_DEPS, write };
    await Promise.all([
      recordEvidence(workspace, { ref: "SR-00c002", ...INSPECTION }, deps),
      recordEvidence(workspace, { ref: "SR-00c002", ...INSPECTION, folder: "evidence/a" }, deps),
    ]);
    const files = (await workspace.get(evidenceRecordsState)).map((r) => r.file);
    expect(files).toContain("evidence/2026-10-27-SR-00c002-inspection.md");
    expect(files).toContain("evidence/a/2026-10-27-SR-00c002-inspection.md");
    expect(await workspace.get(evidenceReadState)).toEqual(await readEvidence(layout));
  });

  it("resets a read that runs, and leaves an unbuilt read unbuilt", async () => {
    const { workspace } = await open();
    await record(workspace, { ref: "SR-00c002", ...INSPECTION });
    expect(workspace.peek(evidenceReadState)).toBeUndefined();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(MARKDOWN_READER, "read").mockImplementation(async () => {
      await held;
      return { records: [] };
    });
    const running = workspace.get(evidenceReadState);
    // The read is let go once the file is written; the reset waits for it to end.
    const write: RecordDeps["write"] = async (...args) => {
      const written = await writeFileAtomic(...args);
      release();
      return written;
    };
    await recordEvidence(workspace, { ref: "SR-00c002", ...INSPECTION }, { ...DEFAULT_DEPS, write });
    await running;
    expect(workspace.peek(evidenceReadState)).toBeUndefined();
  });

  it("inserts a record among records without a place, and drops the missing-folder finding it resolves", () => {
    const layout = {
      root: "/w",
      main: "system",
      file: { evidence: [{ repository: "system", path: "evidence" }] },
      repositories: [
        { name: "system", url: "", main: true, path: ".", folder: "/w", available: true, excludes: [] },
      ],
    } as unknown as Parameters<typeof withRecord>[0];
    const injected: EvidenceRecord = {
      element: S2,
      version: "n1:8a2f8c93f0261f80",
      kind: "validation",
      result: "passed",
      date: DATE,
    };
    const written: PlacedRecord = {
      ...injected,
      source: "markdown",
      repository: "system",
      file: "evidence/new/a.md",
      line: 1,
    };
    const missing = {
      code: "evidence.folder-missing",
      severity: "info",
      repository: "system",
      file: "evidence",
      message: "x",
    } as const;
    const other = { ...missing, file: "elsewhere" };
    expect(
      withRecord(
        layout,
        { records: [injected], skipped: [], problems: [missing, other], incomplete: false },
        written,
      ),
    ).toEqual({ records: [injected, written], skipped: [], problems: [other], incomplete: false });
  });
});

describe("evidence.record inconclusive validation (SR-172)", () => {
  const INCONCLUSIVE = { ref: "N-00a001", kind: "validation", result: "inconclusive", date: DATE } as const;
  const WHY = "The field test needs frost:\nnone so far";
  const REQUIRED = "reason is required: a record with the result inconclusive needs a reason (SR-172 AK1)";

  it("[SR-172/AK-gy05] refuses an inconclusive validation without a reason, or with a blank one, naming reason, and writes nothing", async () => {
    const { fixture, workspace } = await open();
    const missing = await refusedLeavingNothing(fixture, () => record(workspace, INCONCLUSIVE));
    expect([missing.message, missing.details]).toEqual([
      `Invalid input for evidence.record: ${REQUIRED}`,
      {
        command: "evidence.record",
        errors: [
          {
            path: "",
            field: "reason",
            keyword: "required",
            message: REQUIRED,
            params: { missingProperty: "reason" },
          },
        ],
      },
    ]);
    const blank = await refusedLeavingNothing(fixture, () =>
      record(workspace, { ...INCONCLUSIVE, reason: " \n\t" }),
    );
    expect(blank.details).toMatchObject({ errors: [{ path: "/reason", keyword: "pattern" }] });
  });

  it("[SR-172/AK-gy05] writes an inconclusive validation with its reason after the result, and reads it back", async () => {
    const { fixture, workspace } = await open();
    const out = await record(workspace, { ...INCONCLUSIVE, reason: WHY });
    expect(out.record).toMatchObject({ kind: "validation", result: "inconclusive", reason: WHY });
    const file = out.files[0] ?? "";
    const text = await fs.readFile(path.join(fixture.root, ...file.split("/")), "utf8");
    expect(text).toMatch(/\nresult: inconclusive\nreason: [|"][\s\S]*\ndate: /);
    expect(await invoke("element.get", { ref: "N-00a001" }, { workspace })).toMatchObject({
      element: { validation: "inconclusive", validationReason: WHY },
    });
  });

  it("[SR-172/AK-r065] refuses an inconclusive verification and a reason with another result, naming the field (#807 Q2, Q4)", async () => {
    const { fixture, workspace } = await open();
    const verification = await refusedLeavingNothing(fixture, () =>
      record(workspace, { ...INSPECTION, ref: "SR-00c002", result: "inconclusive", reason: "no sample" }),
    );
    expect(verification.details).toMatchObject({
      errors: [
        {
          field: "result",
          message:
            "result: only a validation record can be inconclusive, a verification record is passed or failed (SR-172)",
        },
      ],
    });
    const passed = await refusedLeavingNothing(fixture, () =>
      record(workspace, { ...INCONCLUSIVE, result: "passed", reason: "fine" }),
    );
    expect(passed.details).toMatchObject({
      errors: [
        {
          field: "reason",
          message: "reason: only a record with the result inconclusive has a reason (SR-172)",
        },
      ],
    });
  });
});
