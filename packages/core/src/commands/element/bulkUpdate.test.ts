// element.bulkUpdate (SR-071) on fixtures/SR-069/filter (see list.test.ts for its elements): one
// repository `system` with the standard model and the subtype software-requirement (SWR) with the
// number property `priority`. Needs have `topic` too; decisions, packages and variants have neither
// `topic` nor `priority`. The selection is the one of element.list (SR-101), tested there.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.bulkUpdate">;

const P = "69069069-0000-4000-8000-0000000000";
const id = (tail: string): string => `${P}${tail}`;
const [N1, N2, P1, P2, B1, B2, B3, B4, B5, F1, F2] = [
  "a1",
  "a2",
  "d1",
  "d2",
  "b1",
  "b2",
  "b3",
  "b4",
  "b5",
  "f1",
  "f2",
].map(id) as [string, string, string, string, string, string, string, string, string, string, string];

/** The element files of the fixture by element, relative to the workspace root. */
const FILES: Readonly<Record<string, string>> = {
  [id("e1")]: "decisions/D-0000000000e1.md",
  [N1]: "needs/N-0000000000a1.md",
  [N2]: "needs/N-0000000000a2.md",
  [P1]: "packages/PKG-0000000000d1.md",
  [P2]: "packages/PKG-0000000000d2.md",
  [B1]: "requirements/SR-0000000000b1.md",
  [B2]: "requirements/SR-0000000000b2.md",
  [B3]: "requirements/SR-0000000000b3.md",
  [B4]: "requirements/SR-0000000000b4.md",
  [B5]: "requirements/SR-0000000000b5.md",
  [F1]: "requirements/SWR-0000000000f1.md",
  [F2]: "requirements/SWR-0000000000f2.md",
  [id("c1")]: "variants/VAR-0000000000c1.md",
  [id("c2")]: "variants/VAR-0000000000c2.md",
};
const REQUIREMENTS = [B1, B2, B3, B4, B5, F1, F2];

const B6 = id("b6");
const B7 = id("b7");
const X9 = id("99");
/** Hand-written values: one criterion where a list belongs, an empty one, and a type the metamodel does not know. */
const EDGE: FixtureOptions = {
  fixture: "SR-069/filter",
  files: {
    "requirements/SR-0000000000b6.md": `---\nid: ${B6}\ntype: system-requirement\nstatus: draft\ntitle: One criterion\nrequirement-type: functional\nacceptance-criteria: Given one, then it holds.\n---\n`,
    "requirements/SR-0000000000b7.md": `---\nid: ${B7}\ntype: system-requirement\nstatus: draft\ntitle: No criterion\nrequirement-type: functional\nacceptance-criteria:\ntopic: Wind # kept\n---\n`,
    "other/X-000000000099.md": `---\nid: ${X9}\ntype: nope\nstatus: draft\ntitle: Unknown type\ntopic: Wind\n---\n`,
  },
};

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = { fixture: "SR-069/filter" }): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const bulk = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.bulkUpdate", input, { workspace })) as Output;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  const error = await invoke("element.bulkUpdate", input, { workspace }).catch((e: unknown) => e);
  if (!(error instanceof CommandError)) {
    throw new Error(`expected a CommandError, got ${JSON.stringify(error)}`);
  }
  return error;
};

/** Every Markdown file below the root with its text, by path relative to the root (`/`). */
const texts = async (root: string): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const file = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
      out[file] = await fs.readFile(path.join(root, file), "utf8");
    }
  }
  return out;
};

