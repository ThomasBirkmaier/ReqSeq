// The criterion keys of the lines of the acceptance criteria box (SR-204 AK7, AK8, AK9). A state field holds
// the key of each line; every edit carries them by the rules of core (`carryLineKeys`,
// `@reqseq/core/criterion-lines`), so the renderer decides nothing itself (ADR-0002): a reworded, split,
// merged or moved line keeps its key, a new, pasted or dropped one gets a new key, drawn here with Web
// Crypto. The undo history keeps the lines and keys before each edit (`invertedEffects`), so undo and redo
// bring the keys back with the text, also after the edit was saved. A change put in without an undo step
// (the file changed outside) is not in those lines: undo then carries the kept keys to the text it gives
// by the same rules, as one edit of the kept lines. (Positions kept in the history would not hold:
// CodeMirror maps the effects of an undo step in the document after the step, not before it.) The box
// hands its document to the buffer with the keys (`criterion-doc.ts`), and takes a document with keys from
// it (`DocCodec` of `Editor`).
import { invertedEffects } from "@codemirror/commands";
import { EditorState, MapMode, StateEffect, StateField } from "@codemirror/state";
import type { StateEffectType, Text, Transaction } from "@codemirror/state";
import type { KeyedLines, LineChange, RandomInt } from "@reqseq/core/criterion-lines";
import { carryLineKeys, drawCriterionKey, isBlankLine } from "@reqseq/core/criterion-lines";
import { criterionLines, keyedDoc } from "../criterion-doc.js";
import { minimalChange } from "./diff.js";
import type { DocCodec } from "./Editor.js";

/** A key at the start of its line. */
interface LineKey {
  readonly pos: number;
  readonly key: string;
}

/** The keys of the lines, and every key the box has held since it was made (never drawn again). */
export interface CriterionKeys {
  readonly keys: readonly (string | undefined)[];
  readonly seen: ReadonlySet<string>;
}

/** The keys of the lines after a transaction, by line start: a start that is deleted drops its key. */
export const setKeys = StateEffect.define<readonly LineKey[]>({
  map: (value, mapping) =>
    value.flatMap(({ pos, key }) => {
      const mapped = mapping.mapPos(pos, 1, MapMode.TrackDel);
      return mapped === null ? [] : [{ pos: mapped, key }];
    }),
});

/** The lines and keys before an edit, kept in the undo history: put in again by undo or redo. */
const keptKeys = StateEffect.define<KeyedLines>();

/** The value of the last effect of `type` in a transaction. */
const lastOf = <T>(tr: Transaction, type: StateEffectType<T>): T | undefined =>
  tr.effects.reduce<T | undefined>((found, effect) => (effect.is(type) ? effect.value : found), undefined);

/** The lines of a document. */
const linesOf = (doc: Text): string[] => doc.toString().split("\n");

/** The keys `keys` of the lines of `doc` at their starts. */
const entriesOf = (doc: Text, keys: readonly (string | undefined)[]): LineKey[] =>
  keys.flatMap((key, i) => (key === undefined || i >= doc.lines ? [] : [{ pos: doc.line(i + 1).from, key }]));

/** The key of each line of `doc` from `entries`: a blank line holds none, and a key only its first line. */
const keysAt = (doc: Text, entries: readonly LineKey[]): (string | undefined)[] => {
  const byStart = new Map(entries.map(({ pos, key }) => [pos, key]));
  const used = new Set<string>();
  const keys: (string | undefined)[] = [];
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    const key = byStart.get(line.from);
    const holds = key !== undefined && !isBlankLine(line.text) && !used.has(key);
    if (holds) {
      used.add(key);
    }
    keys.push(holds ? key : undefined);
  }
  return keys;
};

const withSeen = (seen: ReadonlySet<string>, keys: readonly (string | undefined)[]): ReadonlySet<string> => {
  const fresh = keys.filter((key): key is string => key !== undefined && !seen.has(key));
  return fresh.length === 0 ? seen : new Set([...seen, ...fresh]);
};

