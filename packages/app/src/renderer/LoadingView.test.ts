// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { Fragment, act, createElement, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ListBuffer, SearchBuffer } from "./buffers.js";
import { listBuffer, searchBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { LoadingView } from "./BufferArea.js";
import { container, flush, press, query, render, row, rowsOf, texts } from "./components.test-helper.js";

describe("LoadingView, a list that replaces another list (ThomasBirkmaier/ReqSeq-archive#563)", () => {
  it("[SR-122/AK-mqwc] starts the next list empty: it never shows the rows of the list before under its name, and Ctrl+N waits for its own rows", async () => {
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
