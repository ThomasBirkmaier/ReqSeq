// "Find in element", "Replace" and "Replace all" (SR-189): prompts of the command prompt that drive the search of
// `editor/find.ts` on the text of the shown element. While a prompt is open the text keeps its marks and the
// command prompt keeps the focus; the text gets it back when the prompt ends. Editor-only, no catalog command, like
// the slash menu (ADR-0010).
import type { Command } from "@codemirror/view";
import type { Action, ActionContext } from "./actions.js";
import { endSearch, replaceAll, replaceHit, searchFor, searchStatus, stepHit } from "./editor/find.js";

/** Whether the shown buffer is an element whose text takes commands (as `hasText` of `text-actions.ts`). */
const hasText = (context: ActionContext): boolean =>
  context.buffers[0]?.kind === "element" && context.element?.text !== undefined;

/** The search typed last, which "Replace" and "Replace all" start with. */
let lastQuery = "";

/** Said when the text takes no command; only a read-only text refuses, and the lock note comes first. */
const NO_TEXT = "The text cannot be searched here";

/**
 * Runs `command` on the text; the focus stays in the command prompt unless `focus`. `read`: it only marks and moves
 * the caret, so it runs in a read-only element too (find, AK1); a replace refuses there.
 */
const onText = (context: ActionContext, command: Command, focus = false, read = true): void => {
  context.element?.text?.(command, NO_TEXT, { focus, inText: true, read });
};

/** Says `text` in the modeline (AK3: the status line), else in the minibuffer. */
const status = (context: ActionContext, text: string): void => {
  if (context.notify === undefined) {
    context.echo(text);
  } else {
    context.notify(text);
  }
};

/**
 * Searches `query` from where the caret stood when the search began (`origin`, read once), and says how far
 * it got ("2 of 5", "no match").
 */
const searcher = (context: ActionContext) => {
  let origin: number | undefined;
  /** Searches `query`; the number of hits (0 also when the text took no command). */
  return (query: string): number => {
    lastQuery = query;
    let hits = 0;
    onText(context, (view) => {
      origin ??= view.state.selection.main.from;
      hits = searchFor(view, query, origin);
      if (query !== "") {
        status(context, searchStatus(view.state));
      }
      return true;
    });
    return hits;
  };
};

/** Ends the search: the marks go, the caret stays at the hit jumped to last, and the text has the focus (AK1). */
const finish = (context: ActionContext): void => {
  onText(
    context,
    (view) => {
      endSearch(view);
      return true;
    },
    true,
  );
};

/** "Find in element" (AK1): typing marks the hits, Enter and Shift+Enter step through them, Escape ends it. */
export const findAction: Action = {
  id: "find-in-element",
  title: "Find in element",
  description: "Mark the hits of a search in the text of the shown element and step through them.",
  // Cmd on macOS (SR-145); the physical Ctrl+F there stays the editor's Emacs key.
  shortcut: { mod: true, shift: false, key: "f" },
  inPrompt: true,
  available: hasText,
  run: (context) => {
    const search = searcher(context);
    context.ask({
      label: "Find in element",
      items: [],
      typing: search,
      step: (_query, back) => {
        onText(context, (view) => {
          if (stepHit(view, back)) {
            status(context, searchStatus(view.state));
          }
          return true;
        });
      },
      cancel: () => {
        finish(context);
      },
    });
  },
};

/** The first prompt of both: the search, starting with the last one. Enter on an empty one ends. */
const askQuery = (context: ActionContext, label: string, next: (query: string) => void): void => {
  context.ask({
    label,
    items: [],
    initial: lastQuery,
    text: (query) => {
      if (query === "") {
        return;
      }
      lastQuery = query;
      next(query);
    },
  });
};

/** `“text”` for a label, the search or the replacement as typed. */
const quoted = (text: string): string => `“${text}”`;

/**
 * "Replace" (AK2): asks for the search, marks its hits, then asks for the replacement; each Enter replaces the
 * current hit and goes to the next, Shift+Enter goes to the next without replacing, Escape ends.
 */
export const replaceAction: Action = {
  id: "replace-in-element",
  title: "Replace",
  description: "Change the hits of a search in the text into a new text, one by one.",
  available: hasText,
  run: (context) => {
    askQuery(context, "Replace", (query) => {
      // No hit: nothing to replace, so no second prompt.
      if (searcher(context)(query) === 0) {
        status(context, `No hit of ${quoted(query)}`);
        finish(context);
        return;
      }
      context.ask({
        label: `Replace ${quoted(query)} with`,
        items: [],
        step: (replacement, skip) => {
          onText(
            context,
            (view) => {
              if (skip ? stepHit(view, false) : replaceHit(view, replacement)) {
                status(context, searchStatus(view.state));
              } else {
                status(context, `No more hits of ${quoted(query)}`);
              }
              return true;
            },
            false,
            false,
          );
        },
        cancel: () => {
          finish(context);
        },
      });
    });
  },
};

/** "Replace all" (AK3): asks for the search and the replacement, replaces every hit in one step and says how many. */
export const replaceAllAction: Action = {
  id: "replace-all-in-element",
  title: "Replace all",
  description: "Change every hit of a search in the text into a new text at once.",
  available: hasText,
  run: (context) => {
    askQuery(context, "Replace all", (query) => {
      context.ask({
        label: `Replace all ${quoted(query)} with`,
        items: [],
        text: (replacement) => {
          onText(
            context,
            (view) => {
              const count = replaceAll(view, query, replacement);
              status(
                context,
                count === 0
                  ? `No hit of ${quoted(query)}`
                  : `Replaced ${String(count)} ${count === 1 ? "hit" : "hits"}`,
              );
              return true;
            },
            true,
            false,
          );
        },
      });
    });
  },
};

/** The actions of find and replace, for `TEXT_ACTIONS`. */
export const FIND_ACTIONS: readonly Action[] = [findAction, replaceAction, replaceAllAction];
