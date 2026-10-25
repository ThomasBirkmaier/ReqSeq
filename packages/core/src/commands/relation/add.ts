// relation.add (enabler #264; SR-005, SR-021, SR-041, SR-067 AK3, SR-086, SR-102): adds one
// relation to the source file (model/relation-write.ts). When a relation with the meaning
// derivation closes a cycle, the relation is written and the cycle comes back as `trace.cycle`
// hints, one per element with its line (SR-067 AK3: "zeigt das Tool einen Hinweis"; SR-090).
import type { CommandOutput, Problem } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { AddedRelation } from "../../model/index.js";
import { addRelation, elementStoreState, locateFindings, shortIdState } from "../../model/index.js";
import { metamodelState } from "../../metamodel/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import { closedCycle, cycleFindings, upwardGraph } from "../../trace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/**
 * The hints on the cycle of derivations that the relation closes, read on the element store after
 * the write (the walk up from its target, `closedCycle`, on `upwardGraph`: no incoming index of the
 * whole store); none for a relation of another meaning.
 */
const cycleProblems = async (workspace: Workspace, added: AddedRelation): Promise<readonly Problem[]> => {
  if (added.kind.meaning !== "derivation") {
    return [];
  }
  const layout = await workspace.get(workspaceLayoutState);
  const graph = upwardGraph(
    {
      layout,
      metamodel: await workspace.get(metamodelState),
      store: await workspace.get(elementStoreState),
    },
    "relation.add",
  );
  const cycles = added.sources.flatMap((child) => closedCycle(graph, child, added.kind.key, added.index));
  const shortIds = await workspace.get(shortIdState);
  return locateFindings(
    layout,
    cycles.flatMap((cycle) => cycleFindings(graph, shortIds, cycle)),
  );
};

export default defineCommand({
  name: "relation.add",
  run: async (ctx, input): Promise<CommandOutput<"relation.add">> => {
    const added = await addRelation(ctx.workspace, input);
    return { files: [...added.files], problems: [...(await cycleProblems(ctx.workspace, added))] };
  },
});
