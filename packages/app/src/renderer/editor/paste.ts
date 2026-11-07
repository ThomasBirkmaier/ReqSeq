// Pasting and dropping as Markdown (SR-190, D-073, D-074). The handler decides, in this order:
//
// 1. Image files (AK3): pasted (a screenshot, a copied file) or dropped, each is given to the app as its
//    bytes, which `element.addAttachment` copies next to the element file as "Insert image" does
//    (SR-097); the Markdown it returns goes where the paste or the drop was, mapped through the edits
//    made meanwhile. Files come first only when there is no HTML or the HTML is just one image, because
//    spreadsheets put a picture of a copied table next to its HTML. A drop with other files inserts
//    nothing and says why (CodeMirror would insert their text).
// 2. An address over a selection (AK2): plain text that is one absolute address makes each selected
//    range a Markdown link to it.
// 3. Formatted text (AK1): the HTML of the clipboard, read as an inert document (`DOMParser`: no script
//    runs, nothing loads), becomes our XHTML node tree, and core writes it as Markdown with GitHub
//    extensions (`@reqseq/core/pasted-markdown`, ADR-0002: no conversion logic here). Styled code (a code
//    editor's copy) and HTML without formatting paste as plain text.
// 4. Else CodeMirror pastes the plain text.
//
// Inside code and formulas nothing of this applies: the plain text is pasted. A read-only editor takes
// nothing. Each paste is one undo step.
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { XHTML_NAMESPACE, pastedMarkdown } from "@reqseq/core/pasted-markdown";
import type { XhtmlNode } from "@reqseq/core/pasted-markdown";
import type { SyntaxNode } from "@lezer/common";
import type { EditorPlugins } from "./plugins.js";

/** An image given as bytes, for `element.addAttachment`. */
export interface PastedImage {
  /** Base64 of the bytes. */
  readonly content: string;
  /** The file name, with an extension core takes. */
  readonly name: string;
}

export interface PasteHost {
  /** Copies the image next to the element file: the Markdown that embeds it, or why not (said already). */
  readonly attach: (image: PastedImage) => Promise<string | undefined>;
  /** Says something in the minibuffer. */
  readonly echo: (message: string) => void;
}

/** The extension of an image type core takes (`IMAGE_EXTENSIONS` of core). */
const TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
};

/** Nodes of code and formulas: there a paste is plain text. */
const CODE_NODES: ReadonlySet<string> = new Set([
  "InlineCode",
  "FencedCode",
  "CodeBlock",
  "CodeText",
  "InlineMath",
  "BlockMath",
]);

/** One absolute address: what a selection becomes a link to. */
const ADDRESS = /^(?:https?:\/\/|mailto:|reqseq:)\S+$/i;

/** Whether `pos` lies in code or a formula. */
export const inCode = (state: EditorState, pos: number): boolean => {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node !== null;
    node = node.parent
  ) {
    if (CODE_NODES.has(node.name)) {
      return true;
    }
  }
  return false;
};

/** The name of an image file: its own when it has an extension core takes, else one from its type. */
export const imageName = (file: { readonly name: string; readonly type: string }): string | undefined => {
  const extension = TYPE_EXTENSIONS[file.type.toLowerCase()];
  if (extension === undefined) {
    return undefined;
  }
  const own = file.name.trim();
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(own)
    ? own
    : `${own === "" ? "image" : own}${extension}`;
};

/** Base64 of `bytes`, in chunks (one `String.fromCharCode` call over a large image overflows the stack). */
export const base64Of = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/** A Markdown link destination: in `<…>` when it holds a space or parentheses. */
const destination = (address: string): string => (/[\s()]/.test(address) ? `<${address}>` : address);

/** The DOM nodes as our XHTML tree: elements and text only; deeper than `depth` only their text. */
export const xhtmlOf = (nodes: Iterable<Node>, depth = 0): XhtmlNode[] => {
  const out: XhtmlNode[] = [];
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent ?? "");
    } else if (node instanceof Element) {
      out.push(
        depth >= 250
          ? node.textContent
          : {
              name: node.localName,
              namespace: node.namespaceURI ?? XHTML_NAMESPACE,
              attributes: [...node.attributes].flatMap((attribute) => [attribute.name, attribute.value]),
              children: xhtmlOf(node.childNodes, depth + 1),
            },
      );
    }
  }
  return out;
};

/** The Markdown of the clipboard's HTML, or undefined to paste its plain text (`pastedMarkdown`). */
export const markdownOfHtml = (html: string): ReturnType<typeof pastedMarkdown> => {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return pastedMarkdown(xhtmlOf(body.childNodes));
};

/** Whether the HTML is nothing but one image, which a file on the clipboard stands for. */
const onlyImage = (html: string): boolean => {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return body.querySelectorAll("img").length === 1 && body.textContent.trim() === "";
};

/** Where pasted images go, by id: the range they replace, mapped through the edits made meanwhile. */
interface Place {
  readonly from: number;
  readonly to: number;
}
const addPlace = StateEffect.define<{ readonly id: number; readonly place: Place }>();
const removePlace = StateEffect.define<number>();
export const imagePlaces = StateField.define<ReadonlyMap<number, Place>>({
  create: () => new Map(),
  update: (value, transaction) => {
    let next = value;
    if (transaction.docChanged && next.size > 0) {
      next = new Map(
        [...next].map(([id, { from, to }]) => {
          const start = transaction.changes.mapPos(from, 1);
          return [id, { from: start, to: Math.max(start, transaction.changes.mapPos(to, -1)) }];
        }),
      );
    }
    for (const effect of transaction.effects) {
      if (effect.is(addPlace)) {
        next = new Map([...next, [effect.value.id, effect.value.place]]);
      } else if (effect.is(removePlace)) {
        next = new Map([...next].filter(([id]) => id !== effect.value));
      }
    }
    return next;
  },
});

