// Relations in element.create (`relations`) and element.update (`addRelations`,
// `removeRelations`), by any element reference, in the command's one file write (#175).
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { computeVersion } from "../version/version.js";
import { elementStoreState } from "./store.js";

/** The elements of fixtures/SR-021/targets. */
const NEED = { id: "0c8a3e5f-2d1b-4f6e-8a9c-7b3d5e1f2a4c", short: "N-1f2a4c" };
const SENSOR_NEED = { id: "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21", short: "N-5b3a21" };
const PKG = { short: "PKG-3c7e10" };
const SOURCE = { id: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05", file: "requirements/SR-3d8b2c6e1f05.md" };

const version = (text: string): string =>
  computeVersion({ text, properties: {}, definitions: [], files: [] });
const NEED_ENTRY = `  - { id: ${NEED.id}, version: ${version("The wind speed can be read from three metres.")}, title: Wind speed visible at a glance }`;
const SENSOR_ENTRY = `  - { id: ${SENSOR_NEED.id}, version: ${version("The sensor measures gusts.")}, repository: sensor }`;

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (
  fixture = "SR-021/targets",
  root = "system",
  files: FixtureOptions["files"] = {},
): Promise<Opened> => {
  const created = await createFixtureWorkspace({ fixture, files });
  onTestFinished(() => created.cleanup());
  const workspace = new Workspace(created.path(root));
  onTestFinished(() => workspace.close());
  return { fixture: created, workspace };
};

const run = (opened: Opened, name: CommandName, input: Record<string, unknown>): Promise<unknown> =>
  invoke(name, input, { workspace: opened.workspace });

const runError = async (
  opened: Opened,
  name: CommandName,
  input: Record<string, unknown>,
): Promise<CommandError> => {
  const error: unknown = await run(opened, name, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error instanceof CommandError) {
    return error;
  }
  throw new Error(`expected ${name} to fail`);
};

/** The lines of `key` in the frontmatter of `text`: its items; none when the key is absent. */
const linesOf = (text: string, key: string): string[] => {
  const lines = text.split("\n");
  const at = lines.indexOf(`${key}:`);
  if (at < 0) {
    return [];
  }
  const end = lines.findIndex((line, i) => i > at && !line.startsWith("  - "));
  return lines.slice(at + 1, end);
};

const read = (opened: Opened, file: string, root = "system"): Promise<string> =>
  fs.readFile(opened.fixture.path(`${root}/${file}`), "utf8");

const create = async (
  opened: Opened,
  relations: Record<string, unknown>,
  root = "system",
): Promise<string> => {
  const { files } = (await run(opened, "element.create", {
    type: "system-requirement",
    title: "New",
    relations,
  })) as { files: string[] };
  return read(opened, files[0] ?? "", root);
};

const update = (opened: Opened, input: Record<string, unknown>) =>
  run(opened, "element.update", { ref: SOURCE.id, ...input }) as Promise<{
    files: string[];
    problems: Problem[];
  }>;

describe("relations in element.create (#175)", () => {
  it("writes relations of several kinds by short ID and UUID, across repositories, each target once", async () => {
    const opened = await open();
    const text = await create(opened, {
      "derives-from": [NEED.short, SENSOR_NEED.short, NEED.id.toUpperCase()],
      refines: [NEED.id],
    });
    expect(linesOf(text, "derives-from")).toEqual([NEED_ENTRY, SENSOR_ENTRY]);
    expect(linesOf(text, "refines")).toEqual([NEED_ENTRY]);
  });

  it("takes an identifier", async () => {
    const opened = await open("enabler-305/identifiers", ".");
    const text = await create(opened, { "derives-from": ["n-001"] }, ".");
    expect(linesOf(text, "derives-from")).toEqual([
      "  - { id: 30500000-0000-4000-8000-0000000a0001, version: n1:ef8aec5dd4656003, title: Name elements by their spec ID }",
    ]);
  });

  it("refuses an unknown kind, a property, an unknown target and a pair the metamodel does not allow, and creates nothing", async () => {
    const opened = await open();
    const input = (relations: Record<string, unknown>) => ({
      type: "system-requirement",
      title: "New",
      relations,
    });
    const cases: [Record<string, unknown>, string, Record<string, unknown>][] = [
      [{ follows: [NEED.short] }, "input.invalid", { kind: "follows", reason: "unknown-relation" }],
      [{ packages: [PKG.short] }, "input.invalid", { kind: "packages", reason: "property" }],
      [{ "derives-from": ["N-999999"] }, "ref.unknown", { ref: "N-999999", kind: "derives-from" }],
      [
        { "derives-from": [PKG.short] },
        "relation.not-allowed",
        { relation: "derives-from", sourceType: "system-requirement", targetType: "package" },
      ],
    ];
    for (const [relations, code, details] of cases) {
      const error = await runError(opened, "element.create", input(relations));
      expect([error.code, error.details]).toMatchObject([code, details]);
    }
    const unknown = await runError(opened, "element.create", input({ "derives-from": ["N-999999"] }));
    expect(unknown.message).toBe(
      'No element has the short ID or identifier "N-999999" (in the relation derives-from)',
    );
    expect(await fs.readdir(opened.fixture.path("system/requirements"))).toEqual(["SR-3d8b2c6e1f05.md"]);
  });
});

describe("relations in element.update (#175)", () => {
  it("adds relations together with a property and the title in one write, and keeps a relation it has", async () => {
    const opened = await open();
    const out = await update(opened, {
      title: "Changed",
      set: { topic: "Wind" },
      addRelations: { "derives-from": [NEED.short, SENSOR_NEED.short] },
    });
    expect(out.files).toEqual([SOURCE.file]);
    const text = await read(opened, SOURCE.file);
    expect(text).toContain("title: Changed\n");
    expect(text).toContain("topic: Wind\n");
    expect(linesOf(text, "derives-from")).toEqual([NEED_ENTRY, SENSOR_ENTRY]);
    const again = await update(opened, { addRelations: { "derives-from": [NEED.id] } });
    expect(again.files).toEqual([]);
    expect(await read(opened, SOURCE.file)).toBe(text);
  });

  it("gives a relation without a valid version its version in place", async () => {
    const opened = await open();
    await update(opened, { addRelations: { refines: [SENSOR_NEED.short] } });
    const file = opened.fixture.path(`system/${SOURCE.file}`);
    const before = await fs.readFile(file, "utf8");
    await fs.writeFile(file, before.replace("refines:\n", `refines:\n  - { id: ${NEED.id} }\n`));
    await opened.workspace.reset(elementStoreState);
    await update(opened, { addRelations: { refines: [NEED.short] } });
    expect(linesOf(await read(opened, SOURCE.file), "refines")).toEqual([NEED_ENTRY, SENSOR_ENTRY]);
  });

  it("removes relations, the key with its last item unless the call adds to it, and says when there is nothing to remove", async () => {
    const opened = await open();
    await update(opened, { addRelations: { "derives-from": [NEED.short, SENSOR_NEED.short] } });
    await update(opened, {
      removeRelations: { "derives-from": [NEED.id, SENSOR_NEED.short] },
      addRelations: { refines: [NEED.short] },
    });
    let text = await read(opened, SOURCE.file);
    expect(text).not.toContain("derives-from:");
    expect(linesOf(text, "refines")).toEqual([NEED_ENTRY]);
    await update(opened, {
      removeRelations: { refines: [NEED.short] },
      addRelations: { "derives-from": [SENSOR_NEED.short] },
    });
    await update(opened, {
      removeRelations: { "derives-from": [SENSOR_NEED.short] },
      addRelations: { "derives-from": [NEED.short] },
    });
    text = await read(opened, SOURCE.file);
    expect(text).not.toContain("refines:");
    expect(linesOf(text, "derives-from")).toEqual([NEED_ENTRY]);
    const none = await update(opened, { removeRelations: { refines: [NEED.short] } });
    expect(none.files).toEqual([]);
    expect(none.problems[0]).toMatchObject({
      code: "relation.not-found",
      severity: "info",
      targetId: NEED.id,
    });
  });

  it("refuses a target both added and removed under one kind, before anything is written", async () => {
    const opened = await open();
    const before = await read(opened, SOURCE.file);
    const error = await runError(opened, "element.update", {
      ref: SOURCE.id,
      addRelations: { "derives-from": [NEED.short] },
      removeRelations: { "derives-from": [NEED.id] },
    });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { kind: "derives-from", ref: NEED.id, reason: "add-and-remove" },
    ]);
    const byShortId = await runError(opened, "element.update", {
      ref: SOURCE.id,
      addRelations: { "derives-from": [NEED.id] },
      removeRelations: { "derives-from": [NEED.short] },
    });
    expect(byShortId.details).toMatchObject({ reason: "add-and-remove" });
    expect(await read(opened, SOURCE.file)).toBe(before);
  });
});
