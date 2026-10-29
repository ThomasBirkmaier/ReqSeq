import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { STANDARD_MODEL_TEXT } from "../../metamodel/index.js";
import { elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"relation.add">;
type Shown = CommandOutput<"element.get">;

/** fixtures/SR-001/two-elements: WIND, and GUSTS (written by hand), which derives from WIND. */
const WIND = { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", file: "requirements/SR-6328cee88fb3.md" };
const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/SR-1d2e3f4a5b6c.md" };
/** Added to SR-001/two-elements. */
const NEED = { id: "0b7c6e1a-1111-4222-8333-aaaaaaaaaaa1", file: "needs/N-aaaaaaaaaaa1.md" };
const NEED2 = { id: "0b7c6e1a-1111-4222-8333-aaaaaaaaaaa2", file: "needs/N-aaaaaaaaaaa2.md" };
const DECISION = { id: "0b7c6e1a-1111-4222-8333-ddddddddddd1", file: "decisions/D-ddddddddddd1.md" };
const GADGET = { id: "0b7c6e1a-1111-4222-8333-eeeeeeeeeee1", file: "requirements/X-eeeeeeeeeee1.md" };

const element = (id: string, type: string, title: string, extra = ""): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: draft\ntitle: ${title}\n${extra}---\n\nText.\n`;

const TWO: FixtureOptions = {
  fixture: "SR-001/two-elements",
  files: {
    [NEED.file]: element(NEED.id, "need", "Need one"),
    [NEED2.file]: element(NEED2.id, "need", "Need two"),
    [DECISION.file]: element(DECISION.id, "decision", "Decision"),
    [GADGET.file]: element(GADGET.id, "gadget", "Gadget"),
  },
};

/** fixtures/SR-021/targets: a requirement and a need in `system`, a need in `sensor`. */
const SR = { id: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05", file: "requirements/SR-3d8b2c6e1f05.md" };
const SYSTEM_NEED = { id: "0c8a3e5f-2d1b-4f6e-8a9c-7b3d5e1f2a4c", file: "needs/N-7b3d5e1f2a4c.md" };
const SENSOR_NEED = { id: "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21", file: "needs/N-0e9d7c5b3a21.md" };

/** fixtures/SR-090/cycle: A -> B -> C -> A, A -> the need, D -> A. */
const P = "5e9c0a7d-2b4f-4c61-9d08-0";
const CYCLE_NEED = { id: `${P}a0000000001`, file: "needs/N-0a0000000001.md" };
const A = { id: `${P}b0000000001`, file: "requirements/SR-0b0000000001.md" };
const B = { id: `${P}b0000000002`, file: "requirements/SR-0b0000000002.md" };
const C = { id: `${P}b0000000003`, file: "requirements/SR-0b0000000003.md" };
const D = { id: `${P}b0000000004`, file: "requirements/SR-0b0000000004.md" };

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  /** The workspace folder in the fixture; `""` for its root. */
  readonly root: string;
}

const open = async (options: FixtureOptions = TWO, root = ""): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === "" ? fixture.root : fixture.path(root));
  onTestFinished(() => workspace.close());
  return { fixture, workspace, root };
};

const add = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("relation.add", input, { workspace: opened.workspace })) as Output;

const addError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await add(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected relation.add to fail");
};

/** A file relative to the workspace root (`../sensor/...` for another repository). */
const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(opened.root === "" ? file : `${opened.root}/${file}`), "utf8");

const readAll = (opened: Opened, files: readonly string[]): Promise<string[]> =>
  Promise.all(files.map((file) => read(opened, file)));

/** The current version of an element as `element.get` shows it. */
const versionOf = async (opened: Opened, ref: string): Promise<string> => {
  const shown = (await invoke("element.get", { ref }, { workspace: opened.workspace })) as Shown;
  const { version } = shown.element;
  // Optional in the schema (#282); every element of these fixtures has one.
  if (version === undefined) {
    throw new Error(`element.get gives no version for ${ref}`);
  }
  return version;
};

/** The lines of `after` that are not in `before`, and the lines of `before` that are not in `after` (by position). */
const lineDiff = (before: string, after: string): { added: string[]; removed: string[] } => {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end += 1;
  }
  return { added: b.slice(start, b.length - end), removed: a.slice(start, a.length - end) };
};

describe("relation.add stores UUID and current version of the target in the source file (SR-021, SR-005, SR-041)", () => {
  it("[SR-021/AK1] writes UUID, current version and title of a target in the same repository; the target file stays", async () => {
    const opened = await open({ fixture: "SR-021/targets" }, "system");
    const [before, target] = await readAll(opened, [SR.file, SYSTEM_NEED.file]);
    const version = await versionOf(opened, SYSTEM_NEED.id);
    const out = await add(opened, { source: SR.id, kind: "derives-from", target: SYSTEM_NEED.id });
    expect(out).toEqual({ files: [SR.file], problems: [] });
    const after = await read(opened, SR.file);
    expect(after).toBe(
      before?.replace(
        "\n---\n\nThe display",
        `\nderives-from:\n  - { id: ${SYSTEM_NEED.id}, version: ${version}, title: Wind speed visible at a glance }\n---\n\nThe display`,
      ),
    );
    expect(await read(opened, SYSTEM_NEED.file)).toBe(target);
  });

  it("[SR-005/AK1] writes only UUID, version and repository name of a target in another repository, no title", async () => {
    const opened = await open({ fixture: "SR-021/targets" }, "system");
    const before = await read(opened, SR.file);
    const version = await versionOf(opened, SENSOR_NEED.id);
    const out = await add(opened, { source: SR.id, kind: "derives-from", target: SENSOR_NEED.id });
    expect(out.files).toEqual([SR.file]);
    expect(lineDiff(before, await read(opened, SR.file))).toEqual({
      added: ["derives-from:", `  - { id: ${SENSOR_NEED.id}, version: ${version}, repository: sensor }`],
      removed: [],
    });
    expect(await read(opened, SR.file)).not.toContain("Measure gusts");
  });

  it("[SR-041/AK2] a relation replaces stores the version of the replaced core requirement", async () => {
    const opened = await open();
    const version = await versionOf(opened, WIND.id);
    const out = await add(opened, { source: GUSTS.id, kind: "replaces", target: "SR-e88fb3" });
    expect(out.files).toEqual([GUSTS.file]);
    expect(await read(opened, GUSTS.file)).toContain(
      `\nreplaces:\n  - { id: ${WIND.id}, version: ${version}, title: Show wind speed }\n---\n`,
    );
  });

  it("[SR-102/AK1] changes only the line of the new relation in a file written by hand", async () => {
    const opened = await open();
    const before = await read(opened, GUSTS.file);
    const version = await versionOf(opened, NEED.id);
    await add(opened, { source: GUSTS.id, kind: "derives-from", target: NEED.id });
    const after = await read(opened, GUSTS.file);
    expect(lineDiff(before, after)).toEqual({
      added: [`  - { id: ${NEED.id}, version: ${version}, title: Need one }`],
      removed: [],
    });
    // Right after the relation that was there; comments, quoting and key order stay.
    expect(after).toContain(
      `title: Show wind speed }\n  - { id: ${NEED.id}, version: ${version}, title: Need one }\n---\n`,
    );
  });

  it("[SR-102/AK3] two branches that add different relations to one element each add their own line; Git merges them", async () => {
    const opened = await open({ ...TWO, git: true });
    const { fixture } = opened;
    const base = await read(opened, GUSTS.file);
    /** On a new branch from main: adds the relation from GUSTS to `target` and commits; the added lines. */
    const onBranch = async (branch: string, target: string): Promise<string[]> => {
      await fixture.git(["checkout", "--quiet", "-b", branch, "main"]);
      const workspace = new Workspace(fixture.root);
      try {
        await invoke("relation.add", { source: GUSTS.id, kind: "derives-from", target }, { workspace });
      } finally {
        await workspace.close();
      }
      await fixture.commit(".", `relation on ${branch}`);
      return lineDiff(base, await read(opened, GUSTS.file)).added;
    };
    const alice = await onBranch("alice", NEED.id);
    const bob = await onBranch("bob", NEED2.id);
    expect([alice.length, bob.length]).toEqual([1, 1]);
    await fixture.git(["checkout", "--quiet", "main"]);
    await fixture.git(["merge", "--quiet", "--no-edit", "alice"]);
    // Both append to the same list: Git stops with one conflict.
    await expect(fixture.git(["merge", "--quiet", "--no-edit", "bob"])).rejects.toThrow();
    const conflicted = await read(opened, GUSTS.file);
    // Each side of the conflict is exactly the one line of its relation.
    const block = `<<<<<<< HEAD\n${alice.join("\n")}\n=======\n${bob.join("\n")}\n>>>>>>> bob\n`;
    expect(conflicted).toBe(base.replace("\n---\n\nThe station", `\n${block}---\n\nThe station`));
    // Resolved as usual by keeping both lines, then committed.
    await fixture.write(GUSTS.file, conflicted.replace(block, `${alice.join("\n")}\n${bob.join("\n")}\n`));
    await fixture.git(["add", GUSTS.file]);
    await fixture.git(["commit", "--quiet", "--no-edit"]);
    expect(await fixture.git(["status", "--porcelain"])).toBe("");
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const shown = (await invoke("element.get", { ref: GUSTS.id }, { workspace })) as Shown;
    expect(shown.element.relations.filter((r) => r.kind === "derives-from").map((r) => r.id)).toEqual([
      WIND.id,
      NEED.id,
      NEED2.id,
    ]);
    // Only the hints the hand-written fixture has anyway: an unknown property (SR-016) and the
    // made-up version it stores for WIND (SR-025, shown at the element, SR-026 AK3); the merged file
    // reads cleanly.
    expect(shown.element.problems?.map((p) => [p.code, p.targetId])).toEqual([
      ["element.unknown-property", undefined],
      ["relation.outdated", WIND.id],
    ]);
  });

  it("keeps a relation the source already has with its stored version and writes nothing", async () => {
    const opened = await open();
    const before = await read(opened, GUSTS.file);
    const out = await add(opened, { source: "SR-4a5b6c", kind: "derives-from", target: "SR-e88fb3" });
    expect(out).toEqual({ files: [], problems: [] });
    expect(await read(opened, GUSTS.file)).toBe(before);
  });

  it("puts the written file into the element store, so element.get shows the relation", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    await add(opened, { source: WIND.id, kind: "based-on", target: DECISION.id });
    const shown = (await invoke("element.get", { ref: WIND.id }, { workspace: opened.workspace })) as Shown;
    expect(shown.element.relations).toEqual([
      expect.objectContaining({ kind: "based-on", direction: "out", id: DECISION.id, title: "Decision" }),
    ]);
  });
});

describe("relation.add sets only relations the metamodel allows (SR-067 AK1, SR-086)", () => {
  it("[SR-067/AK1] refuses a relation from a source type the kind does not allow, with source, target and kind", async () => {
    const opened = await open();
    const before = await read(opened, NEED.file);
    const error = await addError(opened, { source: NEED.id, kind: "derives-from", target: WIND.id });
    expect([error.code, error.details]).toEqual([
      "relation.not-allowed",
      { relation: "derives-from", sourceType: "need", targetType: "system-requirement" },
    ]);
    expect(error.message).toMatch(
      /^Relation Derives from \(derives-from\) from Need N-\w+ to System Requirement SR-e88fb3 is not allowed; allowed: from System Requirement to Need, Use Case, System Requirement$/,
    );
    expect(await read(opened, NEED.file)).toBe(before);
  });

  it("refuses a relation to a target type the kind does not allow", async () => {
    const opened = await open();
    const error = await addError(opened, { source: WIND.id, kind: "based-on", target: GUSTS.id });
    expect([error.code, error.details]).toEqual([
      "relation.not-allowed",
      { relation: "based-on", sourceType: "system-requirement", targetType: "system-requirement" },
    ]);
    expect(error.message).toMatch(/is not allowed; allowed: to Decision$/);
  });

  it("allows a target whose type the metamodel does not know, as the check does (SR-016)", async () => {
    const opened = await open();
    const out = await add(opened, { source: WIND.id, kind: "derives-from", target: GADGET.id });
    expect(out.files).toEqual([WIND.file]);
  });

  it("refuses a key that is no relation kind", async () => {
    const opened = await open();
    const unknown = await addError(opened, { source: WIND.id, kind: "nope", target: GUSTS.id });
    expect([unknown.code, unknown.message, unknown.details]).toEqual([
      "input.invalid",
      "The metamodel has no relation kind nope; relation kinds from System Requirement: refines, derives-from, based-on, supersedes, replaces",
      {
        kind: "nope",
        reason: "unknown-relation",
        allowed: ["refines", "derives-from", "based-on", "supersedes", "replaces"],
      },
    ]);
    const property = await addError(opened, { source: WIND.id, kind: "validity", target: GUSTS.id });
    expect([property.code, property.details]).toEqual([
      "input.invalid",
      { kind: "validity", reason: "property" },
    ]);
  });

  it("names no relation kind when the metamodel allows none from the type", async () => {
    const model = await fs.readFile(
      new URL("../../../../../fixtures/SR-001/two-elements/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    );
    const opened = await open({
      ...TWO,
      files: {
        ...TWO.files,
        "metamodel/standard-model.yaml": model.replace(
          /\nrelations:\n[\s\S]*?\nstatuses:/,
          "\nrelations: []\n\nstatuses:",
        ),
      },
    });
    const error = await addError(opened, { source: WIND.id, kind: "derives-from", target: GUSTS.id });
    expect([error.message, error.details]).toEqual([
      "The metamodel has no relation kind derives-from; relation kinds from System Requirement: none",
      { kind: "derives-from", reason: "unknown-relation", allowed: [] },
    ]);
  });

  it("refuses an unknown reference, a source of a type the metamodel does not know and a value that is no list", async () => {
    const opened = await open({
      ...TWO,
      files: {
        ...TWO.files,
        [NEED2.file]: element(
          NEED2.id,
          "need",
          "Need two",
          `refines: { id: ${NEED.id}, version: n1:1111111111111111 }\n`,
        ),
      },
    });
    const unknown = await addError(opened, { source: "SR-ffffff", kind: "derives-from", target: WIND.id });
    expect(unknown.code).toBe("ref.unknown");
    const target = await addError(opened, { source: WIND.id, kind: "derives-from", target: "N-ffffff" });
    expect(target.code).toBe("ref.unknown");
    const readOnly = await addError(opened, { source: GADGET.id, kind: "refines", target: WIND.id });
    expect([readOnly.code, readOnly.details]).toEqual([
      "element.read-only",
      { id: GADGET.id, type: "gadget", reason: "unknown-type" },
    ]);
    const before = await read(opened, NEED2.file);
    const notList = await addError(opened, { source: NEED2.id, kind: "refines", target: WIND.id });
    expect([notList.code, notList.details]).toEqual([
      "input.invalid",
      { kind: "refines", file: NEED2.file, reason: "not-a-list" },
    ]);
    expect(await read(opened, NEED2.file)).toBe(before);
  });

  it("refuses to write a file that changed on disk since it was read", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    const changed = `${await read(opened, WIND.file)}More.\n`;
    await opened.fixture.write(WIND.file, changed);
    const error = await addError(opened, { source: WIND.id, kind: "based-on", target: DECISION.id });
    expect(error.code).toBe("file.changed-on-disk");
    expect(await read(opened, WIND.file)).toBe(changed);
  });
});

describe("relation.add gives a stored target without a valid version its current version (SR-021 AK1, #302)", () => {
  /** A requirement written by a migration script: targets as `{ id, title }`, no version (ADR-0005). */
  const MIGRATED = { id: "0b7c6e1a-1111-4222-8333-fffffffffff1", file: "requirements/SR-fffffffffff1.md" };
  const migrated = (items: readonly string[]): FixtureOptions => ({
    ...TWO,
    files: {
      ...TWO.files,
      [MIGRATED.file]: element(
        MIGRATED.id,
        "system-requirement",
        "Migrated",
        `derives-from:\n${items.map((item) => `  - ${item}\n`).join("")}`,
      ),
    },
  });
  const versionAdded = (version: string, line: number): Problem => ({
    code: "relation.version-added",
    severity: "info",
    message:
      "System Requirement SR-fffff1 had the relation Derives from (derives-from) to Need N-aaaaa1 without a valid version; its current version is stored now",
    repository: "system",
    file: MIGRATED.file,
    line,
    elementId: MIGRATED.id,
    elementShortId: "SR-fffff1",
    targetId: NEED.id,
    currentVersion: version,
  });

  it("[SR-021/AK1] writes the current version into the stored entry in place, changes only its line and says so", async () => {
    const opened = await open(
      migrated([`{ id: ${NEED.id}, title: "Need one" }`, `{ id: ${NEED2.id}, title: "Need two" }`]),
    );
    const before = await read(opened, MIGRATED.file);
    const version = await versionOf(opened, NEED.id);
    const out = await add(opened, { source: "SR-fffff1", kind: "derives-from", target: NEED.id });
    expect(out).toEqual({ files: [MIGRATED.file], problems: [versionAdded(version, 7)] });
    expect(lineDiff(before, await read(opened, MIGRATED.file))).toEqual({
      added: [`  - { id: ${NEED.id}, version: ${version}, title: Need one }`],
      removed: [`  - { id: ${NEED.id}, title: "Need one" }`],
    });
    // The value-kind hint on the entry is gone; the one on the other entry stays.
    const shown = (await invoke(
      "element.get",
      { ref: MIGRATED.id },
      { workspace: opened.workspace },
    )) as Shown;
    const kinds = shown.element.problems?.filter((p) => p.code === "element.wrong-value-kind");
    expect(kinds?.map((p) => [p.line, p.message.endsWith("item 2 is a mapping without version")])).toEqual([
      [8, true],
    ]);
  });

  it("[SR-021/AK1] replaces a version that is no version, and a second call keeps the stored one", async () => {
    const opened = await open(migrated([`{ id: ${NEED.id}, version: "2026-01-01", title: Need one }`]));
    const version = await versionOf(opened, NEED.id);
    const out = await add(opened, { source: MIGRATED.id, kind: "derives-from", target: "N-aaaaa1" });
    expect(out).toEqual({ files: [MIGRATED.file], problems: [versionAdded(version, 7)] });
    const after = await read(opened, MIGRATED.file);
    expect(after).toContain(`\n  - { id: ${NEED.id}, version: ${version}, title: Need one }\n---\n`);
    expect(await add(opened, { source: MIGRATED.id, kind: "derives-from", target: NEED.id })).toEqual({
      files: [],
      problems: [],
    });
    expect(await read(opened, MIGRATED.file)).toBe(after);
  });

  it("keeps the file when another entry for the target has a valid version, as element.update does", async () => {
    const opened = await open(
      migrated([`{ id: ${NEED.id} }`, `{ id: ${NEED.id}, version: n1:0000000000000000, title: Need one }`]),
    );
    const before = await read(opened, MIGRATED.file);
    const out = await add(opened, { source: MIGRATED.id, kind: "derives-from", target: NEED.id });
    expect(out).toEqual({ files: [], problems: [] });
    expect(await read(opened, MIGRATED.file)).toBe(before);
  });

  it("[SR-005/AK1] fills in the version of a target in another repository and keeps its repository name", async () => {
    const opened = await open({ fixture: "SR-021/targets" }, "system");
    const stored = await read(opened, SR.file);
    await opened.fixture.write(
      `system/${SR.file}`,
      stored.replace(
        "\n---\n\nThe display",
        `\nderives-from:\n  - { id: ${SENSOR_NEED.id}, repository: sensor }\n---\n\nThe display`,
      ),
    );
    const before = await read(opened, SR.file);
    const version = await versionOf(opened, SENSOR_NEED.id);
    const out = await add(opened, { source: SR.id, kind: "derives-from", target: SENSOR_NEED.id });
    expect(out.files).toEqual([SR.file]);
    expect(out.problems?.map((p) => [p.code, p.targetId, p.currentVersion])).toEqual([
      ["relation.version-added", SENSOR_NEED.id, version],
    ]);
    expect(lineDiff(before, await read(opened, SR.file))).toEqual({
      added: [`  - { id: ${SENSOR_NEED.id}, version: ${version}, repository: sensor }`],
      removed: [`  - { id: ${SENSOR_NEED.id}, repository: sensor }`],
    });
  });

  it("refuses to fill in the version of a relation the metamodel does not allow, and writes nothing", async () => {
    const opened = await open({
      ...TWO,
      files: {
        ...TWO.files,
        [NEED2.file]: element(NEED2.id, "need", "Need two", `derives-from:\n  - { id: ${WIND.id} }\n`),
      },
    });
    const before = await read(opened, NEED2.file);
    const error = await addError(opened, { source: NEED2.id, kind: "derives-from", target: WIND.id });
    expect(error.code).toBe("relation.not-allowed");
    expect(await read(opened, NEED2.file)).toBe(before);
  });
});

describe("relation.add shows a hint when a derivation closes a cycle (SR-067 AK3)", () => {
  const CYCLE: FixtureOptions = { fixture: "SR-090/cycle" };
  const name = (n: number): string =>
    n === 4 ? "System Requirement SR-000004" : `System Requirement SR-b000000000${String(n)}`;

  const finding = (
    source: { readonly id: string; readonly file: string },
    line: number,
    message: string,
    target?: { readonly id: string },
  ): Problem => ({
    code: "trace.cycle",
    severity: "warning",
    message,
    repository: "system",
    file: source.file,
    elementId: source.id,
    elementShortId: name(source === A ? 1 : 4).replace(/^.* /, ""),
    ...(target === undefined ? {} : { targetId: target.id }),
    line,
  });

  it("[SR-067/AK3] writes the relation and names every element of the new cycle with the line of its relation", async () => {
    const opened = await open(CYCLE);
    const out = await add(opened, { source: A.id, kind: "derives-from", target: D.id });
    expect(out.files).toEqual([A.file]);
    const names = `${name(1)}, ${name(4)}`;
    expect(out.problems).toEqual([
      finding(
        A,
        12,
        `${name(1)} is in a cycle of derivations with 2 elements (${names}): its relation Derives from to ${name(4)} leads back to it`,
        D,
      ),
      finding(
        D,
        10,
        `${name(4)} is in a cycle of derivations with 2 elements (${names}): its relation Derives from to ${name(1)} leads back to it`,
        A,
      ),
    ]);
  });

  it("[SR-067/AK3] follows every relation kind with the meaning derivation up from the target", async () => {
    const opened = await open(CYCLE);
    // The need refines D, which derives from A, which derives from the need.
    const out = await add(opened, { source: CYCLE_NEED.id, kind: "refines", target: D.id });
    expect(out.files).toEqual([CYCLE_NEED.file]);
    const need = "Need N-a0000000001";
    expect(out.problems?.map((p) => [p.elementId, p.targetId, p.line])).toEqual([
      [CYCLE_NEED.id, D.id, 7],
      [D.id, A.id, 10],
      [A.id, CYCLE_NEED.id, 10],
    ]);
    expect(out.problems?.[0]?.message).toBe(
      `${need} is in a cycle of derivations with 3 elements (${need}, ${name(4)}, ${name(1)}): its relation Refines to ${name(4)} leads back to it`,
    );
  });

  it("[SR-067/AK3] a relation of an element to itself is a cycle on its own", async () => {
    const opened = await open(CYCLE);
    const out = await add(opened, { source: D.id, kind: "derives-from", target: D.id });
    expect(out.problems).toEqual([
      finding(D, 11, `${name(4)} derives from itself through its relation Derives from`, D),
    ]);
  });

  it("[SR-067/AK3] repeats the hint for a relation that is already there, and writes nothing", async () => {
    const opened = await open(CYCLE);
    const before = await read(opened, C.file);
    const out = await add(opened, { source: C.id, kind: "derives-from", target: A.id });
    expect(out.files).toEqual([]);
    expect(out.problems?.map((p) => [p.elementId, p.targetId])).toEqual([
      [C.id, A.id],
      [A.id, B.id],
      [B.id, C.id],
    ]);
    expect(await read(opened, C.file)).toBe(before);
  });

  it("[SR-067/AK3] finds a cycle across repositories and names each element in its own repository", async () => {
    const X = "0b7c6e1a-1111-4222-8333-000000000001";
    const Y = "0b7c6e1a-1111-4222-8333-000000000002";
    const requirement = (id: string, extra = ""): string =>
      `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: T\nrequirement-type: functional\nacceptance-criteria: [Given, when, then.]\n${extra}---\n`;
    const opened = await open(
      {
        files: {
          "system/logreq-workspace.yaml": [
            "logreq-workspace: 1",
            "name: Across",
            "repositories:",
            "  - { name: system, url: git@example.com:system.git, main: true }",
            "  - { name: platform, url: git@example.com:platform.git, path: ../platform }",
            "metamodel: { repository: system, path: metamodel }",
            "",
          ].join("\n"),
          "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
          // X in system derives from Y in platform.
          "system/requirements/SR-000000000001.md": requirement(
            X,
            `derives-from:\n  - { id: ${Y}, version: n1:1111111111111111, repository: platform }\n`,
          ),
          "platform/requirements/SR-000000000002.md": requirement(Y),
        },
      },
      "system",
    );
    const out = await add(opened, { source: Y, kind: "derives-from", target: X });
    expect(out.files).toEqual(["../platform/requirements/SR-000000000002.md"]);
    expect(out.problems?.map((p) => [p.code, p.repository, p.file, p.line, p.elementId, p.targetId])).toEqual(
      [
        ["trace.cycle", "platform", "requirements/SR-000000000002.md", 9, Y, X],
        ["trace.cycle", "system", "requirements/SR-000000000001.md", 9, X, Y],
      ],
    );
    expect(out.problems?.[0]?.message).toContain("is in a cycle of derivations with 2 elements");
    // Stored across repositories with the repository name (D-058).
    expect(
      await fs.readFile(opened.fixture.path("platform/requirements/SR-000000000002.md"), "utf8"),
    ).toMatch(new RegExp(`\\n {2}- \\{ id: ${X}, version: n1:[0-9a-f]{16}, repository: system \\}\\n---\\n`));
  });

  it("[SR-067/AK3] gives no hint for a derivation that closes no cycle, or a relation of another meaning", async () => {
    const opened = await open(CYCLE);
    expect(await add(opened, { source: D.id, kind: "derives-from", target: CYCLE_NEED.id })).toEqual({
      files: [D.file],
      problems: [],
    });
    // A supersedes D, which derives from A: no derivation, so no cycle.
    expect(await add(opened, { source: A.id, kind: "supersedes", target: D.id })).toEqual({
      files: [A.file],
      problems: [],
    });
  });
});
