// What an element buffer holds against its file (SR-105, SR-106, SR-116), as pure functions: the text as last
// loaded or saved, the stored document of every box and of the title (`TITLE_FIELD`, #621), the boxes that were
// added, and the documents of the choice and relation boxes set in the minibuffer. `ElementView` keeps one
// `BufferFields` in a ref, passes it in with what its editors hold at that moment and applies what comes back
// in the order it always did: the editors, the draft and the state that renders stay there, because an editor
// that is replaced or set calls back into the buffer at once (ADR-0016: the rules are covered here, the
// component only calls them).
// - A reload: a field without input follows the file (SR-106 AK1); input stays, and a box with input whose
//   property left the file stays as an added box (SR-116 AK3); the outside-change rule decides the rest.
// - A draft shown again is compared with the file as it is now (SR-106, `outside-change.ts`).
// - After a save, input typed while it ran stays for the next save (SR-105 AK1).
// The title is a field like a text box: its editor is one of the box editors and its stored document comes
// with the others (`fieldBoxes`, `property-edit.ts`).
import type { DataExportElement } from "@logreq/core";
import type { BoxDraft, Draft } from "./drafts.js";
import { boxDrafts, makeDraft, sameDraft } from "./drafts.js";
import type { PropertyModel } from "./element-view.js";
import { TITLE_FIELD } from "./element-view.js";
import { afterSave, dirty } from "./editor/save.js";
import type { OutsideChange } from "./outside-change.js";
import { TEXT_FIELD, draftInput, keptBoxes as keptBoxesOf, outsideChange } from "./outside-change.js";
import { isValueKind } from "./property-edit.js";

/** The file side of the buffer's fields, as last loaded or saved. */
export interface BufferFields {
  /** The text: what the text editor is compared with. */
  readonly baseline: string;
  /**
   * The documents of the editable boxes and of the title (`TITLE_FIELD`, when the type has one), as
   * `storedDocs(fieldBoxes(...))` gives them; the empty document for an added box.
   */
  readonly stored: ReadonlyMap<string, string>;
  /** The boxes added (SR-104 AK2) or kept for their input: their base is the empty document. */
  readonly added: readonly string[];
  /** The documents of the choice and relation boxes with input: no editor holds them. */
  readonly values: ReadonlyMap<string, string>;
}

/** Before the first answer. */
export const NO_FIELDS: BufferFields = { baseline: "", stored: new Map(), added: [], values: new Map() };

/** What one write sent, as far as the fields need it: the text, and the boxes (the title among them) that went. */
export interface SentFields {
  readonly doc: string;
  readonly edits: readonly { readonly key: string; readonly doc: string }[];
  readonly added: readonly string[];
}

/** What the boxes hold, by key: the documents of their editors, then the values set in the minibuffer. */
export const boxDocs = (
  editors: Iterable<readonly [string, string]>,
  values: ReadonlyMap<string, string>,
): Map<string, string> => new Map([...editors, ...values]);

/**
 * The fields with input and what they hold: the text when it was typed in (`textDoc` undefined: no text
 * editor yet, so none), and every box whose document is not the stored one.
 */
export const inputDocs = (
  fields: BufferFields,
  textDoc: string | undefined,
  boxes: ReadonlyMap<string, string>,
): Map<string, string> => {
  const doc = textDoc ?? fields.baseline;
  return new Map([
    ...(dirty(doc, fields.baseline) ? [[TEXT_FIELD, doc] as const] : []),
    ...[...boxes].filter(([key, box]) => box !== fields.stored.get(key)),
  ]);
};

/** What the file holds for each field, as last loaded or saved. */
export const fileDocs = (fields: BufferFields): Map<string, string> =>
  new Map([[TEXT_FIELD, fields.baseline], ...fields.stored]);

/** The draft of the buffer: the text, and every box whose document differs from the stored one, on `basis`. */
export const draftOf = (
  fields: BufferFields,
  text: { readonly doc: string; readonly base: string },
  boxes: ReadonlyMap<string, string>,
  basis: string | undefined,
): Draft | undefined => makeDraft(text, boxDrafts(fields.stored, boxes), basis);

/** What a choice or relation box holds now: its input, else the stored document. */
export const valueDoc = (fields: BufferFields, key: string): string =>
  fields.values.get(key) ?? fields.stored.get(key) ?? "";

