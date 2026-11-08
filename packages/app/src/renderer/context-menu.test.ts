// The context menu's places, entries, press, position and keys (D-075, SR-194).
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import type { Choice } from "./actions.js";
import { ACTIONS } from "./actions.js";
import { coveringAction } from "./command-entry.js";
import type { MenuHit, MenuPlace } from "./context-menu.js";
import {
  ALL_COMMANDS,
  CONTEXT_MENU_KEYS,
  EDGE_GAP,
  MENU_PLACES,
  POINTER_GAP,
  isMacCtrlPress,
  menuEntries,
  menuKey,
  menuPosition,
  menuSelection,
  openEntries,
  opensMenu,
  placeAt,
  placeEntries,
} from "./context-menu.js";

const choice = (id: string, name = id): Choice => ({ id, name, run: () => undefined });

/** A pressed element inside the marks `marks` (innermost first), inside an area or not. */
const pressed = (marks: readonly string[], inArea: boolean): Element => {
  const mark = (name: string) => ({
    getAttribute: (attribute: string) => (attribute === "data-menu" ? name : null),
  });
  return {
    closest: (selector: string) =>
      selector === "[data-area]" ? (inArea ? {} : null) : marks[0] === undefined ? null : mark(marks[0]),
  } as unknown as Element;
};

const hit = (place: MenuPlace): MenuHit => ({ place, target: pressed([], true), point: { x: 0, y: 0 } });

