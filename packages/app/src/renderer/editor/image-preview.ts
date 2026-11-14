// Images in the live preview (SR-184, D-061, refines SR-097). Decorations only, the text is never changed.
//
// - An image whose destination is relative and stays inside the element's repository is drawn from the
//   `reqseq-file:` protocol, which the core process serves (main `protocols.ts`, core `host.ts`: images by
//   extension only, checked by name before any file-system call). The renderer only builds the URL; it
//   reads no file and opens no connection itself.
// - Off the lines that show their source, the image appears in place of its source, at most as wide as the
//   text column (AK1). On a line that shows its source, the source stays and the image follows below the
//   line (AK2).
// - A destination on the network, a `data:` address, an absolute path or one that leaves the repository is
//   never loaded: the source stays, with a note right after it in the same line that names the case, in the
//   muted colour of secondary text and in smaller type than the source (AK3). An image that does not load
//   (missing, no readable image) turns into its source with such a note (AK4). A note opens no dialog and
//   moves no cursor, so typing goes on.
//
// Which destinations count follows the version rule of core (`model/images.ts` `imageLink`, ADR-0005
// "Files"): an image the preview draws counts to the version, and one it notes as outside does not. It
// leaves out what only the disk decides (the walk's skipped names and `ignore` globs, nested
// repositories): such an image is drawn when the core process serves it. Out of the element's repository
// is outside (SR-184 AK3), also when the path reaches another repository of the workspace.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Decoration, WidgetType, EditorView as View } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import type { EditorPlugins, PreviewContext, PreviewRule } from "./plugins.js";
import { focusEffect, refreshPreview } from "./preview.js";

/** The element whose text shows the images: its repository (workspace name) and its file in it (`/`). */
export interface ImageElement {
  readonly repository: string;
  readonly file: string;
}

/** Why an image is not drawn; the note says it. */
export type ImageNote = "network" | "data" | "outside" | "unreadable";

/** What a destination is: a file of the repository (its names from the repository folder), or a note. */
export type ImageTarget =
  | { readonly kind: "file"; readonly names: readonly string[] }
  | { readonly kind: "note"; readonly note: ImageNote };

/** A Windows path with a drive (`C:`), which core takes for a scheme: never relative. */
const DRIVE = /^[A-Za-z]:/;

