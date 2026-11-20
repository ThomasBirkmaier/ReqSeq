// metamodel.get (SR-012, SR-013): the metamodel of the checked-out state as the tool uses it
// (`metamodel/output.ts`), with the uses of each definition (SR-236 AK8, `model/metamodel-uses.ts`).
// `countedElements` gives the elements each number of `uses` counts, by the entry its key names
// (SR-224 AK4, `usingElements`): elements of the store, in no view, so none is missing.
import { defineCommand } from "../../catalog.js";
import { metamodelOutput, metamodelState } from "../../metamodel/index.js";
import type { UseList } from "../../model/index.js";
import { elementStoreState, metamodelUsesState, usingElements } from "../../model/index.js";
import { counted, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "metamodel.get",
  answer: (output) =>
    sentence(
      `The metamodel has ${counted(output.types.length, "type")}, ${counted(output.properties.length, "property", "properties")}, ${counted(output.relations.length, "relation kind")} and ${counted(output.statuses.length, "status", "statuses")}`,
      problemsNote(output.problems),
    ),
  run: async (ctx) => ({
    ...(await metamodelOutput(ctx.workspace)),
    uses: await ctx.workspace.get(metamodelUsesState),
  }),
  countedElements: async ({ workspace }, _input, count) => {
    // The catalog marks only the numbers `uses.<list>[].count`, and `invoke` checked `count` against it.
    const list = count.field.slice("uses.".length, -"[].count".length) as UseList;
    const [key = {}] = count.key;
    const elements = usingElements(
      await workspace.get(elementStoreState),
      await workspace.get(metamodelState),
      await workspace.get(metamodelUsesState),
      list,
      key,
    );
    return { elements, incomplete: false };
  },
});
