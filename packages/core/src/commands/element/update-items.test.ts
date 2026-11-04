// element.update `setItems` (#177): one item of a list property changed or appended by its position
// from 1, every other item keeping its bytes and a replaced text its quoting.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.update">;

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const ITEMS = { id: "69069069-0000-4000-8000-0000000000a1", file: "requirements/TR-0000000000a1.md" };

const ITEMS_FILE = [
  "---",
  `id: ${ITEMS.id}`,
  "type: test-requirement",
  "status: draft",
  "title: Many criteria",
  "acceptance-criteria:",
  '  - "Given a quoted first, then it stays."',
  "  - Given a plain second, when it is read, then it is shown. # kept",
  "  - 'Given a single third, then it stays.'",
  "scores:",
  "  - 1",
  "methods: [test]",
  "---",
  "",
].join("\n");

const open = async (): Promise<{ readonly workspace: Workspace; readonly path: (f: string) => string }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-001/two-elements",
    files: {
      "metamodel/test.yaml": [
        "reqseq-metamodel: 1",
        "types:",
        "  - key: test-requirement",
        "    name: Test Requirement",
        "    prefix: TR",
        "    extends: system-requirement",
        "    properties: [scores, methods]",
        "properties:",
        "  - { key: scores, name: Scores, kind: number, many: true }",
        "  - key: methods",
        "    name: Methods",
        "    kind: choice",
        "    many: true",
        "    choices: [{ key: test, name: Test }, { key: review, name: Peer Review }]",
        "",
      ].join("\n"),
      [ITEMS.file]: ITEMS_FILE,
    },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { workspace, path: (f) => fixture.path(f) };
};

type Opened = Awaited<ReturnType<typeof open>>;

const hashOf = async (opened: Opened, file: string): Promise<string> =>
  createHash("sha256")
    .update(await fs.readFile(opened.path(file)))
    .digest("hex");

const update = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke(
    "element.update",
    { ref: ITEMS.id, expectedFileSha256: await hashOf(opened, ITEMS.file), ...input },
    { workspace: opened.workspace },
  )) as Output;

const refusal = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await update(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.update to fail");
};

const fileOf = (opened: Opened): Promise<string> => fs.readFile(opened.path(ITEMS.file), "utf8");

const criteria = (text: string): string[] =>
  text
    .split("\n")
    .filter((line) => line.startsWith("  - ") && !/^ {2}- \d/.test(line))
    .slice(0, 10);

