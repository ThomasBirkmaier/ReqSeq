// metamodel.changeType (SR-237 AK2–AK4) on the small model of the test helper, and the use counts
// of metamodel.get (SR-236 AK8).
import { describe, expect, it } from "vitest";
import changeType from "./changeType.js";
import type { CommandOutput } from "../../catalog.js";
import {
  MODEL,
  SMALL_MODEL,
  WITH_MISSING_REPOSITORY,
  WORKSPACE_FILE,
  elements,
  failure,
  openSmall,
  run,
} from "../metamodel-commands.test-helper.js";

type Changed = CommandOutput<"metamodel.changeType">;

const change = (workspace: Parameters<typeof run>[0], input: Record<string, unknown>): Promise<Changed> =>
  run<Changed>(workspace, "metamodel.changeType", input);

const NOTE = "  - key: note\n    name: Note\n    prefix: NO\n";

describe("metamodel.changeType changes a type in place (SR-237 AK2)", () => {
  it("[SR-237/AK-m935] changes name, description and meaning at any time, only their lines, no element file", async () => {
    const files = elements([1, "note"]);
    const { workspace, read } = await openSmall(files);
    const changed = await change(workspace, {
      type: "note",
      name: "Remark note",
      description: "A note: short",
      meaning: "need",
    });
    expect(changed).toEqual({
      answer: "Changed the type Remark note; 1 file written.",
      type: {
        key: "note",
        name: "Remark note",
        description: "A note: short",
        prefix: "NO",
        meaning: "need",
        properties: ["title", "remark"],
        required: ["title"],
        statuses: ["draft", "noted"],
      },
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    expect(await read(MODEL)).toBe(
      SMALL_MODEL.replace(
        "    name: Note\n    prefix: NO\n    properties: [title, remark]\n    required: [title]\n    statuses: [draft, noted]\n",
        '    name: Remark note\n    prefix: NO\n    properties: [title, remark]\n    required: [title]\n    statuses: [draft, noted]\n    description: "A note: short"\n    meaning: need\n',
      ),
    );
    for (const [file, text] of Object.entries(files)) {
      expect(await read(file)).toBe(text);
    }
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.types.find((t) => t.key === "note")).toMatchObject({ name: "Remark note", meaning: "need" });

    // null removes the description and the meaning line.
    await change(workspace, { type: "note", description: null, meaning: null });
    expect(await read(MODEL)).not.toMatch(/description:|meaning: need/);
    // A definition with an anchor or alias in it is refused with file and line (SR-236 AK5).
    const { workspace: anchored } = await openSmall(
      {},
      SMALL_MODEL.replace("    name: Note\n", "    name: &n Note\n"),
    );
    const refused = await failure(anchored, "metamodel.changeType", { type: "note", name: "Other" });
    expect([refused.code, refused.details]).toEqual([
      "file.faulty",
      { file: MODEL, line: 16, repository: "system" },
    ]);
  });

  it("refuses an unknown type and a name another type has", async () => {
    const { workspace } = await openSmall();
    expect((await failure(workspace, "metamodel.changeType", { type: "nope", name: "X" })).details).toEqual({
      reason: "unknown",
      type: "nope",
    });
    expect(
      (await failure(workspace, "metamodel.changeType", { type: "note", name: "Hazard" })).details,
    ).toEqual({
      reason: "taken",
      field: "name",
      type: "hazard",
    });
    expect(
      (await failure(workspace, "metamodel.changeType", { type: "note", prefix: "HZ" })).details,
    ).toEqual({
      reason: "taken",
      field: "prefix",
      type: "hazard",
    });
    // Its own name is no other type's.
    expect((await change(workspace, { type: "note", name: "Note" })).files).toEqual([]);
  });
});

describe("metamodel.changeType: prefix and abstract mark only without use (SR-237 AK3)", () => {
  it("[SR-237/AK-b96j] refuses a new prefix and the abstract mark while an element has the type; removing the mark always works", async () => {
    const abstract = SMALL_MODEL.replace("    prefix: RI\n", "    prefix: RI\n    abstract: true\n");
    const { workspace, read } = await openSmall(
      elements([1, "hazard"], [2, "risk", { status: "open" }]),
      abstract,
    );
    for (const input of [{ prefix: "HA" }, { abstract: true }]) {
      const used = await failure(workspace, "metamodel.changeType", { type: "hazard", ...input });
      expect(used.details).toEqual({
        reason: "in-use",
        uses: [{ kind: "type", key: "hazard", count: 1, elements: ["HZ-000001"] }],
      });
    }
    expect(await read(MODEL)).toBe(abstract);
    // The prefix it has, and the abstract mark of an abstract type, change nothing and count nothing.
    expect((await change(workspace, { type: "hazard", prefix: "HZ" })).files).toEqual([]);
    expect((await change(workspace, { type: "risk", abstract: true })).files).toEqual([]);
    expect((await change(workspace, { type: "risk", abstract: false })).files).toEqual([MODEL]);
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // `abstract: false` written in the file is no abstract mark: nothing to change.
    const { workspace: plain } = await openSmall(
      {},
      SMALL_MODEL.replace("    prefix: NO\n", "    prefix: NO\n    abstract: false\n"),
    );
    expect((await change(plain, { type: "note", abstract: false })).files).toEqual([]);
    // A type no element has gets a new prefix and the mark; the comment at the end of the line goes.
    expect((await change(workspace, { type: "note", prefix: "NT", abstract: true })).type).toMatchObject({
      prefix: "NT",
      abstract: true,
    });
    expect(await read(MODEL)).toContain("  - key: note\n    name: Note\n    prefix: NT\n");
    expect(SMALL_MODEL).toContain(NOTE);
  });

  it("refuses a change that needs the uses while a repository is not on this machine", async () => {
    const { workspace } = await openSmall({ [WORKSPACE_FILE]: WITH_MISSING_REPOSITORY });
    expect((await failure(workspace, "metamodel.changeType", { type: "note", prefix: "NT" })).code).toBe(
      "file.folder-missing",
    );
    // A name needs no uses.
    expect((await change(workspace, { type: "note", name: "Remark" })).files).toEqual([MODEL]);
  });
});

describe("metamodel.changeType: a new parent type (SR-237 AK4)", () => {
  it("[SR-237/AK-z6j7] refuses a parent under which the type loses a property or status its elements use, names each with the count", async () => {
    const { workspace, read } = await openSmall(
      elements([1, "risk", { status: "open", severity: "low" }], [2, "risk", { severity: "" }], [3, "risk"]),
    );
    const lost = await failure(workspace, "metamodel.changeType", { type: "risk", extends: "note" });
    expect(lost.details).toEqual({
      reason: "in-use",
      uses: [
        { kind: "property", key: "severity", count: 2, elements: ["RI-000001", "RI-000002"] },
        { kind: "status", key: "open", count: 1, elements: ["RI-000001"] },
      ],
    });
    expect(lost.message).toContain("property severity: 2 elements (RI-000001, RI-000002)");
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-237/AK-z6j7] sets, changes and removes a parent without such use, and counts the new required properties", async () => {
    const model = SMALL_MODEL.replace(
      "    properties: [title, remark]\n    required: [title]",
      "    properties: [title, remark]\n    required: [title, remark]",
    );
    const { workspace, read } = await openSmall(elements([1, "risk"], [2, "hazard"]), model);
    const moved = await change(workspace, { type: "risk", extends: "note" });
    expect([moved.files, moved.missingRequired]).toEqual([[MODEL], 1]);
    expect(await read(MODEL)).toContain("    extends: note\n");
    expect((await change(workspace, { type: "note", extends: "hazard" })).type).toMatchObject({
      extends: "hazard",
    });
    // The parent it has is no change.
    expect((await change(workspace, { type: "note", extends: "hazard" })).files).toEqual([]);
    expect((await change(workspace, { type: "note", extends: null })).files).toEqual([MODEL]);
    expect(await read(MODEL)).not.toContain("extends: hazard");
  });

  it("refuses a parent that would make a cycle as a metamodel error", async () => {
    const { workspace } = await openSmall();
    expect(
      (await failure(workspace, "metamodel.changeType", { type: "hazard", extends: "risk" })).details,
    ).toMatchObject({
      reason: "metamodel-invalid",
    });
  });
});

