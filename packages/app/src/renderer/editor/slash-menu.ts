// The slash menu of the editor (SR-129): a `/` typed where a word may begin opens a menu at the cursor
// with the Markdown elements; letters narrow it as in the command line (`fuzzy.ts`), Ctrl+N / Ctrl+P and the
// arrow keys choose (SR-122), Enter takes the entry, Escape closes it and leaves the `/` as typed. The menu
// edits the text only (ADR-0002); `@codemirror/autocomplete` supplies the list at the caret, the listbox
// roles and the mouse. The decisions of the review of the plan (R1 to R5) are marked where they apply.
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionStatus,
  moveCompletionSelection,
} from "@codemirror/autocomplete";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { EditorState, MapMode, Prec, StateEffect, StateField } from "@codemirror/state";
import type { Extension, Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { rank } from "../fuzzy.js";
import { nth } from "../lists.js";
import type { EditorPlugins } from "./plugins.js";
import { askReference, pendingField, setPending } from "./reference-pick.js";
import type { PickOptions } from "./reference-pick.js";
import { applyEntry, entriesFor, opensMenu, slashRange } from "./slash-entries.js";
import type { SlashEntry, SlashRange } from "./slash-entries.js";

export type { ReferenceTarget } from "./slash-entries.js";

export type { ReferenceRequest } from "./reference-pick.js";
export { awaitingReference } from "./reference-pick.js";

/** "Reference to element" asks the app for an element (`reference-pick.ts`). */
export type SlashMenuOptions = PickOptions;

/** The `/` that was typed (R3): where it stands, and whether Escape closed its menu. */
interface Armed {
  readonly pos: number;
  readonly dismissed: boolean;
}

const dismissEffect = StateEffect.define();

/** The position of a single `/` that a transaction typed, if it did. Pasting and undoing arm nothing. */
const typedSlash = (transaction: Transaction): number | undefined => {
  if (!transaction.isUserEvent("input.type")) {
    return undefined;
  }
  const changes: { readonly at: number; readonly text: string }[] = [];
  transaction.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    changes.push({ at: fromB, text: inserted.toString() });
  });
  const [only] = changes;
  return changes.length === 1 && only?.text === "/" ? only.at : undefined;
};

/**
 * The typed `/` that the menu belongs to. Autocomplete would open on any later typing; the menu opens only
 * for a `/` that was typed (R3), so a pasted `/x` or a `/query` that undo brought back opens nothing. The
 * place is mapped through changes and dropped when the `/` is gone.
 */
const armedField = StateField.define<Armed | null>({
  create: () => null,
  update: (value, transaction) => {
    let next: Armed | null = null;
    if (value !== null) {
      const pos = transaction.changes.mapPos(value.pos, 1, MapMode.TrackDel);
      if (pos !== null && transaction.newDoc.sliceString(pos, pos + 1) === "/") {
        next = {
          pos,
          dismissed: value.dismissed || transaction.effects.some((effect) => effect.is(dismissEffect)),
        };
      }
    }
    const typed = typedSlash(transaction);
    return typed === undefined ? next : { pos: typed, dismissed: false };
  },
});

/** The range of the menu in `state` with the caret at `head`: there is one `/` that was typed and is not dismissed. */
const rangeOf = (state: EditorState, head: number): SlashRange | undefined => {
  const armed = state.field(armedField);
  return armed === null || armed.dismissed || !opensMenu(state, armed.pos)
    ? undefined
    : slashRange(state, armed.pos, head);
};

