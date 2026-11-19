// The command prompt of the window (`App.tsx`): the read of the catalog, the prompt of the actions and the
// catalog's commands, and the builders that go back to it. `App` calls it where its code stood, so the
// catalog's listener of `workspace-changed` comes after the status's.
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect } from "react";
import type { CommandListing, ReqSeqBridge } from "../shared/protocol.js";
import type { ActionContext, BuiltCommand, Prompt } from "./action-types.js";
import { ACTIONS, allCommandsPrompt, commandPrompt, unusedOrder } from "./actions.js";
import { appStorage } from "./app-parts.js";
import { catalogItems, startBuilder, withExplanations } from "./catalog-commands.js";
import { withHelp } from "./docs-help.js";
import { graphMeanings, graphTakesEvidence } from "./graph-choices.js";
import { promptUse } from "./usage.js";

type Setter<T> = Dispatch<SetStateAction<T>>;

/** The command prompt: `shown` it is shown, `all` it lists every command, `from` the context it opened in. */
export type Commands = (shown?: boolean, all?: boolean, from?: ActionContext) => Prompt;

/** What the command prompt takes of the window. */
export interface CommandParts {
  readonly bridge: ReqSeqBridge;
  readonly catalog: RefObject<readonly CommandListing[]>;
  readonly setMeanings: Setter<readonly string[]>;
  readonly setEvidence: Setter<boolean>;
  readonly setEcho: Setter<string>;
  readonly catalogRead: RefObject<Promise<void> | undefined>;
  readonly ask: (next: Prompt) => void;
  readonly latest: RefObject<ActionContext>;
  readonly revisionNow: RefObject<number>;
  readonly builder: RefObject<(command: BuiltCommand, from: ActionContext) => void>;
}

export const useCommandPrompt = (parts: CommandParts): Commands => {
  const { bridge, catalog, setMeanings, setEvidence, setEcho, catalogRead, ask, latest, revisionNow } = parts;
  const { builder } = parts;
  useEffect(() => {
    const load = (): void => {
      const read = bridge
        .commands()
        .then(
          (commands) => {
            catalog.current = commands;
            setMeanings(graphMeanings(commands));
            setEvidence(graphTakesEvidence(commands));
          },
          (error: unknown) => {
            // Without the catalog the command prompt has the app's actions only; say why.
            setEcho(String(error));
          },
        )
        .finally(() => {
          if (catalogRead.current === read) {
            catalogRead.current = undefined;
          }
        });
      catalogRead.current = read;
    };
    load();
    // After a start without a workspace there was no core process to ask: ask the one just opened.
    return bridge.on("workspace-changed", (change) => {
      if (change.reason === "opened" && catalog.current.length === 0) {
        load();
      }
    });
  }, [bridge]);
  // The command prompt: the actions that apply now and the catalog's read and write commands (ThomasBirkmaier/ReqSeq-archive#85);
  // without a workspace, "Initialise workspace" of the folder core opened (`catalogItems`). `shown`: the
  // prompt is shown, so Escape in the first prompt of an action chosen in it shows it again (SR-134 AK1); its
  // entries run from the prefix key or the context menu have no command prompt to go back to.
  // While the catalog is read, the prompt opens with the actions and takes keys, and its entries are built
  // again with the catalog's commands once it is there (`fill`); an Enter meanwhile waits for them, also on an
  // action (the read is short: core answers at once, or the bridge gives none without a connection).
  const commands = useCallback(
    (shown = true, all = false, from?: ActionContext): Prompt => {
      // Backspace on an empty input and Escape before the first argument of a catalog command or in the first
      // prompt of an action chosen here (SR-134 AK1, AK4), open the command prompt again, or the list of every command it was chosen in.
      const reopen = (): void => {
        ask(commands(true, all));
      };
      // "All commands…" (SR-133 AK3): the shown prompt with an empty input offers it after the first nine. It lists
      // the commands of the context the prompt opened in, as its other rows run in it: a click on the row must not
      // drop what the shown buffer had selected.
      const opened = from ?? latest.current;
      const everything =
        shown && !all
          ? (): void => {
              ask(commands(true, true, opened));
            }
          : undefined;
      const build = (): Prompt => {
        const now = from ?? latest.current;
        const items = catalogItems(
          { ...now, revision: () => revisionNow.current, reopen },
          catalog.current,
          ACTIONS,
        );
        const prompt = withHelp(
          withExplanations(
            commandPrompt(now, promptUse(appStorage), items, shown ? reopen : undefined, everything),
            catalog.current,
          ),
          now,
          catalog.current,
        );
        // Without use in the order of SR-133 AK1, which `rankByUse` keeps among commands in equal use.
        const ordered = { ...prompt, items: unusedOrder(prompt.items) };
        return all ? allCommandsPrompt(ordered) : ordered;
      };
      const prompt = build();
      const reading = catalogRead.current;
      // Only a shown prompt: the prefix key and the context menu take the entries as they are now.
      return reading === undefined || !shown
        ? prompt
        : { ...prompt, fill: reading.then(() => ({ items: build().items })) };
    },
    [ask],
  );
  // Escape in the first step of a builder opens the command prompt again, as before a catalog command's first argument.
  builder.current = (command, from) => {
    startBuilder(
      {
        ...from,
        revision: () => revisionNow.current,
        reopen: () => {
          ask(commands(true));
        },
      },
      command,
      catalog.current,
    );
  };
  return commands;
};
