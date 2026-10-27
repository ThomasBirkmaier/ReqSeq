// @vitest-environment happy-dom
import type { DataExportElement } from "@logreq/core";
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Buffer, BufferAction, NeighbourhoodBuffer } from "./buffers.js";
import { elementBuffer, neighbourhoodBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import { ElementView } from "./ElementView.js";
import type { BufferData } from "./modeline.js";
import { NeighbourhoodView } from "./NeighbourhoodView.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const render = async (node: React.ReactElement): Promise<void> => {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
  await flush();
};

const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

const texts = (selector: string): string[] =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent);

const press = async (target: Element, key: string): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await flush();
};

const click = async (target: Element): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

// The data of fixtures/SR-107/neighbourhood as `trace.neighbourhood` gives it: the need N1 has the
// requirements S1 and S2, the component requirement C1 derives from both (S2 is the repeat), and C1 has
// the child G1. S1 is excluded by V1 and referenced by E.
const node = (name: string, depth: number, extra: object = {}) => ({
  id: `uuid-${name}`,
  shortId: `X-${name}`,
  identifier: name,
  type: "t",
  title: `Title ${name}`,
  status: "draft",
  repository: "spec",
  file: `${name}.md`,
  depth,
  expanded: true,
  ...extra,
});

const edge = (source: string, target: string, extra: object = {}) => ({
  source: `uuid-${source}`,
  sourceRepository: "spec",
  target: `uuid-${target}`,
  targetRepository: "spec",
  link: "relation",
  kind: "derives-from",
  meaning: "derivation",
  direction: "down",
  cyclic: false,
  repeated: false,
  outdated: false,
  ...extra,
});

const answer = (root: string, nodes: object[], edges: object[], extra: object = {}) => ({
  root: `uuid-${root}`,
  nodes,
  total: nodes.length,
  edges,
  incomplete: false,
  ...extra,
});

const down = { direction: "down" };

/** The tree of N1 for `maxDepth` levels. */
const treeOf = (maxDepth: number, extra: object = {}) =>
  answer(
    "N1",
    [
      node("N1", 0),
      node("S1", 1, down),
      node("S2", 1, down),
      node("C1", 2, { ...down, expanded: maxDepth > 2 }),
      ...(maxDepth > 2 ? [node("G1", 3, { ...down, expanded: maxDepth > 3 })] : []),
    ],
    [
      edge("S1", "N1"),
      edge("S2", "N1"),
      edge("C1", "S1"),
      edge("C1", "S2", { repeated: true }),
      ...(maxDepth > 2 ? [edge("G1", "C1")] : []),
    ],
    extra,
  );

const incomingOf = (extra: object = {}) =>
  answer(
    "N1",
    [node("N1", 0), node("S1", 1, down), node("V1", 1, down), node("E", 1, down)],
    [
      edge("S1", "N1"),
      edge("V1", "N1", { kind: "excludes", meaning: "exclusion" }),
      edge("E", "N1", { link: "reference", kind: undefined, meaning: "reference", outdated: true }),
    ],
    extra,
  );

const parentsOfC1 = () =>
  answer(
    "C1",
    [node("C1", 0), node("S1", 1, { direction: "up" }), node("N1", 2, { direction: "up" })],
    [edge("C1", "S1", { direction: "up", outdated: true }), edge("S1", "N1", { direction: "up" })],
  );

const noParents = (input: Record<string, unknown>) =>
  answer(String(input["ref"]).replace("uuid-", ""), [node(String(input["ref"]).replace("uuid-", ""), 0)], []);

type Handler = (input: Record<string, unknown>) => unknown;

