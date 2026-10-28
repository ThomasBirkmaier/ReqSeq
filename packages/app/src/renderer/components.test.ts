// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (#460, #573).
import "../../../../scripts/test-support/dom-selection.mjs";
import type { DataExportElement } from "@logreq/core";
import { Fragment, act, createElement, useLayoutEffect, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Choice, Prompt, PromptFill } from "./actions.js";
import type { Buffer, BufferAction, ElementBuffer, ListBuffer, SearchBuffer } from "./buffers.js";
import { nth } from "./lists.js";
import {
  DEFAULT_SORT,
  bufferName,
  elementBuffer,
  filteredList,
  listBuffer,
  overviewBuffer,
  reduceBuffers,
  searchBuffer,
} from "./buffers.js";
import type { Call } from "./call.js";
import { propertyStep, savedStep } from "./list-filters.js";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { ElementControls } from "./actions.js";
import { focusEffect } from "./editor/preview.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import { ElementView } from "./ElementView.js";
import { referenceTitles } from "./reference-titles.js";
import { LoadingView } from "./App.js";
import { ListView } from "./ListView.js";
import { OverviewView, useOverview } from "./OverviewView.js";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import type { PackageModel } from "./package-page.js";
import type { RecentEntry } from "./recent.js";
import { Minibuffer } from "./Minibuffer.js";
import type { Draft, ShownFile } from "./drafts.js";
import { GONE_CONFIRM_MS } from "./outside-change.js";
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

/** The answer of `trace.neighbourhood` for an element without parents, children and incoming links. */
const alone = (input: Record<string, unknown>): unknown => ({
  root: input["ref"],
  nodes: [{ id: input["ref"], repository: "spec", depth: 0, expanded: true }],
  total: 1,
  edges: [],
  incomplete: false,
});

/**
 * A call that answers each command with `handlers[name](input)`; an Error is the error of the command.
 * Unless a handler says otherwise, an element has no neighbourhood (the parents line asks on every page).
 */
