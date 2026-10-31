// The action "Show metamodel" (SR-130 AK1): it opens the metamodel buffer as a graph from any buffer and
// covers `metamodel.get`, so the command prompt lists the command once, as this action.
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it, vi } from "vitest";
import type { CommandListing } from "../shared/protocol.js";
import { ACTIONS, commandPrompt, runAction } from "./actions.js";
import type { BufferAction, Buffers } from "./buffers.js";
import {
  METAMODEL_KEY,
  bufferName,
  elementBuffer,
  graphBuffer,
  listBuffer,
  metamodelBuffer,
  overviewBuffer,
  reduceBuffers,
  withMatrix,
} from "./buffers.js";
import type { CatalogContext } from "./catalog-commands.js";
import { catalogItems } from "./catalog-commands.js";
import { rank } from "./fuzzy.js";
import { bufferView } from "./modeline.js";

const runtime = getCommandRuntime();
const CATALOG: readonly CommandListing[] = runtime.contracts.commands.map((entry) => ({
  ...entry,
  implemented: runtime.commands.has(entry.name),
}));

const setup = (buffers: Buffers, workspace = true) => {
  const dispatched: BufferAction[] = [];
  const context: CatalogContext = {
    workspace,
    buffers,
    mac: false,
    theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
    call: vi.fn(),
    dispatch: (action) => dispatched.push(action),
    ask: vi.fn(),
    echo: vi.fn(),
    modified: false,
    closeArmed: () => false,
    armClose: () => undefined,
    discard: () => undefined,
    drafted: () => false,
    cycleOrder: [],
    cycled: () => undefined,
    leaveEditor: () => undefined,
    revision: () => 1,
    reopen: () => undefined,
  };
  return { context, dispatched };
};

/** What the command prompt lists on `buffers`: the actions that apply and the catalog's read commands. */
const listed = (buffers: Buffers): string[] => {
  const { context } = setup(buffers);
  return commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS)).items.map(
    (item) => item.name,
  );
};

const show = ACTIONS.find((action) => action.id === "metamodel");

const element = elementBuffer("uuid-1", "spec", "SR-1 Title");
const graph = graphBuffer("uuid-1", "spec", "SR-1 Title");
const list = listBuffer("All elements");
const BUFFERS: readonly Buffers[] = [
  [],
  [overviewBuffer()],
  [list],
  [withMatrix(list, true)],
  [element],
  [graph, element],
];

describe("Show metamodel", () => {
  it("[SR-130/AK1] Show metamodel opens the metamodel as a graph from any buffer and covers metamodel.get, so the prompt lists it once", () => {
    expect(show?.title).toBe("Show metamodel");
    expect(show?.covers).toEqual(["metamodel.get"]);
    expect(CATALOG.find((entry) => entry.name === "metamodel.get")?.title).toBe("Show metamodel");
    for (const buffers of BUFFERS) {
      const names = listed(buffers);
      expect(
        names.filter((name) => name === "Show metamodel"),
        bufferName(buffers[0] ?? list),
      ).toEqual(["Show metamodel"]);
      const { context, dispatched } = setup(buffers);
      // The initials find it among the first three (SR-108 AK1).
      const found = rank(commandPrompt(context).items, (item) => item.name, "sm")
        .slice(0, 3)
        .find(({ item }) => item.name === "Show metamodel");
      expect(found).toBeDefined();
      found?.item.run();
      expect(dispatched).toEqual([
        { type: "open", buffer: { kind: "metamodel", key: METAMODEL_KEY, mode: "graph" } },
      ]);
      const after = reduceBuffers(buffers, dispatched[0] ?? { type: "reset" });
      expect(after[0]).toEqual(metamodelBuffer());
      expect(bufferView(metamodelBuffer(), { kind: "metamodel", types: 5 })).toEqual([
        "Metamodel",
        "5 types",
      ]);
    }
    // On the metamodel itself neither the action nor the command is listed (SR-133).
    expect(listed([metamodelBuffer(), list])).not.toContain("Show metamodel");
  });

  it("brings the open metamodel buffer to the front as a graph with its selection, and is not offered without a workspace", () => {
    const open = { ...metamodelBuffer("text"), selected: "type:decision", row: "relation:blocks" };
    const { context, dispatched } = setup([list, open]);
    if (show === undefined) {
      throw new Error("no action metamodel");
    }
    runAction(show, context);
    const graphMode = { ...open, mode: "graph" };
    expect(dispatched).toEqual([{ type: "open", buffer: graphMode }]);
    expect(reduceBuffers([list, open], dispatched[0] ?? { type: "reset" })).toEqual([graphMode, list]);
    expect(show.available(setup([list], false).context)).toBe(false);
    expect(bufferView(metamodelBuffer(), { kind: "metamodel", types: 1 })).toEqual(["Metamodel", "1 type"]);
  });
});

const toText = ACTIONS.find((action) => action.id === "metamodel-text");
const toGraph = ACTIONS.find((action) => action.id === "metamodel-graph");

describe("Show metamodel as text, Show metamodel as graph", () => {
  it("[SR-130/AK4] Show metamodel as text and Show metamodel as graph switch with Ctrl/Cmd+T on the metamodel only and keep the selected type", () => {
    if (toText === undefined || toGraph === undefined) {
      throw new Error("no metamodel toggle");
    }
    expect(toText.title).toBe("Show metamodel as text");
    expect(toGraph.title).toBe("Show metamodel as graph");
    expect(toText.shortcut).toEqual({ mod: true, shift: false, key: "t" });
    expect(toGraph.shortcut).toEqual(toText.shortcut);
    const graphMode = { ...metamodelBuffer(), selected: "type:decision" };
    const textMode = { ...graphMode, mode: "text" as const };
    // Graph to text and back, the selection kept; never both offered, nowhere else.
    const onGraph = setup([graphMode, list]);
    expect([toText.available(onGraph.context), toGraph.available(onGraph.context)]).toEqual([true, false]);
    runAction(toText, onGraph.context);
    expect(onGraph.dispatched).toEqual([{ type: "open", buffer: textMode }]);
    const onText = setup([textMode, list]);
    expect([toText.available(onText.context), toGraph.available(onText.context)]).toEqual([false, true]);
    runAction(toGraph, onText.context);
    expect(onText.dispatched).toEqual([{ type: "open", buffer: graphMode }]);
    for (const buffers of BUFFERS) {
      const { context } = setup(buffers);
      expect([toText.available(context), toGraph.available(context)], bufferName(buffers[0] ?? list)).toEqual(
        [false, false],
      );
    }
    // Run where it does not apply (a stale prompt), it does nothing.
    const elsewhere = setup([list]);
    toText.run(elsewhere.context);
    toGraph.run(elsewhere.context);
    expect(elsewhere.dispatched).toEqual([]);
    expect(bufferView(textMode, { kind: "metamodel", types: 5 })).toEqual(["Metamodel · text", "5 types"]);
    // On the text, the prompt offers the way back to the graph, not "Show metamodel" (review N2).
    expect(listed([textMode, list])).toContain("Show metamodel as graph");
    expect(listed([textMode, list])).not.toContain("Show metamodel");
  });
});
