// @vitest-environment happy-dom
// The search prompt of Ctrl/Cmd+Shift+F (SR-183): it shows the first hits of the search buffer while the
// text is typed, as many as fit the card, each as the search buffer shows it, none chosen; Enter opens a
// chosen hit, else the search buffer.
import "../../../../scripts/test-support/dom-selection.mjs";
import type { ElementSearchOutput } from "@reqseq/core";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionContext, Prompt } from "./actions.js";
import { ACTIONS, CARD_LINES, fittingRows, nameMarks } from "./actions.js";
import type { BufferAction } from "./buffers.js";
import { elementBufferOf, searchBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { Minibuffer } from "./Minibuffer.js";
import type { Row } from "./rows.js";
import { searchRows } from "./rows.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hit = ElementSearchOutput["hits"][number];

/** A hit of `element.search`: `n` in its ID; a snippet in the text unless `snippet` is false. */
const hit = (n: number, extra: Partial<Hit> = {}, snippet = true): Hit => ({
  id: `u${String(n)}`,
  repository: "spec",
  shortId: `SR-00000${String(n)}`,
  identifier: `SR-${String(n)}`,
  title: `Gust ${String(n)}`,
  status: "draft",
  type: "system-requirement",
  score: 10 - n,
  fields: ["title"],
  terms: ["gust"],
  titleMarks: [{ start: 0, end: 4 }],
  ...(snippet
    ? { snippet: { field: "text", text: `The gust ${String(n)} blows.`, marks: [{ start: 4, end: 8 }] } }
    : {}),
  ...extra,
});

const output = (hits: Hit[]): ElementSearchOutput => ({ hits, total: hits.length, incomplete: false });

/** The search prompt over a call that answers `element.search` with `answer` (an Error fails it). */
const searchPrompt = (answer: (input: Record<string, unknown>) => ElementSearchOutput | Error) => {
  const dispatched: BufferAction[] = [];
  const echoed: string[] = [];
  const asked: Prompt[] = [];
  const call = vi.fn((_: string, input: Record<string, unknown>) => {
    const out = answer(input);
    return Promise.resolve(
      out instanceof Error
        ? { ok: false, code: "x.failed", message: out.message }
        : { ok: true, output: out },
    );
  });
  const context = {
    workspace: true,
    buffers: [],
    call: call as unknown as Call,
    dispatch: (action: BufferAction) => dispatched.push(action),
    ask: (prompt: Prompt) => asked.push(prompt),
    echo: (message: string) => echoed.push(message),
  } as unknown as ActionContext;
  ACTIONS.find((action) => action.id === "search")?.run(context);
  const prompt = asked[0];
  if (prompt === undefined) {
    throw new Error("no prompt");
  }
  return { prompt, call, dispatched, echoed };
};

describe("the hits that fit the card", () => {
  const rows = (hits: Hit[]): Row[] => searchRows(output(hits));

  it("[SR-183/AK1] takes as many hits as the card's lines hold: two for a hit with a snippet, one without", () => {
    const ten = Array.from({ length: CARD_LINES }, (_, at) => hit(at + 1));
    expect(fittingRows(rows(ten)).map((row) => row.label)).toEqual([
      "SR-000001 (SR-1)",
      "SR-000002 (SR-2)",
      "SR-000003 (SR-3)",
      "SR-000004 (SR-4)",
      "SR-000005 (SR-5)",
    ]);
    const plain = Array.from({ length: CARD_LINES + 2 }, (_, at) => hit(at + 1, {}, false));
    expect(fittingRows(rows(plain))).toHaveLength(CARD_LINES);
    // A hit of two lines that would pass the last line is left out, with the hits after it.
    const mixed = [hit(1, {}, false), hit(2), hit(3), hit(4), hit(5), hit(6, {}, false)];
    expect(fittingRows(rows(mixed), 8).map((row) => row.label)).toEqual([
      "SR-000001 (SR-1)",
      "SR-000002 (SR-2)",
      "SR-000003 (SR-3)",
      "SR-000004 (SR-4)",
    ]);
    // Fewer hits: all of them.
    expect(fittingRows(rows([hit(1), hit(2)]))).toHaveLength(2);
  });

  it("[SR-183/AK3] marks the ID when it matched and the title's words where core marked them", () => {
    const [row] = rows([hit(7, { fields: ["id", "title"], titleMarks: [{ start: 0, end: 4 }] })]);
    // Only the part of the ID that matched (SR-084 AK4): the identifier, or the short ID.
    expect(row === undefined ? [] : nameMarks(row, "SR-7 gust")).toEqual([
      [11, 15],
      [17, 21],
    ]);
    expect(row === undefined ? [] : nameMarks(row, "000007")).toEqual([
      [0, 9],
      [17, 21],
    ]);
    // A title with spaces before it: core marks the title as it is, the name shows it without them.
    const [spaced] = rows([hit(8, { title: "  Gust", titleMarks: [{ start: 2, end: 6 }] })]);
    expect(spaced === undefined ? [] : nameMarks(spaced, "gust")).toEqual([[17, 21]]);
    // A title that is the ID: the name is the ID alone, and no title mark.
    const [same] = rows([hit(9, { identifier: "Later", title: "Later", fields: ["id"], titleMarks: [] })]);
    expect(same === undefined ? [] : nameMarks(same, "later")).toEqual([[11, 16]]);
  });
});

describe("the search prompt", () => {
  it("[SR-183/AK2] asks element.search as the search buffer does and keeps its order: the first hits of the search buffer", async () => {
    const hits = [hit(3), hit(1, {}, false), hit(2)];
    const { prompt, call, dispatched } = searchPrompt(() => output(hits));
    expect(prompt.label).toBe("Search");
    expect(prompt.items).toEqual([]);
    expect(prompt.preview).toBe(true);
    const found = (await prompt.find?.("  gust ")) ?? [];
    // The query of the search buffer (`searchBuffer` trims it too), no fields, so the order is relevance.
    expect(call).toHaveBeenCalledWith("element.search", { query: "gust", limit: CARD_LINES });
    expect(searchBuffer("gust").query).toBe("gust");
    expect(found.map((choice) => [choice.name, choice.hint, choice.snippet?.text])).toEqual([
      ["SR-000003 (SR-3) Gust 3", "draft", "The gust 3 blows."],
      ["SR-000001 (SR-1) Gust 1", "draft", undefined],
      ["SR-000002 (SR-2) Gust 2", "draft", "The gust 2 blows."],
    ]);
    found[0]?.run();
    expect(dispatched).toEqual([{ type: "open", buffer: elementBufferOf(hit(3)) }]);
  });

  it("echoes why the search failed and previews nothing; text still opens the search buffer", async () => {
    const { prompt, echoed, dispatched } = searchPrompt(() => new Error("The search index is not ready"));
    expect(await prompt.find?.("gust")).toEqual([]);
    expect(echoed).toEqual(["The search index is not ready"]);
    const { status: _, ...unset } = hit(1);
    const noStatus = searchPrompt(() => output([unset]));
    expect((await noStatus.prompt.find?.("gust"))?.[0]?.hint).toBeUndefined();
    prompt.text?.("  wind speed ");
    prompt.text?.("   ");
    expect(dispatched).toEqual([{ type: "open", buffer: searchBuffer("wind speed") }]);
  });
});

describe("the search prompt in the minibuffer", () => {
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
  const input = (): HTMLInputElement => {
    const found = container.querySelector("input");
    if (found === null) {
      throw new Error("no input");
    }
    return found;
  };
  const type = async (value: string): Promise<void> => {
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      const setValue = Reflect.get(descriptor ?? {}, "set") as (
        this: HTMLInputElement,
        value: string,
      ) => void;
      setValue.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
  };
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<void> => {
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
      await Promise.resolve();
    });
    await flush();
  };
  const text = (element: Element, selector: string): string | undefined =>
    element.querySelector(selector)?.textContent ?? undefined;
  const options = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  const chosen = (): string[] =>
    options()
      .filter((option) => option.getAttribute("aria-selected") === "true")
      .map((option) => option.querySelector(".name")?.textContent ?? "");

  /** The minibuffer asking the search prompt; `answer` gives core's hits. */
  let serial = 0;
  const mount = async (answer: (input: Record<string, unknown>) => ElementSearchOutput | Error) => {
    const search = searchPrompt(answer);
    serial += 1;
    const closed = vi.fn();
    await act(async () => {
      root.render(
        createElement(Minibuffer, {
          echo: "",
          prompt: { serial, prompt: search.prompt },
          onCommand: vi.fn(),
          onClose: closed,
        }),
      );
      await Promise.resolve();
    });
    await flush();
    return { ...search, closed };
  };

  it("[SR-183/AK1] shows the hits that fit while typing, none of them chosen", async () => {
    await mount(() => output(Array.from({ length: CARD_LINES }, (_, at) => hit(at + 1))));
    await type("gust");
    expect(options()).toHaveLength(5);
    expect(chosen()).toEqual([]);
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    // Each hit is a row of two lines in the card; Up from the first row chooses none again.
    expect(options().every((option) => option.className === "hit snipped")).toBe(true);
    await press("n", { ctrlKey: true });
    expect(chosen()).toEqual(["SR-000001 (SR-1) Gust 1"]);
    await press("ArrowUp");
    expect(chosen()).toEqual([]);
    await press("ArrowUp");
    expect(chosen()).toEqual([]);
  });

  it("[SR-183/AK3] shows a hit as the search buffer does: the title with its marks, the status, and the snippet under it", async () => {
    await mount(() => output([hit(1), hit(2, { fields: ["id", "title"] }, false)]));
    await type("gust");
    const [first, second] = options().map((option) => ({
      name: text(option, ".name"),
      marks: [...option.querySelectorAll(".name mark")].map((mark) => mark.textContent),
      hint: text(option, ".hint"),
      snippet: text(option, ".snippet"),
      snippetMark: text(option, ".snippet mark"),
      className: option.className,
      described: option.getAttribute("aria-describedby"),
    }));
    expect(first).toEqual({
      name: "SR-000001 (SR-1) Gust 1",
      marks: ["Gust"],
      hint: "draft",
      snippet: "text: The gust 1 blows.",
      snippetMark: "gust",
      className: "hit snipped",
      described: "candidate-0-snippet",
    });
    // A hit in the title or ID only: one line, no snippet.
    expect(second).toEqual({
      name: "SR-000002 (SR-2) Gust 2",
      marks: ["SR-000002", "Gust"],
      hint: "draft",
      snippet: undefined,
      snippetMark: undefined,
      className: "hit",
      described: null,
    });
  });

  it("[SR-183/AK4] Enter opens the hit chosen with Ctrl+N, Ctrl+P or the arrows", async () => {
    for (const [keys, wanted] of [
      [[["n", { ctrlKey: true }]], "element:spec:u1"],
      [[["ArrowDown"], ["ArrowDown"]], "element:spec:u2"],
      [
        [
          ["n", { ctrlKey: true }],
          ["n", { ctrlKey: true }],
          ["n", { ctrlKey: true }],
          ["p", { ctrlKey: true }],
        ],
        "element:spec:u2",
      ],
    ] as [[string, KeyboardEventInit?][], string][]) {
      const { dispatched, closed } = await mount(() => output([hit(1), hit(2), hit(3)]));
      await type("gust");
      for (const [key, init] of keys) {
        await press(key, init);
      }
      await press("Enter");
      expect(closed).toHaveBeenCalledWith(false);
      const opened = dispatched.map((action) => (action.type === "open" ? action.buffer.key : ""));
      expect(opened).toEqual([wanted]);
    }
  });

  it("[SR-183/AK4] opens the hit chosen even when newer hits are on their way, and a click opens a hit", async () => {
    const { dispatched, call } = await mount(() => output([hit(1), hit(2)]));
    await type("gust");
    await press("n", { ctrlKey: true });
    await press("n", { ctrlKey: true });
    call.mockImplementation(() => new Promise(() => undefined));
    await type("gusts");
    // Typing chose none; the old hits stay shown while core answers, and one is chosen among them.
    await press("ArrowDown");
    await press("ArrowDown");
    await press("Enter");
    expect(dispatched.map((action) => (action.type === "open" ? action.buffer.key : ""))).toEqual([
      "element:spec:u2",
    ]);

    const clicked = await mount(() => output([hit(1), hit(2)]));
    await type("gust");
    await act(async () => {
      options()[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(clicked.dispatched.map((action) => (action.type === "open" ? action.buffer.key : ""))).toEqual([
      "element:spec:u2",
    ]);
  });

  it("chooses none when the hit chosen is not among the hits that arrive", async () => {
    let hits = [hit(1), hit(2)];
    const { call } = await mount(() => output(hits));
    await type("gust");
    let release: () => void = () => undefined;
    call.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ ok: true, output: output(hits) });
          };
        }),
    );
    await type("gusts");
    await press("ArrowDown");
    await press("ArrowDown");
    expect(chosen()).toEqual(["SR-000002 (SR-2) Gust 2"]);
    hits = [hit(3)];
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await flush();
    expect(chosen()).toEqual([]);
  });

  it("[SR-183/AK5] Enter without a chosen hit opens the search buffer, also before the hits arrive", async () => {
    const shown = await mount(() => output([hit(1)]));
    await type("gust");
    expect(options()).toHaveLength(1);
    await press("Enter");
    expect(shown.dispatched).toEqual([{ type: "open", buffer: searchBuffer("gust") }]);

    // Core has not answered yet: Enter does not wait for the hits.
    const late = searchPrompt(() => output([hit(1)]));
    late.call.mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      root.render(
        createElement(Minibuffer, {
          echo: "",
          prompt: { serial: serial + 1, prompt: late.prompt },
          onCommand: vi.fn(),
          onClose: vi.fn(),
        }),
      );
      await Promise.resolve();
    });
    await flush();
    await type("wind");
    // Ctrl/Cmd+Enter as Enter: it does not wait for the hits either.
    await press("Enter", { ctrlKey: true });
    expect(late.dispatched).toEqual([{ type: "open", buffer: searchBuffer("wind") }]);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
