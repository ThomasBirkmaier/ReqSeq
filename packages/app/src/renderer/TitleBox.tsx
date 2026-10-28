// The title of an element, edited where it is shown: in its heading (#621; SR-104, SR-073 AK1; spec question
// #676). One line of plain text (SR-127: the title stays plain text), no box, label or input (D-062). While
// it is not edited the heading shows the title as text (the ID, muted, for an empty title); entering it (Enter
// on the field, a click, "Edit title", Up from the first line of the text) puts an editor into the same
// heading, which stays for the life of the buffer (`open`), so the buffer has no second editor before. Keys:
// Enter, Shift+Enter and Escape leave the title for its field; Up and Down at the line move to the field
// before and after (`editor/box-navigation.ts`); a line break typed or pasted becomes one space
// (`editor/single-line.ts`). The buffer saves it with the boxes (`property-edit.ts`, `TITLE_FIELD`).
import { Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useMemo, useRef } from "react";
import type { EditorHandle } from "./editor/Editor.js";
import { Editor } from "./editor/Editor.js";
import { boxNavigation } from "./editor/box-navigation.js";
import type { BoxNavigation } from "./editor/box-navigation.js";
import { singleLine } from "./editor/single-line.js";
import { TITLE_FIELD } from "./element-view.js";
import { clickOffset, titleHeading } from "./title-box.js";

// No preview rule: the title is plain text.
const PLAIN: never[] = [];

export interface TitleBoxProps {
  /** The title as loaded or saved. */
  readonly text: string;
  /** What the element is named by without a title (identifier or short ID): shown, muted, for an empty one. */
  readonly id: string;
  /** The editor is in the heading (the title was entered, or the buffer came back with title input). */
  readonly open: boolean;
  /** The title cannot be edited now: a click opens nothing, an open editor takes no input. */
  readonly readOnly: boolean;
  /** The unsaved title to show in place of `text`, when the editor is made. */
  readonly initial?: string;
  /** A state the title editor had (`Editor`, SR-105 AK2). */
  readonly restore?: unknown;
  readonly onClose?: (state: unknown) => void;
  readonly onUpdate?: () => void;
  /** A click on the closed heading: open the editor with the caret at the offset, or at the end. */
  readonly onOpen: (at: number | "end") => void;
  /** The document changed; `typed` when it is input (`Editor`). */
  readonly onChange: (doc: string, typed: boolean) => void;
  /** Escape, Enter and Shift+Enter: the focus goes to the field of the title. */
  readonly onLeave: () => void;
  /** Up and Down at the line: false when there is nowhere to go. */
  readonly navigation: Required<BoxNavigation>;
  readonly onHandle: (handle: EditorHandle | undefined) => void;
}

/** Where the browser puts a caret for a click at this point: the offset in the text node, if it hit one in `heading`. */
const hitOffset = (heading: HTMLElement, x: number, y: number): number | undefined => {
  // Not in every DOM (happy-dom of the unit tests has none): then the caret goes to the end.
  if (!("caretPositionFromPoint" in document)) {
    return undefined;
  }
  const position = document.caretPositionFromPoint(x, y);
  return position !== null && position.offsetNode.parentNode === heading ? position.offset : undefined;
};

export const TitleBox = ({
  text,
  id,
  open,
  readOnly,
  initial,
  restore,
  onClose,
  onUpdate,
  onOpen,
  onChange,
  onLeave,
  navigation,
  onHandle,
}: TitleBoxProps): React.JSX.Element => {
  // The callbacks of the latest render: the plugins are made again only when the ID changes, or the editor
  // would be configured again on every render of the buffer (a composition running would break).
  const latest = useRef({ onLeave, navigation });
  latest.current = { onLeave, navigation };
  const plugins = useMemo(() => {
    const leave = (): boolean => {
      latest.current.onLeave();
      return true;
    };
    return {
      extensions: [
        // Before the Markdown keymap: Enter and Shift+Enter put no line break in the title.
        Prec.highest(keymap.of([{ key: "Enter", run: leave, shift: leave }])),
        boxNavigation({
          down: () => latest.current.navigation.down(),
          up: () => latest.current.navigation.up(),
        }),
        // One Tab stop: the field. The title is entered with Enter or a click.
        EditorView.contentAttributes.of({ tabindex: "-1" }),
        placeholder(id),
        singleLine,
      ],
    };
  }, [id]);
  if (!open) {
    const shown = titleHeading(text, id);
    return (
      <h1
        {...(shown.untitled ? { className: "untitled" } : {})}
        onClick={(event) => {
          if (!readOnly) {
            onOpen(clickOffset(shown, text, hitOffset(event.currentTarget, event.clientX, event.clientY)));
          }
        }}
      >
        {shown.text}
      </h1>
    );
  }
  return (
    <h1>
      <Editor
        text={text}
        readOnly={readOnly}
        plugins={plugins}
        rules={PLAIN}
        label={TITLE_FIELD}
        {...(initial === undefined ? {} : { initial })}
        {...(restore === undefined ? {} : { restore })}
        {...(onClose === undefined ? {} : { onClose })}
        {...(onUpdate === undefined ? {} : { onUpdate })}
        onChange={onChange}
        onEscape={onLeave}
        handle={onHandle}
      />
    </h1>
  );
};
