// evidence.record through `invoke` (SR-030) on fixtures/SR-030/record (its README lists every element,
// its records and the status before and after): one repository `system` with the standard model and the
// evidence locations `evidence` and `reviews`. The rules below the command (names, folders, read back,
// the evidence state) are tested in evidence/write-record.test.ts; the same output on every access in
// packages/cli/test/cross-access.test.ts; the CLI in packages/cli/test/e2e/evidence-record.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { evidenceRecordsState, readMarkdownRecord } from "../../evidence/index.js";
import { fileSchemaValidator } from "../../runtime/contracts.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { parseFileBytes } from "../../files/index.js";
import { readFirst } from "../../runtime/read-first.test-helper.js";
import type { FullList } from "../list.test-helper.js";

type Output = CommandOutput<"evidence.record">;

const U = (tail: string): string => `30303030-3030-4030-8030-00000000${tail}`;
const N1 = U("a001");
const S1 = U("c001");
const S2 = U("c002");
const DATE = "2026-10-27T10:00:00Z";

/** S2 with three criteria: its own text with key `kdir`, one with key `kcal`, one without key. */
const S2_FILE = "requirements/SR-00000000c002.md";
const S2_TEXT = "Given the station runs, when it is checked, then it does this - show wind direction.";
const s2With = (criteria: string): string => `---
id: 30303030-3030-4030-8030-00000000c002
type: system-requirement
status: draft
title: Show wind direction
requirement-type: functional
acceptance-criteria:
${criteria}
derives-from:
  - { id: 30303030-3030-4030-8030-00000000a001, version: n1:0bb580565f4c2d88, title: Know the wind }
---

No records.
`;
const S2_KEYED = s2With(`  - { key: kdir, text: "${S2_TEXT}" }
  - Shown in knots.
  - { key: kcal, text: Calibrated }`);
const S2_DOUBLE = s2With(`  - { key: kdup, text: "${S2_TEXT}" }
  - { key: kdup, text: Shown in knots. }`);

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-030/record", files });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return { fixture, workspace };
};

const record = (workspace: Workspace, input: Readonly<Record<string, unknown>>): Promise<Output> =>
  invoke("evidence.record", input, { workspace }) as Promise<Output>;