/** A URL with a scheme (`https:`, `file:`, `data:`, also `C:` on Windows): never relative. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** A backslash before ASCII punctuation escapes it (CommonMark). */
const ESCAPE = /\\([!-/:-@[-`{-~])/g;

const hasControl = (text: string): boolean => {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
};

const percentDecoded = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** `names` with `.` dropped and `..` taken back; undefined when a `..` goes above the first name. */
const normalized = (names: readonly string[]): string[] | undefined => {
  const out: string[] = [];
  for (const name of names) {
    if (name === "..") {
      if (out.length === 0) {
        return undefined;
      }
      out.pop();
    } else if (name !== "." && name !== "") {
      out.push(name);
    }
  }
  return out;
};

/**
 * What the destination `raw` (as written, `<…>` already unwrapped) of an image in `elementFile` (relative
 * to its repository, `/`) is. It is lexical, like core's `imageLink`: escapes removed, a query or fragment
 * dropped, percent-decoded, resolved against the element's folder. A scheme is the network (`data:` its
 * own note); a drive, an absolute path (by its text before decoding, as core has it), a control character,
 * an empty path or one that leaves the repository is outside. A backslash or a trailing `/`, which core
 * counts as a missing image, is unreadable.
 */
export const imageTarget = (elementFile: string, raw: string): ImageTarget => {
  const link = raw.trim().replace(ESCAPE, "$1");
  if (DRIVE.test(link)) {
    return { kind: "note", note: "outside" };
  }
  if (SCHEME.test(link)) {
    return { kind: "note", note: /^data:/i.test(link) ? "data" : "network" };
  }
  const path = link.replace(/[?#][\s\S]*$/, "");
  const decoded = percentDecoded(path);
  if (decoded === "" || path.startsWith("/") || hasControl(decoded)) {
    return { kind: "note", note: "outside" };
  }
  const folder = elementFile.split("/").slice(0, -1);
  const names = normalized([...folder, ...decoded.split("/")]);
  // As core's rule: not the element's own file or folder, and nothing below `.git` (D-036).
  const joined = names?.join("/").normalize("NFC");
  return names === undefined ||
    names.length === 0 ||
    joined === elementFile.normalize("NFC") ||
    joined === folder.join("/").normalize("NFC") ||
    names.some((name) => name.toLowerCase() === ".git")
    ? { kind: "note", note: "outside" }
    : decoded.includes("\\") || decoded.endsWith("/")
      ? { kind: "note", note: "unreadable" }
      : { kind: "file", names };
};

/** The `reqseq-file:` URL of a file of `repository` (core `host.ts` `FILE_HOST`). */
export const imageUrl = (repository: string, names: readonly string[]): string =>
  `reqseq-file://workspace/${[repository, ...names].map(encodeURIComponent).join("/")}`;

/** A link label as CommonMark matches it: white space collapsed, case folded. */
const labelKey = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();

/** The destinations of the link reference definitions of the document, by label (the first one counts). */
const definitions = (state: EditorState): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "LinkReference") {
        return (
          node.name === "Document" ||
          node.name === "Blockquote" ||
          node.name.endsWith("List") ||
          node.name === "ListItem"
        );
      }
      const label = node.node.getChild("LinkLabel");
      const url = node.node.getChild("URL");
      if (label !== null && url !== null) {
        const key = labelKey(state.sliceDoc(label.from + 1, label.to - 1));
        if (!found.has(key)) {
          found.set(key, state.sliceDoc(url.from, url.to));
        }
      }
      return false;
    },
  });
  return found;
};

/** The text between `![` and `]` of an `Image` node. */
const altOf = (state: EditorState, node: SyntaxNode): string => {
  const [open, close] = node.getChildren("LinkMark");
  return open === undefined || close === undefined ? "" : state.sliceDoc(open.to, close.from);
};

/** The destination of an `Image` node, `<…>` unwrapped; undefined for a reference without a definition. */
const destinationOf = (state: EditorState, node: SyntaxNode): string | undefined => {
  const url = node.getChild("URL");
  const text = url === null ? undefined : state.sliceDoc(url.from, url.to);
  if (text !== undefined) {
    return text.startsWith("<") && text.endsWith(">") ? text.slice(1, -1) : text;
  }
  const label = node.getChild("LinkLabel");
  // `![alt][label]`, `![alt][]` (the alt is the label) and `![alt]`.
  const own = label === null ? "" : state.sliceDoc(label.from + 1, label.to - 1);
  const found = definitions(state).get(labelKey(own === "" ? altOf(state, node) : own));
  return found === undefined
    ? undefined
    : found.startsWith("<") && found.endsWith(">")
      ? found.slice(1, -1)
      : found;
};

/** The images that did not load in this editor, by URL; asked again when the editor takes the focus. */
const imageFailed = StateEffect.define<string>();

export const failedImages = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update: (value, transaction) => {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(focusEffect) && effect.value && next.size > 0) {
        next = new Set();
      } else if (effect.is(imageFailed) && !next.has(effect.value)) {
        next = new Set([...next, effect.value]);
      }
    }
    return next;
  },
});

/** The image itself: an `<img>` with the URL and the alt text as properties, never markup. */
export class ImageWidget extends WidgetType {
  readonly url: string;
  readonly alt: string;
  readonly block: boolean;

  constructor(url: string, alt: string, block: boolean) {
    super();
    this.url = url;
    this.alt = alt;
    this.block = block;
  }

