// evidence.coverage (SR-036, SR-101 AK1): the coverage of a selection by children and evidence per
// level (evidence/coverage.ts), with the UUIDs behind every number (AK2). The selection is the one of
// `element.list` (query/selection.ts); without a selected view it is counted in the core (AK5).
// `incomplete` (AK3, SR-006 AK2): a repository of the workspace
// file is not on this machine, so children, elements or evidence locations there are not seen, or a
// condition of the selection met such a target. `names` names every element the levels list (ThomasBirkmaier/ReqSeq-archive#588),
// from the selection's records (nothing more is read). Nothing is written. `countedElements` gives the
// records behind `levels[].total`, `withoutChildren`, `withoutEvidence`, `withChildren` and `withEvidence`
// (SR-224 AK4, SR-036 AK6) from the same level
// computation (`coverageRecordsOf`), so a number and its list agree also for SR-088 duplicates.
import type { CommandContext, CommandInput, CommandOutput, OutputCount } from "../../catalog.js";
import { defineCommand, matchesKey } from "../../catalog.js";
import type { CoverageRecordLevel } from "../../evidence/index.js";
import {
  coverageOf,
  coverageRecordsOf,
  coverageRules,
  evidenceIndexState,
  evidenceReadState,
} from "../../evidence/index.js";
import { namesField, namesOfRecords } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";
import { derivationGraph, traceContext } from "../../trace/index.js";
import type { View } from "../../variants/index.js";
import { viewsInclude } from "../../variants/index.js";
import { counted, incompleteNote, listed, sentence } from "../answer.js";

const CORE: View = Object.freeze({ kind: "core" });
const COMMAND = "evidence.coverage";

/** The selection of `input`, the rules of its coverage and whether evidence locations were not all read. */
const coverageInput = async (ctx: CommandContext, input: CommandInput<"evidence.coverage">) => {
  const graph = derivationGraph(await traceContext(ctx.workspace), COMMAND);
  const selected = await resolveSelection(ctx, input.selection ?? {}, COMMAND);
  const index = await ctx.workspace.get(evidenceIndexState);
  const read = await ctx.workspace.get(evidenceReadState);
  const [first = CORE, ...more] = selected.views;
  const views: [View, ...View[]] = [first, ...more];
  const includes = viewsInclude({ workspace: ctx.workspace, ...selected }, views);
  return {
    selected,
    rules: coverageRules(graph, index, views, includes),
    incomplete: selected.incomplete || read.incomplete,
  };
};

/** The records a number of a level counts, by its field (`levels[].total` and the like). */
const levelRecords = (level: CoverageRecordLevel, field: string) => {
  switch (field) {
    case "levels[].withoutChildren":
      return level.withoutChildren;
    case "levels[].withoutEvidence":
      return level.withoutEvidence;
    case "levels[].withChildren":
      return level.withChildren;
    case "levels[].withEvidence":
      return level.withEvidence;
    case "levels[].total":
      return [...level.withChildren, ...level.withoutChildren];
    default:
      // `invoke` checks the field against the catalog; a number of the schema without its case lists nothing,
      // which the count test of `element.list` (list-count.test.ts) shows.
      return [];
  }
};

export default defineCommand({
  name: "evidence.coverage",
  answer: (output, _input, names) =>
    sentence(
      output.levels.length === 0
        ? "The selection has no need or requirement"
        : `Coverage: ${listed(
            output.levels.map(
              (level) =>
                `${String(level.withChildren)} of ${counted(level.total, `${names.type(level.type)} element`)} with children${level.withEvidence === undefined ? "" : ` and ${String(level.withEvidence)} with evidence`}`,
            ),
          )}`,
      incompleteNote(output.incomplete),
    ),
  run: async (ctx, input): Promise<CommandOutput<"evidence.coverage">> => {
    const { selected, rules, incomplete } = await coverageInput(ctx, input);
    const levels = coverageOf(selected.elements, rules);
    const listed = new Set(
      levels.flatMap((level) => [...level.elements.withChildren, ...level.elements.withoutChildren]),
    );
    return {
      levels,
      incomplete,
      ...namesField(
        namesOfRecords(
          selected,
          selected.elements.filter((element) => listed.has(element.id)),
        ),
      ),
    };
  },
  countedElements: async (ctx, input, count: OutputCount) => {
    const { selected, rules, incomplete } = await coverageInput(ctx, input);
    // `invoke` checked the count: one key, for the list of levels.
    const key = { ...count.key[0] };
    const level = coverageRecordsOf(selected.elements, rules).find((entry) =>
      matchesKey(entry, key, ["type"]),
    );
    return { elements: level === undefined ? [] : levelRecords(level, count.field), incomplete };
  },
});
