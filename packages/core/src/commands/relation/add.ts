// relation.add (enabler ThomasBirkmaier/ReqSeq-archive#264; SR-005, SR-021, SR-041, SR-067 AK3, SR-086, SR-102, SR-152): adds one
// relation to the source file (model/relation-write.ts). When a relation with the meaning
// derivation closes a cycle, the relation is written and the cycle comes back as `trace.cycle`
// hints, one per element with its line (SR-067 AK3: "zeigt das Tool einen Hinweis"; SR-090). A
// stored entry without a valid version gets its current version, said by `relation.version-added`
// before the cycle hints (ThomasBirkmaier/ReqSeq-archive#302). A relation over a maximum of SR-152 is written too, and its
// `relation.too-many` hint comes after `relation.version-added` and before the cycle hints (AK3), on
// a repeat call that writes nothing too (#845). A repeat call on a relation whose target changed since
// it stored its version writes nothing either: its `relation.outdated` (or `variant.core-changed`)
// hint comes back, as hint.list gives it with its `hintId`, and says that hint.confirm stores the
// current version (#1792), so the call never reads as a refresh.
import { isDeepStrictEqual } from "node:util";
import type { CommandOutput, Problem } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { AddedRelation, LocatableFinding } from "../../model/index.js";
import { addRelation, elementStoreState, locateFindings, shortIdState } from "../../model/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { outdatedOfShown } from "../../hints/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import { closedCycle, cycleFindings, upwardGraph } from "../../trace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { filesNote, problemsNote, sentence } from "../answer.js";

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

/**
 * The hint of the relation the source has already when its target changed since it stored its
 * version (#1792); none when the call wrote the relation. Without dates, so no Git runs.
 */
const keptOutdated = async (
  workspace: Workspace,
  added: AddedRelation,
  input: { readonly source: string; readonly target: string },
): Promise<readonly Problem[]> => {
  if (added.files.length > 0) {
    return [];
  }
  const layout = await workspace.get(workspaceLayoutState);
  const context = {
    workspace,
    layout,
    metamodel: await workspace.get(metamodelState),
    store: await workspace.get(elementStoreState),
    shortIds: await workspace.get(shortIdState),
  };
  const path = [added.kind.key, added.index];
  const findings: LocatableFinding[] = [];
  for (const source of added.sources) {
    for (const candidate of await outdatedOfShown(context, source)) {
      if (isDeepStrictEqual(candidate.path, path)) {
        const { problem } = candidate.finding;
        findings.push({
          element: source,
          path,
          problem: {
            ...problem,
            message: `${problem.message}; relation.add keeps the relation it has and writes nothing: hint.confirm with its hintId stores the current version (with ref ${input.source} and target ${input.target} it confirms every outdated hint of ${input.source} that points at ${input.target}, inline references too)`,
          },
        });
      }
    }
  }
  return locateFindings(layout, findings);
};

export default defineCommand({
  name: "relation.add",
  answer: (output, input, names) =>
    sentence(
      output.files.length === 0
        ? `The ${input.kind} relation from ${names.element(input.source)} to ${names.element(input.target)} was there already`
        : `Added a ${input.kind} relation from ${names.element(input.source)} to ${names.element(input.target)}`,
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"relation.add">> => {
    const added = await addRelation(ctx.workspace, input);
    return {
      files: [...added.files],
      problems: [
        ...added.problems,
        ...(await keptOutdated(ctx.workspace, added, input)),
        ...(await cycleProblems(ctx.workspace, added)),
      ],
    };
  },
});
