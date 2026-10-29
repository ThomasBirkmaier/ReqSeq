// The `[[` search of the editor (SR-066): two `[` typed one after the other ask the app for an element in the
// prompt "Insert reference", the same prompt and search as the slash menu's "Reference to element" (ADR-0010,
// `element.search` over title and IDs). The pick replaces the `[[` with `[title](reqseq:<uuid>)`
// (`reference-pick.ts`); Escape leaves the `[[` as typed. `[[` is only the typing trigger: the file holds
// the Markdown link (ADR-0004 rejects wiki links in files). Only typed brackets ask: not pasted, not brought
// back by undo, not composed by an input method, not escaped (`\[[`), not after `!` (an image), not a third
// one (`[[[`), not in the query of an open slash menu, and not in code, a link, an address or HTML
// (`inMarkup`, the rule of the slash menu).
import { EditorState } from "@codemirror/state";
import type { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorPlugins } from "./plugins.js";
import { askReference, pendingField, setPending } from "./reference-pick.js";
import type { PickOptions } from "./reference-pick.js";
import { inMarkup } from "./slash-entries.js";
import { inSlashQuery } from "./slash-menu.js";

/** The start of a `[[` that `transaction` typed, if it did: it typed the second `[`, and only that. */
export const typedBrackets = (transaction: Transaction): number | undefined => {
  if (!transaction.isUserEvent("input.type") || transaction.isUserEvent("input.type.compose")) {
    return undefined;
  }
  const changes: { readonly at: number; readonly text: string }[] = [];
  transaction.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    changes.push({ at: fromB, text: inserted.toString() });
  });
  const [only] = changes;
  if (changes.length !== 1 || only?.text !== "[") {
    return undefined;
  }
  const doc = transaction.newDoc;
  const start = only.at - 1;
  if (start < 0 || doc.sliceString(start, only.at) !== "[") {
    return undefined;
  }
  const before = start === 0 ? "" : doc.sliceString(start - 1, start);
  // The first `[` stands where it stood before the transaction: the markup around it, and a `/` query it
  // belongs to, are read there.
  const { startState } = transaction;
  return ["[", "\\", "!"].includes(before) ||
    inMarkup(startState, start) ||
    inSlashQuery(startState, start + 1)
    ? undefined
    : start;
};

/** The `[[` search as an editor plugin. */
export const referenceSearch = (options: PickOptions): EditorPlugins => ({
  extensions: [
    pendingField,
    // The `[[` waits in the same transaction that typed it, so nothing saves it before the question is open.
    EditorState.transactionExtender.of((transaction) => {
      const start = typedBrackets(transaction);
      return start === undefined || transaction.startState.field(pendingField) !== null
        ? null
        : { effects: setPending.of({ from: start, to: start + 2, held: "brackets" }) };
    }),
    // The app is asked for an update that typed `[[`, never for an editor that is made or configured again
    // with a `[[` waiting (it keeps the waiting `[[` and must not ask again), and after the update, never from
    // inside it.
    EditorView.updateListener.of((update) => {
      const typed = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setPending) && effect.value?.held === "brackets"),
      );
      if (typed) {
        queueMicrotask(() => {
          askReference(update.view, options);
        });
      }
    }),
  ],
});
