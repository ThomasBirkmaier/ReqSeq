// The entry point of the metamodel commands (SR-236): the change through the write layer of the
// metamodel block (`changeMetamodel`: read, check, write, reset), then what it does to the elements
// (`metamodelEffects`, SR-236 AK9), counted over the element store in memory.
import type { MetamodelChange, MetamodelPlan, MetamodelSource } from "../metamodel/index.js";
import { changeMetamodel } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { MetamodelEffects } from "./metamodel-effects.js";
import { metamodelEffects } from "./metamodel-effects.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

export type MetamodelWrite<T> = MetamodelChange<T> & MetamodelEffects;

/** Changes the metamodel as `plan` says, for `command`, and counts the effects on the elements. */
export const writeMetamodel = async <T>(
  workspace: Workspace,
  command: string,
  plan: (source: MetamodelSource & { readonly store: ElementStore }) => MetamodelPlan<T>,
): Promise<MetamodelWrite<T>> => {
  // Loaded before the write, so a store that cannot be read refuses the command before it writes;
  // the plan counts uses on it, the state at execution (SR-236 AK10).
  const store = await workspace.get(elementStoreState);
  const change = await changeMetamodel(workspace, command, (source) => plan({ ...source, store }));
  return { ...change, ...metamodelEffects(store, change.before, change.after) };
};