const fakeCall = (handlers: Record<string, (input: Record<string, unknown>) => unknown>) =>
  vi.fn((name: string, input: Record<string, unknown>) => {
    const output = (handlers[name] ?? (name === "trace.neighbourhood" ? alone : undefined))?.(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "code" in output ? String(output.code) : "x.failed", message: output.message }
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

  it("[SR-108/AK2] ranks the candidates by what is typed and marks the characters that matched", async () => {
    await mount({ label: "Command", items: [choice("a", "Sort list"), choice("b", "Search elements")] });
    await type(input(), "srch elem");
    expect(texts('[role="option"]')).toEqual(["Search elements"]);
    expect(texts("mark")).toEqual(["S", "rch", "elem"]);
    await type(input(), "zzzz");
    expect(container.querySelector("ul")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("[SR-108/AK2] marks the matched letters of a name found by its initials or with a typo", async () => {
    await mount({
      label: "Command",
      items: [choice("a", "Create relation"), choice("b", "List all elements"), choice("c", "Sort list")],
    });
    await type(input(), "crel");
    expect(texts('[role="option"]')).toEqual(["Create relation"]);
    expect(texts("mark")).toEqual(["C", "rel"]);
    await type(input(), "lae");
    expect(texts("mark")).toEqual(["L", "a", "e"]);
    await type(input(), "sotr");
    expect(texts('[role="option"]')).toEqual(["Sort list"]);
    expect(texts("mark").join("")).not.toBe("");
    // Nothing typed, nothing marked.
    await type(input(), "");
    expect(texts("mark")).toEqual([]);
  });

  it("[SR-131/AK5] puts the choice for the typed text first, so Enter takes it and Down reaches the others", async () => {
    const typed = vi.fn();
    const literal = vi.fn((text: string): Choice | undefined =>
      text.startsWith("/")
        ? choice(`folder:${text}`, `Open ${text}`, { hint: "folder", run: typed })
        : undefined,
    );
    const station = choice("w1", "/req/station");
    const { closed } = await mount({
      label: "Workspace",
      items: [station, choice("w2", "/req/buoy")],
      literal,
    });
    // Nothing typed: no choice of its own.
    expect(texts('[role="option"] .name')).toEqual(["/req/station", "/req/buoy"]);
    await type(input(), "/req/sta");
    expect(texts('[role="option"] .name')).toEqual(["Open /req/sta", "/req/station"]);
    expect(texts(".hint")).toEqual(["folder"]);
    await press(input(), "ArrowDown");
    expect(container.querySelector('[aria-selected="true"] .name')?.textContent).toBe("/req/station");
    await press(input(), "ArrowUp");
    await press(input(), "Enter");
    expect(closed).toHaveBeenCalledOnce();
    expect(typed).toHaveBeenCalledOnce();
    expect(station.run).not.toHaveBeenCalled();
    // A text that is no folder path is narrowed as usual.
    await mount({ label: "Workspace", items: [station], literal });
    await type(input(), "stat");
    expect(texts('[role="option"] .name')).toEqual(["/req/station"]);
  });

  describe("argument entry of catalog commands (#85)", () => {
    it("[SR-108/AK2] marks the matched characters of an argument's candidates", async () => {
      await mount({
        label: "Show relation options SR-1 · kind:",
        items: [choice("a", "derives from"), choice("b", "refines")],
      });
      await type(input(), "der");
      expect(texts('[role="option"]')).toEqual(["derives from"]);
      expect(texts("mark")).toEqual(["der"]);
    });

    it("goes back on Backspace in an empty input, and leaves Backspace in a typed text to the input", async () => {
      const back = vi.fn();
      const { closed } = await mount({ label: "kind:", items: [choice("a", "refines")], back });
      await type(input(), "r");
      await press(input(), "Backspace");
      expect(back).not.toHaveBeenCalled();
      await type(input(), "");
      await press(input(), "Backspace");
      expect(closed).toHaveBeenCalledTimes(1);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("takes the selected candidate, else the typed text, with Ctrl/Cmd+Enter for the optional arguments", async () => {
      const more = vi.fn();
      const text = vi.fn();
      await mount({ label: "kind:", items: [choice("a", "refines", { more })], more: text });
      await press(input(), "Enter", { ctrlKey: true });
      expect(more).toHaveBeenCalledTimes(1);
      await mount({ label: "maxDepth:", items: [], more: text });
      await type(input(), "2");
      await press(input(), "Enter", { metaKey: true });
      expect(text).toHaveBeenCalledWith("2");
    });

    it("never lets Ctrl/Cmd+Enter or Backspace in an empty input out of a prompt (no Follow reference)", async () => {
      const window = vi.fn();
      document.addEventListener("keydown", window);
      try {
        const overview = choice("a", "Overview");
        const { closed } = await mount({ label: "Go to", items: [overview] });
        await press(input(), "Backspace");
        expect(closed).not.toHaveBeenCalled();
        // Without optional arguments Ctrl/Cmd+Enter takes the candidate, as Enter does.
        await press(input(), "Enter", { ctrlKey: true });
        expect(window).not.toHaveBeenCalled();
        expect(overview.run).toHaveBeenCalledTimes(1);
      } finally {
        document.removeEventListener("keydown", window);
      }
    });

    describe("parts that come later (`fill`)", () => {
      /** A `fill` the test resolves. */
      const later = () => {
        let resolve: (parts: PromptFill) => void = () => undefined;
        const fill = new Promise<PromptFill>((done) => {
          resolve = done;
        });
        const arrive = async (parts: PromptFill): Promise<void> => {
          await act(async () => {
            resolve(parts);
            await Promise.resolve();
          });
          await flush();
        };
        return { fill, arrive };
      };

      it("is open with its label at once and keeps what is typed while the parts load", async () => {
        const { fill, arrive } = later();
        const { closed } = await mount({ label: "Show relation options · kind:", items: [], fill });
        expect(query("label").textContent).toBe("Show relation options · kind:");
        expect(document.activeElement).toBe(input());
        await type(input(), "ref");
        await arrive({ items: [choice("a", "derives from"), choice("b", "refines")] });
        expect(input().value).toBe("ref");
        expect(texts('[role="option"]')).toEqual(["refines"]);
        expect(closed).not.toHaveBeenCalled();
      });

      it("takes the candidate on an Enter pressed while they load, once they arrive", async () => {
        const { fill, arrive } = later();
        const refines = choice("b", "refines");
        const { closed } = await mount({ label: "kind:", items: [], fill });
        await type(input(), "ref");
        await press(input(), "Enter");
        expect(closed).not.toHaveBeenCalled();
        await arrive({ items: [choice("a", "derives from"), refines] });
        expect(refines.run).toHaveBeenCalledTimes(1);
        expect(closed).toHaveBeenCalledTimes(1);
      });

      it("drops an Enter pressed while they load when the text changes afterwards", async () => {
        const { fill, arrive } = later();
        const refines = choice("b", "refines");
        const { closed } = await mount({ label: "kind:", items: [], fill });
        await type(input(), "ref");
        await press(input(), "Enter");
        await type(input(), "re");
        await arrive({ items: [choice("a", "derives from"), refines] });
        expect(refines.run).not.toHaveBeenCalled();
        expect(closed).not.toHaveBeenCalled();
        expect(texts('[role="option"]')).toEqual(["refines", "derives from"]);
      });

      it("searches the text typed meanwhile and takes the first hit with the optional arguments on Ctrl/Cmd+Enter", async () => {
        const { fill, arrive } = later();
        const hit = choice("e", "SR-4 Title 4", { more: vi.fn() });
        const find = vi.fn(() => Promise.resolve([hit]));
        await mount({ label: "ref:", items: [], fill });
        await type(input(), "tit");
        await press(input(), "Enter", { ctrlKey: true });
        await arrive({ items: [], find });
        expect(find).toHaveBeenCalledWith("tit");
        expect(hit.more).toHaveBeenCalledTimes(1);
      });

      it("ends on Escape while they load; parts that arrive later fill nothing", async () => {
        const { fill, arrive } = later();
        const cancel = vi.fn();
        const { closed } = await mount({ label: "kind:", items: [], fill, cancel });
        await press(input(), "Escape");
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(closed).toHaveBeenCalledTimes(1);
        await render(
          createElement(Minibuffer, { echo: "", prompt: undefined, onCommand: vi.fn(), onClose: closed }),
        );
        await arrive({ items: [choice("a", "refines")] });
        expect(container.querySelector("input")).toBeNull();
      });

      it("shows a label that came later, such as why the values could not be read", async () => {
        const { fill, arrive } = later();
        await mount({ label: "kind:", items: [], fill });
        await arrive({ label: "No workspace · kind:" });
        expect(query("label").textContent).toBe("No workspace · kind:");
      });
    });

    it("ends a list argument with Enter on an empty input, and takes a candidate once something is typed", async () => {
      const empty = vi.fn();
      const refines = choice("a", "refines");
      await mount({ label: "refs:", items: [refines], empty });
      await press(input(), "Enter");
      expect(empty).toHaveBeenCalledTimes(1);
      await mount({ label: "refs:", items: [refines], empty });
      await type(input(), "ref");
      await press(input(), "Enter");
      expect(refines.run).toHaveBeenCalledTimes(1);
    });

    it("ends a list argument with Ctrl/Cmd+Enter on an empty input instead of taking the first candidate", async () => {
      const empty = vi.fn();
      const refines = choice("a", "refines", { more: vi.fn() });
      const { closed } = await mount({ label: "refs:", items: [refines], empty });
      await press(input(), "Enter", { ctrlKey: true });
      expect(empty).toHaveBeenCalledWith(true);
      expect(refines.run).not.toHaveBeenCalled();
      expect(refines.more).not.toHaveBeenCalled();
      expect(closed).toHaveBeenCalledTimes(1);
      await mount({ label: "refs:", items: [refines], empty });
      await press(input(), "Enter");
      expect(empty).toHaveBeenLastCalledWith(false);
    });

    it("remembers only a choice among the prompt's own items, never an element found for the text", async () => {
      const record = vi.fn();
      const use = { score: () => 0, remembered: () => undefined, record };
      await mount({
        label: "Command",
        items: [choice("own", "Overview")],
        find: () => Promise.resolve([choice("element:1", "SR-1 Zebra")]),
        use,
      });
      await type(input(), "zebra");
      await press(input(), "Enter");
      expect(record).not.toHaveBeenCalled();
      await type(input(), "over");
      await press(input(), "Enter");
      expect(record).toHaveBeenCalledWith("over", "own");
    });
  });

  describe("what was chosen before", () => {
    const use = (remembered: Record<string, string> = {}, scores: Record<string, number> = {}) => ({
      score: (id: string): number => scores[id] ?? 0,
      remembered: (typed: string): string | undefined => remembered[typed],
      record: vi.fn<(typed: string, id: string) => void>(),
    });
    const filters = (extra: Partial<Prompt>): Prompt => ({
      label: "Command",
      items: [choice("type", "Filter list by type"), choice("status", "Filter list by status")],
      ...extra,
    });

    it("[SR-121/AK2] puts the command remembered for the typed text first, and Enter runs it", async () => {
      const prompt = filters({ use: use({ fl: "status" }) });
      const { closed } = await mount(prompt);
      expect(texts('[role="option"]')).toEqual(["Filter list by type", "Filter list by status"]);
      await type(input(), "fl");
      expect(texts('[role="option"]')).toEqual(["Filter list by status", "Filter list by type"]);
      expect(input().getAttribute("aria-activedescendant")).toBe("candidate-0");
      await press(input(), "Enter");
      expect(closed).toHaveBeenCalledTimes(1);
      expect(prompt.items[1]?.run).toHaveBeenCalledTimes(1);
      expect(prompt.items[0]?.run).not.toHaveBeenCalled();
    });

    it("[SR-108/AK3] orders equally good hits by use, and an empty text too", async () => {
      await mount(filters({ use: use({}, { status: 3 }) }));
      expect(texts('[role="option"]')).toEqual(["Filter list by status", "Filter list by type"]);
      await type(input(), "fil");
      expect(texts('[role="option"]')).toEqual(["Filter list by status", "Filter list by type"]);
    });

    it("[SR-121/AK2] records the typed text and the command on Enter and on a click", async () => {
      const recorded = use();
      await mount(filters({ use: recorded }));
      await type(input(), "fl");
      await press(input(), "ArrowDown");
      await press(input(), "Enter");
      expect(recorded.record).toHaveBeenLastCalledWith("fl", "status");
      await mount(filters({ use: recorded }));
      await type(input(), "flt");
      await act(async () => {
        query('[role="option"]').dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        await Promise.resolve();
      });
      expect(recorded.record).toHaveBeenLastCalledWith("flt", "type");
      expect(recorded.record).toHaveBeenCalledTimes(2);
    });

    it("[SR-121/AK2] records the typed text and the command on Ctrl/Cmd+Enter as on Enter", async () => {
      const recorded = use();
      const more = vi.fn();
      const prompt = filters({ use: recorded });
      await mount({
        ...prompt,
        items: [choice("type", "Filter list by type", { more }), ...prompt.items.slice(1)],
      });
      await type(input(), "flt");
      await press(input(), "Enter", { ctrlKey: true });
      expect(recorded.record).toHaveBeenCalledWith("flt", "type");
      expect(more).toHaveBeenCalledTimes(1);
    });

    it("records nothing for an Escape or for typed text", async () => {
      const recorded = use();
      await mount(filters({ use: recorded }));
      await type(input(), "fl");
      await press(input(), "Escape");
      expect(recorded.record).not.toHaveBeenCalled();
      const text = vi.fn();
      await mount({ label: "Search", items: [], text, use: recorded });
      await type(input(), "wind");
      await press(input(), "Enter");
      expect(text).toHaveBeenCalledWith("wind");
      expect(recorded.record).not.toHaveBeenCalled();
    });
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

  it("[SR-115/AK1] Go to finds a buffer by a fuzzy text (initials, a slip) and keeps the order of use among equal matches; the elements shown last follow the buffers, an open element is listed once", async () => {
    const buffers = [
      choice("element:spec:8", "SR-038 Wind vane"),
      choice("element:spec:1", "SR-036 Wind speed"),
      choice("list", "All elements"),
      choice("overview", "Overview"),
    ];
    const recents = [choice("element:spec:2", "SR-037 Wind direction")];
    const find = vi.fn(() =>
      Promise.resolve([
        choice("element:spec:1", "SR-036 Wind speed", { terms: ["wind"] }),
        choice("element:spec:9", "SR-099 Windmill", { terms: ["windmill"] }),
      ]),
    );
    const { closed } = await mount({
      label: "Go to",
      items: [...buffers, ...recents],
      find,
    });
    // Nothing typed: the buffers in order of use, then the element shown last that is not open.
    expect(texts('[role="option"] .name')).toEqual([
      "SR-038 Wind vane",
      "SR-036 Wind speed",
      "All elements",
      "Overview",
      "SR-037 Wind direction",
    ]);
    // Initials, and a slip (two letters swapped).
    await type(input(), "ae");
    expect(texts('[role="option"] .name')[0]).toBe("All elements");
    await type(input(), "ovrevie");
    expect(texts('[role="option"] .name')[0]).toBe("Overview");
    // Equal matches keep the order of use; core's hits follow, the open element not twice.
    await type(input(), "wind");
    expect(texts('[role="option"] .name')).toEqual([
      "SR-038 Wind vane",
      "SR-036 Wind speed",
      "SR-037 Wind direction",
      "SR-099 Windmill",
    ]);
    await press(input(), "ArrowDown");
    await press(input(), "ArrowDown");
    await press(input(), "Enter");
    expect(closed).toHaveBeenCalledOnce();
    expect(recents[0]?.run).toHaveBeenCalledOnce();
  });

  it("[SR-108/AK2] marks the matched words of an element hit, not the whole name", async () => {
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

    it("waits on Ctrl/Cmd+Enter as on Enter, and takes the first hit with the optional arguments", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "ref:", items: [], find });
      const stale = choice("old", "S-001 Starts with S", { more: vi.fn() });
      const wanted = choice("new", "SR-118 Calm start", { more: vi.fn() });
      await type(input(), "S");
      await answer("S", [stale]);
      await type(input(), "SR-118");
      await press(input(), "Enter", { metaKey: true });
      expect(stale.more).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await answer("SR-118", [wanted]);
      expect(wanted.more).toHaveBeenCalledTimes(1);
      expect(wanted.run).not.toHaveBeenCalled();
      expect(closed).toHaveBeenCalledTimes(1);
      // A first hit without optional arguments is taken as with Enter.
      const plain = deferred();
      await render(
        createElement(Minibuffer, { echo: "", prompt: undefined, onCommand: vi.fn(), onClose: vi.fn() }),
      );
      await mount({ label: "Go to", items: [], find: plain.find });
      const hit = choice("e", "SR-119 Other");
      await type(input(), "SR-119");
      await press(input(), "Enter", { ctrlKey: true });
      await plain.answer("SR-119", [hit]);
      expect(hit.run).toHaveBeenCalledTimes(1);
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
    if (
      current === undefined ||
      current.kind === "element" ||
      current.kind === "overview" ||
      current.kind === "neighbourhood" ||
      current.kind === "result" ||
      current.kind === "graph" ||
      current.kind === "metamodel"
    ) {
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
  it("shows the rows of element.list as they are: ID, title, status; no row selected yet (SR-122)", async () => {
    const call = fakeCall({
      "element.list": () => ({
        elements: [row(1, { identifier: "SR-036" }), row(2, { status: undefined })],
        total: 2,
        incomplete: false,
      }),
    });
    const { data } = await listHarness(asCall(call), listBuffer("All elements"));
    expect(call).toHaveBeenCalledWith("element.list", { sort: DEFAULT_SORT, limit: 200, offset: 0 });
    expect(texts(".row .id")).toEqual(["SR-036", "SR-000002"]);
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    expect(texts(".row .status")).toEqual(["draft", ""]);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(query('[role="listbox"]').getAttribute("aria-activedescendant")).toBeNull();
    expect(query('[role="option"]').getAttribute("aria-selected")).toBe("false");
    expect(data).toEqual([
      ["list", undefined],
      [
        "list",
        {
          kind: "list",
          total: 2,
          incomplete: false,
          rows: [
            elementBuffer("uuid-1", "spec", "SR-036 Title 1"),
            elementBuffer("uuid-2", "spec", "SR-000002 Title 2"),
          ],
        },
      ],
    ]);
  });

  it("asks with the filter and the sort of the buffer", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    const selection = { where: { type: ["need"] } };
    const sort = [{ by: "title", order: "asc" as const }];
    await listHarness(asCall(call), listBuffer("type: need", selection, sort));
    expect(call).toHaveBeenCalledWith("element.list", { selection, sort, limit: 200, offset: 0 });
  });

  it("asks with the default sort, none for a saved filter that holds its own, and `[]` for the workspace order (#418)", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    await listHarness(asCall(call), filteredList([savedStep("open")]));
    expect(call).toHaveBeenLastCalledWith("element.list", {
      selection: { filter: "open" },
      limit: 200,
      offset: 0,
    });
    await listHarness(asCall(call), listBuffer("All elements", undefined, []));
    expect(call).toHaveBeenLastCalledWith("element.list", { sort: [], limit: 200, offset: 0 });
    await listHarness(asCall(call), filteredList([savedStep("open")], DEFAULT_SORT));
    expect(call).toHaveBeenLastCalledWith("element.list", {
      selection: { filter: "open" },
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 0,
    });
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
    expect(data.at(-1)?.[1]).toMatchObject({ kind: "list", total: 1, incomplete: true });
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
    await press(list, "ArrowDown");
    await press(list, "Enter");
    expect(opened).toEqual([elementBuffer("uuid-2", "spec", "SR-000002 Title 2")]);
    expect(query("#elsewhere").textContent).toBe("SR-000002 Title 2");
    expect(actions.at(-2)).toEqual({ type: "cursor", key: "list", cursor: 1 });
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
    expect(call).toHaveBeenLastCalledWith("element.list", { sort: DEFAULT_SORT, limit: 200, offset: 200 });
    expect(container.querySelectorAll(".row")).toHaveLength(400);
    await press(list, "End");
    expect(call).toHaveBeenLastCalledWith("element.list", { sort: DEFAULT_SORT, limit: 200, offset: 400 });
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
    expect(data.at(-1)?.[1]).toMatchObject({ kind: "list", total: 390, incomplete: false });
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
    expect(call).toHaveBeenLastCalledWith("element.list", { sort: DEFAULT_SORT, limit: 200, offset: 200 });
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
    expect(call).toHaveBeenCalledWith("element.list", { sort: DEFAULT_SORT, limit: 400, offset: 0 });
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

  it("moves the selection with the arrow keys, Home and End, inside the lines, and keeps Cmd+P for the window", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    const selected = (): string => query('[aria-selected="true"]').id;
    // No line is selected yet (SR-122): the first Down selects the first one.
    expect(container.querySelector('[aria-selected="true"]')).toBeNull();
    await press(listbox(), "ArrowDown");
    expect(selected()).toBe("overview-0");
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
    const event = new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true, cancelable: true });
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

  it("[SR-122/AK4] Enter with no line selected opens the first line and selects it", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    expect(listbox().getAttribute("aria-activedescendant")).toBeNull();
    await press(listbox(), "Enter");
    expect(view.actions[0]).toEqual({ type: "cursor", key: "overview", cursor: 0 });
    expect(view.opened[0]).toMatchObject({ kind: "list", label: "type: need" });
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
  const node = (revision: number, shown: ListBuffer): React.ReactElement => {
    const list = createElement(ListView, {
      call,
      buffer: shown,
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
  await render(node(0, buffer));
  return {
    actions,
    data,
    echoed,
    show: (revision: number, shown: ListBuffer = buffer) => render(node(revision, shown)),
  };
};

/** As `memberList` makes it: the part starts on its first row, shown while it has the focus. */
const packageMembers = (): ListBuffer => ({
  ...listBuffer("package: Stufe-3", { where: { package: "uuid-p" } }),
  key: "element:spec:uuid-p",
  cursor: 0,
});

describe("ListView, a part of a buffer (SR-112)", () => {
  it("[SR-112/AK1] asks for the elements of the selection and shows them as rows, in the buffer that encloses it", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    await partHarness(asCall(call), packageMembers());
    expect(call).toHaveBeenCalledWith("element.list", {
      selection: { where: { package: "uuid-p" } },
      sort: DEFAULT_SORT,
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
    expect(data).toEqual([["element:spec:uuid-p", { kind: "list", total: 0, incomplete: false, rows: [] }]]);
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
      sort: DEFAULT_SORT,
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

  it("[SR-122/AK4] Ctrl+N and Ctrl+P walk the elements like Down and Up; Ctrl+P on the first leaves like Up", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    const left: string[] = [];
    const { actions } = await partHarness(
      asCall(call),
      { ...packageMembers(), cursor: 1 },
      {
        onLeave: () => {
          left.push("left");
        },
      },
    );
    const list = query('[role="listbox"]');
    // The harness keeps the buffer as given, on row 1: each key moves from there.
    await press(list, "n", { ctrlKey: true });
    await press(list, "n", { ctrlKey: true });
    await press(list, "p", { ctrlKey: true });
    expect(actions).toEqual([
      { type: "cursor", key: "element:spec:uuid-p", cursor: 2 },
      { type: "cursor", key: "element:spec:uuid-p", cursor: 2 },
      { type: "cursor", key: "element:spec:uuid-p", cursor: 0 },
    ]);
    expect(left).toEqual([]);
    const first = await partHarness(asCall(call), packageMembers(), {
      onLeave: () => {
        left.push("left");
      },
    });
    const up = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      query('[role="listbox"]').dispatchEvent(up);
      await Promise.resolve();
    });
    expect(up.defaultPrevented).toBe(true);
    expect(left).toEqual(["left"]);
    expect(first.actions).toEqual([]);
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
    expect(data).toEqual([
      [
        "element:spec:uuid-p",
        { kind: "list", total: 2, incomplete: false, rows: expect.any(Array) as unknown },
      ],
    ]);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: rowsOf(7, 8), total: 1 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 7"]);
  });

  it("keeps the rows while the elements are asked for again in another sort (#563)", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show } = await partHarness(call as unknown as Call, packageMembers());
    await act(async () => {
      answers[0]?.({ ok: true, output: { elements: rowsOf(1, 3), total: 2 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    await show(0, { ...packageMembers(), sort: [{ by: "title", order: "desc" }] });
    expect(call).toHaveBeenCalledTimes(2);
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: [row(2), row(1)], total: 2 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 2", "Title 1"]);
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
      ["search:wind", { kind: "search", total: 2, incomplete: false, rows: expect.any(Array) as unknown }],
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

describe("LoadingView, a list that replaces another list (#563)", () => {
  it("[SR-122/AK4] starts the next list empty: it never shows the rows of the list before under its name, and Ctrl+N waits for its own rows", async () => {
    // The search answers when the test says so, as a slow core does.
    let answerSearch: (value: unknown) => void = () => undefined;
    const call = vi.fn((name: string) =>
      name === "element.list"
        ? Promise.resolve({ ok: true, output: { elements: rowsOf(1, 4), total: 3, incomplete: false } })
        : new Promise((resolve) => {
            answerSearch = resolve;
          }),
    ) as unknown as Call;
    // What each commit shows, read before the effects of the commit run (they ask for the next rows).
    const shown: [string | null | undefined, number][] = [];
    const Probe = (): null => {
      useLayoutEffect(() => {
        shown.push([
          container.querySelector('[role="listbox"]')?.getAttribute("aria-label"),
          container.querySelectorAll(".row").length,
        ]);
      });
      return null;
    };
    const dispatch = vi.fn();
    const show = (buffer: ListBuffer | SearchBuffer): Promise<void> =>
      render(
        createElement(
          Fragment,
          null,
          createElement(LoadingView, {
            call,
            buffer,
            revision: 0,
            dispatch,
            onData: vi.fn(),
            onEcho: vi.fn(),
          }),
          createElement(Probe),
        ),
      );
    await show(listBuffer("All elements"));
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2", "Title 3"]);
    shown.length = 0;
    await show(searchBuffer("wind"));
    expect(shown).toEqual([["Search: wind", 0]]);
    // Ctrl+N before the hits are there selects nothing; once they are, it selects the first hit.
    await press(query('[role="listbox"]'), "n", { ctrlKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    await act(async () => {
      answerSearch({
        ok: true,
        output: {
          hits: [7, 8].map((n) => ({ ...row(n), score: 1, fields: ["title"], terms: ["wind"] })),
          total: 2,
          incomplete: false,
        },
      });
      await Promise.resolve();
    });
    await flush();
    await press(query('[role="listbox"]'), "n", { ctrlKey: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "cursor", key: "search:wind", cursor: 0 });
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

  /** Takes the element buffer away, so the next mount starts a new one (a mount over a mounted one is a reload). */
  const fresh = async (): Promise<void> => {
    await act(async () => {
      root.render(null);
      await Promise.resolve();
    });
  };
  /** Puts the caret of an editor at `anchor` and gives it the focus (a selection moved while focused needs the browser). */
  const caretAt = async (view: EditorView, anchor: number): Promise<void> => {
    await act(async () => {
      // An editor that has the focus keeps it while the caret moves, as with the keyboard: a blur in between
      // makes CodeMirror report the focus lost in this update and found again only 10 ms later, which a
      // busy machine lets the test see.
      if (view.hasFocus) {
        view.dispatch({ selection: { anchor } });
      } else {
        (document.activeElement as HTMLElement | null)?.blur();
        // (happy-dom sends no focus event to the editor; the preview learns of the focus by this effect.)
        view.dispatch({ selection: { anchor }, effects: focusEffect.of(true) });
        view.focus();
      }
      await Promise.resolve();
    });
  };

  /** The properties of the type of `read()` (or of another type): the model the buffer gets from `metamodel.get`. */
  const modelOf = (properties: Record<string, PropertyInfo>, type = "system-requirement"): PropertyModel =>
    new Map([[type, new Map(Object.entries(properties))]]);

  const mount = async (
    call: Call,
    revision = 0,
    draft?: Draft,
    extra: { packages?: PackageModel; properties?: PropertyModel; buffer?: ElementBuffer } = {},
  ) => {
    const dispatched: BufferAction[] = [];
    const data: [string, BufferData | undefined][] = [];
    const echoed: string[] = [];
    const copies: [string, string][] = [];
    const targets: string[] = [];
    const opened: [string, string | undefined][] = [];
    const drafts: [string, Draft | undefined][] = [];
    const shownFiles: (ShownFile | undefined)[] = [];
    const registered: (ElementControls | undefined)[] = [];
    const picks: ReferenceRequest[] = [];
    const asked: Prompt[] = [];
    const titles = referenceTitles(call);
    const node = (rev: number) =>
      createElement(ElementView, {
        call,
        titles,
        buffer: extra.buffer ?? elementBuffer("uuid-1", "spec", "SR-036 Measure wind"),
        revision: rev,
        onData: (key, loaded) => data.push([key, loaded]),
        onEcho: (message) => echoed.push(message),
        onCopy: (label, text) => copies.push([label, text]),
        onOpenRelation: (target) => targets.push(target.key),
        onOpenTarget: (id, repository) => {
          opened.push([id, repository]);
        },
        onPickElement: (request) => picks.push(request),
        onAsk: (prompt) => asked.push(prompt),
        draft,
        // The drafts as the input they hold; the element each keeps (`Draft.shown`) is in `shownFiles`.
        onDraft: (key, kept) => {
          if (kept === undefined) {
            drafts.push([key, undefined]);
          } else {
            const { shown, ...input } = kept;
            drafts.push([key, input]);
            shownFiles.push(shown);
          }
        },
        register: (controls) => registered.push(controls),
        packages: extra.packages,
        properties: extra.properties ?? new Map(),
        dispatch: (action) => dispatched.push(action),
      });
    await render(node(revision));
    return {
      dispatched,
      data,
      echoed,
      copies,
      targets,
      opened,
      drafts,
      shownFiles,
      registered,
      picks,
      asked,
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
    expect(texts(".box .key")).toEqual(["topic", "criteria", "packages"]);
    expect(texts(".box .line")).toEqual(["Wind", "first", "second"]);
    // The targets of a relation property are a box (SR-104); the relation groups keep the relation kinds.
    expect(texts('[data-field="packages"] .relation')).toEqual(["p Stage 3"]);
    expect(texts("h2")).toEqual(["derives-from", "← derives-from"]);
  });

  describe("copy fields (SR-128)", () => {
    const fieldNames = (): (string | undefined)[] =>
      [...container.querySelectorAll<HTMLElement>("[data-field]")].map((field) => field.dataset["field"]);
    const copySymbol = (label: string): HTMLElement => query(`[data-field="${label}"] > .copy`);
    const mountRead = (extra: Partial<DataExportElement> = {}) =>
      mount(asCall(fakeCall({ "element.get": () => ({ element: read(extra) }) })));

    it("[SR-128/AK1] gives the title, the text, each property box and each group of relations a copy symbol", async () => {
      await mountRead();
      expect(fieldNames()).toEqual([
        "Title",
        "Text",
        "topic",
        "criteria",
        "packages",
        "derives-from",
        "← derives-from",
      ]);
      for (const label of fieldNames()) {
        const symbol = copySymbol(label ?? "");
        expect(symbol.tagName).toBe("BUTTON");
        expect(symbol.getAttribute("aria-label")).toBe(`Copy ${label ?? ""}`);
        // The symbol is no stop of the Tab key: the keyboard has "Copy field".
        expect(symbol.getAttribute("tabindex")).toBe("-1");
        expect(symbol.querySelector("svg")).not.toBeNull();
      }
    });

    it("[SR-128/AK1] lets the focus be in the title and in a box, which have no control inside", async () => {
      await mountRead();
      const focusable = [...container.querySelectorAll<HTMLElement>("[data-field]")]
        .filter((field) => field.getAttribute("tabindex") === "0")
        .map((field) => field.dataset["field"]);
      expect(focusable).toEqual(["Title", "topic", "criteria", "packages"]);
    });

    it("[SR-128/AK2] copies the values of a box one per line, and says which field", async () => {
      const { copies } = await mountRead();
      await click(copySymbol("criteria"));
      await click(copySymbol("topic"));
      expect(copies).toEqual([
        ["criteria", "first\nsecond"],
        ["topic", "Wind"],
      ]);
    });

    it("[SR-128/AK2] copies the title, the relations as shown, and the text as the editor holds it", async () => {
      const { copies } = await mountRead();
      await typeInto("!");
      await click(copySymbol("Title"));
      await click(copySymbol("Text"));
      await click(copySymbol("derives-from"));
      await click(copySymbol("← derives-from"));
      await click(copySymbol("packages"));
      expect(copies).toEqual([
        ["Title", "Measure wind"],
        ["Text", "Line one\n<b>not bold</b>!"],
        ["derives-from", "N-1 Need\nN-000002"],
        ["← derives-from", "SR-000009 Child"],
        ["packages", "p Stage 3"],
      ]);
    });

    it("[SR-128/AK2] copies the heading that is shown when the element has no title", async () => {
      const { copies } = await mountRead({ title: "" });
      await click(copySymbol("Title"));
      expect(copies).toEqual([["Title", "SR-036"]]);
    });

    it("[SR-128/AK4] leaves the focus where it is when the symbol is pressed, so the editor keeps its cursor", async () => {
      const { copies } = await mountRead();
      await act(async () => {
        editorView().focus();
        await Promise.resolve();
      });
      const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      await act(async () => {
        copySymbol("criteria").dispatchEvent(press);
        await Promise.resolve();
      });
      expect(press.defaultPrevented).toBe(true);
      expect(editorView().hasFocus).toBe(true);
      // Pressing the field itself or focusing it copies nothing.
      await click(query('[data-field="criteria"] .box'));
      await act(async () => {
        query('[data-field="topic"]').focus();
        await Promise.resolve();
      });
      expect(copies).toEqual([]);
    });

    it("[SR-128/AK3] Copy field copies the field the focus is in", async () => {
      const { controls, copies } = await mountRead();
      for (const label of ["criteria", "Title"]) {
        await act(async () => {
          query(`[data-field="${label}"]`).focus();
          await Promise.resolve();
        });
        act(() => {
          controls().copy();
        });
      }
      await act(async () => {
        editorView().focus();
        await Promise.resolve();
      });
      act(() => {
        controls().copy();
      });
      // A link in a group of relations is in that field.
      await act(async () => {
        query('[data-field="derives-from"] [role="link"]').focus();
        await Promise.resolve();
      });
      act(() => {
        controls().copy();
      });
      expect(copies).toEqual([
        ["criteria", "first\nsecond"],
        ["Title", "Measure wind"],
        ["Text", "Line one\n<b>not bold</b>"],
        ["derives-from", "N-1 Need\nN-000002"],
      ]);
    });

    it("[SR-128/AK3] Copy field from the command prompt copies the field the cursor was in, though the prompt has the focus", async () => {
      const { controls, copies } = await mountRead();
      await act(async () => {
        query('[data-field="topic"]').focus();
        await Promise.resolve();
      });
      const prompt = document.createElement("input");
      prompt.id = "prompt-input";
      document.body.append(prompt);
      await act(async () => {
        prompt.focus();
        await Promise.resolve();
      });
      act(() => {
        controls().copy();
      });
      prompt.remove();
      expect(copies).toEqual([["topic", "Wind"]]);
    });

    it("[SR-128/AK3] Copy field does not copy a field the focus has left for somewhere else than the prompt", async () => {
      const { controls, copies } = await mountRead();
      await act(async () => {
        query('[data-field="topic"]').focus();
        await Promise.resolve();
      });
      const other = document.createElement("input");
      document.body.append(other);
      await act(async () => {
        other.focus();
        await Promise.resolve();
      });
      act(() => {
        controls().copy();
      });
      other.remove();
      expect(copies).toEqual([["ID", "SR-036"]]);
    });

    it("Enter on the focused title or box edits the text, like Enter on the buffer; with a modifier it does not", async () => {
      await mountRead();
      for (const label of ["Title", "criteria"]) {
        await act(async () => {
          query(`[data-field="${label}"]`).focus();
          await Promise.resolve();
        });
        await press(query(`[data-field="${label}"]`), "Enter");
        expect(editorView().hasFocus, label).toBe(true);
        await press(query(".cm-content"), "Escape");
        expect(editorView().hasFocus).toBe(false);
      }
      await press(query('[data-field="topic"]'), "Enter", { ctrlKey: true });
      expect(editorView().hasFocus).toBe(false);
    });

    it("[SR-128/AK3] Copy field copies the ID when the cursor is in no field: on the buffer itself, or after leaving the text", async () => {
      const { controls, copies } = await mountRead();
      act(() => {
        controls().copy();
      });
      await act(async () => {
        editorView().focus();
        await Promise.resolve();
      });
      await press(query(".cm-content"), "Escape");
      act(() => {
        controls().copy();
      });
      expect(copies).toEqual([
        ["ID", "SR-036"],
        ["ID", "SR-036"],
      ]);
    });

    it("[SR-128/AK3] copies the short ID of an element that has no identifier", async () => {
      const { controls, copies } = await mountRead({ identifier: undefined } as never);
      act(() => {
        controls().copy();
      });
      expect(copies).toEqual([["ID", "SR-000001"]]);
    });
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
        : Promise.resolve({
            ok: true,
            output:
              name === "trace.neighbourhood" ? alone({ ref: "uuid-1" }) : { element: read({ text: "base" }) },
          }),
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

  describe("while the element loads: a key, the pointer (#542)", () => {
    /** A call whose `element.get` answers only when `answer` is called. */
    const loadingCall = (): { call: Call; answer: () => Promise<void> } => {
      const call = fakeCall({ "element.get": () => ({ element: read() }) });
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return {
        call: ((name: string, input: Record<string, unknown>) =>
          name === "element.get" ? gate.then(() => call(name, input)) : call(name, input)) as unknown as Call,
        answer: async () => {
          open();
          await flush();
        },
      };
    };
    const enterWhileLoading = async (): Promise<{ answer: () => Promise<void> }> => {
      const { call, answer } = loadingCall();
      await mount(call);
      expect(container.querySelector(".cm-editor")).toBeNull();
      const article = query("article");
      act(() => {
        article.focus();
      });
      await press(article, "Enter");
      return { answer };
    };

    it("puts the caret at the end of the text once the text is shown", async () => {
      const { answer } = await enterWhileLoading();
      await answer();
      expect(editorView().hasFocus).toBe(true);
      expect(editorView().state.selection.main.head).toBe(24);
    });

    it("shows the element when its first parents call fails, and says why", async () => {
      const { echoed } = await mount(
        asCall(
          fakeCall({
            "element.get": () => ({ element: read() }),
            "trace.neighbourhood": () => new Error("The parents could not be read"),
          }),
        ),
      );
      expect(query("article h1").textContent).toBe("Measure wind");
      expect(container.querySelector(".cm-editor")).not.toBeNull();
      expect(container.querySelector(".parents")).toBeNull();
      expect(echoed).toEqual(["The parents could not be read"]);
    });

    it("drops the answer of an element that is no longer shown", async () => {
      const { call, answer } = loadingCall();
      const { data } = await mount(call);
      act(() => {
        root.unmount();
      });
      await answer();
      expect(data.filter(([, loaded]) => loaded !== undefined)).toEqual([]);
      root = createRoot(container);
    });

    it("shows the element together with its parents line, so the title never moves down once shown; the modeline with it", async () => {
      const call = fakeCall({ "element.get": () => ({ element: read() }) });
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const { data } = await mount(((name: string, input: Record<string, unknown>) =>
        name === "trace.neighbourhood"
          ? gate.then(() => call(name, input))
          : call(name, input)) as unknown as Call);
      expect(call.mock.calls.map(([name]) => name)).toEqual(["element.get"]);
      expect(container.querySelector("article h1")).toBeNull();
      expect(data.filter(([, loaded]) => loaded !== undefined)).toEqual([]);
      open();
      await flush();
      expect(query("article h1").textContent).toBe("Measure wind");
      expect(data.filter(([, loaded]) => loaded !== undefined).map(([, loaded]) => loaded?.kind)).toEqual([
        "element",
      ]);
    });

    it("is taken back by a later key on the buffer, such as Escape", async () => {
      const { call, answer } = loadingCall();
      await mount(call);
      const article = query("article");
      act(() => {
        article.focus();
      });
      await press(article, "Enter");
      await press(article, "Escape");
      await answer();
      expect(editorView().hasFocus).toBe(false);
      expect(document.activeElement).toBe(article);
    });

    it("stays through a modifier pressed on its own, such as Shift for a capital letter", async () => {
      const { call, answer } = loadingCall();
      await mount(call);
      const article = query("article");
      act(() => {
        article.focus();
      });
      await press(article, "Enter");
      await press(article, "Shift", { shiftKey: true });
      await answer();
      expect(editorView().hasFocus).toBe(true);
    });

    it("is dropped when the element cannot be read, also when it is read later", async () => {
      let fail = true;
      const call = fakeCall({
        "element.get": () => (fail ? new Error("No element has that ID") : { element: read() }),
      });
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const { again } = await mount(((name: string, input: Record<string, unknown>) =>
        name === "element.get" ? gate.then(() => call(name, input)) : call(name, input)) as unknown as Call);
      const article = query("article");
      act(() => {
        article.focus();
      });
      await press(article, "Enter");
      open();
      await flush();
      fail = false;
      await again(1);
      expect(editorView().hasFocus).toBe(false);
    });

    it("leaves the focus where it went in the meantime", async () => {
      const { answer } = await enterWhileLoading();
      const outside = document.createElement("input");
      document.body.append(outside);
      act(() => {
        outside.focus();
      });
      await answer();
      expect(editorView().hasFocus).toBe(false);
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });
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

  it("[SR-106/AK2] keeps unsaved input on a reload with a changed file, shows the file's version below it and says so once", async () => {
    let text = "first";
    let sha = "sha-1";
    const call = fakeCall({ "element.get": () => ({ element: read({ text }), fileSha256: sha }) });
    const { again, echoed, drafts, data } = await mount(asCall(call));
    await typeInto("!");
    text = "changed";
    sha = "sha-2";
    await again(1);
    expect(editorView().state.doc.toString()).toBe("first!");
    expect(query('[data-on-disk="Text"]').textContent).toBe("On diskchanged");
    expect(query('[data-on-disk="Text"] mark').textContent).toBe("changed");
    expect(echoed).toEqual(['SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"']);
    // The draft keeps the bytes it was typed on, so the conflict comes back with the buffer.
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", { text: "first!", base: "changed", sha: "sha-1" }]);
    expect(data.at(-1)?.[1]).toMatchObject({ kind: "element", disk: "changed" });
    // The same file again says nothing more.
    await again(2);
    expect(echoed).toHaveLength(1);
  });

  it("[SR-106/AK2] opens the conflict when a draft comes back on another file, and keeps the draft", async () => {
    const call = fakeCall({ "element.get": () => ({ element: read({ text: "Hello" }), fileSha256: "new" }) });
    const { echoed, drafts, controls } = await mount(asCall(call), 0, {
      text: "Hello!",
      base: "Old",
      sha: "old",
    });
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(echoed).toEqual(['SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"']);
    expect(query('[data-on-disk="Text"]').textContent).toBe("On diskHello");
    expect(controls().resolve).toBeDefined();
    // The draft is on the new file text, typed on the old bytes.
    expect(drafts).toEqual([["element:spec:uuid-1", { text: "Hello!", base: "Hello", sha: "old" }]]);
  });

  it("follows the file with a draft that comes back on the bytes it was typed on", async () => {
    const call = fakeCall({
      "element.get": () => ({ element: read({ text: "Hello" }), fileSha256: "same" }),
    });
    const { echoed, drafts, controls } = await mount(asCall(call), 0, {
      text: "Hello!",
      base: "Hello",
      sha: "same",
    });
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(echoed).toEqual([]);
    expect(drafts).toEqual([]);
    expect(container.querySelector("[data-on-disk]")).toBeNull();
    expect(controls().resolve).toBeUndefined();
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

  it("drops the draft on a reload when the changed file now holds the typed text, and says nothing", async () => {
    let text = "first";
    let sha = "sha-1";
    const call = fakeCall({ "element.get": () => ({ element: read({ text }), fileSha256: sha }) });
    const { again, echoed, drafts } = await mount(asCall(call));
    await typeInto("!");
    text = "first!";
    sha = "sha-2";
    await again(1);
    expect(echoed).toEqual([]);
    expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    expect(container.querySelector("[data-on-disk]")).toBeNull();
  });

  describe("a file changed outside under the input (SR-106)", () => {
    const CHANGED = 'SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"';
    const DELETED =
      "SR-036 Measure wind was deleted on disk; its content stays here until you close the buffer";
    /** An error of a command with its code. */
    const failure = (code: string, message: string): Error => Object.assign(new Error(message), { code });
    /**
     * The file on disk, read by `element.get` and written by `element.update` with core's precondition: an
     * `expectedFileSha256` that is not the file's refuses the write. `lag` refuses the next write as a store
     * of core that has not read the file yet does.
     */
    const mountDisk = async (properties: Record<string, PropertyInfo> = {}) => {
      const disk = {
        text: "first",
        properties: { topic: "Wind" } as Record<string, unknown>,
        sha: "sha-1",
        gone: false,
        lag: false,
        writes: 0,
      };
      const call = fakeCall({
        "element.get": () =>
          disk.gone
            ? failure("ref.unknown", "uuid-1 is no longer in a.md: the file changed on disk")
            : {
                element: read({ text: disk.text, properties: disk.properties, relations: [] }),
                fileSha256: disk.sha,
              },
        "element.update": (input) => {
          if (disk.gone) {
            return failure("ref.unknown", "uuid-1 is not an element of the workspace");
          }
          if (
            disk.lag ||
            (input["expectedFileSha256"] !== undefined && input["expectedFileSha256"] !== disk.sha)
          ) {
            disk.lag = false;
            return failure(
              "file.changed-on-disk",
              "Not written: a.md changed on disk since it was read. Read it again first.",
            );
          }
          disk.writes += 1;
          disk.text = typeof input["text"] === "string" ? input["text"] : disk.text;
          disk.properties = { ...disk.properties, ...(input["set"] as Record<string, unknown> | undefined) };
          disk.sha = `sha-saved-${String(disk.writes)}`;
          return {
            element: read({ text: disk.text, properties: disk.properties, relations: [] }),
            fileSha256: disk.sha,
            files: ["a.md"],
            affected: 0,
          };
        },
      });
      const mounted = await mount(asCall(call), 0, undefined, {
        properties: modelOf({ topic: { kind: "text", many: false, markdown: false }, ...properties }),
      });
      /** Changes the file outside the app, and the buffer reads it again. */
      let revision = 0;
      const outside = async (change: {
        text?: string;
        properties?: Record<string, unknown>;
        gone?: boolean;
      }) => {
        Object.assign(disk, change);
        disk.sha = `sha-outside-${String(revision)}`;
        revision += 1;
        await mounted.again(revision);
      };
      const updates = () =>
        call.mock.calls.filter(([name]) => name === "element.update").map(([, input]) => input);
      const choose = async (name: string): Promise<void> => {
        act(() => {
          mounted.controls().resolve?.();
        });
        await act(async () => {
          mounted.asked
            .at(-1)
            ?.items.find((item) => item.name === name)
            ?.run();
          await Promise.resolve();
        });
        await flush();
      };
      const topicView = (): EditorView => {
        const found = EditorView.findFromDOM(query('[data-field="topic"] .cm-editor'));
        if (found === null) {
          throw new Error("no editor");
        }
        return found;
      };
      return { ...mounted, disk, call, outside, updates, choose, topicView };
    };
    const blocks = (): string[] =>
      [...container.querySelectorAll<HTMLElement>("[data-on-disk]")].map((block) => block.textContent);
    /** A read that found the file gone asks again after a batch of the watcher; still gone, it is deleted. */
    const confirmGone = async (): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(GONE_CONFIRM_MS);
      });
      await flush();
    };
    afterEach(() => {
      vi.useRealTimers();
    });

    it('[SR-106/AK2] with input an outside change is not saved over: both versions are shown, and "Keep my input" writes only the fields with input on the new file', async () => {
      const { disk, outside, echoed, controls, choose, updates, data, drafts } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs", properties: { topic: "Gusts" } });
      // Not saved: the input stays in the editor, the file's version is below it, and the box without
      // input follows the file.
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(blocks()).toEqual(["On disktheirs"]);
      expect(query('[data-field="topic"]').textContent).toContain("Gusts");
      expect(echoed).toEqual([CHANGED]);
      expect(data.at(-1)?.[1]).toMatchObject({ disk: "changed" });
      // "Save element" says what to do first, and writes nothing.
      act(() => {
        controls().save();
      });
      expect(echoed.at(-1)).toBe("Resolve the change on disk first");
      expect(updates()).toEqual([]);
      await choose("Keep my input");
      expect(updates()).toEqual([{ ref: "uuid-1", text: "first!", expectedFileSha256: "sha-outside-0" }]);
      expect(disk).toMatchObject({ text: "first!", properties: { topic: "Gusts" } });
      expect(echoed.at(-1)).toBe("Saved SR-036 Measure wind");
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      expect(data.at(-1)?.[1]).not.toHaveProperty("disk");
    });

    it('[SR-106/AK2] "Take the file" puts the file\'s version into the editor and writes nothing; Ctrl+Z brings the input back', async () => {
      const { disk, outside, controls, choose, updates, drafts } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs" });
      await choose("Take the file");
      expect(editorView().state.doc.toString()).toBe("theirs");
      expect(updates()).toEqual([]);
      expect(disk.text).toBe("theirs");
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      // The input is not lost: one undo brings it back, as input on the new file.
      act(() => {
        undo(editorView());
      });
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(drafts.at(-1)).toEqual([
        "element:spec:uuid-1",
        { text: "first!", base: "theirs", sha: "sha-outside-0" },
      ]);
      expect(blocks()).toEqual([]);
    });

    it('[SR-106/AK2] "Take the file" takes the file\'s value of a box with input too, and of a choice', async () => {
      const area: PropertyInfo = {
        name: "Area",
        kind: "choice",
        many: false,
        markdown: false,
        choices: [
          { key: "quality", name: "Quality" },
          { key: "interface", name: "Interface" },
        ],
      };
      const { disk, outside, choose, topicView, asked, controls } = await mountDisk({ area });
      disk.properties = { topic: "Wind", area: "quality" };
      await outside({});
      act(() => {
        topicView().dispatch({ changes: { from: 4, insert: "y" } });
      });
      await act(async () => {
        query('[data-field="area"]').focus();
        await Promise.resolve();
      });
      await press(query('[data-field="area"]'), "Enter");
      await act(async () => {
        asked
          .at(-1)
          ?.items.find((item) => item.name === "Interface")
          ?.run();
        await Promise.resolve();
      });
      await outside({ properties: { topic: "Calm", area: "quality" } });
      expect(blocks()).toEqual(["On diskCalm", "On diskQuality"]);
      await choose("Take the file");
      expect(topicView().state.doc.toString()).toBe("Calm");
      expect(query('[data-field="area"]').textContent).toContain("quality");
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
    });

    it('Enter on a block "On disk" asks which version holds, Escape goes back to the buffer', async () => {
      const { outside, asked } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs" });
      const block = query('[data-on-disk="Text"]');
      await act(async () => {
        block.focus();
        await Promise.resolve();
      });
      await press(block, "Enter", { shiftKey: true });
      expect(asked).toEqual([]);
      await press(block, "Enter");
      expect(asked.at(-1)?.label).toBe("Resolve change on disk");
      expect(asked.at(-1)?.items.map((item) => item.name)).toEqual(["Keep my input", "Take the file"]);
      await press(block, "Escape");
      expect(document.activeElement).toBe(query("article"));
    });

    it("updates the blocks on another change, and ends the conflict without asking when the file holds the input or the bytes it was typed on again", async () => {
      const { disk, outside, echoed, controls } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs" });
      await outside({ text: "theirs again" });
      expect(blocks()).toEqual(["On disktheirs again"]);
      expect(echoed).toEqual([CHANGED]);
      // The file holds the input: nothing is unsaved, nothing to resolve.
      await outside({ text: "first!" });
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
      // Typed on the file as it is now, then the file goes away from it and back to it.
      await typeInto("?");
      await outside({ text: "other" });
      expect(blocks()).toEqual(["On diskother"]);
      Object.assign(disk, { text: "first!" });
      const back = disk.sha;
      await outside({});
      disk.sha = back;
      await outside({ text: "first!" });
      expect(echoed).toHaveLength(2);
    });

    it("ends the conflict when the input is typed to what the file holds", async () => {
      const { outside, controls } = await mountDisk();
      await typeInto("!");
      await outside({ text: "first!?" });
      expect(blocks()).toEqual(["On diskfirst!?"]);
      await typeInto("?");
      expect(blocks()).toEqual([]);
      expect(controls().resolve).toBeUndefined();
    });

    it("saves again once, silently, when core's store had not read the file the buffer shows (#493 F2)", async () => {
      const { disk, echoed, controls, updates } = await mountDisk();
      await typeInto("!");
      disk.lag = true;
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
      expect(updates()).toHaveLength(2);
      expect(disk.text).toBe("first!");
      expect(echoed).toEqual(["Saved SR-036 Measure wind"]);
    });

    it("says why when the second write is refused too, and keeps the input", async () => {
      const { disk, echoed, controls, call } = await mountDisk();
      await typeInto("!");
      call.mockImplementation((name: string) =>
        Promise.resolve(
          name === "element.update"
            ? { ok: false, code: "file.changed-on-disk", message: "Not written: a.md changed on disk" }
            : { ok: true, output: { element: read({ text: "first", relations: [] }), fileSha256: disk.sha } },
        ),
      );
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
      expect(echoed).toEqual(["Not written: a.md changed on disk"]);
      expect(editorView().state.doc.toString()).toBe("first!");
    });

    it("[SR-106/AK2] follows the rule for a change from outside when a save finds the file changed before the watcher said so", async () => {
      const { disk, echoed, controls, updates } = await mountDisk();
      await typeInto("!");
      Object.assign(disk, { text: "theirs", sha: "sha-unseen" });
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
      expect(updates()).toHaveLength(1);
      expect(disk.text).toBe("theirs");
      expect(blocks()).toEqual(["On disktheirs"]);
      expect(echoed).toEqual([CHANGED]);
    });

    it("[SR-106/AK3] keeps the content in the read-only editor when the file is deleted, names the deletion, and writes nothing", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { outside, echoed, controls, copies, updates, data, disk } = await mountDisk();
      await typeInto("!");
      await outside({ gone: true });
      // The first read that finds the file gone is no deletion yet: a file being written is not known either.
      expect(echoed).toEqual([]);
      expect(editorView().state.readOnly).toBe(false);
      await confirmGone();
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(query(".cm-content").getAttribute("contenteditable")).toBe("false");
      expect(query('[data-field="topic"] .cm-content').getAttribute("contenteditable")).toBe("false");
      expect(echoed).toEqual([DELETED]);
      expect(data.at(-1)?.[1]).toMatchObject({ disk: "deleted" });
      // Nothing is saved or changed; the content can still be copied.
      for (const run of [
        () => {
          controls().save();
        },
        () => {
          controls().addProperty();
        },
        () => {
          query('[data-field="topic"]').focus();
          controls().clearProperty();
        },
      ]) {
        act(run);
      }
      expect(updates()).toEqual([]);
      expect(echoed.slice(1)).toEqual([DELETED, DELETED, DELETED]);
      act(() => {
        controls().copy();
      });
      expect(copies).toEqual([["topic", "Wind"]]);
      // Asked again while gone, it says nothing more.
      await outside({ gone: true });
      expect(echoed).toHaveLength(4);
      // The file comes back: the buffer is editable again, and its input on other bytes is a conflict.
      disk.gone = false;
      await outside({ gone: false });
      expect(query(".cm-content").getAttribute("contenteditable")).toBe("true");
      expect(data.at(-1)?.[1]).toMatchObject({ disk: "changed" });
      expect(editorView().state.doc.toString()).toBe("first!");
    });

    it("[SR-106/AK3] a save on a file that is gone finds the deletion, and the choices then say so", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { disk, outside, echoed, controls, choose } = await mountDisk();
      await typeInto("!");
      await outside({ text: "theirs" });
      Object.assign(disk, { gone: true });
      await choose("Keep my input");
      expect(echoed).toEqual([CHANGED]);
      await confirmGone();
      expect(echoed).toEqual([CHANGED, DELETED]);
      await choose("Keep my input");
      await choose("Take the file");
      expect(echoed).toEqual([CHANGED, DELETED, DELETED, DELETED]);
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(controls().resolve).toBeDefined();
    });

    it("keeps the element and echoes a failed read that is no deletion", async () => {
      const { echoed, call, again } = await mountDisk();
      await typeInto("!");
      const plain = call.getMockImplementation();
      call.mockImplementation((name: string, input: Record<string, unknown>) =>
        name === "element.get"
          ? Promise.resolve({ ok: false, code: "file.faulty", message: "a.md is faulty now" })
          : (plain?.(name, input) ?? Promise.resolve({ ok: true, output: undefined })),
      );
      await again(5);
      expect(echoed).toEqual(["a.md is faulty now"]);
      expect(editorView().state.doc.toString()).toBe("first!");
      expect(query(".cm-content").getAttribute("contenteditable")).toBe("true");
    });
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

  describe("Markdown properties (SR-127)", () => {
    const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
    const VERSION = "n1:1aac78aad3b5e6a8";
    const KEY = "acceptance-criteria";
    const markdown: PropertyModel = modelOf({
      [KEY]: { kind: "text", many: true, markdown: true },
      topic: { kind: "text", many: false, markdown: false },
    });
    const FIRST = "**Gegeben** ein *Satz*, `wenn` er gilt.";
    const SECOND = `**Dann** gilt [D-017](logreq:${TARGET}?version=${VERSION}).`;
    const hint = (place: string, message = "points to an older version") => ({
      code: "relation.outdated",
      severity: "warning",
      message,
      targetId: TARGET,
      storedVersion: VERSION,
      hintId: `relation.outdated/spec/a.md/uuid-1/${place}/${TARGET}?version=${VERSION}&n=1`,
    });
    const element = (criteria: string[], problems: object[] = [], more: Partial<DataExportElement> = {}) =>
      read({
        title: "**Measure**",
        text: "",
        properties: { topic: "**Wind**", [KEY]: criteria },
        relations: [],
        problems,
        ...more,
      } as unknown as Partial<DataExportElement>);
    const mountCriteria = (criteria: string[], problems: object[] = [], shown: PropertyModel = markdown) => {
      let current = { criteria, problems };
      const call = fakeCall({
        "element.get": () => ({ element: element(current.criteria, current.problems) }),
      });
      const mounted = fresh().then(() => mount(asCall(call), 0, undefined, { properties: shown }));
      return {
        mounted,
        change: (next: { criteria: string[]; problems: object[] }) => {
          current = next;
        },
      };
    };
    const box = (): HTMLElement => query(`[data-field="${KEY}"]`);
    const boxViews = (): EditorView[] =>
      [...box().querySelectorAll<HTMLElement>(".cm-editor")].map((editor) => {
        const found = EditorView.findFromDOM(editor);
        if (found === null) {
          throw new Error("no editor");
        }
        return found;
      });
    const lines = (): (string | null)[] => [...box().querySelectorAll(".cm-line")].map((l) => l.textContent);

    it("[SR-127/AK1] shows the values of a markdown property formatted like the text: bold, italic and code without their marks", async () => {
      await mountCriteria([FIRST, SECOND]).mounted;
      // One editor for the box, one value per line.
      expect(boxViews()).toHaveLength(1);
      expect(lines()).toEqual(["Gegeben ein Satz, wenn er gilt.", "Dann gilt D-017."]);
      expect(box().querySelector(".cm-lr-strong")?.textContent).toBe("Gegeben");
      expect(box().querySelector(".cm-lr-em")?.textContent).toBe("Satz");
      expect(box().querySelector(".cm-lr-code")?.textContent).toBe("wenn");
      expect(box().textContent).not.toContain("*");
      expect(box().textContent).not.toContain("`");
      expect(query(`[data-field="${KEY}"] .key`).textContent).toBe(KEY);
      // The box is editable and named by the key.
      const content = box().querySelector(".cm-content");
      expect(content?.getAttribute("contenteditable")).toBe("true");
      expect(content?.getAttribute("aria-label")).toBe(KEY);
    });

    it("[SR-127/AK1] shows the source only on the line with the caret; the other values stay formatted", async () => {
      await mountCriteria([FIRST, SECOND]).mounted;
      const [view] = boxViews();
      if (view === undefined) {
        throw new Error("no editor");
      }
      await caretAt(view, 3);
      expect(view.hasFocus).toBe(true);
      // The first value shows its marks, the second is formatted.
      expect(lines()).toEqual([FIRST, "Dann gilt D-017."]);
      // The caret goes down: the second value shows its source, the first is formatted again.
      await caretAt(view, FIRST.length + 3);
      expect(lines()).toEqual(["Gegeben ein Satz, wenn er gilt.", SECOND]);
      // No caret in the box any more: all values are formatted.
      act(() => {
        query(`[data-field="${KEY}"]`).focus();
      });
      expect(view.hasFocus).toBe(false);
      act(() => {
        view.dispatch({ effects: focusEffect.of(false) });
      });
      expect(lines()).toEqual(["Gegeben ein Satz, wenn er gilt.", "Dann gilt D-017."]);
    });

    it("[SR-127/AK1] shows the label of a reference in a value and opens its element on a click", async () => {
      const { mounted } = mountCriteria([FIRST, SECOND]);
      const { opened } = await mounted;
      expect(box().querySelector(".cm-lr-ref")?.textContent).toBe("D-017");
      expect(box().textContent).not.toContain("logreq:");
      await act(async () => {
        query(`[data-field="${KEY}"] .cm-lr-ref`).dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
        );
        await Promise.resolve();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
    });

    it("[SR-127/AK3] marks an outdated reference in a value like one in the text, from the hint of that property only", async () => {
      const { mounted, change } = mountCriteria([FIRST, SECOND], [hint(`@text:${KEY}`)]);
      const { again } = await mounted;
      expect(box().querySelector(".cm-lr-outdated")?.getAttribute("title")).toBe(
        "points to an older version",
      );
      expect(box().textContent).toContain("D-017 outdated");
      // The editor stays (focus and selection would too) while the hints are the same.
      const [before] = boxViews();
      await again(1);
      expect(boxViews()[0]).toBe(before);
      // The hint of another property or of the text is no mark in this box; a hint that is gone drops it.
      change({ criteria: [FIRST, SECOND], problems: [hint("@text:rationale", "other"), hint("@text")] });
      await again(2);
      expect(box().querySelector(".cm-lr-outdated")).toBeNull();
      expect(box().querySelector(".cm-lr-ref")?.textContent).toBe("D-017");
      change({ criteria: [FIRST, SECOND], problems: [hint(`@text:${KEY}`, "changed")] });
      await again(3);
      expect(box().querySelector(".cm-lr-outdated")?.getAttribute("title")).toBe("changed");
      expect(boxViews()[0]).toBe(before);
    });

    it("[SR-127/AK3] Follow reference with the focus on the box opens the first reference of the box, or says there is none", async () => {
      const { mounted } = mountCriteria([FIRST, SECOND, `[x](logreq:uuid-2)`]);
      const { controls, opened, echoed } = await mounted;
      act(() => {
        box().focus();
      });
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
      const none = mountCriteria([FIRST]);
      const again = await none.mounted;
      act(() => {
        box().focus();
      });
      act(() => {
        again.controls().follow();
      });
      expect(again.opened).toEqual([]);
      expect(again.echoed.at(-1)).toBe(`No element reference in ${KEY}`);
      expect(echoed).toEqual([]);
    });

    it("[SR-127/AK3] Follow reference with the caret in a value opens the reference at the caret, or says there is none", async () => {
      const { controls, opened, echoed } = await mountCriteria([FIRST, SECOND]).mounted;
      const [view] = boxViews();
      if (view === undefined) {
        throw new Error("no editor");
      }
      await caretAt(view, 2);
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([]);
      expect(echoed.at(-1)).toBe("No element reference at the cursor");
      const at = FIRST.length + 1 + SECOND.indexOf("D-017") + 1;
      await caretAt(view, at);
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([[TARGET, undefined]]);
    });

    it("[SR-127/AK5] shows the title as it is, and a property that is not marked markdown as plain text with its marks", async () => {
      await mountCriteria([FIRST]).mounted;
      expect(query("h1").textContent).toBe("**Measure**");
      const topic = query('[data-field="topic"]');
      expect(topic.querySelector(".cm-content")?.textContent).toBe("**Wind**");
      expect(topic.querySelector(".cm-lr-strong")).toBeNull();
      // The text, the marked box and the plain box have an editor each.
      expect(container.querySelectorAll(".cm-editor")).toHaveLength(3);
    });

    it("[SR-127/AK5] shows a property as it is when the metamodel has none for the type of the element", async () => {
      await mountCriteria([FIRST, SECOND], [], new Map()).mounted;
      expect(box().querySelector(".cm-editor")).toBeNull();
      expect(texts(`[data-field="${KEY}"] .line`)).toEqual([FIRST, SECOND]);
      await mountCriteria([FIRST], [], modelOf({}, "need")).mounted;
      expect(box().querySelector(".cm-editor")).toBeNull();
    });

    /** A buffer whose criteria are saved as they are sent, with the call to look at. */
    const mountSaving = async (shown: PropertyModel = markdown, extra: Record<string, unknown> = {}) => {
      let criteria = [FIRST, SECOND];
      const call = fakeCall({
        "element.get": () => ({ element: element(criteria, [], extra) }),
        "element.update": (input) => {
          const set = input["set"] as Record<string, string[]> | undefined;
          criteria = set?.[KEY] ?? criteria;
          return { element: element(criteria, [], extra), files: ["a.md"], affected: 0 };
        },
      });
      const mounted = await fresh().then(() => mount(asCall(call), 0, undefined, { properties: shown }));
      return { ...mounted, call };
    };
    /** Types `text` at the end of the first value of the box, as the keyboard does. */
    const typeInFirst = async (text: string): Promise<EditorView> => {
      const [first] = boxViews();
      if (first === undefined) {
        throw new Error("no box editor");
      }
      act(() => {
        first.focus();
        first.dispatch({ selection: { anchor: first.state.doc.line(1).to } });
      });
      for (const char of text) {
        await act(async () => {
          const head = first.state.selection.main.head;
          first.dispatch({
            changes: { from: head, insert: char },
            selection: { anchor: head + 1 },
            userEvent: "input.type",
          });
          await Promise.resolve();
        });
      }
      return first;
    };
    const wind = { id: TARGET, title: "Wind sehen", label: "N-1", shortId: "N-1", repository: "spec" };

    it("[SR-127/AK2] [[ in an acceptance criterion asks for an element and writes the reference into that value only", async () => {
      const { picks, controls, call } = await mountSaving();
      const first = await typeInFirst("[[");
      expect(picks).toHaveLength(1);
      expect(first.state.doc.toString()).toBe(`${FIRST}[[\n${SECOND}`);
      // A prompt opens while the [[ waits: nothing is saved with it.
      act(() => {
        controls().prompting();
      });
      await flush();
      expect(call.mock.calls.filter(([name]) => name === "element.update")).toEqual([]);
      act(() => {
        picks[0]?.insert(wind);
      });
      expect(first.state.doc.toString()).toBe(`${FIRST}[Wind sehen](logreq:${TARGET})\n${SECOND}`);
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
      expect(call.mock.calls.filter(([name]) => name === "element.update")).toEqual([
        [
          "element.update",
          { ref: "uuid-1", set: { [KEY]: [`${FIRST}[Wind sehen](logreq:${TARGET})`, SECOND] } },
        ],
      ]);
      // Off the line with the caret the value shows the title of the target, which opens on a click.
      act(() => {
        first.contentDOM.blur();
        first.dispatch({ effects: focusEffect.of(false) });
      });
      expect(lines()[0]).toBe("Gegeben ein Satz, wenn er gilt.Wind sehen");
    });

    it("[SR-127/AK2] no [[ search in a property that is not marked markdown, nor in a read-only box", async () => {
      const plain: PropertyModel = modelOf({ [KEY]: { kind: "text", many: true, markdown: false } });
      const { picks } = await mountSaving(plain);
      await typeInFirst("[[");
      expect(picks).toEqual([]);
      expect(boxViews()[0]?.state.doc.line(1).text).toBe(`${FIRST}[[`);
      const locked = await mountSaving(markdown, { readOnly: true });
      expect(boxViews()[0]?.state.readOnly).toBe(true);
      await typeInFirst("[[");
      expect(locked.picks).toEqual([]);
      // The same box marked markdown and editable asks.
      const open = await mountSaving();
      await typeInFirst("[[");
      expect(open.picks).toHaveLength(1);
    });

    it("[SR-127/AK2] a reference to another repository in a value shows the title of its target when it is here (D-058)", async () => {
      const across = `Siehe [N-0e9d7c](logreq:${TARGET}?version=${VERSION}&repository=sensor).`;
      const call = fakeCall({
        "element.get": (input) =>
          input["ref"] === TARGET
            ? { element: read({ id: TARGET, title: "Böen messen" }) }
            : { element: element([across]) },
      });
      await fresh().then(() => mount(asCall(call), 0, undefined, { properties: markdown }));
      await flush();
      expect(call).toHaveBeenCalledWith("element.get", { ref: TARGET, repository: "sensor" });
      expect(lines()).toEqual(["Siehe Böen messen."]);
    });

    it("[SR-127/AK1] shows no image and no slash menu in a value, and [[ that is not typed asks nothing", async () => {
      const { picks } = await mountCriteria(["![x](a.png) and /heading and [[wind"]).mounted;
      expect(picks).toEqual([]);
      expect(box().querySelector("img:not(.cm-widgetBuffer)")).toBeNull();
      expect(box().querySelector(".cm-content")?.textContent).toBe("![x](a.png) and /heading and [[wind");
      expect(container.querySelector(".cm-tooltip-autocomplete")).toBeNull();
    });

    it("[SR-127/AK1] sets inline formatting only: a heading, a list item and a quote in a value keep their source", async () => {
      await mountCriteria(["# x", "- y", "> z", "1. n", "**b** and # c"]).mounted;
      expect(lines()).toEqual(["# x", "- y", "> z", "1. n", "b and # c"]);
      expect(box().querySelector(".cm-lr-h1, .cm-lr-bullet, .cm-lr-quote, .cm-lr-task")).toBeNull();
      expect(box().querySelector(".cm-lr-strong")?.textContent).toBe("b");
    });

    it("[SR-127/AK1] never pairs a mark across two values, though they are lines of one document", async () => {
      await mountCriteria(["*a*", "b*", "**c", "d**", "x_", "_y"]).mounted;
      expect(box().querySelectorAll(".cm-lr-em")).toHaveLength(1);
      expect(box().querySelector(".cm-lr-em")?.textContent).toBe("a");
      expect(box().querySelector(".cm-lr-strong")).toBeNull();
      expect(lines()).toEqual(["a", "b*", "**c", "d**", "x_", "_y"]);
    });

    it("[SR-128/AK2] copies the stored source of a markdown property, one value per line", async () => {
      const { copies } = await mountCriteria([FIRST, SECOND]).mounted;
      await click(query(`[data-field="${KEY}"] > .copy`));
      expect(copies).toEqual([[KEY, `${FIRST}\n${SECOND}`]]);
    });
  });

  describe("property boxes (SR-104)", () => {
    const KEY = "acceptance-criteria";
    const model = modelOf({
      topic: { kind: "text", many: false, markdown: false },
      [KEY]: { kind: "text", many: true, markdown: false },
      effort: { kind: "number", many: false, markdown: false },
      synonyms: { kind: "text", many: true, markdown: false },
      area: {
        name: "Area",
        kind: "choice",
        many: false,
        markdown: false,
        choices: [
          { key: "quality", name: "Quality" },
          { key: "performance", name: "Performance" },
          { key: "interface", name: "Interface" },
        ],
      },
      tags: {
        name: "Tags",
        kind: "choice",
        many: true,
        markdown: false,
        choices: [
          { key: "a", name: "Alpha" },
          { key: "b", name: "Beta" },
        ],
      },
      packages: { name: "Package", kind: "relation", many: true, markdown: false, targetTypes: ["package"] },
      parent: { name: "Parent", kind: "relation", many: false, markdown: false },
    });
    const withProperties = (properties: Record<string, unknown>, more: Partial<DataExportElement> = {}) =>
      read({ text: "Text", relations: [], properties, ...more });
    const mountBoxes = async (
      properties: Record<string, unknown>,
      more: Partial<DataExportElement> = {},
      draft?: Draft,
      update?: (input: Record<string, unknown>) => unknown,
    ) => {
      // The bytes of the file: none until the file changes, then one name per change.
      let current: { properties: Record<string, unknown>; more: Partial<DataExportElement>; sha?: string } = {
        properties,
        more,
      };
      let changes = 0;
      const call = fakeCall({
        "element.get": () => ({
          element: withProperties(current.properties, current.more),
          ...(current.sha === undefined ? {} : { fileSha256: current.sha }),
        }),
        "element.update": update ?? (() => new Error("no update expected")),
      });
      await fresh();
      const mounted = await mount(asCall(call), 0, draft, { properties: model });
      return {
        ...mounted,
        call,
        change: (next: Record<string, unknown>, nextMore: Partial<DataExportElement> = {}) => {
          changes += 1;
          current = { properties: next, more: nextMore, sha: `sha-${String(changes)}` };
        },
      };
    };
    const field = (key: string): HTMLElement => query(`[data-field="${key}"]`);
    const viewOf = (key: string): EditorView => {
      const found = EditorView.findFromDOM(query(`[data-field="${key}"] .cm-editor`));
      if (found === null) {
        throw new Error("no editor");
      }
      return found;
    };
    const typeIn = async (key: string, insert: string, at?: number): Promise<void> => {
      await act(async () => {
        const view = viewOf(key);
        const from = at ?? view.state.doc.length;
        view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length } });
        await Promise.resolve();
      });
    };
    const replaceIn = async (key: string, doc: string): Promise<void> => {
      await act(async () => {
        const view = viewOf(key);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
        await Promise.resolve();
      });
    };
    const save = async (controls: () => ElementControls): Promise<void> => {
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await flush();
    };
    const updates = (call: ReturnType<typeof fakeCall>) =>
      call.mock.calls.filter(([name]) => name === "element.update").map(([, input]) => input);
    const savedWith = (properties: Record<string, unknown>) => ({
      element: withProperties(properties),
      files: ["a.md"],
      affected: 0,
    });

    it("[SR-104/AK1] shows every filled property as a box below the text, and none for an empty one", async () => {
      await mountBoxes({
        topic: "Wind",
        empty: "",
        blank: "   ",
        none: null,
        list: [],
        mapping: {},
        [KEY]: ["first", "second"],
      });
      const names = [...container.querySelectorAll<HTMLElement>("[data-field]")].map(
        (f) => f.dataset["field"],
      );
      expect(names).toEqual(["Title", "Text", "topic", KEY]);
      // The boxes come after the text in the document.
      const all = [...container.querySelectorAll("[data-field]")];
      expect(all.indexOf(field("Text"))).toBeLessThan(all.indexOf(field("topic")));
      expect(viewOf(KEY).state.doc.toString()).toBe("first\nsecond");
    });

    it("[SR-104/AK4] saves a box that was emptied with unset, and the box is gone with the property", async () => {
      const { controls, call, drafts, echoed } = await mountBoxes(
        { topic: "Wind", [KEY]: ["first", "second"] },
        {},
        undefined,
        (input) => {
          expect(input).toEqual({ ref: "uuid-1", unset: [KEY] });
          return savedWith({ topic: "Wind" });
        },
      );
      await replaceIn(KEY, "");
      expect(drafts.at(-1)?.[1]?.boxes?.get(KEY)).toEqual({ doc: "", base: "first\nsecond" });
      // The box stays, empty, until it is saved.
      expect(container.querySelector(`[data-field="${KEY}"]`)).not.toBeNull();
      await save(controls);
      expect(updates(call)).toHaveLength(1);
      expect(container.querySelector(`[data-field="${KEY}"]`)).toBeNull();
      expect(echoed.at(-1)).toBe("Saved SR-036 Measure wind");
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    });

    it("[SR-104/AK4] treats a box with nothing but blank lines as emptied", async () => {
      const { controls, call } = await mountBoxes({ [KEY]: ["first"], topic: "Wind" }, {}, undefined, () =>
        savedWith({ topic: "Wind" }),
      );
      await replaceIn(KEY, "  \n\n \t");
      await replaceIn("topic", "   ");
      await save(controls);
      expect(updates(call)).toEqual([{ ref: "uuid-1", unset: [KEY, "topic"] }]);
    });

    it("saves the text and the boxes that changed together, and only those", async () => {
      const { controls, call, drafts } = await mountBoxes(
        { topic: "Wind", [KEY]: ["first", "second"], effort: "3" },
        {},
        undefined,
        () => savedWith({ topic: "Wind!", [KEY]: ["first", "third"], effort: "3" }),
      );
      await typeIn("topic", "!");
      await replaceIn(KEY, "first\n\n  third \n");
      await act(async () => {
        editorView().dispatch({ changes: { from: 0, insert: "More " } });
        await Promise.resolve();
      });
      await save(controls);
      // Blank lines go, every other line is kept byte for byte, an untouched box is not sent.
      expect(updates(call)).toEqual([
        { ref: "uuid-1", text: "More Text", set: { topic: "Wind!", [KEY]: ["first", "  third "] } },
      ]);
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      expect(viewOf(KEY).state.doc.toString()).toBe("first\nthird");
    });

    it("sends only a box whose document differs from the stored one, and keeps the bytes of the others", async () => {
      const { controls, call, echoed } = await mountBoxes({
        topic: "Wind",
        [KEY]: ["first", "", "second"],
      });
      // The document is the stored value as it is: a blank item stays, nothing is trimmed.
      expect(viewOf(KEY).state.doc.toString()).toBe("first\n\nsecond");
      await typeIn("topic", "!");
      await replaceIn("topic", "Wind");
      await save(controls);
      expect(updates(call)).toEqual([]);
      expect(echoed.at(-1)).toBe("No changes to save");
    });

    it("sends a decimal literal of a number property as a number, anything else as the text typed", async () => {
      const { controls, call } = await mountBoxes({ effort: "1", topic: "t" }, {}, undefined, () =>
        savedWith({ effort: 2.5, topic: "t" }),
      );
      await replaceIn("effort", "2.5");
      await save(controls);
      await replaceIn("effort", "0x10");
      await save(controls);
      await replaceIn("effort", "-3");
      await save(controls);
      expect(updates(call)).toEqual([
        { ref: "uuid-1", set: { effort: 2.5 } },
        { ref: "uuid-1", set: { effort: "0x10" } },
        { ref: "uuid-1", set: { effort: -3 } },
      ]);
    });

    it("keeps the draft and the caret and says why when core refuses the update", async () => {
      const { controls, echoed, drafts } = await mountBoxes({ topic: "Wind" }, {}, undefined, () => {
        return new Error("Type system-requirement has no property topic");
      });
      await typeIn("topic", "!");
      await save(controls);
      expect(echoed.at(-1)).toBe("Type system-requirement has no property topic");
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!");
      expect(drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Wind!", base: "Wind" });
    });

    it("appends the first hint about a saved key to the echo", async () => {
      const { controls, echoed } = await mountBoxes({ effort: "1", topic: "t" }, {}, undefined, () => ({
        ...savedWith({ effort: "abc", topic: "t" }),
        problems: [
          { code: "element.wrong-value-kind", severity: "warning", message: "topic is odd" },
          { code: "element.wrong-value-kind", severity: "warning", message: "effort expects a number" },
        ],
      }));
      await replaceIn("effort", "abc");
      await save(controls);
      expect(echoed.at(-1)).toBe("Saved SR-036 Measure wind. effort expects a number");
    });

    it("keeps input typed while the save ran as a draft, and shows the saved value in a box that was not touched", async () => {
      let answer: (value: unknown) => void = () => undefined;
      const call = vi.fn((name: string) =>
        name === "element.update"
          ? new Promise((resolve) => {
              answer = resolve;
            })
          : Promise.resolve({
              ok: true,
              output:
                name === "trace.neighbourhood"
                  ? alone({ ref: "uuid-1" })
                  : { element: withProperties({ topic: "Wind", [KEY]: ["a"] }) },
            }),
      );
      const { controls, drafts } = await mount(asCall(call as never), 0, undefined, { properties: model });
      await typeIn("topic", "!");
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      await typeIn("topic", "?");
      await act(async () => {
        answer({ ok: true, output: savedWith({ topic: "Wind!", [KEY]: ["a"] }) });
        await Promise.resolve();
      });
      await flush();
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!?");
      expect(drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Wind!?", base: "Wind!" });
    });

    it("is read-only for a read-only element, and for a property the type does not know", async () => {
      const { controls, echoed } = await mountBoxes({ topic: "Wind", unknown: "x" }, { readOnly: true });
      expect(field("topic").querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
      await act(async () => {
        controls().save();
        await Promise.resolve();
      });
      expect(echoed.at(-1)).toBe("SR-036 Measure wind is read-only");
      await mountBoxes({ topic: "Wind", unknown: "x" });
      expect(field("unknown").querySelector(".cm-editor")).toBeNull();
      expect(texts('[data-field="unknown"] .line')).toEqual(["x"]);
    });

    it("shows a choice property and a value that is no text as they are", async () => {
      await mountBoxes({ area: "performance", topic: "t", effort: { nested: true } });
      expect(field("area").querySelector(".cm-editor")).toBeNull();
      expect(texts('[data-field="area"] .line')).toEqual(["performance"]);
      expect(field("effort").querySelector(".cm-editor")).toBeNull();
    });

    it("makes a list with a value that holds a line break read-only and says so on entering it", async () => {
      const { echoed } = await mountBoxes({ [KEY]: ["one\ntwo", "three"] });
      expect(field(KEY).querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
      act(() => {
        field(KEY).focus();
      });
      expect(echoed.at(-1)).toBe(`${KEY} has a value with a line break: edit it in the file`);
      // A single value may hold a line break.
      await mountBoxes({ topic: "one\ntwo" });
      expect(field("topic").querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
    });

    it("keeps the unsaved boxes as a draft for the app, and drops a box that is the stored value again", async () => {
      const { drafts } = await mountBoxes({ topic: "Wind", [KEY]: ["a", "b"] });
      await typeIn("topic", "!");
      expect(drafts.at(-1)).toEqual([
        "element:spec:uuid-1",
        { text: "Text", base: "Text", boxes: new Map([["topic", { doc: "Wind!", base: "Wind" }]]) },
      ]);
      await typeIn(KEY, "\nc");
      expect(drafts.at(-1)?.[1]?.boxes?.size).toBe(2);
      await replaceIn("topic", "Wind");
      await replaceIn(KEY, "a\nb");
      expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
    });

    it("shows the boxes of a draft in place of the stored values, and compares them with the file", async () => {
      const draft: Draft = {
        text: "Text",
        base: "Text",
        boxes: new Map([["topic", { doc: "Mine", base: "Wind" }]]),
      };
      const { drafts, echoed } = await mountBoxes({ topic: "Wind", [KEY]: ["a"] }, {}, draft);
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      expect(viewOf(KEY).state.doc.toString()).toBe("a");
      expect(drafts).toEqual([]);
      expect(echoed).toEqual([]);
      // The file changed meanwhile: the draft is kept on the new value, and the conflict shows the file's.
      const other = await mountBoxes({ topic: "Gust" }, {}, { ...draft, sha: "sha-0" });
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      expect(other.echoed.at(-1)).toBe(
        'SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"',
      );
      expect(query('[data-on-disk="topic"]').textContent).toBe("On diskGust");
      expect(other.drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Mine", base: "Gust" });
      // The file holds the draft now: nothing is unsaved.
      const same = await mountBoxes({ topic: "Mine" }, {}, draft);
      expect(same.drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      expect(same.echoed).toEqual([]);
    });

    it("lets a box without input follow the file on a reload, and keeps a box with input and says so", async () => {
      const { again, change, echoed, drafts } = await mountBoxes({ topic: "Wind", [KEY]: ["a"] });
      await typeIn("topic", "!");
      change({ topic: "Gust", [KEY]: ["b"] });
      await again(1);
      expect(viewOf(KEY).state.doc.toString()).toBe("b");
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!");
      expect(echoed.at(-1)).toBe(
        'SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"',
      );
      expect(drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Wind!", base: "Gust" });
      // Only the field with input has a block; the one that followed the file has none.
      expect(
        [...container.querySelectorAll<HTMLElement>("[data-on-disk]")].map(
          (block) => block.dataset["onDisk"],
        ),
      ).toEqual(["topic"]);
      // A property without input that appears or disappears in the file appears or disappears as a box.
      change({ topic: "Gust", synonyms: ["x"] });
      await again(2);
      expect(container.querySelector(`[data-field="${KEY}"]`)).toBeNull();
      expect(viewOf("synonyms").state.doc.toString()).toBe("x");
    });

    it("does not say the file changed when an unrelated box changed on disk and none was edited", async () => {
      const { again, change, echoed, drafts } = await mountBoxes({ topic: "Wind", [KEY]: ["a"] });
      change({ topic: "Wind", [KEY]: ["b"] });
      await again(1);
      expect(echoed).toEqual([]);
      // (The editor following the file reports its change; there is nothing unsaved.)
      expect(drafts.every(([, kept]) => kept === undefined)).toBe(true);
    });

    it("shows the file text, not the old one, when a draft of boxes alone comes back after the text changed on disk", async () => {
      const draft: Draft = {
        text: "Text",
        base: "Text",
        boxes: new Map([["topic", { doc: "Mine", base: "Wind" }]]),
      };
      const { drafts, echoed } = await mountBoxes({ topic: "Wind" }, { text: "Changed on disk" }, draft);
      expect(editorView().state.doc.toString()).toBe("Changed on disk");
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      // The draft is on the new file text, so the next input cannot bring the old text back.
      expect(drafts.at(-1)?.[1]).toEqual({
        text: "Changed on disk",
        base: "Changed on disk",
        boxes: new Map([["topic", { doc: "Mine", base: "Wind" }]]),
      });
      expect(echoed).toEqual([]);
      await typeIn("topic", "!");
      expect(drafts.at(-1)?.[1]).toEqual({
        text: "Changed on disk",
        base: "Changed on disk",
        boxes: new Map([["topic", { doc: "Mine!", base: "Wind" }]]),
      });
    });

    it("keeps the typed text of a draft, on the new file text", async () => {
      const draft: Draft = { text: "Mine", base: "Text", sha: "sha-0" };
      const { drafts, echoed } = await mountBoxes({ topic: "Wind" }, { text: "Changed on disk" }, draft);
      expect(editorView().state.doc.toString()).toBe("Mine");
      expect(drafts.at(-1)?.[1]).toEqual({ text: "Mine", base: "Changed on disk", sha: "sha-0" });
      expect(echoed.at(-1)).toBe(
        'SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"',
      );
    });

    it("[SR-106/AK2] follows a text that changed on disk while only a box has input, keeps the draft on the new text, and stops saving", async () => {
      const { again, change, drafts, echoed } = await mountBoxes({ topic: "Wind" });
      await typeIn("topic", "!");
      change({ topic: "Wind" }, { text: "Changed on disk" });
      await again(1);
      expect(editorView().state.doc.toString()).toBe("Changed on disk");
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!");
      // Spec question #488 (1): any change of the file while there is input asks; the block shows the
      // file's value of the box with input, which the change did not touch.
      expect(echoed).toEqual(['SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"']);
      expect(query('[data-on-disk="topic"]').textContent).toBe("On diskWind");
      expect(drafts.at(-1)?.[1]).toEqual({
        text: "Changed on disk",
        base: "Changed on disk",
        boxes: new Map([["topic", { doc: "Wind!", base: "Wind" }]]),
      });
    });

    it("[SR-106/AK2] keeps the box and its input when the file lost its property, and shows that the file has none", async () => {
      const { again, change, echoed, drafts } = await mountBoxes({ topic: "Wind", [KEY]: ["a"] });
      await typeIn("topic", "!");
      change({ [KEY]: ["a"] });
      await again(1);
      expect(viewOf("topic").state.doc.toString()).toBe("Wind!");
      expect(query('[data-on-disk="topic"]').textContent).toBe("On disk(empty)");
      expect(echoed.at(-1)).toBe(
        'SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"',
      );
      expect(drafts.at(-1)?.[1]?.boxes?.get("topic")).toEqual({ doc: "Wind!", base: "" });
    });

    it("shows a box that appears again as it is stored, not as the draft it was first shown with", async () => {
      const draft: Draft = {
        text: "Text",
        base: "Text",
        boxes: new Map([["topic", { doc: "Mine", base: "Wind" }]]),
      };
      const { again, change, controls, asked } = await mountBoxes({ topic: "Wind" }, {}, draft);
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      change({});
      await again(1);
      // The input stays while the file has no value; taking the file's version empties the box.
      expect(viewOf("topic").state.doc.toString()).toBe("Mine");
      act(() => {
        controls().resolve?.();
      });
      await act(async () => {
        asked.at(-1)?.items[1]?.run();
        await Promise.resolve();
      });
      expect(viewOf("topic").state.doc.toString()).toBe("");
      change({ topic: "Wind" });
      await again(2);
      expect(viewOf("topic").state.doc.toString()).toBe("Wind");
    });

    it("Follow reference in a box that is not Markdown says there is none in it, and does not take the text's", async () => {
      const { controls, opened, echoed } = await mountBoxes(
        { topic: "Wind" },
        { text: "[x](logreq:uuid-2)" },
      );
      await caretAt(viewOf("topic"), 1);
      act(() => {
        controls().follow();
      });
      expect(opened).toEqual([]);
      expect(echoed.at(-1)).toBe("No element reference in topic");
    });

    it("Enter in a single value leaves the box, Enter in a list starts a new value at the caret", async () => {
      await mountBoxes({ topic: "Wind", [KEY]: ["ab"] });
      const topic = field("topic");
      const content = (key: string): Element => query(`[data-field="${key}"] .cm-content`);
      await press(content("topic"), "Enter");
      expect(document.activeElement).toBe(topic);
      expect(viewOf("topic").state.doc.toString()).toBe("Wind");
      // Shift+Enter is Enter: no key puts a line break inside a value.
      await press(content("topic"), "Enter", { shiftKey: true });
      expect(viewOf("topic").state.doc.toString()).toBe("Wind");
      // In a list: a new value, split at the caret.
      act(() => {
        viewOf(KEY).dispatch({ selection: { anchor: 1 } });
      });
      await press(content(KEY), "Enter");
      expect(viewOf(KEY).state.doc.toString()).toBe("a\nb");
      await press(content(KEY), "Enter", { shiftKey: true });
      expect(viewOf(KEY).state.doc.toString()).toBe("a\n\nb");
    });

    it("Escape leaves a box for the box itself, and Escape on the box for the buffer; Enter on the box edits it", async () => {
      await mountBoxes({ topic: "Wind" });
      const topic = field("topic");
      const content = query('[data-field="topic"] .cm-content');
      await press(content, "Escape");
      expect(document.activeElement).toBe(topic);
      await press(topic, "Escape");
      expect(document.activeElement).toBe(query("article"));
      act(() => {
        topic.focus();
      });
      await press(topic, "Enter");
      expect(viewOf("topic").hasFocus).toBe(true);
      expect(viewOf("topic").state.selection.main.head).toBe(4);
    });

    it("Enter on the title or on a box that is not edited at all edits the text, as before", async () => {
      await mountBoxes({ unknown: "x" });
      act(() => {
        field("unknown").focus();
      });
      await press(field("unknown"), "Enter");
      expect(editorView().hasFocus).toBe(true);
      act(() => {
        field("Title").focus();
      });
      await press(field("Title"), "Enter");
      expect(editorView().hasFocus).toBe(true);
    });

    it("gives each box one Tab stop: the box itself, not its editor", async () => {
      await mountBoxes({ topic: "Wind" });
      expect(field("topic").getAttribute("tabindex")).toBe("0");
      expect(field("topic").querySelectorAll('[tabindex="0"]')).toHaveLength(0);
      expect(field("topic").querySelector(".cm-content")?.getAttribute("tabindex")).toBe("-1");
    });

    it("moves with Down and Up between the text and the boxes, from the last and the first line", async () => {
      await mountBoxes({ topic: "Wind", [KEY]: ["a", "b"] });
      const content = (key: string): Element => query(`[data-field="${key}"] .cm-content`);
      act(() => {
        editorView().dispatch({ selection: { anchor: 4 } });
      });
      await press(query(".cm-content"), "ArrowDown");
      expect(viewOf("topic").hasFocus).toBe(true);
      expect(viewOf("topic").state.selection.main.head).toBe(0);
      await press(content("topic"), "ArrowDown");
      expect(viewOf(KEY).hasFocus).toBe(true);
      expect(viewOf(KEY).state.selection.main.head).toBe(0);
      // On the last line of the last box there is nowhere to go: the key is the editor's.
      await caretAt(viewOf(KEY), 3);
      await press(content(KEY), "ArrowDown");
      expect(viewOf(KEY).hasFocus).toBe(true);
      await caretAt(viewOf(KEY), 0);
      await press(content(KEY), "ArrowUp");
      expect(viewOf("topic").hasFocus).toBe(true);
      expect(viewOf("topic").state.selection.main.head).toBe(4);
      await press(content("topic"), "ArrowUp");
      expect(editorView().hasFocus).toBe(true);
      expect(editorView().state.selection.main.head).toBe(4);
    });

    it("leaves Down to the editor when the element has no box", async () => {
      await mountBoxes({});
      await press(query(".cm-content"), "ArrowDown");
      expect(editorView().state.selection.main.head).toBe(4);
    });

    it("moves between the fields that are not edited with Down and Up, without starting to edit, and skips what cannot take the focus", async () => {
      await mountBoxes({ topic: "Wind", area: "performance", [KEY]: ["a"] });
      act(() => {
        field("Title").focus();
      });
      await press(field("Title"), "ArrowDown");
      expect(editorView().hasFocus).toBe(true);
      await press(query(".cm-content"), "Escape");
      act(() => {
        field("topic").focus();
      });
      await press(field("topic"), "ArrowDown");
      expect(document.activeElement).toBe(field("area"));
      await press(field("area"), "ArrowDown");
      expect(document.activeElement).toBe(field(KEY));
      expect(viewOf(KEY).hasFocus).toBe(false);
      await press(field(KEY), "ArrowUp");
      expect(document.activeElement).toBe(field("area"));
      await press(field("area"), "ArrowUp");
      expect(document.activeElement).toBe(field("topic"));
      // Up from the first box goes into the text; from the title nowhere.
      await press(field("topic"), "ArrowUp");
      expect(editorView().hasFocus).toBe(true);
      act(() => {
        field("Title").focus();
      });
      await press(field("Title"), "ArrowUp");
      expect(document.activeElement).toBe(field("Title"));
      // Down from the last box has nowhere to go (a package page goes into its elements).
      act(() => {
        field(KEY).focus();
      });
      await press(field(KEY), "ArrowDown");
      expect(document.activeElement).toBe(field(KEY));
    });

    it("skips the text of a read-only element on the way down from the title", async () => {
      await mountBoxes({ topic: "Wind" }, { readOnly: true });
      act(() => {
        field("Title").focus();
      });
      await press(field("Title"), "ArrowDown");
      expect(document.activeElement).toBe(field("topic"));
    });

    it("copies what the editor of a box holds, the unsaved input included, one value per line", async () => {
      const { copies } = await mountBoxes({ [KEY]: ["a", "b"], area: "performance" });
      await typeIn(KEY, "\nc");
      await click(query(`[data-field="${KEY}"] > .copy`));
      await click(query('[data-field="area"] > .copy'));
      expect(copies).toEqual([
        [KEY, "a\nb\nc"],
        ["area", "performance"],
      ]);
    });

    describe("choices, relations, adding and clearing", () => {
      const stage = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
        kind: "packages",
        property: true,
        direction: "out",
        id,
        repository: "spec",
        shortId: `PKG-${id}`,
        title,
        accessible: true,
        targetState: "available",
        ...extra,
      });
      const withStages = (...stages: ReturnType<typeof stage>[]) => ({
        properties: { packages: stages.map(({ id }) => ({ id })), topic: "Wind" },
        more: { relations: stages as unknown as DataExportElement["relations"] },
      });
      const lines = (key: string): string[] => texts(`[data-field="${key}"] .line`);
      const rows = (key: string): string[] => texts(`[data-field="${key}"] .relation`);
      // (happy-dom answers a selection set on a focused editor with an event inside the update: let go first.)
      const blur = (): void => {
        act(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
      };
      const focusField = (key: string): void => {
        act(() => {
          field(key).focus();
        });
      };
      /** Takes the entry of the prompt with this name, as Enter in the minibuffer does. */
      const take = async (prompt: Prompt | undefined, name: string): Promise<void> => {
        const item = prompt?.items.find((candidate) => candidate.name === name);
        expect(item, name).toBeDefined();
        await act(async () => {
          item?.run();
          await Promise.resolve();
        });
        await flush();
      };
      const names = (prompt: Prompt | undefined): string[] => prompt?.items.map((item) => item.name) ?? [];
      /** `mountBoxes` with an answer of `element.update` that the test checks and a search for elements. */
      const mountValues = async (
        properties: Record<string, unknown>,
        more: Partial<DataExportElement> = {},
        draft?: Draft,
        update?: (input: Record<string, unknown>) => unknown,
      ) => {
        const mounted = await mountBoxes(properties, more, draft, update);
        return mounted;
      };

      it("[SR-104/AK1] shows a relation property as a box with its targets as links, and no empty one", async () => {
        const first = withStages(stage("p1", "Stufe 3"), stage("p2", "Stufe 4", { targetState: "missing" }));
        const { targets } = await mountValues(first.properties, first.more);
        expect(rows("packages")).toEqual(["PKG-p1 Stufe 3", "PKG-p2 Stufe 4 missing"]);
        expect(texts("h2")).toEqual([]);
        await click(query('[data-field="packages"] [role="link"]'));
        expect(targets).toEqual(["element:spec:p1"]);
        await mountValues({ topic: "Wind", packages: [] });
        expect(container.querySelector('[data-field="packages"]')).toBeNull();
      });

      it("[SR-104/AK2] Add property lists the properties the element lacks, by name; a text property gets an empty box with the caret in it, and no draft", async () => {
        const { controls, asked, drafts } = await mountValues({ topic: "Wind" });
        act(() => {
          controls().addProperty();
        });
        expect(asked.at(-1)?.label).toBe("Add property");
        expect(names(asked.at(-1))).toEqual([KEY, "effort", "synonyms", "Area", "Tags", "Package", "Parent"]);
        await take(asked.at(-1), KEY);
        // At its place in the order of the type, after topic.
        expect(
          [...container.querySelectorAll<HTMLElement>("[data-field]")].map((f) => f.dataset["field"]),
        ).toEqual(["Title", "Text", "topic", KEY]);
        expect(viewOf(KEY).state.doc.toString()).toBe("");
        expect(viewOf(KEY).hasFocus).toBe(true);
        expect(container.contains(document.activeElement)).toBe(true);
        expect(field(KEY).contains(document.activeElement)).toBe(true);
        // An empty box is no draft.
        expect(drafts.filter(([, kept]) => kept !== undefined)).toEqual([]);
      });

      it("[SR-104/AK2] saves what is typed into an added box with set, and the box is then the stored one", async () => {
        const { controls, asked, call, drafts } = await mountValues({ topic: "Wind" }, {}, undefined, () =>
          savedWith({ topic: "Wind", [KEY]: ["first"] }),
        );
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), KEY);
        blur();
        await typeIn(KEY, "first");
        expect(drafts.at(-1)?.[1]?.boxes?.get(KEY)).toEqual({ doc: "first", base: "" });
        await save(controls);
        expect(updates(call)).toEqual([{ ref: "uuid-1", set: { [KEY]: ["first"] } }]);
        expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
        expect(viewOf(KEY).state.doc.toString()).toBe("first");
      });

      it("[SR-104/AK2] Add property for a choice puts the empty box in the page with the focus on it, and opens the prompt with the choices at once", async () => {
        const { controls, asked, drafts } = await mountValues({ topic: "Wind" });
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), "Area");
        expect(field("area")).not.toBeNull();
        expect(lines("area")).toEqual([]);
        expect(document.activeElement).toBe(field("area"));
        expect(asked.at(-1)?.label).toBe("Area");
        expect(names(asked.at(-1))).toEqual(["Quality", "Performance", "Interface"]);
        // Escape on the prompt: the focus is on the new box, not on the element, and the box is empty.
        act(() => {
          asked.at(-1)?.cancel?.();
        });
        expect(document.activeElement).toBe(field("area"));
        expect(lines("area")).toEqual([]);
        expect(drafts.filter(([, kept]) => kept !== undefined)).toEqual([]);
      });

      it("[SR-104/AK2] Add property for a relation opens the prompt with the search of the allowed types at once", async () => {
        const { controls, asked } = await mountValues({ topic: "Wind" });
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), "Package");
        expect(asked.at(-1)?.label).toBe("Package");
        expect(asked.at(-1)?.items).toEqual([]);
        expect(asked.at(-1)?.find).toBeDefined();
        expect(document.activeElement).toBe(field("packages"));
      });

      it("[SR-104/AK2] drops an added box that was left empty when the element is saved", async () => {
        const { controls, asked } = await mountValues({ topic: "Wind" }, {}, undefined, () =>
          savedWith({ topic: "Wind!" }),
        );
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), "Area");
        await typeIn("topic", "!");
        await save(controls);
        expect(container.querySelector('[data-field="area"]')).toBeNull();
      });

      it("[SR-104/AK2] keeps an added box that was typed in while the save ran, as an added box with its input", async () => {
        let answer: (value: unknown) => void = () => undefined;
        const call = vi.fn((name: string, input: Record<string, unknown>) =>
          name === "element.update"
            ? new Promise((resolve) => {
                answer = resolve;
              })
            : Promise.resolve({
                ok: true,
                output:
                  name === "trace.neighbourhood"
                    ? alone(input)
                    : { element: withProperties({ topic: "Wind" }) },
              }),
        );
        await fresh();
        const { controls, asked, drafts } = await mount(asCall(call as never), 0, undefined, {
          properties: model,
        });
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), KEY);
        blur();
        await typeIn("topic", "!");
        await act(async () => {
          controls().save();
          await Promise.resolve();
        });
        await typeIn(KEY, "late");
        await act(async () => {
          answer({ ok: true, output: savedWith({ topic: "Wind!" }) });
          await Promise.resolve();
        });
        await flush();
        expect(viewOf(KEY).state.doc.toString()).toBe("late");
        expect(drafts.at(-1)?.[1]?.boxes?.get(KEY)).toEqual({ doc: "late", base: "" });
      });

      it("[SR-104/AK2] says that a read-only element has no property to add, and when there is none to add", async () => {
        const read = await mountValues({ topic: "Wind" }, { readOnly: true });
        act(() => {
          read.controls().addProperty();
        });
        expect(read.echoed.at(-1)).toBe("SR-036 Measure wind is read-only");
        expect(read.asked).toEqual([]);
        const none = await mountValues({ topic: "Wind" }, { type: "other" });
        act(() => {
          none.controls().addProperty();
        });
        expect(none.echoed.at(-1)).toBe("No property to add");
        expect(none.asked).toEqual([]);
        // A key stored empty is offered, because no box shows it.
        const empty = await mountValues({ topic: "", [KEY]: [] });
        act(() => {
          empty.controls().addProperty();
        });
        expect(names(empty.asked.at(-1)).slice(0, 2)).toEqual(["topic", KEY]);
      });

      it("[SR-104/AK3] Enter on a choice box asks with only the choices, and the one taken is the value of the box; the focus comes back to the box", async () => {
        const { asked, drafts, controls, call } = await mountValues(
          { area: "performance", topic: "t" },
          {},
          undefined,
          () => savedWith({ area: "quality", topic: "t" }),
        );
        focusField("area");
        await press(field("area"), "Enter");
        expect(asked.at(-1)?.label).toBe("Area");
        expect(asked.at(-1)?.text).toBeUndefined();
        // The one that is set first with its hint, then the others.
        expect(names(asked.at(-1))).toEqual(["Performance", "Quality", "Interface"]);
        expect(asked.at(-1)?.items.map((item) => item.hint)).toEqual(["set", "quality", "interface"]);
        focusField("topic");
        await take(asked.at(-1), "Quality");
        expect(lines("area")).toEqual(["quality"]);
        expect(document.activeElement).toBe(field("area"));
        expect(drafts.at(-1)?.[1]?.boxes?.get("area")).toEqual({ doc: "quality", base: "performance" });
        await save(controls);
        expect(updates(call)).toEqual([{ ref: "uuid-1", set: { area: "quality" } }]);
        expect(lines("area")).toEqual(["quality"]);
        expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      });

      it("[SR-104/AK3] shows exactly the choices of the metamodel and sets a value of a list one at a time, a set one is taken out", async () => {
        const { asked } = await mountValues({ tags: ["a"], topic: "t" });
        focusField("tags");
        await press(field("tags"), "Enter");
        expect(names(asked.at(-1))).toEqual(["Alpha", "Beta"]);
        await take(asked.at(-1), "Beta");
        expect(lines("tags")).toEqual(["a", "b"]);
        await press(field("tags"), "Enter");
        expect(asked.at(-1)?.items.map((item) => item.hint)).toEqual(["set", "set"]);
        await take(asked.at(-1), "Alpha");
        expect(lines("tags")).toEqual(["b"]);
      });

      it("Enter on a choice or relation box of a read-only element says so and asks nothing", async () => {
        const { asked, echoed } = await mountValues({ area: "performance" }, { readOnly: true });
        focusField("area");
        await press(field("area"), "Enter");
        expect(asked).toEqual([]);
        expect(echoed.at(-1)).toBe("SR-036 Measure wind is read-only");
      });

      it("Enter on a relation box asks with the targets that are set and the elements of the allowed types", async () => {
        const first = withStages(stage("p1", "Stufe 3"));
        const { asked, call } = await mountValues(first.properties, first.more);
        call.mockImplementation((name: string, input: Record<string, unknown>) =>
          Promise.resolve({
            ok: true,
            output:
              name === "element.search"
                ? {
                    hits: [
                      {
                        id: "p2",
                        repository: "spec",
                        shortId: "PKG-p2",
                        type: "package",
                        title: "Stufe 4",
                        score: 1,
                        fields: ["title"],
                        terms: ["stufe"],
                      },
                    ],
                    total: 1,
                  }
                : name === "trace.neighbourhood"
                  ? alone(input)
                  : { element: withProperties(first.properties, first.more) },
          }),
        );
        focusField("packages");
        await press(field("packages"), "Enter");
        const prompt = asked.at(-1);
        expect(prompt?.label).toBe("Package");
        expect(names(prompt)).toEqual(["PKG-p1 Stufe 3"]);
        expect(prompt?.items[0]?.hint).toBe("set");
        const found = await prompt?.find?.("stufe");
        expect(call).toHaveBeenCalledWith("element.search", {
          query: "stufe",
          selection: { where: { type: ["package"] } },
          fields: ["id", "title"],
          limit: 20,
        });
        expect(found?.map((choice) => choice.name)).toEqual(["PKG-p2 Stufe 4"]);
        await take({ label: "x", items: found ?? [] }, "PKG-p2 Stufe 4");
        expect(rows("packages")).toEqual(["PKG-p1 Stufe 3", "PKG-p2 Stufe 4"]);
        expect(document.activeElement).toBe(field("packages"));
      });

      it("keeps a relation box read-only and says so when the file stores an item the output gives no target for", async () => {
        const first = withStages(stage("p1", "Stufe 3"));
        const { asked, controls, call, echoed } = await mountValues(
          { ...first.properties, packages: [{ id: "p1" }, "not a reference"] },
          first.more,
        );
        const prompts = asked.length;
        focusField("packages");
        expect(echoed.at(-1)).toBe("packages has a target that cannot be read: edit it in the file");
        echoed.length = 0;
        await press(field("packages"), "Enter");
        expect(asked.length).toBe(prompts);
        expect(echoed.at(-1)).toBe("packages has a target that cannot be read: edit it in the file");
        echoed.length = 0;
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe("packages has a target that cannot be read: edit it in the file");
        expect(rows("packages")).toEqual(["PKG-p1 Stufe 3"]);
        await save(controls);
        expect(updates(call)).toEqual([]);
      });

      it("saves the targets of a relation as id and repository, the stored ones too, and takes one out with the prompt", async () => {
        const first = withStages(stage("p1", "Stufe 3"), stage("p2", "Stufe 4"));
        const { asked, controls, call } = await mountValues(first.properties, first.more, undefined, () =>
          savedWith({ topic: "Wind" }),
        );
        focusField("packages");
        await press(field("packages"), "Enter");
        await take(asked.at(-1), "PKG-p1 Stufe 3");
        expect(rows("packages")).toEqual(["PKG-p2 Stufe 4"]);
        await save(controls);
        expect(updates(call)).toEqual([
          { ref: "uuid-1", set: { packages: [{ id: "p2", repository: "spec" }] } },
        ]);
      });

      it("a single relation is replaced by the element taken", async () => {
        const single = {
          properties: { parent: [{ id: "n1" }], topic: "t" },
          more: {
            relations: [stage("n1", "Need", { kind: "parent" })] as unknown as DataExportElement["relations"],
          },
        };
        const { asked, controls, call } = await mountValues(single.properties, single.more, undefined, () =>
          savedWith({ topic: "t" }),
        );
        call.mockImplementation((name: string, input: Record<string, unknown>) =>
          Promise.resolve({
            ok: true,
            output:
              name === "element.search"
                ? {
                    hits: [
                      {
                        id: "n2",
                        repository: "vault",
                        shortId: "N-2",
                        type: "need",
                        title: "Other",
                        score: 1,
                        fields: ["title"],
                        terms: [],
                      },
                    ],
                    total: 1,
                  }
                : name === "trace.neighbourhood"
                  ? alone(input)
                  : name === "element.update"
                    ? savedWith({ topic: "t" })
                    : { element: withProperties(single.properties, single.more) },
          }),
        );
        focusField("parent");
        await press(field("parent"), "Enter");
        // No target type: the search is not limited.
        const found = await asked.at(-1)?.find?.("other");
        expect(call).toHaveBeenCalledWith("element.search", {
          query: "other",
          fields: ["id", "title"],
          limit: 20,
        });
        await take({ label: "x", items: found ?? [] }, "N-2 Other");
        expect(rows("parent")).toEqual(["N-2 Other"]);
        await save(controls);
        expect(updates(call)).toEqual([
          { ref: "uuid-1", set: { parent: { id: "n2", repository: "vault" } } },
        ]);
      });

      it("has no search when the property may point at no type", async () => {
        const none = new Map(model);
        none.set(
          "system-requirement",
          new Map([
            ["packages", { kind: "relation" as const, many: true, markdown: false, targetTypes: [] }],
            ["topic", { kind: "text" as const, many: false, markdown: false }],
          ]),
        );
        const first = withStages(stage("p1", "Stufe 3"));
        const call = fakeCall({
          "element.get": () => ({ element: withProperties(first.properties, first.more) }),
        });
        await fresh();
        const { asked } = await mount(asCall(call), 0, undefined, { properties: none });
        focusField("packages");
        await press(field("packages"), "Enter");
        expect(asked.at(-1)?.find).toBeUndefined();
        expect(names(asked.at(-1))).toEqual(["PKG-p1 Stufe 3"]);
      });

      it("[SR-104/AK4] Clear property empties the box with the cursor, for a choice, a relation and a text, and the properties are removed when it is saved", async () => {
        const first = withStages(stage("p1", "Stufe 3"));
        const { controls, call, drafts } = await mountValues(
          { ...first.properties, area: "performance", [KEY]: ["a", "b"] },
          first.more,
          undefined,
          (input) => {
            expect(input).toEqual({ ref: "uuid-1", unset: ["packages", "area", KEY] });
            return savedWith({ topic: "Wind" });
          },
        );
        focusField("area");
        act(() => {
          controls().clearProperty();
        });
        expect(lines("area")).toEqual([]);
        focusField("packages");
        act(() => {
          controls().clearProperty();
        });
        expect(rows("packages")).toEqual([]);
        act(() => {
          field(KEY).focus();
        });
        act(() => {
          controls().clearProperty();
        });
        expect(viewOf(KEY).state.doc.toString()).toBe("");
        // The boxes stay, empty, until the save.
        expect(container.querySelector('[data-field="area"]')).not.toBeNull();
        expect(drafts.at(-1)?.[1]?.boxes?.get("area")).toEqual({ doc: "", base: "performance" });
        await save(controls);
        expect(updates(call)).toHaveLength(1);
        for (const key of ["area", "packages", KEY]) {
          expect(container.querySelector(`[data-field="${key}"]`), key).toBeNull();
        }
        expect(drafts.at(-1)).toEqual(["element:spec:uuid-1", undefined]);
      });

      it("[SR-104/AK4] Clear property from the command prompt empties the box the cursor was in", async () => {
        const { controls } = await mountValues({ area: "performance" });
        focusField("area");
        // The command prompt has the focus now.
        const input = document.createElement("input");
        input.id = "prompt-input";
        document.body.append(input);
        act(() => {
          input.focus();
        });
        act(() => {
          controls().clearProperty();
        });
        input.remove();
        expect(lines("area")).toEqual([]);
        expect(document.activeElement).toBe(field("area"));
      });

      it("empties a text box so that Ctrl/Cmd+Z brings the value back", async () => {
        const { controls } = await mountValues({ topic: "Wind" });
        focusField("topic");
        act(() => {
          controls().clearProperty();
        });
        expect(viewOf("topic").state.doc.toString()).toBe("");
        await act(async () => {
          undo(viewOf("topic"));
          await Promise.resolve();
        });
        expect(viewOf("topic").state.doc.toString()).toBe("Wind");
      });

      it("Clear property says why it cannot clear: no box, a read-only element, a property the type does not know, a value with a line break", async () => {
        const { controls, echoed } = await mountValues({ topic: "Wind", unknown: "x", [KEY]: ["one\ntwo"] });
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe("Put the cursor in a property box to clear it");
        focusField("Title");
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe("Put the cursor in a property box to clear it");
        focusField("unknown");
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe("unknown is not a property of this type: edit it in the file");
        focusField(KEY);
        act(() => {
          controls().clearProperty();
        });
        expect(echoed.at(-1)).toBe(`${KEY} has a value with a line break: edit it in the file`);
        expect(viewOf(KEY).state.doc.toString()).toBe("one\ntwo");
        const locked = await mountValues({ topic: "Wind" }, { readOnly: true });
        focusField("topic");
        act(() => {
          locked.controls().clearProperty();
        });
        expect(locked.echoed.at(-1)).toBe("SR-036 Measure wind is read-only");
      });

      it("does not clear a box with Backspace or Delete on the box itself: only the action does (no undo for it)", async () => {
        await mountValues({ area: "performance" });
        focusField("area");
        await press(field("area"), "Backspace");
        await press(field("area"), "Delete");
        expect(lines("area")).toEqual(["performance"]);
      });

      it("keeps the choices and the added boxes of a draft, shows them, and compares them with the file", async () => {
        const draft: Draft = {
          text: "Text",
          base: "Text",
          boxes: new Map([
            ["area", { doc: "quality", base: "performance" }],
            ["effort", { doc: "3", base: "" }],
            ["tags", { doc: "a\nb", base: "" }],
            // A property the type does not have (the metamodel changed meanwhile) has no box to come back to.
            ["nothing", { doc: "x", base: "" }],
          ]),
        };
        const { echoed, drafts } = await mountValues({ area: "performance", topic: "t" }, {}, draft);
        expect(lines("area")).toEqual(["quality"]);
        expect(lines("tags")).toEqual(["a", "b"]);
        expect(viewOf("effort").state.doc.toString()).toBe("3");
        expect(echoed).toEqual([]);
        expect(drafts).toEqual([]);
        // The added boxes are where the type puts them.
        expect(
          [...container.querySelectorAll<HTMLElement>("[data-field]")].map((f) => f.dataset["field"]),
        ).toEqual(["Title", "Text", "effort", "area", "topic", "tags"]);
      });

      it("lets a choice box without input follow the file on a reload, and keeps one with input and says so", async () => {
        const { again, change, echoed } = await mountValues({ area: "performance", tags: ["a"] });
        focusField("area");
        await press(field("area"), "Enter");
        change({ area: "interface", tags: ["b"] });
        await again(1);
        // The box without input follows the file at once.
        expect(lines("tags")).toEqual(["b"]);
        expect(lines("area")).toEqual(["interface"]);
        expect(echoed).toEqual([]);
      });

      it("keeps the choice that was set in the minibuffer when the file changed, and says so", async () => {
        const { again, change, echoed, asked } = await mountValues({ area: "performance", tags: ["a"] });
        focusField("area");
        await press(field("area"), "Enter");
        await take(asked.at(-1), "Quality");
        change({ area: "interface", tags: ["b"] });
        await again(1);
        expect(lines("area")).toEqual(["quality"]);
        expect(lines("tags")).toEqual(["b"]);
        expect(echoed.at(-1)).toBe(
          'SR-036 Measure wind changed on disk. Resolve with "Resolve change on disk"',
        );
        // The block shows the name of the file's choice, in heavier weight: the input lacks it.
        expect(query('[data-on-disk="area"] mark').textContent).toBe("Interface");
        // A property that left the file keeps its box while it has input.
        change({ tags: ["b"] });
        await again(2);
        expect(lines("area")).toEqual(["quality"]);
        expect(query('[data-on-disk="area"]').textContent).toBe("On disk(empty)");
      });

      it("keeps an added box through a reload while the file has no value for it, and shows the stored value once it has", async () => {
        const { again, change, controls, asked } = await mountValues({ topic: "Wind" });
        act(() => {
          controls().addProperty();
        });
        await take(asked.at(-1), "Tags");
        await again(1);
        expect(container.querySelector('[data-field="tags"]')).not.toBeNull();
        change({ topic: "Wind", tags: ["a"] });
        await again(2);
        expect(lines("tags")).toEqual(["a"]);
      });

      it("Follow reference in a relation box opens the focused target, else the first one; a box with none to open says so", async () => {
        const first = withStages(stage("p1", "Stufe 3"), stage("p2", "Stufe 4"));
        const { controls, targets } = await mountValues(first.properties, first.more);
        focusField("packages");
        act(() => {
          controls().follow();
        });
        const links = [...container.querySelectorAll<HTMLElement>('[data-field="packages"] [role="link"]')];
        act(() => {
          links[1]?.focus();
        });
        act(() => {
          controls().follow();
        });
        expect(targets).toEqual(["element:spec:p1", "element:spec:p2"]);
        const gone = withStages(stage("p1", "Stufe 3", { targetState: "missing" }));
        const other = await mountValues(gone.properties, gone.more);
        focusField("packages");
        act(() => {
          other.controls().follow();
        });
        expect(other.targets).toEqual([]);
        expect(other.echoed.at(-1)).toBe("No element reference in packages");
        // A relation property the type does not know is a read-only box with links, and Follow reference opens its target.
        const unknown = withStages(stage("x1", "Fremd", { kind: "stray" }));
        const stray = await mountValues({ stray: [{ id: "x1" }] }, unknown.more);
        expect(stray.asked).toEqual([]);
        focusField("stray");
        act(() => {
          stray.controls().follow();
        });
        expect(stray.targets).toEqual(["element:spec:x1"]);
      });

      it("copies the targets of a relation box and the keys of a choice, the unsaved input included", async () => {
        const first = withStages(stage("p1", "Stufe 3"), stage("p2", "Stufe 4"));
        const { copies, asked } = await mountValues({ ...first.properties, tags: ["a"] }, first.more);
        focusField("tags");
        await press(field("tags"), "Enter");
        await take(asked.at(-1), "Beta");
        focusField("packages");
        await press(field("packages"), "Enter");
        await take(asked.at(-1), "PKG-p1 Stufe 3");
        await click(query('[data-field="tags"] > .copy'));
        await click(query('[data-field="packages"] > .copy'));
        await press(field("packages"), "Enter");
        expect(copies).toEqual([
          ["tags", "a\nb"],
          ["packages", "PKG-p2 Stufe 4"],
        ]);
      });
    });

    describe("the list of the elements with a value (SR-132)", () => {
      const facetsOf = (topic: string) => ({
        total: 1,
        types: [{ key: "system-requirement", name: "System Requirement", count: 1 }],
        statuses: [{ key: "draft", count: 1 }],
        properties: [
          { key: KEY, name: "Acceptance criteria", kind: "text", count: 1, missing: 0, distinct: 2 },
          {
            key: "topic",
            name: "Topic",
            kind: "text",
            count: 1,
            missing: 0,
            distinct: 1,
            values: [{ value: topic, count: 1 }],
          },
          {
            key: "synonyms",
            name: "Synonyms",
            kind: "text",
            count: 1,
            missing: 0,
            distinct: 2,
            values: [
              { value: "gust", count: 1 },
              { value: "breeze", count: 1 },
            ],
          },
          {
            key: "area",
            name: "Area",
            kind: "choice",
            count: 1,
            missing: 0,
            distinct: 1,
            values: [{ value: "quality", count: 1, name: "Quality" }],
          },
          {
            key: "packages",
            name: "Package",
            kind: "relation",
            count: 1,
            missing: 0,
            distinct: 2,
            values: [
              { value: "PKG-p1", count: 1, title: "Stufe 3" },
              { value: "PKG-p2", count: 1, title: "Stufe 4", identifier: "Stufe-4" },
            ],
          },
        ],
        incomplete: false,
      });
      const target = (id: string, title: string) => ({
        kind: "packages",
        property: true,
        direction: "out",
        id,
        repository: "spec",
        shortId: `PKG-${id}`,
        title,
        accessible: true,
        targetState: "available",
      });
      const PROPERTIES = {
        topic: "Wind",
        [KEY]: ["first", "second"],
        synonyms: ["gust", "breeze"],
        area: "quality",
        packages: [{ id: "p1" }, { id: "p2" }],
      };
      const RELATIONS = [
        target("p1", "Stufe 3"),
        target("p2", "Stufe 4"),
      ] as unknown as DataExportElement["relations"];
      /** The element with every kind of box; `facets` answers `element.facets`, `update` a save. */
      const mountListing = async (
        facets: (input: Record<string, unknown>) => unknown = () => facetsOf("Wind"),
        update?: (input: Record<string, unknown>) => unknown,
      ) => {
        let properties: Record<string, unknown> = PROPERTIES;
        const call = fakeCall({
          "element.get": () => ({ element: withProperties(properties, { relations: RELATIONS }) }),
          "element.facets": facets,
          ...(update === undefined ? {} : { "element.update": update }),
        });
        await fresh();
        const mounted = await mount(asCall(call), 0, undefined, { properties: model });
        await flush();
        return {
          ...mounted,
          call,
          change: (next: Record<string, unknown>) => {
            properties = next;
          },
        };
      };
      const listValue = async (controls: () => ElementControls): Promise<void> => {
        await act(async () => {
          controls().listValue();
          await Promise.resolve();
        });
        await flush();
        await flush();
      };
      const opened = (key: string, shown: string, value: string) => ({
        type: "open",
        buffer: filteredList([propertyStep(key, shown, value)]),
      });
      const facetCalls = (call: ReturnType<typeof fakeCall>) =>
        call.mock.calls.filter(([name]) => name === "element.facets").map(([, input]) => input);
      const blurAll = (): void => {
        act(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
      };

      it("[SR-132/AK1] the key on the topic box opens the list of the elements with that topic", async () => {
        const { controls, dispatched, call } = await mountListing();
        await caretAt(viewOf("topic"), 0);
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("topic", "Wind", "Wind"));
        expect(facetCalls(call)).toEqual([{ selection: { ids: ["SR-000001"] } }]);
        blurAll();
      });

      it("[SR-132/AK2] a list property opens the value on the line with the caret; the box as a whole asks among its values", async () => {
        const { controls, dispatched, asked } = await mountListing();
        await caretAt(viewOf("synonyms"), "gust\nbr".length);
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("synonyms", "breeze", "breeze"));
        blurAll();
        act(() => {
          field("synonyms").focus();
        });
        await listValue(controls);
        expect(asked.at(-1)?.label).toBe("Elements with");
        expect(asked.at(-1)?.items.map((item) => item.name)).toEqual(["synonyms: gust", "synonyms: breeze"]);
        act(() => {
          asked.at(-1)?.items[0]?.run();
        });
        expect(dispatched.at(-1)).toEqual(opened("synonyms", "gust", "gust"));
      });

      it("[SR-132/AK2] a choice box opens the list of its value", async () => {
        const { controls, dispatched } = await mountListing();
        act(() => {
          field("area").focus();
        });
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("area", "quality", "quality"));
      });

      it("[SR-132/AK3] the focused target of a relation box opens the list of the elements with that target", async () => {
        const { controls, dispatched } = await mountListing();
        const links = [...container.querySelectorAll<HTMLElement>('[data-field="packages"] [role="link"]')];
        act(() => {
          links[1]?.focus();
        });
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("packages", "Stufe 4", "PKG-p2"));
      });

      it("[SR-132/AK3] Enter with a modifier on a target link is left to the window; plain Enter still opens the target", async () => {
        const { targets } = await mountListing();
        const link = query('[data-field="packages"] [role="link"]');
        const key = new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        act(() => {
          link.dispatchEvent(key);
        });
        expect(key.defaultPrevented).toBe(false);
        expect(targets).toEqual([]);
        await press(link, "Enter");
        expect(targets).toEqual(["element:spec:p1"]);
      });

      it("[SR-132/AK4] on the acceptance criteria the key asks among the other values, never the criteria", async () => {
        const { controls, dispatched, asked } = await mountListing();
        await caretAt(viewOf(KEY), 0);
        await listValue(controls);
        expect(dispatched).toEqual([]);
        const prompt = asked.at(-1);
        expect(prompt?.items.map((item) => item.name)).toEqual([
          "status: draft",
          "type: system-requirement",
          "topic: Wind",
          "synonyms: gust",
          "synonyms: breeze",
          "area: quality",
          "packages: PKG-p1 Stufe 3",
          "packages: Stufe-4 Stufe 4",
        ]);
        expect(prompt?.items.map((item) => item.hint)).toEqual([
          undefined,
          "System Requirement",
          undefined,
          undefined,
          undefined,
          "Quality",
          undefined,
          undefined,
        ]);
        blurAll();
        // On no box (the title) it asks the same.
        act(() => {
          field("Title").focus();
        });
        await listValue(controls);
        expect(asked.at(-1)?.items).toHaveLength(8);
      });

      it("[SR-132/AK1] from the command prompt it lists the value the cursor was on before the prompt opened", async () => {
        const { controls, dispatched } = await mountListing();
        // The second target of a box with two: once the prompt has the focus, only the snapshot knows it.
        const links = [...container.querySelectorAll<HTMLElement>('[data-field="packages"] [role="link"]')];
        act(() => {
          links[1]?.focus();
        });
        act(() => {
          controls().prompting();
        });
        const input = document.createElement("input");
        input.id = "prompt-input";
        document.body.append(input);
        act(() => {
          input.focus();
        });
        // A prompt over the prompt keeps what the cursor was on.
        act(() => {
          controls().prompting();
        });
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("packages", "Stufe 4", "PKG-p2"));
        // The caret on the second line of a list property, likewise.
        await caretAt(viewOf("synonyms"), "gust\nbr".length);
        act(() => {
          controls().prompting();
        });
        act(() => {
          input.focus();
        });
        await listValue(controls);
        input.remove();
        expect(dispatched.at(-1)).toEqual(opened("synonyms", "breeze", "breeze"));
      });

      it("[SR-132/AK1] typed input is saved before the list opens, so the typed value is the one listed", async () => {
        let saved = "Wind";
        const { controls, dispatched, call } = await mountListing(
          () => facetsOf(saved),
          (input) => {
            saved = "Gust";
            const next = { ...PROPERTIES, topic: "Gust" };
            expect(input).toMatchObject({ set: { topic: "Gust" } });
            return {
              element: withProperties(next, { relations: RELATIONS }),
              files: ["a.md"],
              affected: 0,
            };
          },
        );
        await replaceIn("topic", "Gust");
        await caretAt(viewOf("topic"), 4);
        await listValue(controls);
        expect(dispatched.at(-1)).toEqual(opened("topic", "Gust", "Gust"));
        const names = call.mock.calls.map(([name]) => name);
        expect(names.indexOf("element.update")).toBeLessThan(names.lastIndexOf("element.facets"));
        blurAll();
      });

      it("asks for the facets once per values of the element: not after a reload with the same values, again when they changed", async () => {
        const { again, change, call } = await mountListing();
        expect(facetCalls(call)).toHaveLength(1);
        await again(1);
        await flush();
        expect(facetCalls(call)).toHaveLength(1);
        change({ ...PROPERTIES, topic: "Gust" });
        await again(2);
        await flush();
        expect(facetCalls(call)).toHaveLength(2);
      });

      it("says why when the facets fail, and when no value lists elements", async () => {
        const failing = await mountListing(() => new Error("boom"));
        await listValue(failing.controls);
        expect(failing.echoed.at(-1)).toBe("boom");
        // A failed answer is not kept: each press asks again.
        expect(facetCalls(failing.call)).toHaveLength(2);
        await listValue(failing.controls);
        expect(facetCalls(failing.call)).toHaveLength(3);
        const none = await mountListing(() => ({
          total: 1,
          types: [],
          statuses: [],
          properties: [],
          incomplete: false,
        }));
        await listValue(none.controls);
        expect(none.echoed.at(-1)).toBe("No value of SR-036 Measure wind lists elements");
        expect(none.dispatched).toEqual([]);
      });
    });
  });

  it("reads again after an error, with no editor to ask", async () => {
    let fail = true;
    let text = "first";
    const call = fakeCall({
      "element.get": () => (fail ? new Error("busy") : { element: read({ text }) }),
    });
    const { again, echoed } = await mount(asCall(call));
    expect(container.querySelector(".cm-editor")).toBeNull();
    fail = false;
    await again(1);
    expect(editorView().state.doc.toString()).toBe("first");
    // A failed read after the element was shown keeps it with its editor, and says why.
    fail = true;
    const editor = query(".cm-editor");
    await again(2);
    expect(container.querySelector(".quiet")).toBeNull();
    expect(query(".cm-editor")).toBe(editor);
    expect(editorView().state.doc.toString()).toBe("first");
    expect(echoed.at(-1)).toBe("busy");
    fail = false;
    text = "other";
    await again(3);
    expect(editorView().state.doc.toString()).toBe("other");
  });

  it("opens a relation target that is available, on a click and on Enter", async () => {
    const { targets } = await mount(asCall(fakeCall({ "element.get": () => ({ element: read() }) })));
    const links = [...container.querySelectorAll<HTMLElement>('[role="link"]')];
    expect(links.map((link) => link.textContent)).toEqual(["p Stage 3", "N-1 Need", "SR-000009 Child"]);
    await click(nth(links, 1));
    await press(nth(links, 2), "Enter");
    await press(nth(links, 2), "x");
    await click(nth(links, 0));
    expect(targets).toEqual(["element:spec:n1", "element:platform:r1", "element:spec:p"]);
  });

  it("[SR-132/AK3] Follow reference on a focused link of a relation group opens that link, not the reference at the caret of the text", async () => {
    const { controls, targets, opened } = await mount(
      asCall(fakeCall({ "element.get": () => ({ element: read({ text: "[x](logreq:uuid-2)" }) }) })),
    );
    // The caret of the text sits on an inline reference.
    act(() => {
      editorView().dispatch({ selection: { anchor: 2 } });
    });
    const links = [...container.querySelectorAll<HTMLElement>('[role="link"]')];
    for (const link of [nth(links, 1), nth(links, 2)]) {
      act(() => {
        link.focus();
      });
      // The link leaves Ctrl+Enter to the window, which runs "Follow reference".
      const key = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        link.dispatchEvent(key);
      });
      expect(key.defaultPrevented).toBe(false);
      act(() => {
        controls().follow();
      });
    }
    expect(targets).toEqual(["element:spec:n1", "element:platform:r1"]);
    expect(opened).toEqual([]);
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
    // Each time the element and its parents; the facets of its values once (SR-132): its values are the same.
    expect(call.mock.calls.map(([name]) => name)).toEqual([
      "element.get",
      "trace.neighbourhood",
      "element.facets",
      "element.get",
      "trace.neighbourhood",
    ]);
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
        sort: DEFAULT_SORT,
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

    it("[SR-114/AK3] reports the element with the count of its elements for the modeline, once they are there", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(rowsOf(1, 4), 3, true),
      });
      const { data } = await mount(asCall(call), 0, undefined, { packages: model });
      // The buffer still reports the element; the count comes with it when the list has it.
      expect(data.map(([, loaded]) => loaded?.kind)).toEqual([undefined, "element", "element"]);
      expect(data.map(([, loaded]) => (loaded?.kind === "element" ? loaded.members : undefined))).toEqual([
        undefined,
        undefined,
        { total: 3, incomplete: true },
      ]);
    });

    it("[SR-114/AK3] reports no count for an element that is no package", async () => {
      const call = fakeCall({ "element.get": () => ({ element: page({ type: "need" }) }) });
      const { data } = await mount(asCall(call), 0, undefined, { packages: model });
      expect(data.map(([, loaded]) => loaded?.kind)).toEqual([undefined, "element"]);
      expect(data.every(([, loaded]) => loaded?.kind !== "element" || loaded.members === undefined)).toBe(
        true,
      );
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
      expect(call.mock.calls.map(([name]) => name)).toEqual([
        "element.get",
        "trace.neighbourhood",
        "element.facets",
      ]);
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
      expect(pkg.mock.calls.map(([name]) => name)).toEqual([
        "element.get",
        "trace.neighbourhood",
        "element.facets",
      ]);
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

    it("Down on a focused box of the page goes into the elements as well", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page({ properties: { topic: "Wind" } }) }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      await act(async () => {
        query('[data-field="topic"]').focus();
        await Promise.resolve();
      });
      await press(query('[data-field="topic"]'), "ArrowDown");
      expect(document.activeElement).toBe(query(".members .list"));
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
