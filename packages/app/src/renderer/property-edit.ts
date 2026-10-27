// Editing the text properties of an element in their boxes (SR-104), as pure functions. A box is one
// document: the values of the property, one per line (a single value is the whole document). The
// document is built from the value as the file stores it (never from the lines the box shows, which leave
// blank items out), and only a box whose document differs from the stored one goes into the update, so
// the bytes of every other property stay (core rewrites a changed key in its fixed style, SR-102). The
// only write is `element.update { ref, text?, set?, unset? }` (ADR-0002); the app never writes a file.
import type { DataExportElement, ElementInputValue } from "@logreq/core";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import { propertyBoxes } from "./element-view.js";

/** The kinds whose value is text in a box: what the editor can show and the user can type. */
export const TEXT_KINDS: readonly PropertyInfo["kind"][] = ["text", "number", "date"];

/** A property box and what it needs to be edited. */
export interface EditableBox {
  readonly key: string;
  readonly info: PropertyInfo;
  /** The document of the stored value. */
  readonly doc: string;
  /** A list with a value that holds a line break (hand-written file): not editable, one value per line would lie. */
  readonly lineBreak: boolean;
}

/**
 * The document of a stored value: a string as it is, a number as its text, a list with one item per line.
 * Undefined for a value that is not text (a mapping, a boolean, a list of lists).
 */
export const boxValue = (value: unknown, many: boolean): Omit<EditableBox, "key" | "info"> | undefined => {
  const items = Array.isArray(value) ? (value as unknown[]) : [value];
  if (!items.every((item) => typeof item === "string" || typeof item === "number")) {
    return undefined;
  }
  const texts = items.map(String);
  return {
    doc: texts.join("\n"),
    lineBreak: (many || Array.isArray(value)) && texts.some((text) => text.includes("\n")),
  };
};

/**
 * The property boxes of the element that can be edited in place: the filled properties (SR-104 AK1) the
 * type of the element has, of a text kind, with a value that is text. A property the type does not know
 * stays as it is shown (D-012: core refuses to set or unset it, spec question #469). Keyed by property.
 */
export const editableBoxes = (element: DataExportElement, model: PropertyModel): Map<string, EditableBox> => {
  const type = model.get(element.type);
  const found = new Map<string, EditableBox>();
  for (const box of propertyBoxes(element)) {
    const info = type?.get(box.key);
    const value = info === undefined ? undefined : boxValue(element.properties[box.key], info.many);
    if (info !== undefined && value !== undefined && TEXT_KINDS.includes(info.kind)) {
      found.set(box.key, { key: box.key, info, ...value });
    }
  }
  return found;
};

/** The stored document of each editable box, by key. */
export const storedDocs = (boxes: ReadonlyMap<string, EditableBox>): Map<string, string> =>
  new Map([...boxes].map(([key, box]) => [key, box.doc]));

/** A box whose document differs from the stored one. */
export interface BoxEdit {
  readonly key: string;
  readonly info: PropertyInfo;
  /** The document of the stored value the edit was typed on. */
  readonly base: string;
  readonly doc: string;
}

/** The boxes with the document their editor holds, as edits against the stored documents they were typed on. */
export const editsOf = (
  boxes: ReadonlyMap<string, EditableBox>,
  docs: ReadonlyMap<string, string>,
): BoxEdit[] =>
  [...docs].flatMap(([key, doc]): BoxEdit[] => {
    const box = boxes.get(key);
    return box === undefined ? [] : [{ key, info: box.info, base: box.doc, doc }];
  });

/**
 * Whether the file changed a box that has unsaved input: the stored document of a box differs from the one
 * its input was typed on (`before`; none when the property is gone), and its editor holds something else
 * than that (`docs`).
 */
export const changedUnderEdit = (
  before: ReadonlyMap<string, string>,
  now: ReadonlyMap<string, string>,
  docs: ReadonlyMap<string, string>,
): boolean => [...docs].some(([key, doc]) => now.get(key) !== before.get(key) && doc !== before.get(key));

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** One line of a box as a value: a decimal literal of a number property is a number, anything else stays text. */
const valueOf = (kind: PropertyInfo["kind"], line: string): string | number =>
  kind === "number" && DECIMAL.test(line) ? Number(line) : line;

/** The value a changed box stores: none (the property is removed) when nothing but blank is left. */
const newValue = (edit: BoxEdit): ElementInputValue | undefined => {
  const lines = edit.info.many ? edit.doc.split("\n") : [edit.doc];
  const kept = lines.filter((line) => line.trim() !== "").map((line) => valueOf(edit.info.kind, line));
  const [first] = kept;
  if (first === undefined) {
    return undefined;
  }
  return edit.info.many ? kept : first;
};

/** The input of `element.update` for the text and the boxes that changed (AK4: an emptied box is `unset`). */
export interface UpdateInput {
  readonly ref: string;
  readonly text?: string;
  readonly set?: Readonly<Record<string, ElementInputValue>>;
  readonly unset?: readonly string[];
}

/** The boxes whose document differs from the stored one. */
export const changedBoxes = (edits: readonly BoxEdit[]): BoxEdit[] =>
  edits.filter((edit) => edit.doc !== edit.base);

/**
 * The input that saves the text (when given) and the changed boxes together. Lines that are blank are
 * dropped; every other line is kept byte for byte; a box with nothing left is removed with `unset`.
 */
export const updateInput = (
  ref: string,
  text: string | undefined,
  edits: readonly BoxEdit[],
): UpdateInput => {
  const set: Record<string, ElementInputValue> = {};
  const unset: string[] = [];
  for (const edit of changedBoxes(edits)) {
    const value = newValue(edit);
    if (value === undefined) {
      unset.push(edit.key);
    } else {
      set[edit.key] = value;
    }
  }
  return {
    ref,
    ...(text === undefined ? {} : { text }),
    ...(Object.keys(set).length === 0 ? {} : { set }),
    ...(unset.length === 0 ? {} : { unset }),
  };
};

/**
 * The first hint of an answer about one of the keys that were saved: core names the property in its
 * message (SR-085), the app appends it to "Saved ..." and colours nothing (D-062).
 */
export const savedHint = (
  problems: readonly { readonly message: string }[] | undefined,
  keys: readonly string[],
): string | undefined =>
  problems?.find((problem) => keys.some((key) => problem.message.includes(key)))?.message;
