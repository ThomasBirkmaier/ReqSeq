// The input of the open buffers is saved before a write command runs (`catalog-commands.ts`, and the app actions
// that run one, `saved-file-actions.ts`).
import type { ActionContext } from "./action-types.js";
import type { Buffer } from "./buffers.js";

/**
 * Saves the input of every open buffer before a write command runs, so the command neither loses it nor
 * takes its own write for a change on disk; resolves the first buffer whose input could not be saved.
 * Without `saveDraft` nothing is saved, as before autosave.
 */
export const unsavedBefore = async (context: ActionContext): Promise<Buffer | undefined> => {
  const { saveDraft } = context;
  if (saveDraft !== undefined) {
    // The shown buffer last, as a workspace switch saves (`switch.ts`): a failure before it leaves the
    // shown editor as it is.
    for (const buffer of [...context.buffers.slice(1), ...context.buffers.slice(0, 1)]) {
      if (context.drafted(buffer.key) && !(await saveDraft(buffer.key))) {
        return buffer;
      }
    }
  }
  return undefined;
};
