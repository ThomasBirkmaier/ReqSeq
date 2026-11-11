// Criterion keys of acceptance criteria (SR-204, D-072): given and kept by element.create,
// element.update (`set`, `setItems`) and element.bulkUpdate, refused in a wrong form, reported by
// workspace.check, never counted to the version (SR-091 AK6). ReqIF import: import-criterion-keys.test.ts.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Got = CommandOutput<"element.get">;

const SR = { id: "20420420-0000-4000-8000-000000000204", file: "requirements/SR-000000000204.md" };
const KEY = /^[a-z][a-z0-9]{3}$/u;

/** An element of SR-001/two-elements with `criteria` as the lines of its acceptance criteria. */
const requirement = (criteria: readonly string[]): string =>
  [
    "---",
    `id: ${SR.id}`,
    "type: system-requirement",
    "status: draft",
    "title: Show gusts",
    "requirement-type: functional",
    "acceptance-criteria:",
    ...criteria,
    "---",
    "",
    "The station shows gusts.",
    "",
  ].join("\n");

const UNKEYED = requirement([
  "  - Given a gust, then it is shown.",
  '  - "Given no gust, then nothing is shown."',
  "  - Given a gust, then it is shown.",
]);

const KEYED = requirement([
  "  - key: gust1",
  "    text: Given a gust, then it is shown.",
  "  - key: none2",
  '    text: "Given no gust, then nothing is shown."',
  "  - key: peak3",
  "    text: Given a peak, then it is held.",
]);

interface Opened {
  readonly workspace: Workspace;
  readonly read: () => Promise<string>;
  readonly path: (file: string) => string;
}

const open = async (text: string): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files: { [SR.file]: text } });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { workspace, read: () => fs.readFile(fixture.path(SR.file), "utf8"), path: (f) => fixture.path(f) };
};

const run = async <T>(opened: Opened, command: string, input: Record<string, unknown>): Promise<T> =>
  (await invoke(command, input, { workspace: opened.workspace })) as T;

const sha256 = async (opened: Opened): Promise<string> =>
  createHash("sha256")
    .update(await opened.read())
    .digest("hex");

const update = async (opened: Opened, input: Record<string, unknown>): Promise<CommandOutput<"element.update">> =>
  run(opened, "element.update", { ref: SR.id, ...input });

const refusal = async (promise: Promise<unknown>): Promise<CommandError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
};

/** The acceptance criteria of the file as YAML reads them. */
const criteriaOf = (text: string): unknown =>
  (parse(text.split("---\n")[1] ?? "") as Record<string, unknown>)["acceptance-criteria"];

/** The criterion keys of the file, in order. */
const keysOf = (text: string): string[] =>
  (criteriaOf(text) as { key: string }[]).map((c) => c.key);

const versionOf = async (opened: Opened): Promise<string | undefined> =>
  (await run<Got>(opened, "element.get", { ref: SR.id })).element.version;

