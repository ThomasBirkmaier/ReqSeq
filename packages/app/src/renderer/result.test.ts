// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Buffer, BufferAction } from "./buffers.js";
import { bufferName, elementBuffer, reduceBuffers, resultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { bufferView } from "./modeline.js";
import type { BufferData } from "./modeline.js";
import { MAX_RESULT_LINES, resultLines, resultTotal } from "./result.js";
import { ResultView } from "./ResultView.js";
import { LoadingView } from "./BufferArea.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const element = (n: number, extra: object = {}) => ({
  id: `uuid-${String(n)}`,
  repository: "spec",
  shortId: `SR-00000${String(n)}`,
  title: `Title ${String(n)}`,
  type: "need",
  ...extra,
});

const hint = {
  code: "relation.outdated",
  severity: "warning",
  message: "The target changed",
  elementId: "uuid-2",
  elementShortId: "SR-000002",
  repository: "spec",
};

describe("result lines", () => {
  it("lays out elements as rows that open, problems as one line and the rest as an indented outline", () => {
    const lines = resultLines({
      root: element(1, { identifier: "SR-1" }),
      nodes: [element(2)],
      problems: [hint, { code: "workspace.x", severity: "info", message: "Nothing to say" }],
      depth: { up: 2, down: 0 },
      incomplete: false,
      name: "Weather",
    });
    expect(lines.map((line) => [line.kind, line.depth, line.label, line.text])).toEqual([
      ["element", 0, "SR-1", "Title 1"],
      ["text", 0, "nodes", "1"],
      ["element", 1, "SR-000002", "Title 2"],
      ["text", 0, "problems", "2"],
      ["problem", 1, "", "warning  relation.outdated  SR-000002  The target changed"],
      ["problem", 1, "", "info  workspace.x  Nothing to say"],
      ["text", 0, "depth", ""],
      ["text", 1, "up", "2"],
      ["text", 1, "down", "0"],
      ["text", 0, "incomplete", "false"],
      ["text", 0, "name", "Weather"],
    ]);
    expect(lines[0]?.open).toEqual(elementBuffer("uuid-1", "spec", "SR-1 Title 1"));
    expect(lines[4]?.open).toEqual(elementBuffer("uuid-2", "spec", "SR-000002"));
    expect(lines[5]?.open).toBeUndefined();
  });

  it("opens the element of a problem in the repository of its element, named by its ID when it has no other name", () => {
    const [line] = resultLines([
      { ...hint, elementShortId: undefined, repository: "meta", elementRepository: "spec" },
    ]);
    expect(line?.open).toEqual(elementBuffer("uuid-2", "spec", "uuid-2"));
  });

  it("[SR-037/AK1] shows the share of a verification degree as a percentage, rounded down as on every access", () => {
    const counts = { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 };
    const lines = resultLines({ degree: { share: 0.6, total: 10, counts }, view: "core" });
    expect(lines.slice(0, 3).map((line) => [line.depth, line.label, line.text])).toEqual([
      [0, "degree", ""],
      [1, "share", "60 %"],
      [1, "total", "10"],
    ]);
    expect(resultLines({ degree: { share: 9 / 14, total: 14, counts } })[1]?.text).toBe("64.2 %");
    // Only a share next to counts is a degree.
    expect(resultLines({ share: 0.6, total: 10 })[0]?.text).toBe("0.6");
  });

  it("shows a bare value and the items of a bare list", () => {
    expect(resultLines("done").map((line) => line.text)).toEqual(["done"]);
    expect(resultLines([1, "a", null]).map((line) => line.text)).toEqual(["1", "a", "null"]);
  });

  it("stops after MAX_RESULT_LINES lines and counts the rest", () => {
    const lines = resultLines({ items: Array.from({ length: MAX_RESULT_LINES + 1 }, (_, n) => n) });
    expect(lines).toHaveLength(MAX_RESULT_LINES + 1);
    expect(lines.at(-1)?.text).toBe("2 more lines");
    expect(resultLines(Array.from({ length: MAX_RESULT_LINES + 1 }, (_, n) => n)).at(-1)?.text).toBe(
      "1 more line",
    );
    // Lines past the limit are counted, also the labels of keys and nested records after it.
    const nested = resultLines({ a: Array.from({ length: MAX_RESULT_LINES }, (_, n) => n), b: { c: 1 } });
    expect(nested).toHaveLength(MAX_RESULT_LINES + 1);
    expect(nested.at(-1)?.text).toBe("3 more lines");
    expect(resultLines(Array.from({ length: MAX_RESULT_LINES }, (_, n) => n))).toHaveLength(MAX_RESULT_LINES);
  });

  it("takes the total of the whole answer for the modeline", () => {
    expect(resultTotal({ total: 7, nodes: [] })).toBe(7);
    expect(resultTotal({ nodes: [] })).toBeUndefined();
    expect(resultTotal([1])).toBeUndefined();
  });

  it("names the buffer by the command prompt's line and gives one buffer per command and input", () => {
    const buffer = resultBuffer("hint.list", { ref: "uuid-1" }, "List hints SR-1", {}, 0);
    expect(buffer.key).toBe('result:hint.list:{"ref":"uuid-1"}');
    expect(bufferName(buffer)).toBe("List hints SR-1");
    expect(bufferView(buffer, { kind: "result", total: 3 })).toEqual(["List hints SR-1", "3 in all"]);
    expect(bufferView(buffer, { kind: "result", total: undefined })).toEqual(["List hints SR-1"]);
  });
});

