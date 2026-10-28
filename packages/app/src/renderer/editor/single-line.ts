// The title is one line of plain text (#621, SR-127 "Titel und Kennungen bleiben reiner Text"): no key puts a
// line break in it (Enter leaves the title), and a line break the user brings in by typing, pasting or
// dropping text (any `input` event) becomes one space, as in a one-line input field. The file's text put
// in (no user event), undo and redo, and an edit the app puts in (`input.set`: "Take the file") stay as they
// are, so a title the file stores is never changed by the editor alone.
import { ChangeSet, EditorState, Transaction } from "@codemirror/state";
import type { ChangeSpec, Extension, Text, TransactionSpec } from "@codemirror/state";

/** Lines as one line: joined by one space, without the empty lines (line breaks at the ends, runs of them). */
export const oneLine = (lines: readonly string[]): string => lines.filter((line) => line !== "").join(" ");

/** The transaction with every inserted text of more than one line made one line, or the transaction itself. */
const flattened = (tr: Transaction, userEvent: string): Transaction | TransactionSpec => {
  const inserts: { readonly from: number; readonly to: number; readonly insert: Text }[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, insert) => {
    inserts.push({ from, to, insert });
  });
  if (!inserts.some(({ insert }) => insert.lines > 1)) {
    return tr;
  }
  const changes: ChangeSpec[] = inserts.map(({ from, to, insert }) => ({
    from,
    to,
    insert: insert.lines > 1 ? oneLine(insert.toJSON()) : insert,
  }));
  const set = ChangeSet.of(changes, tr.startState.doc.length);
  return {
    changes: set,
    selection: tr.startState.selection.map(set, 1),
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    userEvent,
  };
};

/** The transaction filter of the title editor. */
export const singleLine: Extension = EditorState.transactionFilter.of((tr) => {
  const userEvent = tr.annotation(Transaction.userEvent);
  return userEvent === undefined || !tr.isUserEvent("input") || tr.isUserEvent("input.set")
    ? tr
    : flattened(tr, userEvent);
});
