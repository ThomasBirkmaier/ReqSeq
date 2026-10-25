// Opening a workspace ahead of the first command (SR-082): a server loads what every command reads
// before it answers, so "the API answers" means "the workspace is usable".
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { elementStoreState } from "./store.js";
import { incomingFor } from "./incoming.js";
import { shortIdState } from "./short-id.js";

/**
 * Loads the layout, the metamodel, the element store (through the model cache when the workspace
 * has a cache folder) and the short IDs of `workspace`, and builds the incoming relation index of
 * the store, so that the first chain after a start does not pay for it (SR-082 AK4, #227; a save
 * carries it over, #267). Never rejects: a state that fails to build is dropped, and the first
 * command that needs it reports the error.
 */
export const warmWorkspace = async (workspace: Workspace): Promise<void> => {
  await Promise.allSettled([
    (async () => workspace.get(shortIdState))(),
    (async () => {
      const [store, metamodel] = await Promise.all([
        workspace.get(elementStoreState),
        workspace.get(metamodelState),
      ]);
      incomingFor(workspace, store, metamodel);
    })(),
  ]);
};
