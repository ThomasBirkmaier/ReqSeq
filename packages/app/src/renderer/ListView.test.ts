// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act, createElement, useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Buffer, BufferAction, ListBuffer, SearchBuffer } from "./buffers.js";
import {
  DEFAULT_SORT,
  bufferName,
  elementBuffer,
  filteredList,
  listBuffer,
  reduceBuffers,
  searchBuffer,
  withGroup,
} from "./buffers.js";
import type { Call } from "./call.js";
import { propertyStep, savedStep } from "./list-filters.js";
import { ListView } from "./ListView.js";
import type { BufferData } from "./modeline.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";
import {
  asCall,
  click,
  container,
  fakeCall,
  flush,
  press,
  query,
  render,
  renewRoot,
  root,
  row,
  rowsOf,
  texts,
  unrecorded,
  withSummary,
} from "./components.test-helper.js";

/** A list buffer in a real buffer state, as the app has it, and what was opened from it. */
const listHarness = async (
  call: Call,
  initial: ListBuffer | SearchBuffer,
  extra: { revision?: number } = {},
) => {
  const opened: Buffer[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const actions: BufferAction[] = [];
  const Harness = ({ revision }: { revision: number }): React.ReactElement => {
    const [buffers, dispatch] = useReducer(reduceBuffers, [initial]);
    const current = buffers[0];
    if (
      current === undefined ||
      current.kind === "element" ||
      current.kind === "overview" ||
      current.kind === "neighbourhood" ||
      current.kind === "result" ||
      current.kind === "graph" ||
      current.kind === "metamodel"
    ) {
      return createElement("p", { id: "elsewhere" }, current === undefined ? "none" : bufferName(current));
    }
    return createElement(ListView, {
      call,
      buffer: current,
      revision,
      dispatch: (action) => {
        actions.push(action);
        if (action.type === "open") {
          opened.push(action.buffer);
        }
        dispatch(action);
      },
      onData: (key, loaded) => data.push([key, loaded]),
      onEcho: (message) => echoed.push(message),
    });
  };
  const show = (revision: number): Promise<void> => render(createElement(Harness, { revision }));
  await show(extra.revision ?? 0);
  return { opened, data, echoed, actions, show };
};

describe("ListView, a list", () => {
  it("shows the rows of element.list as they are: ID, title, status; no row selected yet (SR-122)", async () => {
    const call = fakeCall({
      "element.list": () => ({
        elements: [row(1, { identifier: "SR-036" }), row(2, { status: undefined })],
        total: 2,
        incomplete: false,
      }),
    });
    const { data } = await listHarness(asCall(call), listBuffer("All elements"));
    expect(call).toHaveBeenCalledWith("element.list", { sort: DEFAULT_SORT, limit: 200, offset: 0 });
    expect(texts(".row .id")).toEqual(["SR-000001 (SR-036)", "SR-000002"]);
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    expect(texts(".row .status")).toEqual(["draft", ""]);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(query('[role="listbox"]').getAttribute("aria-activedescendant")).toBeNull();
    expect(query('[role="option"]').getAttribute("aria-selected")).toBe("false");
    expect(data).toEqual([
      ["list", undefined],
      [
        "list",
        {
          kind: "list",
          total: 2,
          incomplete: false,
          rows: [
            { ...elementBuffer("uuid-1", "spec", "SR-000001 (SR-036) Title 1"), type: "system-requirement" },
            { ...elementBuffer("uuid-2", "spec", "SR-000002 Title 2"), type: "system-requirement" },
          ],
        },
      ],
    ]);
  });

  it("asks with the filter and the sort of the buffer", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    const selection = { where: { type: ["need"] } };
    const sort = [{ by: "title", order: "asc" as const }];
    await listHarness(asCall(call), listBuffer("type: need", selection, sort));
    expect(call).toHaveBeenCalledWith("element.list", { selection, sort, limit: 200, offset: 0 });
  });

  describe("grouped (SR-149)", () => {
    const steps = [propertyStep("topic", "Timing", "Timing")];
    const sort = [{ by: "title" as const, order: "asc" as const }];
    const plain = filteredList(steps, sort);
    // Element 1 is in two packages, so the grouped list shows it in both groups.
    const byPackage = {
      elements: [row(1), row(2), row(1), row(3)],
      groups: [
        { value: "PKG-000001", identifier: "R1", title: "Wind", count: 2, offset: 0 },
        { value: "PKG-000002", title: "Sun", count: 1, offset: 2 },
        { count: 1, offset: 3, unavailable: 1 },
      ],
      offset: 0,
      rows: 4,
      total: 3,
    };
    const byStatus = {
      elements: [row(2), row(1), row(3)],
      groups: [
        { value: "draft", name: "Draft", count: 2, offset: 0 },
        { value: "approved", name: "Approved", count: 1, offset: 2 },
      ],
      offset: 0,
      rows: 3,
      total: 3,
    };
    const show = (call: Call, buffer: ListBuffer, data: unknown[] = []): Promise<void> =>
      render(
        createElement(ListView, {
          call,
          buffer,
          revision: 0,
          dispatch: () => undefined,
          onData: (_key, loaded) => data.push(loaded),
          onEcho: () => undefined,
        }),
      );
    const headings = (): string[] => texts(".group h2");
    const groupRows = (): string[][] =>
      [...container.querySelectorAll(".group")].map((group) =>
        [...group.querySelectorAll(".row .id")].map((id) => id.textContent),
      );

    it("[SR-149/AK-pd1k] shows each group under its heading and count, and regroups or ungroups the same elements in the same filter and sort", async () => {
      const call = fakeCall({
        "element.list": (input) =>
          input["group"] === "package"
            ? byPackage
            : input["group"] === "status"
              ? byStatus
              : { elements: [row(1), row(2), row(3)], total: 3 },
      });
      const data: unknown[] = [];
      await show(withSummary(call), withGroup(plain, "package"), data);
      expect(call).toHaveBeenLastCalledWith("element.list", {
        selection: plain.selection,
        sort,
        group: "package",
        limit: 200,
        offset: 0,
      });
      expect(headings()).toEqual([
        "PKG-000001 (R1) Wind 2",
        "PKG-000002 Sun 1",
        "(no value) 1 · 1 with targets not available",
      ]);
      expect(groupRows()).toEqual([["SR-000001", "SR-000002"], ["SR-000001"], ["SR-000003"]]);
      // The rows are those of the grouped list, numbered through, an element once per group.
      expect([...container.querySelectorAll('[role="option"]')].map((option) => option.id)).toEqual([
        "row-0",
        "row-1",
        "row-2",
        "row-3",
      ]);
      expect(query(".group").getAttribute("aria-labelledby")).toBe("group-0");
      expect(query("#group-0 .count").textContent).toBe("2");
      expect(data.at(-1)).toMatchObject({ total: 3 });

      await show(withSummary(call), withGroup(plain, "status"));
      expect(call).toHaveBeenLastCalledWith("element.list", {
        selection: plain.selection,
        sort,
        group: "status",
        limit: 200,
        offset: 0,
      });
      expect(headings()).toEqual(["Draft 2", "Approved 1"]);
      expect(groupRows()).toEqual([["SR-000002", "SR-000001"], ["SR-000003"]]);

      await show(withSummary(call), plain);
      expect(call).toHaveBeenLastCalledWith("element.list", {
        selection: plain.selection,
        sort,
        limit: 200,
        offset: 0,
      });
      expect(headings()).toEqual([]);
      expect(texts(".row .id")).toEqual(["SR-000001", "SR-000002", "SR-000003"]);
    });

    it("pages over the rows of the grouped list, so a group of the next page appears once its rows are there", async () => {
      const first = rowsOf(1, 201);
      const call = fakeCall({
        "element.list": (input) =>
          input["offset"] === 0
            ? {
                elements: first,
                groups: [
                  { value: "a", count: 200, offset: 0 },
                  { value: "b", count: 2, offset: 200 },
                ],
                offset: 0,
                rows: 202,
                total: 200,
              }
            : {
                elements: [row(1), row(2)],
                groups: [
                  { value: "a", count: 200, offset: 0 },
                  { value: "b", name: "Bee", count: 2, offset: 200 },
                ],
                offset: 200,
                rows: 202,
                total: 200,
              },
      });
      await show(withSummary(call), withGroup(listBuffer("All elements"), "topic"));
      expect(headings()).toEqual(["a 200"]);
      // 200 elements in 202 rows: the next page is due although every element was listed once.
      await press(query('[role="listbox"]'), "End");
      expect(call).toHaveBeenLastCalledWith("element.list", {
        sort: DEFAULT_SORT,
        group: "topic",
        limit: 200,
        offset: 200,
      });
      // The groups are those of the latest page.
      expect(headings()).toEqual(["a 200", "Bee 2"]);
      expect(groupRows()[1]).toEqual(["SR-000001", "SR-000002"]);
    });
  });

  it("asks with the default sort, none for a saved filter that holds its own, and `[]` for the workspace order (ThomasBirkmaier/ReqSeq-archive#418)", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    await listHarness(withSummary(call), filteredList([savedStep("open")]));
    expect(call).toHaveBeenLastCalledWith("element.list", {
      selection: { filter: "open" },
      limit: 200,
      offset: 0,
    });
    await listHarness(withSummary(call), listBuffer("All elements", undefined, []));
    expect(call).toHaveBeenLastCalledWith("element.list", { sort: [], limit: 200, offset: 0 });
    await listHarness(withSummary(call), filteredList([savedStep("open")], DEFAULT_SORT));
    expect(call).toHaveBeenLastCalledWith("element.list", {
      selection: { filter: "open" },
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 0,
    });
  });

  it("[SR-075/AK-f889] indents the rows of a tree by their depth", async () => {
    const call = fakeCall({
      "element.list": () => ({
        elements: rowsOf(1, 4),
        tree: [
          { id: "uuid-1", repository: "spec", depth: 0 },
          { id: "uuid-2", repository: "spec", depth: 1 },
          { id: "uuid-3", repository: "spec", depth: 2 },
        ],
        total: 3,
      }),
    });
    await listHarness(
      asCall(call),
      listBuffer("All elements", undefined, [{ by: "hierarchy", order: "asc" }]),
    );
    // The tree is core's: the list asks for the hierarchy and draws the depths core gives.
    expect(call).toHaveBeenCalledWith(
      "element.list",
      expect.objectContaining({ sort: [{ by: "hierarchy", order: "asc" }] }),
    );
    expect(
      [...container.querySelectorAll<HTMLElement>(".row .title")].map((title) => title.style.paddingLeft),
    ).toEqual(["0rem", "1.25rem", "2.5rem"]);
  });

  it("says that there are no elements, and why the list failed", async () => {
    await listHarness(
      asCall(fakeCall({ "element.list": () => ({ elements: [], total: 0 }) })),
      listBuffer("All elements"),
    );
    expect(query(".quiet").textContent).toBe("No elements");
    const failing = await listHarness(
      asCall(fakeCall({ "element.list": () => new Error("The metamodel is not valid") })),
      listBuffer("All elements"),
    );
    expect(query(".quiet").textContent).toBe("The metamodel is not valid");
    expect(failing.echoed).toEqual(["The metamodel is not valid"]);
  });

  it("marks incomplete results in the data for the modeline", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 2), total: 1, incomplete: true }) });
    const { data } = await listHarness(asCall(call), listBuffer("All elements"));
    expect(data.at(-1)?.[1]).toMatchObject({ kind: "list", total: 1, incomplete: true });
  });

  it("moves the selection with the arrow keys, Page Up and Page Down, Home and End, inside the rows", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 31), total: 30 }) });
    await listHarness(asCall(call), listBuffer("All elements"));
    const selected = (): string => query('[aria-selected="true"]').id;
    const list = query('[role="listbox"]');
    await press(list, "ArrowUp");
    expect(selected()).toBe("row-0");
    await press(list, "ArrowDown");
    expect(selected()).toBe("row-1");
    await press(list, "PageDown");
    expect(selected()).toBe("row-11");
    await press(list, "PageUp");
    expect(selected()).toBe("row-1");
    await press(list, "End");
    expect(selected()).toBe("row-29");
    await press(list, "ArrowDown");
    expect(selected()).toBe("row-29");
    await press(list, "Home");
    expect(selected()).toBe("row-0");
    await press(list, "x");
    expect(selected()).toBe("row-0");
  });

  it("opens the element of the selected row on Enter, and of a clicked row", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    const { opened, actions } = await listHarness(asCall(call), listBuffer("All elements"));
    const list = query('[role="listbox"]');
    await press(list, "ArrowDown");
    await press(list, "ArrowDown");
    await press(list, "Enter");
    expect(opened).toEqual([
      { ...elementBuffer("uuid-2", "spec", "SR-000002 Title 2"), type: "system-requirement" },
    ]);
    expect(query("#elsewhere").textContent).toBe("SR-000002 Title 2");
    expect(actions.at(-2)).toEqual({ type: "cursor", key: "list", cursor: 1 });
  });

  it("selects and opens a row that is clicked", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    const { opened, actions } = await listHarness(asCall(call), listBuffer("All elements"));
    await click(query("#row-2"));
    expect(actions[0]).toEqual({ type: "cursor", key: "list", cursor: 2 });
    expect(opened).toEqual([
      { ...elementBuffer("uuid-3", "spec", "SR-000003 Title 3"), type: "system-requirement" },
    ]);
  });

  it("does nothing on Enter without rows", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    const { opened } = await listHarness(asCall(call), listBuffer("All elements"));
    await press(query('[role="listbox"]'), "Enter");
    await press(query('[role="listbox"]'), "End");
    expect(opened).toEqual([]);
  });

  it("asks for the next page when the selection comes near the end, and not beyond the total", async () => {
    const call = fakeCall({
      "element.list": (input) => ({
        elements: rowsOf(
          Number(input["offset"]),
          Math.min(450, Number(input["offset"]) + Number(input["limit"])),
        ),
        total: 450,
      }),
    });
    await listHarness(asCall(call), listBuffer("All elements"));
    expect(container.querySelectorAll(".row")).toHaveLength(200);
    const list = query('[role="listbox"]');
    await press(list, "End");
    expect(call).toHaveBeenLastCalledWith("element.list", { sort: DEFAULT_SORT, limit: 200, offset: 200 });
    expect(container.querySelectorAll(".row")).toHaveLength(400);
    await press(list, "End");
    expect(call).toHaveBeenLastCalledWith("element.list", { sort: DEFAULT_SORT, limit: 200, offset: 400 });
    expect(container.querySelectorAll(".row")).toHaveLength(450);
    const calls = call.mock.calls.length;
    await press(list, "End");
    expect(call.mock.calls).toHaveLength(calls);
  });

  it("reports the new total to the modeline when it changed between two pages", async () => {
    const call = fakeCall({
      "element.list": (input) => ({
        elements: rowsOf(Number(input["offset"]), Number(input["offset"]) + 200),
        total: input["offset"] === 0 ? 400 : 390,
      }),
    });
    const { data } = await listHarness(asCall(call), listBuffer("All elements"));
    await press(query('[role="listbox"]'), "End");
    expect(data.at(-1)?.[1]).toMatchObject({ kind: "list", total: 390, incomplete: false });
  });

  it("asks only once while a page is on its way", async () => {
    let release: () => void = () => undefined;
    let slow = false;
    const call = vi.fn(
      (_name: string, input: { offset: number }) =>
        new Promise((resolve) => {
          const answer = {
            ok: true,
            output: { elements: rowsOf(input.offset, input.offset + 200), total: 1000 },
          };
          if (slow) {
            release = () => {
              resolve(answer);
            };
          } else {
            resolve(answer);
          }
        }),
    );
    await listHarness(withSummary(call), listBuffer("All elements"));
    slow = true;
    const list = query('[role="listbox"]');
    await press(list, "End");
    await press(list, "End");
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it("asks for the next page when the scroll comes within a screen of the end", async () => {
    const call = fakeCall({
      "element.list": (input) => ({
        elements: rowsOf(Number(input["offset"]), Number(input["offset"]) + 200),
        total: 400,
      }),
    });
    await listHarness(withSummary(call), listBuffer("All elements"));
    const list = query('[role="listbox"]');
    for (const [name, value] of [
      ["scrollHeight", 8000],
      ["scrollTop", 1000],
      ["clientHeight", 800],
    ] as const) {
      Object.defineProperty(list, name, { value, configurable: true });
    }
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });
    expect(call).toHaveBeenCalledTimes(1);
    Object.defineProperty(list, "scrollTop", { value: 6800, configurable: true });
    await act(async () => {
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.list", { sort: DEFAULT_SORT, limit: 200, offset: 200 });
    expect(container.querySelectorAll(".row")).toHaveLength(400);
  });

  it("shows the coverage line of the list once its rows stand, and Enter on it opens the coverage, not the row", async () => {
    const coverage = {
      levels: [{ type: "system-requirement", total: 2, withChildren: 0, withEvidence: 1, elements: {} }],
    };
    const answers: Record<string, unknown> = {
      "element.list": { elements: rowsOf(0, 2), total: 2 },
      "evidence.coverage": coverage,
      "evidence.degree": {
        degree: {
          share: 0.5,
          total: 2,
          counts: { open: 1, verified: 1, indirect: 0, failed: 0, outdated: 0 },
        },
        view: "core",
      },
    };
    const call = vi.fn((name: string) => Promise.resolve({ ok: true, output: answers[name] }));
    const { opened } = await listHarness(unrecorded(call) as unknown as Call, listBuffer("All elements"));
    expect(call.mock.calls.map(([name]) => name)).toEqual([
      "element.list",
      "evidence.coverage",
      "evidence.degree",
    ]);
    const line = query('.package-summary [role="link"]');
    expect(query(".package-summary").hidden).toBe(false);
    expect(line.textContent).toContain("Coverage 1 of 2 with verification");
    await press(line, "Enter");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      kind: "result",
      command: "evidence.coverage",
      input: { selection: {} },
      output: coverage,
    });
  });

  it("keeps the coverage line of a list, without asking again, while its rows are asked for in another sort", async () => {
    const lists: ((value: unknown) => void)[] = [];
    const call = vi.fn((name: string) =>
      name === "element.list"
        ? new Promise((resolve) => {
            lists.push(resolve);
          })
        : Promise.resolve({
            ok: true,
            output:
              name === "evidence.coverage"
                ? {
                    levels: [
                      {
                        type: "system-requirement",
                        total: 2,
                        withChildren: 0,
                        withEvidence: 1,
                        elements: {},
                      },
                    ],
                  }
                : {
                    degree: {
                      share: 0.5,
                      total: 2,
                      counts: { open: 1, verified: 1, indirect: 0, failed: 0, outdated: 0 },
                    },
                    view: "core",
                  },
          }),
    );
    const props = {
      call: unrecorded(call) as unknown as Call,
      revision: 0,
      dispatch: () => undefined,
      onData: () => undefined,
      onEcho: () => undefined,
    };
    const first = listBuffer("All elements");
    await render(createElement(ListView, { ...props, buffer: first }));
    await act(async () => {
      lists[0]?.({ ok: true, output: { elements: rowsOf(0, 2), total: 2 } });
      await Promise.resolve();
    });
    await flush();
    expect(query(".package-summary").textContent).toContain("Coverage 1 of 2 with verification");
    await render(
      createElement(ListView, { ...props, buffer: { ...first, sort: [{ by: "title", order: "desc" }] } }),
    );
    expect(lists).toHaveLength(2);
    expect(query(".package-summary").textContent).toContain("Coverage 1 of 2 with verification");
    expect(call.mock.calls.filter(([name]) => name === "evidence.coverage")).toHaveLength(1);
  });

  it("hides the coverage line of a list without a counted requirement", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(0, 2), total: 2 }) });
    await listHarness(withSummary(call), listBuffer("All elements"));
    expect(query(".package-summary").hidden).toBe(true);
  });

  it("echoes why the next page failed and keeps the rows", async () => {
    let failing = false;
    const call = fakeCall({
      "element.list": () =>
        failing ? new Error("The file changed") : { elements: rowsOf(0, 200), total: 400 },
    });
    const { echoed } = await listHarness(asCall(call), listBuffer("All elements"));
    failing = true;
    await press(query('[role="listbox"]'), "End");
    expect(echoed).toEqual(["The file changed"]);
    expect(container.querySelectorAll(".row")).toHaveLength(200);
  });

  it("drops the next page when the list was asked for again meanwhile", async () => {
    let release: () => void = () => undefined;
    let slow = false;
    const call = vi.fn(
      (_name: string, input: { offset: number }) =>
        new Promise((resolve) => {
          const answer = {
            ok: true,
            output: { elements: rowsOf(input.offset, input.offset + 200), total: 1000 },
          };
          if (slow && input.offset === 200) {
            release = () => {
              resolve(answer);
            };
          } else {
            resolve(answer);
          }
        }),
    );
    const { show } = await listHarness(withSummary(call), listBuffer("All elements"));
    slow = true;
    await press(query('[role="listbox"]'), "End");
    await show(1);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(container.querySelectorAll(".row")).toHaveLength(200);
  });

  it("asks for enough rows for the selected row when it is shown again", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(0, 5), total: 5 }) });
    await listHarness(asCall(call), { ...listBuffer("All elements"), cursor: 250 });
    expect(call).toHaveBeenCalledWith("element.list", { sort: DEFAULT_SORT, limit: 400, offset: 0 });
    expect(query('[aria-selected="true"]').id).toBe("row-4");
  });

  it("asks again when the workspace changed, and drops the answer of an older question", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show } = await listHarness(withSummary(call), listBuffer("All elements"));
    await show(1);
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: rowsOf(10, 11), total: 1 } });
      await Promise.resolve();
    });
    await act(async () => {
      answers[0]?.({ ok: true, output: { elements: rowsOf(1, 3), total: 2 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 10"]);
  });

  it("ignores an answer that comes after it is gone", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await listHarness(withSummary(call), listBuffer("All elements"));
    act(() => {
      root.unmount();
    });
    answer({ ok: true, output: { elements: rowsOf(1, 3), total: 2 } });
    await Promise.resolve();
    renewRoot();
  });
});