/** Takes the entry for the `/` and its query: one transaction and one undo step, even when typing follows at once (R5). */
const take = (
  view: EditorView,
  entry: Exclude<SlashEntry, { readonly kind: "reference" }>,
  from: number,
  to: number,
): void => {
  view.dispatch({
    ...applyEntry(view.state, from, to, entry),
    effects: dismissEffect.of(null),
    userEvent: "input.complete",
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
};

const flat = (ranges: readonly (readonly [number, number])[]): number[] =>
  ranges.flatMap(([from, to]) => [from, to]);

/** The slash menu as an editor plugin. */
export const slashMenu = (options: SlashMenuOptions): EditorPlugins => {
  /** The entries of the menu for the caret at `head`, ranked by the query, with the range they replace. */
  const rankedAt = (state: EditorState, head: number) => {
    const range = rangeOf(state, head);
    const ranked =
      range === undefined ? [] : rank(entriesFor(range.inTable), (entry) => entry.name, range.query);
    return range === undefined || ranked.length === 0 ? undefined : { range, ranked };
  };

  /** Takes an entry for the `/` and its query in `from` to `to`. */
  const takeEntry = (view: EditorView, item: SlashEntry, from: number, to: number): void => {
    if (item.kind === "reference") {
      // The text stays as typed until an element is picked.
      view.dispatch({ effects: [setPending.of({ from, to, held: "slash" }), dismissEffect.of(null)] });
      closeCompletion(view);
      askReference(view, options);
    } else {
      take(view, item, from, to);
    }
  };

  const resultAt = (state: EditorState, head: number): CompletionResult | null => {
    const found = rankedAt(state, head);
    if (found === undefined) {
      return null;
    }
    const { range, ranked } = found;
    const completions = ranked.map(({ item }): Completion => ({
      label: item.name,
      ...(item.detail === "" ? {} : { detail: item.detail }),
      apply: (view, _completion, from, to) => {
        takeEntry(view, item, from, to);
      },
    }));
    const matches = ranked.map(({ ranges }) => flat(ranges));
    // No `validFor`: every change recomputes the entries synchronously (R2), so a fast "/h2" and Enter
    // finds the ranked entries of the query typed so far.
    return {
      from: range.from,
      to: range.to,
      options: completions,
      filter: false,
      getMatch: (completion) => nth(matches, completions.indexOf(completion)),
      update: (_current, _from, _to, context) => resultAt(context.state, context.pos),
    };
  };

  /**
   * Enter takes the chosen entry. The menu of @codemirror/autocomplete opens through a timer and a promise
   * even without a delay, so an Enter typed right after the `/` finds it still "pending": the entry is
   * then the first one of the ranking for what is typed so far, worked out here at once, instead of a
   * new line (the Enter would fall through to the editor otherwise).
   */
  const enter = (view: EditorView): boolean => {
    if (acceptCompletion(view)) {
      return true;
    }
    const found =
      completionStatus(view.state) === "pending"
        ? rankedAt(view.state, view.state.selection.main.head)
        : undefined;
    const first = found?.ranked[0];
    if (found === undefined || first === undefined) {
      return false;
    }
    takeEntry(view, first.item, found.range.from, found.range.to);
    return true;
  };

  const keys = keymap.of([
    { key: "ArrowDown", run: moveCompletionSelection(true) },
    { key: "Tab", run: moveCompletionSelection(true) },
    { key: "Ctrl-n", run: moveCompletionSelection(true) },
    { key: "ArrowUp", run: moveCompletionSelection(false) },
    { key: "Ctrl-p", run: moveCompletionSelection(false) },
    { key: "Enter", run: enter },
    {
      // Closes the menu only: the `/` and the query stay, and the editor keeps the focus (AK3). Only the
      // menu of a typed `/`: any typing asks the source (`activateOnTyping`), so the completion is
      // "pending" for a moment after every letter, also with no `/` in sight. An Escape then is the
      // editor's own and leaves the text (#574: right after typing, under load, it was swallowed here).
      key: "Escape",
      run: (view) => {
        if (
          completionStatus(view.state) === null ||
          rangeOf(view.state, view.state.selection.main.head) === undefined
        ) {
          return false;
        }
        view.dispatch({ effects: dismissEffect.of(null) });
        closeCompletion(view);
        return true;
      },
    },
  ]);

  const extensions: Extension[] = [
    armedField,
    pendingField,
    autocompletion({
      override: [(context: CompletionContext) => resultAt(context.state, context.pos)],
      defaultKeymap: false,
      icons: false,
      closeOnBlur: true,
      activateOnTyping: true,
      // The user typed the `/` on purpose: no delay before the menu answers, and no guard against an Enter (R2).
      activateOnTypingDelay: 0,
      interactionDelay: 0,
      tooltipClass: () => "cm-lr-slash",
    }),
    Prec.highest(keys),
    EditorState.phrases.of({ Completions: "Insert menu" }),
  ];
  return { extensions };
};
