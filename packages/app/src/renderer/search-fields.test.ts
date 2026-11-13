// @vitest-environment happy-dom
// The fields of a search in the command prompt (SR-216 AK6 to AK10, SR-134 AK4): Ctrl/Cmd+Enter at the search words
// asks for them as hits from `element.searchFields`, each chosen one a mark before the words; the hits while typing
// and the list of search hits come only from them, and the list names them under its heading.
import "../../../../scripts/test-support/dom-selection.mjs";
import type { ElementSearchOutput } from "@reqseq/core";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionContext, Prompt } from "./actions.js";
import { ACTIONS, CARD_LINES } from "./actions.js";
import type { BufferAction, SearchBuffer, SearchField } from "./buffers.js";
import { bufferName, searchBuffer, withSearchQuery } from "./buffers.js";
import { loadSession, restoreSession, saveSession, sessionText } from "./buffer-session.js";
import type { SessionStorage } from "./buffer-session.js";
import type { Call } from "./call.js";
import { textStep } from "./list-filters.js";
import { Minibuffer } from "./Minibuffer.js";
import { offeredFields, withField } from "./search-fields.js";
import type { CommandListing } from "../shared/protocol.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The fields `element.searchFields` lists for the fixture of SR-216. */
const FIELDS: readonly SearchField[] = [
  { key: "title", name: "Title" },
  { key: "text", name: "Text" },
  { key: "id", name: "IDs" },
  { key: "properties", name: "All properties" },
  { key: "rationale", name: "Rationale" },
  { key: "acceptance-criteria", name: "Acceptance Criteria" },
];

const SUMMARY = "Full-text search of the elements of a selection in all fields or only in chosen ones.";
const FIELDS_TEXT = "Search only in these fields; default all.";

/** The catalog command the search runs, with the description of its `fields`. */
const CATALOG = [
  {
    name: "element.search",
    title: "Search elements",
    summary: SUMMARY,
    input: { type: "object", properties: { fields: { description: FIELDS_TEXT } } },
  },
] as unknown as readonly CommandListing[];

const field = (key: string): SearchField => FIELDS.find((one) => one.key === key) ?? { key, name: key };

const hits = (count: number): ElementSearchOutput => ({
  hits: Array.from({ length: count }, (_, at) => ({
    id: `u${String(at)}`,
    repository: "spec",
    shortId: `SR-00000${String(at)}`,
    identifier: `SR-${String(at)}`,
    title: `Gust ${String(at)}`,
    status: "draft",
    type: "system-requirement",
    score: 1,
    fields: ["text"],
    terms: ["gust"],
    titleMarks: [],
  })),
  total: count,
  incomplete: false,
});

describe("the fields offered", () => {
  it("[SR-216/AK-t56j] leaves out the fields taken and, after all properties, every single property", () => {
    expect(offeredFields(FIELDS, ["text"]).map((one) => one.key)).toEqual([
      "title",
      "id",
      "properties",
      "rationale",
      "acceptance-criteria",
    ]);
    expect(offeredFields(FIELDS, ["title", "properties"]).map((one) => one.key)).toEqual(["text", "id"]);
    // All properties takes the place of the single properties chosen before; title, text and IDs stay.
    expect(withField([field("rationale"), field("title")], field("properties"))).toEqual([
      field("title"),
      field("properties"),
    ]);
    expect(withField([field("title")], field("rationale"))).toEqual([field("title"), field("rationale")]);
  });
});

describe("the list of search hits in fields", () => {
  const fields = [field("acceptance-criteria"), field("text")];

  it("[SR-216/AK-yq3n] is another list than the same words in other fields, names its fields, keeps them when the filters are cleared and across a restart", async () => {
    const plain = searchBuffer("gust");
    const restricted = searchBuffer("gust", [], undefined, fields);
    const other = searchBuffer("gust", [], undefined, [field("rationale")]);
    expect(new Set([plain.key, restricted.key, other.key]).size).toBe(3);
    expect(plain.fields).toBeUndefined();
    expect(bufferName(restricted)).toBe("Search: gust · in Acceptance Criteria, Text");
    expect(bufferName(plain)).toBe("Search: gust");

    // The fields are no filter step: "Clear all list filters" keeps them.
    const filtered = withSearchQuery(restricted, { steps: [textStep("mast")] });
    expect(filtered.fields).toEqual(fields);
    const dispatched: BufferAction[] = [];
    const context = {
      workspace: true,
      buffers: [filtered],
      dispatch: (action: BufferAction) => dispatched.push(action),
      echo: vi.fn(),
    } as unknown as ActionContext;
    ACTIONS.find((action) => action.id === "clear-filters")?.run(context);
    const cleared = dispatched[0]?.type === "open" ? (dispatched[0].buffer as SearchBuffer) : undefined;
    expect(cleared?.steps).toEqual([]);
    expect(cleared?.fields).toEqual(fields);
    expect(cleared?.key).toBe(restricted.key);

    // Closed and opened again (SR-115 AK4): the same list with the same fields.
    const stored = new Map<string, string>();
    const storage: SessionStorage = {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => {
        stored.set(key, value);
      },
    };
    saveSession(() => storage, "key", sessionText([restricted, plain]));
    const session = loadSession(() => storage, "key");
    const call = vi.fn(() => Promise.resolve({ ok: true, output: {} })) as unknown as Call;
    const restored = await restoreSession(session, call, () => Promise.resolve([]));
    expect(restored.buffers).toEqual([restricted, plain]);
    // Fields that are no list of keys and names are not taken back.
    for (const broken of [[], [{ key: "text" }], "text"]) {
      stored.set("key", JSON.stringify({ buffers: [{ kind: "search", query: "gust", fields: broken }] }));
      expect(loadSession(() => storage, "key").buffers).toEqual([]);
    }
  });
});

