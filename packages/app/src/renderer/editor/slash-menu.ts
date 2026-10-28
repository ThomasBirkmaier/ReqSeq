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
import { applyEntry, entriesFor, opensMenu, referenceMarkdown, slashRange } from "./slash-entries.js";
import type { ReferenceTarget, SlashEntry, SlashRange } from "./slash-entries.js";

export type { ReferenceTarget } from "./slash-entries.js";

/** What the editor hands to the app when "Reference to element" is taken. */
export interface ReferenceRequest {
  /** An element was picked: its reference replaces the `/` and its query, and the editor gets the focus. */
  readonly insert: (target: ReferenceTarget) => void;
  /** The question was cancelled: the editor gets the focus, the `/` and its query stay as typed. */
  readonly cancel: () => void;
}

export interface SlashMenuOptions {
  /** Asks the app for an element ("Insert reference" prompt). */
  readonly pickElement: (request: ReferenceRequest) => void;
  /** The repository of the element being edited (D-058: the label of a reference to another one is its short ID). */
  readonly repository: () => string;
}

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

interface Pending {
  readonly from: number;
  readonly to: number;
}

const setPending = StateEffect.define<Pending | null>();

/** The `/` and its query while the app asks for an element (R1): mapped through changes. */
const pendingField = StateField.define<Pending | null>({
  create: () => null,
  update: (value, transaction) => {
    let next = value;
    if (next !== null && transaction.docChanged) {
      const from = transaction.changes.mapPos(next.from, 1);
      next = { from, to: Math.max(from, transaction.changes.mapPos(next.to, -1)) };
    }
    for (const effect of transaction.effects) {
      if (effect.is(setPending)) {
        next = effect.value;
      }
    }
    return next;
  },
});

/**
 * Whether "Reference to element" waits for the element the app asks for: the `/` and its query are still
 * in the text, so autosave waits (SR-105, `autosave.ts`). False for a state without the slash menu.
 */
export const awaitingReference = (state: EditorState): boolean =>
  (state.field(pendingField, false) ?? null) !== null;

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

/** Writes the reference in place of the `/` and its query, or at the caret when they are gone. */
const insertReference = (view: EditorView, target: ReferenceTarget, repository: string): void => {
  // The buffer may have been left while the question was open: the editor is gone then.
  if (!view.dom.isConnected) {
    return;
  }
  const range = view.state.field(pendingField);
  const held = range !== null && slashRange(view.state, range.from, range.to) !== undefined;
  const { from, to } = held ? range : view.state.selection.main;
  const insert = referenceMarkdown(target, repository);
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    effects: setPending.of(null),
    userEvent: "input.complete",
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
  view.focus();
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
      view.dispatch({ effects: [setPending.of({ from, to }), dismissEffect.of(null)] });
      closeCompletion(view);
      options.pickElement({
        insert: (target) => {
          insertReference(view, target, options.repository());
        },
        cancel: () => {
          view.dispatch({ effects: setPending.of(null) });
          view.focus();
        },
      });
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
      // Closes the menu only: the `/` and the query stay, and the editor keeps the focus (AK3).
      key: "Escape",
      run: (view) => {
        if (completionStatus(view.state) === null) {
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