describe("element.update setItems (#177)", () => {
  it("replaces one item by position; the others keep their bytes, the replaced one its quoting and comment", async () => {
    const opened = await open();
    const out = await update(opened, {
      setItems: {
        "acceptance-criteria": {
          "2": "Given a plain second, when it changes, then it is shown again.",
          "3": "Given a single third, then it changed.",
        },
      },
    });
    expect(out.files).toEqual([ITEMS.file]);
    const text = await fileOf(opened);
    expect(criteria(text)).toEqual([
      '  - "Given a quoted first, then it stays."',
      // Plain stays plain, also with commas.
      "  - Given a plain second, when it changes, then it is shown again. # kept",
      "  - 'Given a single third, then it changed.'",
    ]);
    expect(text.replace(/acceptance-criteria:\n( {2}- .*\n){3}/u, "")).toBe(
      ITEMS_FILE.replace(/acceptance-criteria:\n( {2}- .*\n){3}/u, ""),
    );
  });

  it("appends after the last item without a gap, in the quoting of the last text, also to an absent key", async () => {
    const opened = await open();
    await update(opened, {
      setItems: {
        "acceptance-criteria": { "5": "Fifth, then it is there.", "4": "Fourth, then it is there." },
      },
    });
    expect(criteria(await fileOf(opened)).slice(3)).toEqual([
      "  - 'Fourth, then it is there.'",
      "  - 'Fifth, then it is there.'",
    ]);
    const wind = await invoke(
      "element.update",
      {
        ref: WIND,
        expectedFileSha256: NO_HASH_NEEDED,
        setItems: { "acceptance-criteria": { "1": "First" } },
      },
      { workspace: opened.workspace },
    ).catch((e: unknown) => e as CommandError);
    // A wrong hash is refused; with the file's own one the absent key becomes a list.
    expect((wind as CommandError).code).toBe("file.changed-on-disk");
    const hash = await hashOf(opened, "requirements/SR-6328cee88fb3.md");
    await invoke(
      "element.update",
      { ref: WIND, expectedFileSha256: hash, setItems: { "acceptance-criteria": { "1": "First" } } },
      { workspace: opened.workspace },
    );
    expect(await fs.readFile(opened.path("requirements/SR-6328cee88fb3.md"), "utf8")).toContain(
      "acceptance-criteria:\n  - First\n",
    );
  });

  it("refuses a position after a gap or a file without precondition, and writes nothing", async () => {
    const opened = await open();
    const gap = await refusal(opened, { setItems: { "acceptance-criteria": { "5": "x" } } });
    expect([gap.code, gap.details]).toEqual([
      "input.invalid",
      { key: "acceptance-criteria", position: 5, length: 3, reason: "position-out-of-range" },
    ]);
    expect(gap.message).toContain("positions 1 to 3 to replace");
    const missing = await invoke(
      "element.update",
      { ref: ITEMS.id, setItems: { "acceptance-criteria": { "1": "x" } } },
      { workspace: opened.workspace },
    ).catch((e: unknown) => e as CommandError);
    expect([(missing as CommandError).code, (missing as CommandError).details]).toEqual([
      "input.invalid",
      { field: "expectedFileSha256", reason: "precondition-missing" },
    ]);
    for (const position of ["0", "01"]) {
      const bad = await refusal(opened, { setItems: { "acceptance-criteria": { [position]: "x" } } });
      expect(bad.code).toBe("input.invalid");
    }
    expect(await fileOf(opened)).toBe(ITEMS_FILE);
  });

  it("refuses keys that are no list, relation properties and keys of set, before anything is read", async () => {
    const opened = await open();
    const reasons = [];
    for (const setItems of [
      { "requirement-type": { "1": "functional" } },
      { validity: { "1": "x" } },
      { "acceptance-criteria": { "1": "x" } },
      { title: { "1": "x" } },
    ]) {
      const error = await refusal(opened, {
        setItems,
        set: { "acceptance-criteria": ["x"] },
      });
      reasons.push((error.details as { reason?: string }).reason);
    }
    expect(reasons).toEqual(["not-a-list", "relation-property", "set-and-setItems", "title"]);
    expect(await fileOf(opened)).toBe(ITEMS_FILE);
  });

  it("refuses a list property whose file holds one value", async () => {
    const opened = await open();
    await fs.writeFile(opened.path(ITEMS.file), ITEMS_FILE.replace("scores:\n  - 1\n", "scores: 7\n"));
    const error = await refusal(opened, { setItems: { scores: { "1": 2 } } });
    expect([error.code, error.details]).toEqual(["input.invalid", { key: "scores", reason: "not-a-list" }]);
  });

  it("takes a choice by its name and refuses an item of a number list that is no number", async () => {
    const opened = await open();
    await update(opened, { setItems: { methods: { "2": "peer review" }, scores: { "2": 3 } } });
    const text = await fileOf(opened);
    expect(text).toContain("methods:\n  - test\n  - review\n");
    expect(text).toContain("scores:\n  - 1\n  - 3\n");
    const error = await refusal(opened, { setItems: { scores: { "1": "high" } } });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { key: "scores", position: 1, reason: "not-a-number" },
    ]);
    expect(error.message).toMatch(/^scores item 1: /u);
  });

  it("refuses a blank item of a choice or number list, as set does, and warns of a blank text item (#841)", async () => {
    const opened = await open();
    for (const setItems of [{ methods: { "1": "" } }, { scores: { "1": "" } }]) {
      const error = await refusal(opened, { setItems });
      expect(error.code).toBe("input.invalid");
    }
    expect(await fileOf(opened)).toBe(ITEMS_FILE);
    const out = await update(opened, { setItems: { "acceptance-criteria": { "2": " " } } });
    expect((out.problems ?? []).filter((p) => p.code === "element.text-emptied")).toEqual([
      expect.objectContaining({
        severity: "warning",
        key: "acceptance-criteria",
        message: expect.stringContaining("Item 2 of property") as unknown,
      }),
    ]);
  });

  it("stores a reference in a criterion as set does, and writes nothing for the same value (SR-127)", async () => {
    const opened = await open();
    await update(opened, {
      setItems: {
        "acceptance-criteria": {
          "1": "Given [the wind](reqseq:e8df96ea-a168-4d90-8d65-6328cee88fb3), then it is shown.",
        },
      },
    });
    expect(criteria(await fileOf(opened))[0]).toMatch(
      /^ {2}- "Given \[the wind\]\(reqseq:e8df96ea-a168-4d90-8d65-6328cee88fb3\?version=n1:[0-9a-f]{16}\), then it is shown\."$/u,
    );
    const before = await fileOf(opened);
    const same = await update(opened, {
      setItems: { "acceptance-criteria": { "3": "Given a single third, then it stays." } },
    });
    expect([same.files, await fileOf(opened)]).toEqual([[], before]);
  });
});

/** A hash no file has: `file.changed-on-disk` (SR-106). */
const NO_HASH_NEEDED = "0".repeat(64);
