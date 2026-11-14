// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460).
import "../../../../scripts/test-support/dom-selection.mjs";
// An element view drawn in advance, hidden beside the shown buffer (SR-212 AK5): it reads and draws as a fresh
// view, and does nothing a reader notices until it is shown: no highlight, no save, no read for its context
// menu, no elements of a package page, no `data-buffer`. Shown, it does what a fresh view at the switch does.
import type { DataExportElement } from "@reqseq/core";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlotContext } from "./area-slot.js";
import { AUTOSAVE_MS } from "./autosave.js";
import { elementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { Draft } from "./drafts.js";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import { ElementView } from "./ElementView.js";
import type { OutsideChanges } from "./outside-marks.js";
import { NO_CHANGES } from "./outside-marks.js";
import { NO_FACETS } from "./package-summary-test-data.js";
import { referenceTitles } from "./reference-titles.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const MODEL: PropertyModel = new Map([
  ["requirement", new Map<string, PropertyInfo>([["topic", { kind: "text", many: false, markdown: false }]])],
]);

const NAME = "SR-000001 (SR-1) Measure wind";

/** One element in a file, as `element.get` reads it and `element.update` writes it. */
const disk = (type: string) => {
  const file = { text: "first", sha: "sha-0", gone: false, writes: 0 };
  const element = (): DataExportElement => ({
    id: "uuid-1",
    shortId: "SR-000001",
    identifier: "SR-1",
    type,
    status: "draft",
    title: "Measure wind",
    text: file.text,
    repository: "spec",
    file: "a.md",
    properties: {},
    relations: [],
  });
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
    "element.facets": () => NO_FACETS,
    "element.get": () =>
      file.gone
        ? { ok: false, code: "ref.unknown", message: "uuid-1 is not an element" }
        : { ok: true, output: { element: element(), fileSha256: file.sha } },
    "element.update": (input) => {
      file.writes += 1;
      file.text = String(input["text"]);
      file.sha = `sha-${String(file.writes)}`;
      return { ok: true, output: { element: element(), fileSha256: file.sha, files: ["a.md"], affected: 0 } };
    },
    "element.list": () => ({ ok: true, output: { elements: [], total: 0 } }),
    "trace.neighbourhood": (input) => ({
      ok: true,
      output: { root: input["ref"], nodes: [], total: 0, edges: [], incomplete: false },
    }),
  };
  const call = vi.fn((name: string, input: Record<string, unknown>) =>
    Promise.resolve(handlers[name]?.(input) ?? { ok: true, output: {} }),
  );
  const named = (name: string): unknown[] =>
    call.mock.calls.filter(([called]) => called === name).map(([, input]) => input);
  return { file, element, call, named };
};

const settle = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const mount = async (options: {
  readonly type?: string;
  readonly draft?: Draft;
  readonly gone?: boolean;
  readonly outside?: OutsideChanges;
}) => {
  const fake = disk(options.type ?? "requirement");
  fake.file.gone = options.gone === true;
  const typed: string[] = [];
  const echoed: string[] = [];
  let revision = 0;
  const node = (hidden: boolean) =>
    createElement(
      SlotContext.Provider,
      { value: { hidden, whole: !hidden } },
      createElement(ElementView, {
        call: fake.call as unknown as Call,
        buffer: elementBuffer("uuid-1", "spec", NAME),
        revision,
        outside: options.outside ?? NO_CHANGES,
        onData: () => undefined,
        onEcho: (message) => echoed.push(message),
        onCopy: () => undefined,
        onOpenRelation: () => undefined,
        onOpenResult: () => undefined,
        onOpenTarget: () => undefined,
        onPickElement: () => undefined,
        titles: referenceTitles(fake.call as unknown as Call),
        onAsk: () => undefined,
        draft: options.draft,
        onDraft: () => undefined,
        register: () => undefined,
        onType: (element) => typed.push(element.type),
        packages: { types: new Set(["package"]), key: "packages" },
        properties: MODEL,
        dispatch: () => undefined,
        active: !hidden,
      }),
    );
  const render = async (hidden: boolean): Promise<void> => {
    await act(async () => {
      root.render(node(hidden));
      await vi.advanceTimersByTimeAsync(0);
    });
    await settle();
  };
  await render(true);
  return {
    ...fake,
    typed,
    echoed,
    show: () => render(false),
    reload: async (): Promise<void> => {
      revision += 1;
      await render(true);
    },
  };
};

describe("an element view drawn in advance", () => {
  it("[SR-212/AK-tfck] draws the element without data-buffer or a read for its context menu, says its type, and asks for that once shown", async () => {
    const view = await mount({});
    expect(container.querySelector("article h1")?.textContent).toBe("Measure wind");
    expect(container.querySelector("[data-buffer]")).toBeNull();
    expect(view.named("element.facets")).toEqual([]);
    expect(view.typed).toEqual(["requirement"]);
    await view.show();
    expect(container.querySelector("[data-buffer]")).not.toBeNull();
    expect(view.named("element.facets")).toHaveLength(1);
  });

  it("[SR-212/AK-tfck] of an element changed outside just now highlights nothing hidden, and its title once shown, as a fresh view does", async () => {
    const outside: OutsideChanges = { ...NO_CHANGES, fresh: (id) => id === "uuid-1" };
    await mount({ outside });
    expect(container.querySelector(".outside-change")).toBeNull();
    await act(async () => {
      root.render(createElement("div"));
      await vi.advanceTimersByTimeAsync(0);
    });
    // Mounted again hidden and then shown, it marks the title as the first load of a fresh view does (SR-116).
    const fresh = await mount({ outside });
    await fresh.show();
    expect(
      [...container.querySelectorAll(".outside-change")].map(
        (field) => (field as HTMLElement).dataset["field"],
      ),
    ).toEqual(["Title"]);
  });

  it("[SR-212/AK-tfck] of a package page reads none of its elements while hidden", async () => {
    const view = await mount({ type: "package" });
    expect(view.typed).toEqual(["package"]);
    expect(view.named("element.list")).toEqual([]);
    expect(view.named("evidence.coverage")).toEqual([]);
    expect(container.querySelector(".members")).toBeNull();
  });

  it("[SR-212/AK-tfck] saves the input that came back with its file only once it is shown", async () => {
    const shown = disk("requirement");
    const draft: Draft = {
      text: "first!",
      base: "first",
      sha: "sha-0",
      shown: { element: shown.element(), sha: "sha-0" },
    };
    const view = await mount({ draft, gone: true });
    view.file.gone = false;
    await view.reload();
    await settle(AUTOSAVE_MS * 3);
    expect(view.named("element.update")).toEqual([]);
    await view.show();
    await settle(AUTOSAVE_MS * 3);
    expect(view.named("element.update")).toHaveLength(1);
  });
});
