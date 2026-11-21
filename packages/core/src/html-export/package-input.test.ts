// ADR-0019 point 2 (D-080): the HTML export finds the elements of a package by the rule of `element.list`
// `where.package`. This test builds the display model of each package page twice on one fixture, once from the
// export's batch (`siteOf`: the elements with a page by identifier, their members by `packageMembers`) and once from
// `element.list` with `where.package` (sorted by identifier, `withVerification`) and `metamodel.get`, and checks that
// they are equal: with a member that is only in a variant's view (SR-137 AK4), a package in a package, a member with
// an invalid status (SR-231 AK1), a member of two packages, an entry that names another repository (D-058), and a
// package no element names.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { InvokedOutput } from "../catalog.js";
import type { PackageRowInput } from "../displays/index.js";
import { packageDisplay, targetKey } from "../displays/index.js";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { elementDataOf } from "./element-data.js";
import { siteOf } from "./export.js";
import { listMetamodelOf, listRowOf } from "./list-page.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const ID = "23300000-0000-4000-8000-0000000000";
const DISPLAY = `${ID}d1`;
const SCREEN = `${ID}d2`;
const EMPTY = `${ID}d3`;
const NEED = `${ID}a1`;
const ELSEWHERE = `${ID}a2`;
const OLD = `${ID}b9`;
const COAST = `${ID}c1`;

const element = (lines: readonly string[], text = ""): string =>
  ["---", ...lines, "---", "", text, ""].join("\n");

const named = (...ids: readonly string[]): string[] => [
  "packages:",
  ...ids.map((id) => `  - { id: ${id}, version: n2:0000000000000000 }`),
];

const FILES: Readonly<Record<string, string>> = {
  "requirements/SR-6328cee88fb3.md": element([
    `id: ${WIND}`,
    "type: system-requirement",
    "status: approved",
    "title: Show wind speed",
    ...named(DISPLAY, SCREEN),
  ]),
  // Valid only in the variant Coast: not in the core's view, so no verification status in the core.
  "requirements/SR-1d2e3f4a5b6c.md": element([
    `id: ${GUSTS}`,
    "type: system-requirement",
    "status: draft",
    "title: Show gusts",
    "validity:",
    `  - { id: ${COAST}, version: n2:0000000000000000 }`,
    ...named(SCREEN),
  ]),
  // An invalid status: no page, so on no package page.
  "requirements/SR-0000000000b9.md": element([
    `id: ${OLD}`,
    "type: system-requirement",
    "status: obsolete",
    "title: Show rain",
    ...named(DISPLAY),
  ]),
  "packages/PKG-0000000000d1.md": element([`id: ${DISPLAY}`, "type: package", "title: Display"]),
  // A package in the package Display.
  "packages/PKG-0000000000d2.md": element([
    `id: ${SCREEN}`,
    "type: package",
    "title: Screen",
    ...named(DISPLAY),
  ]),
  "packages/PKG-0000000000d3.md": element([`id: ${EMPTY}`, "type: package", "title: Empty"]),
  "needs/N-0000000000a1.md": element([
    `id: ${NEED}`,
    "type: need",
    "status: approved",
    "title: Know the wind",
    ...named(DISPLAY),
  ]),
  // Its entry names Display in a repository the workspace does not know: no member of Display (D-058).
  "needs/N-0000000000a2.md": element([
    `id: ${ELSEWHERE}`,
    "type: need",
    "status: approved",
    "title: Know the rain",
    "packages:",
    `  - { id: ${DISPLAY}, repository: elsewhere, version: n2:0000000000000000 }`,
  ]),
  "variants/VAR-0000000000c1.md": element([`id: ${COAST}`, "type: variant", "title: Coast"]),
};

const call = async <C extends "element.list" | "metamodel.get">(
  workspace: Workspace,
  command: C,
  input: Record<string, unknown>,
): Promise<InvokedOutput<C>> => (await invoke(command, input, { workspace })) as InvokedOutput<C>;

describe("the export finds the elements of a package by the rule of element.list (ADR-0019, D-080)", () => {
  it("gives the same model of each package page from its batch as from element.list where.package", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files: FILES });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const [layout, metamodel, store, shortIds] = await Promise.all([
      workspace.get(workspaceLayoutState),
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
      workspace.get(shortIdState),
    ]);
    const context = { layout, metamodel, store, shortIds };
    const invalid = new Set(metamodel.statuses.filter((s) => s.invalid === true).map((s) => s.key));
    const paged = new Set(store.elements.filter((r) => !invalid.has(String(r.data["status"]))));
    const data = await elementDataOf(workspace, context, store.elements);
    const { members } = await siteOf(
      workspace,
      context,
      data,
      paged,
      { baselines: [], changeOf: () => [] },
      [],
    );
    const got = await call(workspace, "metamodel.get", {});
    const options = { id: "identifier", invalid: "omit" } as const;
    const fromCommands = async (id: string): Promise<PackageRowInput[]> => {
      const listed = await call(workspace, "element.list", {
        selection: { where: { package: id } },
        sort: [{ by: "identifier", order: "asc" }],
        withVerification: true,
        limit: 5000,
      });
      return (listed.elements ?? []).map((shown, at) => ({
        element: shown,
        verification: listed.rowVerification?.[at]?.verification,
      }));
    };
    const repository = String(store.elements[0]?.repository);
    expect([...members.keys()].sort()).toEqual(
      [DISPLAY, SCREEN, EMPTY].map((id) => targetKey({ id, repository })).sort(),
    );
    const models = new Map<string, ReturnType<typeof packageDisplay>>();
    for (const id of [DISPLAY, SCREEN, EMPTY]) {
      const target = { id, repository };
      const fromExport = packageDisplay(
        {
          package: target,
          rows: (members.get(targetKey(target)) ?? []).map(listRowOf),
          metamodel: listMetamodelOf(metamodel),
        },
        options,
      );
      const commands = packageDisplay(
        { package: target, rows: await fromCommands(id), metamodel: got },
        options,
      );
      expect(fromExport).toEqual(commands);
      models.set(id, commands);
    }
    const rows = (id: string): string[][] =>
      (models.get(id)?.rows ?? []).map((row) => row.cells.map((cell) => cell.text));
    // The invalid member and the entry in another repository are not there; the package Screen is.
    expect(rows(DISPLAY)).toEqual([
      ["N-0000a1", "Know the wind", "approved", "–"],
      ["PKG-0000d2", "Screen", "–", "–"],
      ["SR-e88fb3", "Show wind speed", "approved", "open"],
    ]);
    // GUSTS is not in the core's view: no verification status there (SR-137 AK4); WIND is in two packages.
    expect(rows(SCREEN)).toEqual([
      ["SR-4a5b6c", "Show gusts", "draft", "–"],
      ["SR-e88fb3", "Show wind speed", "approved", "open"],
    ]);
    expect(rows(EMPTY)).toEqual([]);
  });
});
