// Every metamodel change that only works without use refuses while an element file cannot be read
// (SR-236 AK7, SR-008 AK3), naming the number of those files and the first 20 by repository and
// path; a missing repository is named instead. On the small model of the test helper.
import { describe, expect, it } from "vitest";
import type { CommandName } from "../../catalog.js";
import {
  MODEL,
  SMALL_MODEL,
  WITH_MISSING_REPOSITORY,
  WORKSPACE_FILE,
  elements,
  failure,
  openSmall,
  openSmallAcross,
  run,
} from "../metamodel-commands.test-helper.js";

/** An element file whose YAML header cannot be read: it does not show whether it is an element. */
const BROKEN = "---\nid: [\n---\n";

/** Each change that needs the uses, with an input that succeeds while every element file reads. */
const LOCKING: readonly (readonly [CommandName, Readonly<Record<string, unknown>>])[] = [
  ["metamodel.removeType", { type: "risk" }],
  ["metamodel.changeType", { type: "note", prefix: "NT" }],
  ["metamodel.changeType", { type: "note", abstract: true }],
  ["metamodel.changeType", { type: "risk", extends: null }],
  ["metamodel.changeProperty", { property: "remark", kind: "number" }],
  ["metamodel.changeProperty", { property: "remark", many: true }],
  ["metamodel.changeProperty", { property: "severity", removeChoices: ["low"] }],
  ["metamodel.removeProperty", { type: "note", property: "remark" }],
  ["metamodel.removeRelationKind", { kind: "about" }],
  ["metamodel.removeStatus", { type: "note", status: "noted" }],
];

describe("metamodel changes that need the uses, while an element file cannot be read (SR-236 AK7)", () => {
  it.each(LOCKING)(
    "[SR-236/AK-bm7r] [SR-008/AK-kdrw] %s %j refuses with file.faulty, names the file and writes nothing",
    async (command, input) => {
      const { workspace, read } = await openSmall({ "elements/E-broken.md": BROKEN });
      const refused = await failure(workspace, command, input);
      expect([refused.code, refused.details]).toEqual([
        "file.faulty",
        { command, count: 1, files: [{ repository: "system", file: "elements/E-broken.md" }] },
      ]);
      expect(refused.message).toBe(
        `${command} needs every element to count the uses, and 1 element file cannot be read (system:elements/E-broken.md); nothing is written. Fix them first.`,
      );
      expect(await read(MODEL)).toBe(SMALL_MODEL);
      expect(await read("elements/E-broken.md")).toBe(BROKEN);
      // The same change succeeds once every element file reads.
      const clean = await openSmall();
      await expect(run(clean.workspace, command, input)).resolves.toMatchObject({ files: [MODEL] });
    },
  );

  it("[SR-236/AK-bm7r] [SR-008/AK-kdrw] counts conflict markers and an invalid id or type as unreadable, and names the first 20 by repository and path", async () => {
    const conflict = "<<<<<<< HEAD\n---\nid: a\n=======\n---\nid: b\n>>>>>>> other\n";
    const invalidId = "---\nid: not-a-uuid\ntype: note\nstatus: draft\ntitle: X\n---\n";
    const invalidType = "---\nid: 0b7c6e1a-1111-4222-8333-000000000077\ntype: [note]\n---\n";
    const broken = Object.fromEntries(
      Array.from({ length: 20 }, (_, n) => [`product/notes/F-${String(n).padStart(2, "0")}.md`, BROKEN]),
    );
    const { workspace, read } = await openSmallAcross({
      ...broken,
      "system/elements/B-conflict.md": conflict,
      "system/elements/A-id.md": invalidId,
      "sensor/elements/Z-type.md": invalidType,
    });
    const refused = await failure(workspace, "metamodel.removeStatus", { type: "note", status: "noted" });
    expect(refused.code).toBe("file.faulty");
    // Repositories in code-unit order: product, sensor, system; within one, by path.
    expect(refused.details).toEqual({
      command: "metamodel.removeStatus",
      count: 23,
      files: Array.from({ length: 20 }, (_, n) => ({
        repository: "product",
        file: `notes/F-${String(n).padStart(2, "0")}.md`,
      })),
    });
    expect(refused.message).toMatch(
      /and 23 element files cannot be read \(product:notes\/F-00\.md, .*, product:notes\/F-19\.md, …\); nothing is written/,
    );
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // Without the files of product, the others come in the same order.
    const few = await openSmallAcross({
      "system/elements/B-conflict.md": conflict,
      "system/elements/A-id.md": invalidId,
      "sensor/elements/Z-type.md": invalidType,
    });
    expect((await failure(few.workspace, "metamodel.removeType", { type: "risk" })).details).toEqual({
      command: "metamodel.removeType",
      count: 3,
      files: [
        { repository: "sensor", file: "elements/Z-type.md" },
        { repository: "system", file: "elements/A-id.md" },
        { repository: "system", file: "elements/B-conflict.md" },
      ],
    });
  });

  it("[SR-236/AK-bm7r] names the missing repository when an element file cannot be read as well", async () => {
    const { workspace, read } = await openSmall({
      [WORKSPACE_FILE]: WITH_MISSING_REPOSITORY,
      "elements/E-broken.md": BROKEN,
    });
    const refused = await failure(workspace, "metamodel.removeProperty", {
      type: "note",
      property: "remark",
    });
    expect([refused.code, refused.details]).toEqual([
      "file.folder-missing",
      { command: "metamodel.removeProperty", repository: "product", repositories: ["product"] },
    ]);
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-bm7r] refuses also when the unreadable file does not concern the definition, and a definition in use names the files", async () => {
    // The remark is held by a readable note, the broken file is elsewhere: the files are named, not the use.
    const { workspace } = await openSmall({
      ...elements([1, "note", { remark: "x" }]),
      "elements/E-broken.md": BROKEN,
    });
    const refused = await failure(workspace, "metamodel.changeProperty", {
      property: "remark",
      kind: "number",
    });
    expect(refused.code).toBe("file.faulty");
    expect(refused.details).toMatchObject({ count: 1 });
  });

  it("changes what needs no use while an element file cannot be read", async () => {
    const { workspace, read } = await openSmall({ "elements/E-broken.md": BROKEN });
    await run(workspace, "metamodel.changeType", { type: "note", name: "Memo", prefix: "NO" });
    await run(workspace, "metamodel.changeProperty", { property: "remark", name: "Comment", kind: "text" });
    expect(await read(MODEL)).toContain("    name: Memo\n");
    expect(await read(MODEL)).toContain("{ key: remark, name: Comment, kind: text }");
  });
});