  override eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt && other.block === this.block;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement(this.block ? "div" : "span");
    wrap.className = this.block ? "cm-lr-image-block" : "cm-lr-image";
    const image = document.createElement("img");
    image.alt = this.alt;
    image.decoding = "async";
    image.draggable = false;
    // The height of the line changes once the image is there.
    image.addEventListener("load", () => {
      view.requestMeasure();
    });
    image.addEventListener("error", () => {
      view.dispatch({ effects: [imageFailed.of(this.url), refreshPreview.of(null)] });
    });
    image.src = this.url;
    wrap.append(image);
    return wrap;
  }

  // A click on the image reaches the editor, so it puts the cursor there and the source appears.
  override ignoreEvent(): boolean {
    return false;
  }
}

export const NOTE_TEXT: Readonly<Record<ImageNote, string>> = {
  network: "not shown: address on the network",
  data: "not shown: data: address",
  outside: "not shown: outside the repository",
  unreadable: "not shown: file missing or not an image",
};

/** The note right after the source of an image that is not drawn, in the muted colour and smaller type. */
export class ImageNoteWidget extends WidgetType {
  readonly note: ImageNote;

  constructor(note: ImageNote) {
    super();
    this.note = note;
  }

  override eq(other: ImageNoteWidget): boolean {
    return other.note === this.note;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-lr-image-note";
    element.textContent = NOTE_TEXT[this.note];
    element.title = NOTE_TEXT[this.note];
    return element;
  }
}

type Shown = { readonly url: string; readonly alt: string } | { readonly note: ImageNote } | undefined;

/** What the preview does with an `Image` node: draw it, note why not, or nothing (no destination). */
const shown = (node: SyntaxNode, state: EditorState, element: ImageElement): Shown => {
  const destination = destinationOf(state, node);
  if (destination === undefined) {
    return undefined;
  }
  const target = imageTarget(element.file, destination);
  if (target.kind === "note") {
    return { note: target.note };
  }
  const url = imageUrl(element.repository, target.names);
  return state.field(failedImages, false)?.has(url) === true
    ? { note: "unreadable" }
    : { url, alt: altOf(state, node) };
};

/** Whether the image is alone in its line: then it is drawn as a block, as wide as the column allows. */
const alone = (state: EditorState, node: SyntaxNodeRef): boolean => {
  const line = state.doc.lineAt(node.from);
  return (
    state.doc.lineAt(node.to).number === line.number &&
    state.sliceDoc(line.from, node.from).trim() === "" &&
    state.sliceDoc(node.to, line.to).trim() === ""
  );
};

/** The preview rule of images; `element` gives the element the text belongs to when the preview is built. */
export const imageRule = (element: () => ImageElement): PreviewRule => ({
  nodes: ["Image"],
  decorate: (node, { state, sourceLine }: PreviewContext): Range<Decoration>[] => {
    // An image over several lines is none for the version either (core's scanner reads one line).
    const what =
      state.doc.lineAt(node.from).number === state.doc.lineAt(node.to).number
        ? shown(node.node, state, element())
        : undefined;
    if (what === undefined) {
      return [];
    }
    if ("note" in what) {
      return [Decoration.widget({ widget: new ImageNoteWidget(what.note), side: 1 }).range(node.to)];
    }
    if (sourceLine(node.from)) {
      // A block of its own at the end of the line, as the formulas below their source (no block widget,
      // which would leave an empty line after the last one).
      return [
        Decoration.widget({ widget: new ImageWidget(what.url, what.alt, true), side: 1 }).range(
          state.doc.lineAt(node.to).to,
        ),
      ];
    }
    return [
      Decoration.replace({ widget: new ImageWidget(what.url, what.alt, alone(state, node)) }).range(
        node.from,
        node.to,
      ),
    ];
  },
});

const theme: Extension = View.baseTheme({
  ".cm-lr-image img, .cm-lr-image-block img": { maxWidth: "100%", height: "auto", verticalAlign: "bottom" },
  ".cm-lr-image-block": { display: "block", padding: "0.25rem 0" },
  ".cm-lr-image-note": { color: "var(--muted)", fontSize: "0.85em", marginLeft: "0.5em" },
});

/** The images of the preview as editor plugins (`mergePlugins`). */
export const imagePreview = (element: () => ImageElement): EditorPlugins => ({
  rules: [imageRule(element)],
  extensions: [failedImages, theme],
});
