// element.assignCriterionKeys (SR-204 AK3, D-072): every acceptance criterion without key in a
// selection gets one; existing keys, versions and the other lines stay as they are, and the output
// names the number of changed elements.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { withMissingKeys } from "../../model/assign-criterion-keys.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Assigned = CommandOutput<"element.assignCriterionKeys">;

const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/SR-1d2e3f4a5b6c.md" };
const PLAIN = { id: "20420420-0000-4000-8000-000000000a01", file: "requirements/SR-000000000a01.md" };
const MIXED = { id: "20420420-0000-4000-8000-000000000a02", file: "requirements/SR-000000000a02.md" };
const KEYED = { id: "20420420-0000-4000-8000-000000000a03", file: "requirements/SR-000000000a03.md" };
const UNKNOWN = { id: "20420420-0000-4000-8000-000000000a04", file: "requirements/X-000000000a04.md" };
const NEED = { id: "20420420-0000-4000-8000-000000000a07", file: "needs/N-000000000a07.md" };
const KEY = /^[a-z][a-z0-9]{3}$/u;

const element = (id: string, type: string, title: string, criteria: readonly string[]): string =>
  [
    "---",
    `id: ${id}`,
    `type: ${type}`,
    "status: draft",
    `title: ${title}`,
    "requirement-type: functional",
    "acceptance-criteria:",
    ...criteria,
    "---",
    "",
    `The station shows ${title.toLowerCase()}.`,
    "",
  ].join("\n");

const FILES = {
  [PLAIN.file]: element(PLAIN.id, "system-requirement", "Peaks", [
    "  - Given a peak, then it is shown.",
    '  - "Given no peak, then nothing is shown."',
    "  - Given a peak, then it is shown.",
  ]),
  // A key in its form, a plain text, a key in another form and a key that the first one carries.
  [MIXED.file]: element(MIXED.id, "system-requirement", "Calm", [
    "  - key: calm1",
    "    text: Given calm, then it is shown.",
    "  - Given a breeze, then it is shown.",
    "  - key: Bad",
    "    text: Given a storm, then it is shown.",
    "  - key: calm1",
    "    text: Given rain, then it is shown.",
  ]),
  [KEYED.file]: element(KEYED.id, "system-requirement", "Fog", [
    "  - key: fog1",
    "    text: Given fog, then it is shown.",
  ]),
  [UNKNOWN.file]: element(UNKNOWN.id, "gadget", "Gadget", ["  - Given a gadget, then it is shown."]),
  // A type without the property: its list is no acceptance criteria (SR-016 reports the key).
  [NEED.file]: element(NEED.id, "need", "Wind", ["  - Given wind, then it is seen."]),
};

interface Opened {
  readonly workspace: Workspace;
  readonly read: (file: string) => Promise<string>;
}

const open = async (
  files: Record<string, string> = FILES,
  fixture = "SR-001/two-elements",
): Promise<Opened> => {
  const created = await createFixtureWorkspace({ fixture, files });
  onTestFinished(() => created.cleanup());
  const workspace = new Workspace(created.root);
  onTestFinished(() => workspace.close());
  return { workspace, read: (file) => fs.readFile(created.path(file), "utf8") };
};

const run = async <T>(opened: Opened, command: string, input: Record<string, unknown>): Promise<T> =>
  (await invoke(command, input, { workspace: opened.workspace })) as T;

const assign = (opened: Opened, selection: Record<string, unknown>): Promise<Assigned> =>
  run<Assigned>(opened, "element.assignCriterionKeys", { selection });

/** The acceptance criteria of the file as YAML reads them. */
const criteriaOf = (text: string): unknown[] =>
  (parse(text.split("---\n")[1] ?? "") as Record<string, unknown[]>)["acceptance-criteria"] ?? [];

const versionOf = async (opened: Opened, id: string): Promise<string | undefined> =>
  (await run<CommandOutput<"element.get">>(opened, "element.get", { ref: id })).element.version;

