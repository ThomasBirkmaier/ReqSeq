// The prompt of "Fold status in lists" (SR-201 AK2): every status of the metamodel (`metamodel.get`), the
// folded ones marked; choosing one folds it in every list, or puts its elements back in place.
import type { ActionContext, Choice, FoldControls, Prompt, PromptFill } from "./actions.js";
import type { FoldStatus } from "./fold-statuses.js";
import { foldedKeys, toggledChoice } from "./fold-statuses.js";

export const foldPrompt = (context: ActionContext, folds: FoldControls): Prompt => ({
  label: "Fold status",
  items: [],
  fill: context.call("metamodel.get", {}).then((read): PromptFill => {
    if (!read.ok) {
      context.echo(read.message);
      return { items: [] };
    }
    const statuses: readonly FoldStatus[] = read.output.statuses;
    const folded = foldedKeys(folds.choice, statuses);
    return {
      items: statuses.map((status): Choice => ({
        id: `status:${status.key}`,
        name: status.name,
        ...(folded.includes(status.key) ? { hint: "folded" } : {}),
        run: () => {
          folds.choose(toggledChoice(folds.choice, statuses, status.key));
          context.echo(
            folded.includes(status.key)
              ? `${status.name} stays in place in lists`
              : `${status.name} folds to the end of lists`,
          );
        },
      })),
    };
  }),
});