/** The first answer: the stored documents are the file's, and the empty document for every added box. */
export const firstLoad = (fields: BufferFields, docs: ReadonlyMap<string, string>): BufferFields => ({
  ...fields,
  stored: new Map([...docs, ...fields.added.map((key): [string, string] => [key, ""])]),
});

/** What a reload leaves: the next fields, and what the draft takes. */
export interface Reloaded {
  /** `values` is always a new map; `added` a new array only when the number of added boxes changed. */
  readonly fields: BufferFields;
  /** The box documents the draft takes: a box without input follows the file once the editors did. */
  readonly followed: Map<string, string>;
  /** Whether `added` is new. */
  readonly addedChanged: boolean;
  /** The text the draft takes: the file's when the text has no input, else what the editor holds (undefined). */
  readonly draftText: string | undefined;
}

/**
 * The file was read again while the buffer is shown (SR-106): `loaded` and `docs` are the file's text and
 * fields, `input` the fields with input and `boxes` what the boxes hold, both from before. A box that was
 * added stays while the file has no value for it, and so does a box with input (the title too, as any input
 * key, unlike `restored`, which keeps only known properties as added); a choice or relation value with input
 * stays, one without or with what the file now holds follows it.
 */
export const reloaded = (
  fields: BufferFields,
  loaded: string,
  docs: ReadonlyMap<string, string>,
  input: ReadonlyMap<string, string>,
  boxes: ReadonlyMap<string, string>,
): Reloaded => {
  const open = [
    ...fields.added,
    ...[...input.keys()].filter((key) => key !== TEXT_FIELD && !fields.added.includes(key)),
  ].filter((key) => !docs.has(key));
  const stored = new Map([...docs, ...open.map((key): [string, string] => [key, ""])]);
  const followed = new Map(
    [...boxes].map(([key, doc]) => [key, doc === fields.stored.get(key) ? (stored.get(key) ?? doc) : doc]),
  );
  const values = new Map(
    [...fields.values].filter(([key, doc]) => doc !== fields.stored.get(key) && doc !== stored.get(key)),
  );
  // Only a change of the number replaces the added boxes (as it always did).
  const addedChanged = open.length !== fields.added.length;
  return {
    fields: { baseline: loaded, stored, added: addedChanged ? open : fields.added, values },
    followed,
    addedChanged,
    draftText: input.has(TEXT_FIELD) ? undefined : loaded,
  };
};

/** What a draft shown again leaves. */
export interface Restored {
  /** The kept boxes for the editors made for them: a new map, which the editors take their input from. */
  readonly keptBoxes: Map<string, BoxDraft>;
  /** The kept text, when it was typed on and the file does not hold it now. */
  readonly keptText: string | undefined;
  /** Title input comes back: the title's editor opens (#621). */
  readonly titleOpens: boolean;
  /** The bytes the input is on: the draft's on a conflict, the file's otherwise. */
  readonly basis: string | undefined;
  readonly change: OutsideChange;
  /** The draft on the file as it is now. */
  readonly draft: Draft | undefined;
  /** Whether `draft` differs from the kept one (the app keeps the new one then). */
  readonly changed: boolean;
  /** The added boxes of the draft: known properties the file has no value for. A new array always. */
  readonly added: readonly string[];
  /** The choice and relation documents of the draft. */
  readonly values: ReadonlyMap<string, string>;
}

/**
 * The first answer for a buffer that comes back with a draft (`kept`): the draft is compared with the file
 * (`element`, its fields `docs`, its bytes `sha`) as a reload compares the input (SR-106).
 */
export const restored = (
  kept: Draft,
  element: DataExportElement,
  docs: ReadonlyMap<string, string>,
  sha: string,
  properties: PropertyModel,
): Restored => {
  const loaded = element.text ?? "";
  const change = outsideChange(draftInput(kept), kept.sha, {
    sha,
    docs: new Map([[TEXT_FIELD, loaded], ...docs]),
  });
  const keptText = kept.text !== kept.base && !change.dropped.includes(TEXT_FIELD) ? kept.text : undefined;
  const boxes = keptBoxesOf(kept, change.dropped, docs);
  const basis = change.kind === "conflict" ? kept.sha : sha;
  const draft = makeDraft({ doc: keptText ?? loaded, base: loaded }, boxes, basis);
  // The boxes of the draft that were added come back (their base is the empty document), and the documents
  // of the choices and relations set in the minibuffer with them. The title is no property key.
  const known = boxes.flatMap(([key, box]) => {
    const info = properties.get(element.type)?.get(key);
    return info === undefined ? [] : [{ key, box, info }];
  });
  return {
    keptBoxes: new Map(boxes),
    keptText,
    titleOpens: boxes.some(([key]) => key === TITLE_FIELD),
    basis,
    change,
    draft,
    changed: !sameDraft(draft, kept),
    added: known.filter(({ key, box }) => box.base === "" && !docs.has(key)).map(({ key }) => key),
    values: new Map(
      known.flatMap(({ key, box, info }): [string, string][] =>
        isValueKind(info.kind) ? [[key, box.doc]] : [],
      ),
    ),
  };
};

