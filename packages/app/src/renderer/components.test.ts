// @vitest-environment happy-dom
import type { DataExportElement } from "@logreq/core";
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Choice, Prompt } from "./actions.js";
import type { Buffer, BufferAction, ElementBuffer, ListBuffer, SearchBuffer } from "./buffers.js";
import { nth } from "./lists.js";
import {
  bufferName,
  elementBuffer,
  listBuffer,
  overviewBuffer,
  reduceBuffers,
  searchBuffer,
} from "./buffers.js";
import type { Call } from "./call.js";
import { EditorView } from "@codemirror/view";
import type { ElementControls } from "./actions.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import { ElementView } from "./ElementView.js";
import { ListView } from "./ListView.js";
import { OverviewView, useOverview } from "./OverviewView.js";
import type { PackageModel } from "./package-page.js";
import type { RecentEntry } from "./recent.js";
import { Minibuffer } from "./Minibuffer.js";
import type { Draft } from "./drafts.js";
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

const press = async (target: Element, key: string, init: KeyboardEventInit = {}): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
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

  it("[SR-122/AK3] moves the selection with Down, Up and Tab, and stays inside the list", async () => {
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

  it("[SR-122/AK1] moves the selection with Ctrl+N and Ctrl+P, and stays inside the list", async () => {
    await mount({ label: "Command", items: [choice("a", "One"), choice("b", "Two"), choice("c", "Three")] });
    const selected = (): string | null | undefined =>
      container.querySelector('[aria-selected="true"]')?.textContent;
    await press(input(), "p", { ctrlKey: true });
    expect(selected()).toBe("One");
    await press(input(), "n", { ctrlKey: true });
    expect(selected()).toBe("Two");
    await press(input(), "N", { ctrlKey: true });
    expect(selected()).toBe("Three");
    await press(input(), "n", { ctrlKey: true });
    expect(selected()).toBe("Three");
    await press(input(), "p", { ctrlKey: true });
    expect(selected()).toBe("Two");
    await press(input(), "n", { ctrlKey: true, metaKey: true });
    expect(selected()).toBe("Two");
  });

  it("[SR-122/AK2] Ctrl+N and Ctrl+P do not reach the window", async () => {
    await mount({ label: "Command", items: [choice("a", "One"), choice("b", "Two")] });
    const reached = vi.fn();
    window.addEventListener("keydown", reached);
    const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      input().dispatchEvent(event);
      await Promise.resolve();
    });
    window.removeEventListener("keydown", reached);
    expect(reached).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
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

  it("[SR-129/AK3] tells the prompt that Escape cancelled it, before it closes", async () => {
    const order: string[] = [];
    const cancel = vi.fn(() => order.push("cancel"));
    await mount(
      { label: "Insert reference", items: [choice("a", "One")], cancel },
      vi.fn(() => order.push("close")),
    );
    await press(input(), "Escape");
    expect(order).toEqual(["cancel", "close"]);
  });

  it("[SR-129/AK4] does not tell the prompt it was cancelled when a choice or free text answers it", async () => {
    const cancel = vi.fn();
    await mount({ label: "Insert reference", items: [choice("a", "One")], cancel });
    await press(input(), "Enter");
    expect(cancel).not.toHaveBeenCalled();
    await mount({ label: "Search", items: [], text: vi.fn(), cancel });
    await press(input(), "Enter");
    expect(cancel).not.toHaveBeenCalled();
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

  describe("Enter before the hits have arrived (SR-119 AK1)", () => {
    /** A `find` whose answers the test gives, one per question, in the order they were asked. */
    const deferred = () => {
      const asked: { text: string; answer: (choices: Choice[]) => void }[] = [];
      const find = (text: string): Promise<Choice[]> =>
        new Promise<Choice[]>((resolve) => {
          asked.push({ text, answer: resolve });
        });
      const answer = async (text: string, choices: Choice[]): Promise<void> => {
        await act(async () => {
          asked.find((question) => question.text === text)?.answer(choices);
          await Promise.resolve();
        });
        await flush();
      };
      return { find, answer };
    };

    it("[SR-119/AK1] opens the first hit as soon as the hits of the typed text arrive", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const hit = choice("e1", "SR-118 Calm start");
      await type(input(), "SR-118");
      await press(input(), "Enter");
      expect(hit.run).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await answer("SR-118", [hit, choice("e2", "SR-119 Other")]);
      expect(hit.run).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("[SR-119/AK1] opens the hit of the full text, not the hit of an earlier prefix", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const stale = choice("old", "S-001 Starts with S");
      const wanted = choice("new", "SR-118 Calm start");
      await type(input(), "S");
      await answer("S", [stale]);
      expect(texts('[role="option"]')).toEqual(["S-001 Starts with S"]);
      await type(input(), "SR-118");
      // The rows still hold the hits of "S": Enter must wait, not open one of them.
      await press(input(), "Enter");
      expect(stale.run).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await answer("SR-118", [wanted]);
      expect(wanted.run).toHaveBeenCalledTimes(1);
      expect(stale.run).not.toHaveBeenCalled();
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("opens the selected buffer at once, without waiting for the hits", async () => {
      const { find } = deferred();
      const buffer = choice("list", "All elements");
      const { closed } = await mount({ label: "Go to", items: [buffer], find });
      await type(input(), "all");
      await press(input(), "Enter");
      expect(buffer.run).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("opens the first matching buffer before the hits when a hit was selected while waiting", async () => {
      const { find, answer } = deferred();
      const buffer = choice("list", "All elements");
      const { closed } = await mount({ label: "Go to", items: [buffer], find });
      const old = choice("old", "Older hit");
      await type(input(), "a");
      await answer("a", [old]);
      await type(input(), "al");
      await press(input(), "ArrowDown");
      await press(input(), "Enter");
      expect(closed).not.toHaveBeenCalled();
      await answer("al", [choice("new", "Newer hit")]);
      expect(buffer.run).toHaveBeenCalledTimes(1);
      expect(old.run).not.toHaveBeenCalled();
    });

    it("does nothing when the hits of the text are none", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      await type(input(), "nothing");
      await press(input(), "Enter");
      await answer("nothing", []);
      expect(closed).not.toHaveBeenCalled();
      // Waiting ended with the answer: a hit that comes later is not opened.
      expect(container.querySelector("input")).not.toBeNull();
    });

    it("stops waiting when more is typed", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const first = choice("a", "A hit");
      const second = choice("b", "B hit");
      await type(input(), "a");
      await press(input(), "Enter");
      await type(input(), "ab");
      await answer("a", [first]);
      await answer("ab", [second]);
      expect(first.run).not.toHaveBeenCalled();
      expect(second.run).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await press(input(), "Enter");
      expect(second.run).toHaveBeenCalledTimes(1);
    });

    it("stops waiting on Escape, and when the prompt is gone", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const hit = choice("a", "A hit");
      await type(input(), "a");
      await press(input(), "Enter");
      await press(input(), "Escape");
      expect(closed).toHaveBeenCalledTimes(1);
      await answer("a", [hit]);
      expect(hit.run).not.toHaveBeenCalled();
      const later = deferred();
      const gone = await mount({ label: "Go to", items: [], find: later.find });
      const other = choice("b", "B hit");
      await type(input(), "b");
      await press(input(), "Enter");
      await mount(undefined);
      await later.answer("b", [other]);
      expect(other.run).not.toHaveBeenCalled();
      expect(gone.closed).not.toHaveBeenCalled();
    });
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
    if (current === undefined || current.kind === "element" || current.kind === "overview") {
      return createElement("p", { id: "elsewhere" }, current === undefined ? "none" : bufferName(current));
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

describe("OverviewView", () => {
  const FACETS = {
    total: 4,
    types: [
      { key: "need", name: "Need", count: 1 },
      { key: "system-requirement", name: "System Requirement", count: 3 },
    ],
    incomplete: false,
  };
  const element = (n: number) => ({
    id: `uuid-${String(n)}`,
    repository: "spec",
    shortId: `SR-${String(n)}`,
    title: `Title ${String(n)}`,
  });
  const entry = (n: number): RecentEntry => ({ id: `uuid-${String(n)}`, repository: "spec" });
  const handlers = (): Record<string, (input: Record<string, unknown>) => unknown> => ({
    "element.facets": () => FACETS,
    "element.get": (input: Record<string, unknown>) => ({
      element: element(Number(String(input["ref"]).replace("uuid-", ""))),
    }),
  });

  /** The overview as the app uses it: the loading hook, the view, and what it reported. */
  const mount = async (call: Call, initial: { recent?: RecentEntry[]; active?: boolean } = {}) => {
    const opened: Buffer[] = [];
    const data: [string, BufferData | undefined][] = [];
    const echoed: string[] = [];
    const actions: BufferAction[] = [];
    const echo = (message: string): void => {
      echoed.push(message);
    };
    let setRevision: (revision: number) => void = () => undefined;
    let setRecent: (recent: RecentEntry[]) => void = () => undefined;
    let setActive: (active: boolean) => void = () => undefined;
    const Harness = (): React.ReactElement => {
      const [revision, changeRevision] = useReducer((_: number, next: number) => next, 0);
      const [recent, changeRecent] = useReducer(
        (_: RecentEntry[], next: RecentEntry[]) => next,
        initial.recent ?? [],
      );
      const [active, changeActive] = useReducer((_: boolean, next: boolean) => next, initial.active ?? true);
      setRevision = changeRevision;
      setRecent = changeRecent;
      setActive = changeActive;
      const [buffers, dispatch] = useReducer(reduceBuffers, [overviewBuffer()]);
      const overview = useOverview(call, revision, recent, active, echo);
      const [shown] = buffers;
      if (shown?.kind !== "overview") {
        return createElement("p", { id: "elsewhere" }, shown === undefined ? "none" : bufferName(shown));
      }
      return createElement(OverviewView, {
        buffer: shown,
        data: overview.data,
        recents: overview.recents,
        dispatch: (action) => {
          actions.push(action);
          if (action.type === "open") {
            opened.push(action.buffer);
          }
          dispatch(action);
        },
        onData: (key, loaded) => data.push([key, loaded]),
      });
    };
    await render(createElement(Harness));
    const change = async (apply: () => void): Promise<void> => {
      await act(async () => {
        apply();
        await Promise.resolve();
      });
      await flush();
    };
    return {
      opened,
      data,
      echoed,
      actions,
      revision: (next: number) =>
        change(() => {
          setRevision(next);
        }),
      recent: (next: RecentEntry[]) =>
        change(() => {
          setRecent(next);
        }),
      active: (next: boolean) =>
        change(() => {
          setActive(next);
        }),
    };
  };
  const options = (): string[] => texts('[role="option"]');
  const listbox = (): HTMLElement => query('[role="listbox"]');

  it("[SR-118/AK1] shows a line per type with its count, one text with a space: Need 1", async () => {
    await mount(asCall(fakeCall(handlers())));
    expect(options()).toEqual(["Need 1", "System Requirement 3"]);
    expect(listbox().getAttribute("aria-label")).toBe("Overview");
    expect(container.querySelector("[data-buffer]")).toBe(listbox());
    expect(query('[role="option"]').getAttribute("aria-label")).toBe("Need 1");
    expect(query(".count").textContent).toBe("1");
  });

  it("is an empty listbox while the counts load, and reports no data to the modeline", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const view = await mount(call as unknown as Call);
    expect(options()).toEqual([]);
    expect(listbox().getAttribute("aria-activedescendant")).toBeNull();
    expect(view.data.at(-1)).toEqual(["overview", undefined]);
    await act(async () => {
      answers[0]?.({ ok: true, output: FACETS });
      await Promise.resolve();
    });
    await flush();
    expect(options()).toHaveLength(2);
    expect(view.data.at(-1)).toEqual(["overview", { kind: "overview", total: 4, incomplete: false }]);
  });

  it("reads the recent elements with their repository, newest first, and leaves out one that cannot be read", async () => {
    const h = handlers();
    const get = h["element.get"];
    h["element.get"] = (input) => (input["ref"] === "uuid-2" ? new Error("gone") : get?.(input));
    const call = fakeCall(h);
    await mount(call as unknown as Call, { recent: [entry(3), entry(2), entry(1)] });
    expect(options()).toEqual(["Need 1", "System Requirement 3", "SR-3Title 3", "SR-1Title 1"]);
    expect(call).toHaveBeenCalledWith("element.get", { ref: "uuid-3", repository: "spec" });
    expect(texts(".group")).toEqual(["Recent"]);
  });

  it("asks for the counts once per revision and for the recent elements when they change", async () => {
    const call = fakeCall(handlers());
    const view = await mount(call as unknown as Call);
    const asked = (name: string): number => call.mock.calls.filter(([called]) => called === name).length;
    expect(asked("element.facets")).toBe(1);
    await view.recent([entry(1)]);
    expect(asked("element.facets")).toBe(1);
    expect(options()).toHaveLength(3);
    await view.revision(1);
    expect(asked("element.facets")).toBe(2);
    expect(asked("element.get")).toBe(2);
  });

  it("asks for nothing while it is not shown, and shows what it has at once when it is shown again", async () => {
    const call = fakeCall(handlers());
    const view = await mount(call as unknown as Call, { active: false, recent: [entry(1)] });
    expect(call).not.toHaveBeenCalled();
    await view.active(true);
    expect(call).toHaveBeenCalledTimes(2);
    await view.active(false);
    await view.active(true);
    // The counts of this revision are there; only the recent elements are read again.
    expect(call.mock.calls.filter(([called]) => called === "element.facets")).toHaveLength(1);
    expect(options()).toEqual(["Need 1", "System Requirement 3", "SR-1Title 1"]);
  });

  it("drops the answers that come after it was left or the workspace changed", async () => {
    const pending: { name: string; resolve: (value: unknown) => void }[] = [];
    const call = vi.fn(
      (name: string) =>
        new Promise((resolve) => {
          pending.push({ name, resolve });
        }),
    );
    const view = await mount(call as unknown as Call, { recent: [entry(1)] });
    await view.active(false);
    await act(async () => {
      for (const { name, resolve } of pending) {
        resolve({
          ok: true,
          output: name === "element.facets" ? FACETS : { element: element(1) },
        });
      }
      await Promise.resolve();
    });
    await view.active(true);
    expect(options()).toEqual([]);
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("echoes why the counts could not be read", async () => {
    const view = await mount(
      asCall(fakeCall({ "element.facets": () => new Error("The workspace is not valid") })),
    );
    expect(view.echoed).toEqual(["The workspace is not valid"]);
    expect(options()).toEqual([]);
  });

  it("moves the selection with the arrow keys, Home and End, inside the lines, and keeps Ctrl+P for the window", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    const selected = (): string => query('[aria-selected="true"]').id;
    expect(selected()).toBe("overview-0");
    await press(listbox(), "ArrowDown");
    await press(listbox(), "ArrowDown");
    await press(listbox(), "ArrowDown");
    expect(selected()).toBe("overview-2");
    await press(listbox(), "ArrowUp");
    expect(selected()).toBe("overview-1");
    await press(listbox(), "Home");
    expect(selected()).toBe("overview-0");
    await press(listbox(), "ArrowUp");
    expect(selected()).toBe("overview-0");
    await press(listbox(), "End");
    expect(selected()).toBe("overview-2");
    const keys = view.actions.length;
    const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      listbox().dispatchEvent(event);
      await Promise.resolve();
    });
    expect(event.defaultPrevented).toBe(false);
    expect(view.actions).toHaveLength(keys);
  });

  it("opens the list of a type line and the element of a recent line on Enter, and a clicked line", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    await press(listbox(), "ArrowDown");
    await press(listbox(), "Enter");
    expect(view.opened[0]).toMatchObject({ kind: "list", label: "type: system-requirement" });
    expect(query("#elsewhere").textContent).toBe("type: system-requirement");
  });

  it("opens an element on a click, and does nothing on Enter without lines", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    await click(nth([...container.querySelectorAll('[role="option"]')], 2));
    expect(view.opened[0]).toMatchObject({ kind: "element", id: "uuid-1" });
    const empty = await mount(asCall(fakeCall({ "element.facets": () => new Error("x") })));
    await press(listbox(), "Enter");
    await press(listbox(), "End");
    expect(empty.opened).toEqual([]);
  });

  it("keeps the selection on a line when the lines became fewer", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    await press(listbox(), "End");
    expect(query('[aria-selected="true"]').id).toBe("overview-2");
    await view.recent([]);
    expect(query('[aria-selected="true"]').id).toBe("overview-1");
  });
});

/** A list as a part of another buffer (SR-112): in a scrolling `.buffer`, with the means to leave it. */
const partHarness = async (
  call: Call,
  buffer: ListBuffer,
  extra: { enclosed?: boolean; focusOnLoad?: boolean; onLeave?: () => void } = {},
) => {
  const actions: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const node = (revision: number): React.ReactElement => {
    const list = createElement(ListView, {
      call,
      buffer,
      revision,
      dispatch: (action: BufferAction) => actions.push(action),
      onData: (key: string, loaded: BufferData | undefined) => data.push([key, loaded]),
      onEcho: (message: string) => echoed.push(message),
      part: true,
      ...(extra.onLeave === undefined ? {} : { onLeave: extra.onLeave }),
      ...(extra.focusOnLoad === undefined ? {} : { focusOnLoad: extra.focusOnLoad }),
    });
    return extra.enclosed === false
      ? list
      : createElement("div", { className: "buffer", id: "enclosing", tabIndex: 0 }, list);
  };
  await render(node(0));
  return { actions, data, echoed, show: (revision: number) => render(node(revision)) };
};

const packageMembers = (): ListBuffer => ({
  ...listBuffer("package: Stufe-3", { where: { package: "uuid-p" } }),
  key: "element:spec:uuid-p",
});

describe("ListView, a part of a buffer (SR-112)", () => {
  it("[SR-112/AK1] asks for the elements of the selection and shows them as rows, in the buffer that encloses it", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    await partHarness(asCall(call), packageMembers());
    expect(call).toHaveBeenCalledWith("element.list", {
      selection: { where: { package: "uuid-p" } },
      limit: 200,
      offset: 0,
    });
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2", "Title 3"]);
    const list = query('[role="listbox"]');
    expect(list.className).toBe("list part");
    expect(list.hasAttribute("data-buffer")).toBe(false);
    expect(container.querySelectorAll("[data-buffer]")).toHaveLength(0);
  });

  it("shows nothing when there are no elements, and the message when asking failed", async () => {
    const empty = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    const { data } = await partHarness(asCall(empty), packageMembers());
    expect(container.querySelector(".quiet")).toBeNull();
    expect(data).toEqual([["element:spec:uuid-p", { kind: "list", total: 0, incomplete: false }]]);
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    const failing = fakeCall({ "element.list": () => new Error("Stufe-3 is no package") });
    const { echoed } = await partHarness(asCall(failing), packageMembers());
    expect(query(".quiet").textContent).toBe("Stufe-3 is no package");
    expect(echoed).toEqual(["Stufe-3 is no package"]);
  });

  it("asks for the next page when the enclosing buffer scrolls near its end, and stops listening when gone", async () => {
    const call = fakeCall({
      "element.list": (input) => ({
        elements: rowsOf(Number(input["offset"]), Number(input["offset"]) + 200),
        total: 400,
      }),
    });
    await partHarness(asCall(call), packageMembers());
    const enclosing = query("#enclosing");
    const scrollTo = async (top: number): Promise<void> => {
      for (const [name, value] of [
        ["scrollHeight", 8000],
        ["scrollTop", top],
        ["clientHeight", 800],
      ] as const) {
        Object.defineProperty(enclosing, name, { value, configurable: true });
      }
      await act(async () => {
        enclosing.dispatchEvent(new Event("scroll"));
        await Promise.resolve();
      });
      await flush();
    };
    await scrollTo(1000);
    expect(call).toHaveBeenCalledTimes(1);
    await scrollTo(6800);
    expect(call).toHaveBeenLastCalledWith("element.list", {
      selection: { where: { package: "uuid-p" } },
      limit: 200,
      offset: 200,
    });
    expect(container.querySelectorAll(".row")).toHaveLength(400);
    // The list itself does not scroll: its own scroll event pages the same way.
    act(() => {
      root.unmount();
    });
    await scrollTo(7000);
    expect(call).toHaveBeenCalledTimes(2);
    root = createRoot(container);
  });

  it("works without a buffer around it", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 3), total: 2 }) });
    await partHarness(asCall(call), packageMembers(), { enclosed: false });
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
  });

  it("Escape, and Up on the first row, leave the part; Up on any other row moves up", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 6), total: 5 }) });
    const left: string[] = [];
    const onLeave = (): void => {
      left.push("left");
    };
    const { actions } = await partHarness(asCall(call), { ...packageMembers(), cursor: 2 }, { onLeave });
    const list = query('[role="listbox"]');
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => {
      list.dispatchEvent(escape);
      await Promise.resolve();
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(left).toEqual(["left"]);
    await press(list, "ArrowUp");
    expect(actions).toEqual([{ type: "cursor", key: "element:spec:uuid-p", cursor: 1 }]);
    expect(left).toHaveLength(1);
  });

  it("leaves from the first row with Up, and does not scroll the page", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 6), total: 5 }) });
    const left: string[] = [];
    await partHarness(asCall(call), packageMembers(), {
      onLeave: () => {
        left.push("left");
      },
    });
    const up = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    await act(async () => {
      query('[role="listbox"]').dispatchEvent(up);
      await Promise.resolve();
    });
    expect(up.defaultPrevented).toBe(true);
    expect(left).toEqual(["left"]);
  });

  it("[SR-112/AK1] opening a package does not scroll to its elements", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 6), total: 5 }) });
    await partHarness(asCall(call), packageMembers());
    expect(texts(".row .title")).toHaveLength(5);
    expect(scrolled).not.toHaveBeenCalled();
    scrolled.mockRestore();
  });

  it("[SR-112/AK1] shows the selected row as the cursor moves while the part has the focus, and not otherwise", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 6), total: 5 }) });
    const shown = packageMembers();
    const showCursor = async (cursor: number): Promise<void> => {
      await render(
        createElement(
          "div",
          { className: "buffer" },
          createElement(ListView, {
            call: asCall(call),
            buffer: { ...shown, cursor },
            revision: 0,
            dispatch: () => undefined,
            onData: () => undefined,
            onEcho: () => undefined,
            part: true,
          }),
        ),
      );
    };
    await showCursor(0);
    await showCursor(1);
    expect(scrolled).not.toHaveBeenCalled();
    act(() => {
      query('[role="listbox"]').focus();
    });
    await showCursor(2);
    expect(scrolled).toHaveBeenCalledTimes(1);
    scrolled.mockRestore();
  });

  it("keeps the rows while the elements are asked for again after a change of the workspace", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show, data } = await partHarness(call as unknown as Call, packageMembers());
    await act(async () => {
      answers[0]?.({ ok: true, output: { elements: rowsOf(1, 3), total: 2 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    await show(1);
    expect(call).toHaveBeenCalledTimes(2);
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    expect(data).toEqual([["element:spec:uuid-p", { kind: "list", total: 2, incomplete: false }]]);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: rowsOf(7, 8), total: 1 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 7"]);
  });

  it("does not open or page on the old rows while the elements are asked for again", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show, actions } = await partHarness(call as unknown as Call, packageMembers());
    await act(async () => {
      answers[0]?.({ ok: true, output: { elements: rowsOf(1, 4), total: 300 } });
      await Promise.resolve();
    });
    await show(1);
    expect(call).toHaveBeenCalledTimes(2);
    const list = query('[role="listbox"]');
    await press(list, "Enter");
    await press(list, "End");
    expect(actions.filter((action) => action.type === "open")).toEqual([]);
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: rowsOf(7, 9), total: 2 } });
      await Promise.resolve();
    });
    await press(query('[role="listbox"]'), "Enter");
    expect(actions.at(-1)).toMatchObject({ type: "open", buffer: { id: "uuid-7" } });
  });

  it("takes the focus when its rows have arrived, if the focus is on the buffer around it", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    const around = document.createElement("div");
    around.tabIndex = 0;
    document.body.append(around);
    around.focus();
    await partHarness(asCall(call), packageMembers(), { focusOnLoad: true });
    // The focus was on something else, not on the buffer around the part: it stays.
    expect(document.activeElement).toBe(around);
    around.remove();
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    // On the buffer around it (or on nothing), the part takes the focus.
    const take = async (): Promise<void> => {
      const answers: ((value: unknown) => void)[] = [];
      const slow = vi.fn(
        () =>
          new Promise((resolve) => {
            answers.push(resolve);
          }),
      );
      await partHarness(slow as unknown as Call, packageMembers(), { focusOnLoad: true });
      act(() => {
        query("#enclosing").focus();
      });
      await act(async () => {
        answers[0]?.({ ok: true, output: { elements: rowsOf(1, 4), total: 3 } });
        await Promise.resolve();
      });
    };
    await take();
    expect(document.activeElement).toBe(query('[role="listbox"]'));
  });

  it("does not take the focus when it was not asked to, or when there is nothing to select", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    await partHarness(asCall(call), packageMembers());
    expect(document.activeElement).not.toBe(query('[role="listbox"]'));
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    const none = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    await partHarness(asCall(none), packageMembers(), { focusOnLoad: true });
    expect(document.activeElement).not.toBe(query('[role="listbox"]'));
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
          repository: "spec",
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
          repository: "vault",
          shortId: "N-000002",
          accessible: false,
          targetState: "inaccessible",
        },
        {
          kind: "derives-from",
          direction: "in",
          id: "r1",
          repository: "platform",
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
          repository: "spec",
          accessible: true,
          targetState: "available",
          title: "Stage 3",
        },
      ],
      ...extra,
    }) as DataExportElement;

  const mount = async (
    call: Call,
    revision = 0,
    draft?: Draft,
    extra: { packages?: PackageModel; buffer?: ElementBuffer } = {},
  ) => {
    const dispatched: BufferAction[] = [];
    const data: [string, BufferData | undefined][] = [];
    const echoed: string[] = [];
    const targets: string[] = [];
    const opened: [string, string | undefined][] = [];
    const drafts: [string, Draft | undefined][] = [];
    const registered: (ElementControls | undefined)[] = [];
    const picks: ReferenceRequest[] = [];
    const node = (rev: number) =>
      createElement(ElementView, {
        call,
        buffer: extra.buffer ?? elementBuffer("uuid-1", "spec", "SR-036 Measure wind"),
        revision: rev,
        onData: (key, loaded) => data.push([key, loaded]),
        onEcho: (message) => echoed.push(message),
        onOpenRelation: (target) => targets.push(target.key),
        onOpenTarget: (id, repository) => {
          opened.push([id, repository]);
        },
        onPickElement: (request) => picks.push(request),
        draft,
        onDraft: (key, kept) => drafts.push([key, kept]),
        register: (controls) => registered.push(controls),
        packages: extra.packages,
        dispatch: (action) => dispatched.push(action),
      });
    await render(node(revision));
    return {
      dispatched,
      data,
      echoed,
      targets,
      opened,
      drafts,
      registered,
      picks,
      controls: (): ElementControls => {
        const found = registered.findLast((c) => c !== undefined);
        if (found === undefined) {
          throw new Error("no controls registered");
        }
        return found;
      },
      again: (rev: number) => render(node(rev)),
    };
  };
  const editorView = (): EditorView => {
    const found = EditorView.findFromDOM(query(".cm-editor"));
    if (found === null) {
      throw new Error("no editor");
    }
    return found;
  };
  /** Types into the editor as the user does. */
  const typeInto = async (text: string): Promise<void> => {
    await act(async () => {
      editorView().dispatch({ changes: { from: editorView().state.doc.length, insert: text } });
      await Promise.resolve();
    });
  };
  const saved = (text: string, extra: Partial<DataExportElement> = {}) => ({
    element: read({ text, ...extra }),
    files: ["a.md"],
    affected: 0,
  });

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

  it("edits the text in the editor, as text: nothing of it becomes markup", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    expect(editorView().state.doc.toString()).toBe("Line one\n<b>not bold</b>");
    expect(query(".cm-content").textContent).toBe("Line one<b>not bold</b>");
    expect(container.querySelector(".cm-content b")).toBeNull();
  });

  it("shows an editor also when the text is empty or there is none, and no properties or relations", async () => {
    await mount(
      asCall(
        fakeCall({
          "element.get": () => ({ element: read({ title: "", text: "", properties: {}, relations: [] }) }),
        }),
      ),
    );
    expect(query("h1").textContent).toBe("SR-036");
    expect(editorView().state.doc.toString()).toBe("");
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
    expect(editorView().state.doc.toString()).toBe("");
  });

  it("is editable, or not for a read-only element", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    expect(query(".cm-content").getAttribute("contenteditable")).toBe("true");
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read({ readOnly: true }) }) })));
    expect(query(".cm-content").getAttribute("contenteditable")).toBe("false");
  });

  it("keeps the text typed as a draft for the app, and drops it when the text is the saved one again", async () => {
    const { drafts } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    await typeInto("!");
    expect(drafts).toEqual([
      ["element:spec:uuid-1", { text: "Line one\n<b>not bold</b>!", base: "Line one\n<b>not bold</b>" }],
    ]);
    await act(async () => {
      editorView().dispatch({ changes: { from: 24, to: 25 } });
      await Promise.resolve();
    });
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
  });

  it("shows the draft of the app in place of the text, and it stays a draft", async () => {
    const { drafts } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })), 0, {
      text: "my draft",
      base: "Line one\n<b>not bold</b>",
    });
    expect(editorView().state.doc.toString()).toBe("my draft");
    expect(drafts).toEqual([]);
    await typeInto("!");
    expect(drafts).toEqual([
      ["element:spec:uuid-1", { text: "my draft!", base: "Line one\n<b>not bold</b>" }],
    ]);
  });

  it("saves with element.update { ref, text }, says so, and the baseline is what core gives back", async () => {
    const call = fakeCall({
      "element.get": () => ({ element: read() }),
      "element.update": (input) => saved(`${String(input["text"])}\n`),
    });
    const { controls, echoed, drafts, data } = await mount(asCall(call));
    await typeInto("!");
    drafts.length = 0;
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await flush();
    expect(call.mock.calls.filter(([name]) => name === "element.update")).toEqual([
      ["element.update", { ref: "uuid-1", text: "Line one\n<b>not bold</b>!" }],
    ]);
    // Core added the final line break, so the editor shows what the file holds.
    expect(editorView().state.doc.toString()).toBe("Line one\n<b>not bold</b>!\n");
    expect(echoed.at(-1)).toBe("Saved SR-036 Measure wind");
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    expect(data.at(-1)?.[1]?.kind).toBe("element");
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    expect(echoed.at(-1)).toBe("No changes to save");
    expect(call.mock.calls.filter(([name]) => name === "element.update")).toHaveLength(1);
  });

  it("saves an empty text, which core gives back as no text", async () => {
    const call = fakeCall({
      "element.get": () => ({ element: read() }),
      "element.update": () => saved(undefined as unknown as string),
    });
    const { controls, echoed } = await mount(asCall(call));
    await act(async () => {
      editorView().dispatch({ changes: { from: 0, to: editorView().state.doc.length } });
      await Promise.resolve();
    });
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await flush();
    expect(call).toHaveBeenCalledWith("element.update", { ref: "uuid-1", text: "" });
    expect(echoed.at(-1)).toBe("Saved SR-036 Measure wind");
    expect(editorView().state.doc.toString()).toBe("");
  });

  it("keeps what was typed while the save ran, as a draft", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const call = vi.fn((name: string) =>
      name === "element.update"
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve({ ok: true, output: { element: read({ text: "base" }) } }),
    );
    const { controls, drafts, echoed } = await mount(asCall(call as never));
    await typeInto("!");
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    // A second Ctrl+S while the first runs does nothing.
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    expect(call.mock.calls.filter(([name]) => name === "element.update")).toHaveLength(1);
    await typeInto("?");
    await act(async () => {
      answer({ ok: true, output: saved("base!") });
      await Promise.resolve();
    });
    await flush();
    expect(editorView().state.doc.toString()).toBe("base!?");
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", { text: "base!?", base: "base!" }]);
    expect(echoed.at(-1)).toBe("Saved SR-036 Measure wind");
  });

  it("echoes why a save failed and keeps the text as a draft", async () => {
    const call = fakeCall({
      "element.get": () => ({ element: read() }),
      "element.update": () => new Error("More than one element has the ID"),
    });
    const { controls, echoed, drafts } = await mount(asCall(call));
    await typeInto("!");
    const before = drafts.length;
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    await flush();
    expect(echoed.at(-1)).toBe("More than one element has the ID");
    expect(drafts).toHaveLength(before);
    expect(editorView().state.doc.toString()).toBe("Line one\n<b>not bold</b>!");
  });

  it("does not save a read-only element", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ readOnly: true }) }) });
    const { controls, echoed } = await mount(asCall(call));
    await act(async () => {
      controls().save();
      await Promise.resolve();
    });
    expect(echoed.at(-1)).toBe("SR-036 Measure wind is read-only");
    expect(call.mock.calls.filter(([name]) => name === "element.update")).toEqual([]);
  });

  it("gives the app its controls once the text is shown, and takes them back", async () => {
    const { registered } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    expect(registered.map((c) => c !== undefined)).toEqual([true]);
    act(() => {
      root.unmount();
    });
    expect(registered.at(-1)).toBeUndefined();
    root = createRoot(container);
    const failing = await mount(
      asCall(fakeCall({ "element.get": () => new Error("No element has that ID") })),
    );
    expect(failing.registered).toEqual([]);
  });

  it("Enter on the buffer gives the editor the focus at the end, Escape in the editor gives it back", async () => {
    const { controls } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const article = query("article");
    await press(article, "Enter");
    expect(editorView().hasFocus).toBe(true);
    expect(editorView().state.selection.main.head).toBe(24);
    await press(query(".cm-content"), "Escape");
    expect(document.activeElement).toBe(article);
    act(() => {
      controls().edit();
    });
    expect(editorView().hasFocus).toBe(true);
  });

  it("Enter with a modifier on the buffer is a shortcut and does not edit", async () => {
    await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const article = query("article");
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      await press(article, "Enter", init);
      expect(editorView().hasFocus).toBe(false);
    }
    await press(article, "Enter");
    expect(editorView().hasFocus).toBe(true);
  });

  it("ignores Enter on the buffer before the text is shown", async () => {
    await mount(asCall(fakeCall({ "element.get": () => new Error("No element has that ID") })));
    await press(query("article"), "Enter");
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("does not show loading again after a reload: the editor stays, and the text follows when nothing was typed", async () => {
    let text = "first";
    const call = fakeCall({ "element.get": () => ({ element: read({ text }) }) });
    const { again, echoed } = await mount(asCall(call));
    const editor = query(".cm-editor");
    text = "second";
    await again(1);
    expect(query(".cm-editor")).toBe(editor);
    expect(editorView().state.doc.toString()).toBe("second");
    expect(echoed).toEqual([]);
  });

  it("keeps unsaved input on a reload with a changed text, and says so", async () => {
    let text = "first";
    const call = fakeCall({ "element.get": () => ({ element: read({ text }) }) });
    const { again, echoed, drafts } = await mount(asCall(call));
    await typeInto("!");
    text = "changed";
    await again(1);
    expect(editorView().state.doc.toString()).toBe("first!");
    expect(echoed).toEqual([
      "SR-036 Measure wind changed on disk; your unsaved changes are kept. Saving overwrites the file.",
    ]);
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", { text: "first!", base: "changed" }]);
    // The same text again says nothing more.
    await again(2);
    expect(echoed).toHaveLength(1);
  });

  it("says that the file changed on disk when a draft comes back on another file text, and keeps the draft", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ text: "Hello" }) }) });
    const { echoed, drafts } = await mount(asCall(call), 0, { text: "Hello!", base: "Old" });
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(echoed).toEqual([
      "SR-036 Measure wind changed on disk; your unsaved changes are kept. Saving overwrites the file.",
    ]);
    // The draft is compared with the new file text from now on: the message is not repeated.
    expect(drafts).toEqual([["element:spec:uuid-1", { text: "Hello!", base: "Hello" }]]);
  });

  it("drops a draft that the file now holds", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ text: "Hello!" }) }) });
    const { echoed, drafts } = await mount(asCall(call), 0, { text: "Hello!", base: "Hello" });
    expect(drafts).toEqual([["element:spec:uuid-1", undefined]]);
    expect(echoed).toEqual([]);
  });

  it("says nothing when the base of the draft is the file text", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ text: "Hello" }) }) });
    const { echoed, drafts } = await mount(asCall(call), 0, { text: "Hello!", base: "Hello" });
    expect(echoed).toEqual([]);
    expect(drafts).toEqual([]);
    expect(editorView().state.doc.toString()).toBe("Hello!");
  });

  it("drops the draft on a reload when the changed file now holds the typed text", async () => {
    let text = "first";
    const call = fakeCall({ "element.get": () => ({ element: read({ text }) }) });
    const { again, echoed, drafts } = await mount(asCall(call));
    await typeInto("!");
    text = "first!";
    await again(1);
    expect(echoed).toHaveLength(1);
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
  });

  describe("the slash menu (SR-129)", () => {
    const typeSlash = async (query: string): Promise<void> => {
      for (const char of `/${query}`) {
        await act(async () => {
          const head = editorView().state.selection.main.head;
          editorView().dispatch({
            changes: { from: head, insert: char },
            selection: { anchor: head + 1 },
            userEvent: "input.type",
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      }
    };

    it("[SR-129/AK1] opens at the cursor when / is typed in the text of the element", async () => {
      await mount(asCall(fakeCall({ "element.get": () => ({ element: read({ text: "" }) }) })));
      await typeSlash("");
      expect(container.querySelectorAll(".cm-tooltip-autocomplete li").length).toBeGreaterThan(10);
    });

    it("[SR-129/AK4] asks the app for an element, and writes the reference: the title within the repository of the buffer", async () => {
      const { picks } = await mount(
        asCall(fakeCall({ "element.get": () => ({ element: read({ text: "" }) }) })),
      );
      await typeSlash("ref");
      await press(query(".cm-content"), "Enter");
      expect(picks).toHaveLength(1);
      act(() => {
        picks[0]?.insert({
          id: "uuid-2",
          title: "Wind",
          label: "SR-001",
          shortId: "SR-0002",
          repository: "spec",
        });
      });
      expect(editorView().state.doc.toString()).toBe("[Wind](logreq:uuid-2)");
      act(() => {
        picks[0]?.insert({
          id: "uuid-3",
          title: "Wind",
          label: "SR-001",
          shortId: "SR-0003",
          repository: "other",
        });
      });
      expect(editorView().state.doc.toString()).toBe(
        "[Wind](logreq:uuid-2)[SR-0003](logreq:uuid-3?version=&repository=other)",
      );
    });
  });

  describe("inline references (#424)", () => {
    const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
    const SENTENCE = `Nach [D-017](logreq:${TARGET}?version=n1:1aac78aad3b5e6a8) gilt das.`;
    const outdatedHint = (message = "points to an older version") => ({
      code: "relation.outdated",
      severity: "warning",
      message,
      targetId: TARGET,
      storedVersion: "n1:1aac78aad3b5e6a8",
      hintId: `relation.outdated/spec/a.md/uuid-1/@text/${TARGET}?version=n1:1aac78aad3b5e6a8&n=1`,
    });
    const withReference = (problems: object[] = [outdatedHint()]) =>
      fakeCall({
        "element.get": () => ({
          element: read({ text: SENTENCE, problems } as unknown as Partial<DataExportElement>),
        }),
      });

    it("shows the label only, marks an outdated reference, and opens its element on a click", async () => {
      const { opened } = await mount(asCall(withReference()));
      const content = query(".cm-content").textContent;
      expect(content).toBe("Nach D-017 outdated gilt das.");
      expect(content).not.toContain("](logreq:");
      expect(content).not.toContain("n1:");
      expect(query(".cm-lr-outdated").title).toBe("points to an older version");
      await act(async () => {
        query(".cm-lr-ref").dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
        );
        await Promise.resolve();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
    });

    it("opens a reference that names a repository with it", async () => {
      const call = fakeCall({
        "element.get": () => ({
          element: read({ text: `[x](logreq:${TARGET}?repository=other)` }),
        }),
      });
      const { controls, opened } = await mount(asCall(call));
      act(() => {
        editorView().dispatch({ selection: { anchor: 2 } });
      });
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([[TARGET, "other"]]);
    });

    it("marks nothing when the element has no such hint, and drops the mark on a reload without it", async () => {
      let problems: object[] = [outdatedHint()];
      const call = fakeCall({
        "element.get": () => ({
          element: read({ text: SENTENCE, problems } as unknown as Partial<DataExportElement>),
        }),
      });
      const { again } = await mount(asCall(call));
      expect(container.querySelector(".cm-lr-outdated")).not.toBeNull();
      problems = [outdatedHint("changed message")];
      await again(1);
      expect(query(".cm-lr-outdated").title).toBe("changed message");
      problems = [];
      await again(2);
      expect(container.querySelector(".cm-lr-outdated")).toBeNull();
      expect(query(".cm-lr-ref").textContent).toBe("D-017");
    });

    it("Follow reference opens the element at the cursor, or says there is none", async () => {
      const { controls, opened, echoed } = await mount(asCall(withReference()));
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([]);
      expect(echoed.at(-1)).toBe("No element reference at the cursor");
      act(() => {
        editorView().dispatch({ selection: { anchor: 8 } });
      });
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
    });

    it("Ctrl+Enter on the buffer itself is left to the shortcut", async () => {
      await mount(asCall(withReference()));
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        query("article").dispatchEvent(event);
        await Promise.resolve();
      });
      expect(event.defaultPrevented).toBe(false);
      expect(editorView().hasFocus).toBe(false);
    });
  });

  it("reads again after an error, with no editor to ask", async () => {
    let fail = true;
    const call = fakeCall({
      "element.get": () => (fail ? new Error("busy") : { element: read({ text: "first" }) }),
    });
    const { again } = await mount(asCall(call));
    expect(container.querySelector(".cm-editor")).toBeNull();
    fail = false;
    await again(1);
    expect(editorView().state.doc.toString()).toBe("first");
    fail = true;
    await again(2);
    expect(query(".quiet").textContent).toBe("busy");
    fail = false;
    const changed = call;
    changed.mockImplementation(() =>
      Promise.resolve({ ok: true, output: { element: read({ text: "other" }) } }),
    );
    await again(3);
    expect(editorView().state.doc.toString()).toBe("other");
  });

  it("opens a relation target that is available, on a click and on Enter", async () => {
    const { targets } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const links = [...container.querySelectorAll<HTMLElement>('[role="link"]')];
    expect(links.map((link) => link.textContent)).toEqual(["N-1 Need", "SR-000009 Child", "p Stage 3"]);
    await click(nth(links, 0));
    await press(nth(links, 1), "Enter");
    await press(nth(links, 1), "x");
    expect(targets).toEqual(["element:spec:n1", "element:platform:r1"]);
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

  describe("a package page (SR-112)", () => {
    const model: PackageModel = { types: new Set(["package"]), key: "packages" };
    const page = (extra: Partial<DataExportElement> = {}) =>
      read({ type: "package", title: "Stufe-3", relations: [], ...extra });
    const members = (elements = rowsOf(1, 4), total = elements.length, incomplete = false) => ({
      elements,
      total,
      incomplete,
    });
    const packageBuffer = (extra: Partial<ElementBuffer> = {}): ElementBuffer => ({
      ...elementBuffer("uuid-1", "spec", "PKG-0000d1 Stufe-3"),
      ...extra,
    });

    it("[SR-112/AK1] shows below its title and text the elements that name the package, as asked of element.list by its UUID", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page({ text: "The third stage" }) }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      expect(call).toHaveBeenCalledWith("element.list", {
        selection: { where: { package: "uuid-1" } },
        limit: 200,
        offset: 0,
      });
      const article = query("article");
      const order = [...article.querySelectorAll("h1, .cm-editor, .members h2, .members .row")].map(
        (found) =>
          found.tagName.toLowerCase() +
          (found.className === "" ? "" : `.${found.className.split(" ")[0] ?? ""}`),
      );
      expect(order).toEqual(["h1", "div.cm-editor", "h2", "div.row", "div.row", "div.row"]);
      expect(query(".members h2").textContent).toBe("← packages 3");
      expect(texts(".members .row .title")).toEqual(["Title 1", "Title 2", "Title 3"]);
      expect(query(".members").hasAttribute("hidden")).toBe(false);
    });

    it("[SR-112/AK1] asks once, and moving through the elements asks for nothing more", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      const { dispatched } = await mount(asCall(call), 0, undefined, { packages: model });
      const asked = (): number => call.mock.calls.filter(([name]) => name === "element.list").length;
      expect(asked()).toBe(1);
      for (let n = 0; n < 3; n += 1) {
        await press(query(".members .list"), "ArrowDown");
      }
      // The row is the one of the element buffer: the app keeps it as `memberCursor`.
      expect(dispatched).toHaveLength(3);
      expect(dispatched[0]).toEqual({ type: "cursor", key: "element:spec:uuid-1", cursor: 1 });
      expect(asked()).toBe(1);
    });

    it("keeps the count out of the modeline: the buffer still reports the element", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      const { data } = await mount(asCall(call), 0, undefined, { packages: model });
      expect(data.map(([, loaded]) => loaded?.kind)).toEqual([undefined, "element"]);
    });

    it("opens an element of the package on Enter, and a row that is clicked", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      const { dispatched } = await mount(asCall(call), 0, undefined, { packages: model });
      await press(query(".members .list"), "Enter");
      expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { kind: "element", id: "uuid-1" } });
      await click(nth([...container.querySelectorAll(".members .row")], 2));
      expect(dispatched.slice(-2)).toMatchObject([
        { type: "cursor", cursor: 2 },
        { type: "open", buffer: { kind: "element", id: "uuid-3" } },
      ]);
    });

    it("[SR-112/AK1] asks for no elements when the element is no package, or when the metamodel has no package", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: read() }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      expect(call.mock.calls.map(([name]) => name)).toEqual(["element.get"]);
      expect(container.querySelector(".members")).toBeNull();
      // Down keeps scrolling the text of an element that has no elements to go into.
      const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      await act(async () => {
        query("article").dispatchEvent(down);
        await Promise.resolve();
      });
      expect(down.defaultPrevented).toBe(false);
      act(() => {
        root.unmount();
      });
      root = createRoot(container);
      const pkg = fakeCall({ "element.get": () => ({ element: page() }), "element.list": () => members() });
      await mount(asCall(pkg));
      expect(pkg.mock.calls.map(([name]) => name)).toEqual(["element.get"]);
    });

    it("shows no heading and nothing to select when no element names the package", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members([], 0),
      });
      const { controls } = await mount(asCall(call), 0, undefined, { packages: model });
      expect(query(".members").hasAttribute("hidden")).toBe(true);
      expect(container.querySelector(".members h2")).toBeNull();
      expect(container.querySelector(".members .row")).toBeNull();
      expect(controls().members).toBe(true);
      // Down has nothing to go into: the page keeps its key.
      const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      await act(async () => {
        query("article").dispatchEvent(down);
        await Promise.resolve();
      });
      expect(down.defaultPrevented).toBe(false);
    });

    it("says that a repository is missing in the count, and how the elements are sorted", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(rowsOf(1, 3), 2, true),
      });
      await mount(asCall(call), 0, undefined, {
        packages: model,
        buffer: packageBuffer({ memberSort: [{ by: "hierarchy", order: "asc" }] }),
      });
      expect(query(".members h2").textContent).toBe(
        "← packages 2 · incomplete: a repository is missing · tree",
      );
      expect(call).toHaveBeenCalledWith("element.list", {
        selection: { where: { package: "uuid-1" } },
        sort: [{ by: "hierarchy", order: "asc" }],
        limit: 200,
        offset: 0,
      });
    });

    it("shows why the elements could not be asked for, and echoes it", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => new Error("The reference matches several elements"),
      });
      const { echoed } = await mount(asCall(call), 0, undefined, { packages: model });
      expect(query(".members .quiet").textContent).toBe("The reference matches several elements");
      expect(echoed).toEqual(["The reference matches several elements"]);
      expect(container.querySelector(".members h2")).toBeNull();
    });

    it("Down on the page itself goes into the elements, Escape and Up on the first row come back; Enter still edits", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      const article = query("article");
      article.focus();
      const modified = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        article.dispatchEvent(modified);
        await Promise.resolve();
      });
      expect(modified.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(article);
      await press(article, "ArrowDown");
      expect(document.activeElement).toBe(query(".members .list"));
      await press(query(".members .list"), "ArrowUp");
      expect(document.activeElement).toBe(article);
      await press(article, "ArrowDown");
      await press(query(".members .list"), "Escape");
      expect(document.activeElement).toBe(article);
      // A key of the list does not reach the page's own handling.
      await press(query(".members .row"), "ArrowDown");
      expect(document.activeElement).toBe(article);
      await press(article, "Enter");
      expect(editorView().hasFocus).toBe(true);
    });

    it("comes back to the elements with the focus when the reader used them before", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, {
        packages: model,
        buffer: packageBuffer({ memberCursor: 2 }),
      });
      expect(document.activeElement).toBe(query(".members .list"));
      expect(query('.members [aria-selected="true"]').id).toBe("row-2");
    });

    it("keeps the focus on the page when the reader has not used the elements before", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      expect(document.activeElement).not.toBe(query(".members .list"));
    });

    it("[SR-112/AK1] asks for the elements again when the workspace changed, and keeps them until the answer", async () => {
      let names = ["Title 1", "Title 2", "Title 3"];
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(names.map((_, at) => row(at + 1))),
      });
      const { again } = await mount(asCall(call), 0, undefined, { packages: model });
      names = ["Title 1"];
      await again(1);
      expect(call.mock.calls.filter(([name]) => name === "element.list")).toHaveLength(2);
      expect(texts(".members .row .title")).toEqual(["Title 1"]);
      expect(query(".members h2").textContent).toBe("← packages 1");
    });
  });
});
