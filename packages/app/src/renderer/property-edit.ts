// Editing the properties of an element in their boxes (SR-104), as pure functions. A box is one
// document: the values of the property, one per line (a single value is the whole document); the document
// of a choice is its keys, that of a relation its targets, one per line (`id`, `repository`, label). The
// document is built from the value as the file stores it (never from the lines the box shows, which leave
// blank items out), and only a box whose document differs from the stored one goes into the update, so
// the bytes of every other property stay (core rewrites a changed key in its fixed style, SR-102). The
// only write is `element.update { ref, text?, set?, unset? }` (ADR-0002); the app never writes a file.
import type { DataExportElement, DataExportRelation, ElementInputValue } from "@logreq/core";
import type { PropertyBox, PropertyInfo, PropertyModel } from "./element-view.js";
import { propertyBoxes, relationLabel } from "./element-view.js";

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
  /**
   * A relation box with fewer targets than the file stores items (a hand-written item the output gives no
   * target for): not editable, a save would drop that item.
   */
  readonly unmatched?: boolean;
}

/** How many items a stored value has: a list its length, nothing or an empty text none, anything else one. */
const storedItems = (value: unknown): number =>
  Array.isArray(value) ? value.length : value === undefined || value === null || value === "" ? 0 : 1;

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

/** The kinds whose value the user picks in the minibuffer: there is no text to type (SR-104 AK3). */
export const isValueKind = (kind: PropertyInfo["kind"]): boolean => kind === "choice" || kind === "relation";

/** A target of a relation property as a box holds it: its element, and the label the box shows. */
export interface RelationTarget {
  readonly id: string;
  /** The workspace name of the repository of the target; empty when the relation names none. */
  readonly repository: string;
  readonly label: string;
}

/** The target a relation row stands for. */
export const relationTargetOf = (relation: DataExportRelation): RelationTarget => ({
  id: relation.id,
  repository: relation.repository ?? "",
  label: relationLabel(relation),
});

const TAB = "\t";

/** The document of the targets of a relation box: one per line, `id`, `repository` and label between tabs. */
export const relationDoc = (targets: readonly RelationTarget[]): string =>
  targets
    .map(({ id, repository, label }) => [id, repository, label.replace(/\s+/g, " ")].join(TAB))
    .join("\n");

/** The targets a document of a relation box holds. */
export const relationTargets = (doc: string): RelationTarget[] =>
  doc === ""
    ? []
    : doc.split("\n").map((line) => {
        const [id = "", repository = "", ...label] = line.split(TAB);
        return { id, repository, label: label.join(TAB) };
      });

/** The keys a document of a choice box holds. */
export const choiceKeys = (doc: string): string[] => doc.split("\n").filter((key) => key.trim() !== "");

/**
 * The property boxes of the element that can be edited in place: the filled properties (SR-104 AK1) the
 * type of the element has, whose value is text (text, number, date, choice) or the targets of a relation
 * (read-only, `unmatched`, when the targets are not one for each stored item).
 * A property the type does not know stays as it is shown (D-012: core refuses to set or unset it, spec
 * question #469). Keyed by property.
 */
export const editableBoxes = (element: DataExportElement, model: PropertyModel): Map<string, EditableBox> => {
  const type = model.get(element.type);
  const found = new Map<string, EditableBox>();
  for (const box of propertyBoxes(element)) {
    const info = type?.get(box.key);
    if (info === undefined) {
      continue;
    }
    if (info.kind === "relation") {
      if (box.relations !== undefined) {
        found.set(box.key, {
          key: box.key,
          info,
          doc: relationDoc(box.relations.map(relationTargetOf)),
          lineBreak: false,
          unmatched: box.relations.length !== storedItems(element.properties[box.key]),
        });
      }
      continue;
    }
    const value = boxValue(element.properties[box.key], info.many);
    if (value !== undefined && (TEXT_KINDS.includes(info.kind) || info.kind === "choice")) {
      found.set(box.key, { key: box.key, info, ...value });
    }
  }
  return found;
};

/**
 * The properties of the type of the element that no box shows (SR-104 AK2): what "Add property" offers, by
 * name, in the order of the type. A key stored with an empty value has no box (AK1), so it is offered; the
 * title is the heading, not a box, and a key the type does not know is not a property of it (D-012).
 * `added` are the keys with an empty box already.
 */
export const addableProperties = (
  element: DataExportElement,
  model: PropertyModel,
  added: readonly string[] = [],
): { readonly key: string; readonly name: string; readonly info: PropertyInfo }[] => {
  const taken = new Set([...propertyBoxes(element).map((box) => box.key), ...added]);
  return [...(model.get(element.type) ?? [])]
    .filter(([key, info]) => info.meaning !== "title" && !taken.has(key))
    .map(([key, info]) => ({ key, name: info.name ?? key, info }));
};

/**
 * The boxes the buffer shows: the filled properties in the order of the file, and the added empty boxes
 * (SR-104 AK2) each at its place in the order of the type, where core writes the property: before the first
 * box whose key comes later in the type. A key the type does not know comes after every key it has.
 */
