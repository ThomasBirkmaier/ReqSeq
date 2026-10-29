// @vitest-environment happy-dom
// SR-066 AK2 and D-058: a reference to another repository has the short ID as its label in the file; the
// editor shows the title of its target instead when the target is here, asked once of core.
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (#460).
import "../../../../../scripts/test-support/dom-selection.mjs";
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor.js";
import { focusEffect } from "./preview.js";
import type { Reference, ReferenceOptions } from "./references.js";
import { references } from "./references.js";

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

const GUSTS = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
const OTHER = "11111111-2222-4333-8444-555555555555";
const ACROSS = `[N-0e9d7c](reqseq:${GUSTS}?version=n1:aa&repository=sensor)`;
const TEXT = `See ${ACROSS} here.\n\nsecond line`;

type Title = NonNullable<ReferenceOptions["title"]>;
const follow = vi.fn<(reference: Reference) => void>();

const show = async (text: string, title: Title): Promise<EditorView> => {
  await act(async () => {
    root.render(
      createElement(Editor, {
        text,
        readOnly: false,
        onChange: vi.fn(),
        onEscape: vi.fn(),
        plugins: references({ outdated: new Map(), follow, title }),
      }),
    );
    await Promise.resolve();
  });
  await settle();
  const found = container.querySelector<HTMLElement>(".cm-editor");
  const view = found === null ? null : EditorView.findFromDOM(found);
  if (view === null) {
    throw new Error("no editor");
  }
  return view;
};

/** Lets the answers of `title` come in. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const labels = (): string[] =>
  [...container.querySelectorAll(".cm-lr-ref")].map((label) => label.textContent);

describe("the title of a target in another repository (D-058)", () => {
  it("[SR-066/AK2] a reference to a local target in another repository shows its title, the file keeps the short ID", async () => {
    const title = vi.fn<Title>(() => Promise.resolve("Measure gusts"));
    const view = await show(TEXT, title);
    expect(title).toHaveBeenCalledExactlyOnceWith(GUSTS, "sensor");
    expect(labels()).toEqual(["Measure gusts"]);
    expect(container.querySelector(".cm-content")?.textContent).not.toContain("N-0e9d7c");
    expect(view.state.doc.toString()).toBe(TEXT);
  });

  it("[SR-066/AK2] shows the short ID as written on the line that shows its source", async () => {
    const view = await show(TEXT, () => Promise.resolve("Measure gusts"));
    act(() => {
      view.dispatch({ effects: focusEffect.of(true), selection: { anchor: 6 } });
    });
    expect(labels()).toEqual(["N-0e9d7c"]);
    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    expect(labels()).toEqual(["Measure gusts"]);
  });

  it("[SR-066/AK2] a press on the title follows the reference", async () => {
    follow.mockClear();
    await show(TEXT, () => Promise.resolve("Measure gusts"));
    const shown = container.querySelector(".cm-lr-title");
    expect(shown?.closest(".cm-lr-ref")).not.toBeNull();
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      shown?.dispatchEvent(event);
    });
    expect(follow).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: GUSTS, repository: "sensor" }) as Reference,
    );
  });

  it("asks once per target, also for one written later, and never for a reference within the repository", async () => {
    const title = vi.fn<Title>((id) => Promise.resolve(id === GUSTS ? "Measure gusts" : "Other"));
    const view = await show(`${TEXT}\n\n[Within](reqseq:${OTHER}?version=n1:bb)`, title);
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: ` ${ACROSS}` } });
    });
    await settle();
    expect(title).toHaveBeenCalledTimes(1);
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: ` [x](reqseq:${OTHER}?repository=sensor)` },
      });
    });
    await settle();
    expect(title.mock.calls).toEqual([
      [GUSTS, "sensor"],
      [OTHER, "sensor"],
    ]);
    expect(labels()).toEqual(["Measure gusts", "Within", "Measure gusts", "Other"]);
  });

  it("keeps the short ID when the target is not here, and asks for it no more while typing goes on", async () => {
    const title = vi.fn<Title>(() => Promise.resolve(undefined));
    const view = await show(TEXT, title);
    expect(labels()).toEqual(["N-0e9d7c"]);
    for (const char of "abc") {
      act(() => {
        view.dispatch({ changes: { from: view.state.doc.length, insert: char }, userEvent: "input.type" });
      });
      await settle();
    }
    expect(title).toHaveBeenCalledTimes(1);
  });

  it("asks once while an answer is on its way, also when typing goes on", async () => {
    const title = vi.fn<Title>(() => new Promise<string>(() => undefined));
    const view = await show(TEXT, title);
    act(() => {
      view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    });
    await settle();
    expect(title).toHaveBeenCalledTimes(1);
  });

  it("takes no title once the editor is gone", async () => {
    let answer: (title: string) => void = () => undefined;
    const view = await show(
      TEXT,
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    act(() => {
      root.unmount();
    });
    const dispatch = vi.spyOn(view, "dispatch");
    answer("Measure gusts");
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
    expect(container.querySelector(".cm-lr-ref")).toBeNull();
    root = createRoot(container);
  });
});
