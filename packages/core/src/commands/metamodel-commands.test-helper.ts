// A small metamodel and its elements for the tests of the metamodel commands that change or remove
// definitions (metamodel.changeType, metamodel.removeType; later the property, relation kind and
// status commands). On fixtures/SR-004/one-repository, whose standard model the file below replaces.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { expect, onTestFinished } from "vitest";
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

export const MODEL = "metamodel/standard-model.yaml";

/**
 * Hazard has its own statuses; Risk extends it; Note has other statuses and a property only it has.
 * No type is without a status list, so a status that only one type has goes with it.
 */
export const SMALL_MODEL = [
  "reqseq-metamodel: 1",
  "types:",
  "  - key: hazard",
  "    name: Hazard",
  "    prefix: HZ   # hazards",
  "    properties: [title, severity]",
  "    required: [title]",
  "    statuses: [draft, open]",
  "  # Risk refines a hazard.",
  "  - key: risk",
  "    name: Risk",
  "    prefix: RI",
  "    extends: hazard",
  "    properties: [likelihood]",
  "  - key: note",
  "    name: Note",
  "    prefix: NO",
  "    properties: [title, remark]",
  "    required: [title]",
  "    statuses: [draft, noted]",
  "properties:",
  "  - { key: title, name: Title, kind: text, meaning: title }",
  "  - key: severity",
  "    name: Severity",
  "    kind: choice",
  "    choices:",
  "      - { key: low, name: Low }",
  "      - { key: high, name: High }",
  "  - { key: likelihood, name: Likelihood, kind: text }",
  "  # Only notes have a remark.",
  "  - { key: remark, name: Remark, kind: text }",
  "relations:",
  "  - key: about",
  "    name: About",
  "    target-types: [hazard]",
  "statuses:",
  "  - { key: draft, name: Draft, initial: true }",
  "  - { key: open, name: Open }",
  "  - { key: noted, name: Noted }",
  "",
].join("\n");

/** The text of an element file of `type` with the frontmatter `fields`. */
export const elementFile = (
  id: string,
  type: string,
  fields: Readonly<Record<string, string>> = {},
): string =>
  [
    "---",
    `id: ${id}`,
    `type: ${type}`,
    ...Object.entries({ status: "draft", title: "An element", ...fields }).map(([k, v]) => `${k}: ${v}`),
    "---",
    "",
    "Text.",
    "",
  ].join("\n");

/** The UUID number `n` (1 to 99) of the tests. */
export const uuid = (n: number): string => `0b7c6e1a-1111-4222-8333-${String(n).padStart(12, "0")}`;

/** Element files by path: `[n, type, fields]` each, in `elements/`. */
export const elements = (
  ...list: readonly (readonly [number, string, Readonly<Record<string, string>>?])[]
): Record<string, string> =>
  Object.fromEntries(
    list.map(([n, type, fields]) => [
      `elements/E-${String(n).padStart(12, "0")}.md`,
      elementFile(uuid(n), type, fields),
    ]),
  );

export interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  readonly read: (file: string) => Promise<string>;
}

/**
 * The fixture with the small model (or `model`) and `files`. Its one system requirement stays, of a
 * type the small model does not have: it uses no definition.
 */
export const openSmall = async (
  files: FixtureOptions["files"] = {},
  model: string = SMALL_MODEL,
  options: FixtureOptions = {},
): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: { [MODEL]: model, ...files },
    ...options,
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace, read: (file) => fs.readFile(fixture.path(file), "utf8") };
};

/**
 * fixtures/SR-004/three-repositories with the small model in `system` and `files` (relative to the
 * folder of the repositories, `product/…`): elements of the other repositories count too. `read`
 * takes a path in `system`. The need of `product` and the requirements of `system` and `sensor`
 * are of types the small model does not have.
 */
export const openSmallAcross = async (
  files: FixtureOptions["files"] = {},
  model: string = SMALL_MODEL,
): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/three-repositories",
    files: { [`system/${MODEL}`]: model, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace, read: (file) => fs.readFile(fixture.path(`system/${file}`), "utf8") };
};

/** Runs `command` through MCP. */
export const run = async <T>(workspace: Workspace, command: CommandName, input: unknown): Promise<T> =>
  (await invoke(command, input, { workspace, access: "mcp" })) as T;

/** The error `command` fails with. */
export const failure = async (
  workspace: Workspace,
  command: CommandName,
  input: unknown,
): Promise<CommandError> => {
  let error: unknown;
  await run(workspace, command, input).catch((thrown: unknown) => {
    error = thrown;
  });
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** A workspace file with a second repository that is not on this machine. */
export const WITH_MISSING_REPOSITORY = [
  "reqseq-workspace: 1",
  "name: Weather station",
  "repositories:",
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
  '  - { name: product, url: "git@git.example.com:ws/product.git" }',
  "metamodel: { repository: system, path: metamodel }",
  "",
].join("\n");

export const WORKSPACE_FILE = "reqseq-workspace.yaml";
