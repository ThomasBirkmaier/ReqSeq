// Find and replace in the text of the open element (SR-189). The search is the typed text itself, no
// pattern; it ignores case while it is all lower case, as Emacs does (smart case). The editor marks every hit
// and the current one apart, also while the minibuffer has the focus (`findMarks`); the prompts of
// `find-actions.ts` drive it with the commands below. Each replace is one transaction kept apart in the undo
// history, so one undo takes it back (AK4).
import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

export interface Hit {
  readonly from: number;
  readonly to: number;
}

/** Whether `query` ignores case: it has no upper-case letter. */
const ignoresCase = (query: string): boolean => query === query.toLowerCase();

/** Every place of `query` in `doc`, in order and not overlapping. */
export const hitsOf = (doc: string, query: string): readonly Hit[] => {
  if (query === "") {
    return [];
  }
  const fold = ignoresCase(query);
  const haystack = fold ? doc.toLowerCase() : doc;
  const needle = fold ? query.toLowerCase() : query;
  // Lower case can change the length of a text (İ); then the places of the folded text are not those of the
  // document, and the search compares case by case.
  const same = haystack.length === doc.length;
  const hits: Hit[] = [];
  if (same) {
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      hits.push({ from: at, to: at + needle.length });
    }
    return hits;
  }
  for (let at = 0; at + query.length <= doc.length;) {
    if (doc.slice(at, at + query.length).toLowerCase() === needle) {
      hits.push({ from: at, to: at + query.length });
      at += query.length;
    } else {
      at += 1;
    }
  }
  return hits;
};

/** What the editor marks: the search and its current hit; no search marks nothing. */
interface Search {
  readonly query: string;
  readonly hits: readonly Hit[];
  /** The index of the current hit in `hits`; -1: none. */
  readonly current: number;
}

const NONE: Search = { query: "", hits: [], current: -1 };

const setSearch = StateEffect.define<Search>();

const searchField = StateField.define<Search>({
  create: () => NONE,
  update: (search, tr) => {
    const set = tr.effects.find((effect) => effect.is(setSearch));
    if (set !== undefined) {
      return set.value;
    }
    if (!tr.docChanged || search.query === "") {
      return search;
    }
    // Typed while searching (an undo, a change on disk): the hits of the new text, the current one kept by place.
    const hits = hitsOf(tr.state.doc.toString(), search.query);
    const was = search.hits[search.current];
    const at = was === undefined ? -1 : tr.changes.mapPos(was.from);
    return { query: search.query, hits, current: hits.findIndex((hit) => hit.from >= at) };
  },
});

const HIT = Decoration.mark({ class: "cm-lr-find" });
const CURRENT = Decoration.mark({ class: "cm-lr-find cm-lr-find-current" });

const marksOf = (search: Search): DecorationSet =>
  Decoration.set(
    search.hits.map((hit, index) => (index === search.current ? CURRENT : HIT).range(hit.from, hit.to)),
  );

/** The marks of the hits; in the text editor of the element. */
export const findMarks: Extension = [
  searchField,
  EditorView.decorations.compute([searchField], (state) => marksOf(state.field(searchField))),
];

/** The search of `state` (for the status line and the tests); none in an editor without `findMarks`. */
export const searchOf = (state: EditorState): Search => state.field(searchField, false) ?? NONE;

/** The index of the first hit at or after `pos`, wrapping to the first; -1 without hits. */
const firstFrom = (hits: readonly Hit[], pos: number): number => {
  const after = hits.findIndex((hit) => hit.from >= pos);
  return after === -1 ? (hits.length > 0 ? 0 : -1) : after;
};

/** Shows `search`, its current hit selected and scrolled to. */
const show = (view: EditorView, search: Search): void => {
  const hit = search.hits[search.current];
  view.dispatch({
    effects: [
      setSearch.of(search),
      ...(hit === undefined ? [] : [EditorView.scrollIntoView(hit.from, { y: "center" })]),
    ],
    ...(hit === undefined ? {} : { selection: EditorSelection.range(hit.from, hit.to) }),
  });
};

/**
 * Searches `query` from `origin` (where the caret was when the search began): every hit is marked and the
 * first one at or after `origin` is the current one (AK1). An empty query marks nothing and puts the caret
 * back at `origin`.
 */
export const searchFor = (view: EditorView, query: string, origin: number): number => {
  const hits = hitsOf(view.state.doc.toString(), query);
  const search = { query, hits, current: firstFrom(hits, origin) };
  show(view, search);
  if (search.current === -1) {
    view.dispatch({ selection: EditorSelection.cursor(Math.min(origin, view.state.doc.length)) });
  }
  return hits.length;
};

/** The current hit moves to the next one (`back`: the one before), wrapping at the ends (AK1); false without hits. */
export const stepHit = (view: EditorView, back: boolean): boolean => {
  const search = searchOf(view.state);
  const { length } = search.hits;
  if (length === 0) {
    return false;
  }
  const current = search.current === -1 ? 0 : (search.current + (back ? length - 1 : 1)) % length;
  show(view, { ...search, current });
  return true;
};

/** Ends the search: the marks go, and the caret stays at the start of the hit jumped to last (AK1). */
export const endSearch = (view: EditorView): void => {
  const hit = searchOf(view.state).hits[searchOf(view.state).current];
  view.dispatch({
    effects: setSearch.of(NONE),
    ...(hit === undefined ? {} : { selection: EditorSelection.cursor(hit.from) }),
  });
};

/** Where the search stands, for the status line: "2 of 5", or "no match". */
export const searchStatus = (state: EditorState): string => {
  const { hits, current } = searchOf(state);
  return hits.length === 0 ? "no match" : `${String(current + 1)} of ${String(hits.length)}`;
};

const step = (
  view: EditorView,
  changes: { from: number; to: number; insert: string }[],
  selection?: number,
): void => {
  view.dispatch({
    changes,
    ...(selection === undefined ? {} : { selection: EditorSelection.cursor(selection) }),
    userEvent: "input.replace",
    annotations: isolateHistory.of("full"),
  });
};

/**
 * Replaces the current hit by `replacement` and makes the next one current (AK2). False when there is no hit
 * or the editor is read-only.
 */
export const replaceHit = (view: EditorView, replacement: string): boolean => {
  const search = searchOf(view.state);
  const hit = search.hits[search.current];
  if (hit === undefined || view.state.readOnly) {
    return false;
  }
  step(view, [{ from: hit.from, to: hit.to, insert: replacement }]);
  // The field found the hits of the new text; the next one is the first after the replacement.
  const next = searchOf(view.state);
  show(view, {
    ...next,
    current: next.hits.length === 0 ? -1 : firstFrom(next.hits, hit.from + replacement.length),
  });
  return true;
};

/** Replaces every hit of `query` by `replacement` in one step (AK3, AK4) and says how many; 0 in a read-only editor. */
export const replaceAll = (view: EditorView, query: string, replacement: string): number => {
  const hits = hitsOf(view.state.doc.toString(), query);
  if (hits.length === 0 || view.state.readOnly) {
    return 0;
  }
  const last = hits[hits.length - 1];
  const shift = hits.length * replacement.length - hits.reduce((sum, hit) => sum + hit.to - hit.from, 0);
  step(
    view,
    hits.map((hit) => ({ from: hit.from, to: hit.to, insert: replacement })),
    last === undefined ? undefined : last.to + shift,
  );
  view.dispatch({ effects: setSearch.of(NONE) });
  return hits.length;
};
