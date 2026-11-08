// @vitest-environment happy-dom
// The context menu of a list outside its rows (SR-198): its entries, and "Ungroup list" on a grouped list.
import { describe, expect, it } from "vitest";
import type { Choice } from "./actions.js";
import type { MenuHit } from "./context-menu.js";
import { MENU_PLACES, menuEntries } from "./context-menu.js";
import { GROUPED, LIST_MENU } from "./list-menu.js";

const choice = (id: string): Choice => ({ id, name: id, run: () => undefined });

const hitOn = (target: Element): MenuHit => ({ place: "list", target, point: { x: 0, y: 0 } });

const ids = (target: Element, offered: readonly string[]): string[] =>
  menuEntries(hitOn(target), offered.map(choice)).map((item) => item.id);

describe("the menu of a list", () => {
  it("[SR-198/AK1] has the filters, Sort and Group, Ungroup on a grouped list and Clear all on a filtered one", () => {
    expect(MENU_PLACES.list).toEqual(LIST_MENU);
    document.body.innerHTML = `<div data-menu="list"><h1 id="plain">All</h1></div><div data-menu="list" ${GROUPED}><h1 id="grouped">All</h1></div>`;
    const at = (id: string): Element => document.getElementById(id) as Element;
    const unfiltered = [
      "filter-type",
      "filter-status",
      "filter-property",
      "filter-text",
      "sort",
      "group",
      "save",
    ];
    expect(ids(at("plain"), unfiltered)).toEqual([
      "filter-type",
      "filter-status",
      "filter-text",
      "sort",
      "group",
    ]);
    // Grouped and filtered: the prompt offers Group list (by another value) and Ungroup list, the menu only Ungroup.
    const grouped = [...unfiltered, "ungroup", "clear-filter", "clear-filters"];
    expect(ids(at("grouped"), grouped)).toEqual([
      "filter-type",
      "filter-status",
      "filter-text",
      "sort",
      "ungroup",
      "clear-filters",
    ]);
    document.body.innerHTML = "";
  });
});