export const criterionKeysField = StateField.define<CriterionKeys>({
  create: (state) => ({ keys: keysAt(state.doc, []), seen: new Set() }),
  update: (value, tr) => {
    const last = lastOf(tr, setKeys);
    if (last === undefined && !tr.docChanged) {
      return value;
    }
    // Every edit carries a `setKeys` (the extender below); without one the keys follow their line starts.
    const entries = last ?? setKeys.of(entriesOf(tr.startState.doc, value.keys)).map(tr.changes)?.value ?? [];
    const keys = keysAt(tr.state.doc, entries);
    return { keys, seen: withSeen(value.seen, keys) };
  },
});

/** The keys of the lines of `state`. */
export const lineKeys = (state: EditorState): readonly (string | undefined)[] =>
  state.field(criterionKeysField).keys;

/** A random integer from 0 below `below`, from Web Crypto, without bias. */
export const webRandom: RandomInt = (below) => {
  const limit = Math.floor(0x1_0000_0000 / below) * below;
  const draw = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(draw);
    const value = draw[0] ?? limit;
    if (value < limit) {
      return value % below;
    }
  }
};

/**
 * Carries the keys through an edit that does not set them itself (typing, undo, redo and a document put in).
 * Undo and redo bring the kept lines and keys: as they are when the text is those lines, else carried to
 * the text as one change of them.
 */
const carry = (random: RandomInt) =>
  EditorState.transactionExtender.of((tr) => {
    const kept = lastOf(tr, keptKeys);
    if (lastOf(tr, setKeys) !== undefined || (kept === undefined && !tr.docChanged)) {
      return null;
    }
    if (kept?.lines.join("\n") === tr.newDoc.toString()) {
      return { effects: setKeys.of(entriesOf(tr.newDoc, kept.keys)) };
    }
    const before = kept ?? { lines: linesOf(tr.startState.doc), keys: lineKeys(tr.startState) };
    const changes: LineChange[] = [];
    if (kept === undefined) {
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ fromA, toA, insert: inserted.toString() });
      });
    } else {
      const { from, to, insert } = minimalChange(kept.lines.join("\n"), tr.newDoc.toString());
      changes.push({ fromA: from, toA: to, insert });
    }
    const { seen } = tr.startState.field(criterionKeysField);
    const taken = new Set([...seen, ...before.keys.filter((key) => key !== undefined)]);
    const keys = carryLineKeys(before, changes, tr.isUserEvent("move"), () => {
      const key = drawCriterionKey(taken, random);
      taken.add(key);
      return key;
    });
    return { effects: setKeys.of(entriesOf(tr.newDoc, keys)) };
  });

/**
 * The lines and keys before each edit go into the undo history, so undo and redo set them again (SR-204
 * AK9); also before a change of the keys alone ("Take the file", or undo of one, which the extender gives
 * a `setKeys`).
 */
const remembered = invertedEffects.of((tr) =>
  tr.docChanged || lastOf(tr, setKeys) !== undefined
    ? [keptKeys.of({ lines: linesOf(tr.startState.doc), keys: lineKeys(tr.startState) })]
    : [],
);

/** The text and the keys of a document with keys. */
const decoded = (doc: string): { readonly text: string; readonly keys: readonly (string | undefined)[] } => {
  const { lines, keys } = criterionLines(doc);
  return { text: lines.join("\n"), keys };
};

/** The starts of the lines of `text`. */
const startsOf = (text: string): number[] => {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
};

/**
 * The box of the acceptance criteria: its editor shows the texts, and its document (`doc()`, `onChange`)
 * holds the keys too. `random` draws new keys (Web Crypto unless a test passes another).
 */
export const criterionKeys = (random: RandomInt = webRandom): DocCodec => ({
  extension: [criterionKeysField, carry(random), remembered],
  carry: [criterionKeysField],
  decode: (doc) => {
    const { text, keys } = decoded(doc);
    const starts = startsOf(text);
    const entries = keys.flatMap((key, i) => (key === undefined ? [] : [{ pos: starts[i] ?? 0, key }]));
    return {
      text,
      effects: [setKeys.of(entries)],
      init: criterionKeysField.init((state) => {
        const lines = keysAt(state.doc, entries);
        return { keys: lines, seen: withSeen(new Set(), lines) };
      }),
    };
  },
  encode: (state) => keyedDoc(linesOf(state.doc), lineKeys(state)),
  touches: (tr) => lastOf(tr, setKeys) !== undefined,
});
