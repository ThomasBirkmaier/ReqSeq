// The actions of the command prompt that edit the text at its cursor (D-073: what the mouse does at the place of
// a thing, the command line does by name). Each runs an editing command of `editor/` on the text editor, with the
// selection it had before the prompt opened, and gives the text the focus; one that does not apply there says
// why. The editing logic stays in its module (`editor/tasks.ts`, ...); this list only names it. Editor-only, no
// catalog command, like the slash menu (ADR-0010).
import type { Command } from "@codemirror/view";
import type { Action, ActionContext } from "./actions.js";
import type { Shortcut } from "./keys.js";
import { toggleTask } from "./editor/tasks.js";
import { insertLink, toggleFormat } from "./editor/format.js";

export interface TextActionSpec {
  readonly id: string;
  readonly title: string;
  readonly command: Command;
  /** Said in the minibuffer when the command does not apply at the cursor ("No task on this line"). */
  readonly none: string;
  readonly shortcut?: Shortcut;
}

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

/** The text actions, in the order the command prompt lists equal matches. */
export const TEXT_ACTIONS: readonly Action[] = [
  // SR-185 AK3.
  textAction({ id: "toggle-task", title: "Toggle task", command: toggleTask, none: "No task on this line" }),
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
];
