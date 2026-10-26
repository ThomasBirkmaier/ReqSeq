// The Markdown editor of the element buffer (SR-065, D-061): CodeMirror 6 with a live preview. The
// document is the Markdown source as it is; the preview only decorates it (`preview.ts`). The editor
// knows nothing of commands: the element buffer reads the document through `onChange` and the handle,
// and saves it (ADR-0002).
import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { minimalChange } from "./diff.js";
import { markdownSupport } from "./markdown.js";
import type { EditorPlugins } from "./plugins.js";
import { BUILT_IN_RULES, livePreview } from "./preview.js";

export interface EditorHandle {
  /** Gives the editor the focus, the cursor at the end of the text when asked. */
  readonly focus: (at?: "end") => void;
  readonly doc: () => string;
  /** The state of the editor, for the cursor (the element buffer asks what it is on). */
  readonly state: () => EditorState;
  /** Replaces the document without an undo step (the text of the file after a save). */
  readonly replace: (text: string) => void;
}

export interface EditorProps {
  /** The text as loaded or saved; a change of it replaces the document unless there is unsaved input. */
  readonly text: string;
  readonly readOnly: boolean;
  /** A draft to show instead of `text` when the editor is created. */
  readonly initial?: string;
  readonly onChange: (doc: string) => void;
  readonly onEscape: () => void;
  readonly plugins?: EditorPlugins;
  readonly handle?: (handle: EditorHandle | undefined) => void;
}

const NO_PLUGINS: EditorPlugins = {};

const configuration = (readOnly: boolean, plugins: EditorPlugins): Extension => [
  markdownSupport(plugins),
  livePreview([...BUILT_IN_RULES, ...(plugins.rules ?? [])]),
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
  plugins = NO_PLUGINS,
  handle,
}: EditorProps): React.JSX.Element => {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | undefined>(undefined);
  const config = useRef(new Compartment());
  const applied = useRef({ readOnly, plugins });
  const lastText = useRef(text);
  // The callbacks of the latest render, so the editor is created once.
  const latest = useRef({ onChange, onEscape, handle });
  latest.current = { onChange, onEscape, handle };

  useEffect(() => {
    if (host === null) {
      return undefined;
    }
    const editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial ?? text,
        extensions: [
          history(),
          keymap.of([
            {
              key: "Escape",
              run: () => {
                latest.current.onEscape();
                return true;
              },
            },
            ...historyKeymap,
            ...standardKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Text", spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latest.current.onChange(update.state.doc.toString());
            }
          }),
          theme,
          config.current.of(configuration(readOnly, plugins)),
        ],
      }),
    });
    setView(editor);
    latest.current.handle?.({
      focus: (at) => {
        editor.focus();
        if (at === "end") {
          editor.dispatch({ selection: { anchor: editor.state.doc.length } });
        }
      },
      doc: () => editor.state.doc.toString(),
      state: () => editor.state,
      replace: (next) => {
        replaceDocument(editor, next);
      },
    });
    return () => {
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
      view.dispatch({ effects: config.current.reconfigure(configuration(readOnly, plugins)) });
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
