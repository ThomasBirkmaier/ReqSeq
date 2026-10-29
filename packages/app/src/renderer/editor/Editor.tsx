// The Markdown editor of the element buffer (SR-065, D-061): CodeMirror 6 with a live preview. The
// document is the Markdown source as it is; the preview only decorates it (`preview.ts`). The editor
// knows nothing of commands: the element buffer reads the document through `onChange` and the handle,
// and saves it (ADR-0002).
import { completionStatus } from "@codemirror/autocomplete";
import { history, historyField, historyKeymap, redo, standardKeymap } from "@codemirror/commands";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { releaseCaretSide } from "./caret-side.js";
import { minimalChange } from "./diff.js";
import { markdownSupport } from "./markdown.js";
import { parseAhead } from "./parsed.js";
import type { EditorPlugins, PreviewRule } from "./plugins.js";
import { BUILT_IN_RULES, livePreview } from "./preview.js";
import { insertHeld } from "./reference-pick.js";

export interface EditorHandle {
  /**
   * Gives the editor the focus, the cursor at the start or the end of the text, or at an offset (kept within
   * the text), when asked.
   */
  readonly focus: (at?: "start" | "end" | number) => void;
  /** The editor has the focus (the caret is in it). */
  readonly hasFocus: () => boolean;
  readonly doc: () => string;
  /** The state of the editor, for the cursor (the element buffer asks what it is on). */
  readonly state: () => EditorState;
  /** Replaces the document without an undo step (the text of the file after a save). */
  readonly replace: (text: string) => void;
  /**
   * Replaces the document as an edit of the user, which Ctrl/Cmd+Z undoes ("Clear property", "Take the
   * file"). Its user event is `input.set`: input, but not typed or pasted.
   */
  readonly set: (text: string) => void;
  /**
   * Input is still going on: an input method composes, or a completion list (the slash menu) is open,
   * whose query is in the document. Autosave waits for it (SR-105).
   */
  readonly busy: () => boolean;
  /**
   * The file holds `text` now (a save answered): the document follows the next `text` only when it is
   * still `text`. Input typed while the save ran, an undo back to the text before it included, stays
   * (SR-105 AK2).
   */
  readonly rebase: (text: string) => void;
  /**
   * Writes `text` at the caret (in place of a selection) as one undo step, and gives the editor the focus
   * (the action "Insert image", SR-097).
   */
  readonly insert: (text: string) => void;
}

export interface EditorProps {
  /** The text as loaded or saved; a change of it replaces the document unless there is unsaved input. */
  readonly text: string;
  readonly readOnly: boolean;
  /** A draft to show instead of `text` when the editor is created. */
  readonly initial?: string;
  /**
   * The document changed; `typed` when the change is input (typing, an edit, undo or redo), not the text
   * of the file put in without an undo step (`replace`).
   */
  readonly onChange: (doc: string, typed: boolean) => void;
  readonly onEscape: () => void;
  /** Any update of the editor (a key, a selection, the end of a composition): a hold may have ended. */
  readonly onUpdate?: () => void;
  /**
   * The state of the editor with its undo history, as the editor goes (`EditorState.toJSON`): an editor
   * made again with it as `restore` keeps undo and redo (SR-105 AK2).
   */
  readonly onClose?: (state: unknown) => void;
  /** A state an editor of this field had (`onClose`): the new one starts from it, on the document it shows. */
  readonly restore?: unknown;
  readonly plugins?: EditorPlugins;
  /** The built-in preview rules; all of them by default. A Markdown property box has the inline ones only (SR-127). */
  readonly rules?: readonly PreviewRule[];
  /** The accessible name of the text; the element's text is "Text", a property box has its key. */
  readonly label?: string;
  readonly handle?: (handle: EditorHandle | undefined) => void;
}

const NO_PLUGINS: EditorPlugins = {};

/** What a state keeps in its JSON besides the document and the selection: the undo history. */
const HISTORY = { history: historyField };

/**
 * The state of a new editor with `doc`: from a state an editor of the field had (`restore`), so undo and
 * redo go on, else a fresh one. A document that differs from the restored one is put in without an undo
 * step, as `replace` does, so the history maps over it. A state that cannot be read starts fresh.
 */
const startState = (doc: string, extensions: Extension, restore: unknown): EditorState => {
  if (restore !== undefined) {
    try {
      const restored = EditorState.fromJSON(restore, { extensions }, HISTORY);
      const change = minimalChange(restored.doc.toString(), doc);
      return restored.update({ changes: change, annotations: Transaction.addToHistory.of(false) }).state;
    } catch {
      // Not a state of this editor: a fresh one.
    }
  }
  return EditorState.create({ doc, extensions });
};

/** Whether an update holds input: a change that is not `replace` (which adds no undo step). */
const typedIn = (transactions: readonly Transaction[]): boolean =>
  transactions.some((tr) => tr.docChanged && tr.annotation(Transaction.addToHistory) !== false);

