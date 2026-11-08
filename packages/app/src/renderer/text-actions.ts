// The actions of the command prompt that edit the text at its cursor (D-073: what the mouse does at the place of
// a thing, the command line does by name). Each runs an editing command of `editor/` on the text editor, with the
// selection it had before the prompt opened, and gives the text the focus; one that does not apply there says
// why. The editing logic stays in its module (`editor/tasks.ts`, `editor/tables.ts`, ...); this list only names it. Editor-only, no
// catalog command, like the slash menu (ADR-0010).
import type { Command } from "@codemirror/view";
import type { Action, ActionContext } from "./actions.js";
import type { Shortcut } from "./keys.js";
import { alignTable, deleteColumn, deleteRow, insertColumn, insertRow } from "./editor/tables.js";
import { toggleTask } from "./editor/tasks.js";
import { insertLink, toggleFormat } from "./editor/format.js";
import { copyText, cutText, pasteText } from "./editor/clipboard.js";

export interface TextActionSpec {
  readonly id: string;
  readonly title: string;
  readonly command: Command;
  /** Said in the minibuffer when the command does not apply at the cursor ("No task on this line"). */
  readonly none: string;
  readonly shortcut?: Shortcut;
}

/** Said by a table action off a table (SR-188). */
export const NOT_IN_TABLE = "The cursor is not in a table";

/** Whether the shown buffer is an element whose text can take a command. */
export const hasText = (context: ActionContext): boolean =>
  context.buffers[0]?.kind === "element" && context.element?.text !== undefined;

/** The action that runs `command` on the text of the shown element. */
export const textAction = ({ id, title, command, none, shortcut }: TextActionSpec): Action => ({
  id,
  title,
  ...(shortcut === undefined ? {} : { shortcut }),
  available: hasText,
  run: (context) => {
    context.element?.text?.(command, none);
  },
});

/** Said when a format does not apply: only a read-only text refuses one, and the lock note comes first. */
const NO_FORMAT = "The text cannot be formatted here";

/**
 * "Link" (SR-186 AK5): asks for the address in the minibuffer, then writes the link at the cursor of the text.
 * An empty address writes nothing.
 */
export const linkAction: Action = {
  id: "format-link",
  title: "Link",
  available: hasText,
  run: (context) => {
    context.ask({
      label: "Link address",
      items: [],
      text: (address) => {
        if (address.trim() !== "") {
          context.element?.text?.(insertLink(address), NO_FORMAT);
        }
      },
    });
  },
};

/** Said when the browser or main refused a cut, a copy or a paste. */
const NO_CLIPBOARD = "The clipboard cannot be used here";

/**
 * "Cut", "Copy" and "Paste" (SR-195 AK3): what Ctrl/Cmd+X, C and V do in the field with the cursor, the text
 * or a Markdown box, which the window leaves to the field (`systemKey`). Copy changes nothing, so the lock
 * note of a read-only element does not stop it.
 */
export const CLIPBOARD_ACTIONS: readonly Action[] = [
  {
    id: "cut",
    title: "Cut",
    systemKey: { mod: true, shift: false, key: "x" },
    available: hasText,
    run: (context: ActionContext): void => {
      context.element?.text?.(cutText, NO_CLIPBOARD);
    },
  },
  {
    id: "copy",
    title: "Copy",
    systemKey: { mod: true, shift: false, key: "c" },
    available: hasText,
    run: (context: ActionContext): void => {
      context.element?.text?.(copyText, NO_CLIPBOARD, { read: true });
    },
  },
  {
    id: "paste",
    title: "Paste",
    systemKey: { mod: true, shift: false, key: "v" },
    available: hasText,
    run: (context: ActionContext): void => {
      const { paste } = context;
      if (paste === undefined) {
        context.echo(NO_CLIPBOARD);
        return;
      }
      context.element?.text?.(pasteText(paste), NO_CLIPBOARD);
    },
  },
];

/** The text actions, in the order the command prompt lists equal matches. */
export const TEXT_ACTIONS: readonly Action[] = [
  // SR-185 AK3.
  textAction({ id: "toggle-task", title: "Toggle task", command: toggleTask, none: "No task on this line" }),
  // SR-188 AK2, AK3.
  textAction({ id: "align-table", title: "Align table", command: alignTable, none: NOT_IN_TABLE }),
  textAction({ id: "insert-table-row", title: "Insert row", command: insertRow, none: NOT_IN_TABLE }),
  textAction({
    id: "insert-table-column",
    title: "Insert column",
    command: insertColumn,
    none: NOT_IN_TABLE,
  }),
  textAction({
    id: "delete-table-row",
    title: "Delete row",
    command: deleteRow,
    none: "The cursor is not in a table row below the header",
  }),
  textAction({
    id: "delete-table-column",
    title: "Delete column",
    command: deleteColumn,
    none: "The cursor is not in a table with more than one column",
  }),
  // SR-186: the formats of the selection, with the keys of AK2 (Cmd on macOS, SR-145).
  textAction({
    id: "format-bold",
    title: "Bold",
    command: toggleFormat("bold"),
    none: NO_FORMAT,
    shortcut: { mod: true, shift: false, key: "b" },
  }),
  textAction({
    id: "format-italic",
    title: "Italic",
    command: toggleFormat("italic"),
    none: NO_FORMAT,
    shortcut: { mod: true, shift: false, key: "i" },
  }),
  textAction({ id: "format-code", title: "Inline code", command: toggleFormat("code"), none: NO_FORMAT }),
  linkAction,
  // SR-195 AK3.
  ...CLIPBOARD_ACTIONS,
];
