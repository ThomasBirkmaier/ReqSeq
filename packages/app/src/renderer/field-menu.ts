// The context menu on a field of an element (SR-196): what its entries ask of the field pressed. The press
// has already given the field the focus (`focusPressed`), so "Copy field", "Clear property" and "List
// elements with this value" act on it as from the command prompt with the cursor in it. Display only: the
// actions do the work.
import { EditorView } from "@codemirror/view";
import type { MenuHit } from "./context-menu.js";
import { criterionAtPos } from "./criterion-reference.js";

/** The mark of a property box with a value that lists elements (SR-132): set by the element buffer. */
export const LISTABLE = "data-listable";

/** The tests of the entries of the places `field…` (`MENU_PLACES`). */
export const FIELD_MENU = {
  /** AK2: "List elements with this value" on a box whose values open a list (not long free text, SR-132 AK4). */
  listable: (hit: MenuHit): boolean => hit.target.closest("[data-field]")?.hasAttribute(LISTABLE) === true,
  /** SR-205 AK4: "Copy criterion reference" on a line of the acceptance criteria box that is not blank, where the press was. */
  criterion: (hit: MenuHit): boolean => {
    const editor = hit.target.closest("[data-field]")?.querySelector(".cm-editor");
    const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null;
    if (view === null) {
      return false;
    }
    const pos = view.posAtCoords(hit.point);
    return pos !== null && criterionAtPos(view.state, pos) !== undefined;
  },
} as const;