/** What the editors of the sent boxes do after a save, in the order of the sent boxes (the title first). */
export interface BoxStep {
  readonly key: string;
  /** The file's document, when the editor still holds what was sent and the file holds another form. */
  readonly replace?: string;
  /** The file's document, which the editor compares with from now on. */
  readonly rebase?: string;
}

/** What a save leaves. */
export interface Settled {
  /** The baseline, the stored documents and the added boxes, assigned before the editors are replaced. */
  readonly fields: Omit<BufferFields, "values">;
  /** The values, assigned only after the editors were replaced (they read the old ones meanwhile). New always. */
  readonly values: ReadonlyMap<string, string>;
  /** What the text editor shows now, when core saved the text otherwise than it was sent (`afterSave`). */
  readonly textReplace: string | undefined;
  readonly boxes: readonly BoxStep[];
}

/** The ones of the added boxes and the sent boxes that stay added after a save. */
const stillAdded = (
  added: readonly string[],
  docs: ReadonlyMap<string, string>,
  sent: SentFields,
  holds: (key: string) => string,
): string[] => [
  // An added box is a stored box now, or was left empty and is dropped; one typed in while the save ran stays.
  ...added.filter((key) => !docs.has(key) && (!sent.added.includes(key) || holds(key) !== "")),
  // A box the save emptied (its property left the file) that was typed in meanwhile stays (#348).
  ...sent.edits
    .filter(
      (edit) =>
        !docs.has(edit.key) &&
        !added.includes(edit.key) &&
        holds(edit.key) !== "" &&
        holds(edit.key) !== edit.doc,
    )
    .map((edit) => edit.key),
];

/**
 * After a save: the answer (`saved`: its text and field documents) is what the fields hold against, and what
 * was typed while the save ran stays. `now` is what the editors hold at the answer: the text editor's document
 * and each box editor's (undefined: no editor). A box that still holds what was sent shows what the file holds.
 */
export const settledFields = (
  fields: BufferFields,
  saved: { readonly text: string; readonly docs: ReadonlyMap<string, string> },
  sent: SentFields,
  now: { readonly textDoc: string; readonly boxDoc: (key: string) => string | undefined },
): Settled => {
  const after = afterSave(sent.doc, saved.text, now.textDoc);
  const { docs } = saved;
  const holds = (key: string): string => now.boxDoc(key) ?? fields.values.get(key) ?? "";
  const added = stillAdded(fields.added, docs, sent, holds);
  return {
    fields: {
      baseline: after.baseline,
      stored: new Map([...docs, ...added.map((key): [string, string] => [key, ""])]),
      added,
    },
    // A choice or relation box that still holds what was sent shows what the file holds now.
    values: new Map(
      [...fields.values].filter(
        ([key, doc]) => !sent.edits.some((edit) => edit.key === key && edit.doc === doc),
      ),
    ),
    textReplace: after.replace,
    boxes: sent.edits.map((edit): BoxStep => {
      const file = docs.get(edit.key);
      if (file === undefined) {
        return { key: edit.key };
      }
      return {
        key: edit.key,
        ...(now.boxDoc(edit.key) === edit.doc && file !== edit.doc ? { replace: file } : {}),
        rebase: file,
      };
    }),
  };
};

/** "Add property" (SR-104 AK2): the key is added, its stored document is the empty one. */
export const propertyAdded = (fields: BufferFields, key: string): BufferFields => ({
  ...fields,
  added: [...fields.added, key],
  stored: new Map(fields.stored).set(key, ""),
});

/** The document of a choice or relation box is set (SR-104 AK3, AK4). */
export const valueSet = (fields: BufferFields, key: string, doc: string): BufferFields => ({
  ...fields,
  values: new Map(fields.values).set(key, doc),
});
