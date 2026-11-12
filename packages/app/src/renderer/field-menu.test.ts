// @vitest-environment happy-dom
// The context menu on a field (SR-196): which box offers "List elements with this value".
import { describe, expect, it } from "vitest";
import type { MenuHit } from "./context-menu.js";
import { FIELD_MENU, LISTABLE } from "./field-menu.js";

const hitOn = (target: Element): MenuHit => ({ place: "field-property", target, point: { x: 0, y: 0 } });

describe("the menu of a field", () => {
  it("[SR-196/AK-ndw1] offers the list on a box marked as listing, not on another box or outside a box", () => {
    document.body.innerHTML = `<div data-field="topic" ${LISTABLE}><span id="topic">Wind</span></div><div data-field="rationale"><span id="rationale">Why</span></div><p id="page"></p>`;
    const at = (id: string): Element => document.getElementById(id) as Element;
    expect(FIELD_MENU.listable(hitOn(at("topic")))).toBe(true);
    expect(FIELD_MENU.listable(hitOn(at("rationale")))).toBe(false);
    expect(FIELD_MENU.listable(hitOn(at("page")))).toBe(false);
    document.body.innerHTML = "";
  });

  it("offers Copy criterion reference only in an editor of the acceptance criteria (SR-205 AK4)", () => {
    document.body.innerHTML = `<div data-field="topic"><span id="topic">Wind</span></div>`;
    expect(FIELD_MENU.criterion(hitOn(document.getElementById("topic") as Element))).toBe(false);
    document.body.innerHTML = "";
  });
});
