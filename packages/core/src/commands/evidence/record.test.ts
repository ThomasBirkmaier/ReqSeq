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

type Output = CommandOutput<"evidence.record">;

const U = (tail: string): string => `30303030-3030-4030-8030-00000000${tail}`;
const N1 = U("a001");
const S1 = U("c001");
const S2 = U("c002");
const DATE = "2026-10-27T10:00:00Z";

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
  it("[SR-030/AK1] evidence.record fills in the UUID and current version of the requirement", async () => {
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

  it("[SR-030/AK1] after the requirement changed, the next record takes its new version", async () => {
    const { fixture, workspace } = await open();
    const first = await record(workspace, { ref: "SR-00c002", ...INSPECTION });
    await invoke("element.update", { ref: "SR-00c002", text: "Changed text.\n" }, { workspace });
    const { version } = await get(workspace, "SR-00c002");
    expect(version).not.toBe(first.record.version);
    const second = await record(workspace, { ref: "SR-00c002", ...INSPECTION });
    expect(second.record.version).toBe(version);
    expect(second.files).toEqual(["evidence/2026-10-27-SR-00c002-inspection-2.md"]);
    expect(await frontmatterOf(fixture, "evidence/2026-10-27-SR-00c002-inspection-2.md")).toMatchObject({
      version,
    });
  });

  it("[SR-030/AK2] a record with kind, method, result, item, date and evidence becomes one Markdown file in the chosen evidence folder", async () => {
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
    expect(output).toEqual({ files: [file], record: intended, problems: [] });
  });

  it("[SR-030/AK2] the saved record is read as evidence of the requirement on the same workspace", async () => {
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
    expect((await get(workspace, "SR-00c002")).verification).toEqual([{ view: "core", status: "verified" }]);
  });

  it("[SR-030/AK3] a validation record counts for the validation status and not for the verification status", async () => {
    const { workspace } = await open();
    const s1 = await get(workspace, "SR-00c001");
    expect([s1.validation, s1.verification]).toEqual([undefined, [{ view: "core", status: "verified" }]]);
    await record(workspace, { ref: "SR-00c001", kind: "validation", result: "failed", date: DATE });
    const after = await get(workspace, "SR-00c001");
    expect([after.validation, after.verification]).toEqual([
      "failed",
      [{ view: "core", status: "verified" }],
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
    )) as CommandOutput<"element.list">;
    expect(withEvidence.elements.map((e) => e.id)).toEqual([S1]);
    expect(withEvidence.elements.map((e) => e.id)).not.toContain(N1);
  });

  it("is refused with workspace.read-only while the metamodel is faulty, and writes nothing (#142 point b)", async () => {
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
      expect([error.code, error.message]).toEqual([
        "input.invalid",
        `Invalid input for evidence.record: ${Object.keys(extra)[0] ?? ""} is not an input of this command`,
      ]);
    }
    expect(await filesOf(fixture)).toEqual(before);
  });
});
