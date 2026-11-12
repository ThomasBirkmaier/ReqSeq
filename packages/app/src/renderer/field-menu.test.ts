// @vitest-environment happy-dom
// The context menu on a field (SR-196): which box offers "List elements with this value".
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import type { MenuHit } from "./context-menu.js";
import { KEY_MARK } from "./criterion-doc.js";
import { criterionKeys } from "./editor/criterion-keys.js";
import { FIELD_MENU, LISTABLE, pressedCriterion } from "./field-menu.js";

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

  it("[SR-205/AK-zvtb] takes the line pressed, not the caret of a selection over several lines", () => {
    document.body.innerHTML = `<div data-field="acceptance-criteria"></div>`;
    const parent = document.querySelector("[data-field]") ?? document.body;
    const codec = criterionKeys();
    const { text, init } = codec.decode(`kaaa${KEY_MARK}Alpha\n\nkbbb${KEY_MARK}Beta`);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        // From the start of "Alpha" to the end of "Beta": the caret is on line 3.
        selection: EditorSelection.single(0, text.length),
        extensions: [init, codec.extension],
      }),
    });
    const [alpha, blank] = [...parent.querySelectorAll(".cm-line")];
    expect(alpha === undefined ? undefined : pressedCriterion(alpha)).toEqual({
      field: "acceptance-criteria",
      at: { key: "kaaa", line: 1, text: "Alpha" },
    });
    expect(alpha === undefined ? false : FIELD_MENU.criterion(hitOn(alpha))).toBe(true);
    // A blank line, and the editor outside a line, hold no criterion.
    expect(blank === undefined ? "none" : pressedCriterion(blank)).toBeUndefined();
    expect(pressedCriterion(view.contentDOM)).toBeUndefined();
    view.destroy();
    document.body.innerHTML = "";
  });
});
