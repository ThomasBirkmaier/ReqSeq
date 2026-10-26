// SR-065 AK2: a file written in the editor is valid CommonMark with GitHub extensions. The text is built
// as typing builds it (input transactions on the editor state, with the Markdown extensions of the editor,
// including the list continuation on Enter), saved through the public `invoke` of core exactly as the app
// saves it, and read back from the file. micromark with the GitHub extensions is the independent
// reference parser (a dev dependency; the editor's own parser is not used to check itself).
import fs from "node:fs/promises";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { Workspace, invoke } from "@logreq/core";
import { createFixtureWorkspace } from "@logreq/testkit";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import { BUILT_IN_RULES, focusState, previewDecorations } from "./preview.js";

const ELEMENT = "69069069-0000-4000-8000-0000000000ed";
/** An element of the fixture workspace that the text refers to. */
const TARGET = "69069069-0000-4000-8000-0000000000a1";
const FILE = "needs/N-0000000000ed.md";
const FRONT_MATTER = `---\nid: ${ELEMENT}\ntype: need\nstatus: draft\ntitle: Written in the editor\n---\n\n`;

/** Types `text` into the state as the keyboard does: one input transaction per insert at the cursor. */
const typeInto = (state: EditorState, text: string, chunk: number): EditorState => {
  let current = state;
  for (let at = 0; at < text.length; at += chunk) {
    const insert = text.slice(at, at + chunk);
    const head = current.selection.main.head;
    current = current.update({
      changes: { from: head, insert },
      selection: { anchor: head + insert.length },
      userEvent: "input.type",
    }).state;
  }
  return current;
};

const enter = (state: EditorState): EditorState => {
  let current = state;
  const handled = insertNewlineContinueMarkup({
    state,
    dispatch: (transaction) => {
      current = state.update(transaction).state;
    },
  });
  expect(handled).toBe(true);
  return current;
};

/** The text of an element as the editor produces it. */
const write = (): { readonly state: EditorState; readonly doc: string } => {
  let state = EditorState.create({ extensions: [markdownSupport({}), focusState] });
  state = typeInto(state, "# Heading one\n\n## Heading two\n\n", 40);
  state = typeInto(
    state,
    "Plain *em*, **strong**, ~~strike~~ and `code`, a [link](https://example.org/a) ",
    1,
  );
  state = typeInto(state, `and a reference [SR-001](logreq:${TARGET}).\n\n`, 7);
  // A list: the second item comes from Enter, which continues the list.
  state = typeInto(state, "- bullet a", 1);
  state = enter(state);
  state = typeInto(state, "bullet b\n\n1. one\n2. two\n\n- [ ] open task\n- [x] done task\n\n", 9);
  state = typeInto(state, "| Name | Value | Mid |\n| :--- | ---: | :---: |\n| a | **1** | `x` |\n\n", 11);
  state = typeInto(state, "```ts\nconst answer = 42;\n```\n\n> a quote\n", 13);
  return { state, doc: state.doc.toString() };
};

describe("SR-065 AK2, the file of a text written in the editor", () => {
  it("[SR-065/AK2] a text written in the editor is saved as it is and parses as CommonMark with GitHub extensions", async () => {
    const { state, doc } = write();
    // The continuation of the list on Enter is part of the text.
    expect(doc).toContain("- bullet a\n- bullet b\n");

    const fixture = await createFixtureWorkspace({
      fixture: "SR-069/filter",
      files: { [FILE]: `${FRONT_MATTER}Old text.\n` },
    });
    const workspace = new Workspace(fixture.root);
    try {
      await invoke("element.update", { ref: ELEMENT, text: doc }, { workspace });

      const file = await fs.readFile(fixture.path(FILE), "utf8");
      // (1) The front matter is untouched. (2) The body is the text, with the final line break.
      expect(file.startsWith(FRONT_MATTER)).toBe(true);
      const body = file.slice(FRONT_MATTER.length);
      // Core adds the version of the target to an inline reference (ADR-0004); nothing else changes.
      const reference = new RegExp(`\\[SR-001\\]\\(logreq:${TARGET}\\?version=(n1:[0-9a-f]+)\\)`);
      const version = reference.exec(body)?.[1];
      expect(version).toBeDefined();
      expect(body).toBe(
        `${doc.replace(`(logreq:${TARGET})`, `(logreq:${TARGET}?version=${String(version)})`)}${doc.endsWith("\n") ? "" : "\n"}`,
      );

      // (3) CommonMark with GitHub extensions, by an independent reference parser.
      const html = micromark(body, {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
        allowDangerousProtocol: true,
      });
      expect(html).toContain("<h1>Heading one</h1>");
      expect(html).toContain("<h2>Heading two</h2>");
      expect(html).toContain("<em>em</em>");
      expect(html).toContain("<strong>strong</strong>");
      expect(html).toContain("<del>strike</del>");
      expect(html).toContain("<code>code</code>");
      expect(html).toContain('<a href="https://example.org/a">link</a>');
      expect(html).toContain(`<a href="logreq:${TARGET}?version=${String(version)}">SR-001</a>`);
      expect(html).toMatch(/<ul>\s*<li>bullet a<\/li>\s*<li>bullet b<\/li>\s*<\/ul>/);
      expect(html).toMatch(/<ol>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ol>/);
      expect(html).toContain('<input type="checkbox" disabled="" /> open task');
      expect(html).toMatch(
        /<input type="checkbox" (?:disabled="" checked=""|checked="" disabled="") \/> done task/,
      );
      expect(html).toContain("<table>");
      expect(html).toMatch(
        /<th align="left">Name<\/th>\s*<th align="right">Value<\/th>\s*<th align="center">Mid<\/th>/,
      );
      expect(html).toMatch(
        /<td align="right"><strong>1<\/strong><\/td>\s*<td align="center"><code>x<\/code><\/td>/,
      );
      expect(html).toContain('<pre><code class="language-ts">const answer = 42;\n</code></pre>');
      expect(html).toMatch(/<blockquote>\s*<p>a quote<\/p>\s*<\/blockquote>/);

      // (4) Another access reads the same text: what the editor gets back is what it saved.
      const read = (await invoke("element.get", { ref: ELEMENT }, { workspace })) as {
        readonly element: { readonly text: string };
      };
      expect(read.element.text).toBe(body);
    } finally {
      await workspace.close();
    }

    // The preview only decorates: computing it did not change the document.
    previewDecorations(state, BUILT_IN_RULES, true);
    expect(state.doc.toString()).toBe(doc);
  });
});
