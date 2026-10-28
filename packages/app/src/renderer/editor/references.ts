// Inline references in the text (ADR-0004, #424): `[label](logreq:<uuid>?version=<v>&repository=<name>)`.
// The preview shows the label (`markup.ts` hides the rest); this file makes a reference something to
// follow: a click opens its element, and an outdated reference is marked. A reference to another repository
// has the short ID as its label (ADR-0004); off the lines that show their source the preview shows the title
// of its target instead when the target is here (D-058). This is UI only: what is under the pointer or the
// cursor. Whether a target exists, its title and whether a reference is outdated come from core
// (`element.get`: the target by its UUID, the hints `relation.outdated`); the app never compares versions.
import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parsedTree } from "./parsed.js";
import type { EditorPlugins, PreviewRule } from "./plugins.js";
import { focusState, refreshPreview, sourceLines } from "./preview.js";
import { GlyphWidget, LabelWidget } from "./widgets.js";

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
    let node: SyntaxNode | null = parsedTree(state, pos).resolveInner(pos, side);
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

/** The inline references of the document, in the order they are written (in `tree`: by default all of them). */
export const referencesIn = (state: EditorState, tree: Tree = parsedTree(state)): Reference[] => {
  const found: Reference[] = [];
  tree.iterate({
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

/** The key of the title of a target in another repository: its UUID and the repository as written. */
export const titleKey = (id: string, repository: string): string => `${id} ${repository}`;

const addTitles = StateEffect.define<ReadonlyMap<string, string>>();

/** The titles of the targets in other repositories that are here (D-058): `titleKey` to the title. */
export const titlesField = StateField.define<ReadonlyMap<string, string>>({
  create: () => new Map(),
  update: (value, transaction) =>
    transaction.effects.reduce<ReadonlyMap<string, string>>(
      (titles, effect) => (effect.is(addTitles) ? new Map([...titles, ...effect.value]) : titles),
      value,
    ),
});

export interface ReferenceOptions {
  /** The outdated references of the element: `outdatedKey` to the message of the hint. */
  readonly outdated: ReadonlyMap<string, string>;
  /** A reference is followed. */
  readonly follow: (reference: Reference) => void;
  /**
   * The title of a target in another repository, asked of core (`element.get`); undefined when the target is
   * not here. Without it the label is shown as written.
   */
  readonly title?: (id: string, repository: string) => Promise<string | undefined>;
}

const MARK = Decoration.mark({ class: "cm-lr-ref" });

/** The title shown in place of the label of `reference`: a target in another repository that is here (D-058). */
const titleOf = (state: EditorState, reference: Reference): string | undefined =>
  reference.repository === undefined
    ? undefined
    : state.field(titlesField, false)?.get(titleKey(reference.id, reference.repository));

/**
 * The preview rule: the label of a reference is marked, and off the source lines the title of a target in
 * another repository takes its place; an outdated one has the accent and the word.
 */
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
    const classes = message === undefined ? "cm-lr-ref" : "cm-lr-ref cm-lr-outdated";
    const title = sourceLine(open.to) ? undefined : titleOf(state, reference);
    // The title takes the place of the label with the label's look, so a press on it follows the reference.
    const label =
      title === undefined
        ? message === undefined
          ? MARK
          : Decoration.mark({ class: classes, attributes: { title: message } })
        : Decoration.replace({
            widget: new LabelWidget(title, `cm-lr-link ${classes} cm-lr-title`, message),
          });
    if (message === undefined) {
      return [label.range(open.to, close.from)];
    }
    return [
      label.range(open.to, close.from),
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

/**
 * Asks once for the title of each target in another repository that the text references, when the parsed
 * text changes; a title that comes is shown at once (D-058). An editor that is gone takes none.
 */
const askTitles = (title: NonNullable<ReferenceOptions["title"]>): Extension =>
  ViewPlugin.define((view) => {
    const asked = new Set<string>();
    const ask = (state: EditorState): void => {
      const across = referencesIn(state, syntaxTree(state)).flatMap(({ id, repository }) =>
        repository === undefined ? [] : [{ id, repository, key: titleKey(id, repository) }],
      );
      for (const { id, repository, key } of across) {
        if (!asked.has(key) && !state.field(titlesField).has(key)) {
          asked.add(key);
          void title(id, repository).then((found) => {
            if (found !== undefined && view.dom.isConnected) {
              view.dispatch({ effects: [addTitles.of(new Map([[key, found]])), refreshPreview.of(null)] });
            }
          });
        }
      }
    };
    ask(view.state);
    return {
      update: (update) => {
        if (syntaxTree(update.startState) !== syntaxTree(update.state)) {
          ask(update.state);
        }
      },
    };
  });

/** The plugin of the element buffer: marks references (outdated ones with the accent) and follows them. */
export const references = (options: ReferenceOptions): EditorPlugins => ({
  rules: [rule(options.outdated)],
  extensions: [
    titlesField,
    EditorView.domEventHandlers({ mousedown: followOnMouseDown(options.follow) }),
    ...(options.title === undefined ? [] : [askTitles(options.title)]),
  ],
});

/**
 * The reference "Follow reference" takes in a box (SR-127): at the caret when the box has the focus, else the
 * first one; none in a box that is not Markdown.
 */
export const boxReference = (
  box: { readonly state: () => EditorState; readonly hasFocus: () => boolean },
  markdown: boolean,
): Reference | undefined => {
  if (!markdown) {
    return undefined;
  }
  const state = box.state();
  return box.hasFocus() ? referenceAt(state, state.selection.main.head) : referencesIn(state)[0];
};
