// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetamodelGetOutput } from "@logreq/core";
import type { Buffer, BufferAction, MetamodelBuffer } from "./buffers.js";
import { metamodelBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import * as layoutModule from "./metamodel-layout.js";
import { FIXTURE_METAMODEL, effectiveType, metamodelOutput } from "./metamodel-test-data.js";
import { MetamodelView } from "./MetamodelView.js";
import type { BufferData } from "./modeline.js";

vi.mock("./metamodel-layout.js", { spy: true });

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
  vi.mocked(layoutModule.layoutMetamodel).mockRestore();
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
    query(".metamodel").dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...held }),
    );
    await Promise.resolve();
  });
  await flush();
};

/** A call that answers `metamodel.get` with `answer()`; an Error is a failed call. */
const fakeCall = (answer: () => MetamodelGetOutput | Error = () => FIXTURE_METAMODEL) =>
  vi.fn(() => {
    const output = answer();
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
const asCall = (call: ReturnType<typeof fakeCall>): Call => call as unknown as Call;

/** The metamodel buffer in a real buffer state, and what happened to it. */
const mount = async (call: Call, initial: MetamodelBuffer = metamodelBuffer()) => {
  const actions: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const Harness = ({ revision }: { revision: number }): React.ReactElement => {
    const [buffers, dispatch] = useReducer(reduceBuffers, [initial] as readonly Buffer[]);
    const current = buffers[0];
    if (current?.kind !== "metamodel") {
      return createElement("p", { id: "elsewhere" }, current?.key ?? "none");
    }
    return createElement(MetamodelView, {
      call,
      buffer: current,
      revision,
      dispatch: (action) => {
        actions.push(action);
        dispatch(action);
      },
      onData: (bufferKey, loaded) => data.push([bufferKey, loaded]),
      onEcho: (message) => echoed.push(message),
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

const selected = (): string | undefined => {
  const box = container.querySelector<HTMLElement>('.mm-type[aria-selected="true"]');
  return box === null ? undefined : (box.dataset["type"] ?? "any");
};

describe("MetamodelView", () => {
  it("[SR-130/AK2] shows each type with name, prefix and properties, inherited ones muted, and each curve with its label", async () => {
    const call = fakeCall();
    const { data } = await mount(asCall(call));
    expect(call).toHaveBeenCalledWith("metamodel.get", {});
    const boxes = [...container.querySelectorAll<HTMLElement>(".mm-type")].map((box) => [
      box.dataset["type"] ?? (box.dataset["any"] === undefined ? "?" : "any"),
      [...box.querySelectorAll(".mm-head > span")].map((part) => `${part.className}:${part.textContent}`),
      [...box.querySelectorAll<HTMLElement>(".mm-property")].map(
        (line) => `${line.textContent}${line.classList.contains("inherited") ? " (inherited)" : ""}`,
      ),
    ]);
    expect(boxes).toEqual([
      ["item", ["mm-name:Item", "mm-abstract:abstract", "mm-prefix:ITM"], ["Title"]],
      [
        "requirement",
        ["mm-name:System Requirement", "mm-prefix:SR"],
        ["Title (inherited)", "Rationale", "Package"],
      ],
      [
        "software-requirement",
        ["mm-name:Software Requirement", "mm-prefix:SWR"],
        ["Title (inherited)", "Rationale (inherited)", "Package (inherited)", "Component"],
      ],
      ["decision", ["mm-name:Decision", "mm-prefix:D"], ["Title"]],
      ["package", ["mm-name:Package", "mm-prefix:PKG"], ["Title"]],
      ["any", ["mm-name:Any type"], []],
    ]);
    expect(query('[data-type="item"]').getAttribute("title")).toBe("Item · ITM · abstract\nTitle");
    expect(query('[data-type="item"]').getAttribute("aria-label")).toBe("Item · ITM · abstract, Title");
    expect(query("[data-any]").className).toBe("mm-type any");
    const labels = [...container.querySelectorAll<HTMLElement>(".mm-label")]
      .map((label) => {
        const lines = [...label.querySelectorAll<HTMLElement>(".mm-line")].map((line) => {
          const named =
            line.dataset["kind"] ??
            line.dataset["property"] ??
            (line.dataset["extends"] === undefined ? "?" : "extends");
          return `${named}=${line.textContent}`;
        });
        return `${label.dataset["source"] ?? ""} > ${label.dataset["target"] ?? ""}: ${lines.join(" | ")}`;
      })
      .sort();
    expect(labels).toEqual(
      [
        "type:requirement > type:item: extends=extends",
        "type:software-requirement > type:requirement: extends=extends | derives-from=Derives from",
        "type:software-requirement > type:software-requirement: derives-from=Derives from",
        "type:requirement > type:requirement: replaces=Replaces",
        "type:requirement > type:software-requirement: delegates-to=Delegates to",
        "any > type:decision: based-on=Based on · any source | concerns=Concerns · any source",
        "any > type:requirement: concerns=Concerns · any source",
        "any > any: refines=Refines · any source and target",
        "type:decision > any: traces-to=Traces to · any target",
        "type:requirement > type:package: packages=Package",
      ].sort(),
    );
    expect(query(".mm-line.extends").textContent).toBe("extends");
    // One curve per label, each ending in an arrowhead at its target.
    const paths = [...container.querySelectorAll<SVGPathElement>("path.mm-edge")];
    expect(paths).toHaveLength(10);
    expect(
      paths.every((path) =>
        /^url\(#mm-arrow(-extends|-selected)?\)$/.test(path.getAttribute("marker-end") ?? ""),
      ),
    ).toBe(true);
    expect(container.querySelectorAll("marker")).toHaveLength(3);
    expect(query(".metamodel").dataset["laidOut"]).toBe("6");
    expect(data.at(-1)).toEqual(["metamodel", { kind: "metamodel", types: 5 }]);
  });

  it("[SR-130/AK4] arrows move the selection between the boxes and leave Ctrl and Cmd keys to the window", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    // The first type is selected when the buffer opens.
    expect(selected()).toBe("item");
    expect(query(".metamodel").getAttribute("aria-activedescendant")).toBe("mm-type-0");
    await press("ArrowDown");
    expect(selected()).toBe("requirement");
    expect(actions.at(-1)).toEqual({ type: "select", key: "metamodel", node: "type:requirement" });
    await press("ArrowRight");
    expect(selected()).toBe("decision");
    await press("PageDown");
    expect(selected()).toBe("any");
    await press("Home");
    expect(selected()).toBe("item");
    const before = actions.length;
    for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      await press("ArrowDown", held);
    }
    // A key that is no move, and a move that leads nowhere, do nothing.
    await press("t");
    await press("ArrowUp");
    expect(actions).toHaveLength(before);
    expect(selected()).toBe("item");
  });

  it("lights up the curves of the selected box while they are at most half of the curves, the inheritance in its own grey", async () => {
    await mount(asCall(fakeCall()), { ...metamodelBuffer(), selected: "type:item" });
    const classOf = (source: string, target: string): string =>
      query(`path[data-source="${source}"][data-target="${target}"]`).getAttribute("class") ?? "";
    expect(classOf("type:requirement", "type:item")).toBe("mm-edge selected");
    expect(classOf("type:software-requirement", "type:requirement")).toBe("mm-edge extends");
    expect(classOf("any", "type:decision")).toBe("mm-edge");
    expect(query('path[data-source="any"][data-target="type:decision"]').getAttribute("marker-end")).toBe(
      "url(#mm-arrow)",
    );
    // The curves of the selected box are drawn last.
    const order = [...container.querySelectorAll<SVGPathElement>("path.mm-edge")].map(
      (path) => path.dataset["target"],
    );
    expect(order.at(-1)).toBe("type:item");
  });

  it("selects a box by a click, and the first type when the selected one is gone", async () => {
    let answer = FIXTURE_METAMODEL;
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const { show } = await mount(asCall(fakeCall(() => answer)), {
      ...metamodelBuffer(),
      selected: "type:gone",
    });
    expect(selected()).toBe("item");
    await act(async () => {
      query('[data-type="package"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(selected()).toBe("package");
    // The same answer is not laid out again; a changed one is, the selection kept while its box is there.
    const laidOut = vi.mocked(layoutModule.layoutMetamodel).mock.calls.length;
    scrolled.mockClear();
    await show(1);
    expect(vi.mocked(layoutModule.layoutMetamodel).mock.calls.length).toBe(laidOut);
    answer = metamodelOutput({ types: [effectiveType("package"), effectiveType("other")] });
    await show(2);
    expect(vi.mocked(layoutModule.layoutMetamodel).mock.calls.length).toBe(laidOut + 1);
    expect(selected()).toBe("package");
    expect(scrolled).toHaveBeenCalled();
    scrolled.mockRestore();
  });

  it("says that the metamodel defines no types, and why when the call or the layout fails", async () => {
    let answer: MetamodelGetOutput | Error = new Error("No metamodel");
    const { echoed, show, data } = await mount(asCall(fakeCall(() => answer)));
    expect(query(".metamodel p.quiet").textContent).toBe("No metamodel");
    expect(query(".metamodel").getAttribute("aria-activedescendant")).toBeNull();
    expect(echoed).toEqual(["No metamodel"]);
    expect(data).toEqual([]);
    await press("ArrowDown");
    expect(selected()).toBeUndefined();
    answer = metamodelOutput({ relations: [{ key: "r", name: "R" }] });
    await show(1);
    expect(query(".metamodel p.quiet").textContent).toBe("The metamodel defines no types.");
    expect(query(".metamodel").getAttribute("aria-activedescendant")).toBeNull();
    expect(data.at(-1)).toEqual(["metamodel", { kind: "metamodel", types: 0 }]);
    answer = FIXTURE_METAMODEL;
    await show(2);
    expect(container.querySelectorAll(".mm-type")).toHaveLength(6);
    // A later failure keeps what the sheet shows.
    answer = new Error("Gone");
    await show(3);
    expect(container.querySelectorAll(".mm-type")).toHaveLength(6);
    vi.mocked(layoutModule.layoutMetamodel).mockImplementationOnce(() => {
      throw new Error("Not possible");
    });
    answer = metamodelOutput({ types: [effectiveType("a")] });
    await show(4);
    expect(echoed.at(-1)).toBe("The metamodel could not be laid out: Error: Not possible");
    expect(container.querySelectorAll(".mm-type")).toHaveLength(6);
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
      answers[0]?.({ ok: true, output: metamodelOutput({ types: [effectiveType("a")] }) });
      answers[1]?.({ ok: true, output: FIXTURE_METAMODEL });
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelectorAll(".mm-type")).toHaveLength(6);
  });
});