describe("the field choice of the search prompt", () => {
  let container: HTMLElement;
  let root: Root;
  let serial = 0;
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
  const click = async (element: Element | null | undefined, event = "click"): Promise<void> => {
    if (element === null || element === undefined) {
      throw new Error("nothing to click");
    }
    await act(async () => {
      element.dispatchEvent(new MouseEvent(event, { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await flush();
  };
  const label = (): string => container.querySelector("label")?.textContent ?? "";
  const options = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  const rows = (): [string, string][] =>
    options().map((option) => [
      option.querySelector(".name")?.textContent ?? "",
      option.querySelector(".hint")?.textContent ?? "",
    ]);
  const chosen = (): string[] =>
    options()
      .filter((option) => option.getAttribute("aria-selected") === "true")
      .map((option) => option.querySelector(".name")?.textContent ?? "");
  const option = (name: string): HTMLElement | undefined =>
    options().find((one) => one.querySelector(".name")?.textContent === name);
  const marks = (): string[] =>
    [...container.querySelectorAll(".prompt-mark-label")].map((mark) => mark.textContent);
  const explanation = (): [string, string] => [
    container.querySelector(".explain-text")?.textContent ?? "",
    container.querySelector(".explain-keys")?.textContent ?? "",
  ];

  /** The search prompt in the minibuffer; each prompt it asks takes its place, and a closed one goes. */
  const mount = async (
    answers: {
      readonly search?: (input: Record<string, unknown>) => unknown;
      readonly fields?: unknown;
    } = {},
  ) => {
    const dispatched: BufferAction[] = [];
    const echoed: string[] = [];
    const call = vi.fn((name: string, given: Record<string, unknown>) => {
      const out =
        name === "element.searchFields" ? (answers.fields ?? { fields: FIELDS }) : answers.search?.(given);
      return Promise.resolve(
        out instanceof Error
          ? { ok: false, code: "input.invalid", message: out.message }
          : { ok: true, output: out ?? hits(1) },
      );
    });
    const show = (prompt: Prompt | undefined): void => {
      serial += 1;
      root.render(
        createElement(Minibuffer, {
          echo: "",
          prompt: prompt === undefined ? undefined : { serial, prompt },
          onCommand: vi.fn(),
          onClose: () => {
            show(undefined);
          },
        }),
      );
    };
    const context = {
      workspace: true,
      buffers: [],
      call: call as unknown as Call,
      dispatch: (action: BufferAction) => dispatched.push(action),
      ask: show,
      echo: (message: string) => echoed.push(message),
      catalog: () => CATALOG,
    } as unknown as ActionContext;
    await act(async () => {
      ACTIONS.find((action) => action.id === "search")?.run(context);
      await Promise.resolve();
    });
    await flush();
    return { call, dispatched, echoed };
  };

  it("[SR-216/AK-t56j] [SR-216/AK-s99w] Ctrl/Cmd+Enter or a click on its key shows core's fields as hits with the key beside; Enter sets a mark, and the first hit goes back to the kept words", async () => {
    const { call } = await mount();
    await type("gust");
    await press("Enter", { ctrlKey: true });
    expect(label()).toBe("Search · fields:");
    expect(call).toHaveBeenCalledWith("element.searchFields", {});
    expect(rows()).toEqual([
      ["Search all fields", ""],
      ["Title", "title"],
      ["Text", "text"],
      ["IDs", "id"],
      ["All properties", "properties"],
      ["Rationale", "rationale"],
      ["Acceptance Criteria", "acceptance-criteria"],
    ]);
    expect(chosen()).toEqual(["Search all fields"]);
    // Typing narrows them, fuzzily.
    await type("acptn");
    expect(rows().map(([name]) => name)).toContain("Acceptance Criteria");
    expect(rows().map(([name]) => name)).not.toContain("Rationale");
    await click(option("Acceptance Criteria"), "mousedown");
    expect(marks()).toEqual(["Acceptance Criteria"]);
    expect(input().value).toBe("");
    expect(chosen()).toEqual(["Search in 1 field"]);
    expect(rows().map(([name]) => name)).not.toContain("Acceptance Criteria");
    await type("text");
    await press("ArrowDown");
    await press("Enter");
    expect(marks()).toEqual(["Acceptance Criteria", "Text"]);
    expect(chosen()).toEqual(["Search in 2 fields"]);
    // Back to the search words: the marks stand before them, and the words stay.
    await press("Enter");
    expect(label()).toBe("Search");
    expect(marks()).toEqual(["Acceptance Criteria", "Text"]);
    expect(input().value).toBe("gust");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "gust",
      fields: ["acceptance-criteria", "text"],
      limit: CARD_LINES,
    });
    // A click on Ctrl/Cmd+Enter in the explanation line chooses the fields too.
    await click(container.querySelector(".explain-keys button"));
    expect(label()).toBe("Search · fields:");
    expect(marks()).toEqual(["Acceptance Criteria", "Text"]);
  });

  it("[SR-216/AK-t56j] after all properties no mark of a single property stands, and none is offered", async () => {
    await mount();
    await press("Enter", { ctrlKey: true });
    for (const name of ["Rationale", "Title", "All properties"]) {
      await click(option(name), "mousedown");
    }
    expect(marks()).toEqual(["Title", "All properties"]);
    expect(rows().map(([name]) => name)).toEqual(["Search in 2 fields", "Text", "IDs"]);
  });

  it("[SR-216/AK-vd3h] [SR-134/AK-fmf6] the × of a mark removes it; Backspace on an empty input removes the last mark at the search words and in the field choice; Escape goes back with the marks", async () => {
    await mount();
    await type("gust");
    await press("Enter", { ctrlKey: true });
    for (const name of ["Title", "Text", "Rationale"]) {
      await click(option(name), "mousedown");
    }
    // In the field choice: Backspace on the empty input removes the last mark, and the field is offered again.
    await press("Backspace");
    expect(label()).toBe("Search · fields:");
    expect(marks()).toEqual(["Title", "Text"]);
    expect(rows().map(([name]) => name)).toContain("Rationale");
    // The × of a mark removes that one.
    await click(container.querySelector('[aria-label="Remove Title"]'));
    expect(marks()).toEqual(["Text"]);
    await click(option("Rationale"), "mousedown");
    // Escape: back to the search words with the marks and the words.
    await press("Escape");
    expect(label()).toBe("Search");
    expect(marks()).toEqual(["Text", "Rationale"]);
    expect(input().value).toBe("gust");
    // At the search words, Backspace on an empty input removes the last mark; on text it deletes as always.
    await press("Backspace");
    expect(marks()).toEqual(["Text", "Rationale"]);
    await type("");
    await press("Backspace");
    expect(label()).toBe("Search");
    expect(marks()).toEqual(["Text"]);
    // The × keeps the words typed.
    await type("mast");
    await click(container.querySelector('[aria-label="Remove Text"]'));
    expect(marks()).toEqual([]);
    expect(input().value).toBe("mast");
    // In the field choice without a mark, Backspace goes back to the search words, as Escape does.
    await press("Enter", { ctrlKey: true });
    await press("Backspace");
    expect(label()).toBe("Search");
    expect(input().value).toBe("mast");
    // At the search words without a mark, Escape closes the prompt.
    await press("Escape");
    expect(container.querySelector("input")).toBeNull();
  });

  it("[SR-216/AK-v450] the explanation line says the summary of Search elements and the keys at the search words, the name and description of fields in the field choice", async () => {
    await mount();
    expect(explanation()).toEqual([
      SUMMARY,
      "Enter opens the list of search hits · Ctrl+Enter chooses fields · Escape closes",
    ]);
    await press("Enter", { ctrlKey: true });
    expect(explanation()).toEqual([`fields · ${FIELDS_TEXT}`, "Enter adds the field · Escape back"]);
    await click(option("Text"), "mousedown");
    expect(explanation()[1]).toBe(
      "Enter adds the field · Backspace on an empty input removes the last mark · Escape back",
    );
    await press("Escape");
    expect(explanation()[1]).toBe(
      "Enter opens the list of search hits · Ctrl+Enter chooses fields · Backspace on an empty input removes the last mark · Escape closes",
    );
  });

  it("[SR-216/AK-gg4w] the hits while typing come from the chosen fields, as the list of search hits Enter opens asks them; a new search starts without fields", async () => {
    const { call, dispatched } = await mount({ search: () => hits(2) });
    await press("Enter", { ctrlKey: true });
    await click(option("Rationale"), "mousedown");
    await press("Escape");
    await type("gust");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "gust",
      fields: ["rationale"],
      limit: CARD_LINES,
    });
    expect(options()).toHaveLength(2);
    await press("Enter");
    expect(dispatched).toEqual([
      { type: "open", buffer: searchBuffer("gust", [], undefined, [field("rationale")]) },
    ]);
    const again = await mount();
    expect(marks()).toEqual([]);
    expect(again.call).not.toHaveBeenCalled();
  });

  it("[SR-216/AK-r9jg] a field core refuses shows core's message, and so does a field choice core cannot list", async () => {
    const { echoed } = await mount({ search: () => new Error("Unknown search field: gone") });
    await type("gust");
    expect(echoed).toEqual(["Unknown search field: gone"]);
    expect(options()).toEqual([]);
    await mount({ fields: new Error("No workspace is open") });
    await press("Enter", { ctrlKey: true });
    expect(label()).toBe("No workspace is open · Search · fields:");
    expect(rows()).toEqual([["Search all fields", ""]]);
  });
});