/** The files whose text differs between `before` and `after`, sorted. */
const changed = (
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string[] =>
  Object.keys(after)
    .filter((file) => before[file] !== after[file])
    .sort();

/** The text without the lines of top-level key `key`: its own line and the indented or list lines after it. */
const withoutKey = (text: string, key: string): string => {
  const out: string[] = [];
  let inKey = false;
  for (const line of text.split("\n")) {
    if (line.startsWith(`${key}:`)) {
      inKey = true;
      continue;
    }
    if (inKey && (line.startsWith(" ") || line.startsWith("- "))) {
      continue;
    }
    inKey = false;
    out.push(line);
  }
  return out.join("\n");
};

/** Expects `files` (and only them) to have changed, each only in the lines of `key` (SR-102 AK1). */
const expectOnlyKeyChanged = (
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
  key: string,
  files: readonly string[],
): void => {
  expect(changed(before, after)).toEqual([...files].sort());
  for (const file of files) {
    expect([file, withoutKey(after[file] ?? "", key)]).toEqual([file, withoutKey(before[file] ?? "", key)]);
  }
};

const ids = (elements: readonly { readonly id: string }[]): string[] => elements.map((e) => e.id);
const filesOf = (elements: readonly string[]): string[] => elements.map((e) => FILES[e] ?? e);

describe("element.bulkUpdate (SR-071)", () => {
  it("[SR-071/AK1] sets a property for every selected element; each file changes only in that property", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const out = await bulk(workspace, {
      selection: { where: { type: ["system-requirement"] } },
      property: "topic",
      operation: "set",
      value: "Sensors",
      confirm: true,
    });
    expect(out).toMatchObject({ applied: true, count: 7, unchanged: 0, skipped: [], problems: [] });
    expect(ids(out.affected)).toEqual(REQUIREMENTS);
    expect(out.affected[0]).toEqual({ id: B1, shortId: "SR-0000b1" });
    expect(out.files).toEqual(filesOf(REQUIREMENTS));
    const after = await texts(fixture.root);
    expectOnlyKeyChanged(before, after, "topic", filesOf(REQUIREMENTS));
    expect(after[FILES[B1] ?? ""]).toContain("\ntopic: Sensors\n");
    // b3 had no topic: the line is added.
    expect(after[FILES[B3] ?? ""]).toContain("\ntopic: Sensors\n");
    // The store has the files as written: a filter on the new value finds them without a reload.
    const listed = (await invoke(
      "element.list",
      { selection: { where: { property: "topic", op: "eq", value: "Sensors" } } },
      { workspace },
    )) as CommandOutput<"element.list">;
    expect(listed.total).toBe(7);
    // Again: every element has the value already.
    const again = await bulk(workspace, {
      selection: { where: { type: ["system-requirement"] } },
      property: "topic",
      operation: "set",
      value: "Sensors",
      confirm: true,
    });
    expect(again).toMatchObject({ applied: true, count: 0, affected: [], unchanged: 7, files: [] });
  });

  it("[SR-071/AK1] adds items to a list property: new lines only, items an element holds already are not added twice", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const criterion = "Given a gust, when it is checked, then it holds.";
    const out = await bulk(workspace, {
      selection: { ids: [B1, B2, B1] },
      property: "acceptance-criteria",
      operation: "add",
      value: [criterion, criterion],
      confirm: true,
    });
    expect(out).toMatchObject({ count: 2, unchanged: 0 });
    const after = await texts(fixture.root);
    expectOnlyKeyChanged(before, after, "acceptance-criteria", filesOf([B1, B2]));
    expect(after[FILES[B1] ?? ""]).toContain(
      `acceptance-criteria:\n  - Given wind, when it is checked, then it holds.\n  - ${criterion}\n`,
    );
    const again = await bulk(workspace, {
      selection: { ids: [B1, B2] },
      property: "acceptance-criteria",
      operation: "add",
      value: criterion,
      confirm: true,
    });
    expect(again).toMatchObject({ count: 0, unchanged: 2, files: [] });
  });

  it("[SR-071/AK1] adds a relation target with its current version and title; stored targets keep their version", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const p2 = (await invoke("element.get", { ref: P2 }, { workspace })) as CommandOutput<"element.get">;
    const out = await bulk(workspace, {
      selection: { ids: [B1, B2, B3] },
      property: "packages",
      operation: "add",
      value: [{ id: P2.toUpperCase() }],
      confirm: true,
    });
    // b2 is in P2 already.
    expect(out).toMatchObject({ count: 2, unchanged: 1, problems: [] });
    expect(ids(out.affected)).toEqual([B1, B3]);
    const after = await texts(fixture.root);
    expectOnlyKeyChanged(before, after, "packages", filesOf([B1, B3]));
    const version = String(p2.element.version);
    expect(after[FILES[B1] ?? ""]).toContain(
      `packages:\n  - { id: ${P1}, version: n1:1111111111111111 }\n  - { id: ${P2}, version: ${version}, title: Display }\n`,
    );
    expect(after[FILES[B3] ?? ""]).toContain(
      `packages:\n  - { id: ${P2}, version: ${version}, title: Display }\n`,
    );
  });

  it("[SR-071/AK1] sets relation targets as element.update stores them: a stored target keeps its entry", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const p2 = (await invoke("element.get", { ref: P2 }, { workspace })) as CommandOutput<"element.get">;
    const out = await bulk(workspace, {
      selection: { ids: [B1, B2] },
      property: "packages",
      operation: "set",
      value: [{ id: P2 }],
      confirm: true,
    });
    expect(out.count).toBe(2);
    const after = await texts(fixture.root);
    expectOnlyKeyChanged(before, after, "packages", filesOf([B1, B2]));
    expect(after[FILES[B1] ?? ""]).toContain(
      `packages:\n  - { id: ${P2}, version: ${String(p2.element.version)}, title: Display }\nderives-from:`,
    );
    expect(after[FILES[B2] ?? ""]).toContain(
      `packages:\n  - { id: ${P2}, version: n1:1111111111111111 }\nderives-from:`,
    );
  });

  it("[SR-071/AK1] removes a property, or only the given items of a list (the key with its last item)", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const removed = await bulk(workspace, {
      selection: { ids: [B1, B2, B3] },
      property: "topic",
      operation: "remove",
      confirm: true,
    });
    // b3 has no topic.
    expect(removed).toMatchObject({ count: 2, unchanged: 1 });
    const mid = await texts(fixture.root);
    expectOnlyKeyChanged(before, mid, "topic", filesOf([B1, B2]));
    expect(mid[FILES[B1] ?? ""]).not.toContain("topic:");
    const items = await bulk(workspace, {
      selection: { ids: [B1, B2, B3] },
      property: "packages",
      operation: "remove",
      // The source's own repository, named: the same target as one stored without it.
      value: [{ id: P1, repository: "system" }],
      confirm: true,
    });
    expect(items).toMatchObject({ count: 2, unchanged: 1 });
    const after = await texts(fixture.root);
    expectOnlyKeyChanged(mid, after, "packages", filesOf([B1, B2]));
    expect(after[FILES[B1] ?? ""]).not.toContain("packages:");
    expect(after[FILES[B2] ?? ""]).toContain(
      `packages:\n  - { id: ${P2}, version: n1:1111111111111111 }\nderives-from:`,
    );
    // The elements and their files stay (D-045).
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  });

  it("[SR-071/AK1] writes a choice given by its display name as its key", async () => {
    const { fixture, workspace } = await open();
    const out = await bulk(workspace, {
      selection: { ids: [B1, B2] },
      property: "verification-method",
      operation: "set",
      value: "INSPECTION",
      confirm: true,
    });
    expect(out.count).toBe(2);
    const after = await texts(fixture.root);
    expect(after[FILES[B1] ?? ""]).toContain("\nverification-method: inspection\n");
    expect(after[FILES[B2] ?? ""]).toContain("\nverification-method: inspection\n");
  });

  it("[SR-071/AK1] handles hand-written values: one item where a list belongs, and an empty value", async () => {
    const { fixture, workspace } = await open(EDGE);
    const added = await bulk(workspace, {
      selection: { ids: [B6, B7] },
      property: "acceptance-criteria",
      operation: "add",
      value: ["Given two, then it holds."],
      confirm: true,
    });
    expect(added.count).toBe(2);
    const after = await texts(fixture.root);
    expect(after["requirements/SR-0000000000b6.md"]).toContain(
      "acceptance-criteria:\n  - Given one, then it holds.\n  - Given two, then it holds.\n",
    );
    expect(after["requirements/SR-0000000000b7.md"]).toContain(
      "acceptance-criteria:\n  - Given two, then it holds.\ntopic: Wind # kept\n",
    );
  });

  it("[SR-071/AK1] removes one item where a list belongs only when it is given", async () => {
    const { fixture, workspace } = await open(EDGE);
    const other = await bulk(workspace, {
      selection: { ids: [B6, B7] },
      property: "acceptance-criteria",
      operation: "remove",
      value: "Given another, then it holds.",
      confirm: true,
    });
    expect(other).toMatchObject({ count: 0, unchanged: 2 });
    const out = await bulk(workspace, {
      selection: { ids: [B6, B7, B1] },
      property: "acceptance-criteria",
      operation: "remove",
      value: ["Given one, then it holds.", "Given nothing, then it holds."],
      confirm: true,
    });
    expect(out).toMatchObject({ count: 1, unchanged: 2 });
    expect(ids(out.affected)).toEqual([B6]);
    expect((await texts(fixture.root))["requirements/SR-0000000000b6.md"]).not.toContain(
      "acceptance-criteria",
    );
  });

  it("[SR-071/AK2] without confirm shows the number of affected elements and writes nothing", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const input = {
      selection: { where: { type: ["system-requirement"] } },
      property: "topic",
      operation: "set",
      value: "Wind",
    };
    const preview = await bulk(workspace, input);
    // b1 has the topic Wind already.
    expect(preview).toMatchObject({ applied: false, count: 6, unchanged: 1, files: [], incomplete: false });
    expect(ids(preview.affected)).toEqual([B2, B3, B4, B5, F1, F2]);
    expect(await texts(fixture.root)).toEqual(before);
    const done = await bulk(workspace, { ...input, confirm: true, expected: preview.count });
    expect(done).toMatchObject({ applied: true, count: 6, affected: preview.affected });
    expect(done.files).toEqual(filesOf([B2, B3, B4, B5, F1, F2]));
    expectOnlyKeyChanged(before, await texts(fixture.root), "topic", done.files);
  });

  it("[SR-071/AK2] refuses a confirmation whose count no longer holds and writes nothing", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const error = await failure(workspace, {
      selection: { ids: [B1, B2] },
      property: "topic",
      operation: "set",
      value: "Gusts",
      confirm: true,
      expected: 1,
    });
    expect(error.code).toBe("input.invalid");
    expect(error.details).toMatchObject({ reason: "count-changed", expected: 1, count: 2 });
    expect(error.message).toContain("nothing was written");
    expect(await texts(fixture.root)).toEqual(before);
    // `expected` alone, without confirm, writes nothing either.
    expect(
      await bulk(workspace, {
        selection: { ids: [B1] },
        property: "topic",
        operation: "set",
        value: "X",
        expected: 9,
      }),
    ).toMatchObject({ applied: false, count: 1 });
    expect(await texts(fixture.root)).toEqual(before);
  });

  it("[SR-071/AK3] leaves out and names every element whose type does not have the property", async () => {
    const { fixture, workspace } = await open(EDGE);
    const before = await texts(fixture.root);
    const out = await bulk(workspace, {
      selection: {},
      property: "topic",
      operation: "set",
      value: "Wind",
      confirm: true,
    });
    // Requirements and needs have `topic`; decisions, packages and variants do not; `nope` is unknown.
    expect(out.skipped).toEqual([
      {
        id: id("e1"),
        shortId: "D-0000e1",
        reason: "not-a-property",
        message: "Type Decision (decision) has no property Topic (topic)",
      },
      {
        id: X9,
        shortId: "UNKNOWN-000099",
        reason: "unknown-type",
        message: "The metamodel has no type nope, so ReqSeq only reads other/X-000000000099.md",
      },
      expect.objectContaining({ id: P1, reason: "not-a-property" }),
      expect.objectContaining({ id: P2, reason: "not-a-property" }),
      expect.objectContaining({ id: id("c1"), reason: "not-a-property" }),
      expect.objectContaining({ id: id("c2"), reason: "not-a-property" }),
    ]);
    // b1 and b7 have Wind already.
    expect(ids(out.affected)).toEqual([N1, N2, B2, B3, B4, B5, B6, F1, F2]);
    expect(out.unchanged).toBe(2);
    const after = await texts(fixture.root);
    expectOnlyKeyChanged(before, after, "topic", out.files);
    for (const skipped of out.skipped) {
      expect(changed(before, after)).not.toContain(FILES[skipped.id] ?? "other/X-000000000099.md");
    }
  });

  it("[SR-071/AK3] a property of a subtype only: the elements of the supertype are skipped", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const out = await bulk(workspace, {
      selection: { where: { type: ["system-requirement"] } },
      property: "priority",
      operation: "set",
      value: 3,
    });
    expect(ids(out.affected)).toEqual([F1, F2]);
    expect(ids(out.skipped)).toEqual([B1, B2, B3, B4, B5]);
    expect(out.skipped[0]?.message).toBe(
      "Type System Requirement (system-requirement) has no property Priority (priority)",
    );
    expect(await texts(fixture.root)).toEqual(before);
  });

  it("gives the hints at the property after the change, in a preview too: value kind and target types", async () => {
    const { workspace } = await open();
    const kind = await bulk(workspace, {
      selection: { ids: [F1] },
      property: "priority",
      operation: "set",
      value: "high",
    });
    expect(kind.problems).toEqual([
      expect.objectContaining({
        code: "element.wrong-value-kind",
        severity: "warning",
        file: FILES[F1],
        line: 9,
        elementId: F1,
        elementShortId: "SWR-0000f1",
      }),
    ]);
    const types = await bulk(workspace, {
      selection: { ids: [B1] },
      property: "packages",
      operation: "add",
      value: { id: N1 },
      confirm: true,
    });
    expect(types.problems).toEqual([
      expect.objectContaining({ code: "relation.not-allowed", file: FILES[B1], line: 13, targetId: N1 }),
    ]);
  });

  it("refuses an input that no element could take, before any file is read", async () => {
    const { fixture, workspace } = await open();
    const before = await texts(fixture.root);
    const cases: readonly (readonly [Record<string, unknown>, string, Record<string, unknown>])[] = [
      [{ property: "title", operation: "set", value: "Same" }, "input.invalid", { reason: "title" }],
      [
        { property: "derives-from", operation: "add", value: { id: N1 } },
        "input.invalid",
        { reason: "relation" },
      ],
      [{ property: "owner", operation: "remove" }, "input.invalid", { reason: "not-a-property" }],
      [{ property: "topic", operation: "add", value: "Wind" }, "input.invalid", { reason: "not-many" }],
      [{ property: "topic", operation: "remove", value: "Wind" }, "input.invalid", { reason: "not-many" }],
      [{ property: "topic", operation: "set" }, "input.invalid", { reason: "value-missing" }],
      [{ property: "topic", operation: "set", value: null }, "input.invalid", { reason: "value-empty" }],
      [{ property: "packages", operation: "add", value: [] }, "input.invalid", { reason: "value-empty" }],
      [
        { property: "verification-method", operation: "set", value: "guess" },
        "input.invalid",
        { reason: "unknown-choice" },
      ],
      [{ property: "status", operation: "set", value: "approved" }, "input.invalid", {}],
      [{ property: "type", operation: "remove" }, "input.invalid", {}],
    ];
    for (const [input, code, details] of cases) {
      const error = await failure(workspace, { selection: { ids: [B1] }, confirm: true, ...input });
      expect([input, error.code]).toEqual([input, code]);
      expect(error.details).toMatchObject(details);
    }
    const add = await failure(workspace, {
      selection: {},
      property: "topic",
      operation: "add",
      value: "Wind",
    });
    expect(add.message).toBe(
      "value: add with a value works on a property with many values; Topic (topic) has one. Use set",
    );
    const remove = await failure(workspace, {
      selection: {},
      property: "topic",
      operation: "remove",
      value: "x",
    });
    expect(remove.message).toBe(
      "value: remove with a value works on a property with many values; Topic (topic) has one. Use set, or remove without a value",
    );
    expect(await texts(fixture.root)).toEqual(before);
  });

  it("refuses the whole change before any write when a selected file changed on disk", async () => {
    const { fixture, workspace } = await open();
    await bulk(workspace, { selection: { ids: [B1] }, property: "topic", operation: "set", value: "Read" });
    const file = fixture.path(FILES[B3] ?? "");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("Survive icing", "Survive ice"));
    const before = await texts(fixture.root);
    const error = await failure(workspace, {
      selection: { ids: [B1, B3] },
      property: "topic",
      operation: "set",
      value: "Changed",
      confirm: true,
    });
    expect(error.code).toBe("file.changed-on-disk");
    expect(await texts(fixture.root)).toEqual(before);
    // The store was read again: the next call works on the new content.
    expect(
      await bulk(workspace, {
        selection: { ids: [B1, B3] },
        property: "topic",
        operation: "set",
        value: "Changed",
      }),
    ).toMatchObject({ count: 2 });
  });

  it("refuses the change when a selected file is gone or no longer an element", async () => {
    for (const change of [
      (file: string) => fs.rm(file),
      (file: string) => fs.writeFile(file, "---\ntitle: no id\n---\n"),
    ]) {
      const { fixture, workspace } = await open();
      await bulk(workspace, { selection: { ids: [B1] }, property: "topic", operation: "remove" });
      await change(fixture.path(FILES[B2] ?? ""));
      const before = await texts(fixture.root);
      const error = await failure(workspace, {
        selection: { ids: [B1, B2] },
        property: "topic",
        operation: "remove",
        confirm: true,
      });
      expect([error.code, error.details]).toEqual([
        "file.changed-on-disk",
        { file: FILES[B2], repository: "system" },
      ]);
      expect(await texts(fixture.root)).toEqual(before);
    }
  });

  it("writes back every file it wrote when one write is refused (several written at a time)", async () => {
    const { fixture, workspace } = await open();
    const file = fixture.path(FILES[F2] ?? "");
    await fs.chmod(file, 0o444);
    onTestFinished(() => fs.chmod(file, 0o644));
    const before = await texts(fixture.root);
    const error = await failure(workspace, {
      selection: { where: { type: ["system-requirement"] } },
      property: "topic",
      operation: "set",
      value: "Never",
      confirm: true,
    });
    expect(error.code).toBe("file.read-only");
    // Every written file was restored, so no file is named as kept.
    expect(error.details?.["written"]).toBeUndefined();
    expect(await texts(fixture.root)).toEqual(before);
  });

  it("adds a target named with its repository, and keeps an item that is no target as given", async () => {
    const { fixture, workspace } = await open();
    const named = await bulk(workspace, {
      selection: { ids: [B1, B3] },
      property: "packages",
      operation: "add",
      value: { id: P2, repository: "system" },
      confirm: true,
    });
    expect(named).toMatchObject({ count: 2, problems: [] });
    const out = await bulk(workspace, {
      selection: { ids: [B3] },
      property: "packages",
      operation: "add",
      value: "not a target",
      confirm: true,
    });
    // The item that is no target gets the hint of SR-085.
    expect(out.problems.map((p) => [p.code, p.file, p.line])).toEqual([
      ["element.wrong-value-kind", FILES[B3], 16],
    ]);
    const after = await texts(fixture.root);
    expect(after[FILES[B3] ?? ""]).toMatch(
      new RegExp(
        `packages:\\n  - \\{ id: ${P2}, version: n1:[0-9a-f]{16}, title: Display \\}\\n  - not a target\\n`,
      ),
    );
  });

  it("refuses a selection that names an unknown element", async () => {
    const { workspace } = await open();
    const error = await failure(workspace, {
      selection: { ids: ["SR-ffffff"] },
      property: "topic",
      operation: "remove",
    });
    expect(error.code).toBe("ref.unknown");
  });
});
