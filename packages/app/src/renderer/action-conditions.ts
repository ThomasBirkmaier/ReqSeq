// Where the app's actions are available: the kind of the shown buffer and what it holds (`actions.ts`).
import type { MetamodelBuffer, ResultBuffer } from "./buffers.js";
import { onlyOverview } from "./buffers.js";
import type { ActionContext } from "./action-types.js";

export const isElement = (context: ActionContext): boolean => context.buffers[0]?.kind === "element";
export const isNeighbourhood = (context: ActionContext): boolean =>
  context.buffers[0]?.kind === "neighbourhood";
export const isGraph = (context: ActionContext): boolean => context.buffers[0]?.kind === "graph";
export const hasWorkspace = (context: ActionContext): boolean => context.workspace;
/** There is another buffer to switch to (SR-115 AK5: „mehrere geöffnete Buffer“). */
export const hasOthers = (context: ActionContext): boolean => context.buffers.length > 1;
/** A buffer is open that can be closed: the lone overview cannot, it comes back (SR-118). */
export const hasBuffers = (context: ActionContext): boolean =>
  context.buffers.length > 0 && !onlyOverview(context.buffers);
export const isOverview = (context: ActionContext): boolean => context.buffers[0]?.kind === "overview";
/** The shown result buffer with an output (none while it failed). */
export const shownResult = (context: ActionContext): ResultBuffer | undefined => {
  const shown = context.buffers[0];
  return shown?.kind === "result" && shown.output !== undefined ? shown : undefined;
};
export const hasElementText = (context: ActionContext): boolean =>
  isElement(context) && context.element !== undefined;
/** The shown buffer when it is the metamodel in `mode`. */
export const metamodelIn = (
  context: ActionContext,
  mode: MetamodelBuffer["mode"],
): MetamodelBuffer | undefined => {
  const shown = context.buffers[0];
  return shown?.kind === "metamodel" && shown.mode === mode ? shown : undefined;
};