const configuration = (
  readOnly: boolean,
  plugins: EditorPlugins,
  rules: readonly PreviewRule[],
): Extension => [
  markdownSupport(plugins),
  livePreview([...rules, ...(plugins.rules ?? [])]),
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
  ...(plugins.extensions ?? []),
];

// Colour only for meaning: greys of the sheet (D-062). The classes are those of `preview.ts`.
const theme = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6", overflow: "visible" },
  ".cm-content": { padding: "0", caretColor: "var(--text)" },
  ".cm-line": { padding: "0" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--select)",
  },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-lr-h1": { fontSize: "1.5rem", fontWeight: "700", lineHeight: "1.3", paddingTop: "0.5rem" },
  ".cm-lr-h2": { fontSize: "1.25rem", fontWeight: "700", lineHeight: "1.3", paddingTop: "0.4rem" },
  ".cm-lr-h3": { fontSize: "1.1rem", fontWeight: "700", paddingTop: "0.3rem" },
  ".cm-lr-h4, .cm-lr-h5, .cm-lr-h6": { fontWeight: "700" },
  ".cm-lr-em": { fontStyle: "italic" },
  ".cm-lr-strong": { fontWeight: "700" },
  ".cm-lr-strike": { textDecoration: "line-through" },
  ".cm-lr-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.92em",
    backgroundColor: "var(--select)",
  },
  ".cm-lr-link": { textDecoration: "underline", textDecorationColor: "var(--muted)" },
  ".cm-lr-ref": { cursor: "pointer" },
  // The one accent colour, for "outdated" only (D-062).
  ".cm-lr-outdated": { color: "var(--accent-outdated)", textDecorationColor: "var(--accent-outdated)" },
  ".cm-lr-outdated-word": { color: "var(--accent-outdated)" },
  ".cm-lr-muted": { color: "var(--muted)" },
  ".cm-lr-bullet, .cm-lr-task": { display: "inline-block", width: "1.1em", color: "var(--muted)" },
  ".cm-lr-quote": { borderLeft: "3px solid var(--rule)", paddingLeft: "0.75rem", color: "var(--muted)" },
  ".cm-lr-codeblock": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.92em",
    backgroundColor: "var(--select)",
    padding: "0 0.5rem",
  },
  ".cm-lr-fence-hidden": { fontSize: "0.4em", lineHeight: "1", minHeight: "0.4em" },
  ".cm-lr-hr": { borderBottom: "1px solid var(--rule)", lineHeight: "0.8" },
  ".cm-lr-table-source": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.92em",
  },
  ".cm-lr-table": { borderCollapse: "collapse", margin: "0.5rem 0" },
  ".cm-lr-table th, .cm-lr-table td": { border: "1px solid var(--rule)", padding: "0.2rem 0.6rem" },
  ".cm-lr-table th": { fontWeight: "700", textAlign: "left" },
  // Formulas (SR-096, `formula-preview.ts`): KaTeX draws in the text colour; an error is grey (D-062).
  ".cm-lr-formula-block": { padding: "0.25rem 0", overflowX: "auto", overflowY: "hidden" },
  ".cm-lr-formula-block .katex-display": { margin: "0.25rem 0" },
  // Below a source in its last line (a code line, maybe a thin fence line): the size and the sheet of the text.
  ".cm-line .cm-lr-formula-block": {
    fontSize: "1rem",
    lineHeight: "1.6",
    margin: "0 -0.5rem",
    padding: "0.25rem 0.5rem",
    backgroundColor: "var(--sheet)",
  },
  // Diagrams (SR-096, `diagram.ts`): an image of the drawing, at most as wide as the text, centred.
  ".cm-lr-diagram-block": { padding: "0.5rem 0", lineHeight: "0" },
  ".cm-lr-diagram": { display: "block", maxWidth: "100%", height: "auto", margin: "0 auto" },
  ".cm-line .cm-lr-diagram-block": {
    margin: "0 -0.5rem",
    padding: "0.5rem",
    backgroundColor: "var(--sheet)",
  },
  ".cm-lr-render-error": { color: "var(--muted)", fontSize: "0.85em", whiteSpace: "pre-wrap" },
  "span.cm-lr-render-error": { marginLeft: "0.5em" },
  // A block error below a source ends its last line, which may be a thin hidden fence line (0.4em): its size
  // comes from the root, so it stays readable (issue 747).
  "div.cm-lr-render-error": { fontSize: "0.85rem", lineHeight: "1.5" },
  ".cm-lr-render-error-label": { fontWeight: "700" },
  ".cm-tooltip.cm-lr-formula-tooltip": {
    backgroundColor: "var(--sheet)",
    color: "var(--text)",
    border: "1px solid var(--rule)",
    boxShadow: "0 4px 12px var(--shadow)",
    padding: "0.25rem 0.5rem",
    pointerEvents: "none",
  },
  // The slash menu (SR-129, `slash-menu.ts`): the tooltip of @codemirror/autocomplete with the look of the
  // candidates of the minibuffer. The base theme of the library has colour literals (a light grey box, a
  // blue selection) that would stay in the dark scheme, so every rule that sets one is overridden here by
  // tokens, with selectors as specific as its own (the theme wins at equal specificity).
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--sheet)",
    color: "var(--text)",
    border: "1px solid var(--rule)",
    boxShadow: "0 4px 12px var(--shadow)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "inherit", fontSize: "13px", maxHeight: "20em" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.1rem 0.75rem",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--select)", color: "var(--text)" },
  ".cm-tooltip.cm-tooltip-autocomplete-disabled ul li[aria-selected]": {
    backgroundColor: "var(--select)",
    color: "var(--muted)",
  },
  ".cm-tooltip .cm-tooltip-section:not(:first-child)": {
    borderTop: "1px solid var(--rule)",
  },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-completionDetail": { marginLeft: "0", fontStyle: "normal", fontSize: "12px", color: "var(--muted)" },
});

