// @vitest-environment happy-dom
// When a list or a search result counts as drawn for the switch in motion (SR-212): its rows with their
// verification and, for a list of its own, its line of coverage, per buffer, without parts of another one.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DrawnPart } from "./list-drawn.js";
import { useDrawnParts } from "./list-drawn.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let note: (which: DrawnPart, of: string) => void = () => undefined;
let drawn: string[] = [];

const Probe = (props: {
  readonly id: string;
  readonly kind: "list" | "search";
  readonly part: boolean;
}): null => {
  note = useDrawnParts(props.id, props.kind, props.part, (key) => {
    drawn.push(key);
  });
  return null;
};

const show = (id: string, kind: "list" | "search" = "list", part = false): void => {
  act(() => {
    root.render(createElement(Probe, { id, kind, part }));
  });
};

beforeEach(() => {
  drawn = [];
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
});

describe("a list drawn for the switch in motion", () => {
  it("[SR-212/AK-d25h] a list is drawn once its rows and its line stand, a search result and a part once their rows do", () => {
    show("list-a");
    note("rows", "list-a");
    expect(drawn).toEqual([]);
    note("line", "list-a");
    expect(drawn).toEqual(["list-a"]);
    show("search-a", "search");
    note("rows", "search-a");
    show("members", "list", true);
    note("rows", "members");
    expect(drawn).toEqual(["list-a", "search-a", "members"]);
  });

  it("[SR-212/AK-d25h] keeps what is drawn per buffer, so the next list in the same view waits for its own parts, and a part of the one before counts for nothing", () => {
    show("list-a");
    note("rows", "list-a");
    note("line", "list-a");
    // The same view shows another list: nothing of the first one counts for it.
    show("list-b");
    note("line", "list-a");
    note("rows", "list-a");
    expect(drawn).toEqual(["list-a"]);
    note("rows", "list-b");
    expect(drawn).toEqual(["list-a"]);
    note("line", "list-b");
    expect(drawn).toEqual(["list-a", "list-b"]);
    // A search result after it in the same view needs no line.
    show("search-b", "search");
    note("line", "list-b");
    note("rows", "search-b");
    expect(drawn).toEqual(["list-a", "list-b", "search-b"]);
  });
});