export const shownBoxes = (
  element: DataExportElement,
  model: PropertyModel,
  added: readonly string[],
): PropertyBox[] => {
  const keys = [...(model.get(element.type)?.keys() ?? [])];
  const rank = (key: string): number => {
    const at = keys.indexOf(key);
    return at < 0 ? Number.POSITIVE_INFINITY : at;
  };
  const shown = propertyBoxes(element);
  for (const key of keys.filter((candidate) => added.includes(candidate))) {
    if (!shown.some((box) => box.key === key)) {
      const before = shown.findIndex((box) => rank(box.key) > rank(key));
      shown.splice(before < 0 ? shown.length : before, 0, { key, lines: [] });
    }
  }
  return shown;
};

/** An empty box of a property that was added, with no stored value: its editable box. */
export const emptyBox = (key: string, info: PropertyInfo): EditableBox => ({
  key,
  info,
  doc: "",
  lineBreak: false,
});

/** The editable boxes of the element and the added empty ones. */
export const allBoxes = (
  element: DataExportElement,
  model: PropertyModel,
  added: readonly string[],
): Map<string, EditableBox> => {
  const boxes = editableBoxes(element, model);
  const type = model.get(element.type);
  const filled = new Set(propertyBoxes(element).map((box) => box.key));
  for (const key of added) {
    const info = type?.get(key);
    if (info !== undefined && !filled.has(key)) {
      boxes.set(key, emptyBox(key, info));
    }
  }
  return boxes;
};

/** One value of a choice as the prompt lists it. */
export interface ChoiceItem {
  readonly key: string;
  readonly name: string;
  /** `set` for a value the property holds (taking it again removes it from a list), else the key. */
  readonly hint: string;
  readonly set: boolean;
}

/**
 * The values the prompt offers for a choice property: exactly the choices of the metamodel (SR-104 AK3),
 * the ones that are set first. A stored value the metamodel does not list is offered too, so it can be removed.
 */
export const choiceItems = (info: PropertyInfo, current: readonly string[]): ChoiceItem[] => {
  const choices = info.choices ?? [];
  const known = new Set(choices.map((choice) => choice.key));
  const set = [
    ...choices.filter((choice) => current.includes(choice.key)),
    ...current.filter((key) => !known.has(key)).map((key) => ({ key, name: key })),
  ].map((choice) => ({ ...choice, hint: "set", set: true }));
  const rest = choices
    .filter((choice) => !current.includes(choice.key))
    .map((choice) => ({ ...choice, hint: choice.key, set: false }));
  return [...set, ...rest];
};

/** The keys after a choice is taken: it replaces the value of a single choice, and toggles in a list. */
export const chooseKey = (info: PropertyInfo, current: readonly string[], key: string): string[] => {
  if (!info.many) {
    return [key];
  }
  return current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key];
};

const sameTarget = (a: RelationTarget, b: RelationTarget): boolean =>
  a.id === b.id && a.repository === b.repository;

/**
 * The targets after one is taken: a target that is set is removed; else it replaces the target of a single
 * relation and is appended to a list.
 */
export const chooseTarget = (
  info: PropertyInfo,
  current: readonly RelationTarget[],
  chosen: RelationTarget,
): RelationTarget[] => {
  if (current.some((target) => sameTarget(target, chosen))) {
    return current.filter((target) => !sameTarget(target, chosen));
  }
  return info.many ? [...current, chosen] : [chosen];
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

/** The boxes with the document their editor holds, as edits against the stored documents they were typed on, in the order of the boxes. */
export const editsOf = (
  boxes: ReadonlyMap<string, EditableBox>,
  docs: ReadonlyMap<string, string>,
): BoxEdit[] =>
  [...boxes].flatMap(([key, box]): BoxEdit[] => {
    const doc = docs.get(key);
    return doc === undefined ? [] : [{ key, info: box.info, base: box.doc, doc }];
  });

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** One line of a box as a value: a decimal literal of a number property is a number, anything else stays text. */
const valueOf = (kind: PropertyInfo["kind"], line: string): string | number =>
  kind === "number" && DECIMAL.test(line) ? Number(line) : line;

/** The value a changed box stores: none (the property is removed) when nothing but blank is left. */
const newValue = (edit: BoxEdit): ElementInputValue | undefined => {
  const { kind, many } = edit.info;
  if (kind === "relation") {
    // Core keeps the stored version of a target that stays and names the repository when it is another one.
    const targets = relationTargets(edit.doc).map(
      ({ id, repository }): { id: string; repository?: string } => ({
        id,
        ...(repository === "" ? {} : { repository }),
      }),
    );
    const [only] = targets;
    return only === undefined ? undefined : many ? targets : only;
  }
  const lines = many || kind === "choice" ? edit.doc.split("\n") : [edit.doc];
  const kept = lines.filter((line) => line.trim() !== "").map((line) => valueOf(kind, line));
  const [first] = kept;
  if (first === undefined) {
    return undefined;
  }
  return many ? kept : first;
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
