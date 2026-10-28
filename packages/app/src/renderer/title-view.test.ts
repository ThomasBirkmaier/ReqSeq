// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (#460).
import "../../../../scripts/test-support/dom-selection.mjs";
// The title of an element, edited in its heading (#621; spec question #676): the editor comes into the
// heading when the title is entered, it is saved with the text and the boxes as `title` (SR-105), and a
// change of the file follows the rules of a box (SR-106). The click offset and the heading of an empty title
// are tested in `title-box.test.ts`, the input it sends in `property-edit.test.ts`.
import type { DataExportElement } from "@logreq/core";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementControls, Prompt } from "./actions.js";
import { AUTOSAVE_MS } from "./autosave.js";
import { elementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { Draft } from "./drafts.js";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import { ElementView } from "./ElementView.js";
import type { BufferData } from "./modeline.js";
import { GONE_CONFIRM_MS } from "./outside-change.js";
import { referenceTitles } from "./reference-titles.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => {
    root.unmount();
  });
  container.remove();
});

const MODEL: PropertyModel = new Map([
  [
    "requirement",
    new Map<string, PropertyInfo>([
      ["title", { name: "Title", kind: "text", many: false, markdown: false, meaning: "title" }],
      ["topic", { kind: "text", many: false, markdown: false }],
    ]),
  ],
  ["note", new Map<string, PropertyInfo>([["topic", { kind: "text", many: false, markdown: false }]])],
]);

const NAME = "SR-1 Measure wind";
const MISSING = "Required property Title (title) of type Requirement (requirement) has no value";

const failure = (code: string, message: string): Error => Object.assign(new Error(message), { code });

/** The file of one element: what `element.get` reads, and what `element.update` writes as core does. */
const disk = (options: { readonly readOnly?: boolean; readonly type?: string; readonly title?: string }) => {
  const file = {
    title: options.title ?? "Measure wind",
    text: "first",
    properties: { topic: "Wind" } as Record<string, unknown>,
    sha: "sha-0",
    writes: 0,
    gone: false,
  };
  const element = (): DataExportElement =>
    ({
      id: "uuid-1",
      shortId: "SR-000001",
      identifier: "SR-1",
      type: options.type ?? "requirement",
      status: "draft",
      title: file.title,
      text: file.text,
      repository: "spec",
      file: "a.md",
      properties: file.properties,
      relations: [],
      ...(file.title === "" ? { problems: [{ code: "element.missing-required", message: MISSING }] } : {}),
      ...(options.readOnly === true ? { readOnly: true } : {}),
    }) as unknown as DataExportElement;
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
    "element.get": () =>
      file.gone
        ? failure("ref.unknown", "uuid-1 is not an element")
        : { element: element(), fileSha256: file.sha },
    "element.update": (input) => {
      if (input["expectedFileSha256"] !== file.sha) {
        return failure("file.changed-on-disk", "Not written: a.md changed on disk since it was read.");
      }
      file.writes += 1;
      file.title = typeof input["title"] === "string" ? input["title"] : file.title;
      file.text = typeof input["text"] === "string" ? input["text"] : file.text;
      file.properties = { ...file.properties, ...((input["set"] ?? {}) as Record<string, unknown>) };
      file.sha = `sha-${String(file.writes)}`;
      const written = element();
      return {
        element: written,
        fileSha256: file.sha,
        files: ["a.md"],
        affected: 0,
        problems: written.problems,
      };
    },
    "trace.neighbourhood": (input) => ({
      root: input["ref"],
      nodes: [{ id: input["ref"], repository: "spec", depth: 0, expanded: true }],
      total: 1,
      edges: [],
      incomplete: false,
    }),
  };
  const call = vi.fn((name: string, input: Record<string, unknown>) => {
    const output = handlers[name]?.(input);
    return Promise.resolve(
      output instanceof Error
        ? {
            ok: false,
            code: (output as Error & { code?: string }).code ?? "x.failed",
            message: output.message,
          }
        : { ok: true, output },
    );
  });
  const updates = (): unknown[] =>
    call.mock.calls.filter(([name]) => name === "element.update").map(([, input]) => input);
  return { file, call, updates };
};