/** A call that answers `trace.neighbourhood` by what is asked: the parents, the tree or the incoming links. */
const fakeCall = (over: { tree?: Handler; incoming?: Handler; parents?: Handler } = {}) =>
  vi.fn((_name: string, input: Record<string, unknown>) => {
    const handler =
      input["direction"] === "up"
        ? (over.parents ?? noParents)
        : input["meanings"] === undefined
          ? (over.incoming ?? (() => incomingOf()))
          : (over.tree ?? ((asked) => treeOf(Number(asked["maxDepth"]))));
    const output = handler(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
const asCall = (call: ReturnType<typeof fakeCall>): Call => call as unknown as Call;

const N1 = neighbourhoodBuffer("uuid-N1", "spec", "N1 Title N1");

/** The neighbourhood buffer in a real buffer state, and what happened to it. */
const mount = async (call: Call, initial: NeighbourhoodBuffer = N1, revision = 0) => {
  const actions: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const Harness = ({ rev }: { rev: number }): React.ReactElement => {
    const [buffers, dispatch] = useReducer(reduceBuffers, [initial] as readonly Buffer[]);
    const current = buffers[0];
    if (current?.kind !== "neighbourhood") {
      return createElement("p", { id: "elsewhere" }, current?.key ?? "none");
    }
    return createElement(NeighbourhoodView, {
      call,
      buffer: current,
      revision: rev,
      dispatch: (action) => {
        actions.push(action);
        dispatch(action);
      },
      onData: (key, loaded) => data.push([key, loaded]),
      onEcho: (message) => echoed.push(message),
    });
  };
  const show = (rev: number): Promise<void> => render(createElement(Harness, { rev }));
  await show(revision);
  return { actions, data, echoed, show };
};

const rows = (selector = '[role="treeitem"]'): string[] =>
  [...container.querySelectorAll(selector)].map((row) =>
    [...row.querySelectorAll(".id, .title")].map((cell) => cell.textContent).join(" "),
  );

const selected = (): string[] =>
  [...container.querySelectorAll('[aria-selected="true"]')].map(
    (row) => row.querySelector(".id")?.textContent ?? "",
  );

const asked = (call: ReturnType<typeof fakeCall>, direction: string, meanings?: boolean) =>
  call.mock.calls.filter(
    ([, input]) =>
      input["direction"] === direction &&
      (meanings === undefined || (input["meanings"] !== undefined) === meanings),
  );

describe("NeighbourhoodView", () => {
  it("[SR-107/AK2] shows the children as an indented tree and below it the incoming links by kind", async () => {
    const call = fakeCall();
    await mount(asCall(call));
    expect(query("article, .neighbourhood").getAttribute("aria-label")).toBe("Neighbourhood: N1 Title N1");
    expect(query("h1").textContent).toBe("N1 Title N1");
    expect(texts("h2")).toEqual(["Children", "← excludes", "← inline reference"]);
    expect(rows()).toEqual(["S1 ▸Title S1", "S2 ▸Title S2"]);
    expect(rows('[aria-label="← excludes"] [role="option"]')).toEqual(["V1 Title V1"]);
    expect(rows('[aria-label="← inline reference"] [role="option"]')).toEqual(["E Title E outdated"]);
    expect(
      [...container.querySelectorAll('[role="treeitem"]')].map((row) => row.getAttribute("aria-expanded")),
    ).toEqual(["false", "false"]);
    expect(call).toHaveBeenCalledWith("trace.neighbourhood", {
      ref: "uuid-N1",
      repository: "spec",
      direction: "down",
      meanings: ["derivation"],
      maxDepth: 2,
      limit: 5000,
    });
    expect(asked(call, "down", false)).toHaveLength(1);
    expect(selected()).toEqual(["S1"]);
  });

  it("[SR-107/AK2] Right opens a row and asks again from the element with one more level; Left closes it or goes to the parent", async () => {
    const call = fakeCall();
    const { actions } = await mount(asCall(call));
    await press(query(".neighbourhood"), "ArrowRight");
    expect(actions.at(-1)).toMatchObject({ type: "open", buffer: { open: ["spec:uuid-S1"], cursor: 0 } });
    expect(asked(call, "down", true).map(([, input]) => input["maxDepth"])).toEqual([2, 3]);
    expect(rows()).toEqual(["S1 ▾Title S1", "C1 ▸Title C1", "S2 ▸Title S2"]);
    expect(query('[role="tree"] [role="treeitem"]:nth-child(2)').getAttribute("aria-level")).toBe("2");
    // Right on an open row, and Left on a row of the first level, do nothing.
    await press(query(".neighbourhood"), "ArrowRight");
    expect(asked(call, "down", true)).toHaveLength(2);
    await press(query(".neighbourhood"), "ArrowDown");
    await press(query(".neighbourhood"), "ArrowLeft");
    expect(selected()).toEqual(["S1"]);
    await press(query(".neighbourhood"), "ArrowLeft");
    expect(rows()).toEqual(["S1 ▸Title S1", "S2 ▸Title S2"]);
    // Closed again: asking once more is not needed, and opening it again is quick.
    await press(query(".neighbourhood"), "ArrowRight");
    expect(asked(call, "down", true)).toHaveLength(2);
    expect(rows()).toHaveLength(3);
  });

  it("[SR-107/AK2] opens a level below the next one too, and does not guess whether the row has children before it knows", async () => {
    const call = fakeCall();
    await mount(asCall(call));
    await press(query(".neighbourhood"), "ArrowRight");
    await press(query(".neighbourhood"), "ArrowDown");
    await press(query(".neighbourhood"), "ArrowRight");
    expect(rows()).toEqual(["S1 ▾Title S1", "C1 ▾Title C1", "G1 Title G1", "S2 ▸Title S2"]);
    expect(asked(call, "down", true).map(([, input]) => input["maxDepth"])).toEqual([2, 3, 4]);
    // G1 is at the last level asked for: whether it has children is not known, so it has no state.
    expect(query('[role="tree"] [role="treeitem"]:nth-child(3)').hasAttribute("aria-expanded")).toBe(false);
  });

  it("[SR-107/AK3] shows C1 under both parents and marks the second as repeated", async () => {
    const both = { ...N1, open: ["spec:uuid-S1", "spec:uuid-S2"] };
    await mount(asCall(fakeCall()), both);
    expect(rows()).toEqual(["S1 ▾Title S1", "C1 ▸Title C1", "S2 ▾Title S2", "C1 Title C1 repeated"]);
    expect(texts(".repeated")).toEqual([" repeated"]);
  });

  it("[SR-107/AK4] marks an outdated link in the tree and among the incoming links", async () => {
    const tree = (input: Record<string, unknown>) => {
      const output = treeOf(Number(input["maxDepth"]));
      output.edges[0] = edge("S1", "N1", { outdated: true });
      return output;
    };
    await mount(asCall(fakeCall({ tree })));
    expect(texts('[role="tree"] .outdated')).toEqual([" outdated"]);
    expect(rows('[role="tree"] [role="treeitem"]')[0]).toBe("S1 ▸Title S1 outdated");
    expect(texts('[role="listbox"] .outdated')).toEqual([" outdated"]);
  });

  it("[SR-107/AK1] shows the parents above the title of the neighbourhood", async () => {
    await mount(
      asCall(fakeCall({ parents: parentsOfC1 })),
      neighbourhoodBuffer("uuid-C1", "spec", "C1 Title C1"),
    );
    const line = query(".parents");
    expect(line.textContent).toBe("Title N1 › Title S1 outdated");
    expect(line.compareDocumentPosition(query("h1")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves through the tree and on into the groups with the arrow keys, Page Up and Page Down, Home and End", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    const sheet = query(".neighbourhood");
    await press(sheet, "ArrowDown");
    expect(selected()).toEqual(["S2"]);
    await press(sheet, "ArrowDown");
    expect(selected()).toEqual(["V1"]);
    await press(sheet, "End");
    expect(selected()).toEqual(["E"]);
    await press(sheet, "ArrowDown");
    expect(selected()).toEqual(["E"]);
    await press(sheet, "PageUp");
    expect(selected()).toEqual(["S1"]);
    await press(sheet, "PageDown");
    expect(selected()).toEqual(["E"]);
    await press(sheet, "ArrowUp");
    await press(sheet, "Home");
    expect(selected()).toEqual(["S1"]);
    expect(actions.filter((action) => action.type === "cursor")).toHaveLength(8);
    await press(sheet, "a");
    expect(actions).toHaveLength(8);
  });

  it("[SR-107/AK2] Enter opens the element of a tree row and of an incoming row, keeping the row as the cursor", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    await press(query(".neighbourhood"), "Enter");
    expect(actions.slice(-2)).toMatchObject([
      { type: "cursor", key: "neighbourhood:spec:uuid-N1", cursor: 0 },
      { type: "open", buffer: { kind: "element", key: "element:spec:uuid-S1" } },
    ]);
  });

  it("[SR-107/AK2] Enter opens an incoming row, and a click opens the row that was clicked", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    await press(query(".neighbourhood"), "End");
    await press(query(".neighbourhood"), "Enter");
    expect(actions.at(-1)).toMatchObject({ type: "open", buffer: { key: "element:spec:uuid-E" } });
  });

  it("opens the element of a row that is clicked, in the tree and among the incoming links", async () => {
    const tree = await mount(asCall(fakeCall()));
    await click(query('[role="treeitem"]:nth-child(2) .id'));
    expect(tree.actions.slice(-2)).toMatchObject([
      { type: "cursor", cursor: 1 },
      { type: "open", buffer: { key: "element:spec:uuid-S2" } },
    ]);
    // The element is shown by the buffer above; this harness shows a note in its place.
    expect(container.querySelector("#elsewhere")).not.toBeNull();
    const incoming = await mount(asCall(fakeCall()));
    await click(query('[role="option"] .id'));
    expect(incoming.actions.slice(-2)).toMatchObject([
      { type: "cursor", cursor: 2 },
      { type: "open", buffer: { key: "element:spec:uuid-V1" } },
    ]);
  });

  it("opens a row by its arrow, selects it and does not open its element", async () => {
    const call = fakeCall();
    const { actions } = await mount(asCall(call));
    await click(query('[role="treeitem"]:nth-child(2) .twisty'));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "open",
      buffer: { kind: "neighbourhood", open: ["spec:uuid-S2"], cursor: 1 },
    });
    expect(selected()).toEqual(["S2"]);
    expect(call.mock.calls.filter(([, input]) => input["maxDepth"] === 3)).toHaveLength(1);
  });

  it("has no arrow for a repeated row: a click on its place goes on to the row", async () => {
    const { actions } = await mount(asCall(fakeCall()), { ...N1, open: ["spec:uuid-S1", "spec:uuid-S2"] });
    expect(query('[role="treeitem"]:nth-child(4) .twisty').textContent).toBe("");
    await click(query('[role="treeitem"]:nth-child(4) .twisty'));
    expect(actions.at(-1)).toMatchObject({ type: "open", buffer: { key: "element:spec:uuid-C1" } });
  });

  it("says when the element has no children, and shows no group for no incoming links", async () => {
    const alone = (input: Record<string, unknown>) => noParents({ ref: input["ref"] });
    await mount(asCall(fakeCall({ tree: alone, incoming: alone })));
    expect(query(".quiet").textContent).toBe("No children");
    expect(texts("h2")).toEqual(["Children"]);
    await press(query(".neighbourhood"), "Enter");
    await press(query(".neighbourhood"), "ArrowLeft");
    await press(query(".neighbourhood"), "ArrowRight");
  });

  it("echoes why the tree or the incoming links could not be read, and shows the rest", async () => {
    const broken = new Error("The workspace is not valid");
    const first = await mount(asCall(fakeCall({ tree: () => broken })));
    expect(texts(".quiet")).toEqual(["The workspace is not valid"]);
    expect(first.echoed).toEqual(["The workspace is not valid"]);
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(texts("h2")).toEqual(["← excludes", "← inline reference"]);
    const second = await mount(asCall(fakeCall({ incoming: () => broken })));
    expect(second.echoed).toEqual(["The workspace is not valid"]);
    expect(rows()).toEqual(["S1 ▸Title S1", "S2 ▸Title S2"]);
  });

  it("keeps the tree and says why a deeper level could not be read", async () => {
    let fail = false;
    const tree = (input: Record<string, unknown>) =>
      fail ? new Error("busy") : treeOf(Number(input["maxDepth"]));
    const { echoed } = await mount(asCall(fakeCall({ tree })));
    fail = true;
    await press(query(".neighbourhood"), "ArrowRight");
    expect(echoed).toEqual(["busy"]);
    expect(texts(".quiet")).toEqual(["busy"]);
    // C1 was in the first answer: it is shown, and whether it has children is not known.
    expect(rows()).toEqual(["S1 ▾Title S1", "C1 Title C1", "S2 ▸Title S2"]);
  });

  it("asks deep enough at once for rows that were open when the buffer was shown again", async () => {
    const call = fakeCall();
    const deep = { ...N1, open: ["spec:uuid-S1", "spec:uuid-C1"] };
    await mount(asCall(call), deep);
    expect(asked(call, "down", true).map(([, input]) => input["maxDepth"])).toEqual([2, 4]);
    expect(rows()).toEqual(["S1 ▾Title S1", "C1 ▾Title C1", "G1 Title G1", "S2 ▸Title S2"]);
  });

  it("asks again when the workspace changed, keeps the rows until the answer is there, and asks for as many levels", async () => {
    const call = fakeCall();
    const { show } = await mount(asCall(call));
    await press(query(".neighbourhood"), "ArrowRight");
    const before = call.mock.calls.length;
    await show(1);
    expect(call.mock.calls.slice(before).map(([, input]) => [input["direction"], input["maxDepth"]])).toEqual(
      [
        ["up", undefined],
        ["down", 3],
        ["down", 1],
      ],
    );
    expect(rows()).toEqual(["S1 ▾Title S1", "C1 ▸Title C1", "S2 ▸Title S2"]);
  });

  it("drops an answer that comes after a later question or after the buffer is gone", async () => {
    const waiting: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      (_name: string, input: Record<string, unknown>) =>
        new Promise((resolve) => {
          if (input["direction"] === "up") {
            resolve({ ok: true, output: noParents({ ref: "uuid-N1" }) });
          } else {
            waiting.push(resolve);
          }
        }),
    );
    const { show } = await mount(call as unknown as Call);
    // The first tree and incoming answers are still on their way when the workspace changes.
    await show(1);
    const [firstTree, firstIncoming, secondTree, secondIncoming] = waiting;
    const give = async (resolve: ((value: unknown) => void) | undefined, output: unknown): Promise<void> => {
      await act(async () => {
        resolve?.({ ok: true, output });
        await Promise.resolve();
      });
      await flush();
    };
    await give(secondTree, treeOf(2));
    await give(secondIncoming, incomingOf());
    await give(firstTree, answer("N1", [node("N1", 0)], []));
    await give(firstIncoming, answer("N1", [node("N1", 0)], []));
    expect(rows()).toEqual(["S1 ▸Title S1", "S2 ▸Title S2"]);
    expect(texts("h2")).toEqual(["Children", "← excludes", "← inline reference"]);
  });

  it("tells the modeline whether the answer is incomplete, once both answers are there", async () => {
    const complete = await mount(asCall(fakeCall()));
    expect(complete.data).toEqual([
      ["neighbourhood:spec:uuid-N1", { kind: "neighbourhood", incomplete: false }],
    ]);
    const tree = await mount(
      asCall(fakeCall({ tree: (input) => treeOf(Number(input["maxDepth"]), { incomplete: true }) })),
    );
    expect(tree.data.at(-1)).toEqual([
      "neighbourhood:spec:uuid-N1",
      { kind: "neighbourhood", incomplete: true },
    ]);
    const incoming = await mount(asCall(fakeCall({ incoming: () => incomingOf({ incomplete: true }) })));
    expect(incoming.data.at(-1)?.[1]).toEqual({ kind: "neighbourhood", incomplete: true });
    const failed = await mount(asCall(fakeCall({ tree: () => new Error("x") })));
    expect(failed.data).toEqual([]);
  });

  it("says when the tree or the incoming links are only the first ones", async () => {
    await mount(
      asCall(
        fakeCall({
          tree: (input) => treeOf(Number(input["maxDepth"]), { total: 6000 }),
          incoming: () => incomingOf({ total: 6000 }),
        }),
      ),
    );
    expect(texts(".quiet")).toEqual([
      "Only the first 5000 elements of the tree are shown",
      "Only the first 5000 incoming links are shown",
    ]);
  });

  it("leaves the keys of a link in the parents line to the link", async () => {
    const call = fakeCall({ parents: parentsOfC1 });
    const { actions } = await mount(asCall(call), neighbourhoodBuffer("uuid-C1", "spec", "C1 Title C1"));
    await press(query('.parents [role="link"]'), "Enter");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "open", buffer: { key: "element:spec:uuid-N1" } });
  });
});

