// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (#460).
import "../../../../scripts/test-support/dom-selection.mjs";
// Saving without a save command in the element buffer (SR-105): one second after the last input, at once
// when a prompt opens or the buffer is closed, and undo and redo since the buffer was opened, also for a
// choice. The scheduler itself is tested in `autosave.test.ts`, leaving and coming back in `App.test.ts`.
import type { DataExportElement } from "@reqseq/core";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementControls, Prompt } from "./actions.js";
import { AUTOSAVE_MS } from "./autosave.js";
import type { BufferKeep, UndoMemory } from "./buffer-memory.js";
import { elementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { Draft } from "./drafts.js";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import { ElementView } from "./ElementView.js";
import { referenceTitles } from "./reference-titles.js";
import type { BufferData } from "./modeline.js";
import { GONE_CONFIRM_MS } from "./outside-change.js";

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

const AREA: PropertyInfo = {
  name: "Area",
  kind: "choice",
  many: false,
  markdown: false,
  choices: [
    { key: "quality", name: "Quality" },
    { key: "interface", name: "Interface" },
  ],
};
const MODEL: PropertyModel = new Map([
  [
    "requirement",
    new Map<string, PropertyInfo>([
      ["topic", { kind: "text", many: false, markdown: false }],
      ["note", { kind: "text", many: false, markdown: false }],
      ["area", AREA],
    ]),
  ],
]);

const NAME = "SR-1 Measure wind";

const failure = (code: string, message: string): Error => Object.assign(new Error(message), { code });

/** The file of one element: what `element.get` reads, and what `element.update` writes as core does. */
const disk = (readOnly = false, text = "first") => {
  const file = {
    text,
    properties: { topic: "Wind", area: "quality" } as Record<string, unknown>,
    sha: "sha-0",
    writes: 0,
    gone: false,
    /** The next write fails with this error. */
    refuse: undefined as Error | undefined,
    /** Problems the next answers give. */
    problems: undefined as { message: string }[] | undefined,
  };
  const element = (): DataExportElement =>
    ({
      id: "uuid-1",
      shortId: "SR-000001",
      identifier: "SR-1",
      type: "requirement",
      status: "draft",
      title: "Measure wind",
      text: file.text,
      repository: "spec",
      file: "a.md",
      properties: file.properties,
      relations: [],
      ...(file.problems === undefined ? {} : { problems: file.problems }),
      ...(readOnly ? { readOnly } : {}),
    }) as unknown as DataExportElement;
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
    "element.get": () =>
      file.gone
        ? failure("ref.unknown", "uuid-1 is not an element")
        : { element: element(), fileSha256: file.sha },
    "element.update": (input) => {
      if (file.refuse !== undefined) {
        return file.refuse;
      }
      if (file.gone) {
        return failure("ref.unknown", "uuid-1 is not an element");
      }
      if (input["expectedFileSha256"] !== file.sha) {
        return failure("file.changed-on-disk", "Not written: a.md changed on disk since it was read.");
      }
      file.writes += 1;
      file.text = typeof input["text"] === "string" ? input["text"] : file.text;
      const set = (input["set"] ?? {}) as Record<string, unknown>;
      const unset = (input["unset"] ?? []) as string[];
      file.properties = Object.fromEntries(
        Object.entries({ ...file.properties, ...set }).filter(([key]) => !unset.includes(key)),
      );
      file.sha = `sha-${String(file.writes)}`;
      return {
        element: element(),
        fileSha256: file.sha,
        files: ["a.md"],
        affected: 0,
        ...(file.problems === undefined ? {} : { problems: file.problems }),
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
    readonly keep?: BufferKeep;
    readonly readOnly?: boolean;
    readonly text?: string;
  } = {},
) => {
  const fake = disk(options.readOnly, options.text);
  const echoed: string[] = [];
  const data: (BufferData | undefined)[] = [];
  const drafts: (Draft | undefined)[] = [];
  const registered: (ElementControls | undefined)[] = [];
  const asked: Prompt[] = [];
  let revision = 0;
  const titles = referenceTitles(fake.call as unknown as Call);
  const node = () =>
    createElement(ElementView, {
      call: fake.call as unknown as Call,
      titles,
      buffer: elementBuffer("uuid-1", "spec", NAME),
      revision,
      onData: (_key, loaded) => data.push(loaded),
      onEcho: (message) => echoed.push(message),
      onCopy: () => undefined,
      onOpenRelation: () => undefined,
      onOpenTarget: () => undefined,
      onPickElement: () => undefined,
      onAsk: (prompt) => asked.push(prompt),
      draft: options.draft,
      onDraft: (_key, kept) => drafts.push(kept),
      register: (controls) => registered.push(controls),
      packages: undefined,
      properties: MODEL,
      dispatch: () => undefined,
      ...(options.keep === undefined ? {} : { keep: options.keep }),
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
    asked,
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
const viewIn = (selector: string): EditorView => {
  const found = EditorView.findFromDOM(query(`${selector} .cm-editor`));
  if (found === null) {
    throw new Error("no editor");
  }
  return found;
};
const textView = (): EditorView => viewIn('[data-field="Text"]');
const typeAt = async (view: EditorView, insert: string, at = view.state.doc.length): Promise<void> => {
  await act(async () => {
    view.dispatch({ changes: { from: at, insert }, userEvent: "input.type" });
    await Promise.resolve();
  });
};
const press = async (
  target: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
    await Promise.resolve();
  });
  return event;
};
const modeline = (data: (BufferData | undefined)[]): BufferData | undefined => data.at(-1);

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

describe("autosave in the element buffer (SR-105)", () => {
  it("[SR-105/AK1] one second without input writes the text and the changed boxes with one element.update", async () => {
    const { updates, echoed, file } = await mountView();
    await typeAt(textView(), " more");
    await settle(400);
    await typeAt(viewIn('[data-field="topic"]'), "y");
    await settle(AUTOSAVE_MS - 1);
    expect(updates()).toEqual([]);
    await settle(1);
    expect(updates()).toEqual([
      {
        ref: "uuid-1",
        text: "first more",
        set: { topic: "Windy" },
        expectedFileSha256: "sha-0",
      },
    ]);
    expect(file.text).toBe("first more");
    // A successful autosave says nothing (D-062).
    expect(echoed).toEqual([]);
    await settle(AUTOSAVE_MS * 3);
    expect(updates()).toHaveLength(1);
  });

  it("drops the draft and the mark modified after the save, and saves input typed meanwhile one second after it", async () => {
    const { updates, drafts, call } = await mountView();
    // The first save answers only when the test says so.
    let answer: (() => void) | undefined;
    const real = call.getMockImplementation();
    call.mockImplementationOnce(
      (name, input) =>
        new Promise((resolve) => {
          answer = () => {
            void real?.(name, input).then(resolve);
          };
        }),
    );
    await typeAt(textView(), "!");
    await settle(AUTOSAVE_MS);
    expect(answer).toBeDefined();
    await typeAt(textView(), "?");
    await settle(AUTOSAVE_MS * 2);
    // In flight: the input waits for the answer.
    expect(call.mock.calls.filter(([name]) => name === "element.update")).toHaveLength(1);
    await act(async () => {
      answer?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    // The second has passed: the rest goes at once.
    await settle();
    expect(updates()).toEqual([
      { ref: "uuid-1", text: "first!", expectedFileSha256: "sha-0" },
      { ref: "uuid-1", text: "first!?", expectedFileSha256: "sha-1" },
    ]);
    await settle();
    expect(drafts.at(-1)).toBeUndefined();
  });

  it("[SR-105/AK2] an undo while a save runs, back to the text before it, stays in the editors and is saved next", async () => {
    const { updates, call } = await mountView();
    let answer: (() => void) | undefined;
    const real = call.getMockImplementation();
    call.mockImplementationOnce(
      (name, input) =>
        new Promise((resolve) => {
          answer = () => {
            void real?.(name, input).then(resolve);
          };
        }),
    );
    const topic = viewIn('[data-field="topic"]');
    await typeAt(textView(), "!");
    await typeAt(topic, "y");
    await settle(AUTOSAVE_MS);
    expect(answer).toBeDefined();
    // The save runs; both edits are undone before it answers.
    await act(async () => {
      undo(topic);
      undo(textView());
      await Promise.resolve();
    });
    await act(async () => {
      answer?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    await settle();
    // The editors keep the undone state; they do not take the saved text.
    expect(textView().state.doc.toString()).toBe("first");
    expect(topic.state.doc.toString()).toBe("Wind");
    await settle(AUTOSAVE_MS);
    expect(updates()).toEqual([
      { ref: "uuid-1", text: "first!", set: { topic: "Windy" }, expectedFileSha256: "sha-0" },
      { ref: "uuid-1", text: "first", set: { topic: "Wind" }, expectedFileSha256: "sha-1" },
    ]);
  });

  it("a failed save says why once and leaves not saved in the modeline; the next input tries again, no loop", async () => {
    const { updates, echoed, data, file } = await mountView();
    file.refuse = new Error("effort must be a number");
    await typeAt(textView(), "!");
    await settle(AUTOSAVE_MS);
    expect(echoed).toEqual(["effort must be a number"]);
    expect(modeline(data)).toMatchObject({ notSaved: true });
    await settle(AUTOSAVE_MS * 5);
    expect(updates()).toHaveLength(1);
    // The same reason again is not said again.
    await typeAt(textView(), "?");
    await settle(AUTOSAVE_MS);
    expect(updates()).toHaveLength(2);
    expect(echoed).toEqual(["effort must be a number"]);
    file.refuse = undefined;
    await typeAt(textView(), ".");
    await settle(AUTOSAVE_MS);
    expect(updates()).toHaveLength(3);
    expect(modeline(data)).not.toHaveProperty("notSaved");
    expect(file.text).toBe("first!?.");
  });

  it("says a hint of core once, not after every pause", async () => {
    const { echoed, file } = await mountView();
    file.problems = [{ message: "topic: the value is unusual" }];
    await typeAt(viewIn('[data-field="topic"]'), "y");
    await settle(AUTOSAVE_MS);
    await typeAt(viewIn('[data-field="topic"]'), "y");
    await settle(AUTOSAVE_MS);
    expect(echoed).toEqual([`Saved ${NAME}. topic: the value is unusual`]);
  });

  it("waits while an input method composes, and saves when it ends", async () => {
    const { updates } = await mountView();
    const composing = vi.spyOn(textView(), "composing", "get").mockReturnValue(true);
    await typeAt(textView(), "日");
    await settle(AUTOSAVE_MS * 3);
    expect(updates()).toEqual([]);
    composing.mockReturnValue(false);
    // The end of a composition is an update of the editor.
    await act(async () => {
      textView().dispatch({ selection: { anchor: 0 } });
      await Promise.resolve();
    });
    await settle();
    expect(updates()).toEqual([{ ref: "uuid-1", text: "first日", expectedFileSha256: "sha-0" }]);
  });

  it("[SR-105/AK1] a prompt that opens saves the input at once (binding review point 6)", async () => {
    const { updates, controls } = await mountView();
    await typeAt(textView(), "!");
    await act(async () => {
      controls().prompting();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updates()).toEqual([{ ref: "uuid-1", text: "first!", expectedFileSha256: "sha-0" }]);
    // Nothing to save: no write.
    await act(async () => {
      controls().prompting();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updates()).toHaveLength(1);
  });

  it("[SR-105/AK1] closing saves at once (flush): true when nothing is left unsaved", async () => {
    const { updates, controls, file } = await mountView();
    await typeAt(textView(), "!");
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await controls().flush();
    });
    expect(flushed).toBe(true);
    expect(updates()).toHaveLength(1);
    file.refuse = new Error("no");
    await typeAt(textView(), "?");
    await act(async () => {
      flushed = await controls().flush();
    });
    expect(flushed).toBe(false);
  });

  it("[SR-105/AK1] a flush says input is left when keys were typed while its save ran, and the draft keeps them (#604 review, S1)", async () => {
    const { updates, controls, call, drafts } = await mountView();
    let answer: (() => void) | undefined;
    const real = call.getMockImplementation();
    call.mockImplementationOnce(
      (name, input) =>
        new Promise((resolve) => {
          answer = () => {
            void real?.(name, input).then(resolve);
          };
        }),
    );
    await typeAt(textView(), "!");
    let flushed: boolean | undefined;
    let flush: Promise<void> | undefined;
    await act(async () => {
      flush = controls()
        .flush()
        .then((done) => {
          flushed = done;
        });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(answer).toBeDefined();
    await typeAt(textView(), "?");
    await act(async () => {
      answer?.();
      await flush;
    });
    expect(flushed).toBe(false);
    expect(updates()).toEqual([{ ref: "uuid-1", text: "first!", expectedFileSha256: "sha-0" }]);
    expect(textView().state.doc.toString()).toBe("first!?");
    expect(drafts.at(-1)?.text).toBe("first!?");
    // A second flush writes the rest, and then nothing is left.
    await act(async () => {
      flushed = await controls().flush();
    });
    expect(flushed).toBe(true);
    expect(updates().at(-1)).toEqual({ ref: "uuid-1", text: "first!?", expectedFileSha256: "sha-1" });
  });

  it("[SR-106/AK2] a conflict stops autosave: nothing is written until the user chose", async () => {
    const { updates, file, reload, echoed, controls } = await mountView();
    await typeAt(textView(), "!");
    file.text = "theirs";
    file.sha = "sha-outside";
    await reload();
    expect(echoed).toEqual([`${NAME} changed on disk. Resolve with "Resolve change on disk"`]);
    await settle(AUTOSAVE_MS * 3);
    await typeAt(textView(), "?");
    await settle(AUTOSAVE_MS * 3);
    expect(updates()).toEqual([]);
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await controls().flush();
    });
    expect(flushed).toBe(false);
    expect(updates()).toEqual([]);
  });

  it("[SR-106/AK3] a deleted file stops autosave; while the buffer asks again, Ctrl+S says why it writes nothing", async () => {
    const { updates, file, reload, echoed, controls } = await mountView();
    await typeAt(textView(), "!");
    file.gone = true;
    await reload();
    // The first read that finds no element: the buffer asks again, and writes nothing meanwhile (N10).
    await act(async () => {
      controls().save();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(echoed.at(-1)).toBe(`${NAME} cannot be read now; it may have been deleted on disk`);
    await settle(GONE_CONFIRM_MS);
    expect(echoed.at(-1)).toBe(
      `${NAME} was deleted on disk; its content stays here until you close the buffer`,
    );
    await typeAt(textView(), "?").catch(() => undefined);
    await settle(AUTOSAVE_MS * 3);
    expect(updates()).toEqual([]);
  });

  it("asks again for the full wait after another failure between two reads that find the file gone (N9)", async () => {
    const { file, reload, echoed, call } = await mountView();
    file.gone = true;
    await reload();
    file.gone = false;
    const real = call.getMockImplementation();
    call.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, code: "file.faulty", message: "a.md is faulty" }),
    );
    await reload();
    expect(echoed).toEqual(["a.md is faulty"]);
    call.mockImplementation((name, input) => real?.(name, input) ?? Promise.reject(new Error("no")));
    await settle(GONE_CONFIRM_MS * 2);
    file.gone = true;
    await reload();
    // Not declared deleted at once: the wait starts again.
    expect(echoed.some((message) => message.includes("was deleted on disk"))).toBe(false);
    await settle(GONE_CONFIRM_MS);
    expect(echoed.at(-1)).toContain("was deleted on disk");
  });

  it("the file that is back after a first read found it gone saves the input typed meanwhile", async () => {
    const { file, reload, updates } = await mountView();
    file.gone = true;
    await reload();
    await typeAt(textView(), "!");
    await settle(AUTOSAVE_MS);
    expect(updates()).toEqual([]);
    file.gone = false;
    await reload();
    await settle(AUTOSAVE_MS);
    expect(updates()).toEqual([{ ref: "uuid-1", text: "first!", expectedFileSha256: "sha-0" }]);
  });

  it("drops a read asked before a save answered: the save's answer is newer", async () => {
    const { call, file, reload, controls } = await mountView();
    // The next read answers with the file as it was, only when the test says so.
    let answer: (() => void) | undefined;
    const real = call.getMockImplementation();
    const before = { ...file };
    call.mockImplementationOnce(
      (name, input) =>
        new Promise((resolve) => {
          answer = () => {
            void real?.(name, input).then(resolve);
          };
        }),
    );
    await reload();
    await typeAt(textView(), "!");
    await act(async () => {
      await controls().flush();
    });
    expect(file.text).toBe("first!");
    Object.assign(file, { text: before.text, sha: before.sha });
    await act(async () => {
      answer?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(textView().state.doc.toString()).toBe("first!");
  });

  it("a read-only element saves nothing", async () => {
    const { updates, controls, echoed } = await mountView({ readOnly: true });
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await controls().flush();
    });
    expect(flushed).toBe(true);
    await act(async () => {
      controls().save();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(echoed).toEqual([`${NAME} is read-only`]);
    expect(updates()).toEqual([]);
  });

  it("[SR-105/AK2] Ctrl/Cmd+Z after an autosave restores the text before it, and autosave writes that", async () => {
    const { file } = await mountView();
    await typeAt(textView(), " more");
    await settle(AUTOSAVE_MS);
    expect(file.text).toBe("first more");
    await act(async () => {
      expect(undo(textView())).toBe(true);
      await Promise.resolve();
    });
    expect(textView().state.doc.toString()).toBe("first");
    await settle(AUTOSAVE_MS);
    expect(file.text).toBe("first");
    await act(async () => {
      expect(redo(textView())).toBe(true);
      await Promise.resolve();
    });
    await settle(AUTOSAVE_MS);
    expect(file.text).toBe("first more");
  });

  it("[SR-105/AK2] Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z on a choice step through its values since the buffer was opened", async () => {
    const { file, asked } = await mountView();
    const area = query('[data-field="area"]');
    await act(async () => {
      area.focus();
      await Promise.resolve();
    });
    await press(area, "Enter");
    await choose(asked, "Interface");
    await settle(AUTOSAVE_MS);
    expect(file.properties["area"]).toBe("interface");
    await press(area, "z", { ctrlKey: true });
    expect(area.textContent).toContain("quality");
    await settle(AUTOSAVE_MS);
    expect(file.properties["area"]).toBe("quality");
    const again = await press(area, "Z", { ctrlKey: true, shiftKey: true });
    expect(again.defaultPrevented).toBe(true);
    expect(area.textContent).toContain("interface");
    await settle(AUTOSAVE_MS);
    expect(file.properties["area"]).toBe("interface");
    // Nothing more to redo: the value stays.
    await press(area, "y", { ctrlKey: true });
    expect(area.textContent).toContain("interface");
  });

  it('[SR-106/AK2] "Take the file" on a choice is a change Ctrl/Cmd+Z takes back', async () => {
    const { file, asked, reload, controls } = await mountView();
    const area = query('[data-field="area"]');
    await act(async () => {
      area.focus();
      await Promise.resolve();
    });
    await press(area, "Enter");
    await choose(asked, "Interface");
    file.properties = { topic: "Calm", area: "quality" };
    file.sha = "sha-outside";
    await reload();
    expect(controls().resolve).toBeDefined();
    await act(async () => {
      controls().resolve?.();
      await Promise.resolve();
    });
    await choose(asked, "Take the file");
    expect(area.textContent).toContain("quality");
    await press(area, "z", { ctrlKey: true });
    expect(area.textContent).toContain("interface");
  });

  it("keeps a box that a save empties when it was typed in while the save ran (#348)", async () => {
    const { call, file } = await mountView();
    let answer: (() => void) | undefined;
    const real = call.getMockImplementation();
    call.mockImplementationOnce(
      (name, input) =>
        new Promise((resolve) => {
          answer = () => {
            void real?.(name, input).then(resolve);
          };
        }),
    );
    const topic = viewIn('[data-field="topic"]');
    await act(async () => {
      topic.dispatch({ changes: { from: 0, to: topic.state.doc.length, insert: "" }, userEvent: "delete" });
      await Promise.resolve();
    });
    await settle(AUTOSAVE_MS);
    await typeAt(topic, "Gusts");
    await act(async () => {
      answer?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    await settle();
    expect(file.properties).not.toHaveProperty("topic");
    expect(viewIn('[data-field="topic"]').state.doc.toString()).toBe("Gusts");
    await settle(AUTOSAVE_MS);
    expect(file.properties["topic"]).toBe("Gusts");
  });
});

describe("the buffer and what the app keeps of it (SR-105)", () => {
  const keepOf = (memory: UndoMemory = { editors: new Map(), values: new Map() }) => {
    const left: boolean[] = [];
    const changes: ((draft: Draft) => Draft | undefined)[] = [];
    const keep: BufferKeep = {
      memory,
      ready: () => Promise.resolve(undefined),
      save: (job) => job(),
      update: (change) => {
        changes.push(change);
      },
      left: (save) => {
        left.push(save);
      },
    };
    return { keep, left, changes, memory };
  };

  it("[SR-105/AK2] a buffer shown again starts from the undo history its editors had", async () => {
    const kept = keepOf();
    const first = await mountView({ keep: kept.keep });
    await typeAt(textView(), " more");
    await settle(AUTOSAVE_MS);
    expect(first.file.text).toBe("first more");
    act(() => {
      root.render(null);
    });
    expect(kept.left).toEqual([true]);
    expect(kept.memory.editors.has("Text")).toBe(true);
    vi.useRealTimers();
    // Shown again on the file as saved: Ctrl/Cmd+Z takes back the input before the save.
    await mountView({ keep: kept.keep, text: "first more\n" });
    expect(textView().state.doc.toString()).toBe("first more\n");
    await act(async () => {
      expect(undo(textView())).toBe(true);
      await Promise.resolve();
    });
    expect(textView().state.doc.toString()).toBe("first\n");
  });

  it("[SR-105/AK1] a save that answers after the buffer was left says whether its kept draft still holds input (#604 review)", async () => {
    // The app's draft of the buffer, which the answer rebases (`keep.update`).
    const flushLeft = async (
      kept: Draft,
    ): Promise<{ flushed: boolean | undefined; draft: Draft | undefined }> => {
      let draft: Draft | undefined = kept;
      const keep: BufferKeep = {
        ...keepOf().keep,
        update: (change) => {
          draft = draft === undefined ? undefined : change(draft);
        },
      };
      const view = await mountView({ keep });
      let answer: (() => void) | undefined;
      const real = view.call.getMockImplementation();
      view.call.mockImplementationOnce(
        (name, input) =>
          new Promise((resolve) => {
            answer = () => {
              void real?.(name, input).then(resolve);
            };
          }),
      );
      await typeAt(textView(), "!");
      let flushed: boolean | undefined;
      let flush: Promise<void> | undefined;
      await act(async () => {
        flush = view
          .controls()
          .flush()
          .then((done) => {
            flushed = done;
          });
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        root.render(null);
      });
      await act(async () => {
        answer?.();
        await flush;
      });
      vi.useRealTimers();
      return { flushed, draft };
    };
    // Keys typed while the save ran are in the draft: input is left.
    const typed = await flushLeft({ text: "first!?", base: "first", sha: "sha-0" });
    expect(typed.flushed).toBe(false);
    expect(typed.draft).toMatchObject({ text: "first!?", base: "first!", sha: "sha-1" });
    // The draft holds what was sent: nothing is left.
    const sent = await flushLeft({ text: "first!", base: "first", sha: "sha-0" });
    expect(sent.flushed).toBe(true);
    expect(sent.draft).toBeUndefined();
  });

  it("leaving with a conflict asks the app to save nothing; a save that answers after leaving updates the kept draft", async () => {
    const kept = keepOf();
    const view = await mountView({ keep: kept.keep });
    let answer: (() => void) | undefined;
    const real = view.call.getMockImplementation();
    view.call.mockImplementationOnce(
      (name, input) =>
        new Promise((resolve) => {
          answer = () => {
            void real?.(name, input).then(resolve);
          };
        }),
    );
    await typeAt(textView(), "!");
    await settle(AUTOSAVE_MS);
    await typeAt(textView(), "?");
    act(() => {
      root.render(null);
    });
    expect(kept.left).toEqual([true]);
    await act(async () => {
      answer?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(kept.changes).toHaveLength(1);
    const draft: Draft = { text: "first!?", base: "first", sha: "sha-0" };
    expect(kept.changes[0]?.(draft)).toMatchObject({ text: "first!?", base: "first!", sha: "sha-1" });

    const other = keepOf();
    const conflict = await mountView({ keep: other.keep });
    await typeAt(textView(), "!");
    conflict.file.text = "theirs";
    conflict.file.sha = "sha-outside";
    await conflict.reload();
    act(() => {
      root.render(null);
    });
    expect(other.left).toEqual([false]);
  });
});
