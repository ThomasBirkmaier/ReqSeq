// "Connect AI agent" for the window (SR-227, SR-225 AK7): with a workspace open the catalog command asks the
// client; without one the workspace prompt of "Open workspace" comes first (SR-131 AK1, AK5), and the client
// is asked once the chosen workspace is open.
import { useCallback, useEffect, useRef } from "react";
import type { CommandListing } from "../shared/protocol.js";
import type { ActionContext } from "./action-types.js";
import type { CatalogContext } from "./catalog-arguments.js";
import { startCommand } from "./catalog-commands.js";
import { CONNECT_AGENT, NONE_OPENED } from "./connect-agent.js";
import { workspacePrompt } from "./workspaces.js";

/** What the window gives "Connect AI agent". */
export interface ConnectDeps {
  /** The command catalog as read last. */
  readonly catalog: () => readonly CommandListing[];
  /** The read of the catalog while it runs, else undefined. */
  readonly catalogRead: () => Promise<void> | undefined;
  /** The context a catalog command runs in, from the context of the action. */
  readonly catalogContext: (from: ActionContext) => CatalogContext;
  /** The latest context of the window. */
  readonly latest: () => ActionContext;
}

/**
 * "Connect AI agent" for the window: with a workspace open it starts the catalog command, which asks the client;
 * without one it asks for the workspace first and starts the command once that workspace is open in the window
 * (`open`) and the catalog is read. A workspace that does not open asks nothing more.
 */
export const useConnectAgent = (deps: ConnectDeps, open: boolean): ((from: ActionContext) => void) => {
  const now = useRef(deps);
  now.current = deps;
  // A workspace chosen in the prompt of "Connect AI agent" is being opened.
  const pending = useRef(false);
  const start = useCallback((from: ActionContext): void => {
    const catalog = now.current.catalog();
    const command = catalog.find((listed) => listed.name === CONNECT_AGENT);
    if (command === undefined) {
      // An empty catalog is one that could not be read: the minibuffer says why already.
      if (catalog.length > 0) {
        from.echo(`The command catalog has no ${CONNECT_AGENT}`);
      }
      return;
    }
    startCommand(now.current.catalogContext(from), command, false);
  }, []);
  useEffect(() => {
    if (!open || !pending.current) {
      return;
    }
    pending.current = false;
    void (now.current.catalogRead() ?? Promise.resolve()).then(() => {
      start(now.current.latest());
    });
  }, [open, start]);
  return useCallback(
    (from: ActionContext): void => {
      const { workspaces } = from;
      if (from.workspace || workspaces === undefined) {
        start(from);
        return;
      }
      from.ask(
        workspacePrompt({
          workspaces,
          echo: from.echo,
          none: NONE_OPENED,
          opening: (on) => {
            pending.current = on;
          },
        }),
      );
    },
    [start],
  );
};
