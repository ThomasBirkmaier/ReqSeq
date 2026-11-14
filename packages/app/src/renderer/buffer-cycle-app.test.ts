// @vitest-environment happy-dom
// Alt+N and Alt+P (Option+N and Option+P on macOS) in the app (SR-115 AK5): forward and back through the
// buffers in the order they were shown, also while typing in the text editor, and not while a prompt is open.
// The mouse buttons Back and Forward do the same (SR-163), and so does a swipe that macOS reports to the window
// (SR-163 AK4).
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";
import type {
  BridgeEvent,
  BridgeEvents,
  CommandListing,
  InvokeResult,
  ReqSeqBridge,
  SwipeDirection,
} from "../shared/protocol.js";
import type { AboutInfo } from "./about.js";
import { PREFIX_DELAY_MS } from "./bindings.js";
import { askDate, calendarOpen } from "./editor/calendar.js";
import { App } from "./App.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";

/** The layer of the shown buffer of the active area: views drawn in advance stand hidden beside it (SR-212 AK5). */
const SHOWN = '[data-area][data-active] > [data-layer="main"]';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (n: number, extra: object = {}) => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-00000${String(n)}`,
  type: "need",
  status: "draft",
  title: `Title ${String(n)}`,
  repository: "spec",
  file: `f${String(n)}.md`,
  properties: {},
  relations: [],
  ...extra,
});

type Handler = (input: Record<string, unknown>) => unknown;

/** Whether the workspace can be written: read-only unless a test says so. */
let writable = false;

/** The texts written by the app (SR-105: leaving a buffer saves it), by UUID. */
const written = new Map<string, string>();

/** A workspace with three elements that have a text. */
const HANDLERS: Record<string, Handler> = {
  // The line of coverage over a list: no counted requirement.
  ...NO_SUMMARY,
  "workspace.status": () => ({ name: "Weather station", readOnly: !writable }),
  "element.list": () => ({ elements: [row(1), row(2), row(3)], total: 3 }),
  "element.get": (input) => ({
    element: row(Number(String(input["ref"]).replace("uuid-", "")), {
      text: written.get(String(input["ref"])) ?? "Hello",
    }),
  }),
  "element.update": (input) => {
    written.set(String(input["ref"]), String(input["text"]));
    return {
      element: row(Number(String(input["ref"]).replace("uuid-", "")), { text: String(input["text"]) }),
    };
  },
  // No parents: the parents line stays away.
  "trace.neighbourhood": (input) => ({
    root: input["ref"],
    nodes: [{ ...row(Number(String(input["ref"]).replace("uuid-", ""))), depth: 0, expanded: true }],
    total: 1,
    edges: [],
    incomplete: false,
  }),
  "element.search": () => ({
    hits: [{ ...row(2), score: 1, fields: ["title"], terms: ["title"] }],
    total: 1,
    incomplete: false,
  }),
  "metamodel.get": () => ({
    relations: [],
    types: [{ key: "need", name: "Need", properties: [] }],
    properties: [],
    statuses: [{ key: "draft" }],
    meanings: {},
  }),
  "element.facets": () => ({
    total: 3,
    types: [{ key: "need", name: "Need", count: 3 }],
    statuses: [{ key: "draft", count: 3 }],
    properties: [],
    incomplete: false,
  }),
};

/** The window "About ReqSeq" (SR-161) shows the output of `tool.info`, the one catalog command of these tests. */
const ABOUT: AboutInfo = {
  versions: { app: "0.9.0", cli: "0.9.0", mcp: "0.9.0" },
  build: { development: true, platform: "linux", arch: "x64" },
  runtime: { node: "22.20.0" },
  workspace: { path: "/work/spec", name: "Weather station", repositories: ["spec"], elements: 3 },
  license: { notice: ["Copyright 2026"] },
  documentation: { online: "https://example.invalid/docs", releases: "https://example.invalid/releases" },
};
HANDLERS["tool.info"] = () => ABOUT;
const TOOL_INFO = [
  {
    name: "tool.info",
    title: "About ReqSeq",
    summary: "Version and build of ReqSeq.",
    effect: "read",
    stage: 6,
    implements: ["SR-161"],
    arguments: [],
    input: { type: "object" },
    output: { type: "object" },
    implemented: true,
  },
] as unknown as readonly CommandListing[];

/** The listeners of `swipe`, the one bridge event these tests send. */
const swipeListeners = new Set<(data: BridgeEvents["swipe"]) => void>();

const bridge: ReqSeqBridge = {
  invoke: (name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
    Promise.resolve({ ok: true, output: HANDLERS[name]?.(input) }),
  commands: () => Promise.resolve(TOOL_INFO),
  on: <E extends BridgeEvent>(event: E, listener: (data: BridgeEvents[E]) => void) => {
    if (event !== "swipe") {
      return () => undefined;
    }
    const swiped = listener as (data: BridgeEvents["swipe"]) => void;
    swipeListeners.add(swiped);
    return () => {
      swipeListeners.delete(swiped);
    };
  },
  copyText: () => Promise.resolve(true),
  pasteText: () => Promise.resolve(true),
  recentWorkspaces: () => Promise.resolve([]),
  openWorkspace: () => Promise.resolve({ ok: true }),
  listFolder: () => Promise.resolve({ name: "", entries: [] }),
  onSave: () => () => undefined,
  openDocs: () => Promise.resolve({ ok: true as const }),
  onHelp: () => () => undefined,
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  writable = false;
  written.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
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

const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

/** Presses a key on `target` and gives the event back, to see whether a handler took it. */
const press = async (target: EventTarget, init: KeyboardEventInit): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
    await Promise.resolve();
  });
  await flush();
  return event;
};

/** Alt+N or Alt+P as Linux and Windows report them. */
const alt = (target: EventTarget, letter: "n" | "p"): Promise<KeyboardEvent> =>
  press(target, { key: letter, code: `Key${letter.toUpperCase()}`, altKey: true });

/** A release of a mouse button: 3 is Back, 4 is Forward (`MouseEvent.button`). */
const mouse = async (target: EventTarget, button: number): Promise<MouseEvent> => {
  const event = new MouseEvent("mouseup", { bubbles: true, cancelable: true, button });
  await act(async () => {
    target.dispatchEvent(event);
    await Promise.resolve();
  });
  await flush();
  return event;
};

/** A swipe to the left or right as macOS reports it to the window (SR-163 AK4), after the preload checked it. */
const swipe = async (direction: SwipeDirection): Promise<void> => {
  await act(async () => {
    for (const listener of swipeListeners) {
      listener({ direction });
    }
    await Promise.resolve();
  });
  await flush();
};

/** A turn of the mouse wheel over `target` that still coasts. */
const wheel = async (target: EventTarget): Promise<void> => {
  await act(async () => {
    for (let n = 0; n < 3; n += 1) {
      target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 }));
    }
    await Promise.resolve();
  });
};

const type = async (value: string): Promise<void> => {
  const input = query("input");
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setValue = Reflect.get(descriptor ?? {}, "set") as (this: HTMLElement, value: string) => void;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

const runCommand = async (name: string): Promise<void> => {
  await press(window, { key: "P", ctrlKey: true, shiftKey: true });
  await type(name);
  await press(query("input"), { key: "Enter" });
};

/** The name of the shown buffer. */
const shown = (): string | null => query("[data-buffer]").getAttribute("aria-label");

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(App, { bridge }));
    await Promise.resolve();
  });
  await flush();
};

/** Opens, in this order: the overview (at the start), the list of all elements, its first element, a search. */
const openFour = async (): Promise<void> => {
  await render();
  await runCommand("List all elements");
  await press(query('[role="listbox"]'), { key: "Enter" });
  expect(shown()).toBe("SR-000001 Title 1");
  await press(window, { key: "F", ctrlKey: true, shiftKey: true });
  await type("wind");
  await press(query("input"), { key: "Enter" });
  expect(shown()).toBe("Search: wind");
};

const editorView = (): EditorView => {
  const found = EditorView.findFromDOM(query(".cm-editor"));
  if (found === null) {
    throw new Error("no editor");
  }
  return found;
};

describe("App, Next buffer and Previous buffer (SR-115 AK5)", () => {
  it("[SR-212/AK-tfck] the element left is drawn again hidden as a fresh view; the switch back shows that view, with no read of it", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    expect(shown()).toBe("SR-000001 Title 1");
    const invoke = vi.spyOn(bridge, "invoke");
    await alt(window, "p");
    expect(shown()).toBe("All elements");
    // Hidden beside the list: inert, out of the accessibility tree, not a buffer to any lookup.
    const layer = query('[data-area][data-active] > [data-layer="neighbour"]');
    const hidden = layer.querySelector("article");
    expect(hidden?.getAttribute("aria-label")).toBe("SR-000001 Title 1");
    expect(layer.inert).toBe(true);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.querySelector("[data-buffer]")).toBeNull();
    expect(layer.contains(document.activeElement)).toBe(false);
    // A fresh view: it read its element after it was left.
    const reads = (): number =>
      invoke.mock.calls.filter(
        ([name, input]) =>
          name === "element.get" && (input as { ref?: string } | undefined)?.ref === "uuid-1",
      ).length;
    expect(reads()).toBeGreaterThan(0);
    const before = reads();
    const lists = (): number => invoke.mock.calls.filter(([name]) => name === "element.list").length;
    const listed = lists();
    await alt(window, "n");
    expect(shown()).toBe("SR-000001 Title 1");
    expect(query(`${SHOWN} article`)).toBe(hidden);
    expect(reads()).toBe(before);
    expect(document.activeElement).toBe(hidden);
    // The list, a buffer of another kind, is drawn hidden only from what it read while shown: no read of it.
    expect(
      container.querySelector('[data-layer="neighbour"] [role="listbox"]')?.getAttribute("aria-label"),
    ).toBe("All elements");
    expect(lists()).toBe(listed);
  });

  it("[SR-115/AK-m5pg] Alt+P goes back through the buffers in the order they were shown, Alt+N forward again, both wrap", async () => {
    await openFour();
    // Go to the element, the buffer used before the search: shown last are now the element, the search,
    // the list and the overview, though they were opened in another order.
    await press(window, { key: "p", ctrlKey: true });
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000001 Title 1");
    const previous = await alt(window, "p");
    expect(previous.defaultPrevented).toBe(true);
    expect(shown()).toBe("Search: wind");
    // Switching with the keys does not change the order: Alt+P goes further back.
    await alt(window, "p");
    expect(shown()).toBe("All elements");
    await alt(window, "n");
    expect(shown()).toBe("Search: wind");
    await alt(window, "n");
    expect(shown()).toBe("SR-000001 Title 1");
    await alt(window, "n");
    expect(shown()).toBe("Overview");
    await alt(window, "p");
    expect(shown()).toBe("SR-000001 Title 1");
    // The shown buffer has the focus, so its keys work.
    expect(document.activeElement).toBe(query("[data-buffer]"));
  });

  it("[SR-145/AK-kbdf] Option+N and Option+P in the text editor switch buffers by the physical key; the key is taken and the editor loses the focus", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await act(async () => {
      editorView().focus();
      editorView().dispatch({ changes: { from: editorView().state.doc.length, insert: " ENDE" } });
      await Promise.resolve();
    });
    await flush();
    const content = query(".cm-content");
    expect(content.contains(document.activeElement)).toBe(true);
    // macOS: Option+N is the dead key of "~".
    const next = await press(content, { key: "Dead", code: "KeyN", altKey: true });
    expect(next.defaultPrevented).toBe(true);
    expect(shown()).toBe("Overview");
    expect(container.querySelector(`${SHOWN} .cm-editor`)).toBeNull();
    expect(document.activeElement?.closest(".cm-editor") ?? null).toBeNull();
    expect(document.activeElement).toBe(query("[data-buffer]"));
    // Option+P is "π": back to the element, its text as it was typed (and saved on leaving, SR-105).
    await press(query("[data-buffer]"), { key: "π", code: "KeyP", altKey: true });
    expect(shown()).toBe("SR-000001 Title 1");
    expect(editorView().state.doc.toString()).toBe("Hello ENDE");
    await act(async () => {
      editorView().focus();
      await Promise.resolve();
    });
    const previous = await press(query(".cm-content"), { key: "π", code: "KeyP", altKey: true });
    expect(previous.defaultPrevented).toBe(true);
    expect(shown()).toBe("All elements");
    expect(document.activeElement?.closest(".cm-editor") ?? null).toBeNull();
  });

  it("[SR-115/AK-m5pg] with one buffer Alt+N switches nothing and is not taken", async () => {
    await render();
    expect(shown()).toBe("Overview");
    const next = await alt(query("[data-buffer]"), "n");
    expect(next.defaultPrevented).toBe(false);
    expect(shown()).toBe("Overview");
  });

  it("[SR-115/AK-m5pg] in an open prompt Alt+N and Alt+P switch nothing and are left to the input", async () => {
    await openFour();
    await press(window, { key: "p", ctrlKey: true });
    const input = query("input");
    for (const letter of ["n", "p"] as const) {
      const event = await alt(input, letter);
      expect(event.defaultPrevented).toBe(false);
    }
    const dead = await press(input, { key: "Dead", code: "KeyN", altKey: true });
    expect(dead.defaultPrevented).toBe(false);
    expect(container.querySelector("input")).not.toBeNull();
    expect(shown()).toBe("Search: wind");
  });

  it("[SR-163/AK-xtth] [SR-163/AK-v661] the mouse buttons Back and Forward do what Alt+P and Alt+N do, and never navigate", async () => {
    await openFour();
    await press(window, { key: "p", ctrlKey: true });
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000001 Title 1");
    const back = await mouse(query("[data-buffer]"), 3);
    expect(back.defaultPrevented).toBe(true);
    expect(shown()).toBe("Search: wind");
    await mouse(window, 3);
    expect(shown()).toBe("All elements");
    const forward = await mouse(window, 4);
    expect(forward.defaultPrevented).toBe(true);
    expect(shown()).toBe("Search: wind");
    // Other buttons are no shortcut.
    const left = await mouse(window, 0);
    expect(left.defaultPrevented).toBe(false);
    expect(shown()).toBe("Search: wind");
  });

  it("[SR-163/AK-xtth] the mouse button Back in the text editor switches as Alt+P does; the editor loses the focus", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await act(async () => {
      editorView().focus();
      await Promise.resolve();
    });
    await mouse(query(".cm-content"), 3);
    expect(shown()).toBe("All elements");
    expect(document.activeElement).toBe(query("[data-buffer]"));
  });

  it("[SR-163/AK-v661] with one buffer or an open prompt the mouse buttons switch nothing, as Alt+N", async () => {
    await render();
    await mouse(window, 4);
    expect(shown()).toBe("Overview");
    await openFour();
    await press(window, { key: "p", ctrlKey: true });
    await mouse(query("input"), 4);
    await mouse(query("input"), 3);
    expect(container.querySelector("input")).not.toBeNull();
    expect(shown()).toBe("Search: wind");
  });

  it("[SR-163/AK-bh0y] on macOS Cmd+[ and Cmd+] do what the mouse buttons Back and Forward do, also by the physical key", async () => {
    await openFour();
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    try {
      // The app reads the platform as it renders.
      await render();
      const back = await press(window, { key: "[", code: "BracketLeft", metaKey: true });
      expect(back.defaultPrevented).toBe(true);
      expect(shown()).toBe("SR-000001 Title 1");
      // A German layout: the physical key of "[" types "ü", of "]" "+".
      await press(query("[data-buffer]"), { key: "ü", code: "BracketLeft", metaKey: true });
      expect(shown()).toBe("All elements");
      await press(window, { key: "+", code: "BracketRight", metaKey: true });
      expect(shown()).toBe("SR-000001 Title 1");
      await press(window, { key: "]", code: "BracketRight", metaKey: true });
      expect(shown()).toBe("Search: wind");
      // Not with another modifier, and not in an open prompt.
      const shifted = await press(window, { key: "[", code: "BracketLeft", metaKey: true, shiftKey: true });
      expect(shifted.defaultPrevented).toBe(false);
      await press(window, { key: "p", metaKey: true });
      await press(query("input"), { key: "[", code: "BracketLeft", metaKey: true });
      await press(query("input"), { key: "]", code: "BracketRight", metaKey: true });
      expect(container.querySelector("input")).not.toBeNull();
      expect(shown()).toBe("Search: wind");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("[SR-163/AK-bh0y] on Linux and Windows Ctrl+[ and Ctrl+] switch nothing", async () => {
    await openFour();
    for (const init of [
      { key: "[", code: "BracketLeft", ctrlKey: true },
      { key: "[", code: "BracketLeft", metaKey: true },
      { key: "]", code: "BracketRight", ctrlKey: true },
      { key: "+", code: "BracketRight", metaKey: true },
    ]) {
      const event = await press(window, init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(shown()).toBe("Search: wind");
  });

  it("[SR-163/AK-fkcm] a swipe to the left does what the mouse button Back does, to the right what Forward does, also while a wheel coasts", async () => {
    await openFour();
    await press(window, { key: "p", ctrlKey: true });
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("SR-000001 Title 1");
    await wheel(query("[data-buffer]"));
    await swipe("left");
    expect(shown()).toBe("Search: wind");
    await swipe("left");
    expect(shown()).toBe("All elements");
    await wheel(query("[data-buffer]"));
    await swipe("right");
    expect(shown()).toBe("Search: wind");
    expect(document.activeElement).toBe(query("[data-buffer]"));
  });

  it("[SR-163/AK-fkcm] a swipe in the text editor switches as the mouse button does; the editor loses the focus", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await act(async () => {
      editorView().focus();
      await Promise.resolve();
    });
    await swipe("left");
    expect(shown()).toBe("All elements");
    expect(document.activeElement).toBe(query("[data-buffer]"));
  });

  it("[SR-163/AK-fkcm] with one buffer a swipe switches nothing", async () => {
    await render();
    await swipe("left");
    await swipe("right");
    expect(shown()).toBe("Overview");
  });

  it("[SR-163/AK-fkcm] with the command prompt open, a context menu or About ReqSeq a swipe switches nothing and closes nothing", async () => {
    await openFour();
    await press(window, { key: "p", ctrlKey: true });
    await swipe("left");
    await swipe("right");
    expect(container.querySelector("input")).not.toBeNull();
    expect(shown()).toBe("Search: wind");
    await press(query("input"), { key: "Escape" });
    expect(container.querySelector("input")).toBeNull();
    // The context menu, asked for by a key (the Menu key, Shift+F10: a `contextmenu` without a press).
    const menu = (): Element | null => document.querySelector('[role="menu"]');
    await act(async () => {
      query("[data-buffer]").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await flush();
    expect(menu()).not.toBeNull();
    await swipe("left");
    expect(menu()).not.toBeNull();
    expect(shown()).toBe("Search: wind");
    await press(window, { key: "Escape" });
    expect(menu()).toBeNull();
    // "About ReqSeq".
    await runCommand("About ReqSeq");
    const about = (): Element | null =>
      document.querySelector('[role="dialog"][aria-labelledby="about-title"]');
    expect(about()).not.toBeNull();
    await swipe("left");
    expect(about()).not.toBeNull();
    expect(shown()).toBe("Search: wind");
  });

  it("[SR-163/AK-fkcm] while the card of the next keys is shown a swipe switches nothing; before it is shown it ends the prefix key and switches", async () => {
    await openFour();
    const echo = (): string => query(".minibuffer").textContent;
    await press(window, { key: "k", ctrlKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PREFIX_DELAY_MS + 50));
    });
    await flush();
    expect(echo()).toContain("Ctrl+K");
    const card = echo();
    await swipe("left");
    expect(shown()).toBe("Search: wind");
    expect(echo()).toBe(card);
    await press(window, { key: "Escape" });
    // The prefix waits, the card is not shown yet: the swipe ends the prefix and switches.
    await press(window, { key: "k", ctrlKey: true });
    expect(echo()).toContain("Ctrl+K");
    await swipe("left");
    expect(shown()).toBe("SR-000001 Title 1");
    expect(echo()).not.toContain("Ctrl+K");
    // The prefix waits no longer: the next key is a shortcut again.
    await alt(window, "n");
    expect(shown()).toBe("Search: wind");
  });

  it("[SR-163/AK-fkcm] with the slash menu or the calendar open in the text editor a swipe switches nothing and closes neither", async () => {
    // A workspace that can be written: the text editor has its slash menu.
    writable = true;
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await act(async () => {
      editorView().focus();
      await Promise.resolve();
    });
    for (const char of ["\n", "/"]) {
      await act(async () => {
        const head = editorView().state.doc.length;
        editorView().dispatch({
          changes: { from: head, insert: char },
          selection: { anchor: head + 1 },
          userEvent: "input.type",
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    await flush();
    expect(completionStatus(editorView().state)).toBe("active");
    await swipe("left");
    expect(shown()).toBe("SR-000001 Title 1");
    expect(completionStatus(editorView().state)).toBe("active");
    await press(query(".cm-content"), { key: "Escape" });
    expect(completionStatus(editorView().state)).toBeNull();
    await act(async () => {
      askDate(editorView(), "2026-11-13");
      await Promise.resolve();
    });
    expect(calendarOpen(editorView().state)).toBe(true);
    await swipe("right");
    expect(shown()).toBe("SR-000001 Title 1");
    expect(calendarOpen(editorView().state)).toBe(true);
  });

  it('[SR-115/AK-m5pg] "Next buffer" and "Previous buffer" are commands of the prompt', async () => {
    await openFour();
    await runCommand("Next buffer");
    expect(shown()).toBe("Overview");
    await runCommand("Previous buffer");
    expect(shown()).toBe("Search: wind");
  });
});

describe("App, the switch to the previous or next buffer in motion (SR-212)", () => {
  const device = (): { prefersReducedMotion: string } =>
    (window as unknown as { happyDOM: { settings: { device: { prefersReducedMotion: string } } } }).happyDOM
      .settings.device;
  beforeEach(() => {
    device().prefersReducedMotion = "no-preference";
  });
  afterEach(() => {
    device().prefersReducedMotion = "reduce";
  });

  const picture = (): Element | null => container.querySelector('[data-layer="side"] .slide-picture');

  it("[SR-212/AK-kqvx] Alt+P shows the new buffer live with the focus at once, beside a picture of the left one that takes nothing; the next key ends it", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await act(async () => {
      editorView().focus();
      await Promise.resolve();
    });
    await press(query(".cm-content"), { key: "p", code: "KeyP", altKey: true });
    expect(shown()).toBe("All elements");
    // The left element stands as a picture after the live list, which has the focus and every query.
    expect(picture()?.textContent).toContain("Title 1");
    expect(picture()?.querySelector("[data-buffer], [contenteditable], [tabindex], [id^='row-']")).toBeNull();
    expect(container.querySelectorAll("[data-buffer]")).toHaveLength(1);
    expect(document.activeElement).toBe(query("[data-buffer]"));
    expect(query('[data-layer="main"]').querySelector(".cm-editor")).toBeNull();
    // The next key acts on the new buffer and ends the first slide at once: one more step back.
    await alt(query("[data-buffer]"), "p");
    expect(shown()).toBe("Overview");
    // The second slide, if one runs, leaves the list: the element's picture is gone.
    expect(picture()?.textContent ?? "All elements").toMatch(/^All elements/);
    // A key that is no switch ends it too, in the end state.
    await press(query("[data-buffer]"), { key: "ArrowDown" });
    expect(picture()).toBeNull();
    expect(query('[data-layer="main"]').style.transform).toBe("");
  });

  it("[SR-212/AK-d25h] [SR-212/AK-kqvx] a swipe slides as the mouse button does, and the next swipe ends the slide and acts on the new buffer", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    await swipe("left");
    expect(shown()).toBe("All elements");
    expect(picture()?.textContent).toContain("Title 1");
    expect(document.activeElement).toBe(query("[data-buffer]"));
    // The next swipe ends the first slide at once and goes one more step back.
    await swipe("left");
    expect(shown()).toBe("Overview");
    expect(picture()?.textContent ?? "All elements").toMatch(/^All elements/);
    // A swipe that switches nothing (a context menu is open) ends the slide too, in its end state.
    await swipe("right");
    expect(shown()).toBe("All elements");
    expect(picture()).not.toBeNull();
    await act(async () => {
      query("[data-buffer]").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await flush();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(picture()).not.toBeNull();
    await swipe("left");
    expect(shown()).toBe("All elements");
    expect(picture()).toBeNull();
    expect(query('[data-layer="main"]').style.transform).toBe("");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("a switch to the overview whose counts cannot be read slides without waiting for the guard (#1664)", async () => {
    const failing = vi
      .spyOn(bridge, "invoke")
      .mockImplementation((name, input) =>
        name === "element.facets"
          ? Promise.resolve({ ok: false, error: { code: "core.stopped", message: "stopped" } as never })
          : Promise.resolve({ ok: true, output: HANDLERS[name]?.((input ?? {}) as Record<string, unknown>) }),
      );
    const animate = vi.spyOn(HTMLElement.prototype, "animate");
    try {
      await render();
      await runCommand("List all elements");
      expect(shown()).toBe("All elements");
      animate.mockClear();
      await alt(query("[data-buffer]"), "p");
      expect(shown()).toBe("Overview");
      // Well before the guard of the slide (DRAW_DEADLINE_MS, 1 s): the failed read counts as drawn.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      expect(animate).toHaveBeenCalled();
    } finally {
      failing.mockRestore();
      animate.mockRestore();
    }
  });

  it("[SR-212/AK-hmwp] opening an element, Ctrl+P and closing a buffer show the other buffer without a picture", async () => {
    await render();
    await runCommand("List all elements");
    await press(query('[role="listbox"]'), { key: "Enter" });
    expect(picture()).toBeNull();
    await runCommand("Close buffer");
    expect(shown()).toBe("All elements");
    expect(picture()).toBeNull();
    await press(window, { key: "p", ctrlKey: true });
    await type("Overview");
    await press(query("input"), { key: "Enter" });
    expect(shown()).toBe("Overview");
    expect(picture()).toBeNull();
  });

  it("[SR-212/AK-kzb2] with reduced motion Alt+P shows the new buffer at once, without a picture", async () => {
    device().prefersReducedMotion = "reduce";
    await openFour();
    await alt(query("[data-buffer]"), "p");
    expect(shown()).toBe("SR-000001 Title 1");
    expect(picture()).toBeNull();
  });
});
