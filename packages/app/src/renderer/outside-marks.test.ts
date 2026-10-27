// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import type { DataExportElement } from "@logreq/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRESH_MS,
  MARK_BOUND_MS,
  MARK_MS,
  NO_CHANGES,
  arrivals,
  changedFields,
  fieldTexts,
  nextChanges,
  namedSince,
} from "./outside-marks.js";
import type { OutsideMarks } from "./use-outside-marks.js";
import { OUTSIDE_CHANGE, rowClass, useOutsideMarks } from "./use-outside-marks.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lists = (changed: string[], added: string[] = [], removed: string[] = []) => ({
  added,
  changed,
  removed,
});

describe("arrivals: what changed outside, for FRESH_MS", () => {
  it("[SR-116/AK1] counts a changed or added element as fresh for 2 s, a removed one never", () => {
    let now = 1_000;
    const fresh = arrivals(() => now);
    fresh.record(lists(["a"], ["b"], ["c"]));
    expect(["a", "b", "c", "d"].map(fresh.fresh)).toEqual([true, true, false, false]);
    now += FRESH_MS;
    expect(fresh.fresh("a")).toBe(true);
    now += 1;
    expect(fresh.fresh("a")).toBe(false);
  });

  it("forgets what is older than FRESH_MS when the next change comes, and renews what changes again", () => {
    let now = 0;
    const fresh = arrivals(() => now);
    fresh.record(lists(["a", "b"]));
    now = FRESH_MS + 1;
    fresh.record(lists(["b"]));
    expect(fresh.fresh("a")).toBe(false);
    expect(fresh.fresh("b")).toBe(true);
    // Nothing older stays for later: even with a clock that goes back, "a" is gone.
    now = 0;
    expect(fresh.fresh("a")).toBe(false);
  });

  it("uses the time of day by default", () => {
    const fresh = arrivals();
    fresh.record(lists(["a"]));
    expect(fresh.fresh("a")).toBe(true);
  });
});

describe("nextChanges", () => {
  it("counts up and notes the change that added or changed each UUID last, not the removed ones", () => {
    const fresh = (): boolean => true;
    const next = nextChanges(NO_CHANGES, lists(["a"], ["b"], ["c"]), fresh);
    expect(next.seq).toBe(1);
    expect([...next.named]).toEqual([
      ["b", 1],
      ["a", 1],
    ]);
    expect(next.fresh).toBe(fresh);
    const later = nextChanges(next, lists(["b"]), fresh);
    expect(later).toMatchObject({
      seq: 2,
      named: new Map([
        ["b", 2],
        ["a", 1],
      ]),
    });
    expect(NO_CHANGES.fresh("a")).toBe(false);
  });

  it("tells a view whether its element was named after the change it saw last, also across skipped ones", () => {
    const fresh = (): boolean => true;
    const first = nextChanges(NO_CHANGES, lists(["a"]), fresh);
    const second = nextChanges(first, lists(["b"]), fresh);
    // A view that saw neither batch (both arrived before it rendered) reads again for "a".
    expect(namedSince(second, "a", 0)).toBe(true);
    expect(namedSince(second, "a", 1)).toBe(false);
    expect(namedSince(second, "b", 1)).toBe(true);
    expect(namedSince(second, "c", 0)).toBe(false);
  });
});

const element = (extra: Record<string, unknown> = {}): DataExportElement =>
  ({
    id: "uuid-1",
    shortId: "SR-000001",
    identifier: "SR-1",
    type: "system-requirement",
    status: "draft",
    title: "Show gusts",
    text: "The station shows gusts.",
    repository: "spec",
    file: "f.md",
    properties: { rationale: "Wind", "acceptance-criteria": ["One", "Two"], packages: "PKG-1" },
    relations: [
      { kind: "packages", direction: "out", property: true, id: "p", title: "Stage", repository: "spec" },
      { kind: "derives-from", direction: "out", id: "n", title: "Need", repository: "spec" },
      { kind: "derives-from", direction: "in", id: "c", title: "Child", repository: "spec" },
    ],
    ...extra,
  }) as unknown as DataExportElement;

