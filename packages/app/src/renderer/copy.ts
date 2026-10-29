// "Copy field" (SR-128): the value of each field of an element as the text that goes on the clipboard.
// The value is the one the file stores (the Markdown source of the text, the lines of a box as shown),
// one value per line (#457). Pure: the window puts it on the clipboard.
import type { DataExportElement } from "@reqseq/core";
import type { PropertyBox } from "./element-view.js";
import { TITLE_FIELD, propertyBoxes, relationGroups, relationLabel } from "./element-view.js";

/** One field of the element buffer: the name the status line gives, and its value as text. */
export interface Field {
  readonly label: string;
  readonly text: () => string;
}

/** How long the status line confirms a copy (SR-128 AK2: briefly). */
export const NOTICE_MS = 3000;

/** The values of a field as the text that is copied: one per line. */
export const fieldText = (values: readonly string[]): string => values.join("\n");

/**
 * The heading of the buffer: the title, else (empty or only spaces, as `title-box.ts` shows it) the identifier
 * or short ID the element is named by.
 */
export const heading = (element: DataExportElement): string =>
  element.title.trim() === "" ? (element.identifier ?? element.shortId) : element.title;

/** What the status line says about a copy that worked or failed. */
export const copyNotice = (label: string, copied: boolean): string =>
  copied ? `Copied ${label}` : "Copy failed";

/** The fields of the element to copy, and its ID, which "Copy field" copies when the cursor is in no field. */
export interface Copyable {
  readonly fields: readonly Field[];
  readonly id: Field | undefined;
}

/** Nothing to copy: the element has not loaded. */
export const NOTHING: Copyable = { fields: [], id: undefined };

/** The text of an editor, or none when there is no editor. */
export const docOf = (editor: { readonly doc: () => string } | undefined): string => editor?.doc() ?? "";

/**
 * The fields the element buffer shows: the title, the text (`doc` gives what the editor holds, the
 * unsaved input included), each property box and each group of relations (SR-128 "jedes angezeigten
 * Feldes"); and the ID that the status line names the element by: the identifier when it has one, else
 * the short ID (#457 Q1a). A box with an editor (SR-104) copies what the editor holds, one value per line,
 * the unsaved input included like the text; `boxDoc` gives it by key, or none for a box without editor.
 * `boxes` are the property boxes as shown (the added empty ones included); a relation box copies the labels
 * of its targets, as the relation group did.
 */
export const copyable = (
  element: DataExportElement,
  doc: () => string,
  boxDoc: (key: string) => string | undefined = () => undefined,
  boxes: readonly PropertyBox[] = propertyBoxes(element),
): Copyable => ({
  fields: [
    {
      // What the title's editor holds (#621), the unsaved input included; the heading when it holds nothing.
      label: TITLE_FIELD,
      text: () => {
        const doc = boxDoc(TITLE_FIELD);
        return doc === undefined || doc.trim() === "" ? heading(element) : doc;
      },
    },
    { label: "Text", text: doc },
    ...boxes.map((box) => ({
      label: box.key,
      text: () => boxDoc(box.key) ?? fieldText(box.lines),
    })),
    ...relationGroups(element.relations).map((group) => ({
      label: group.heading,
      text: () => fieldText(group.relations.map(relationLabel)),
    })),
  ],
  id: idField(element),
});

/** The ID field of the element: what the modeline shows first. */
export const idField = (element: DataExportElement): Field => ({
  label: "ID",
  text: () => element.identifier ?? element.shortId,
});

/** The id of the input of the command prompt (Minibuffer.tsx). */
export const PROMPT_INPUT = "prompt-input";

/**
 * The field that "Copy field" copies, by its label: the field the focus is in; while the command prompt
 * has the focus, the field it was in before (`last`); else none, and the ID is copied. `active` is
 * `document.activeElement`.
 */
export const cursorField = (active: Element | null, last: string | undefined): string | undefined => {
  if (active === null) {
    return undefined;
  }
  if (active.closest("[data-buffer]") !== null) {
    return active.closest<HTMLElement>("[data-field]")?.dataset["field"];
  }
  return active.id === PROMPT_INPUT ? last : undefined;
};

/** Hands the field called `label` to `copy`; without such a field (the cursor is in none), the ID. */
export const copyField = (
  from: Copyable,
  label: string | undefined,
  copy: (label: string, text: string) => void,
): void => {
  const field = from.fields.find((candidate) => candidate.label === label) ?? from.id;
  if (field !== undefined) {
    copy(field.label, field.text());
  }
};