let nextPlace = 0;

/** The largest image the app copies: core's cap of `content` (20 MiB, `MAX_CONTENT_BYTES`). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Copies the image files one after the other, in their order, and writes their Markdown, one per line,
 * in place of `place` once all answered: one transaction, one undo step.
 */
const attachAll = (view: EditorView, files: readonly File[], place: Place, host: PasteHost): void => {
  const id = (nextPlace += 1);
  view.dispatch({ effects: addPlace.of({ id, place }) });
  const copied: string[] = [];
  const copy = async (): Promise<void> => {
    for (const file of files) {
      const name = imageName(file) ?? file.name;
      if (file.size > MAX_IMAGE_BYTES) {
        host.echo(`${name} is larger than 20 MiB and was not copied`);
        continue;
      }
      try {
        const markdown = await host.attach({
          content: base64Of(new Uint8Array(await file.arrayBuffer())),
          name,
        });
        if (markdown !== undefined) {
          copied.push(markdown);
        }
      } catch (error) {
        host.echo(`${name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  void copy().then(() => {
    insertAt(view, id, copied, host);
  });
};

/** Writes the Markdown of the copies in place of the range `id` waits at, and forgets it. */
const insertAt = (view: EditorView, id: number, copied: readonly string[], host: PasteHost): void => {
  const place = view.state.field(imagePlaces, false)?.get(id);
  if (place === undefined || !view.dom.isConnected) {
    if (copied.length > 0) {
      host.echo(`The text was left before the image was copied; insert it yourself: ${copied.join(" ")}`);
    }
    return;
  }
  const insert = copied.join("\n");
  view.dispatch({
    ...(copied.length === 0
      ? {}
      : {
          changes: { from: place.from, to: place.to, insert },
          selection: { anchor: place.from + insert.length },
          userEvent: "input.paste",
          annotations: isolateHistory.of("full"),
        }),
    effects: removePlace.of(id),
  });
};

/** A selected text as the label of a link: brackets escaped, so the link stays one. */
const label = (text: string): string => text.replace(/(?<!\\)([[\]])/g, "\\$1");

/** Block Markdown (a heading, a list, a table, more than one line) gets blank lines around it mid-line. */
const BLOCK = /^(?:#{1,6} |[-*+] |\d+[.)] |> |```|\||---)|\n/;

/** `markdown` for the selection of `state`: on lines of its own when it is block content. */
const placed = (state: EditorState, markdown: string): string => {
  if (!BLOCK.test(markdown)) {
    return markdown;
  }
  const { from, to } = state.selection.main;
  const before = state.sliceDoc(state.doc.lineAt(from).from, from).trim() === "" ? "" : "\n\n";
  const after = state.sliceDoc(to, state.doc.lineAt(to).to).trim() === "" ? "" : "\n\n";
  return `${before}${markdown}${after}`;
};

const isImage = (file: File): boolean => imageName(file) !== undefined;

/** The handler for one paste: true when it took the paste. */
export const handlePaste = (view: EditorView, data: DataTransfer, host: PasteHost): boolean => {
  const { state } = view;
  if (state.readOnly || inCode(state, state.selection.main.head)) {
    return false;
  }
  const html = data.getData("text/html");
  const files = [...data.files].filter(isImage);
  if (files.length > 0 && (html === "" || onlyImage(html))) {
    attachAll(view, files, state.selection.main, host);
    return true;
  }
  const text = data.getData("text/plain").trim();
  const selected = state.selection.ranges.filter((range) => !range.empty);
  if (
    ADDRESS.test(text) &&
    selected.length > 0 &&
    // A link label is one paragraph.
    selected.every((range) => !/\n\s*\n/.test(state.sliceDoc(range.from, range.to)))
  ) {
    view.dispatch(
      state.changeByRange((range) => {
        const insert = range.empty
          ? text
          : `[${label(state.sliceDoc(range.from, range.to))}](${destination(text)})`;
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        };
      }),
      { userEvent: "input.paste", scrollIntoView: true },
    );
    return true;
  }
  if (html === "" || data.types.includes("vscode-editor-data")) {
    return false;
  }
  const converted = markdownOfHtml(html);
  if (converted === undefined) {
    return false;
  }
  view.dispatch(state.replaceSelection(placed(state, converted.markdown)), {
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  if (converted.droppedImages > 0) {
    host.echo(
      `${String(converted.droppedImages)} pasted ${converted.droppedImages === 1 ? "image was" : "images were"} left out: only images on the network or from files are taken`,
    );
  }
  return true;
};

/** The handler for one drop: true when it took the drop (files); text is dropped by CodeMirror. */
export const handleDrop = (view: EditorView, event: DragEvent, host: PasteHost): boolean => {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0) {
    return false;
  }
  event.preventDefault();
  if (view.state.readOnly) {
    return true;
  }
  if (!files.every(isImage)) {
    host.echo("Only image files can be dropped into the text");
    return true;
  }
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
  if (inCode(view.state, pos)) {
    host.echo("Images cannot be dropped into code");
    return true;
  }
  attachAll(view, files, { from: pos, to: pos }, host);
  return true;
};

/** Pasting and dropping as Markdown as editor plugins (`mergePlugins`). */
export const pasteAsMarkdown = (host: () => PasteHost): EditorPlugins => {
  const handlers: Extension = EditorView.domEventHandlers({
    paste: (event, view) => {
      const data = event.clipboardData;
      if (data !== null && handlePaste(view, data, host())) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    drop: (event, view) => handleDrop(view, event, host()),
  });
  return { extensions: [imagePlaces, handlers] };
};
