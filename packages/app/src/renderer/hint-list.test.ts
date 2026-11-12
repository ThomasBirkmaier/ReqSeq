// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HintListOutput } from "@reqseq/core";
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Buffer } from "./buffers.js";
import { bufferName, elementBuffer, resultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import {
  MESSAGE_START,
  foldMove,
  hintList,
  hintReason,
  hintRows,
  isHintOutput,
  kindLabel,
  messageStart,
  variantViews,
} from "./hint-list.js";
import type { BufferData } from "./modeline.js";
import { bufferView } from "./modeline.js";
import { ResultView } from "./ResultView.js";
import type { WindowAction } from "./window-layout.js";
import { ONE_AREA, reduceWindow } from "./window-layout.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hint = HintListOutput["hints"][number];

const VARIANT = "9a7c2fca-3edf-43ab-8b68-7771b9666d08";

const outdated: Hint = {
  code: "relation.outdated",
  severity: "warning",
  message:
    "Relation Based on (based-on) of System Requirement SR-3c90b0 points to an older version of D-71cf7f",
  elementId: "uuid-1",
  elementShortId: "SR-3c90b0",
  elementIdentifier: "SR-036",
  elementTitle: "Compute the coverage",
  repository: "spec",
  key: "based-on",
  targetId: "uuid-9",
  targetRepository: "spec",
  targetShortId: "D-71cf7f",
  targetIdentifier: "D-044",
  targetTitle: "Statuses can be invalid",
};

const tooFew: Hint = {
  code: "relation.too-few",
  severity: "warning",
  message:
    "System Requirement SR-f53b9d has 0 relations Derives from (derives-from) to Need (need); at least 1",
  elementId: "uuid-2",
  elementShortId: "SR-f53b9d",
  elementTitle: "Ship an AppArmor profile",
  repository: "spec",
  key: "derives-from",
  targetType: "need",
  count: 0,
  limit: 1,
};

const evidence = (view: string, n: number): Hint => ({
  code: "evidence.outdated",
  severity: "warning",
  message: `The newest verification record of System Requirement SR-bc163c ${String(n)} is for an older version`,
  elementId: "uuid-3",
  elementShortId: "SR-bc163c",
  elementIdentifier: "SR-052",
  elementTitle: "Export a package as ReqIF",
  repository: "evidence",
  elementRepository: "spec",
  view,
});

/** The output of `hint.list`: one outdated relation, one count, two evidence records of a page of 4 of 6. */
const OUTPUT: HintListOutput = {
  kinds: [
    { code: "relation.outdated", count: 1 },
    { code: "relation.too-few", count: 1 },
    { code: "evidence.outdated", count: 4 },
  ],
  hints: [outdated, tooFew, evidence("core", 1), evidence(VARIANT, 2)],
  total: 6,
  incomplete: false,
};

describe("hint list layout", () => {
  it("heads every kind the hint list of core gives with a label of its own", async () => {
    // The codes of `CHECK_ORDER` and of `SINCE_BASELINE_CODES` in core, read from its source.
    const source = await readFile(join(import.meta.dirname, "../../../core/src/hints/list.ts"), "utf8");
    const order = source.slice(
      source.indexOf("const CHECK_ORDER"),
      source.indexOf("];", source.indexOf("const CHECK_ORDER")),
    );
    const codes = [...order.matchAll(/"([a-z]+\.[a-z-]+)"/gu)].map((match) => match[1] ?? "");
    expect(codes.length).toBeGreaterThan(20);
    const unlabelled = [
      ...codes,
      "variant.core-changed-since-baseline",
      "variant.core-new-since-baseline",
    ].filter((code) => kindLabel(code) === code);
    expect(unlabelled).toEqual([]);
  });

  it("[SR-026/AK-s2vt] builds the reason from the fields: relation kind and target, count and limit, the view, else the start of the message", () => {
    const views = new Map([[VARIANT, "VAR-666d08 (VAR-002)"]]);
    expect(hintReason(outdated, views)).toBe("based-on → D-71cf7f (D-044) Statuses can be invalid");
    expect(hintReason(tooFew, views)).toBe("derives-from → need · 0 of at least 1");
    expect(hintReason({ ...tooFew, code: "relation.too-many", count: 3, limit: 2 }, views)).toBe(
      "derives-from → need · 3 of at most 2",
    );
    expect(
      hintReason(
        { code: "element.too-many-items", severity: "warning", message: "m", count: 0, limit: 1 },
        views,
      ),
    ).toBe("0 of at most 1");
    expect(hintReason(evidence("core", 1), views)).toBe("view: Core");
    expect(hintReason(evidence(VARIANT, 1), views)).toBe("view: VAR-666d08 (VAR-002)");
    expect(hintReason(evidence(VARIANT, 1), new Map())).toBe(`view: ${VARIANT}`);
    const plain: Hint = { code: "trace.no-parent", severity: "warning", message: "x".repeat(200) };
    expect(hintReason(plain, views)).toBe(`${"x".repeat(MESSAGE_START - 1)}…`);
    // A target without a relation kind stands before the message; an unresolved one by its UUID.
    expect(hintReason({ ...plain, message: "short", targetId: "uuid-7" }, views)).toBe("→ uuid-7 · short");
    // A relation whose target did not resolve to one element keeps what is wrong with it.
    expect(
      hintReason(
        {
          code: "relation.missing-target",
          severity: "warning",
          message: "No target",
          key: "refines",
          targetId: "uuid-7",
        },
        views,
      ),
    ).toBe("refines → uuid-7 · No target");
    expect(messageStart("short")).toBe("short");
  });

  it("[SR-026/AK-s2vt] groups in the order of kinds with the counts of all hints, rows in the order of the output", () => {
    const list = hintList(OUTPUT, new Map());
    expect(list).toMatchObject({ total: 6, listed: 4, incomplete: false });
    expect(list.groups.map((group) => [group.label, group.count, group.lines.length])).toEqual([
      ["Outdated relations", 1, 1],
      ["Too few relations", 1, 1],
      ["Outdated evidence records", 4, 2],
    ]);
    const [first] = list.groups[2]?.lines ?? [];
    expect(first).toEqual({
      element: "SR-bc163c (SR-052)",
      title: "Export a package as ReqIF",
      reason: "view: Core",
      message: evidence("core", 1).message,
      // The element's own repository, not that of the evidence record.
      open: elementBuffer("uuid-3", "spec", "SR-bc163c (SR-052) Export a package as ReqIF"),
    });
    // A hint about no element opens nothing; one with a kind of no heading of its own is headed by its code.
    const bare = hintList(
      {
        kinds: [{ code: "file.faulty", count: 1 }],
        hints: [{ code: "file.faulty", severity: "warning", message: "m", file: "a.md" }],
        total: 1,
        incomplete: true,
      },
      new Map(),
    );
    expect(bare.groups[0]?.lines[0]).toMatchObject({ element: "a.md", title: "", open: undefined });
    expect(bare.groups[0]?.label).toBe("file.faulty");
    expect(variantViews(OUTPUT)).toEqual([VARIANT]);
    expect(isHintOutput(OUTPUT)).toBe(true);
    expect(isHintOutput({ hints: [], total: 0 })).toBe(false);
    expect(isHintOutput(null)).toBe(false);
  });

  it("[SR-026/AK-drnx] folds a group by its heading: Enter and Tab toggle, Right opens, Left closes, also from a hint", () => {
    const list = hintList(OUTPUT, new Map());
    const rows = hintRows(list, new Set());
    expect(rows.map((row) => row.kind)).toEqual(["head", "hint", "head", "hint", "head", "hint", "hint"]);
    const key = (k: string, more: object = {}) => ({
      key: k,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...more,
    });
    expect(foldMove(rows, 2, key("Tab"))).toEqual({ code: "relation.too-few", open: false, cursor: 2 });
    expect(foldMove(rows, 2, key("Enter"))).toEqual({ code: "relation.too-few", open: false, cursor: 2 });
    expect(foldMove(rows, 2, key("ArrowRight"))).toEqual({ code: "relation.too-few", open: true, cursor: 2 });
    expect(foldMove(rows, 6, key("ArrowLeft"))).toEqual({
      code: "evidence.outdated",
      open: false,
      cursor: 4,
    });
    expect(foldMove(rows, 6, key("Tab"))).toBeUndefined();
    expect(foldMove(rows, 2, key("x"))).toBeUndefined();
    expect(foldMove(rows, 2, key("Tab", { shiftKey: true }))).toBeUndefined();
    expect(foldMove(rows, -1, key("Tab"))).toBeUndefined();
    // Space toggles as on every fold head; Enter with Shift is no fold key.
    expect(foldMove(rows, 2, key(" "))).toEqual({ code: "relation.too-few", open: false, cursor: 2 });
    expect(foldMove(rows, 2, key("Enter", { shiftKey: true }))).toBeUndefined();
    const closed = hintRows(list, new Set(["relation.too-few"]));
    expect(closed.map((row) => row.kind)).toEqual(["head", "hint", "head", "head", "hint", "hint"]);
    expect(foldMove(closed, 2, key("Tab"))).toEqual({ code: "relation.too-few", open: true, cursor: 2 });
  });
});

describe("hint list view", () => {
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

  const press = async (key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    await act(async () => {
      container.querySelector("[data-buffer]")?.dispatchEvent(event);
      await Promise.resolve();
    });
    await flush();
    return event;
  };

  const click = async (element: Element | null | undefined): Promise<void> => {
    await act(async () => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
  };

  /** The variants of the workspace, as `viewsOf` reads them. */
  const call: Call = vi.fn<Call>(async (name) =>
    Promise.resolve(
      name === "metamodel.get"
        ? {
            ok: true as const,
            output: {
              types: [{ key: "variant", meaning: "variant" }],
            } as never,
          }
        : {
            ok: true as const,
            output: {
              elements: [{ id: VARIANT, shortId: "VAR-666d08", identifier: "VAR-002", title: "Mountain" }],
            } as never,
          },
    ),
  );

  const mount = async (initial: Buffer) => {
    const actions: WindowAction[] = [];
    const data: (BufferData | undefined)[] = [];
    const Harness = (): React.ReactElement => {
      const [state, dispatch] = useReducer(reduceWindow, { buffers: [initial], layout: ONE_AREA });
      const current = state.buffers[0];
      return current?.kind === "result"
        ? createElement(ResultView, {
            call,
            buffer: current,
            revision: 0,
            dispatch: (action: WindowAction) => {
              actions.push(action);
              dispatch(action);
            },
            onData: (_key: string, loaded: BufferData | undefined) => {
              data.push(loaded);
            },
            onEcho: () => undefined,
          })
        : createElement("p", {}, current === undefined ? "" : bufferName(current));
    };
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });
    await flush();
    return { actions, data };
  };

  const buffer = resultBuffer("hint.list", {}, "List hints", OUTPUT, 0);
  const heads = (): string[] =>
    [...container.querySelectorAll(".hint-group")].map((head) => head.textContent);
  const hints = (): string[] => [...container.querySelectorAll(".hint")].map((row) => row.textContent);
  const marked = (): string | null | undefined => container.querySelector("[data-cursor]")?.textContent;

  it("[SR-026/AK-s2vt] shows the total, a group per kind with its count, one row per hint with element, title and reason, and the message on hover and in the modeline", async () => {
    const { data } = await mount(buffer);
    expect(container.querySelector(".hints-total")?.textContent).toBe("6 hints · 4 listed");
    expect(heads()).toEqual([
      "▾ Outdated relations (1)relation.outdated",
      "▾ Too few relations (1)relation.too-few",
      "▾ Outdated evidence records (4)evidence.outdated2 not listed",
    ]);
    expect(hints()).toEqual([
      "SR-3c90b0 (SR-036)Compute the coveragebased-on → D-71cf7f (D-044) Statuses can be invalid",
      "SR-f53b9dShip an AppArmor profilederives-from → need · 0 of at least 1",
      "SR-bc163c (SR-052)Export a package as ReqIFview: Core",
      "SR-bc163c (SR-052)Export a package as ReqIFview: VAR-666d08 (VAR-002)",
    ]);
    expect(container.querySelector(".hint")?.getAttribute("title")).toBe(outdated.message);
    expect(data.at(-1)).toEqual({ kind: "result", total: 6, view: undefined, incomplete: false });
    await press("n", { ctrlKey: true });
    await press("n", { ctrlKey: true });
    const modeline = data.at(-1);
    expect(modeline).toEqual({
      kind: "result",
      total: 6,
      view: undefined,
      incomplete: false,
      message: outdated.message,
    });
    expect(bufferView(buffer, modeline)).toEqual(["List hints", "6 in all", outdated.message]);
  });

  it("[SR-026/AK-s2vt] Enter on a hint opens its element; Enter with no row marked acts on the first row", async () => {
    const { actions } = await mount(buffer);
    await press("Enter");
    // The first row is a heading: Enter folds it.
    expect(heads()[0]).toBe("▸ Outdated relations (1)relation.outdated");
    await press("Enter");
    await press("ArrowDown");
    await press("Enter");
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: elementBuffer("uuid-1", "spec", "SR-3c90b0 (SR-036) Compute the coverage"),
    });
    // Enter with a modifier is not the list's.
    expect((await press("Enter", { metaKey: true })).defaultPrevented).toBe(false);
  });

  it("[SR-026/AK-drnx] opens with every group open; a click or Tab on a heading folds and unfolds it, a click on a row opens its element", async () => {
    const { actions } = await mount(buffer);
    expect(heads().every((head) => head.startsWith("▾"))).toBe(true);
    expect(hints()).toHaveLength(4);
    const tooFewHead = container.querySelectorAll(".hint-group")[1];
    await click(tooFewHead);
    expect(heads()[1]).toBe("▸ Too few relations (1)relation.too-few");
    expect(hints()).toHaveLength(3);
    expect(marked()).toBe("▸ Too few relations (1)relation.too-few");
    expect((await press("Tab")).defaultPrevented).toBe(true);
    expect(hints()).toHaveLength(4);
    await press("Tab");
    expect(hints()).toHaveLength(3);
    await press("ArrowRight");
    expect(hints()).toHaveLength(4);
    // Left on a hint closes its group and marks its heading.
    await press("ArrowDown");
    await press("ArrowLeft");
    expect(marked()).toBe("▸ Too few relations (1)relation.too-few");
    await click(container.querySelectorAll(".hint")[1]);
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: elementBuffer("uuid-3", "spec", "SR-bc163c (SR-052) Export a package as ReqIF"),
    });
  });

  it("[SR-122/AK-mqwc] Ctrl+N marks the first row when none is, then moves down over headings and hints; Ctrl+P moves up", async () => {
    await mount(buffer);
    expect(marked()).toBeUndefined();
    expect((await press("p", { ctrlKey: true })).defaultPrevented).toBe(false);
    expect((await press("n", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(marked()).toBe("▾ Outdated relations (1)relation.outdated");
    await press("n", { ctrlKey: true });
    expect(marked()).toBe(hints()[0]);
    await press("n", { ctrlKey: true });
    expect(marked()).toBe("▾ Too few relations (1)relation.too-few");
    await press("p", { ctrlKey: true });
    expect(marked()).toBe(hints()[0]);
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-activedescendant")).toBe(
      container.querySelector("[data-cursor]")?.id,
    );
  });

  it("reads the views only when an outdated evidence record names a variant", async () => {
    vi.mocked(call).mockClear();
    const coreOnly = { ...OUTPUT, hints: [outdated, tooFew, evidence("core", 1)] };
    await mount(resultBuffer("hint.list", {}, "List hints", coreOnly, 0));
    expect(call).not.toHaveBeenCalled();
    expect(container.querySelector(".hints-total")?.textContent).toBe("6 hints · 3 listed");
  });

  it("[SR-122/AK-mqwc] marks nothing on an empty list: Down, Enter and Ctrl+N leave it unmarked, Ctrl+P stays Go to", async () => {
    const { actions } = await mount(
      resultBuffer("hint.list", {}, "List hints", { kinds: [], hints: [], total: 0, incomplete: false }, 0),
    );
    await press("ArrowDown");
    await press("Enter");
    await press("n", { ctrlKey: true });
    expect((await press("p", { ctrlKey: true })).defaultPrevented).toBe(false);
    expect(actions).toEqual([]);
    expect(container.querySelector(".hints-total")?.textContent).toBe("0 hints");
  });

  it("says one hint, and incomplete when a repository is missing", async () => {
    await mount(
      resultBuffer(
        "hint.list",
        {},
        "List hints",
        { kinds: [{ code: "relation.too-few", count: 1 }], hints: [tooFew], total: 1, incomplete: true },
        0,
      ),
    );
    expect(container.querySelector(".hints-total")?.textContent).toBe("1 hint · incomplete");
  });
});