/** A list as a part of another buffer (SR-112): in a scrolling `.buffer`, with the means to leave it. */
const partHarness = async (
  call: Call,
  buffer: ListBuffer,
  extra: { enclosed?: boolean; focusOnLoad?: boolean; onLeave?: () => void } = {},
) => {
  const actions: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const node = (revision: number, shown: ListBuffer): React.ReactElement => {
    const list = createElement(ListView, {
      call,
      buffer: shown,
      revision,
      dispatch: (action: BufferAction) => actions.push(action),
      onData: (key: string, loaded: BufferData | undefined) => data.push([key, loaded]),
      onEcho: (message: string) => echoed.push(message),
      part: true,
      ...(extra.onLeave === undefined ? {} : { onLeave: extra.onLeave }),
      ...(extra.focusOnLoad === undefined ? {} : { focusOnLoad: extra.focusOnLoad }),
    });
    return extra.enclosed === false
      ? list
      : createElement("div", { className: "buffer", id: "enclosing", tabIndex: 0 }, list);
  };
  await render(node(0, buffer));
  return {
    actions,
    data,
    echoed,
    show: (revision: number, shown: ListBuffer = buffer) => render(node(revision, shown)),
  };
};

/** As `memberList` makes it: the part starts on its first row, shown while it has the focus. */
const packageMembers = (): ListBuffer => ({
  ...listBuffer("package: Stufe-3", { where: { package: "uuid-p" } }),
  key: "element:spec:uuid-p",
  cursor: 0,
});

