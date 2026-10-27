// @vitest-environment happy-dom
// The traceability matrix buffer (SR-125) over a call that answers `trace.matrix`: header with count and
// share, one row per element, cells with the other ends, gaps, outdated and missing marks, paging, and the
// keys that walk through a row and open an element.
import type { DataExportRelation } from "@logreq/core";
import { Fragment, act, createElement, useLayoutEffect, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Buffer, BufferAction, ListBuffer } from "./buffers.js";
import { DEFAULT_SORT, bufferName, filteredList, listBuffer, reduceBuffers, withMatrix } from "./buffers.js";
import type { Call } from "./call.js";
import { typeStep } from "./list-filters.js";
import { LoadingView } from "./App.js";
import { MatrixView } from "./MatrixView.js";
import type { BufferData } from "./modeline.js";

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

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const render = async (node: React.ReactElement): Promise<void> => {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
  await flush();
};

const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

const texts = (selector: string): string[] =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent);

/** Presses `key` on the matrix and gives the event back, to see whether the matrix took it. */
const press = async (key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    query("table").dispatchEvent(event);
    await Promise.resolve();
  });
  await flush();
  return event;
};

const click = async (target: Element): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

const link = (extra: Partial<DataExportRelation> = {}): DataExportRelation => ({
  kind: "derives-from",
  direction: "out",
  id: "uuid-n1",
  repository: "spec",
  shortId: "N-000001",
  identifier: "N-1",
  title: "See the wind",
  accessible: true,
  targetState: "available",
  outdated: false,
  ...extra,
});

/** A relation to a target that is not there: no identifier and no title, only the short ID it has. */
const missing = (): DataExportRelation => {
  const { identifier: _identifier, title: _title, ...rest } = link();
  return { ...rest, id: "uuid-gone", shortId: "UNKNOWN-1", targetState: "missing", accessible: false };
};

const COLUMNS = [
  { type: "relation", kind: "derives-from", direction: "out", name: "Derives from", count: 3, share: 0.75 },
  { type: "relation", kind: "derives-from", direction: "in", name: "Derived by", count: 1, share: 0.25 },
];

/** Four rows (a tree depth on the first): S1 has one link and a derived one, S2 an outdated, S3 a missing target, S4 nothing. */
const element = (n: number, cells: DataExportRelation[][], extra: object = {}) => ({
  id: `uuid-s${String(n)}`,
  repository: "spec",
  shortId: `SR-00000${String(n)}`,
  identifier: `SR-${String(n)}`,
  type: "system-requirement",
  status: "draft",
  title: `Requirement ${String(n)}`,
  file: `s${String(n)}.md`,
  cells,
  ...extra,
});

const ROWS = [
  element(
    1,
    [
      [link()],
      [
        link({
          direction: "in",
          id: "uuid-s2",
          shortId: "SR-000002",
          identifier: "SR-2",
          title: "Requirement 2",
        }),
      ],
    ],
    { depth: 0 },
  ),
  element(2, [[link({ id: "uuid-n2", identifier: "N-2", title: "See the rain", outdated: true })], []], {
    depth: 1,
  }),
  element(3, [[missing()], []]),
  element(4, [[], []]),
];

const matrixAnswer = (rows = ROWS, extra: object = {}) => ({
  columns: COLUMNS,
  rows,
  total: rows.length,
  incomplete: false,
  ...extra,
});

