// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Buffer, BufferAction, GraphBuffer } from "./buffers.js";
import { graphBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import * as layoutModule from "./graph-layout.js";
import {
  BASED_ON,
  S1_GRAPH,
  VERIFIED_GRAPH,
  graphEdge,
  graphNode,
  graphOutput,
  key,
} from "./graph-test-data.js";
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
const KINDS = new Map([
  ["derives-from", "Derives from"],
  ["based-on", "Based on"],
  ["supersedes", "Supersedes"],
  ["property:packages", "Package"],
]);

const mount = async (call: Call, initial: GraphBuffer = S1) => {
  const actions: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const drawn: string[] = [];
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
      onDrawn: (bufferKey) => drawn.push(bufferKey),
      typeNames: TYPES,
      kindNames: KINDS,
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
  return { actions, data, echoed, drawn, show };
};

const selected = (): string | undefined =>
  container.querySelector<HTMLElement>('.graph-node[aria-selected="true"]')?.dataset["node"];

describe("GraphView", () => {
  it("[SR-111/AK-kq3w] each node shows title and type name, and the mark words only on marked nodes", async () => {
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
      ["X-S1 (S1) · System Requirement", "Title S1", ["outdated:outdated"]],
      ["X-N1 (N1) · need", "Title N1", []],
      ["X-D1 (D1) · Decision", "Title D1", []],
      ["PKG-1 · package", "Title PKG", []],
      ["X-O1 (O1) · System Requirement", "Title O1", ["superseded:superseded"]],
      ["X-D2 (D2) · Decision", "Title D2", []],
      ["X-C1 (C1) · System Requirement", "Title C1", []],
      ["X-C2 (C2) · System Requirement", "Title C2", ["outdated:outdated"]],
      ["X-C3 (C3) · System Requirement", "Title C3", []],
      ["X-E (E) · Decision", "Title E", []],
    ]);
    expect(query(`[data-node="${key("O1")}"]`).className).toBe("graph-node superseded");
    expect(query(`[data-node="${key("O1")}"]`).getAttribute("aria-label")).toBe(
      "X-O1 (O1) System Requirement Title O1 superseded",
    );
    // The element of the selected node, the graph's own while none is chosen, is the marked one (SR-150).
    expect(data.at(-1)).toEqual([
      S1.key,
      {
        kind: "graph",
        nodes: 10,
        truncated: false,
        incomplete: false,
        marked: {
          kind: "element",
          key: "element:spec:uuid-S1",
          id: "uuid-S1",
          repository: "spec",
          name: "X-S1 (S1) Title S1",
          type: "system-requirement",
        },
      },
    ]);
    expect(performance.getEntriesByName(GRAPH_MARKS.layout).length).toBeGreaterThan(0);
  });

  it("[SR-111/AK-g4rk] marks the element, selects it and draws one curve per pair, the selected node's last", async () => {
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

  it("[SR-111/AK-h6rz] arrows move the selection, Enter opens the selected node as the current element", async () => {
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

  it("[SR-111/AK-h6n9] draws a muted box below each node with evidence, which the keys, Enter and a click skip", async () => {
    const summary = {
      id: "uuid-C1",
      repository: "spec",
      level: 2,
      testCases: 2,
      records: 1,
      results: { passed: 2, failed: 1 },
    };
    const call = fakeCall(() => ({ ...S1_GRAPH, evidence: [summary] }));
    const { actions } = await mount(asCall(call), { ...S1, kinds: [], withEvidence: true });
    expect(call).toHaveBeenCalledWith("trace.graph", {
      ref: "uuid-S1",
      repository: "spec",
      maxDepth: 1,
      kinds: [],
      withEvidence: true,
      limit: 500,
    });
    const boxes = [...container.querySelectorAll<HTMLElement>(".graph-evidence")];
    expect(boxes.map((box) => [box.dataset["evidence"], box.textContent])).toEqual([
      [key("C1"), "evidence · 2 test cases, 1 record · 2 passed, 1 failed"],
    ]);
    const [box] = boxes;
    expect(box?.getAttribute("aria-hidden")).toBe("true");
    expect(box?.getAttribute("role")).toBeNull();
    expect(box?.title).toBe("evidence · 2 test cases, 1 record · 2 passed, 1 failed");
    expect(container.querySelectorAll(`path.graph-evidence-line[data-evidence="${key("C1")}"]`)).toHaveLength(
      1,
    );
    // The boxes are no nodes: the options and the drawn links are those of the graph.
    expect(query(".graph").dataset["laidOut"]).toBe("10");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(10);
    expect(container.querySelectorAll("path.graph-edge")).toHaveLength(13);
    // The node says its evidence.
    expect(query(`[data-node="${key("C1")}"]`).getAttribute("aria-label")).toBe(
      "X-C1 (C1) System Requirement Title C1 evidence · 2 test cases, 1 record · 2 passed, 1 failed",
    );
    // A click on the node with evidence opens it as before.
    await act(async () => {
      query(`[data-node="${key("C1")}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: expect.objectContaining({ key: `element:${key("C1")}` }) as unknown,
    });
  });

  it("[SR-111/AK-h6rz] the keys never select an evidence box, and a click on one does nothing", async () => {
    const summary = {
      id: "uuid-S1",
      repository: "spec",
      level: 1,
      testCases: 1,
      records: 0,
      results: { passed: 1 },
    };
    const { actions } = await mount(asCall(fakeCall(() => ({ ...S1_GRAPH, evidence: [summary] }))));
    const reached = new Set<string | undefined>([selected()]);
    for (const step of [
      "ArrowDown",
      "ArrowRight",
      "ArrowRight",
      "PageDown",
      "PageDown",
      "ArrowDown",
      "Home",
    ]) {
      await press(step);
      reached.add(selected());
    }
    expect([...reached].every((at) => at !== undefined && !at.startsWith("evidence:"))).toBe(true);
    expect(container.querySelectorAll(".graph-evidence[aria-selected], .graph-evidence[id]")).toHaveLength(0);
    const before = actions.length;
    await click(query(".graph-evidence"));
    expect(actions).toHaveLength(before);
    expect(selected()).toBe(key("S1"));
  });

  it("[SR-111/AK-h6rz] leaves a key with Ctrl, Cmd or Alt held to the window", async () => {
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

  it("[SR-111/AK-g4rk] opens a graph of depth 1 calm: no link is lit up while every link touches the selected node", async () => {
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

  it("[SR-111/AK-g4rk] lights up the selected node's links when other links are drawn too", async () => {
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

  it("[SR-111/AK-g4rk] opens a package graph calm: its links are more than half of the drawn ones, so none is lit up", async () => {
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

  it("[SR-111/AK-kq3w] a node's hover text gives its ID, type and title, so a type the box cuts can be read", async () => {
    await mount(asCall(fakeCall()));
    expect(query(`[data-node="${key("C1")}"]`).getAttribute("title")).toBe(
      "X-C1 (C1) · System Requirement\nTitle C1",
    );
    // Without an identifier, the short ID; a type without a name in the metamodel, by its key.
    expect(query(`[data-node="${key("PKG")}"]`).getAttribute("title")).toBe("PKG-1 · package\nTitle PKG");
  });

  it("[SR-111/AK-h6rz] a click opens the node as the current element", async () => {
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
          name: "X-C1 (C1) Title C1",
          type: "system-requirement",
        },
      },
    ]);
  });

  it("[SR-111/AK-p2tx] + and - ask for one level more or less", async () => {
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
    const { echoed, show, data, drawn } = await mount(asCall(call));
    expect(query(".graph p.quiet").textContent).toBe("No element uuid-S1");
    // The view cannot draw its buffer and says so: a switch in motion to it starts at once (SR-212).
    expect(drawn).toEqual([S1.key]);
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
    const { echoed, show, drawn } = await mount(asCall(fakeCall()));
    expect(echoed).toEqual(["The graph could not be laid out: Error: Not possible"]);
    expect(drawn).toEqual([S1.key]);
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

  describe("the relation kind of a link (SR-154)", () => {
    const mouse = async (type: string, target: Element): Promise<void> => {
      await act(async () => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 40, clientY: 30 }));
        await Promise.resolve();
      });
    };
    const hit = (from: string, to: string): Element => query(`[data-hit="${key(from)}>${key(to)}"]`);
    const tips = (): string[][] =>
      [...container.querySelectorAll(".graph-edge-tip")].map((tip) =>
        [...tip.children].map((line) => line.textContent),
      );
    const drawn = (kind: string): string[] =>
      [...container.querySelectorAll<SVGPathElement>(`path.graph-edge.${kind}`)].map(
        (path) => `${path.dataset["source"] ?? ""}>${path.dataset["target"] ?? ""}`,
      );
    const chosen = (): string[] => drawn("chosen");

    it("[SR-154/AK-rhrj] the mouse on a link shows its kind, source and target at the link, and outdated", async () => {
      await mount(asCall(fakeCall()));
      await mouse("mouseover", hit("S1", "N1"));
      expect(tips()).toEqual([["X-S1 (S1) Derives from X-N1 (N1)"]]);
      expect(query(".graph-edge-tip").getAttribute("aria-hidden")).toBe("true");
      expect(query(".graph-edge-tip").style.left).toBe("40px");
      expect(drawn("hovered")).toEqual([`${key("S1")}>${key("N1")}`]);
      expect(chosen()).toEqual([]);
      await mouse("mouseout", hit("S1", "N1"));
      await mouse("mouseover", hit("S1", "D2"));
      expect(tips()).toEqual([["X-S1 (S1) Refers to X-D2 (D2) · outdated"]]);
      await mouse("mousemove", hit("S1", "D2"));
      expect(tips()).toHaveLength(1);
      await mouse("mouseout", hit("S1", "D2"));
      expect(tips()).toEqual([]);
    });

    it("[SR-154/AK-yw64] a link that draws several relations names each of them", async () => {
      const both = graphOutput(
        [graphNode("S1", 0), graphNode("N1", -1, { type: "need" })],
        [graphEdge("S1", "N1"), graphEdge("S1", "N1", BASED_ON)],
      );
      await mount(asCall(fakeCall(() => both)));
      await mouse("mouseover", hit("S1", "N1"));
      expect(tips()).toEqual([["X-S1 (S1) Derives from X-N1 (N1)", "X-S1 (S1) Based on X-N1 (N1)"]]);
      await press("l");
      expect(query("#gedge").getAttribute("aria-label")).toBe(
        "X-S1 (S1) Derives from X-N1 (N1); X-S1 (S1) Based on X-N1 (N1)",
      );
    });

    it("[SR-154/AK-hwpt] l selects a link of the selected node: drawn wider, with its text as the active option", async () => {
      await mount(asCall(fakeCall()));
      await press("l");
      const view = query(".graph");
      expect(view.getAttribute("aria-activedescendant")).toBe("gedge");
      const tip = query("#gedge");
      expect([tip.getAttribute("role"), tip.getAttribute("aria-selected")]).toEqual(["option", "true"]);
      expect(tip.getAttribute("aria-label")).toBe("X-S1 (S1) Derives from X-N1 (N1)");
      expect(tips()).toEqual([["X-S1 (S1) Derives from X-N1 (N1)"]]);
      expect(chosen()).toEqual([`${key("S1")}>${key("N1")}`]);
      // The node stays marked as the one whose links are chosen, but the link is the selected option.
      expect(selected()).toBeUndefined();
      expect(query(`[data-node="${key("S1")}"]`).classList.contains("link-chosen")).toBe(true);
    });

    it("[SR-154/AK-v3cw] l goes through every link of the selected node in turn, and starts again", async () => {
      await mount(asCall(fakeCall()));
      const links = [...container.querySelectorAll<SVGPathElement>("path.graph-edge")].filter(
        (path) => path.dataset["source"] === key("S1") || path.dataset["target"] === key("S1"),
      );
      const seen: string[] = [];
      for (let i = 0; i <= links.length; i += 1) {
        await press("l");
        seen.push(query("#gedge").dataset["edge"] ?? "");
      }
      expect(new Set(seen.slice(0, links.length)).size).toBe(links.length);
      expect(seen.at(-1)).toBe(seen[0]);
      expect(query("#gedge").getAttribute("aria-label")).toBe("X-S1 (S1) Derives from X-N1 (N1)");
    });

    it("[SR-154/AK-wbxq] Escape goes back from the link to its node; without a link Escape is the window's", async () => {
      await mount(asCall(fakeCall()));
      await press("ArrowDown");
      const node = selected();
      await press("l");
      expect(selected()).toBeUndefined();
      const back = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      await act(async () => {
        query(".graph").dispatchEvent(back);
        await Promise.resolve();
      });
      expect(back.defaultPrevented).toBe(true);
      expect(selected()).toBe(node);
      expect(container.querySelector(".graph-edge-tip")).toBeNull();
      expect(chosen()).toEqual([]);
      const again = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      await act(async () => {
        query(".graph").dispatchEvent(again);
        await Promise.resolve();
      });
      expect(again.defaultPrevented).toBe(false);
      // Another node drops the chosen link, also when the selection comes back.
      await press("Home");
      await press("l");
      await press("ArrowDown");
      expect(container.querySelector("#gedge")).toBeNull();
      await press("Home");
      expect(selected()).toBe(key("S1"));
      expect(container.querySelector("#gedge")).toBeNull();
      // Caps Lock gives "L", which selects a link too.
      await press("L");
      expect(container.querySelector("#gedge")).not.toBeNull();
    });

    it("[SR-154/AK-k6f3] without the mouse on a link and without a chosen link no link carries a word, and there is no legend", async () => {
      await mount(asCall(fakeCall()));
      expect(container.querySelector(".graph-edge-tip")).toBeNull();
      expect(query(".graph-edges").textContent).toBe("");
      const words = [...query(".graph-canvas").children]
        .filter((child) => !child.classList.contains("graph-node") && child.tagName !== "svg")
        .map((child) => child.textContent);
      expect(words).toEqual([]);
    });

    it("l does nothing on a node without links", async () => {
      await mount(asCall(fakeCall(() => graphOutput([graphNode("S1", 0)], []))));
      await press("l");
      expect(container.querySelector("#gedge")).toBeNull();
      expect(selected()).toBe(key("S1"));
    });
  });

  describe("the verification of a node (SR-136)", () => {
    const N1 = graphBuffer("uuid-N1", "spec", "N1 Title N1");
    /** The status word, its accent, and the ring's text and full part of the node `name`. */
    const shows = (name: string) => {
      const box = query(`[data-node="${key(name)}"]`);
      const status = box.querySelector(".graph-marks .status");
      const ring = box.querySelector<HTMLElement>(".graph-ring");
      return {
        status: status?.textContent,
        accent: status?.classList.contains("accent"),
        ring: ring?.textContent,
        part: ring?.dataset["part"],
      };
    };

    it("[SR-136/AK-h2xg] a requirement shows its status, failed in the accent, indirect as such, and its name says it", async () => {
      await mount(asCall(fakeCall(() => VERIFIED_GRAPH)), N1);
      expect([shows("R11").status, shows("R07").status, shows("I1").status, shows("R12").status]).toEqual([
        "open",
        "failed",
        "indirect",
        "verified",
      ]);
      expect([shows("R11").accent, shows("R07").accent]).toEqual([false, true]);
      expect(query(`[data-node="${key("R11")}"]`).getAttribute("aria-label")).toBe(
        "X-R11 (R11) System Requirement Title R11 verification open 2 of 3",
      );
      // Not a decision or a need.
      expect([shows("D1").status, shows("N1").status]).toEqual([undefined, undefined]);
    });

    it("[SR-136/AK-kvvw] a requirement with acceptance criteria shows a ring with 2 of 3 inside its box", async () => {
      await mount(asCall(fakeCall(() => VERIFIED_GRAPH)), N1);
      expect(shows("R11")).toMatchObject({ ring: "2 of 3", part: String(2 / 3) });
      expect(shows("R07")).toMatchObject({ ring: "0 of 1", part: "0" });
      const box = query(`[data-node="${key("R11")}"]`);
      expect(box.querySelector(".graph-ring svg .full")?.getAttribute("stroke-dasharray")).toBe(
        `${String((2 / 3) * 100)} 100`,
      );
    });

    it("[SR-136/AK-thr6] a need shows the degree of its derived requirements as a ring with the percentage", async () => {
      await mount(asCall(fakeCall(() => VERIFIED_GRAPH)), N1);
      expect(shows("N1")).toMatchObject({ status: undefined, ring: "60 %", part: "0.6" });
      expect(query(`[data-node="${key("N1")}"]`).getAttribute("aria-label")).toBe(
        "X-N1 (N1) need Title N1 verification 60 %",
      );
    });

    it("[SR-136/AK-w6gh] an indirectly verified requirement shows its status and no ring", async () => {
      await mount(asCall(fakeCall(() => VERIFIED_GRAPH)), N1);
      expect(shows("I1")).toEqual({ status: "indirect", accent: false, ring: undefined, part: undefined });
    });

    it("[SR-136/AK-qgyd] a requirement without acceptance criteria shows its status and no ring", async () => {
      await mount(asCall(fakeCall(() => VERIFIED_GRAPH)), N1);
      expect(shows("R12")).toEqual({ status: "verified", accent: false, ring: undefined, part: undefined });
    });

    it("[SR-136/AK-t58p] a need without a valid derived requirement shows no ring", async () => {
      await mount(asCall(fakeCall(() => VERIFIED_GRAPH)), N1);
      expect(shows("N2")).toEqual({ status: undefined, accent: undefined, ring: undefined, part: undefined });
      expect(query(`[data-node="${key("N2")}"]`).getAttribute("aria-label")).toBe("X-N2 (N2) need Title N2");
    });
  });
});
