// How the app offers a catalog command: by the app action that covers it (its `covers`, or the same title as the
// command), else by the command's catalog title in the command prompt (catalog-commands.ts), each with the key that
// runs it. The documentation generator reads it (ADR-0017), so the reference names what the app shows.
import type { Action } from "./actions.js";
import { ACTIONS, COMMAND_SHORTCUT } from "./actions.js";
import { bindingLabel } from "./bindings.js";
import { shortcutLabel } from "./keys.js";

/** A catalog command by its name and title. */
export interface NamedCommand {
  readonly name: string;
  readonly title: string;
}

/** What the command prompt lists for a command, and whether that is an app action. */
export interface AppCommandEntry {
  readonly name: string;
  readonly action: boolean;
  /** The shortcut of the action, or the key after the prefix key ("Ctrl+K E", SR-121 AK3). */
  readonly key?: string;
}

/** The app action that does what `command` does, so the command prompt lists the action only (#85). */
export const coveringAction = (
  command: NamedCommand,
  actions: readonly Action[] = ACTIONS,
): Action | undefined =>
  actions.find((action) => action.title === command.title || (action.covers ?? []).includes(command.name));

/** How the command prompt names `command`, with its key on macOS (`mac`) or on the other systems. */
export const appCommandEntry = (command: NamedCommand, mac: boolean): AppCommandEntry => {
  const action = coveringAction(command);
  const key =
    action === undefined
      ? bindingLabel(`command:${command.name}`, mac)
      : action.shortcut === undefined
        ? undefined
        : shortcutLabel(action.shortcut, mac);
  return {
    name: action?.title ?? command.title,
    action: action !== undefined,
    ...(key === undefined ? {} : { key }),
  };
};

/** The key that opens the command prompt (Ctrl/Cmd+Shift+P). */
export const commandPromptKey = (mac: boolean): string => shortcutLabel(COMMAND_SHORTCUT, mac);