const failure = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>>,
): Promise<CommandError> => {
  try {
    await record(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a CommandError");
};

const get = async (workspace: Workspace, ref: string): Promise<CommandOutput<"element.get">["element"]> =>
  ((await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">).element;

/** Every file below the fixture root (relative, `/`), except those in the repository's own `.git`. */
const filesOf = async (fixture: FixtureWorkspace): Promise<string[]> =>
  (await fs.readdir(fixture.root, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.relative(fixture.root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .filter((file) => file !== ".git" && !file.startsWith(".git/"))
    .sort();

/** The frontmatter of a written record, parsed. */
const frontmatterOf = async (fixture: FixtureWorkspace, file: string): Promise<unknown> => {
  const parsed = parseFileBytes(file, await fs.readFile(fixture.path(file)));
  if (parsed.kind !== "parsed") {
    throw new Error(`no frontmatter in ${file}`);
  }
  return parsed.content.data;
};

const INSPECTION = {
  kind: "verification",
  result: "passed",
  method: "inspection",
  item: "unit 7",
  date: DATE,
};

describe("evidence.record (SR-030)", () => {
  it("[SR-030/AK-wm0j] evidence.record fills in the UUID and current version of the requirement", async () => {
    const { fixture, workspace } = await open();
    const before = await fs.readFile(fixture.path("requirements/SR-00000000c002.md"));
    const { version } = await get(workspace, "SR-00c002");
    const output = await record(workspace, { ref: "SR-00c002", ...INSPECTION });
    expect(output.files).toEqual(["evidence/2026-10-27-SR-00c002-inspection.md"]);
    expect(await frontmatterOf(fixture, "evidence/2026-10-27-SR-00c002-inspection.md")).toMatchObject({
      "reqseq-record": 1,
      element: S2,
      version,
    });
    expect(output.record).toMatchObject({ element: S2, version });
    // The element's file is never touched.
    expect(await fs.readFile(fixture.path("requirements/SR-00000000c002.md"))).toEqual(before);
  });

  it("[SR-030/AK-wm0j] after the requirement changed, the next record takes its new version", async () => {
    const { fixture, workspace } = await open();
    const first = await record(workspace, { ref: "SR-00c002", ...INSPECTION });
    await invoke(
      "element.update",
      await readFirst({ ref: "SR-00c002", text: "Changed text.\n" }, { workspace }),
      { workspace },
    );
    const { version } = await get(workspace, "SR-00c002");
    expect(version).not.toBe(first.record.version);
    const second = await record(workspace, { ref: "SR-00c002", ...INSPECTION });
    expect(second.record.version).toBe(version);
    expect(second.files).toEqual(["evidence/2026-10-27-SR-00c002-inspection-2.md"]);
    expect(await frontmatterOf(fixture, "evidence/2026-10-27-SR-00c002-inspection-2.md")).toMatchObject({
      version,
    });
  });

  it("[SR-030/AK-k584] a record with kind, method, result, item, date and evidence becomes one Markdown file in the chosen evidence folder", async () => {
    const { fixture, workspace } = await open();
    const before = await filesOf(fixture);
    const { version } = await get(workspace, "SR-00c002");
    const output = await record(workspace, {
      ref: "SR-00c002",
      ...INSPECTION,
      evidence: "photos/unit-7.jpg",
      folder: "reviews",
    });
    const file = "reviews/2026-10-27-SR-00c002-inspection.md";
    expect(output.files).toEqual([file]);
    expect((await filesOf(fixture)).filter((f) => !before.includes(f))).toEqual([file]);
    const frontmatter = await frontmatterOf(fixture, file);
    expect(fileSchemaValidator("evidence-record.schema.json")(frontmatter)).toBe(true);
    const intended = {
      element: S2,
      version,
      kind: "verification",
      method: "inspection",
      item: "unit 7",
      result: "passed",
      date: DATE,
      evidence: "photos/unit-7.jpg",
      source: "markdown",
      repository: "system",
      file,
      line: 1,
    };
    expect(
      readMarkdownRecord(
        { repository: "system", file, absolute: fixture.path(file), ext: "md" },
        await fs.readFile(fixture.path(file)),
      ),
    ).toEqual({ records: [intended] });
    // The answer names where the evidence is (#821); the file holds no such field.
    expect(output).toEqual({
      files: [file],
      record: { ...intended, evidenceSource: "photos/unit-7.jpg" },
      problems: [],
    });
  });

  it("[SR-030/AK-k584] the saved record is read as evidence of the requirement on the same workspace", async () => {
    const { workspace } = await open();
    // The records are read before the call, so the record must reach the built state (S12).
    expect(await workspace.get(evidenceRecordsState)).toHaveLength(1);
    expect((await get(workspace, "SR-00c002")).verification).toEqual([{ view: "core", status: "open" }]);
    const output = await record(workspace, { ref: "SR-00c002", ...INSPECTION, folder: "reviews" });
    const listed = (await invoke(
      "evidence.list",
      { ref: "SR-00c002" },
      { workspace },
    )) as CommandOutput<"evidence.list">;
    expect(listed.records).toEqual([{ ...output.record, baselines: [] }]);
    expect((await get(workspace, "SR-00c002")).verification).toEqual([
      { view: "core", status: "verified", criteria: { verified: 1, total: 1 } },
    ]);
  });

  it("[SR-030/AK-bt7q] a validation record counts for the validation status and not for the verification status", async () => {
    const { workspace } = await open();
    const s1 = await get(workspace, "SR-00c001");
    expect([s1.validation, s1.verification]).toEqual([
      undefined,
      [{ view: "core", status: "verified", criteria: { verified: 1, total: 1 } }],
    ]);
    await record(workspace, { ref: "SR-00c001", kind: "validation", result: "failed", date: DATE });
    const after = await get(workspace, "SR-00c001");
    expect([after.validation, after.verification]).toEqual([
      "failed",
      [{ view: "core", status: "verified", criteria: { verified: 1, total: 1 } }],
    ]);
    // A need: validated, and still no verification status (D-012).
    expect((await get(workspace, "N-00a001")).validation).toBe("open");
    await record(workspace, { ref: "N-00a001", kind: "validation", result: "passed", date: DATE });
    const need = await get(workspace, "N-00a001");
    expect([need.validation, need.verification]).toEqual(["validated", undefined]);
    // A requirement with only a validation record stays without Nachweis.
    await record(workspace, { ref: "SR-00c002", kind: "validation", result: "passed", date: DATE });
    const s2 = await get(workspace, "SR-00c002");
    expect([s2.validation, s2.verification]).toEqual(["validated", [{ view: "core", status: "open" }]]);
    const withEvidence = (await invoke(
      "element.list",
      { selection: { where: { relation: { direction: "evidence" }, exists: true } } },
      { workspace },
    )) as FullList;
    expect(withEvidence.elements.map((e) => e.id)).toEqual([S1]);
    expect(withEvidence.elements.map((e) => e.id)).not.toContain(N1);
  });

  it("[SR-030/AK-x088] takes criteria by number or key, writes their keys and names number, key and the start of the text", async () => {
    const { fixture, workspace } = await open({ [S2_FILE]: S2_KEYED });
    const output = await record(workspace, { ref: "SR-00c002", ...INSPECTION, criteria: ["3", "kdir"] });
    const file = "evidence/2026-10-27-SR-00c002-inspection.md";
    expect(output.files).toEqual([file]);
    const frontmatter = await frontmatterOf(fixture, file);
    expect(frontmatter).toMatchObject({ element: S2, criteria: ["kcal", "kdir"] });
    expect(fileSchemaValidator("evidence-record.schema.json")(frontmatter)).toBe(true);
    expect(output.record.criteria).toEqual(["kcal", "kdir"]);
    expect(output.criteria).toEqual([
      { criterion: 1, key: "kdir", text: S2_TEXT.slice(0, 60) },
      { criterion: 3, key: "kcal", text: "Calibrated" },
    ]);
    expect(output.problems).toEqual([]);
    const listed = (await invoke(
      "evidence.list",
      { ref: "SR-00c002" },
      { workspace },
    )) as CommandOutput<"evidence.list">;
    expect(listed.records).toEqual([
      {
        ...output.record,
        baselines: [],
        // In the order of `criteria` (SR-205 AK2).
        criterionNames: [
          { criterion: 3, key: "kcal", text: "Calibrated" },
          { criterion: 1, key: "kdir", text: S2_TEXT },
        ],
      },
    ]);
    // Without criteria the record holds for every criterion (D-072) and the file names none.
    const all = await record(workspace, { ref: "SR-00c001", ...INSPECTION });
    expect(all.record.criteria).toBeUndefined();
    expect(all.criteria).toBeUndefined();
    expect(await frontmatterOf(fixture, all.files[0] ?? "")).not.toHaveProperty("criteria");
  });

  it("[SR-030/AK-x088] refuses a criterion without key, a number or key the current version lacks, and malformed criteria, and writes nothing", async () => {
    const { fixture, workspace } = await open({ [S2_FILE]: S2_KEYED });
    const before = await filesOf(fixture);
    const refusals: [readonly unknown[], string][] = [
      [[2], "criterion-without-key"],
      [["kdir", 4], "unknown-criterion"],
      [["kxyz"], "unknown-criterion"],
    ];
    for (const [criteria, reason] of refusals) {
      const error = await failure(workspace, { ref: "SR-00c002", ...INSPECTION, criteria });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        expect.objectContaining({ command: "evidence.record", fields: ["criteria"], reason }),
      ]);
    }
    expect((await failure(workspace, { ref: "SR-00c002", ...INSPECTION, criteria: [2] })).message).toBe(
      "Not written: acceptance criterion 2 has no criterion key; give the criteria their keys first (SR-204)",
    );
    expect(await filesOf(fixture)).toEqual(before);
  });

  it("[SR-030/AK-m2qp] refuses a criterion whose key another criterion of the current version carries too, and writes nothing", async () => {
    const { fixture, workspace } = await open({ [S2_FILE]: S2_DOUBLE });
    const before = await filesOf(fixture);
    for (const criteria of [["kdup"], [1], [2]]) {
      const error = await failure(workspace, { ref: "SR-00c002", ...INSPECTION, criteria });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        expect.objectContaining({ fields: ["criteria"], reason: "criterion-key-duplicate" }),
      ]);
    }
    expect(await filesOf(fixture)).toEqual(before);
  });

  it("refuses criteria on a validation record (it counts per element, SR-030 AK3) and malformed or oversized numbers, and writes nothing", async () => {
    const { fixture, workspace } = await open();
    const before = await filesOf(fixture);
    const validation = await failure(workspace, {
      ref: "SR-00c002",
      kind: "validation",
      result: "passed",
      date: DATE,
      criteria: [1],
    });
    expect([validation.code, validation.details]).toEqual([
      "input.invalid",
      { command: "evidence.record", fields: ["criteria"], reason: "validation-with-criteria" },
    ]);
    for (const criteria of [
      [],
      [0],
      [1, 1],
      [1.5],
      ["01"],
      ["K1"],
      ["abc"],
      [Number.MAX_SAFE_INTEGER + 1],
      [1e21],
    ]) {
      expect((await failure(workspace, { ref: "SR-00c002", ...INSPECTION, criteria })).code).toBe(
        "input.invalid",
      );
    }
    expect(await filesOf(fixture)).toEqual(before);
  });

  it("is refused with workspace.read-only while the metamodel is faulty, and writes nothing (ThomasBirkmaier/ReqSeq-archive#142 point b)", async () => {
    const { fixture, workspace } = await open({
      "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: [ { key: x } ]\n",
    });
    const before = await filesOf(fixture);
    expect((await failure(workspace, { ref: "SR-00c002", ...INSPECTION })).code).toBe("workspace.read-only");
    expect(await filesOf(fixture)).toEqual(before);
  });

  it("refuses an unknown element, and the element and version as inputs", async () => {
    const { fixture, workspace } = await open();
    const before = await filesOf(fixture);
    expect((await failure(workspace, { ref: "SR-ffffff", ...INSPECTION })).code).toBe("ref.unknown");
    for (const extra of [{ version: "n1:0000000000000000" }, { element: S1 }]) {
      const error = await failure(workspace, { ref: "SR-00c002", ...INSPECTION, ...extra });
      expect(error.code).toBe("input.invalid");
      expect(error.message).toMatch(
        new RegExp(
          `^Invalid input for evidence\\.record: ${Object.keys(extra)[0] ?? ""} is not an input of this command \\(known: ref, `,
        ),
      );
    }
    expect(await filesOf(fixture)).toEqual(before);
  });
});
