// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Buffer, BufferAction, GraphBuffer } from "./buffers.js";
import { graphBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import * as layoutModule from "./graph-layout.js";
import { BASED_ON, S1_GRAPH, graphEdge, graphNode, graphOutput, key } from "./graph-test-data.js";
import { GRAPH_MARKS, GraphView } from "./GraphView.js";
import type { BufferData } from "./modeline.js";

vi.mock("./graph-layout.js", { spy: true });

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
  vi.mocked(layoutModule.layoutGraph).mockRestore();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

const press = async (key: string, held: KeyboardEventInit = {}): Promise<void> => {
  await act(async () => {
    query(".graph").dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...held }),
    );
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

/** A call that answers `trace.graph` with `answer(input)`; an Error is a failed call. */
const fakeCall = (answer: (input: Record<string, unknown>) => unknown = () => S1_GRAPH) =>
  vi.fn((_name: string, input: Record<string, unknown>) => {
    const output = answer(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
const asCall = (call: ReturnType<typeof fakeCall>): Call => call as unknown as Call;

const S1 = graphBuffer("uuid-S1", "spec", "S1 Title S1");
const TYPES = new Map([
  ["system-requirement", "System Requirement"],
  ["decision", "Decision"],
]);

/** The graph buffer in a real buffer state, and what happened to it. */
const mount = async (call: Call, initial: GraphBuffer = S1) => {
  const actions: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const Harness = ({ revision }: { revision: number }): React.ReactElement => {
    const [buffers, dispatch] = useReducer(reduceBuffers, [initial] as readonly Buffer[]);
    const current = buffers[0];
    if (current?.kind !== "graph") {
      return createElement("p", { id: "elsewhere" }, current?.key ?? "none");
    }
    return createElement(GraphView, {
      call,
      buffer: current,
      revision,
      dispatch: (action) => {
        actions.push(action);
        dispatch(action);
      },
      onData: (bufferKey, loaded) => data.push([bufferKey, loaded]),
      onEcho: (message) => echoed.push(message),
      typeNames: TYPES,
    });
  };
  const show = async (revision: number): Promise<void> => {
    await act(async () => {
      root.render(createElement(Harness, { revision }));
      await Promise.resolve();
    });
    await flush();
  };
  await show(0);
  return { actions, data, echoed, show };
};

const selected = (): string | undefined =>
  container.querySelector<HTMLElement>('.graph-node[aria-selected="true"]')?.dataset["node"];

describe("GraphView", () => {
  it("[SR-111/AK4] each node shows title and type name, and the mark words only on marked nodes", async () => {
    const call = fakeCall();
    const { data } = await mount(asCall(call));
    expect(call).toHaveBeenCalledWith("trace.graph", {
      ref: "uuid-S1",
      repository: "spec",
      maxDepth: 1,
      limit: 500,
    });
    const nodes = [...container.querySelectorAll<HTMLElement>(".graph-node")].map((node) => [
      node.querySelector(".graph-id")?.textContent,
      node.querySelector(".graph-title")?.textContent,
      [...node.querySelectorAll(".graph-marks > span")].map(
        (mark) => `${mark.className}:${mark.textContent}`,
      ),
    ]);
    expect(nodes).toEqual([
      ["S1 · System Requirement", "Title S1", ["outdated:outdated"]],
      ["N1 · need", "Title N1", []],
      ["D1 · Decision", "Title D1", []],
      ["PKG-1 · package", "Title PKG", []],
      ["O1 · System Requirement", "Title O1", ["superseded:superseded", "gap:no evidence"]],
      ["D2 · Decision", "Title D2", []],
      ["C1 · System Requirement", "Title C1", []],
      ["C2 · System Requirement", "Title C2", ["outdated:outdated", "gap:no evidence"]],
      ["C3 · System Requirement", "Title C3", ["gap:no evidence"]],
      ["E · Decision", "Title E", []],
    ]);
    expect(query(`[data-node="${key("O1")}"]`).className).toBe("graph-node superseded");
    expect(query(`[data-node="${key("O1")}"]`).getAttribute("aria-label")).toBe(
      "O1 System Requirement Title O1 superseded no evidence",
    );
    expect(data.at(-1)).toEqual([S1.key, { kind: "graph", nodes: 10, truncated: false, incomplete: false }]);
    expect(performance.getEntriesByName(GRAPH_MARKS.layout).length).toBeGreaterThan(0);
  });

  it("[SR-111/AK1] marks the element, selects it and draws one curve per pair, the selected node's last", async () => {
    await mount(asCall(fakeCall()));
    const view = query(".graph");
    expect(view.dataset["laidOut"]).toBe("10");
    expect(view.getAttribute("aria-label")).toBe("Graph: S1 Title S1");
    expect(query(".graph-node.root").dataset["node"]).toBe(key("S1"));
    expect(selected()).toBe(key("S1"));
    expect(view.getAttribute("aria-activedescendant")).toBe("gnode-0");
    const paths = [...container.querySelectorAll<SVGPathElement>("path.graph-edge")];
    expect(paths).toHaveLength(13);
    const touching = paths.map(
      (path) => path.dataset["source"] === key("S1") || path.dataset["target"] === key("S1"),
    );
    // The curves of the selected node are drawn last, over the others.
    expect(touching.indexOf(true)).toBe(touching.length - touching.filter(Boolean).length);
  });

  it("[SR-111/AK5] arrows move the selection, Enter opens the selected node as the current element", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    await press("ArrowDown");
    const below = selected();
    expect(below).not.toBe(key("S1"));
    await press("Home");
    expect(selected()).toBe(key("S1"));
    await press("ArrowUp");
    const above = selected() ?? "";
    expect(S1_GRAPH.nodes.find((node) => `spec:${node.id}` === above)?.level).toBe(-1);
    // A key that moves nowhere keeps the selection.
    await press("PageUp");
    await press("PageUp");
    await press("PageUp");
    const top = selected();
    await press("PageUp");
    expect(selected()).toBe(top);
    await press("Enter");
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: expect.objectContaining({ kind: "element", key: `element:${String(top)}` }) as unknown,
    });
    expect(query("#elsewhere").textContent).toBe(`element:${String(top)}`);
  });

  it("[SR-111/AK5] leaves a key with Ctrl, Cmd or Alt held to the window", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      await press("ArrowDown", held);
      await press("Enter", held);
      await press("-", held);
      await press("+", held);
    }
    expect(actions).toEqual([]);
    expect(selected()).toBe(key("S1"));
    // Shift may be what gives "+".
    await press("+", { shiftKey: true });
    expect(actions.at(-1)).toEqual({ type: "open", buffer: { ...S1, depth: 2 } });
  });

  it("[SR-111/AK1] opens a graph of depth 1 calm: no link is lit up while every link touches the selected node", async () => {
    const fan = graphOutput(
      [graphNode("S1", 0), graphNode("C1", 1), graphNode("C2", 1), graphNode("P", -1)],
      [graphEdge("C1", "S1"), graphEdge("C2", "S1"), graphEdge("S1", "P", BASED_ON)],
    );
    await mount(asCall(fakeCall(() => fan)));
    expect(container.querySelectorAll("path.graph-edge")).toHaveLength(3);
    expect(container.querySelectorAll("path.graph-edge.selected")).toHaveLength(0);
    // Selected elsewhere, the links of that node stand out among the element's.
    await press("ArrowDown");
    const lit = [...container.querySelectorAll<SVGPathElement>("path.graph-edge.selected")];
    expect(lit.map((path) => path.dataset["source"])).toEqual([selected()]);
  });

  it("[SR-111/AK1] lights up the selected node's links when other links are drawn too", async () => {
    // C1 is selected: 4 of the 13 drawn links touch it (to S1 and D1, from D2 and C3).
    await mount(asCall(fakeCall()), { ...S1, selected: key("C1") });
    expect(selected()).toBe(key("C1"));
    const lit = [...container.querySelectorAll<SVGPathElement>("path.graph-edge.selected")];
    expect(
      lit.map((path) => `${path.dataset["source"] ?? ""}>${path.dataset["target"] ?? ""}`).sort(),
    ).toEqual([
      `${key("C1")}>${key("D1")}`,
      `${key("C1")}>${key("S1")}`,
      `${key("C3")}>${key("C1")}`,
      `${key("D2")}>${key("C1")}`,
    ]);
    // S1 derives from N1: a link that does not touch C1, never lit up.
    expect(query(`path[data-target="${key("N1")}"]`).classList.contains("selected")).toBe(false);
  });

  it("[SR-111/AK1] opens a package graph calm: its links are more than half of the drawn ones, so none is lit up", async () => {
    // A package with five members, two of which refine another member: 5 of the 7 drawn links touch it.
    const members = ["M1", "M2", "M3", "M4", "M5"];
    const pkg = graphOutput(
      [graphNode("S1", 0, { type: "package" }), ...members.map((name) => graphNode(name, 1))],
      [
        ...members.map((name) => graphEdge(name, "S1", { kind: "packages", property: true })),
        graphEdge("M2", "M1", BASED_ON),
        graphEdge("M3", "M1", BASED_ON),
      ],
    );
    await mount(asCall(fakeCall(() => pkg)));
    expect(container.querySelectorAll("path.graph-edge")).toHaveLength(7);
    expect(container.querySelectorAll("path.graph-edge.selected")).toHaveLength(0);
    // The element keeps its mark and the selection while none of its links is lit up.
    expect(query(".graph-node.root").dataset["node"]).toBe(key("S1"));
    expect(selected()).toBe(key("S1"));
    // Down into a member: its few links light up.
    await press("ArrowDown");
    const member = selected();
    expect(member).not.toBe(key("S1"));
    const lit = [...container.querySelectorAll<SVGPathElement>("path.graph-edge.selected")];
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every((path) => path.dataset["source"] === member || path.dataset["target"] === member)).toBe(
      true,
    );
  });

  it("[SR-111/AK4] a node's hover text gives its ID, type and title, so a type the box cuts can be read", async () => {
    await mount(asCall(fakeCall()));
    expect(query(`[data-node="${key("C1")}"]`).getAttribute("title")).toBe(
      "C1 · System Requirement\nTitle C1",
    );
    // Without an identifier, the short ID; a type without a name in the metamodel, by its key.
    expect(query(`[data-node="${key("PKG")}"]`).getAttribute("title")).toBe("PKG-1 · package\nTitle PKG");
  });

  it("[SR-111/AK5] a click opens the node as the current element", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    await click(query(`[data-node="${key("C1")}"]`));
    expect(actions).toEqual([
      { type: "select", key: S1.key, node: key("C1") },
      {
        type: "open",
        buffer: {
          kind: "element",
          key: `element:${key("C1")}`,
          id: "uuid-C1",
          repository: "spec",
          name: "C1 Title C1",
        },
      },
    ]);
  });

  it("[SR-111/AK2] + and - ask for one level more or less", async () => {
    const call = fakeCall();
    const { actions } = await mount(asCall(call));
    await press("+");
    expect(actions.at(-1)).toEqual({ type: "open", buffer: { ...S1, depth: 2 } });
    expect(call).toHaveBeenLastCalledWith("trace.graph", expect.objectContaining({ maxDepth: 2 }));
    await press("-");
    expect(actions.at(-1)).toEqual({ type: "open", buffer: { ...S1, depth: 1 } });
    await press("x");
    expect(actions).toHaveLength(2);
  });

  it("keeps the selected node when the workspace changed and it is still there, else selects the element", async () => {
    let answer = S1_GRAPH;
    const call = fakeCall(() => answer);
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const { show } = await mount(asCall(call), { ...S1, selected: key("C1") });
    expect(selected()).toBe(key("C1"));
    // The same answer is not laid out again, and the timing marks do not pile up.
    const laidOut = vi.mocked(layoutModule.layoutGraph).mock.calls.length;
    scrolled.mockClear();
    await show(1);
    expect(call).toHaveBeenCalledTimes(2);
    expect(vi.mocked(layoutModule.layoutGraph).mock.calls.length).toBe(laidOut);
    expect(performance.getEntriesByName(GRAPH_MARKS.request)).toHaveLength(1);
    expect(scrolled).not.toHaveBeenCalled();
    expect(selected()).toBe(key("C1"));
    // A changed answer is laid out again; the view keeps its scroll and brings the selected node into view.
    answer = graphOutput([graphNode("S1", 0), graphNode("C2", 1)], [graphEdge("C2", "S1", BASED_ON)]);
    await show(2);
    expect(selected()).toBe(key("S1"));
    expect(scrolled).toHaveBeenCalled();
    scrolled.mockRestore();
  });

  it("says why when the call fails, and keeps what it shows when a later call fails", async () => {
    let fail = true;
    const call = fakeCall(() => (fail ? new Error("No element uuid-S1") : S1_GRAPH));
    const { echoed, show, data } = await mount(asCall(call));
    expect(query(".graph p.quiet").textContent).toBe("No element uuid-S1");
    expect(query(".graph").dataset["laidOut"]).toBeUndefined();
    expect(query(".graph").getAttribute("aria-activedescendant")).toBeNull();
    expect(echoed).toEqual(["No element uuid-S1"]);
    expect(data).toEqual([]);
    // Keys do nothing while nothing is laid out.
    await press("ArrowDown");
    await press("Enter");
    expect(selected()).toBeUndefined();
    fail = false;
    await show(1);
    expect(container.querySelectorAll(".graph-node")).toHaveLength(10);
    fail = true;
    await show(2);
    expect(container.querySelectorAll(".graph-node")).toHaveLength(10);
    expect(container.querySelector(".graph p.quiet")).toBeNull();
  });

  it("says why when the layout fails and never blanks the buffer", async () => {
    vi.mocked(layoutModule.layoutGraph).mockImplementationOnce(() => {
      throw new Error("Not possible");
    });
    const { echoed, show } = await mount(asCall(fakeCall()));
    expect(echoed).toEqual(["The graph could not be laid out: Error: Not possible"]);
    expect(query(".graph p.quiet").textContent).toBe("The graph could not be laid out: Error: Not possible");
    await show(1);
    expect(container.querySelectorAll(".graph-node")).toHaveLength(10);
  });

  it("drops the answer of a call that a newer one replaced", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show } = await mount(call as unknown as Call);
    await show(1);
    await act(async () => {
      answers[0]?.({ ok: true, output: graphOutput([graphNode("S1", 0)], []) });
      answers[1]?.({ ok: true, output: S1_GRAPH });
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelectorAll(".graph-node")).toHaveLength(10);
  });
});