describe("metamodel.get names the uses of each definition (SR-236 AK8)", () => {
  it("[SR-236/AK-wq1x] counts types, properties, fixed values, relation kinds and statuses, 0 when unused", async () => {
    const { workspace } = await openSmall(
      elements(
        [1, "hazard", { severity: "high", about: "[]" }],
        [2, "risk", { status: "open", severity: '""', likelihood: "rare" }],
        [3, "note", { status: "open", remark: "x" }],
        [4, "gone", { severity: "low" }],
      ),
    );
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.uses).toEqual({
      types: { hazard: 1, risk: 1, note: 1 },
      // A property counts on every element whose file holds its key, of any type, also empty (AK8):
      // the system requirement of the fixture holds a title, the element of type gone a severity.
      properties: { title: 5, severity: 3, likelihood: 1, remark: 1 },
      // A fixed value counts on any element with it, also one of a type the metamodel does not have.
      values: { severity: { low: 1, high: 1 } },
      relations: { about: 1 },
      // A status counts on every element with it, of any type (AK8): the note, which does not have
      // open, and the drafts of type gone and of the fixture's system requirement.
      statuses: { draft: 3, open: 2, noted: 0 },
    });
  });

  it("[SR-236/AK-wq1x] counts a property on an element of another type, of an unknown type and with an empty value, as the refusal of its value kind does", async () => {
    const { workspace } = await openSmall(
      elements(
        [1, "note", { severity: "high" }],
        [2, "gone", { severity: '""' }],
        [3, "hazard", { severity: "low" }],
        [4, "hazard"],
      ),
    );
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.uses.properties["severity"]).toBe(3);
    const refused = await failure(workspace, "metamodel.changeProperty", {
      property: "severity",
      many: true,
    });
    expect(refused.details).toMatchObject({
      reason: "in-use",
      uses: [{ kind: "property", key: "severity", count: 3 }],
    });
  });

  it("[SR-236/AK-wq1x] counts a status on an element of a type without it and of an unknown type, as metamodel.removeStatus names them when it keeps the definition", async () => {
    const { workspace } = await openSmall(
      elements([1, "hazard", { status: "noted" }], [2, "gone", { status: "noted" }]),
    );
    const before = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(before.uses.statuses["noted"]).toBe(2);
    // The note was the last type with noted; the definition stays, as both elements have it (SR-240 AK3).
    const removed = await run<CommandOutput<"metamodel.removeStatus">>(workspace, "metamodel.removeStatus", {
      type: "note",
      status: "noted",
    });
    expect(removed.kept).toMatchObject([{ kind: "status", key: "noted", count: 2 }]);
    const after = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(after.statuses.map((s) => s.key)).toContain("noted");
    expect(after.uses.statuses["noted"]).toBe(2);
  });
});

describe("the answer of metamodel.changeType", () => {
  it("names the change, the files, the elements it affects and the problems", () => {
    const output = {
      type: { key: "note", name: "Note", prefix: "NO" },
      files: [],
      versionsChanged: 0,
      missingRequired: 0,
      problems: [],
    };
    expect(changeType.answer(output as never, { type: "note" }, { type: (key) => key })).toBe(
      "The type Note has these values already; no file written.",
    );
    expect(
      changeType.answer(
        { ...output, files: [MODEL], versionsChanged: 2, missingRequired: 1, problems: [{}] } as never,
        { type: "note" },
        { type: () => "Note" },
      ),
    ).toBe(
      "Changed the type Note; 1 file written; 2 elements with another version; 1 element missing a required property; 1 problem.",
    );
  });
});