describe("result view", () => {
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

  /** Presses `key` on the buffer and gives the event back, to see whether the view took it. */
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    await act(async () => {
      container.querySelector("[data-buffer]")?.dispatchEvent(event);
      await Promise.resolve();
    });
    await flush();
    return event;
  };

  /** Renders the view of `initial` through the reducer; returns what it dispatched, loaded and said. */
  const mount = async (call: Call, initial: Buffer, revision: number) => {
    const actions: BufferAction[] = [];
    const data: (BufferData | undefined)[] = [];
    const echoes: string[] = [];
    const Harness = ({ at }: { at: number }): React.ReactElement => {
      const [buffers, dispatch] = useReducer(reduceBuffers, [initial]);
      const current = buffers[0];
      return current?.kind === "result"
        ? createElement(ResultView, {
            call,
            buffer: current,
            revision: at,
            dispatch: (action: BufferAction) => {
              actions.push(action);
              dispatch(action);
            },
            onData: (_key: string, loaded: BufferData | undefined) => {
              data.push(loaded);
            },
            onEcho: (message: string) => {
              echoes.push(message);
            },
          })
        : createElement("p", { id: "elsewhere" }, current === undefined ? "" : bufferName(current));
    };
    const rerender = async (next: number): Promise<void> => {
      await act(async () => {
        root.render(createElement(Harness, { at: next }));
        await Promise.resolve();
      });
      await flush();
    };
    await rerender(revision);
    return { actions, data, echoes, rerender };
  };

  const texts = (): string[] => [...container.querySelectorAll(".line")].map((line) => line.textContent);

  it("shows the output it was opened with, selects lines with the keys and opens an element row with Enter", async () => {
    const call = vi.fn<Call>();
    const output = { total: 2, elements: [element(1), element(2)] };
    const { actions, data } = await mount(call, resultBuffer("trace.affected", {}, "Affected", output, 4), 4);
    expect(call).not.toHaveBeenCalled();
    expect(texts()).toEqual(["total2", "elements2", "SR-000001Title 1", "SR-000002Title 2"]);
    expect(data.at(-1)).toEqual({ kind: "result", total: 2 });
    // Only the element rows are options; the cursor on a text line names no active option.
    expect([...container.querySelectorAll('[role="option"]')].map((line) => line.textContent)).toEqual([
      "SR-000001Title 1",
      "SR-000002Title 2",
    ]);
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox?.getAttribute("aria-activedescendant")).toBeNull();
    // No line is selected at first (SR-122).
    expect(container.querySelector("[data-cursor]")).toBeNull();
    await press("End");
    await press("ArrowUp");
    await press("Home");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("x");
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe("SR-000001Title 1");
    expect(listbox?.getAttribute("aria-activedescendant")).toBe("result-2");
    await press("Enter");
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: elementBuffer("uuid-1", "spec", "SR-000001 Title 1"),
    });
  });

  it("[SR-122/AK4] Ctrl+N and Ctrl+P walk the lines like Down and Up; Ctrl+N first selects the first line, and Ctrl+P is Go to until one is", async () => {
    const output = { total: 2, elements: [element(1), element(2)] };
    await mount(vi.fn<Call>(), resultBuffer("trace.affected", {}, "Affected", output, 0), 0);
    const cursorLine = (): string | null | undefined => container.querySelector("[data-cursor]")?.textContent;
    expect((await press("p", { ctrlKey: true })).defaultPrevented).toBe(false);
    expect(cursorLine()).toBeUndefined();
    expect((await press("n", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(cursorLine()).toBe("total2");
    await press("n", { ctrlKey: true });
    await press("n", { ctrlKey: true });
    expect(cursorLine()).toBe("SR-000001Title 1");
    await press("p", { ctrlKey: true });
    expect(cursorLine()).toBe("elements2");
    await press("p", { ctrlKey: true });
    expect((await press("p", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(cursorLine()).toBe("total2");
    expect((await press("p", { metaKey: true })).defaultPrevented).toBe(false);
  });

  it("Enter with no line selected acts on the first line and selects it", async () => {
    const output = { total: 1, elements: [element(1)] };
    const { actions } = await mount(
      vi.fn<Call>(),
      resultBuffer("trace.affected", {}, "Affected", output, 0),
      0,
    );
    await press("Enter");
    expect(actions).toEqual([{ type: "cursor", key: "result:trace.affected:{}", cursor: 0 }]);
    expect(container.querySelector("[data-cursor]")?.textContent).toBe("total1");
  });

  it("opens an element row on a click; a line without an element opens nothing", async () => {
    const { actions } = await mount(
      vi.fn<Call>(),
      resultBuffer("trace.affected", {}, "Affected", { name: "x", elements: [element(1)] }, 0),
      0,
    );
    const lines = [...container.querySelectorAll(".line")];
    await act(async () => {
      lines[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(actions.map((action) => action.type)).toEqual(["cursor"]);
    await act(async () => {
      lines[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: elementBuffer("uuid-1", "spec", "SR-000001 Title 1"),
    });
  });

  it("never asks a write command again when the workspace changed: that would write again", async () => {
    const call = vi.fn() as unknown as Call;
    const { rerender } = await mount(
      call,
      resultBuffer("hint.confirm", { ref: "uuid-1" }, "Confirm hints SR-1", { confirmed: ["h1"] }, 0, true),
      1,
    );
    await rerender(2);
    expect(call).not.toHaveBeenCalled();
    expect(texts()).toEqual(["confirmed1", "h1"]);
  });

  it("asks the command again with the same input when the workspace changed, and says why it failed", async () => {
    const answers = [
      { ok: true as const, output: { total: 1, elements: [element(3)], problems: [hint] } },
      { ok: false as const, code: "x.failed", message: "The workspace is gone" },
    ];
    const call = vi.fn(() => Promise.resolve(answers.shift())) as unknown as Call;
    const { echoes, rerender } = await mount(
      call,
      resultBuffer("trace.affected", { ref: "uuid-1" }, "Affected", { total: 0 }, 0),
      1,
    );
    expect(call).toHaveBeenCalledWith("trace.affected", { ref: "uuid-1" });
    expect(texts()).toEqual([
      "total1",
      "elements1",
      "SR-000003Title 3",
      "problems1",
      "warning  relation.outdated  SR-000002  The target changed",
    ]);
    await rerender(2);
    expect(call).toHaveBeenCalledTimes(2);
    expect(echoes).toEqual(["The workspace is gone"]);
    expect(container.querySelector(".quiet")?.textContent).toBe("The workspace is gone");
    expect(texts()).toEqual([]);
    // A key on an empty result does nothing.
    await press("Enter");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that comes after the buffer was left", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const call = vi.fn(() => new Promise((resolve) => (answer = resolve))) as unknown as Call;
    const { actions } = await mount(call, resultBuffer("trace.affected", {}, "Affected", {}, 0), 1);
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    answer({ ok: true, output: { total: 5 } });
    await flush();
    expect(actions).toEqual([]);
  });

  it("is the view the sheet shows for a result buffer", async () => {
    const buffer = resultBuffer("trace.affected", {}, "Affected", { total: 0 }, 0);
    await act(async () => {
      root.render(
        createElement(LoadingView, {
          call: vi.fn<Call>(),
          buffer,
          revision: 0,
          dispatch: vi.fn(),
          onData: vi.fn(),
          onEcho: vi.fn(),
        }),
      );
      await Promise.resolve();
    });
    expect(container.querySelector(".result")?.getAttribute("aria-label")).toBe("Affected");
  });
});
