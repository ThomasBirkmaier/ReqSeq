# Context menu

Part of the [`@reqseq/app` README](../README.md).

A right-click in an area of the sheet, on macOS also a click with Ctrl held, opens the app's own menu at the pointer (D-075, SR-194). It is no menu of the system: the window prevents every `contextmenu` and draws `ContextMenu.tsx` beside the minibuffer, in the tokens of the card (`.context-menu`). The menu brings no functions of its own. Each entry is an entry of the command prompt, under its name and with its key (`commands().items`, SR-109), shown only where it can run now; the last one, after a separator, is "All commands…" with the key of the command prompt, which opens the command prompt with an empty input (SR-133 orders it by fit to the shown view).

- **Places (`context-menu.ts`):** `MENU_PLACES` holds the fixed entries of each place, as action ids or `command:<name>`. A view marks a place with `data-menu="<place>"`; `placeAt` takes the nearest mark inside the area (`[data-area]`), and a press on no mark, or on a place whose block is still empty, gets the entries of `buffer` (AK6). Outside the areas there is no menu, except on the ID and the status of an element in the modeline (SR-196, below). A place works out its details from `MenuHit` (`place`, `target`, `point`); nothing parses `data-menu-*`. A unit test checks that every id is an action or a catalog command no action covers. Each block keeps its lines, so the SRs that fill a place touch only their own.
- **Opening (`use-context-menu.ts`):** the right press (and on macOS Ctrl+left, `opensMenu`) in an area is prevented, so Chromium selects no word and starts no drag; it focuses what it pressed, and in a text editor puts the caret at the pointer unless the press is inside the selection (`focusPressed`). The `contextmenu` that follows opens the menu 2 px right of and below the pointer, or left of and above it where the window has no room, measured before the first paint (`menuPosition`). A `contextmenu` without a press (the Menu key, Shift+F10) opens at the caret, the selected row or node, or the area's corner, with the first entry selected. An open prompt ends. On macOS the Ctrl+press and its click go nowhere else (not to a list, a link or a drag), and Blink sends the `contextmenu` itself.
- **Selection (AK5):** a right-click on a list row, a search hit, a row of the overview or the neighbourhood, an entry of a package page, a node of the graph or the metamodel, a target of the matrix or a cell of the matrix selects it in the same render that opens the menu (each view's `onContextMenu`). The element is the marked one of the context (`markedElement`): the matrix reports its selected target, or the row of its selected cell (`aria-selected` on the `gridcell`), and a package page its selected entry. The marks set so far are `element-entry` (rows, hits, nodes, targets) and `matrix-cell`.
- **Running (AK2):** a click with the left button closes the menu and runs the entry with the id clicked, from the command prompt's entries built again from the latest context, after the same step a prompt takes first (`beforeCommand`: the input of the element is saved, the message goes). A choice in the menu is not recorded as a use of the command prompt.
- **Keys and focus:** the menu never takes the focus, so the editor, the list and the active area keep theirs. While it is open the window takes its keys first (`CONTEXT_MENU_KEYS`: Up/Down and Ctrl+P/N, Home/End, Enter/Space, Escape); any other key closes it and acts as without it.
- **Closing (AK4):** Escape; a press of the left or middle button outside it, which then acts as it would without the menu (as the command prompt in SR-134 AK3; the assumption of the PR); a right-click elsewhere, which opens that place's menu; a blur, a resize, a wheel outside, another shown buffer and an opening prompt. While it is open the mouse buttons Back and Forward do nothing.

## buffer

SR-194 AK6: "Go to element or buffer", "Search elements", "Close buffer", "Split window"; in a split window "Other window" and "Unsplit window" in place of "Split window".

## text

SR-195 (`text-menu.ts`), marked on the editor of the element's text (`Editor` with `menu="text"`), not on the boxes of properties: "Follow reference" first on a reference to an element (AK4); "Cut" and "Copy" with text selected, then always "Paste", "Bold", "Italic", "Inline code", "Link" and "Insert image" (AK1); in a table "Insert row", "Delete row", "Insert column", "Delete column" and "Align table" (AK5); on a heading with a section "Fold section", or "Unfold section" when it is folded (AK6). Each test reads the editor's state at its caret, which the right press has put at the pointer or kept in the selection it landed in (AK2, `focusPressed`); a press on a cell of a drawn table puts the caret in that cell (`pressedPosition`), since the drawing is one widget. "Follow reference" is shown on `reqseq:` references only: the app follows no other link (assumption, spec question #1176).

"Cut", "Copy" and "Paste" are actions of the command prompt too (`text-actions.ts`, `editor/clipboard.ts`), with the system's keys as their hint (`systemKey`: the window binds nothing to them, the field takes the key). They act on the field with the cursor, the text or a Markdown box, as the other text actions do. Cut and Copy ask the browser for its own cut or copy (`document.execCommand`) in the focused editor, within the click's or the Enter's activation, so CodeMirror gets the clipboard event of the key. Paste gives the editor the focus and asks main (`pasteText`, `reqseq:edit`), which pastes as the Edit menu does, after a left click or a bare Enter only (chosen in the menu by key, it takes Enter, not Space): the editor gets the paste event of Ctrl/Cmd+V, an image is copied as in SR-190 (`paste.ts`). The renderer never reads the clipboard.

## field, field-property, field-status, field-short-id

SR-196, marked on the fields (`FieldBox` with `menu`), not on the text, which is `text`. "Copy field" is first everywhere (AK1). `field`: the title and each group of relations. `field-property`: each property box, with "Add property" and "Clear property", and "List elements with this value" on a box with a value that lists elements (AK2): the element buffer marks such a box `data-listable` from the `element.facets` it asks for anyway (SR-132), so long free text never offers it (`field-menu.ts`). `field-status` has "Set status" (the catalog command, refs the shown element as in the prompt, AK3) and `field-short-id` "Show element ID and version" (AK4).

The element buffer shows no short ID and no status: the modeline does, as the ID field of SR-128 and the status after the type. So these two are the places (assumption, spec question #1179): `placeAt` takes them outside the areas, and nothing else of the modeline. They take the focus of a right press (`tabindex="-1"`), and "Copy field" copies the field of the modeline with the focus (`copiedField`): the ID, or the status, which `copyable` has as a field. A right press on a field that takes no focus itself (a group of relations) focuses its first control, so the cursor is in the field pressed (`focusPressed`). Each entry then acts as from the command prompt with the cursor in that field.

## element-entry

SR-197.

## list

SR-198.

## graph, metamodel-graph

SR-199.

## matrix-cell, matrix-target

SR-199.