describe("element.assignCriterionKeys (SR-204 AK3)", () => {
  it("[SR-204/AK3] gives every criterion of the selection a key, keeps the keys and versions, names the changed elements", async () => {
    const opened = await open();
    const ids = [GUSTS.id, PLAIN.id, MIXED.id, KEYED.id];
    const before = await Promise.all(ids.map((id) => versionOf(opened, id)));
    const keyed = await opened.read(KEYED.file);

    const out = await assign(opened, {});

    expect(out.count).toBe(3);
    expect(out.changed.map((c) => [c.id, c.assigned])).toEqual([
      [PLAIN.id, 3],
      [MIXED.id, 1],
      [GUSTS.id, 1],
    ]);
    expect(out.files).toEqual([PLAIN.file, MIXED.file, GUSTS.file]);
    expect(out.skipped.map((s) => [s.id, s.reason])).toEqual([[UNKNOWN.id, "unknown-type"]]);
    // Every criterion has a key; equal texts get different ones.
    const plain = criteriaOf(await opened.read(PLAIN.file)) as { key: string; text: string }[];
    expect(plain.map((c) => c.text)).toEqual([
      "Given a peak, then it is shown.",
      "Given no peak, then nothing is shown.",
      "Given a peak, then it is shown.",
    ]);
    expect(plain.every((c) => KEY.test(c.key))).toBe(true);
    expect(new Set(plain.map((c) => c.key)).size).toBe(3);
    // The existing keys stay, also those in another form or used twice; the new one is none of them.
    const mixed = criteriaOf(await opened.read(MIXED.file)) as { key: string }[];
    expect(mixed.map((c) => c.key)).toEqual(["calm1", expect.stringMatching(KEY), "Bad", "calm1"]);
    // Versions stay; an element with keys only, and the unknown type, are not written.
    expect(await Promise.all(ids.map((id) => versionOf(opened, id)))).toEqual(before);
    expect(await opened.read(KEYED.file)).toBe(keyed);
    expect(await opened.read(UNKNOWN.file)).toBe(FILES[UNKNOWN.file]);
    expect(await opened.read(NEED.file)).toBe(FILES[NEED.file]);
    // The other lines of the file stay as they were.
    const gusts = await opened.read(GUSTS.file);
    expect(gusts).toContain("customer-id: 00815              # unknown to the metamodel (SR-016)\n");
    const gust = criteriaOf(gusts) as { key: string; text: string }[];
    expect(gust.map((c) => [KEY.test(c.key), c.text])).toEqual([
      [true, "Given a gust, when it is measured, then the station shows it."],
    ]);
    // Nothing left to assign: workspace.check names no missing key, a repeated call changes nothing.
    const check = await run<CommandOutput<"workspace.check">>(opened, "workspace.check", {});
    // An unknown type gets no finding (AK10), so none is left.
    expect(check.problems.filter((p) => p.code === "element.criterion-key-missing")).toEqual([]);
    expect(await assign(opened, {})).toMatchObject({ count: 0, changed: [], files: [] });
  });

  it("[SR-204/AK3] changes only the elements of the selection, with the same keys for the same file", async () => {
    const one = await open();
    const out = await assign(one, { ids: [PLAIN.id, KEYED.id] });
    expect([out.count, out.files]).toEqual([1, [PLAIN.file]]);
    expect(await one.read(GUSTS.file)).not.toContain("key:");

    const other = await open();
    await assign(other, { where: { type: ["system-requirement"] } });
    expect(await other.read(PLAIN.file)).toBe(await one.read(PLAIN.file));
  });

  it("gives no key without a property with the meaning acceptance-criteria", async () => {
    const opened = await open({ "metamodel/standard-model.yaml": NO_CRITERIA, ...FILES });
    expect(await assign(opened, {})).toEqual({
      count: 0,
      changed: [],
      skipped: [],
      files: [],
      incomplete: false,
    });
  });

  it("refuses a variant with validity entries as a whole, nothing is written (SR-039 AK2)", async () => {
    const opened = await open(NESTED_FILES, "SR-039/nested");
    const error = await assign(opened, {}).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe("variant.nested");
    expect(await opened.read(NESTED_SR)).toBe(NESTED_FILES[NESTED_SR]);
  });

  it("draws a new key again while an item carries it", () => {
    const draws = [0, 0, 0, 0, 1, 0, 0, 0];
    const random = (): number => draws.shift() ?? 0;
    expect(withMissingKeys([{ key: "bbbb", text: "Kept." }, "New.", 7], random)).toEqual([
      { key: "bbbb", text: "Kept." },
      { key: "cbbb", text: "New." },
      7,
    ]);
  });
});

/** The standard model of SR-001/two-elements without the meaning acceptance-criteria. */
const NO_CRITERIA = [
  "reqseq-metamodel: 1",
  "types:",
  "  - key: system-requirement",
  "    name: System Requirement",
  "    prefix: SR",
  "    meaning: requirement",
  "    properties: [title, requirement-type, acceptance-criteria]",
  "    required: [title]",
  "properties:",
  "  - { key: title, name: Title, kind: text, meaning: title }",
  "  - { key: requirement-type, name: Requirement type, kind: text }",
  "  - { key: acceptance-criteria, name: Acceptance criteria, kind: text, many: true }",
  "relations:",
  "  - { key: derives-from, name: Derives from, inverse-name: Derived by, meaning: derivation }",
  "statuses:",
  "  - { key: draft, name: Draft, initial: true }",
  "",
].join("\n");

/** SR-039/nested with acceptance criteria on both types, and a requirement valid for a variant. */
const NESTED_SR = "requirements/SR-000000000a05.md";
const NESTED_FILES: Record<string, string> = {
  "metamodel/model.yaml": [
    "reqseq-metamodel: 1",
    "types:",
    "  - { key: variant, name: Variant, prefix: VAR, meaning: variant, properties: [title, validity, acceptance-criteria], required: [title] }",
    "  - { key: system-requirement, name: System Requirement, prefix: SR, meaning: requirement, properties: [title, validity, acceptance-criteria], required: [title] }",
    "properties:",
    "  - { key: title, name: Title, kind: text, meaning: title }",
    "  - { key: validity, name: Validity, kind: relation, many: true, target-types: [variant], meaning: validity }",
    "  - { key: acceptance-criteria, name: Acceptance criteria, kind: text, many: true, meaning: acceptance-criteria }",
    "relations:",
    "  - { key: relates-to, name: Relates to, inverse-name: Related by }",
    "  - { key: derives-from, name: Derives from, inverse-name: Derived by, meaning: derivation }",
    "statuses:",
    "  - { key: draft, name: Draft, initial: true }",
    "",
  ].join("\n"),
  [NESTED_SR]: [
    "---",
    "id: 20420420-0000-4000-8000-000000000a05",
    "type: system-requirement",
    "status: draft",
    "title: Valid for the coast",
    "acceptance-criteria:",
    "  - Given the coast, then it is shown.",
    "---",
    "",
  ].join("\n"),
  "variants/VAR-000000000a06.md": [
    "---",
    "id: 20420420-0000-4000-8000-000000000a06",
    "type: variant",
    "status: draft",
    "title: Nested",
    "validity:",
    "  - { id: 39039039-0000-4000-8000-0000000000a1 }",
    "acceptance-criteria:",
    "  - Given a nested variant, then it is refused.",
    "---",
    "",
  ].join("\n"),
};