describe("fieldTexts and changedFields: what to highlight in an element buffer", () => {
  it("names each field by its label: the title, the text, the boxes and the relation groups", () => {
    expect([...fieldTexts(element()).keys()]).toEqual([
      "Title",
      "Text",
      "rationale",
      "acceptance-criteria",
      "packages",
      "derives-from",
      "← derives-from",
    ]);
    expect(fieldTexts(element({ title: "", text: undefined })).get("Title")).toBe("SR-1");
    expect(fieldTexts(element({ text: undefined })).get("Text")).toBe("");
  });

  it("[SR-116/AK1] highlights the fields that differ, never one with input, and the title when nothing shown differs", () => {
    const before = fieldTexts(element());
    const changed = fieldTexts(
      element({
        text: "The station shows gusts in km/h.",
        properties: { rationale: "Wind", "acceptance-criteria": ["One", "Three"], packages: "PKG-1" },
      }),
    );
    expect(changedFields(before, changed, new Set())).toEqual(["Text", "acceptance-criteria"]);
    // The text with input keeps it: only the box is highlighted.
    expect(changedFields(before, changed, new Set(["Text"]))).toEqual(["acceptance-criteria"]);
    // Every field that changed has input: nothing is highlighted, the input speaks.
    expect(changedFields(before, changed, new Set(["Text", "acceptance-criteria"]))).toEqual([]);
    // Other bytes, the same fields (a status, a property that is not shown): the title.
    expect(changedFields(before, fieldTexts(element()), new Set())).toEqual(["Title"]);
    // A box that is gone has nothing to tint: the title stands for it.
    const emptied = fieldTexts(
      element({ properties: { "acceptance-criteria": ["One", "Two"], packages: "PKG-1" } }),
    );
    expect(changedFields(before, emptied, new Set())).toEqual(["Title"]);
    // A relation group that came.
    const related = fieldTexts(
      element({
        relations: [
          ...element().relations,
          { kind: "excludes", direction: "out", id: "x", title: "Other", repository: "spec" },
        ] as DataExportElement["relations"],
      }),
    );
    expect(changedFields(before, related, new Set())).toEqual(["excludes"]);
  });

  it("highlights the title of a buffer that shows the element for the first time", () => {
    expect(changedFields(undefined, fieldTexts(element()), new Set(["Text"]))).toEqual(["Title"]);
  });
});

describe("useOutsideMarks", () => {
  let container: HTMLElement;
  let root: Root;
  let marks: OutsideMarks;

  const Probe = (): null => {
    marks = useOutsideMarks();
    return null;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(Probe));
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("[SR-116/AK2] leaves no mark standing 3 s after it was set", () => {
    // Removed when the fade ends, with room before the bound for a timer that fires late.
    expect(MARK_MS).toBeLessThanOrEqual(MARK_BOUND_MS - 500);
    act(() => {
      marks.mark(["a", "b", "a"]);
    });
    expect([...marks.marked]).toEqual(["a", "b"]);
    act(() => {
      vi.advanceTimersByTime(MARK_MS - 1);
    });
    expect(marks.marked.size).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(marks.marked.size).toBe(0);
  });

  it("keeps the time of a mark that is set again, so an element flashes once", () => {
    act(() => {
      marks.mark(["a"]);
    });
    act(() => {
      vi.advanceTimersByTime(MARK_MS - 100);
      marks.mark(["a", "b"]);
    });
    expect([...marks.marked]).toEqual(["a", "b"]);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect([...marks.marked]).toEqual(["b"]);
    const before = marks.marked;
    act(() => {
      marks.mark([]);
      marks.mark(["b"]);
    });
    expect(marks.marked).toBe(before);
  });

  it("stops its timers when the view goes", () => {
    act(() => {
      marks.mark(["a"]);
    });
    act(() => {
      root.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

  it("gives a row its class while it is marked", () => {
    expect(rowClass("row", new Set(["a"]), "a")).toBe(`row ${OUTSIDE_CHANGE}`);
    expect(rowClass("row", new Set(["a"]), "b")).toBe("row");
  });
});
