// The Markdown language of the editor: CommonMark with the GitHub extensions (tables, strikethrough, task
// lists, autolinks), as D-061 and SR-065 AK2 require. `addKeymap` continues a list on Enter and removes
// list and quote markup with Backspace. Code blocks get no language data (`codeLanguages: []`): nothing is
// loaded at runtime, the editor is offline.
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import type { EditorPlugins } from "./plugins.js";

export const markdownSupport = (plugins: EditorPlugins): Extension =>
  markdown({
    base: markdownLanguage,
    codeLanguages: [],
    addKeymap: true,
    ...(plugins.markdown === undefined ? {} : { extensions: [...plugins.markdown] }),
  });
