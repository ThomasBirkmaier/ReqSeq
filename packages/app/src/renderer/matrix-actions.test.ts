// The actions of the traceability matrix (SR-125): Ctrl/Cmd+T toggles a list between rows and matrix, a
// package page opens its members as a matrix, and the list actions keep the mode. The actions run against
// a context that records what they dispatch.
import { describe, expect, it, vi } from "vitest";
import { ACTIONS, actionFor, commandPrompt, runAction } from "./actions.js";
import type { Action, ActionContext, Prompt } from "./actions.js";
import type { Buffers, ListBuffer } from "./buffers.js";
import {
  bufferName,
  elementBuffer,
  filteredList,
  listBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  reduceBuffers,
  searchBuffer,
  withMatrix,
} from "./buffers.js";
import type { Call } from "./call.js";
import { matches } from "./keys.js";
import { savedStep, statusStep, textStep, typeStep } from "./list-filters.js";
import { bufferView } from "./modeline.js";
import { packageSelection } from "./package-page.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const action = (id: string): Action => {
  const found = ACTIONS.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no action ${id}`);
  }
  return found;
};

/** A context over `buffers` that applies what the actions dispatch, as the window does. */
const start = (initial: Buffers, answers: Record<string, unknown> = {}, members = false) => {
  const asked: Prompt[] = [];
  const call = vi.fn((name: string) => Promise.resolve({ ok: true, output: answers[name] }));
  const context: ActionContext = {
    workspace: true,
    buffers: initial,
    mac: false,
    theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
    call: call as unknown as Call,
    dispatch: (change) => {
      (context as { buffers: Buffers }).buffers = reduceBuffers(context.buffers, change);
    },
    ask: (prompt) => asked.push(prompt),
    echo: vi.fn(),
    modified: false,
    closeArmed: () => false,
    armClose: () => undefined,
    discard: () => undefined,
    drafted: () => false,
    ...(members
      ? {
          element: {
            save: vi.fn(),
            edit: vi.fn(),
            follow: vi.fn(),
            copy: vi.fn(),
            addProperty: vi.fn(),
            clearProperty: vi.fn(),
            members,
          },
        }
      : {}),
  };
  const shown = (): ListBuffer => {
    const [current] = context.buffers;
    if (current?.kind !== "list") {
      throw new Error("no list");
    }
    return current;
  };
  const choose = async (id: string, name: string): Promise<void> => {
    action(id).run(context);
    await flush();
    asked
      .at(-1)
      ?.items.find((item) => item.name === name)
      ?.run();
  };
  return { context, shown, asked, choose };
};

const titles = (context: ActionContext): string[] => commandPrompt(context).items.map((item) => item.name);

const steps = [typeStep("system-requirement"), statusStep("draft")];
const matrixList = withMatrix(filteredList(steps, [{ by: "title", order: "asc" }]), true);
const sample = filteredList(steps, [{ by: "title", order: "asc" }]);
const page = elementBuffer("uuid-pkg", "spec", "PKG-1 Stage 3");

describe("the matrix as a mode of the list (SR-125)", () => {
  it("[SR-125/AK1] Show traceability matrix puts the same list into matrix mode: same steps, selection, sort and row", () => {
    const { context, shown } = start([{ ...sample, cursor: 4 }]);
    runAction(action("matrix"), context);
    expect(shown()).toEqual({ ...sample, cursor: 4, matrix: true });
    expect(shown().selection).toBe(sample.selection);
    expect(shown().key).toBe(sample.key);
    expect(context.buffers).toHaveLength(1);
  });

  it("[SR-125/AK1] Show as list brings the list back, the row kept", () => {
    const { context, shown } = start([{ ...matrixList, cursor: 7 }]);
    runAction(action("matrix-list"), context);
    expect(shown()).toEqual({ ...sample, cursor: 7 });
    expect("matrix" in shown()).toBe(false);
  });

  it("offers one of the two on a list, never both, and nothing on other buffers", () => {
    const onList = start([sample]).context;
    expect(titles(onList)).toContain("Show traceability matrix");
    expect(titles(onList)).not.toContain("Show as list");
    const onMatrix = start([matrixList]).context;
    expect(titles(onMatrix)).toContain("Show as list");
    expect(titles(onMatrix)).not.toContain("Show traceability matrix");
    for (const buffers of [
      [overviewBuffer()],
      [searchBuffer("wind")],
      [elementBuffer("uuid-1", "spec", "SR-1 Wind")],
      [neighbourhoodBuffer("uuid-1", "spec", "SR-1 Wind")],
      [],
    ] as Buffers[]) {
      expect(titles(start(buffers).context)).not.toContain("Show traceability matrix");
      expect(titles(start(buffers).context)).not.toContain("Show as list");
    }
  });

  it("[SR-125/AK1] both are Ctrl+T or Cmd+T, and the shortcut finds exactly one of them", () => {
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
      const press = (shortcut: Parameters<typeof matches>[1]) =>
        matches(
          { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: "t", ...modifiers },
          shortcut,
        );
      expect(actionFor(start([sample]).context, press)?.id).toBe("matrix");
      expect(actionFor(start([matrixList]).context, press)?.id).toBe("matrix-list");
      expect(actionFor(start([page], {}, true).context, press)?.id).toBe("matrix");
      expect(actionFor(start([overviewBuffer()]).context, press)).toBeUndefined();
    }
    const hints = commandPrompt(start([sample]).context).items.filter((item) => item.name.includes("matrix"));
    expect(hints.map((item) => item.hint)).toEqual(["Ctrl+T"]);
    expect(
      commandPrompt({ ...start([matrixList]).context, mac: true }).items.find(
        (i) => i.name === "Show as list",
      )?.hint,
    ).toBe("⌘T");
  });

  it("[SR-125/AK1] a package page shows its elements as a matrix: the list of its members in matrix mode, in its sort", () => {
    const sorted = { ...page, memberSort: [{ by: "hierarchy" as const, order: "asc" as const }] };
    const { context, shown } = start([sorted], {}, true);
    expect(titles(context)).toContain("Show traceability matrix");
    runAction(action("matrix"), context);
    const expected = filteredList(
      [{ label: "package: PKG-1 Stage 3", selection: packageSelection("uuid-pkg") }],
      sorted.memberSort,
      true,
    );
    expect(shown()).toEqual(expected);
    expect(shown().selection).toEqual({ where: { package: "uuid-pkg" } });
    // A page that was not sorted gives the list the sort of every list (none chosen).
    const unsorted = start([page], {}, true);
    runAction(action("matrix"), unsorted.context);
    expect(unsorted.shown().sort).toBeUndefined();
    expect(unsorted.shown().matrix).toBe(true);
  });

  it("offers the matrix on an element only when it is a package page", () => {
    expect(titles(start([page]).context)).not.toContain("Show traceability matrix");
    expect(titles(start([page], {}, true).context)).toContain("Show traceability matrix");
  });

  it("does nothing when it is run without a list or a package page", () => {
    const { context } = start([overviewBuffer()]);
    action("matrix").run(context);
    action("matrix-list").run(context);
    expect(context.buffers).toEqual([overviewBuffer()]);
  });

  it("[SR-125/AK1] names the matrix in the buffer name and so in the modeline, and says nothing for a list", () => {
    expect(bufferName(matrixList)).toBe(
      "type: system-requirement · status: draft · sorted by title · matrix",
    );
    expect(bufferName(sample)).toBe("type: system-requirement · status: draft · sorted by title");
    expect(bufferView(matrixList, { kind: "list", total: 3, incomplete: false })).toEqual([
      "type: system-requirement · status: draft · sorted by title · matrix",
      "3 elements",
    ]);
    expect(bufferName(withMatrix(listBuffer("All elements"), true))).toBe("All elements · matrix");
  });

  describe("the list actions keep the matrix mode", () => {
    const base = withMatrix(
      filteredList([typeStep("need"), statusStep("draft")], [{ by: "title", order: "asc" }]),
      true,
    );

    it("[SR-125/AK1] filter by type, status, property and text and saved filter keep it", async () => {
      const { shown, choose, asked, context } = start([base], {
        "metamodel.get": { types: [{ key: "need" }] },
        "filter.list": { filters: [{ name: "open" }] },
        "element.facets": {
          total: 1,
          statuses: [{ key: "draft", count: 1 }],
          properties: [
            {
              key: "topic",
              name: "Topic",
              kind: "text",
              count: 1,
              missing: 0,
              distinct: 1,
              values: [{ value: "a", count: 1 }],
            },
          ],
          incomplete: false,
        },
      });
      await choose("filter-type", "need");
      expect(shown().matrix).toBe(true);
      expect(shown().steps).toHaveLength(3);
      await choose("filter-status", "draft");
      expect(shown().matrix).toBe(true);
      expect(shown().steps).toHaveLength(4);
      await choose("filter-property", "topic");
      asked.at(-1)?.items[0]?.run();
      expect(shown().matrix).toBe(true);
      expect(shown().steps).toHaveLength(5);
      action("filter-text").run(context);
      asked.at(-1)?.text?.("wind");
      expect(shown().matrix).toBe(true);
      expect(shown().steps.at(-1)).toEqual(textStep("wind"));
      await choose("filter-saved", "open");
      expect(shown().matrix).toBe(true);
      expect(shown().steps.at(-1)).toEqual(savedStep("open"));
      expect(shown().sort).toEqual([{ by: "title", order: "asc" }]);
    });

    it("[SR-125/AK1] clear list filter and clear all list filters keep it", () => {
      const { context, shown } = start([base]);
      action("clear-filter").run(context);
      expect(shown()).toEqual(withMatrix(filteredList(base.steps.slice(0, 1), base.sort), true));
      const again = start([base]);
      action("clear-filters").run(again.context);
      expect(again.shown()).toEqual(withMatrix(filteredList([], base.sort), true));
      expect(again.shown().label).toBe("All elements");
    });

    it("[SR-125/AK1] sort keeps it, and the steps", () => {
      const { context, shown, asked } = start([base]);
      action("sort").run(context);
      asked.at(-1)?.items[10]?.run();
      expect(shown().matrix).toBe(true);
      expect(shown().steps).toEqual(base.steps);
      expect(shown().sort).toEqual([{ by: "hierarchy", order: "asc" }]);
    });

    it("a list without the mode stays a list under the same actions", () => {
      const { context, shown } = start([sample]);
      action("clear-filter").run(context);
      expect("matrix" in shown()).toBe(false);
    });
  });
});