const key = (
  name: string,
  mods: Partial<Record<"ctrlKey" | "altKey" | "metaKey" | "shiftKey", boolean>> = {},
) => ({
  key: name,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe("the places of the context menu", () => {
  it("names only entries the command prompt offers: an action, or a catalog command no action covers", () => {
    const commands = getCommandRuntime().contracts.commands;
    for (const entry of Object.values(MENU_PLACES).flat()) {
      const name = entry.id.startsWith("command:") ? entry.id.slice("command:".length) : undefined;
      const command = commands.find((candidate) => candidate.name === name);
      const known =
        name === undefined
          ? ACTIONS.some((action) => action.id === entry.id)
          : command !== undefined && coveringAction(command) === undefined;
      expect(known, entry.id).toBe(true);
    }
  });

  it("[SR-194/AK6] gives a place without entries of its own the buffer's", () => {
    expect(placeEntries("graph")).toBe(MENU_PLACES.buffer);
    expect(placeEntries("buffer").map((entry) => entry.id)).toEqual([
      "go-to",
      "search",
      "close",
      "split-window",
      "other-window",
      "unsplit-window",
    ]);
  });

  it("finds the mark of a press inside an area, else the buffer, and nothing outside the areas", () => {
    expect(placeAt(pressed(["element-entry"], true))).toBe("element-entry");
    expect(placeAt(pressed(["nonsense"], true))).toBe("buffer");
    expect(placeAt(pressed([], true))).toBe("buffer");
    expect(placeAt(pressed(["element-entry"], false))).toBeUndefined();
  });

  it("finds the fields of the modeline outside the areas, and no other mark there (SR-196)", () => {
    expect(placeAt(pressed(["field-short-id"], false))).toBe("field-short-id");
    expect(placeAt(pressed(["field-status"], false))).toBe("field-status");
    expect(placeAt(pressed(["field"], false))).toBeUndefined();
    expect(placeAt(pressed([], false))).toBeUndefined();
  });

  it("[SR-194/AK1] shows the entries the prompt has now, in the place's order, as the prompt names them", () => {
    const items = [choice("search", "Search elements"), choice("close"), choice("go-to"), choice("save")];
    expect(menuEntries(hit("buffer"), items).map((item) => item.id)).toEqual(["go-to", "search", "close"]);
    expect(menuEntries(hit("buffer"), items)[1]).toBe(items[0]);
    expect(ALL_COMMANDS).toBe("All commands…");
    expect(openEntries(undefined, () => items)).toEqual([]);
    expect(openEntries({ hit: hit("buffer") }, () => items)).toHaveLength(3);
  });
});

describe("the menus of the fields (SR-196)", () => {
  const items = [
    "copy-field",
    "add-property",
    "clear-property",
    "list-value",
    "version",
    "command:element.setStatus",
    "save",
  ].map((id) => choice(id));
  /** A press in a property box, with a value that lists elements or not. */
  const inBox = (listable: boolean): MenuHit => ({
    place: "field-property",
    target: {
      closest: (selector: string) =>
        selector === "[data-field]"
          ? { hasAttribute: (name: string) => listable && name === "data-listable" }
          : null,
    } as unknown as Element,
    point: { x: 0, y: 0 },
  });
  const ids = (at: MenuHit): string[] => menuEntries(at, items).map((item) => item.id);

  it("[SR-196/AK1] puts Copy field first on every field", () => {
    for (const place of ["field", "field-property", "field-status", "field-short-id"] as const) {
      expect(ids(place === "field-property" ? inBox(false) : hit(place))[0]).toBe("copy-field");
    }
    expect(ids(hit("field"))).toEqual(["copy-field"]);
  });

  it("[SR-196/AK2] has Add and Clear property on a box, and List elements with this value on one that lists", () => {
    expect(ids(inBox(false))).toEqual(["copy-field", "add-property", "clear-property"]);
    expect(ids(inBox(true))).toEqual(["copy-field", "add-property", "clear-property", "list-value"]);
  });

  it("[SR-196/AK3] has Set status on the status", () => {
    expect(ids(hit("field-status"))).toEqual(["copy-field", "command:element.setStatus"]);
  });

  it("[SR-196/AK4] has Show element ID and version on the short ID", () => {
    expect(ids(hit("field-short-id"))).toEqual(["copy-field", "version"]);
  });
});

describe("the press that opens the menu", () => {
  const press = (button: number, ctrlKey = false, metaKey = false) => ({ button, ctrlKey, metaKey });

  it("[SR-194/AK7] is the right button, and on macOS the left one with Ctrl", () => {
    expect(opensMenu(press(2), false)).toBe(true);
    expect(opensMenu(press(0), true)).toBe(false);
    expect(opensMenu(press(0, true), true)).toBe(true);
    expect(opensMenu(press(0, true, true), true)).toBe(false);
    expect(opensMenu(press(0, true), false)).toBe(false);
    expect(opensMenu(press(1, true), true)).toBe(false);
    expect(isMacCtrlPress(press(0, true), true)).toBe(true);
    expect(isMacCtrlPress(press(2, true), true)).toBe(false);
  });
});

describe("the place of the menu", () => {
  const size = { width: 200, height: 100 };
  const viewport = { width: 800, height: 600 };

  it("[SR-194/AK1] opens right of and below the pointer", () => {
    expect(menuPosition({ x: 100, y: 50 }, size, viewport)).toEqual({
      x: 100 + POINTER_GAP,
      y: 50 + POINTER_GAP,
    });
  });

  it("opens left of or above the pointer where the window has no room, and stays inside", () => {
    expect(menuPosition({ x: 700, y: 550 }, size, viewport)).toEqual({
      x: 700 - POINTER_GAP - 200,
      y: 550 - POINTER_GAP - 100,
    });
    expect(menuPosition({ x: 100, y: 50 }, { width: 900, height: 700 }, viewport)).toEqual({
      x: EDGE_GAP,
      y: EDGE_GAP,
    });
  });
});

describe("the keys of the open menu", () => {
  it("move, jump, choose, close and pass", () => {
    expect(menuKey(key("ArrowDown"))).toEqual({ kind: "move", step: 1 });
    expect(menuKey(key("n", { ctrlKey: true }))).toEqual({ kind: "move", step: 1 });
    expect(menuKey(key("ArrowUp"))).toEqual({ kind: "move", step: -1 });
    expect(menuKey(key("P", { ctrlKey: true }))).toEqual({ kind: "move", step: -1 });
    expect(menuKey(key("Home"))).toEqual({ kind: "first" });
    expect(menuKey(key("End"))).toEqual({ kind: "last" });
    expect(menuKey(key("Enter"))).toEqual({ kind: "choose" });
    expect(menuKey(key(" "))).toEqual({ kind: "choose" });
    expect(menuKey(key("Escape"))).toEqual({ kind: "close" });
    expect(menuKey(key("a"))).toEqual({ kind: "pass" });
    expect(menuKey(key("n", { ctrlKey: true, shiftKey: true }))).toEqual({ kind: "pass" });
    expect(menuKey(key("ArrowDown", { altKey: true }))).toEqual({ kind: "pass" });
  });

  it("are those of the keyboard reference", () => {
    const kinds = CONTEXT_MENU_KEYS.map((row) =>
      row.keys.map((spec) => ("press" in spec ? menuKey(spec.press).kind : "shortcut")),
    );
    expect(kinds).toEqual([
      ["move", "move"],
      ["move", "move"],
      ["first", "last"],
      ["choose", "choose"],
      ["close"],
    ]);
  });

  it("move the selection around the entries", () => {
    expect(menuSelection({ kind: "move", step: 1 }, -1, 4)).toBe(0);
    expect(menuSelection({ kind: "move", step: -1 }, -1, 4)).toBe(3);
    expect(menuSelection({ kind: "move", step: 1 }, 3, 4)).toBe(0);
    expect(menuSelection({ kind: "move", step: -1 }, 0, 4)).toBe(3);
    expect(menuSelection({ kind: "first" }, 2, 4)).toBe(0);
    expect(menuSelection({ kind: "last" }, 0, 4)).toBe(3);
    expect(menuSelection({ kind: "choose" }, 2, 4)).toBe(2);
  });
});
