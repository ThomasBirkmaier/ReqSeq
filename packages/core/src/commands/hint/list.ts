// hint.list (SR-026; lists the hints of SR-040 AK3 and SR-072 AK2, and from stage 5 those of
// SR-045 and SR-103): the open hints of the workspace, filtered by kind, type, package, variant or
// element, each with kind, element, target and reason, and `incomplete` (hints/list.ts). `names`
// names the variants the `view` of an outdated evidence hint on the page gives by UUID only (#2527),
// from the store (nothing more is read).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { listHints } from "../../hints/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState, namesField, namesOf, shortIdState } from "../../model/index.js";
import { incompleteNote, paged, sentence } from "../answer.js";

export default defineCommand({
  name: "hint.list",
  answer: (output) =>
    sentence(
      `Found ${paged(output.hints.length, output.total, "open hint")}`,
      incompleteNote(output.incomplete),
    ),
  run: async (ctx, input): Promise<CommandOutput<"hint.list">> => {
    const found = await listHints(ctx.workspace, input);
    const views = found.hints.flatMap((hint) =>
      hint.view === undefined || hint.view === "core" ? [] : [hint.view],
    );
    if (views.length === 0) {
      return found;
    }
    const [metamodel, store, shortIds] = await Promise.all([
      ctx.workspace.get(metamodelState),
      ctx.workspace.get(elementStoreState),
      ctx.workspace.get(shortIdState),
    ]);
    return { ...found, ...namesField(namesOf({ metamodel, store, shortIds }, views)) };
  },
});
