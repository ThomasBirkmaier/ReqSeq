// @vitest-environment happy-dom
import type { DataExportElement } from "@logreq/core";
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Choice, Prompt } from "./actions.js";
import type { Buffer, BufferAction, ListBuffer, SearchBuffer } from "./buffers.js";
import { nth } from "./lists.js";
import { elementBuffer, listBuffer, reduceBuffers, searchBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { ElementView } from "./ElementView.js";
import { ListView } from "./ListView.js";
import { Minibuffer } from "./Minibuffer.js";
import type { BufferData } from "./modeline.js";

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

/** A call that answers each command with `handlers[name](input)`; an Error is the error of the command. */
const fakeCall = (handlers: Record<string, (input: Record<string, unknown>) => unknown>) =>
  vi.fn((name: string, input: Record<string, unknown>) => {
    const output = handlers[name]?.(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
const asCall = (call: ReturnType<typeof fakeCall>): Call => call as unknown as Call;

const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

const queryInput = (): HTMLInputElement => {
  const found = container.querySelector("input");
  if (found === null) {
    throw new Error("There is no input");
  }
  return found;
};

const press = async (target: Element, key: string): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await flush();
};

const type = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    // React tracks the value; only the prototype's setter lets it see the change.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setValue = Reflect.get(descriptor ?? {}, "set") as (this: HTMLInputElement, value: string) => void;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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

const texts = (selector: string): string[] =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent);

describe("Minibuffer", () => {
  const choice = (id: string, name: string, extra: Partial<Choice> = {}): Choice => ({
    id,
    name,
    run: vi.fn(),
    ...extra,
  });
  const mount = async (
    prompt: Prompt | undefined,
    closed: () => void = vi.fn(),
    command: () => void = vi.fn(),
    echo = "",
  ) => {
    await render(
      createElement(Minibuffer, {
        echo,
        prompt: prompt === undefined ? undefined : { serial: 1, prompt },
        onCommand: command,
        onClose: closed,
      }),
    );
    return { closed, command };
  };
  const input = (): HTMLInputElement => queryInput();

  it("is one quiet line while idle, and a click on it asks for a command", async () => {
    const { command } = await mount(undefined, vi.fn(), vi.fn(), "Searching is not ready");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("Searching is not ready");
    expect(container.querySelector("input")).toBeNull();
    await click(query(".echo"));
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("asks: the label, an input, and the candidates with their shortcut, the first one selected", async () => {
    await mount({
      label: "Command",
      items: [choice("a", "Search elements", { hint: "Ctrl+Shift+F" }), choice("b", "Sort list")],
    });
    expect(query("label").textContent).toBe("Command");
    expect(texts('[role="option"]')).toEqual(["Search elementsCtrl+Shift+F", "Sort list"]);
    expect(texts(".hint")).toEqual(["Ctrl+Shift+F"]);
    expect(query("ul").getAttribute("role")).toBe("listbox");
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-activedescendant")).toBe("candidate-0");
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("Search elements");
    expect(document.activeElement).toBe(input());
  });

  it("ranks the candidates by what is typed and marks the characters that matched", async () => {
    await mount({ label: "Command", items: [choice("a", "Sort list"), choice("b", "Search elements")] });
    await type(input(), "srch elem");
    expect(texts('[role="option"]')).toEqual(["Search elements"]);
    expect(texts("mark")).toEqual(["S", "rch", "elem"]);
    await type(input(), "zzzz");
    expect(container.querySelector("ul")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("moves the selection with Down, Up and Tab, and stays inside the list", async () => {
    await mount({ label: "Command", items: [choice("a", "One"), choice("b", "Two"), choice("c", "Three")] });
    const selected = (): string | null | undefined =>
      container.querySelector('[aria-selected="true"]')?.textContent;
    await press(input(), "ArrowUp");
    expect(selected()).toBe("One");
    await press(input(), "ArrowDown");
    expect(selected()).toBe("Two");
    await press(input(), "Tab");
    expect(selected()).toBe("Three");
    await press(input(), "ArrowDown");
    expect(selected()).toBe("Three");
    await press(input(), "ArrowUp");
    expect(selected()).toBe("Two");
    await press(input(), "x");
    expect(selected()).toBe("Two");
  });

  it("runs the selected candidate on Enter, after it has closed the prompt", async () => {
    const order: string[] = [];
    const items = [
      choice("a", "One"),
      choice("b", "Two", {
        run: () => {
          order.push("run");
        },
      }),
    ];
    await mount({ label: "Command", items }, () => {
      order.push("close");
    });
    await press(input(), "ArrowDown");
    await press(input(), "Enter");
    expect(order).toEqual(["close", "run"]);
  });

  it("runs a candidate that is clicked, and ends the prompt on Escape", async () => {
    const items = [choice("a", "One"), choice("b", "Two")];
    const { closed } = await mount({ label: "Command", items });
    await act(async () => {
      query('[role="option"]:nth-child(2)').dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(items[1]?.run).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    await press(input(), "Escape");
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it("keeps the selection in range with no candidates", async () => {
    await mount({ label: "Search", items: [], text: vi.fn() });
    await press(queryInput(), "ArrowDown");
    await press(queryInput(), "Tab");
    await press(queryInput(), "ArrowUp");
    await type(queryInput(), "a");
    expect(queryInput().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("runs free text on Enter (the search prompt), and does nothing with nothing to run", async () => {
    const text = vi.fn();
    const { closed } = await mount({ label: "Search", items: [], text });
    expect(container.querySelector("ul")).toBeNull();
    await type(input(), "wind speed");
    await press(input(), "Enter");
    expect(text).toHaveBeenCalledWith("wind speed");
    expect(closed).toHaveBeenCalledTimes(1);
    const none = await mount({ label: "Command", items: [] });
    await press(input(), "Enter");
    expect(none.closed).not.toHaveBeenCalled();
  });

  it("adds the elements that core finds, after the matching buffers, without the buffers twice", async () => {
    const find = vi.fn((text: string) =>
      Promise.resolve([
        choice("element:spec:1", "SR-036 Wind", { terms: ["wind", "sr-036"] }),
        choice("element:spec:2", "SR-037 Windy", { terms: ["windy"] }),
        choice("element:spec:3", `Hit for ${text}`),
      ]),
    );
    await mount({
      label: "Go to",
      items: [choice("element:spec:1", "SR-036 Wind"), choice("list", "All elements")],
      find,
    });
    expect(texts('[role="option"]')).toEqual(["SR-036 Wind", "All elements"]);
    expect(find).not.toHaveBeenCalled();
    await type(input(), "wind");
    expect(find).toHaveBeenCalledWith("wind");
    expect(texts('[role="option"]')).toEqual(["SR-036 Wind", "SR-037 Windy", "Hit for wind"]);
    expect(texts("mark")).toEqual(["Wind", "Windy"]);
    await type(input(), "");
    expect(texts('[role="option"]')).toEqual(["SR-036 Wind", "All elements"]);
  });

  it("marks the matched words of an element hit, not the whole name", async () => {
    await mount({
      label: "Go to",
      items: [],
      find: () => Promise.resolve([choice("e1", "SR-036 Windy day", { terms: ["sr-036", "windy"] })]),
    });
    await type(input(), "windy");
    expect(texts("mark")).toEqual(["SR-036", "Windy"]);
  });

  it("drops an answer of core that comes after a newer question", async () => {
    const answers: ((choices: Choice[]) => void)[] = [];
    const find = vi.fn(
      () =>
        new Promise<Choice[]>((resolve) => {
          answers.push(resolve);
        }),
    );
    await mount({ label: "Go to", items: [], find });
    await type(input(), "wi");
    await type(input(), "win");
    await act(async () => {
      answers[1]?.([choice("new", "Newer")]);
      await Promise.resolve();
    });
    await act(async () => {
      answers[0]?.([choice("old", "Older")]);
      await Promise.resolve();
    });
    expect(texts('[role="option"]')).toEqual(["Newer"]);
  });
});

/** A list buffer in a real buffer state, as the app has it, and what was opened from it. */
const listHarness = async (
  call: Call,
  initial: ListBuffer | SearchBuffer,
  extra: { revision?: number } = {},
) => {
  const opened: Buffer[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const actions: BufferAction[] = [];
  const Harness = ({ revision }: { revision: number }): React.ReactElement => {
    const [buffers, dispatch] = useReducer(reduceBuffers, [initial]);
    const current = buffers[0];
    if (current === undefined || current.kind === "element") {
      return createElement("p", { id: "elsewhere" }, current?.name ?? "none");
    }
    return createElement(ListView, {
      call,
      buffer: current,
      revision,
      dispatch: (action) => {
        actions.push(action);
        if (action.type === "open") {
          opened.push(action.buffer);
        }
        dispatch(action);
      },
      onData: (key, loaded) => data.push([key, loaded]),
      onEcho: (message) => echoed.push(message),
    });
  };
  const show = (revision: number): Promise<void> => render(createElement(Harness, { revision }));
  await show(extra.revision ?? 0);
  return { opened, data, echoed, actions, show };
};

const row = (n: number, extra: object = {}) => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-${String(n).padStart(6, "0")}`,
  type: "system-requirement",
  status: "draft",
  title: `Title ${String(n)}`,
  repository: "spec",
  file: `f${String(n)}.md`,
  properties: {},
  relations: [],
  ...extra,
});

const rowsOf = (from: number, to: number) => Array.from({ length: to - from }, (_, at) => row(from + at));

describe("ListView, a list", () => {
  it("shows the rows of element.list as they are: ID, title, status; the first one selected", async () => {
    const call = fakeCall({
      "element.list": () => ({
        elements: [row(1, { identifier: "SR-036" }), row(2, { status: undefined })],
        total: 2,
        incomplete: false,
      }),
    });
    const { data } = await listHarness(asCall(call), listBuffer("All elements"));
    expect(call).toHaveBeenCalledWith("element.list", { limit: 200, offset: 0 });
    expect(texts(".row .id")).toEqual(["SR-036", "SR-000002"]);
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    expect(texts(".row .status")).toEqual(["draft", ""]);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(query('[role="listbox"]').getAttribute("aria-activedescendant")).toBe("row-0");
    expect(query('[role="option"]').getAttribute("aria-selected")).toBe("true");
    expect(data).toEqual([
      ["list", undefined],
      ["list", { kind: "list", total: 2, incomplete: false }],
    ]);
  });

  it("asks with the filter and the sort of the buffer", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    const selection = { where: { type: ["need"] } };
    const sort = [{ by: "title", order: "asc" as const }];
    await listHarness(asCall(call), listBuffer("type: need", selection, sort));
    expect(call).toHaveBeenCalledWith("element.list", { selection, sort, limit: 200, offset: 0 });
  });

  it("indents the rows of a tree by their depth", async () => {
    const call = fakeCall({
      "element.list": () => ({
        elements: rowsOf(1, 4),
        tree: [
          { id: "uuid-1", repository: "spec", depth: 0 },
          { id: "uuid-2", repository: "spec", depth: 1 },
          { id: "uuid-3", repository: "spec", depth: 2 },
        ],
        total: 3,
      }),
    });
    await listHarness(
      asCall(call),
      listBuffer("All elements", undefined, [{ by: "hierarchy", order: "asc" }]),
    );
    expect(
      [...container.querySelectorAll<HTMLElement>(".row .title")].map((title) => title.style.paddingLeft),
    ).toEqual(["0rem", "1.25rem", "2.5rem"]);
  });

  it("says that there are no elements, and why the list failed", async () => {
    await listHarness(
      asCall(fakeCall({ "element.list": () => ({ elements: [], total: 0 }) })),
      listBuffer("All elements"),
    );
    expect(query(".quiet").textContent).toBe("No elements");
    const failing = await listHarness(
      asCall(fakeCall({ "element.list": () => new Error("The metamodel is not valid") })),
      listBuffer("All elements"),
    );
    expect(query(".quiet").textContent).toBe("The metamodel is not valid");
    expect(failing.echoed).toEqual(["The metamodel is not valid"]);
  });

  it("marks incomplete results in the data for the modeline", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 2), total: 1, incomplete: true }) });
    const { data } = await listHarness(asCall(call), listBuffer("All elements"));
    expect(data.at(-1)?.[1]).toEqual({ kind: "list", total: 1, incomplete: true });
  });

  it("moves the selection with the arrow keys, Page Up and Page Down, Home and End, inside the rows", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 31), total: 30 }) });
    await listHarness(asCall(call), listBuffer("All elements"));
    const selected = (): string => query('[aria-selected="true"]').id;
    const list = query('[role="listbox"]');
    await press(list, "ArrowUp");
    expect(selected()).toBe("row-0");
    await press(list, "ArrowDown");
    expect(selected()).toBe("row-1");
    await press(list, "PageDown");
    expect(selected()).toBe("row-11");
    await press(list, "PageUp");
    expect(selected()).toBe("row-1");
    await press(list, "End");
    expect(selected()).toBe("row-29");
    await press(list, "ArrowDown");
    expect(selected()).toBe("row-29");
    await press(list, "Home");
    expect(selected()).toBe("row-0");
    await press(list, "x");
    expect(selected()).toBe("row-0");
  });

  it("opens the element of the selected row on Enter, and of a clicked row", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    const { opened, actions } = await listHarness(asCall(call), listBuffer("All elements"));
    const list = query('[role="listbox"]');
    await press(list, "ArrowDown");
    await press(list, "Enter");
    expect(opened).toEqual([elementBuffer("uuid-2", "spec", "SR-000002 Title 2")]);
    expect(query("#elsewhere").textContent).toBe("SR-000002 Title 2");
    expect(actions.at(0)).toEqual({ type: "cursor", key: "list", cursor: 1 });
  });

  it("selects and opens a row that is clicked", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    const { opened, actions } = await listHarness(asCall(call), listBuffer("All elements"));
    await click(query("#row-2"));
    expect(actions[0]).toEqual({ type: "cursor", key: "list", cursor: 2 });
    expect(opened).toEqual([elementBuffer("uuid-3", "spec", "SR-000003 Title 3")]);
  });

  it("does nothing on Enter without rows", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    const { opened } = await listHarness(asCall(call), listBuffer("All elements"));
    await press(query('[role="listbox"]'), "Enter");
    await press(query('[role="listbox"]'), "End");
    expect(opened).toEqual([]);
  });

  it("asks for the next page when the selection comes near the end, and not beyond the total", async () => {
    const call = fakeCall({
      "element.list": (input) => ({
        elements: rowsOf(
          Number(input["offset"]),
          Math.min(450, Number(input["offset"]) + Number(input["limit"])),
        ),
        total: 450,
      }),
    });
    await listHarness(asCall(call), listBuffer("All elements"));
    expect(container.querySelectorAll(".row")).toHaveLength(200);
    const list = query('[role="listbox"]');
    await press(list, "End");
    expect(call).toHaveBeenLastCalledWith("element.list", { limit: 200, offset: 200 });
    expect(container.querySelectorAll(".row")).toHaveLength(400);
    await press(list, "End");
    expect(call).toHaveBeenLastCalledWith("element.list", { limit: 200, offset: 400 });
    expect(container.querySelectorAll(".row")).toHaveLength(450);
    const calls = call.mock.calls.length;
    await press(list, "End");
    expect(call.mock.calls).toHaveLength(calls);
  });

  it("reports the new total to the modeline when it changed between two pages", async () => {
    const call = fakeCall({
      "element.list": (input) => ({
        elements: rowsOf(Number(input["offset"]), Number(input["offset"]) + 200),
        total: input["offset"] === 0 ? 400 : 390,
      }),
    });
    const { data } = await listHarness(asCall(call), listBuffer("All elements"));
    await press(query('[role="listbox"]'), "End");
    expect(data.at(-1)?.[1]).toEqual({ kind: "list", total: 390, incomplete: false });
  });

  it("asks only once while a page is on its way", async () => {
    let release: () => void = () => undefined;
    let slow = false;
    const call = vi.fn(
      (_name: string, input: { offset: number }) =>
        new Promise((resolve) => {
          const answer = {
            ok: true,
            output: { elements: rowsOf(input.offset, input.offset + 200), total: 1000 },
          };
          if (slow) {
            release = () => {
              resolve(answer);
            };
          } else {
            resolve(answer);
          }
        }),
    );
    await listHarness(call as unknown as Call, listBuffer("All elements"));
    slow = true;
    const list = query('[role="listbox"]');
    await press(list, "End");
    await press(list, "End");
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it("asks for the next page when the scroll comes within a screen of the end", async () => {
    const call = fakeCall({
      "element.list": (input) => ({
        elements: rowsOf(Number(input["offset"]), Number(input["offset"]) + 200),
        total: 400,
      }),
    });
    await listHarness(asCall(call), listBuffer("All elements"));
    const list = query('[role="listbox"]');
    for (const [name, value] of [
      ["scrollHeight", 8000],
      ["scrollTop", 1000],
      ["clientHeight", 800],
    ] as const) {
      Object.defineProperty(list, name, { value, configurable: true });
    }
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });
    expect(call).toHaveBeenCalledTimes(1);
    Object.defineProperty(list, "scrollTop", { value: 6800, configurable: true });
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.list", { limit: 200, offset: 200 });
    expect(container.querySelectorAll(".row")).toHaveLength(400);
  });

  it("echoes why the next page failed and keeps the rows", async () => {
    let failing = false;
    const call = fakeCall({
      "element.list": () =>
        failing ? new Error("The file changed") : { elements: rowsOf(0, 200), total: 400 },
    });
    const { echoed } = await listHarness(asCall(call), listBuffer("All elements"));
    failing = true;
    await press(query('[role="listbox"]'), "End");
    expect(echoed).toEqual(["The file changed"]);
    expect(container.querySelectorAll(".row")).toHaveLength(200);
  });

  it("drops the next page when the list was asked for again meanwhile", async () => {
    let release: () => void = () => undefined;
    let slow = false;
    const call = vi.fn(
      (_name: string, input: { offset: number }) =>
        new Promise((resolve) => {
          const answer = {
            ok: true,
            output: { elements: rowsOf(input.offset, input.offset + 200), total: 1000 },
          };
          if (slow && input.offset === 200) {
            release = () => {
              resolve(answer);
            };
          } else {
            resolve(answer);
          }
        }),
    );
    const { show } = await listHarness(call as unknown as Call, listBuffer("All elements"));
    slow = true;
    await press(query('[role="listbox"]'), "End");
    await show(1);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(container.querySelectorAll(".row")).toHaveLength(200);
  });

  it("asks for enough rows for the selected row when it is shown again", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(0, 5), total: 5 }) });
    await listHarness(asCall(call), { ...listBuffer("All elements"), cursor: 250 });
    expect(call).toHaveBeenCalledWith("element.list", { limit: 400, offset: 0 });
    expect(query('[aria-selected="true"]').id).toBe("row-4");
  });

  it("asks again when the workspace changed, and drops the answer of an older question", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show } = await listHarness(call as unknown as Call, listBuffer("All elements"));
    await show(1);
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: rowsOf(10, 11), total: 1 } });
      await Promise.resolve();
    });
    await act(async () => {
      answers[0]?.({ ok: true, output: { elements: rowsOf(1, 3), total: 2 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 10"]);
  });

  it("ignores an answer that comes after it is gone", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await listHarness(call as unknown as Call, listBuffer("All elements"));
    act(() => {
      root.unmount();
    });
    answer({ ok: true, output: { elements: rowsOf(1, 3), total: 2 } });
    await Promise.resolve();
    root = createRoot(container);
  });
});

describe("ListView, a search", () => {
  const hit = (n: number, extra: object = {}) => ({
    ...row(n),
    score: 1,
    fields: ["title"],
    terms: ["wind"],
    ...extra,
  });

  it("shows the hits of element.search in their order, with the matched words marked", async () => {
    const call = fakeCall({
      "element.search": () => ({
        hits: [
          hit(1, { title: "Wind speed" }),
          hit(2, { title: "Rewind", fields: ["id"], terms: [], identifier: "SR-2" }),
        ],
        total: 2,
        incomplete: false,
      }),
    });
    const { data } = await listHarness(asCall(call), searchBuffer("wind"));
    expect(call).toHaveBeenCalledWith("element.search", { query: "wind", limit: 50, offset: 0 });
    expect(texts(".row .title")).toEqual(["Wind speed", "Rewind"]);
    expect(texts("mark")).toEqual(["Wind", "SR-2"]);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Search: wind");
    expect(data).toEqual([
      ["search:wind", undefined],
      ["search:wind", { kind: "search", total: 2, incomplete: false }],
    ]);
  });

  it("pages in steps of 50", async () => {
    const call = fakeCall({
      "element.search": (input) => ({
        hits: Array.from({ length: Math.min(50, 80 - Number(input["offset"])) }, (_, at) =>
          hit(Number(input["offset"]) + at),
        ),
        total: 80,
        incomplete: false,
      }),
    });
    await listHarness(asCall(call), searchBuffer("wind"));
    expect(container.querySelectorAll(".row")).toHaveLength(50);
    await press(query('[role="listbox"]'), "End");
    expect(call).toHaveBeenLastCalledWith("element.search", { query: "wind", limit: 50, offset: 50 });
    expect(container.querySelectorAll(".row")).toHaveLength(80);
  });

  it("says why the search failed", async () => {
    const call = fakeCall({ "element.search": () => new Error("The search index is not ready") });
    const { echoed } = await listHarness(asCall(call), searchBuffer("wind"));
    expect(query(".quiet").textContent).toBe("The search index is not ready");
    expect(echoed).toEqual(["The search index is not ready"]);
  });

  it("says that nothing was found", async () => {
    const call = fakeCall({ "element.search": () => ({ hits: [], total: 0, incomplete: false }) });
    await listHarness(asCall(call), searchBuffer("zzz"));
    expect(query(".quiet").textContent).toBe("No hits for zzz");
  });
});

describe("ElementView", () => {
  const read = (extra: Partial<DataExportElement> = {}) =>
    ({
      id: "uuid-1",
      shortId: "SR-000001",
      identifier: "SR-036",
      type: "system-requirement",
      status: "draft",
      title: "Measure wind",
      text: "Line one\n<b>not bold</b>",
      repository: "spec",
      file: "a.md",
      properties: {
        topic: "Wind",
        empty: "",
        criteria: ["first", "second"],
        packages: [{ id: "p", title: "Stage 3" }],
      },
      relations: [
        {
          kind: "derives-from",
          direction: "out",
          id: "n1",
          shortId: "N-000001",
          identifier: "N-1",
          title: "Need",
          accessible: true,
          targetState: "available",
          outdated: true,
        },
        {
          kind: "derives-from",
          direction: "out",
          id: "n2",
          shortId: "N-000002",
          accessible: false,
          targetState: "inaccessible",
        },
        {
          kind: "derives-from",
          direction: "in",
          id: "r1",
          shortId: "SR-000009",
          title: "Child",
          accessible: true,
          targetState: "available",
        },
        {
          kind: "packages",
          property: true,
          direction: "out",
          id: "p",
          accessible: true,
          targetState: "available",
          title: "Stage 3",
        },
      ],
      ...extra,
    }) as DataExportElement;

  const mount = async (call: Call, revision = 0) => {
    const data: [string, BufferData | undefined][] = [];
    const echoed: string[] = [];
    const targets: string[] = [];
    const node = (rev: number) =>
      createElement(ElementView, {
        call,
        buffer: elementBuffer("uuid-1", "spec", "SR-036 Measure wind"),
        revision: rev,
        onData: (key, loaded) => data.push([key, loaded]),
        onEcho: (message) => echoed.push(message),
        onOpenTarget: (id) => targets.push(id),
      });
    await render(node(revision));
    return { data, echoed, targets, again: (rev: number) => render(node(rev)) };
  };

  it("reads the element with its repository and shows title, text, properties and relations", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read() }) });
    const { data } = await mount(asCall(call));
    expect(call).toHaveBeenCalledWith("element.get", { ref: "uuid-1", repository: "spec" });
    expect(query("article").getAttribute("aria-label")).toBe("SR-036 Measure wind");
    expect(query("h1").textContent).toBe("Measure wind");
    expect(data).toEqual([
      ["element:spec:uuid-1", undefined],
      ["element:spec:uuid-1", { kind: "element", element: read() }],
    ]);
    expect(texts(".box .key")).toEqual(["topic", "criteria"]);
    expect(texts(".box .line")).toEqual(["Wind", "first", "second"]);
    expect(texts("h2")).toEqual(["derives-from", "← derives-from", "packages"]);
  });

  it("shows the text as text: nothing of it becomes markup", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    expect(query(".text").textContent).toBe("Line one\n<b>not bold</b>");
    expect(container.querySelector(".text b")).toBeNull();
  });

  it("shows no text and no properties when there are none, and the ID when the title is empty", async () => {
    await mount(
      asCall(
        fakeCall({
          "element.get": () => ({ element: read({ title: "", text: "", properties: {}, relations: [] }) }),
        }),
      ),
    );
    expect(query("h1").textContent).toBe("SR-036");
    expect(container.querySelector(".text")).toBeNull();
    expect(container.querySelector(".box")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
    await mount(
      asCall(
        fakeCall({
          "element.get": () => ({
            // JSON drops what is undefined: an element without an identifier and without text.
            element: JSON.parse(
              JSON.stringify({
                ...read({ title: "", relations: [] }),
                identifier: undefined,
                text: undefined,
              }),
            ) as DataExportElement,
          }),
        }),
      ),
    );
    expect(query("h1").textContent).toBe("SR-000001");
    expect(container.querySelector(".text")).toBeNull();
  });

  it("opens a relation target that is available, on a click and on Enter", async () => {
    const { targets } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const links = [...container.querySelectorAll<HTMLElement>('[role="link"]')];
    expect(links.map((link) => link.textContent)).toEqual(["N-1 Need", "SR-000009 Child", "p Stage 3"]);
    await click(nth(links, 0));
    await press(nth(links, 1), "Enter");
    await press(nth(links, 1), "x");
    expect(targets).toEqual(["n1", "r1"]);
  });

  it("shows a target that is not available muted with its state, and no link", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const muted = query(".unavailable");
    expect(muted.textContent).toBe("N-000002 inaccessible");
    expect(muted.querySelector('[role="link"]')).toBeNull();
    expect(muted.querySelector(".state")?.textContent).toBe("inaccessible");
  });

  it("marks an outdated relation with the word", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    expect(texts(".outdated")).toEqual([" outdated"]);
  });

  it("shows why the element could not be read, and echoes it", async () => {
    const { echoed } = await mount(
      asCall(fakeCall({ "element.get": () => new Error("No element has that ID") })),
    );
    expect(query(".quiet").textContent).toBe("No element has that ID");
    expect(echoed).toEqual(["No element has that ID"]);
    expect(container.querySelector("h1")).toBeNull();
  });

  it("reads again when the workspace changed, and ignores an answer that comes after it is gone", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read() }) });
    const { again } = await mount(asCall(call));
    await again(1);
    expect(call).toHaveBeenCalledTimes(2);
    let answer: (value: unknown) => void = () => undefined;
    const slow = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await again(1);
    await render(createElement("p"));
    await mount(slow as unknown as Call);
    act(() => {
      root.unmount();
    });
    answer({ ok: true, output: { element: read() } });
    await Promise.resolve();
    root = createRoot(container);
  });
});
