// The Markdown language of the editor: CommonMark with the GitHub extensions (tables, strikethrough, task
// lists, autolinks), as D-061 and SR-065 AK2 require. Its keymap continues a list on Enter and removes
// list and quote markup with Backspace, on the tree of the whole text (`parsed.ts`). Code blocks get no
// language data (`codeLanguages: []`): nothing is loaded at runtime, the editor is offline.
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
  markdownLanguage,
} from "@codemirror/lang-markdown";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { parsedFirst } from "./parsed.js";
import type { EditorPlugins } from "./plugins.js";

/**
 * The keymap of `markdown({ addKeymap: true })` (`markdownKeymap` of @codemirror/lang-markdown 6.5.2: these two
 * keys under `Prec.high`), with the parse finished before each command reads the tree. A unit test pins it.
 */
const markdownKeys = Prec.high(
  keymap.of([
    { key: "Enter", run: parsedFirst(insertNewlineContinueMarkup) },
    { key: "Backspace", run: parsedFirst(deleteMarkupBackward) },
  ]),
);

export const markdownSupport = (plugins: EditorPlugins): Extension => [
  markdown({
    base: markdownLanguage,
    codeLanguages: [],
    addKeymap: false,
    ...(plugins.markdown === undefined ? {} : { extensions: [...plugins.markdown] }),
  }),
  markdownKeys,
];
