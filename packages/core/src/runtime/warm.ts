// Opening a workspace ahead of the first command (SR-082): a server loads what every command reads
// before it answers, so "the API answers" means "the workspace is usable".
import { warmModel } from "../model/warm.js";
import { warmSearchIndex } from "../query/search-state.js";
import type { Workspace } from "./workspace.js";

/**
 * Loads the model of `workspace` (`warmModel`: layout, metamodel, element store through the model
 * cache, short IDs, incoming relation index), so that the first chain after a start does not pay
 * for it (SR-082). Resolves once the model is loaded; only then is the search index started, in
 * the background and a little later (`warmSearchIndex`; SR-098), so that it adds nothing to the
 * start SR-082 AK1 and AK2 measure. Never rejects: a state that fails to build is dropped, and the
 * first command that needs it reports the error.
 */
export const warmWorkspace = async (workspace: Workspace, searchDelayMs?: number): Promise<void> => {
  const model = warmModel(workspace);
  // A server from now on: a search during the warm-up builds without the cache too.
  warmSearchIndex(workspace, searchDelayMs, model);
  await model;
};
