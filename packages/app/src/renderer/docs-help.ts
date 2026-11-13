// Help on an entry of the command prompt (SR-141 AK3): F1 opens the documentation of the chosen entry in the browser.
// The window sends main only the topic, a catalog command name or an action ID; main builds the page and its URL
// (`main/docs.ts`): a catalog command opens its reference page, an action that covers a command (`coveringAction`)
// that command's page, any other action its row of keys.
import type { Action, ActionContext, Choice, Prompt } from "./actions.js";
import { ACTIONS } from "./actions.js";
import type { NamedCommand } from "./command-entry.js";

/** The prefix of the ID of a catalog command's entry (`catalog-commands.ts`). */
const COMMAND_ID = "command:";

/** The topic of the entry `id` of the command prompt: the one catalog command it runs, else the action's ID. */
export const docsTopic = (
  id: string,
  catalog: readonly NamedCommand[],
  actions: readonly Action[] = ACTIONS,
): string => {
  if (id.startsWith(COMMAND_ID)) {
    return id.slice(COMMAND_ID.length);
  }
  const action = actions.find((candidate) => candidate.id === id);
  if (action === undefined) {
    return id;
  }
  const { covers } = action;
  // An action that runs one of several catalog commands by the shown display has its own row (SR-210 AK5).
  if (covers !== undefined) {
    return covers.length === 1 && covers[0] !== undefined ? covers[0] : id;
  }
  return catalog.find((command) => command.title === action.title)?.name ?? id;
};

/** `prompt` with F1 on its entries (`Prompt.help`), when the app can open the documentation (`context.docs`). */
export const withHelp = (
  prompt: Prompt,
  context: Pick<ActionContext, "docs">,
  catalog: readonly NamedCommand[],
): Prompt => {
  const { docs } = context;
  if (docs === undefined) {
    return prompt;
  }
  return {
    ...prompt,
    help: (choice: Choice | undefined) => {
      docs(choice === undefined ? undefined : docsTopic(choice.id, catalog));
    },
  };
};

/** What the minibuffer says after a request to open the documentation. */
export const docsEcho = (
  result: { readonly ok: true } | { readonly ok: false; readonly message: string },
): string => (result.ok ? "Opened the documentation in the browser" : result.message);
