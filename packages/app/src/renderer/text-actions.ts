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
];