describe("ListView, a part of a buffer (SR-112)", () => {
  it("[SR-112/AK-fzbz] asks for the elements of the selection and shows them as rows, in the buffer that encloses it", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    await partHarness(asCall(call), packageMembers());
    expect(call).toHaveBeenCalledWith("element.list", {
      selection: { where: { package: "uuid-p" } },
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 0,
    });
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2", "Title 3"]);
    const list = query('[role="listbox"]');
    expect(list.className).toBe("list part");
    expect(list.hasAttribute("data-buffer")).toBe(false);
    expect(container.querySelectorAll("[data-buffer]")).toHaveLength(0);
  });

  it("shows nothing when there are no elements, and the message when asking failed", async () => {
    const empty = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    const { data } = await partHarness(asCall(empty), packageMembers());
    expect(container.querySelector(".quiet")).toBeNull();
    expect(data).toEqual([["element:spec:uuid-p", { kind: "list", total: 0, incomplete: false, rows: [] }]]);
    act(() => {
      root.unmount();
    });
    renewRoot();
    const failing = fakeCall({ "element.list": () => new Error("Stufe-3 is no package") });
    const { echoed } = await partHarness(asCall(failing), packageMembers());
    expect(query(".quiet").textContent).toBe("Stufe-3 is no package");
    expect(echoed).toEqual(["Stufe-3 is no package"]);
  });

  it("asks for the next page when the enclosing buffer scrolls near its end, and stops listening when gone", async () => {
    const call = fakeCall({
      "element.list": (input) => ({
        elements: rowsOf(Number(input["offset"]), Number(input["offset"]) + 200),
        total: 400,
      }),
    });
    await partHarness(asCall(call), packageMembers());
    const enclosing = query("#enclosing");
    const scrollTo = async (top: number): Promise<void> => {
      for (const [name, value] of [
        ["scrollHeight", 8000],
        ["scrollTop", top],
        ["clientHeight", 800],
      ] as const) {
        Object.defineProperty(enclosing, name, { value, configurable: true });
      }
      await act(async () => {
        enclosing.dispatchEvent(new Event("scroll"));
        await Promise.resolve();
      });
      await flush();
    };
    await scrollTo(1000);
    expect(call).toHaveBeenCalledTimes(1);
    await scrollTo(6800);
    expect(call).toHaveBeenLastCalledWith("element.list", {
      selection: { where: { package: "uuid-p" } },
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 200,
    });
    expect(container.querySelectorAll(".row")).toHaveLength(400);
    // The list itself does not scroll: its own scroll event pages the same way.
    act(() => {
      root.unmount();
    });
    await scrollTo(7000);
    expect(call).toHaveBeenCalledTimes(2);
    renewRoot();
  });

  it("works without a buffer around it", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 3), total: 2 }) });
    await partHarness(asCall(call), packageMembers(), { enclosed: false });
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
  });

  it("Escape, and Up on the first row, leave the part; Up on any other row moves up", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 6), total: 5 }) });
    const left: string[] = [];
    const onLeave = (): void => {
      left.push("left");
    };
    const { actions } = await partHarness(asCall(call), { ...packageMembers(), cursor: 2 }, { onLeave });
    const list = query('[role="listbox"]');
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => {
      list.dispatchEvent(escape);
      await Promise.resolve();
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(left).toEqual(["left"]);
    await press(list, "ArrowUp");
    expect(actions).toEqual([{ type: "cursor", key: "element:spec:uuid-p", cursor: 1 }]);
    expect(left).toHaveLength(1);
  });

  it("[SR-122/AK-mqwc] Ctrl+N and Ctrl+P walk the elements like Down and Up; Ctrl+P on the first leaves like Up", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    const left: string[] = [];
    const { actions } = await partHarness(
      asCall(call),
      { ...packageMembers(), cursor: 1 },
      {
        onLeave: () => {
          left.push("left");
        },
      },
    );
    const list = query('[role="listbox"]');
    // The harness keeps the buffer as given, on row 1: each key moves from there.
    await press(list, "n", { ctrlKey: true });
    await press(list, "n", { ctrlKey: true });
    await press(list, "p", { ctrlKey: true });
    expect(actions).toEqual([
      { type: "cursor", key: "element:spec:uuid-p", cursor: 2 },
      { type: "cursor", key: "element:spec:uuid-p", cursor: 2 },
      { type: "cursor", key: "element:spec:uuid-p", cursor: 0 },
    ]);
    expect(left).toEqual([]);
    const first = await partHarness(asCall(call), packageMembers(), {
      onLeave: () => {
        left.push("left");
      },
    });
    const up = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      query('[role="listbox"]').dispatchEvent(up);
      await Promise.resolve();
    });
    expect(up.defaultPrevented).toBe(true);
    expect(left).toEqual(["left"]);
    expect(first.actions).toEqual([]);
  });

  it("leaves from the first row with Up, and does not scroll the page", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 6), total: 5 }) });
    const left: string[] = [];
    await partHarness(asCall(call), packageMembers(), {
      onLeave: () => {
        left.push("left");
      },
    });
    const up = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    await act(async () => {
      query('[role="listbox"]').dispatchEvent(up);
      await Promise.resolve();
    });
    expect(up.defaultPrevented).toBe(true);
    expect(left).toEqual(["left"]);
  });

  it("[SR-112/AK-fzbz] opening a package does not scroll to its elements", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 6), total: 5 }) });
    await partHarness(asCall(call), packageMembers());
    expect(texts(".row .title")).toHaveLength(5);
    expect(scrolled).not.toHaveBeenCalled();
    scrolled.mockRestore();
  });

  it("[SR-112/AK-fzbz] shows the selected row as the cursor moves while the part has the focus, and not otherwise", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 6), total: 5 }) });
    const shown = packageMembers();
    const showCursor = async (cursor: number): Promise<void> => {
      await render(
        createElement(
          "div",
          { className: "buffer" },
          createElement(ListView, {
            call: asCall(call),
            buffer: { ...shown, cursor },
            revision: 0,
            dispatch: () => undefined,
            onData: () => undefined,
            onEcho: () => undefined,
            part: true,
          }),
        ),
      );
    };
    await showCursor(0);
    await showCursor(1);
    expect(scrolled).not.toHaveBeenCalled();
    act(() => {
      query('[role="listbox"]').focus();
    });
    await showCursor(2);
    expect(scrolled).toHaveBeenCalledTimes(1);
    scrolled.mockRestore();
  });

  it("keeps the rows while the elements are asked for again after a change of the workspace", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show, data } = await partHarness(unrecorded(call) as unknown as Call, packageMembers());
    await act(async () => {
      answers[0]?.({ ok: true, output: { elements: rowsOf(1, 3), total: 2 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    await show(1);
    expect(call).toHaveBeenCalledTimes(2);
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    expect(data).toEqual([
      [
        "element:spec:uuid-p",
        { kind: "list", total: 2, incomplete: false, rows: expect.any(Array) as unknown },
      ],
    ]);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: rowsOf(7, 8), total: 1 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 7"]);
  });

  it("keeps the rows while the elements are asked for again in another sort (ThomasBirkmaier/ReqSeq-archive#563)", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show } = await partHarness(unrecorded(call) as unknown as Call, packageMembers());
    await act(async () => {
      answers[0]?.({ ok: true, output: { elements: rowsOf(1, 3), total: 2 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    await show(0, { ...packageMembers(), sort: [{ by: "title", order: "desc" }] });
    expect(call).toHaveBeenCalledTimes(2);
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2"]);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: [row(2), row(1)], total: 2 } });
      await Promise.resolve();
    });
    expect(texts(".row .title")).toEqual(["Title 2", "Title 1"]);
  });

  it("does not open or page on the old rows while the elements are asked for again", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show, actions } = await partHarness(unrecorded(call) as unknown as Call, packageMembers());
    await act(async () => {
      answers[0]?.({ ok: true, output: { elements: rowsOf(1, 4), total: 300 } });
      await Promise.resolve();
    });
    await show(1);
    expect(call).toHaveBeenCalledTimes(2);
    const list = query('[role="listbox"]');
    await press(list, "Enter");
    await press(list, "End");
    expect(actions.filter((action) => action.type === "open")).toEqual([]);
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
      answers[1]?.({ ok: true, output: { elements: rowsOf(7, 9), total: 2 } });
      await Promise.resolve();
    });
    await press(query('[role="listbox"]'), "Enter");
    expect(actions.at(-1)).toMatchObject({ type: "open", buffer: { id: "uuid-7" } });
  });

  it("takes the focus when its rows have arrived, if the focus is on the buffer around it", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    const around = document.createElement("div");
    around.tabIndex = 0;
    document.body.append(around);
    around.focus();
    await partHarness(asCall(call), packageMembers(), { focusOnLoad: true });
    // The focus was on something else, not on the buffer around the part: it stays.
    expect(document.activeElement).toBe(around);
    around.remove();
    act(() => {
      root.unmount();
    });
    renewRoot();
    // On the buffer around it (or on nothing), the part takes the focus.
    const take = async (): Promise<void> => {
      const answers: ((value: unknown) => void)[] = [];
      const slow = vi.fn(
        () =>
          new Promise((resolve) => {
            answers.push(resolve);
          }),
      );
      await partHarness(slow as unknown as Call, packageMembers(), { focusOnLoad: true });
      act(() => {
        query("#enclosing").focus();
      });
      await act(async () => {
        answers[0]?.({ ok: true, output: { elements: rowsOf(1, 4), total: 3 } });
        await Promise.resolve();
      });
    };
    await take();
    expect(document.activeElement).toBe(query('[role="listbox"]'));
  });

  it("does not take the focus when it was not asked to, or when there is nothing to select", async () => {
    const call = fakeCall({ "element.list": () => ({ elements: rowsOf(1, 4), total: 3 }) });
    await partHarness(asCall(call), packageMembers());
    expect(document.activeElement).not.toBe(query('[role="listbox"]'));
    act(() => {
      root.unmount();
    });
    renewRoot();
    const none = fakeCall({ "element.list": () => ({ elements: [], total: 0 }) });
    await partHarness(asCall(none), packageMembers(), { focusOnLoad: true });
    expect(document.activeElement).not.toBe(query('[role="listbox"]'));
  });
});