const fakeCall = (answerOf: (input: Record<string, unknown>) => unknown = () => matrixAnswer()) =>
  vi.fn((_name: string, input: Record<string, unknown>) => {
    const output = answerOf(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
const asCall = (call: ReturnType<typeof fakeCall>): Call => call as unknown as Call;

/** `expect.objectContaining` for what an action carries, typed as an object. */
const objectWith = (fields: object): object => expect.objectContaining(fields) as object;

const LIST = withMatrix(filteredList([typeStep("system-requirement")]), true);

const mount = async (call: Call, initial: ListBuffer = LIST, revision = 0) => {
  const actions: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const Harness = ({ rev }: { rev: number }): React.ReactElement => {
    const [buffers, dispatch] = useReducer(reduceBuffers, [initial] as readonly Buffer[]);
    const current = buffers[0];
    if (current?.kind !== "list") {
      return createElement("p", { id: "elsewhere" }, current?.key ?? "none");
    }
    return createElement(MatrixView, {
      call,
      buffer: current,
      revision: rev,
      dispatch: (action) => {
        actions.push(action);
        dispatch(action);
      },
      onData: (key, loaded) => data.push([key, loaded]),
      onEcho: (message) => echoed.push(message),
    });
  };
  const show = (rev: number): Promise<void> => render(createElement(Harness, { rev }));
  await show(revision);
  return { actions, data, echoed, show };
};

const selectedRows = (): string[] =>
  [...container.querySelectorAll('tr[aria-selected="true"]')].map((row) => row.id);
const current = (): string | undefined => container.querySelector(".current")?.textContent;

describe("MatrixView", () => {
  it("[SR-125/AK1] asks trace.matrix for the selection and sort of the list and shows one row per element in its order", async () => {
    const call = fakeCall();
    const { data } = await mount(asCall(call));
    expect(call).toHaveBeenCalledWith("trace.matrix", {
      selection: { where: { type: ["system-requirement"] } },
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 0,
    });
    expect(texts("tbody tr td.element")).toEqual([
      "SR-1 Requirement 1",
      "SR-2 Requirement 2",
      "SR-3 Requirement 3",
      "SR-4 Requirement 4",
    ]);
    expect(query("table").getAttribute("aria-label")).toBe("type: system-requirement · matrix");
    expect(query("table").hasAttribute("data-buffer")).toBe(true);
    expect(data.at(-1)).toEqual(["list", { kind: "list", total: 4, incomplete: false }]);
    // A tree sort indents the row element by its depth.
    expect(query("tbody tr:nth-child(2) .title").style.paddingLeft).toBe("1.25rem");
  });

  it("[SR-125/AK2] has a column for each relation kind and direction of the answer, named, with the other ends in the cells", async () => {
    await mount(asCall(fakeCall()));
    expect(texts("thead th .name")).toEqual(["Derives from", "Derived by"]);
    expect(texts("tbody tr:nth-child(1) td.cell")).toEqual(["N-1 See the wind", "SR-2 Requirement 2"]);
    expect(texts("tbody tr:nth-child(2) td.cell:nth-child(2) .relation")).toEqual([
      "N-2 See the rain outdated",
    ]);
  });

  it("[SR-125/AK3] marks a cell without relation as a gap and shows count and share over the selection above each column", async () => {
    await mount(asCall(fakeCall()));
    expect(texts("thead th .count")).toEqual(["3 · 75 %", "1 · 25 %"]);
    expect(texts("td.cell .gap")).toEqual(["—", "—", "—", "—"]);
    expect(texts("tbody tr:nth-child(4) td.cell")).toEqual(["—", "—"]);
    expect(texts("tbody tr:nth-child(1) td.cell .gap")).toEqual([]);
  });

  it("[SR-125/AK4] marks an outdated relation as outdated and one to a missing target as missing, in its cell", async () => {
    await mount(asCall(fakeCall()));
    expect(texts("td.cell .outdated")).toEqual([" outdated"]);
    expect(query("tbody tr:nth-child(2) .outdated").closest("td")?.textContent).toBe(
      "N-2 See the rain outdated",
    );
    expect(texts("td.cell .state")).toEqual([" missing"]);
    expect(query("tbody tr:nth-child(3) .state").closest("td")?.textContent).toBe("UNKNOWN-1 missing");
    expect(query("tbody tr:nth-child(3) .relation").className).toBe("relation unavailable");
  });

  it("[SR-125/AK5] Enter opens the selected row's element; Down and Up move the row, and the cursor is kept", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    // A fresh matrix has no row selected (SR-122): the first Down selects the first row, on its element.
    expect(selectedRows()).toEqual([]);
    expect(current()).toBeUndefined();
    await press("ArrowDown");
    expect(selectedRows()).toEqual(["matrix-row-0"]);
    expect(current()).toContain("SR-1 Requirement 1");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    expect(selectedRows()).toEqual(["matrix-row-1"]);
    await press("Enter");
    expect(actions.at(-2)).toEqual({ type: "cursor", key: "list", cursor: 1 });
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: objectWith({
        kind: "element",
        id: "uuid-s2",
        repository: "spec",
        name: "SR-2 Requirement 2",
      }),
    });
  });

  it("[SR-125/AK5] Right and Left walk through the row element and its links across the cells, row by row", async () => {
    await mount(asCall(fakeCall()));
    await press("ArrowLeft");
    expect(current()).toContain("SR-1");
    await press("ArrowRight");
    expect(current()).toBe("N-1 See the wind");
    await press("ArrowRight");
    expect(current()).toBe("SR-2 Requirement 2");
    await press("ArrowRight");
    expect(current()).toBe("SR-2 Requirement 2");
    await press("ArrowLeft");
    expect(current()).toBe("N-1 See the wind");
    // Another row starts at its element again.
    await press("ArrowDown");
    expect(current()).toContain("SR-2 Requirement 2");
    expect(container.querySelectorAll(".current")).toHaveLength(1);
  });

  it("[SR-125/AK5] asks again with the cursor back on the row element, so Enter opens the row, not a link", async () => {
    const { actions, show } = await mount(asCall(fakeCall()));
    await press("ArrowDown");
    await press("ArrowRight");
    expect(current()).toBe("N-1 See the wind");
    await show(1);
    expect(current()).toContain("SR-1 Requirement 1");
    await press("Enter");
    expect(actions.at(-1)).toEqual({ type: "open", buffer: objectWith({ id: "uuid-s1" }) });
  });

  it("[SR-125/AK5] Enter on a link opens the element at the other end, in its repository", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    await press("ArrowDown");
    await press("ArrowRight");
    await press("ArrowRight");
    await press("Enter");
    expect(actions.at(-2)).toEqual({ type: "cursor", key: "list", cursor: 0 });
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: objectWith({
        kind: "element",
        id: "uuid-s2",
        repository: "spec",
        name: "SR-2 Requirement 2",
      }),
    });
  });

  it("[SR-125/AK5] a click on a row element opens it and selects the row", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    await click(query("tbody tr:nth-child(2) td.element [role=link]"));
    expect(actions.at(-2)).toEqual({ type: "cursor", key: "list", cursor: 1 });
    expect(actions.at(-1)).toEqual({ type: "open", buffer: objectWith({ id: "uuid-s2" }) });
  });

  it("[SR-125/AK5] a click on a link opens its element", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    await click(query("tbody tr:nth-child(1) td.cell [role=link]"));
    expect(actions.at(-1)).toEqual({
      type: "open",
      buffer: objectWith({ id: "uuid-n1", name: "N-1 See the wind" }),
    });
  });

  it("[SR-125/AK5] Enter or a click on a missing link opens nothing and says its state", async () => {
    const { actions, echoed } = await mount(asCall(fakeCall()));
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowRight");
    expect(current()).toBe("UNKNOWN-1");
    const before = actions.length;
    await press("Enter");
    expect(echoed).toEqual(["UNKNOWN-1 is missing"]);
    expect(actions.slice(before).map((action) => action.type)).toEqual(["cursor"]);
    await click(query("tbody tr:nth-child(3) td.cell [role=link]"));
    expect(echoed).toEqual(["UNKNOWN-1 is missing", "UNKNOWN-1 is missing"]);
    expect(actions.some((action) => action.type === "open")).toBe(false);
  });

  it("[SR-122/AK4] Ctrl+N and Ctrl+P move the row like Down and Up; with no row selected Ctrl+N selects the first", async () => {
    await mount(asCall(fakeCall()));
    expect(selectedRows()).toEqual([]);
    expect(query("table").getAttribute("aria-activedescendant")).toBeNull();
    expect((await press("n", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(selectedRows()).toEqual(["matrix-row-0"]);
    expect(query("table").getAttribute("aria-activedescendant")).toBe("matrix-row-0");
    expect(current()).toContain("SR-1 Requirement 1");
    await press("n", { ctrlKey: true });
    await press("n", { ctrlKey: true });
    expect(selectedRows()).toEqual(["matrix-row-2"]);
    await press("p", { ctrlKey: true });
    expect(selectedRows()).toEqual(["matrix-row-1"]);
    await press("ArrowUp");
    expect(selectedRows()).toEqual(["matrix-row-0"]);
  });

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "[SR-122/AK5] on %s, with a row selected Ctrl+P is the matrix's, also on the first row; with none, and Cmd+P, it is not",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await mount(asCall(fakeCall()));
      expect((await press("p", { ctrlKey: true })).defaultPrevented).toBe(false);
      expect(selectedRows()).toEqual([]);
      await press("n", { ctrlKey: true });
      expect((await press("p", { ctrlKey: true })).defaultPrevented).toBe(true);
      expect(selectedRows()).toEqual(["matrix-row-0"]);
      expect((await press("p", { metaKey: true })).defaultPrevented).toBe(false);
      expect((await press("n", { metaKey: true })).defaultPrevented).toBe(false);
      expect((await press("n", { ctrlKey: true, altKey: true })).defaultPrevented).toBe(false);
      expect((await press("N", { ctrlKey: true, shiftKey: true })).defaultPrevented).toBe(false);
      expect(selectedRows()).toEqual(["matrix-row-0"]);
    },
  );

  it("with no row selected, Enter opens the element of the first row and selects it", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    await press("Enter");
    expect(actions.slice(-2)).toEqual([
      { type: "cursor", key: "list", cursor: 0 },
      { type: "open", buffer: objectWith({ id: "uuid-s1" }) },
    ]);
  });

  it("with no row selected, Right and Left first select the first row on its element; the next Right steps", async () => {
    await mount(asCall(fakeCall()));
    await press("ArrowRight");
    expect(selectedRows()).toEqual(["matrix-row-0"]);
    expect(current()).toContain("SR-1 Requirement 1");
    await press("ArrowRight");
    expect(current()).toBe("N-1 See the wind");
    await mount(asCall(fakeCall()));
    await press("ArrowLeft");
    expect(selectedRows()).toEqual(["matrix-row-0"]);
    expect(current()).toContain("SR-1 Requirement 1");
  });

  it("moves with Page, Home and End, and does nothing on Enter without a row", async () => {
    await mount(asCall(fakeCall()));
    await press("End");
    expect(selectedRows()).toEqual(["matrix-row-3"]);
    await press("PageUp");
    expect(selectedRows()).toEqual(["matrix-row-0"]);
    await press("PageDown");
    expect(selectedRows()).toEqual(["matrix-row-3"]);
    await press("Home");
    expect(selectedRows()).toEqual(["matrix-row-0"]);
    await press("x");
    expect(selectedRows()).toEqual(["matrix-row-0"]);
    await mount(asCall(fakeCall(() => matrixAnswer([], { columns: [] }))));
    const { actions } = await mount(asCall(fakeCall(() => matrixAnswer([], { columns: [] }))));
    await press("Enter");
    await press("ArrowRight");
    expect((await press("n", { ctrlKey: true })).defaultPrevented).toBe(false);
    expect(actions).toEqual([]);
  });

  it("asks the next page when the cursor comes near the end, and adds its rows", async () => {
    const many = Array.from({ length: 205 }, (_, n) => element(n + 1, [[], []]));
    const call = fakeCall((input) => ({
      ...matrixAnswer(many.slice(Number(input["offset"]), Number(input["offset"]) + Number(input["limit"]))),
      total: 205,
    }));
    const { data } = await mount(asCall(call));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(200);
    await press("End");
    expect(call).toHaveBeenLastCalledWith("trace.matrix", objectWith({ offset: 200, limit: 200 }));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(205);
    expect(data.at(-1)).toEqual(["list", { kind: "list", total: 205, incomplete: false }]);
    // All rows are there: nothing more is asked.
    const asked = call.mock.calls.length;
    await press("End");
    expect(call.mock.calls.length).toBe(asked);
  });

  it("asks the next page on scroll near the end only, and echoes a failure of the page", async () => {
    const many = Array.from({ length: 205 }, (_, n) => element(n + 1, [[], []]));
    let fail = false;
    const call = fakeCall((input) =>
      fail
        ? new Error("The page failed")
        : { ...matrixAnswer(many.slice(Number(input["offset"]), Number(input["offset"]) + 200)), total: 205 },
    );
    const { echoed } = await mount(asCall(call));
    const scroller = query(".matrix");
    const scroll = async (): Promise<void> => {
      await act(async () => {
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
        await Promise.resolve();
      });
      await flush();
    };
    // happy-dom has no layout: nothing is shown, so the end is not a screen away.
    await scroll();
    expect(call).toHaveBeenCalledTimes(1);
    // 1000 px shown, scrolled to 900 of 2000 px: the end is less than a screen away.
    Object.defineProperties(scroller, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 1000 },
      scrollTop: { value: 900 },
    });
    await scroll();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(205);
    // Moving a row at a time far from the end asks for nothing; the failure of a page is echoed.
    fail = true;
    await press("ArrowDown");
    expect(echoed).toEqual([]);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("echoes a page that fails, and drops a page that comes after the list was asked for again", async () => {
    const many = Array.from({ length: 205 }, (_, n) => element(n + 1, [[], []]));
    let mode: "ok" | "fail" | "slow" = "ok";
    const late: ((value: unknown) => void)[] = [];
    const call = vi.fn((_name: string, input: Record<string, unknown>) => {
      const page = {
        ...matrixAnswer(many.slice(Number(input["offset"]), Number(input["offset"]) + 200)),
        total: 205,
      };
      if (Number(input["offset"]) === 0 || mode === "ok") {
        return Promise.resolve({ ok: true, output: page });
      }
      if (mode === "fail") {
        return Promise.resolve({ ok: false, code: "x.failed", message: "The page failed" });
      }
      return new Promise((resolve) => {
        late.push(() => {
          resolve({ ok: true, output: page });
        });
      });
    });
    const { echoed, show } = await mount(asCall(call as unknown as ReturnType<typeof fakeCall>));
    mode = "fail";
    await press("End");
    expect(echoed).toEqual(["The page failed"]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(200);
    // The next page is pending when the workspace changes: its rows are not added to the new list.
    mode = "slow";
    await press("End");
    await show(1);
    mode = "ok";
    await act(async () => {
      for (const resolve of late) {
        resolve(undefined);
      }
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(200);
  });

  it("echoes the error of the first page and shows it", async () => {
    const { echoed } = await mount(asCall(fakeCall(() => new Error("No such filter"))));
    expect(echoed).toEqual(["No such filter"]);
    expect(query(".quiet").textContent).toBe("No such filter");
    expect(container.querySelector("thead")).toBeNull();
  });

  it("says so for a list without elements and for one whose elements have no relation", async () => {
    await mount(asCall(fakeCall(() => matrixAnswer([], { columns: [] }))));
    expect(query(".quiet").textContent).toBe("No elements");
    expect(container.querySelector("thead")).toBeNull();
    await mount(asCall(fakeCall(() => matrixAnswer([element(1, [])], { columns: [] }))));
    expect(query(".quiet").textContent).toBe("No element of this list has a relation");
    expect(texts("tbody tr td.element")).toEqual(["SR-1 Requirement 1"]);
  });

  it("passes on that the answer is incomplete, and asks again when the workspace changed", async () => {
    const call = fakeCall(() => matrixAnswer(ROWS, { incomplete: true }));
    const { data, show } = await mount(asCall(call));
    expect(data.at(-1)).toEqual(["list", { kind: "list", total: 4, incomplete: true }]);
    expect(data.some(([, loaded]) => loaded === undefined)).toBe(true);
    await show(1);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("reads a first page long enough for the selected row, and drops the answer of an older load", async () => {
    const call = fakeCall();
    await mount(asCall(call), { ...LIST, cursor: 250 });
    expect(call).toHaveBeenCalledWith("trace.matrix", objectWith({ limit: 400 }));
    const slow: ((value: unknown) => void)[] = [];
    const late = vi.fn(
      () =>
        new Promise((resolve) => {
          slow.push(resolve);
        }),
    );
    await mount(late as unknown as Call);
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      for (const resolve of slow) {
        resolve({ ok: true, output: matrixAnswer() });
      }
      await Promise.resolve();
    });
    expect(container.querySelector("tbody")).toBeNull();
  });
});

describe("LoadingView, a matrix that replaces another matrix (#563)", () => {
  it("starts the next matrix empty: it never shows the rows of the matrix before under its name", async () => {
    const all = withMatrix(listBuffer("All elements"), true);
    // The second matrix is still being asked for, as with a slow core.
    const call = vi.fn((_name: string, input: Record<string, unknown>) =>
      "selection" in input
        ? Promise.resolve({ ok: true, output: matrixAnswer() })
        : new Promise(() => undefined),
    ) as unknown as Call;
    // What each commit shows, read before the effects of the commit run (they ask for the next rows).
    const shown: [string | null | undefined, number][] = [];
    const Probe = (): null => {
      useLayoutEffect(() => {
        shown.push([
          container.querySelector("table")?.getAttribute("aria-label"),
          container.querySelectorAll("tbody tr").length,
        ]);
      });
      return null;
    };
    const show = (buffer: ListBuffer): Promise<void> =>
      render(
        createElement(
          Fragment,
          null,
          createElement(LoadingView, {
            call,
            buffer,
            revision: 0,
            dispatch: vi.fn(),
            onData: vi.fn(),
            onEcho: vi.fn(),
          }),
          createElement(Probe),
        ),
      );
    await show(LIST);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
    shown.length = 0;
    await show(all);
    expect(shown).toEqual([[bufferName(all), 0]]);
  });
});