/** Replaces the document by `text` with the smallest change (the cursor stays), without an undo step. */
const replaceDocument = (editor: EditorView, text: string): void => {
  const change = minimalChange(editor.state.doc.toString(), text);
  editor.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) });
};

export const Editor = ({
  text,
  readOnly,
  initial,
  onChange,
  onEscape,
  onUpdate,
  onClose,
  restore,
  plugins = NO_PLUGINS,
  rules = BUILT_IN_RULES,
  label = "Text",
  handle,
}: EditorProps): React.JSX.Element => {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | undefined>(undefined);
  const config = useRef(new Compartment());
  const applied = useRef({ readOnly, plugins });
  const lastText = useRef(text);
  // The callbacks of the latest render, so the editor is created once.
  const latest = useRef({ onChange, onEscape, onUpdate, onClose, handle });
  latest.current = { onChange, onEscape, onUpdate, onClose, handle };

  // A layout effect: the editor and its handle are there in the same task as the render that shows the
  // element, and so are the controls the buffer registers with them, before any key can come.
  useLayoutEffect(() => {
    if (host === null) {
      return undefined;
    }
    const editor = new EditorView({
      parent: host,
      state: startState(
        initial ?? text,
        [
          history(),
          keymap.of([
            {
              key: "Escape",
              run: () => {
                latest.current.onEscape();
                return true;
              },
            },
            // Ctrl/Cmd+Shift+Z redoes on every system, as on the choice and relation boxes (`historyStep`,
            // SR-105 AK2); CodeMirror binds it only on Linux and macOS, and Ctrl+Y outside macOS.
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            ...historyKeymap,
            ...standardKeymap,
          ]),
          EditorView.lineWrapping,
          releaseCaretSide,
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latest.current.onChange(update.state.doc.toString(), typedIn(update.transactions));
            }
            latest.current.onUpdate?.();
          }),
          theme,
          config.current.of(configuration(readOnly, plugins, rules)),
        ],
        restore,
      ),
    });
    // An ordinary text is shown formatted from the first paint, so its height does not change later (`parsed.ts`).
    parseAhead(editor);
    setView(editor);
    latest.current.handle?.({
      focus: (at) => {
        // The caret first: moving it while the editor has the focus asks the browser for a selection change.
        if (at !== undefined) {
          const { length } = editor.state.doc;
          const anchor = at === "end" ? length : at === "start" ? 0 : Math.min(Math.max(at, 0), length);
          editor.dispatch({ selection: { anchor } });
        }
        editor.focus();
      },
      hasFocus: () => editor.hasFocus,
      doc: () => editor.state.doc.toString(),
      state: () => editor.state,
      replace: (next) => {
        replaceDocument(editor, next);
      },
      set: (next) => {
        editor.dispatch({
          changes: minimalChange(editor.state.doc.toString(), next),
          userEvent: "input.set",
        });
      },
      busy: () => editor.composing || completionStatus(editor.state) === "active",
      rebase: (next) => {
        lastText.current = next;
      },
      insert: (text) => {
        insertHeld(editor, text);
      },
    });
    return () => {
      latest.current.onClose?.(editor.state.toJSON(HISTORY));
      latest.current.handle?.(undefined);
      editor.destroy();
    };
    // The editor is created once for its element; the props reach it through the effects below.
  }, [host]);

  useEffect(() => {
    if (
      view !== undefined &&
      (applied.current.readOnly !== readOnly || applied.current.plugins !== plugins)
    ) {
      applied.current = { readOnly, plugins };
      view.dispatch({ effects: config.current.reconfigure(configuration(readOnly, plugins, rules)) });
    }
  }, [view, readOnly, plugins]);

  // The text changed from outside (the file changed, or it was saved): the document follows when there
  // is no unsaved input, that is when it still is the text it was loaded as.
  useEffect(() => {
    if (view !== undefined) {
      if (view.state.doc.toString() === lastText.current) {
        replaceDocument(view, text);
      }
    }
    lastText.current = text;
  }, [view, text]);

  return <div className="editor" ref={setHost} />;
};
