// ADR-0019 point 2 (D-080): the HTML export builds the display model of its lists from the same shapes the commands
// give. This test builds each list's model twice on one fixture, once from the export's batch (`siteOf`: the
// elements with a page in the order of their identifier, their verification in the core and their open hints) and
// once from `element.list` (sorted by identifier, `withVerification`) and `hint.list`, and checks that they are equal,
// also for a requirement that is not in the core's view (SR-137 AK4, #2243).
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { InvokedOutput } from "../catalog.js";
import type { ListRowInput } from "../displays/index.js";
import { listDisplay } from "../displays/index.js";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { elementDataOf } from "./element-data.js";
import { siteOf } from "./export.js";
import { listMetamodelOf, listOrderOf, listRowOf, listsOf } from "./list-page.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const ID = "23300000-0000-4000-8000-0000000000";
const DISPLAY = `${ID}d1`;
const NEED = `${ID}a1`;
const OLD = `${ID}b9`;
const COAST = `${ID}c1`;

const element = (lines: readonly string[], text = ""): string =>
  ["---", ...lines, "---", "", text, ""].join("\n");

const FILES: Readonly<Record<string, string>> = {
  "requirements/SR-6328cee88fb3.md": element([
    `id: ${WIND}`,
    "type: system-requirement",
    "status: approved",
    "title: Show wind speed",
    "requirement-type: quality",
    "packages:",
    `  - { id: ${DISPLAY}, version: n2:0000000000000000, title: Display }`,
  ]),
  // Valid only in the variant Coast: not in the core's view.
  "requirements/SR-1d2e3f4a5b6c.md": element([
    `id: ${GUSTS}`,
    "type: system-requirement",
    "status: draft",
    "title: Show gusts",
    "requirement-type: functional",
    "validity:",
    `  - { id: ${COAST}, version: n2:0000000000000000, title: Coast }`,
    "packages:",
    `  - { id: ${DISPLAY}, version: n2:0000000000000000, title: Display }`,
    `  - { id: ${ID}dd, version: n2:0000000000000000 }`,
  ]),
  "requirements/SR-0000000000b9.md": element([
    `id: ${OLD}`,
    "type: system-requirement",
    "status: obsolete",
    "title: Show rain",
  ]),
  "packages/PKG-0000000000d1.md": element([`id: ${DISPLAY}`, "type: package", "title: Display"]),
  "needs/N-0000000000a1.md": element([
    `id: ${NEED}`,
    "type: need",
    "status: approved",
    "title: Know the wind",
    "packages:",
    `  - { id: ${DISPLAY}, version: n2:0000000000000000, title: Display }`,
  ]),
  "variants/VAR-0000000000c1.md": element([`id: ${COAST}`, "type: variant", "title: Coast"]),
};

const call = async <C extends "element.list" | "hint.list" | "metamodel.get">(
  workspace: Workspace,
  command: C,
  input: Record<string, unknown>,
): Promise<InvokedOutput<C>> => (await invoke(command, input, { workspace })) as InvokedOutput<C>;

describe("the export builds its list models from what the commands give (ADR-0019, D-080)", () => {
  it("gives the same model of each list from its batch as from element.list and hint.list", async () => {
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
    const { entries } = await siteOf(
      workspace,
      context,
      data,
      paged,
      { baselines: [], changeOf: () => [] },
      [],
    );
    const options = { id: "identifier", order: listOrderOf(metamodel) } as const;
    const listed = await call(workspace, "element.list", {
      sort: [{ by: "identifier", order: "asc" }],
      withVerification: true,
      limit: 5000,
    });
    const { hints } = await call(workspace, "hint.list", { limit: 5000 });
    const got = await call(workspace, "metamodel.get", {});
    const hintsOf = (id: string, repository: string): number =>
      hints.filter((h) => h.elementId === id && (h.elementRepository ?? h.repository) === repository).length;
    const fromCommands = (type: string): ListRowInput[] =>
      (listed.elements ?? []).flatMap((shown, at) =>
        shown.type === type && !invalid.has(String(shown.status))
          ? [
              {
                element: shown,
                verification: listed.rowVerification?.[at]?.verification,
                hints: hintsOf(shown.id, shown.repository),
              },
            ]
          : [],
      );
    const lists = listsOf(context, entries, metamodel.effectiveTypes);
    expect(lists.map((l) => l.type)).toEqual(["need", "system-requirement"]);
    for (const { type, entries: rows } of lists) {
      const fromExport = listDisplay(
        { type, rows: rows.map(listRowOf), metamodel: listMetamodelOf(metamodel) },
        options,
      );
      const commands = listDisplay({ type, rows: fromCommands(type), metamodel: got }, options);
      expect(fromExport).toEqual(commands);
    }
    const requirements = listDisplay(
      { type: "system-requirement", rows: fromCommands("system-requirement"), metamodel: got },
      options,
    );
    // GUSTS is not in the core's view: no verification status there (SR-137 AK4).
    expect(requirements.rows.map((row) => [row.cells[0], row.cells[4], row.cells[5]])).toEqual([
      [
        { kind: "id", text: "SR-4a5b6c" },
        { kind: "verification", cell: undefined, text: "–" },
        expect.objectContaining({ kind: "hints" }),
      ],
      [
        { kind: "id", text: "SR-e88fb3" },
        expect.objectContaining({ kind: "verification", text: "open" }),
        expect.objectContaining({ kind: "hints" }),
      ],
    ]);
  });
});