describe("the parents line on the element page", () => {
  const element = (id: string) =>
    ({
      id,
      shortId: "CR-1",
      identifier: "C1",
      type: "component-requirement",
      status: "draft",
      title: "Title C1",
      repository: "spec",
      file: "c.md",
      text: "Text",
      properties: {},
      relations: [],
    }) as unknown as DataExportElement;

  const page = async (call: Call, revision = 0) => {
    const dispatched: BufferAction[] = [];
    const echoed: string[] = [];
    const node = (rev: number) =>
      createElement(ElementView, {
        call,
        buffer: elementBuffer("uuid-C1", "spec", "C1 Title C1"),
        revision: rev,
        onData: () => undefined,
        onEcho: (message) => echoed.push(message),
        onOpenRelation: () => undefined,
        onOpenTarget: () => undefined,
        onPickElement: () => undefined,
        onCopy: () => undefined,
        draft: undefined,
        onDraft: () => undefined,
        register: () => undefined,
        packages: undefined,
        markdown: new Map(),
        dispatch: (action) => dispatched.push(action),
      });
    await render(node(revision));
    return { dispatched, echoed, again: (rev: number) => render(node(rev)) };
  };

  const elementCall = (parents: Handler) =>
    vi.fn((name: string, input: Record<string, unknown>) => {
      const output = name === "element.get" ? { element: element("uuid-C1") } : parents(input);
      return Promise.resolve(
        output instanceof Error
          ? { ok: false, code: "x.failed", message: output.message }
          : { ok: true, output },
      );
    });

  it("[SR-107/AK1] shows the titles of the parents up to the top need above the title, and a click and Enter open a parent", async () => {
    const call = elementCall(parentsOfC1);
    const { dispatched } = await page(call as unknown as Call);
    expect(call).toHaveBeenCalledWith("trace.neighbourhood", {
      ref: "uuid-C1",
      repository: "spec",
      direction: "up",
      meanings: ["derivation"],
      allLevels: true,
      limit: 200,
    });
    const line = query(".parents");
    expect(line.getAttribute("aria-label")).toBe("Parents");
    expect(line.textContent).toBe("Title N1 › Title S1 outdated");
    expect(line.compareDocumentPosition(query("h1")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(texts('.parents [role="link"]')).toEqual(["Title N1", "Title S1"]);
    expect(query('.parents [role="link"]').getAttribute("title")).toBe("N1");
    await click(query('.parents [role="link"]'));
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { key: "element:spec:uuid-N1" } });
    await press(
      texts('.parents [role="link"]').length === 2
        ? (container.querySelectorAll<HTMLElement>('.parents [role="link"]')[1] ?? container)
        : container,
      "Enter",
    );
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { key: "element:spec:uuid-S1" } });
    await press(query('.parents [role="link"]'), "a");
    expect(dispatched).toHaveLength(2);
  });

  it("separates the parents of a level with a dot", async () => {
    const two = () =>
      answer(
        "C1",
        [node("C1", 0), node("N1", 1, { direction: "up" }), node("N2", 1, { direction: "up" })],
        [edge("C1", "N1", { direction: "up" }), edge("C1", "N2", { direction: "up" })],
      );
    await page(elementCall(two) as unknown as Call);
    expect(query(".parents").textContent).toBe("Title N1 · Title N2");
  });

  it("shows no line for an element without parents, and ends the line with … when there are more than were asked for", async () => {
    await page(elementCall(noParents) as unknown as Call);
    expect(container.querySelector(".parents")).toBeNull();
    expect(query("h1").textContent).toBe("Title C1");
    const more = elementCall(() => ({ ...parentsOfC1(), total: 300 }));
    await page(more as unknown as Call);
    expect(query(".parents").textContent).toBe("Title N1 › Title S1 outdated …");
  });

  it("drops the parents of an element that is gone when they arrive", async () => {
    let give: (value: unknown) => void = () => undefined;
    const call = vi.fn((name: string) =>
      name === "element.get"
        ? Promise.resolve({ ok: true, output: { element: element("uuid-C1") } })
        : new Promise((resolve) => {
            give = resolve;
          }),
    );
    await page(call as unknown as Call);
    await render(createElement("p"));
    await act(async () => {
      give({ ok: true, output: parentsOfC1() });
      await Promise.resolve();
    });
    expect(container.querySelector(".parents")).toBeNull();
  });

  it("echoes why the parents could not be read and shows no line; it keeps the line while it is asked again", async () => {
    let fail = false;
    const call = elementCall(() => (fail ? new Error("busy") : parentsOfC1()));
    const { echoed, again } = await page(call as unknown as Call);
    fail = true;
    expect(container.querySelector(".parents")).not.toBeNull();
    await again(1);
    expect(echoed).toEqual(["busy"]);
    expect(container.querySelector(".parents")).toBeNull();
    expect(query("h1").textContent).toBe("Title C1");
  });
});
