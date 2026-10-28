// A property box whose values are text (SR-104): one editor with the values of the property, one per line;
// a single value is the whole document. There are no labels, inputs or buttons (D-062): the key and the
// values, and the caret where the user clicks or enters (Enter on the box). A property the metamodel marks
// `markdown` shows its values formatted like the text, and the source on the line with the caret only
// (SR-127 AK1); the others show their text as it is. Only the inline syntax is Markdown in a value, and every
// line is a paragraph of its own (`editor/value-lines.ts`), so a mark never pairs across two values. No
// image preview (an image in a property is no embedded image, ADR-0004, D-057) and no slash menu. `[[`
// asks for an element as in the text (SR-127 AK2, `editor/reference-search.ts`) in an editable Markdown
// box only: a title or an identifier stays plain text (SR-127 AK5). A reference to another repository shows
// the title of its target when it is here (D-058).
//
// Keys: Enter in a list starts a new value at the caret; in a single value it leaves the box (back to the
// box itself, where Enter enters again); Escape leaves the box; Up and Down at the first and last line move
// to the box before and after (`editor/box-navigation.ts`). The box has one Tab stop, the field around it.
import { insertNewline } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useMemo, useRef } from "react";
import type { EditorHandle } from "./editor/Editor.js";
import { Editor } from "./editor/Editor.js";
import { boxNavigation } from "./editor/box-navigation.js";
import type { BoxNavigation } from "./editor/box-navigation.js";
import { mergePlugins } from "./editor/plugins.js";
import { inline } from "./editor/preview.js";
import { references } from "./editor/references.js";
import type { OutdatedMark, Reference, ReferenceOptions } from "./editor/references.js";
import type { ReferenceRequest } from "./editor/reference-pick.js";
import { referenceSearch } from "./editor/reference-search.js";
import { valueLines } from "./editor/value-lines.js";

// Only the inline rules of the preview: no headings, lists, quotes, rules or tables in a value. A property
// that is not Markdown has no rule at all.
const MARKDOWN = [inline];
const PLAIN: never[] = [];

export interface TextBoxProps {
  /** The key of the property: the name of the box. */
  readonly label: string;
  /** The stored document: the values, one per line. */
  readonly text: string;
  /** The unsaved document to show in place of `text`, when the box is shown again. */
  readonly initial?: string;
  readonly readOnly: boolean;
  /** The values are a list: Enter starts a new value. */
  readonly many: boolean;
  /** The property is marked `markdown` (SR-127). */
  readonly markdown: boolean;
  /** The outdated references in the values: `outdatedKey` to the message of the hint and the word. */
  readonly outdated: ReadonlyMap<string, OutdatedMark>;
  readonly follow: (reference: Reference) => void;
  /** The title of a target in another repository (D-058). */
  readonly title: NonNullable<ReferenceOptions["title"]>;
  /** `[[` asks the app for an element (SR-127 AK2): the app opens the prompt "Insert reference". */
  readonly pickElement: (request: ReferenceRequest) => void;
  /** The repository of the element (D-058: the label of a reference to another one is its short ID). */
  readonly repository: () => string;
  /** The document changed; `typed` when it is input, not the file's value put in (`Editor`). */
  readonly onChange: (doc: string, typed: boolean) => void;
  /** Any update of the editor: a hold of autosave may have ended (`Editor`). */
  readonly onUpdate?: () => void;
  /** The state of the editor with its undo history, as it goes (`Editor`, SR-105 AK2). */
  readonly onClose?: (state: unknown) => void;
  /** A state an editor of this box had: the new one starts from it (`Editor`). */
  readonly restore?: unknown;
  /** Escape, and Enter in a single value: the focus goes to the box itself. */
  readonly onLeave: () => void;
  /** Up and Down past the first and last line: false when there is nowhere to go. */
  readonly navigation: Required<BoxNavigation>;
  readonly onHandle: (handle: EditorHandle | undefined) => void;
}

export const TextBox = ({
  label,
  text,
  initial,
  readOnly,
  many,
  markdown,
  outdated,
  follow,
  title,
  pickElement,
  repository,
  onChange,
  onUpdate,
  onClose,
  restore,
  onLeave,
  navigation,
  onHandle,
}: TextBoxProps): React.JSX.Element => {
  // The callbacks of the latest render: the plugins below are made again only when the hints about the box
  // change (the editor is configured again for a new object, so a new one per render would do it on every render).
  const latest = useRef({ onLeave, navigation, pickElement, repository });
  latest.current = { onLeave, navigation, pickElement, repository };
  const signature = JSON.stringify([...outdated]);
  // Made once per box: it holds the `[[` that waits, which a reconfiguration keeps only for the same extensions.
  const brackets = useMemo(
    () =>
      referenceSearch({
        pickElement: (request) => {
          latest.current.pickElement(request);
        },
        repository: () => latest.current.repository(),
      }),
    [],
  );
  const plugins = useMemo(() => {
    const enter = (view: EditorView): boolean => {
      if (many) {
        return insertNewline(view);
      }
      latest.current.onLeave();
      return true;
    };
    return mergePlugins(
      markdown ? references({ outdated, follow, title }) : {},
      markdown && !readOnly ? brackets : {},
      {
        markdown: [valueLines],
        extensions: [
          // Before the Markdown keymap, which would continue a list or remove markup. Shift-Enter is Enter:
          // no key puts a line break inside a value.
          Prec.highest(keymap.of([{ key: "Enter", run: enter, shift: enter }])),
          boxNavigation({
            down: () => latest.current.navigation.down(),
            up: () => latest.current.navigation.up(),
          }),
          // One Tab stop per box: the field. The text is entered with Enter or a click.
          EditorView.contentAttributes.of({ tabindex: "-1" }),
        ],
      },
    );
  }, [signature, follow, title, many, markdown, readOnly, brackets]);
  return (
    <Editor
      text={text}
      readOnly={readOnly}
      plugins={plugins}
      rules={markdown ? MARKDOWN : PLAIN}
      label={label}
      {...(initial === undefined ? {} : { initial })}
      {...(onUpdate === undefined ? {} : { onUpdate })}
      {...(onClose === undefined ? {} : { onClose })}
      {...(restore === undefined ? {} : { restore })}
      onChange={onChange}
      onEscape={onLeave}
      handle={onHandle}
    />
  );
};