/** Lets promises and the timers that are due run. */
const settle = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const mountView = async (
  options: {
    readonly draft?: Draft;
    readonly readOnly?: boolean;
    readonly type?: string;
    readonly title?: string;
  } = {},
) => {
  const fake = disk(options);
  const echoed: string[] = [];
  const data: (BufferData | undefined)[] = [];
  const drafts: (Draft | undefined)[] = [];
  const copies: [string, string][] = [];
  const registered: (ElementControls | undefined)[] = [];
  const asked: Prompt[] = [];
  const picks: unknown[] = [];
  let revision = 0;
  const node = () =>
    createElement(ElementView, {
      call: fake.call as unknown as Call,
      buffer: elementBuffer("uuid-1", "spec", NAME),
      revision,
      onData: (_key, loaded) => data.push(loaded),
      onEcho: (message) => echoed.push(message),
      onCopy: (label, value) => copies.push([label, value]),
      onOpenRelation: () => undefined,
      onOpenTarget: () => undefined,
      onPickElement: (request) => picks.push(request),
      titles: referenceTitles(fake.call as unknown as Call),
      onAsk: (prompt) => asked.push(prompt),
      draft: options.draft,
      onDraft: (_key, kept) => drafts.push(kept),
      register: (controls) => registered.push(controls),
      packages: undefined,
      properties: MODEL,
      dispatch: () => undefined,
    });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await act(async () => {
    root.render(node());
    await vi.advanceTimersByTimeAsync(0);
  });
  await settle();
  const controls = (): ElementControls => {
    const found = registered.findLast((c) => c !== undefined);
    if (found === undefined) {
      throw new Error("no controls registered");
    }
    return found;
  };
  return {
    ...fake,
    echoed,
    data,
    drafts,
    copies,
    asked,
    picks,
    controls,
    /** The file was read again (a change from outside that names the element). */
    reload: async (): Promise<void> => {
      revision += 1;
      await act(async () => {
        root.render(node());
        await vi.advanceTimersByTimeAsync(0);
      });
      await settle();
    },
  };
};

const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};
const field = (label: string): HTMLElement => query(`[data-field="${label}"]`);
const viewIn = (label: string): EditorView => {
  const found = EditorView.findFromDOM(query(`[data-field="${label}"] .cm-editor`));
  if (found === null) {
    throw new Error("no editor");
  }
  return found;
};
const titleView = (): EditorView => viewIn("Title");
const textView = (): EditorView => viewIn("Text");
const heading = (): HTMLElement => query("article h1");
const typeAt = async (view: EditorView, insert: string, at = view.state.doc.length): Promise<void> => {
  await act(async () => {
    view.dispatch({ changes: { from: at, insert }, userEvent: "input.type" });
    await Promise.resolve();
  });
};
/** Replaces the whole document as the user does (select all, type). */
const typeOver = async (view: EditorView, insert: string): Promise<void> => {
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert }, userEvent: "input.type" });
    await Promise.resolve();
  });
};
const press = async (target: HTMLElement, key: string, init: KeyboardEventInit = {}): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    await Promise.resolve();
  });
};
const focus = async (target: HTMLElement): Promise<void> => {
  await act(async () => {
    target.focus();
    await Promise.resolve();
  });
};
const caretAt = async (view: EditorView, at: number): Promise<void> => {
  await act(async () => {
    view.dispatch({ selection: { anchor: at } });
    await Promise.resolve();
  });
};
/** Opens the title with Enter on its field, as the keyboard does. */
const enterTitle = async (): Promise<void> => {
  await focus(field("Title"));
  await press(field("Title"), "Enter");
  await settle();
};
/** Chooses `name` in the last prompt the buffer asked. */
const choose = async (asked: Prompt[], name: string): Promise<void> => {
  await act(async () => {
    asked
      .at(-1)
      ?.items.find((item) => item.name === name)
      ?.run();
    await Promise.resolve();
  });
};