describe("ListView, the verification of the rows (SR-137)", () => {
  const entry = (status: string) => [{ view: "core", status }];
  // Rows 1 to 4: open 2 of 3, failed without ring, indirect, a need at 60 %; row 5 has nothing to show.
  const verification = [
    { verification: entry("open"), criteria: { verified: 2, total: 3, notVerified: [{ criterion: 3 }] } },
    { verification: entry("failed") },
    { verification: entry("indirect") },
    {
      degree: {
        share: 0.6,
        total: 10,
        counts: { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 },
      },
    },
    {},
  ];
  const shown = () =>
    [...container.querySelectorAll(".row")].map((shownRow) => [
      shownRow.querySelector(".status")?.textContent,
      shownRow.querySelector(".verification")?.textContent,
      shownRow.querySelector(".verification .accent") !== null,
    ]);

  it("[SR-137/AK-bvf7] a row shows the verification status of its requirement right of its status, after the rows stand", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const call = vi.fn((name: string, input: Record<string, unknown>) =>
      input["withVerification"] === true
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve({
            ok: true,
            output: name === "element.list" ? { elements: rowsOf(1, 6), total: 5 } : NO_SUMMARY[name]?.(),
          }),
    );
    await listHarness(call as unknown as Call, listBuffer("All elements"));
    // The rows come first; their verification is asked for the same page with as few fields as it takes.
    expect(texts(".row .title")).toHaveLength(5);
    expect(texts(".row .verification")).toEqual(["", "", "", "", ""]);
    expect(call).toHaveBeenCalledWith("element.list", {
      sort: DEFAULT_SORT,
      withVerification: true,
      fields: ["identifier"],
      limit: 5,
      offset: 0,
    });
    await act(async () => {
      answer({ ok: true, output: { partial: rowsOf(1, 6), total: 5, rowVerification: verification } });
      await Promise.resolve();
    });
    expect(shown()).toEqual([
      ["draft", "open2 of 3", false],
      ["draft", "failed", true],
      ["draft", "indirect", false],
      ["draft", "60 %", false],
      ["draft", "", false],
    ]);
  });

  it("puts each page's verification at its rows in whatever order the answers come, and never at another element's row", async () => {
    const answers = new Map<number, (value: unknown) => void>();
    const elements = (input: Record<string, unknown>) =>
      rowsOf(1, 251).slice(Number(input["offset"]), Number(input["offset"]) + Number(input["limit"]));
    const call = vi.fn((name: string, input: Record<string, unknown>) =>
      input["withVerification"] === true
        ? new Promise((resolve) => {
            answers.set(Number(input["offset"]), resolve);
          })
        : Promise.resolve({
            ok: true,
            output:
              name === "element.list" ? { elements: elements(input), total: 250 } : NO_SUMMARY[name]?.(),
          }),
    );
    await listHarness(call as unknown as Call, listBuffer("All elements"));
    await press(query('[role="listbox"]'), "End");
    expect(container.querySelectorAll(".row")).toHaveLength(250);
    const page = (offset: number, limit: number, status: string) => ({
      ok: true,
      output: {
        // The second page's first entry is for another element: its row stays empty.
        partial: rowsOf(offset + 1, offset + limit + 1).map((one, at) =>
          offset > 0 && at === 0 ? { ...one, id: "uuid-other" } : one,
        ),
        total: 250,
        rowVerification: Array.from({ length: limit }, () => ({ verification: entry(status) })),
      },
    });
    await act(async () => {
      answers.get(200)?.(page(200, 50, "failed"));
      await Promise.resolve();
    });
    await act(async () => {
      answers.get(0)?.(page(0, 200, "open"));
      await Promise.resolve();
    });
    const at = (n: number) => container.querySelectorAll(".row .verification")[n]?.textContent;
    expect([at(0), at(199), at(200), at(201), at(249)]).toEqual(["open", "open", "", "failed", "failed"]);
  });

  it("asks for no verification of an empty list", async () => {
    const call = vi.fn((name: string) =>
      Promise.resolve({
        ok: true,
        output: name === "element.list" ? { elements: [], total: 0 } : NO_SUMMARY[name]?.(),
      }),
    );
    await listHarness(call as unknown as Call, listBuffer("All elements"));
    expect(call.mock.calls.filter(([name]) => name === "element.list")).toHaveLength(1);
  });

  it("[SR-137/AK-gq6h] a row shows the progress ring of its element's node right of its status, none without, also for a hit", async () => {
    const call = vi.fn((name: string, input: Record<string, unknown>) =>
      Promise.resolve({
        ok: true,
        output:
          name === "element.search"
            ? {
                hits: rowsOf(1, 6).map((one) => ({ ...one, score: 1, fields: ["title"], terms: [] })),
                total: 5,
                incomplete: false,
                ...(input["withVerification"] === true ? { rowVerification: verification } : {}),
              }
            : {},
      }),
    );
    await listHarness(call as unknown as Call, searchBuffer("title"));
    expect(call).toHaveBeenCalledWith("element.search", {
      query: "title",
      withVerification: true,
      limit: 5,
      offset: 0,
    });
    const rings = [...container.querySelectorAll(".row")].map((shownRow) => {
      const ring = shownRow.querySelector(".verification .graph-ring");
      return ring === null ? null : [ring.getAttribute("data-part"), ring.getAttribute("aria-hidden")];
    });
    expect(rings).toEqual([[String(2 / 3), null], null, null, ["0.6", null], null]);
    // The ring sits right of the status, and its text names it, as the row has no label of its own.
    const first = container.querySelector(".row");
    expect([...(first?.children ?? [])].map((child) => child.className)).toEqual([
      "id",
      "title",
      "status",
      "verification",
    ]);
    expect(first?.querySelector(".graph-ring svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ListView, a search", () => {
  const hit = (n: number, extra: object = {}) => ({
    ...row(n),
    score: 1,
    fields: ["title"],
    terms: ["wind"],
    ...extra,
  });

  it("shows the hits of element.search in their order, with the matched words marked", async () => {
    const call = fakeCall({
      "element.search": () => ({
        hits: [
          hit(1, { title: "Wind speed", titleMarks: [{ start: 0, end: 4 }] }),
          hit(2, { title: "Rewind", fields: ["id"], terms: [], identifier: "SR-2" }),
        ],
        total: 2,
        incomplete: false,
      }),
    });
    const { data } = await listHarness(asCall(call), searchBuffer("wind"));
    expect(call).toHaveBeenCalledWith("element.search", { query: "wind", limit: 50, offset: 0 });
    expect(texts(".row .title")).toEqual(["Wind speed", "Rewind"]);
    expect(texts("mark")).toEqual(["Wind", "SR-000002"]);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Search: wind");
    expect(data).toEqual([
      ["search:wind", undefined],
      ["search:wind", { kind: "search", total: 2, incomplete: false, rows: expect.any(Array) as unknown }],
    ]);
  });

  it("[SR-216/AK-yq3n] [SR-216/AK-gg4w] a search in chosen fields asks element.search with them and names them under its heading; core's refusal stands in place of the hits", async () => {
    const fields = [
      { key: "acceptance-criteria", name: "Acceptance Criteria" },
      { key: "text", name: "Text" },
    ];
    const call = fakeCall({
      "element.search": () => ({ hits: [hit(1, { title: "Wind speed" })], total: 1, incomplete: false }),
    });
    await listHarness(asCall(call), searchBuffer("wind", [], undefined, fields));
    // The input of the hits while typing (`searchPrompt`), with the page of the list.
    expect(call).toHaveBeenCalledWith("element.search", {
      query: "wind",
      fields: ["acceptance-criteria", "text"],
      limit: 50,
      offset: 0,
    });
    expect(query("h1").textContent).toMatch(/^Search: wind /u);
    expect(query('[aria-label="Fields"]').textContent).toBe("inAcceptance CriteriaText");
    expect(texts(".search-field")).toEqual(["Acceptance Criteria", "Text"]);

    // Without fields: nothing under the heading.
    await listHarness(asCall(call), searchBuffer("wind"));
    expect(container.querySelector('[aria-label="Fields"]')).toBeNull();

    // A property the metamodel no longer knows: core's message (SR-216 AK2), no hits.
    const refused = fakeCall({
      "element.search": () =>
        Object.assign(new Error("Unknown search field gone"), { code: "input.invalid" }),
    });
    await listHarness(asCall(refused), searchBuffer("wind", [], undefined, [{ key: "gone", name: "Gone" }]));
    expect(texts("p.quiet")).toContain("Unknown search field gone");
    expect(container.querySelectorAll(".row")).toHaveLength(0);
  });

  it("pages in steps of 50", async () => {
    const call = fakeCall({
      "element.search": (input) => ({
        hits: Array.from({ length: Math.min(50, 80 - Number(input["offset"])) }, (_, at) =>
          hit(Number(input["offset"]) + at),
        ),
        total: 80,
        incomplete: false,
      }),
    });
    await listHarness(asCall(call), searchBuffer("wind"));
    expect(container.querySelectorAll(".row")).toHaveLength(50);
    await press(query('[role="listbox"]'), "End");
    expect(call).toHaveBeenLastCalledWith("element.search", { query: "wind", limit: 50, offset: 50 });
    expect(container.querySelectorAll(".row")).toHaveLength(80);
  });

  it("[SR-174/AK-mxnw] shows under the title of a hit in the text that it was found in the text, and the snippet with its marks", async () => {
    const text = "The anemometer measures gusts with pulse counting, as Show a dial shows.";
    const call = fakeCall({
      "element.search": () => ({
        hits: [
          hit(1, {
            title: "Measure the wind",
            fields: ["text"],
            terms: ["gusts", "pulse"],
            snippet: {
              field: "text",
              text,
              marks: [
                { start: 24, end: 29 },
                { start: 35, end: 40 },
              ],
            },
          }),
        ],
        total: 1,
        incomplete: false,
      }),
    });
    await listHarness(asCall(call), searchBuffer("gusts pulse"));
    expect(texts(".row .snippet")).toEqual([`text: ${text}`]);
    expect(texts(".row .snippet .where")).toEqual(["text:"]);
    expect(texts(".row .snippet mark")).toEqual(["gusts", "pulse"]);
    // The title has no match, so nothing in it is marked, though a term would begin a word there.
    expect(texts(".row .title mark")).toEqual([]);
  });

  it("[SR-174/AK-f869] names the property a hit was found in and shows the snippet of its value", async () => {
    const call = fakeCall({
      "element.search": () => ({
        hits: [
          hit(2, {
            title: "Show a dial",
            fields: ["properties"],
            terms: ["hurricane"],
            snippet: {
              field: "properties",
              property: "checks",
              propertyName: "Checks",
              text: "The dial warns before a hurricane arrives.",
              marks: [{ start: 24, end: 33 }],
            },
          }),
        ],
        total: 1,
        incomplete: false,
      }),
    });
    await listHarness(asCall(call), searchBuffer("hurricane"));
    expect(texts(".row .snippet")).toEqual(["Checks: The dial warns before a hurricane arrives."]);
    expect(texts(".row .snippet mark")).toEqual(["hurricane"]);
    // The option is named by ID, title and status; the snippet describes it, and is its tooltip.
    const option = query('[role="option"]');
    const named = (option.getAttribute("aria-labelledby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id));
    expect(named.map((part) => part?.className)).toEqual(["id", "title", "status", "verification"]);
    const described = document.getElementById(option.getAttribute("aria-describedby") ?? "");
    expect(described?.className).toBe("snippet");
    expect(described?.getAttribute("title")).toBe("Checks: The dial warns before a hurricane arrives.");
  });

  it("[SR-174/AK-jtqc] shows no snippet for a hit in the title or an ID only, and marks the title where core says", async () => {
    const call = fakeCall({
      "element.search": () => ({
        hits: [
          hit(3, {
            title: "Survive icing",
            terms: ["icing"],
            titleMarks: [{ start: 8, end: 13 }],
          }),
          // A term that begins a word of the title, but core marks nothing there: nothing is marked.
          hit(4, { title: "Icing alarm", fields: ["id"], terms: ["icing"], identifier: "SR-4" }),
        ],
        total: 2,
        incomplete: false,
      }),
    });
    await listHarness(asCall(call), searchBuffer("icing"));
    expect(container.querySelectorAll(".row .snippet")).toHaveLength(0);
    expect(texts(".row .title mark")).toEqual(["icing"]);
    expect(texts(".row .id mark")).toEqual(["SR-000004"]);
  });

  it("says why the search failed", async () => {
    const call = fakeCall({ "element.search": () => new Error("The search index is not ready") });
    const { echoed } = await listHarness(asCall(call), searchBuffer("wind"));
    expect(query(".quiet").textContent).toBe("The search index is not ready");
    expect(echoed).toEqual(["The search index is not ready"]);
  });

  it("says that nothing was found", async () => {
    const call = fakeCall({ "element.search": () => ({ hits: [], total: 0, incomplete: false }) });
    await listHarness(asCall(call), searchBuffer("zzz"));
    expect(query(".quiet").textContent).toBe("No hits for zzz");
  });
});
