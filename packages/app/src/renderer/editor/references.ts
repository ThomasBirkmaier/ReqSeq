// Inline references in the text (ADR-0004, #424): `[label](logreq:<uuid>?version=<v>&repository=<name>)`.
// The preview shows the label (`markup.ts` hides the rest); this file makes a reference something to
// follow: a click opens its element, and an outdated reference is marked. This is UI only: what is under
// the pointer or the cursor. Whether a target exists and whether a reference is outdated come from core
// (`element.get`: the target by its UUID, the hints `relation.outdated`); the app never compares versions.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { EditorPlugins, PreviewRule } from "./plugins.js";
import { focusState, sourceLines } from "./preview.js";
import { GlyphWidget } from "./widgets.js";

/** An inline reference in the text. */
export interface Reference {
  /** The UUID as written. */
  readonly id: string;
  /** The first `version` parameter; undefined when there is none or it is empty. */
  readonly version?: string;
  /** The first `repository` parameter as written; undefined when there is none or it is empty. */
  readonly repository?: string;
  /** The Link node in the document. */
  readonly from: number;
  readonly to: number;
}

// This mirrors the rule of core (`packages/core/src/model/references.ts`: `logreq:<uuid>` and the
// parameters `version` and `repository`, an empty value names none). It is not imported: the renderer
// bundles no code of core, only its types.
const DESTINATION =
  /^logreq:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\?(.*))?$/;

const parameter = (parameters: readonly string[], name: string): string | undefined => {
  const value = parameters.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
  return value === "" ? undefined : value;
};

/** The reference a link destination names, or undefined when it is no `logreq:<uuid>` link. */
export const parseReference = (destination: string): Omit<Reference, "from" | "to"> | undefined => {
  const match = DESTINATION.exec(destination);
  const id = match?.[1];
  if (id === undefined) {
    return undefined;
  }
  const parameters = (match?.[2] ?? "").split("&").filter((entry) => entry !== "");
  const version = parameter(parameters, "version");
  const repository = parameter(parameters, "repository");
  return {
    id,
    ...(version === undefined ? {} : { version }),
    ...(repository === undefined ? {} : { repository }),
  };
};

/** The reference a Link node is, or undefined when its destination is no reference. */
const referenceOf = (state: EditorState, link: SyntaxNode): Reference | undefined => {
  const url = link.getChild("URL");
  const parsed = url === null ? undefined : parseReference(state.sliceDoc(url.from, url.to));
  return parsed === undefined ? undefined : { ...parsed, from: link.from, to: link.to };
};

/** The Link node around `pos`, looking at the node on `side` of it. */
const linkAround = (state: EditorState, pos: number, side: -1 | 1): SyntaxNode | undefined => {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
    node !== null;
    node = node.parent
  ) {
    if (node.name === "Link") {
      return node;
    }
  }
  return undefined;
};

/** The inline reference whose link contains `pos` (also right before `[` and right after `)`), if any. */
export const referenceAt = (state: EditorState, pos: number): Reference | undefined => {
  const link = linkAround(state, pos, 1) ?? linkAround(state, pos, -1);
  return link === undefined ? undefined : referenceOf(state, link);
};

/** The inline references of the document, in the order they are written. */
export const referencesIn = (state: EditorState): Reference[] => {
  const found: Reference[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      const reference = node.name === "Link" ? referenceOf(state, node.node) : undefined;
      if (reference !== undefined) {
        found.push(reference);
      }
    },
  });
  return found;
};

/**
 * The key of an outdated reference: its target, the version it stores and the repository it names,
 * percent-encoded as in the ID of the hint (`hintId`), where core writes it that way ("" for none).
 */
export const outdatedKey = (id: string, version: string, encodedRepository = ""): string =>
  `${id} ${version} ${encodedRepository}`;

export interface ReferenceOptions {
  /** The outdated references of the element: `outdatedKey` to the message of the hint. */
  readonly outdated: ReadonlyMap<string, string>;
  /** A reference is followed. */
  readonly follow: (reference: Reference) => void;
}

const MARK = Decoration.mark({ class: "cm-lr-ref" });

/** The preview rule: the label of a reference is marked; an outdated one has the accent and the word. */
const rule = (outdated: ReadonlyMap<string, string>): PreviewRule => ({
  nodes: ["Link"],
  decorate: (node, { state, sourceLine }) => {
    const reference = referenceOf(state, node.node);
    const marks = node.node.getChildren("LinkMark");
    const open = marks[0];
    const close = marks[1];
    if (reference === undefined || open === undefined || close === undefined || open.to >= close.from) {
      return [];
    }
    const message =
      reference.version === undefined
        ? undefined
        : outdated.get(
            outdatedKey(
              reference.id,
              reference.version,
              reference.repository === undefined ? "" : encodeURIComponent(reference.repository),
            ),
          );
    if (message === undefined) {
      return [MARK.range(open.to, close.from)];
    }
    return [
      Decoration.mark({ class: "cm-lr-ref cm-lr-outdated", attributes: { title: message } }).range(
        open.to,
        close.from,
      ),
      // The word shows off the source lines only; there the markup is shown anyway.
      ...(sourceLine(node.to)
        ? []
        : [
            Decoration.widget({ widget: new GlyphWidget(" outdated", "cm-lr-outdated-word"), side: 1 }).range(
              node.to,
            ),
          ]),
    ];
  },
});

/**
 * The mouse handler: a press on the label of a reference follows it. On a line that shows its source a
 * plain press places the cursor (the label stays editable); Ctrl or Cmd with the press follows there too.
 */
export const followOnMouseDown =
  (follow: (reference: Reference) => void) =>
  (event: MouseEvent, view: EditorView): boolean => {
    const target = event.target;
    const label = event.button === 0 && target instanceof Element ? target.closest(".cm-lr-ref") : null;
    if (label === null) {
      return false;
    }
    const pos = view.posAtDOM(label);
    const reference = referenceAt(view.state, pos);
    if (reference === undefined) {
      return false;
    }
    const source = sourceLines(view.state, view.state.field(focusState)).has(
      view.state.doc.lineAt(pos).number,
    );
    if (source && !event.ctrlKey && !event.metaKey) {
      return false;
    }
    event.preventDefault();
    follow(reference);
    return true;
  };

/** The plugin of the element buffer: marks references (outdated ones with the accent) and follows them. */
export const references = (options: ReferenceOptions): EditorPlugins => ({
  rules: [rule(options.outdated)],
  extensions: [EditorView.domEventHandlers({ mousedown: followOnMouseDown(options.follow) })],
});