describe("the title in its heading (#621)", () => {
  it("is plain text in the heading, and the buffer has no editor for it, until it is entered", async () => {
    await mountView();
    expect(heading().textContent).toBe("Measure wind");
    expect(heading().querySelector(".cm-editor")).toBeNull();
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(2);
  });

  it("Enter on the title field puts the caret at the end of the title, in the heading", async () => {
    await mountView();
    await enterTitle();
    expect(heading().querySelector(".cm-editor")).not.toBeNull();
    expect(titleView().hasFocus).toBe(true);
    expect(titleView().state.selection.main.head).toBe(12);
    expect(titleView().contentDOM.getAttribute("aria-label")).toBe("Title");
    expect(field("Title").getAttribute("tabindex")).toBe("0");
    expect(titleView().contentDOM.getAttribute("tabindex")).toBe("-1");
  });

  it("a click on the heading opens the title for editing, and Edit title does too", async () => {
    const { controls } = await mountView();
    await act(async () => {
      heading().click();
      await Promise.resolve();
    });
    await settle();
    expect(titleView().hasFocus).toBe(true);
    await focus(field("Text"));
    act(() => {
      controls().editTitle?.();
    });
    expect(titleView().hasFocus).toBe(true);
    expect(titleView().state.selection.main.head).toBe(12);
  });

  it("Enter, Shift+Enter and Escape leave the title for its field; Escape there for the element", async () => {
    await mountView();
    await enterTitle();
    for (const init of [{}, { shiftKey: true }]) {
      await press(titleView().contentDOM, "Enter", init);
      expect(document.activeElement).toBe(field("Title"));
      expect(titleView().state.doc.toString()).toBe("Measure wind");
      await press(field("Title"), "Enter");
      expect(titleView().hasFocus).toBe(true);
    }
    await press(titleView().contentDOM, "Escape");
    expect(document.activeElement).toBe(field("Title"));
    await press(field("Title"), "Escape");
    expect(document.activeElement).toBe(query("article"));
  });

  it("Up at the first line of the text goes to the end of the title, Down from the title to the start of the text, Up from the title nowhere", async () => {
    await mountView();
    await caretAt(textView(), 0);
    await focus(textView().contentDOM);
    await press(textView().contentDOM, "ArrowUp");
    await settle();
    expect(titleView().hasFocus).toBe(true);
    expect(titleView().state.selection.main.head).toBe(12);
    await press(titleView().contentDOM, "ArrowDown");
    expect(textView().hasFocus).toBe(true);
    expect(textView().state.selection.main.head).toBe(0);
    await caretAt(titleView(), 0);
    await focus(titleView().contentDOM);
    await press(titleView().contentDOM, "ArrowUp");
    expect(titleView().hasFocus).toBe(true);
  });

  it("Up and Down between the fields that are not edited leave the heading closed", async () => {
    await mountView();
    await focus(field("Title"));
    await press(field("Title"), "ArrowUp");
    expect(document.activeElement).toBe(field("Title"));
    expect(heading().querySelector(".cm-editor")).toBeNull();
    await press(field("Title"), "ArrowDown");
    expect(textView().hasFocus).toBe(true);
    expect(heading().querySelector(".cm-editor")).toBeNull();
  });

  it("[SR-105/AK1] a changed title is saved a second after the last key as title, and nothing else is sent", async () => {
    const { updates, file, echoed } = await mountView();
    await enterTitle();
    await typeAt(titleView(), " speed");
    await settle(AUTOSAVE_MS - 1);
    expect(updates()).toEqual([]);
    await settle(1);
    expect(updates()).toEqual([{ ref: "uuid-1", title: "Measure wind speed", expectedFileSha256: "sha-0" }]);
    expect(file.title).toBe("Measure wind speed");
    expect(echoed).toEqual([]);
    expect(heading().textContent).toBe("Measure wind speed");
  });

  it("[SR-127/AK5] [[ typed in the title asks for no element: the title stays plain text and is saved as typed", async () => {
    const { updates, picks } = await mountView();
    await enterTitle();
    await typeAt(titleView(), " [");
    await typeAt(titleView(), "[");
    expect(picks).toEqual([]);
    await settle(AUTOSAVE_MS);
    expect(updates()).toEqual([{ ref: "uuid-1", title: "Measure wind [[", expectedFileSha256: "sha-0" }]);
    expect(heading().textContent).toBe("Measure wind [[");
  });

  it("[SR-105/AK1] the title, the text and a box changed together go in one element.update", async () => {
    const { updates } = await mountView();
    await enterTitle();
    await typeAt(titleView(), "!");
    await typeAt(textView(), " more");
    await typeAt(viewIn("topic"), "y");
    await settle(AUTOSAVE_MS);
    expect(updates()).toEqual([
      {
        ref: "uuid-1",
        title: "Measure wind!",
        text: "first more",
        set: { topic: "Windy" },
        expectedFileSha256: "sha-0",
      },
    ]);
  });

  it("[SR-064/AK2] an emptied title is saved as the empty title, and core's hint is said with Saved", async () => {
    const { updates, echoed, controls, data } = await mountView();
    await enterTitle();
    await typeOver(titleView(), "");
    act(() => {
      controls().save();
    });
    await settle();
    expect(updates()).toEqual([{ ref: "uuid-1", title: "", expectedFileSha256: "sha-0" }]);
    expect(echoed).toEqual([`Saved ${NAME}. ${MISSING}`]);
    expect(data.at(-1)).toMatchObject({ element: { problems: [{ message: MISSING }] } });
    // The editor shows the ID, muted, where the title is.
    expect(heading().querySelector(".cm-placeholder")?.textContent).toBe("SR-1");
  });

  it("an empty title shows the ID muted while it is not edited", async () => {
    await mountView({ title: "" });
    expect(heading().textContent).toBe("SR-1");
    expect(heading().className).toBe("untitled");
  });

  it("[SR-105/AK2] Ctrl/Cmd+Z in the title after its save brings the title before back, and it is saved again", async () => {
    const { updates } = await mountView();
    await enterTitle();
    await typeAt(titleView(), "!");
    await settle(AUTOSAVE_MS);
    await act(async () => {
      undo(titleView());
      await Promise.resolve();
    });
    await settle(AUTOSAVE_MS);
    expect(titleView().state.doc.toString()).toBe("Measure wind");
    expect(updates()).toEqual([
      { ref: "uuid-1", title: "Measure wind!", expectedFileSha256: "sha-0" },
      { ref: "uuid-1", title: "Measure wind", expectedFileSha256: "sha-1" },
    ]);
  });

  it("an unsaved title is in the draft the app keeps when the buffer is left (#621)", async () => {
    const { drafts } = await mountView();
    await enterTitle();
    await typeAt(titleView(), "!");
    expect(drafts.at(-1)?.boxes?.get("Title")).toEqual({ doc: "Measure wind!", base: "Measure wind" });
  });

  it("[SR-105/AK1] shown again with title input, the title editor holds it and keeps it: a later edit of the text saves both", async () => {
    const draft: Draft = {
      text: "first",
      base: "first",
      boxes: new Map([["Title", { doc: "Measure gusts", base: "Measure wind" }]]),
      sha: "sha-0",
    };
    const { updates } = await mountView({ draft });
    expect(titleView().state.doc.toString()).toBe("Measure gusts");
    await typeAt(textView(), " more");
    await settle();
    // The editor stays in the heading after it took the input (#621 review B1).
    expect(titleView().state.doc.toString()).toBe("Measure gusts");
    await settle(AUTOSAVE_MS);
    expect(updates()).toEqual([
      { ref: "uuid-1", title: "Measure gusts", text: "first more", expectedFileSha256: "sha-0" },
    ]);
  });

  it("[SR-106/AK1] a title without input follows the file, closed and open, and the caret stays", async () => {
    const { file, reload } = await mountView();
    file.title = "Measure gusts";
    file.sha = "sha-x";
    await reload();
    expect(heading().textContent).toBe("Measure gusts");
    await enterTitle();
    await caretAt(titleView(), 3);
    file.title = "Measure gusts now";
    file.sha = "sha-y";
    await reload();
    expect(titleView().state.doc.toString()).toBe("Measure gusts now");
    expect(titleView().state.selection.main.head).toBe(3);
  });

  it('[SR-106/AK2] with input in the title and other bytes on disk nothing is saved, "On disk" shows the file\'s title, and "Take the file" puts it in as an edit that Ctrl/Cmd+Z takes back', async () => {
    const { file, reload, updates, controls, asked, data } = await mountView();
    await enterTitle();
    await typeAt(titleView(), " speed");
    file.title = "Measure gusts";
    file.sha = "sha-x";
    await reload();
    expect(query('[data-on-disk="Title"]').textContent).toContain("Measure gusts");
    expect(data.at(-1)).toMatchObject({ disk: "changed" });
    await settle(AUTOSAVE_MS * 2);
    expect(updates()).toEqual([]);
    act(() => {
      controls().resolve?.();
    });
    await choose(asked, "Take the file");
    await settle();
    expect(titleView().state.doc.toString()).toBe("Measure gusts");
    expect(container.querySelector('[data-on-disk="Title"]')).toBeNull();
    await act(async () => {
      undo(titleView());
      await Promise.resolve();
    });
    expect(titleView().state.doc.toString()).toBe("Measure wind speed");
  });

  it("copies what the title editor holds, the unsaved input included", async () => {
    const { copies, controls } = await mountView();
    await enterTitle();
    await typeAt(titleView(), "!");
    act(() => {
      controls().copy();
    });
    expect(copies.at(-1)).toEqual(["Title", "Measure wind!"]);
  });

  it("Follow reference from the title takes the reference at the cursor of the text, as before", async () => {
    const { controls, echoed } = await mountView();
    await enterTitle();
    act(() => {
      controls().follow();
    });
    expect(echoed.at(-1)).toBe("No element reference at the cursor");
  });

  it("[SR-106/AK3] a deleted file leaves the typed title in its editor, read-only, and Edit title says why; nothing is written", async () => {
    const { updates, file, reload, echoed, controls } = await mountView();
    await enterTitle();
    await typeAt(titleView(), "!");
    file.gone = true;
    await reload();
    await settle(GONE_CONFIRM_MS);
    expect(titleView().state.doc.toString()).toBe("Measure wind!");
    expect(titleView().state.readOnly).toBe(true);
    act(() => {
      controls().editTitle?.();
    });
    expect(echoed.at(-1)).toBe(
      `${NAME} was deleted on disk; its content stays here until you close the buffer`,
    );
    await settle(AUTOSAVE_MS * 3);
    expect(updates()).toEqual([]);
  });

  it("opens no editor in a read-only element, for a type without a title, or for a title with a line break", async () => {
    for (const options of [{ readOnly: true }, { type: "note" }, { title: "Measure\nwind" }]) {
      const { controls, echoed } = await mountView(options);
      await enterTitle();
      await act(async () => {
        heading().click();
        await Promise.resolve();
      });
      expect(heading().querySelector(".cm-editor")).toBeNull();
      act(() => {
        controls().editTitle?.();
      });
      expect(heading().querySelector(".cm-editor")).toBeNull();
      expect(echoed.at(-1)).toBe(
        options.readOnly === true
          ? `${NAME} is read-only`
          : options.type === "note"
            ? `${NAME} has no title property: its type has none`
            : "Title has a value with a line break: edit it in the file",
      );
      act(() => {
        root.unmount();
      });
      root = createRoot(container);
    }
  });
});
