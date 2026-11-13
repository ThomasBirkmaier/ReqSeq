// How the app offers a catalog command: by the app action that covers it (its `covers`, or the same title as the
// command), else by the command's catalog title in the command prompt (catalog-commands.ts), each with the key that
// runs it; a command whose output the app shows only in another command has no entry of its own (`SHOWN_IN`,
// SR-133 AK4). The documentation generator reads it (ADR-0017), so the reference names what the app shows.
import type { Action } from "./actions.js";
import { ACTIONS } from "./actions.js";
import { bindingLabel } from "./bindings.js";
import { COMMAND_SHORTCUT, shortcutLabel } from "./keys.js";

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
  /** No entry of its own (then `name` is the catalog title and `action` false): where the app shows its output. */
  readonly shownIn?: string;
}

/**
 * The catalog commands whose output the app shows only inside other commands, so the command prompt neither
 * lists nor finds them (SR-133 AK4), each with the place that shows it. Not by `covers`: an action that
 * covers a command shows that command's summary (SR-210 AK5), and these actions keep their own description.
 */
export const SHOWN_IN: Readonly<Record<string, string>> = {
  "workspace.listFolder": "every path input, as the folders it offers",
  "workspace.recent": '"Open workspace"',
  "workspace.activity": '"Follow agent"',
  "element.facets": "the filters of a list, the overview and the values of an element that open a list",
  "relation.options": '"Create relation", the traceability matrix and the relation kinds an argument offers',
  "filter.list": '"Filter list by saved filter"',
  "perspective.list": '"Open perspective", "Save list as perspective" and the overview',
};

/** Where the app shows the output of `command` instead of an entry of its own (`SHOWN_IN`), if it does. */
export const shownIn = (command: NamedCommand): string | undefined =>
  Object.hasOwn(SHOWN_IN, command.name) ? SHOWN_IN[command.name] : undefined;

/** The app action that does what `command` does, so the command prompt lists the action only (ThomasBirkmaier/ReqSeq-archive#85). */
export const coveringAction = (
  command: NamedCommand,
  actions: readonly Action[] = ACTIONS,
): Action | undefined =>
  actions.find((action) => action.title === command.title || (action.covers ?? []).includes(command.name));

/**
 * The catalog command `action` runs (SR-210 AK5): the one it `covers`, else the one with its title, when
 * `catalog` lists it. An action that covers several runs one of them by the shown view: none.
 */
export const coveredCommand = <C extends NamedCommand>(
  action: Action,
  catalog: readonly C[],
): C | undefined => {
  const { covers } = action;
  if (covers !== undefined && covers.length !== 1) {
    return undefined;
  }
  return catalog.find((command) =>
    covers === undefined ? command.title === action.title : command.name === covers[0],
  );
};

/** How the command prompt names `command`, with its key on macOS (`mac`) or on the other systems. */
export const appCommandEntry = (command: NamedCommand, mac: boolean): AppCommandEntry => {
  const place = shownIn(command);
  if (place !== undefined) {
    return { name: command.title, action: false, shownIn: place };
  }
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