describe("criterion keys (SR-204)", () => {
  it("[SR-204/AK1] element.create gives every acceptance criterion a key no other one has, also to equal texts", async () => {
    const opened = await open(KEYED);
    const out = await run<CommandOutput<"element.create">>(opened, "element.create", {
      type: "system-requirement",
      title: "Show peaks",
      folder: "requirements",
      properties: {
        "requirement-type": "functional",
        "acceptance-criteria": ["Given a peak, then it is shown.", "Given a peak, then it is shown.", "Third."],
      },
    });
    const [file = ""] = out.files;
    const keys = keysOf(await fs.readFile(opened.path(file), "utf8"));
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every((k) => KEY.test(k))).toBe(true);
  });

  it("[SR-204/AK1] set, setItems and bulkUpdate give every criterion a key once the criteria are changed", async () => {
    const set = await open(UNKEYED);
    await update(set, { set: { "acceptance-criteria": ["Given a gust, then it is shown.", "New."] } });
    const setKeys = keysOf(await set.read());
    expect([setKeys.length, new Set(setKeys).size]).toEqual([2, 2]);

    const items = await open(UNKEYED);
    await update(items, {
      expectedFileSha256: await sha256(items),
      setItems: { "acceptance-criteria": { "2": "Given calm, then nothing is shown." } },
    });
    const itemKeys = keysOf(await items.read());
    expect([itemKeys.length, new Set(itemKeys).size]).toEqual([3, 3]);
    expect((criteriaOf(await items.read()) as { text: string }[]).map((c) => c.text)).toEqual([
      "Given a gust, then it is shown.",
      "Given calm, then nothing is shown.",
      "Given a gust, then it is shown.",
    ]);

    for (const operation of ["add", "remove"] as const) {
      const bulk = await open(UNKEYED);
      await run(bulk, "element.bulkUpdate", {
        selection: { ids: [SR.id] },
        property: "acceptance-criteria",
        operation,
        value: operation === "add" ? ["Added."] : ['Given no gust, then nothing is shown.'],
        confirm: true,
      });
      const keys = keysOf(await bulk.read());
      expect([keys.length, new Set(keys).size]).toEqual([operation === "add" ? 4 : 2, operation === "add" ? 4 : 2]);
    }
  });

  it("[SR-204/AK1] of two criteria with the same key the earlier one keeps it, also when the change moves them", async () => {
    const opened = await open(
      requirement([
        "  - key: twice",
        "    text: First.",
        "  - key: twice",
        "    text: Second.",
      ]),
    );
    await update(opened, { set: { "acceptance-criteria": ["Second.", "First.", "Third."] } });
    const criteria = criteriaOf(await opened.read()) as { key: string; text: string }[];
    expect(criteria.map((c) => c.text)).toEqual(["Second.", "First.", "Third."]);
    expect(criteria[1]?.key).toBe("twice");
    expect(new Set(criteria.map((c) => c.key)).size).toBe(3);
  });

  it("[SR-204/AK2] a change of another property leaves the lines of the criteria without keys as they are", async () => {
    const opened = await open(UNKEYED);
    await update(opened, { set: { "requirement-type": "quality" } });
    await update(opened, { expectedFileSha256: await sha256(opened), title: "Show gusts and peaks" });
    expect(await opened.read()).toBe(
      UNKEYED.replace("requirement-type: functional", "requirement-type: quality").replace(
        "title: Show gusts",
        "title: Show gusts and peaks",
      ),
    );
  });

  it("[SR-204/AK4] set keeps the key of a criterion by its text at any position; another text gets a new key", async () => {
    const opened = await open(KEYED);
    await update(opened, {
      set: {
        "acceptance-criteria": [
          "Given a peak, then it is held.",
          "Given a gust, then it is shown.",
          "Given no gust, then nothing at all is shown.",
        ],
      },
    });
    const keys = keysOf(await opened.read());
    expect(keys.slice(0, 2)).toEqual(["peak3", "gust1"]);
    expect(keys[2]).toMatch(KEY);
    expect(keys).not.toContain("none2");
  });

  it("[SR-204/AK4] each previous key goes to one entry at most: the first equal text, unless an entry brings the key", async () => {
    const opened = await open(KEYED);
    await update(opened, {
      set: {
        "acceptance-criteria": [
          { key: "gust1", text: "Given a gust, then it is shown at once." },
          "Given a gust, then it is shown.",
          "Given a peak, then it is held.",
          "Given a peak, then it is held.",
        ],
      },
    });
    const keys = keysOf(await opened.read());
    expect(keys[0]).toBe("gust1");
    // gust1 is brought by the first entry, so the equal old text does not take it.
    expect(keys[1]).not.toBe("gust1");
    expect(keys.slice(2)).toEqual(["peak3", expect.stringMatching(KEY)]);
    expect(new Set(keys).size).toBe(4);
  });

  it("[SR-204/AK4] criteria set again with their texts unchanged write nothing", async () => {
    const opened = await open(UNKEYED);
    const out = await update(opened, {
      set: {
        "acceptance-criteria": [
          "Given a gust, then it is shown.",
          "Given no gust, then nothing is shown.",
          "Given a gust, then it is shown.",
        ],
      },
    });
    expect([out.files, await opened.read()]).toEqual([[], UNKEYED]);
  });

  it("[SR-204/AK5] stores a key it is given; refuses one in a wrong form, true, null or given twice and writes nothing", async () => {
    const opened = await open(KEYED);
    for (const [key, reason] of [
      ["Gust", "criterion-key-invalid"],
      ["abc", "criterion-key-invalid"],
      ["a2345678901234567", "criterion-key-invalid"],
      ["1abc", "criterion-key-invalid"],
      [true, "criterion-key-invalid"],
      [null, "criterion-key-invalid"],
    ] as const) {
      const error = await refusal(
        update(opened, { set: { "acceptance-criteria": ["Given a gust, then it is shown.", { key, text: "x" }] } }),
      );
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { index: 1, position: 2, reason, ...(typeof key === "string" ? { criterionKey: key } : {}) },
      ]);
    }
    const twice = await refusal(
      update(opened, {
        set: { "acceptance-criteria": [{ key: "same1", text: "a" }, { key: "same1", text: "b" }] },
      }),
    );
    expect([twice.code, (twice.details as { reason?: string }).reason]).toEqual([
      "input.invalid",
      "criterion-key-duplicate",
    ]);
    const bulk = await refusal(
      run(opened, "element.bulkUpdate", {
        selection: { ids: [SR.id] },
        property: "acceptance-criteria",
        operation: "set",
        value: [{ key: "No", text: "x" }],
        confirm: true,
      }),
    );
    expect(bulk.code).toBe("input.invalid");
    expect(await opened.read()).toBe(KEYED);
    // A key in its form, the longest one too, is stored as given.
    const long = "z234567890123456";
    await update(opened, { set: { "acceptance-criteria": [{ key: long, text: "Given a gust, then it is shown." }] } });
    expect(keysOf(await opened.read())).toEqual([long]);
  });

  it("[SR-204/AK6] a criterion changed by its number keeps its key", async () => {
    const opened = await open(KEYED);
    await update(opened, {
      expectedFileSha256: await sha256(opened),
      setItems: { "acceptance-criteria": { "1": "Given a strong gust, then it is shown." } },
    });
    expect(criteriaOf(await opened.read())).toEqual([
      { key: "gust1", text: "Given a strong gust, then it is shown." },
      { key: "none2", text: "Given no gust, then nothing is shown." },
      { key: "peak3", text: "Given a peak, then it is held." },
    ]);
  });

  it("[SR-204/AK11] the file is valid YAML with each criterion as readable Markdown text at its key", async () => {
    const opened = await open(UNKEYED);
    await update(opened, {
      set: { "acceptance-criteria": ["**Given** a *gust*, then `gust` is shown.", "Given calm, then nothing."] },
    });
    const text = await opened.read();
    const criteria = criteriaOf(text) as { key: string; text: string }[];
    expect(criteria.map((c) => c.text)).toEqual(["**Given** a *gust*, then `gust` is shown.", "Given calm, then nothing."]);
    const [first, second] = criteria;
    expect(text).toContain(
      `acceptance-criteria:\n  - key: ${first?.key ?? ""}\n    text: "**Given** a *gust*, then \`gust\` is shown."\n  - key: ${second?.key ?? ""}\n    text: Given calm, then nothing.\n`,
    );
  });

  it("[SR-091/AK6] giving, adding or swapping criterion keys leaves the version as it is", async () => {
    const opened = await open(UNKEYED);
    const before = await versionOf(opened);
    // The criteria get keys: same texts, so the version stays.
    await update(opened, {
      set: {
        "acceptance-criteria": [
          { key: "aaaa1", text: "Given a gust, then it is shown." },
          { key: "bbbb2", text: "Given no gust, then nothing is shown." },
          "Given a gust, then it is shown.",
        ],
      },
    });
    expect(keysOf(await opened.read()).slice(0, 2)).toEqual(["aaaa1", "bbbb2"]);
    expect(await versionOf(opened)).toBe(before);
    await update(opened, {
      set: {
        "acceptance-criteria": [
          { key: "bbbb2", text: "Given a gust, then it is shown." },
          { key: "aaaa1", text: "Given no gust, then nothing is shown." },
          "Given a gust, then it is shown.",
        ],
      },
    });
    expect(keysOf(await opened.read()).slice(0, 2)).toEqual(["bbbb2", "aaaa1"]);
    expect(await versionOf(opened)).toBe(before);
  });
});

describe("criterion key findings (SR-204 AK10)", () => {
  const check = async (opened: Opened): Promise<CommandOutput<"workspace.check">> =>
    run(opened, "workspace.check", {});

  const codes = (out: CommandOutput<"workspace.check">): unknown[] =>
    out.problems
      .filter((p) => p.code.startsWith("element.criterion-key") && p.elementId === SR.id)
      .map((p) => [p.code, p.severity, p.line, p.count]);

  it("warns once of the criteria without key with their count, on the line of the property", async () => {
    const opened = await open(UNKEYED);
    expect(codes(await check(opened))).toEqual([["element.criterion-key-missing", "warning", 7, 3]]);
  });

  it("reports a key two criteria carry as an error on the later one, and a key in a wrong form as a warning", async () => {
    const opened = await open(
      requirement([
        "  - key: twice",
        "    text: First.",
        "  - key: Bad-Key",
        "    text: Second.",
        "  - Third.",
        "  - key: twice",
        "    text: Fourth.",
      ]),
    );
    const out = await check(opened);
    expect(codes(out)).toEqual([
      ["element.criterion-key-missing", "warning", 7, 1],
      ["element.criterion-key-invalid", "warning", 10, undefined],
      ["element.criterion-key-duplicate", "error", 13, undefined],
    ]);
    expect(out.ok).toBe(false);
    // The same findings at the element (element.get).
    const got = await run<Got>(opened, "element.get", { ref: SR.id });
    expect((got.element.problems ?? []).filter((p) => p.code.startsWith("element.criterion-key")).map((p) => p.code)).toEqual([
      "element.criterion-key-missing",
      "element.criterion-key-invalid",
      "element.criterion-key-duplicate",
    ]);
  });

  it("reports nothing for criteria with keys; a criterion mapping with another key is a value of the wrong kind", async () => {
    const opened = await open(KEYED);
    expect(codes(await check(opened))).toEqual([]);
    const other = await open(requirement(["  - key: 1234", "    text: Numbered.", "  - { text: Alone, note: x }"]));
    const out = await check(other);
    expect(codes(out)).toEqual([]);
    expect(out.problems.filter((p) => p.code === "element.wrong-value-kind")).toHaveLength(2);
  });
});
