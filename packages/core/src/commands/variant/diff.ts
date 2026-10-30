// variant.diff (SR-044, SR-041 AK8, SR-042 AK5, D-020): what a variant adds, replaces and excludes
// compared to the core, read from the view rule of the variant (variants/view-rule.ts), so the lists
// and the view agree. Nothing is written.
//
// - The variant must be an element whose type has the meaning `variant` (`not-a-variant`); the
//   command needs the meanings `validity` and `variant` (SR-013 AK3).
// - `added`: the requirements whose validity names the variant and that replace no core requirement
//   in it (AK1), so also the source of a replaces onto an element that is no core requirement (SR-041
//   AK8) and the source of a replaces onto a core requirement the variant excludes (SR-042 AK5).
// - `replaced`: one row per core requirement and replacement, with both UUIDs (AK3); an excluded core
//   requirement is only in `excluded` (exclusion wins, SR-042 AK5).
// - `problems`: the `variant.target-not-core` hints (at their lines) of the variant's own exclusion
//   entries and of the replacement entries of requirements valid in it.
// - `names` names every element the lists give, each once, in order first named (#588).
// - `incomplete` (SR-006 AK2): a repository of the workspace file is not on this machine.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { metamodelState, requireMeaning } from "../../metamodel/index.js";
import {
  elementStoreState,
  namesField,
  namesOfRecords,
  resolveRef,
  shortIdState,
} from "../../model/index.js";
import {
  appliesIn,
  targetNotCoreProblemsState,
  validityOf,
  variantTypes,
  viewRuleIndexOf,
  viewRuleIn,
} from "../../variants/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

const key = (repository?: string, id?: string): string => [repository, id].join("\0");

export default defineCommand({
  name: "variant.diff",
  run: async (ctx, input): Promise<CommandOutput<"variant.diff">> => {
    const command = "variant.diff";
    const metamodel = await ctx.workspace.get(metamodelState);
    const store = await ctx.workspace.get(elementStoreState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const layout = await ctx.workspace.get(workspaceLayoutState);
    requireMeaning(metamodel, "validity", command);
    requireMeaning(metamodel, "variant", command);
    const variant = resolveRef(store, shortIds, input.variant);
    if (!variantTypes(metamodel).has(variant.type)) {
      throw new CommandError(
        "input.invalid",
        `${input.variant} is no variant: ${command} takes an element whose type has the meaning variant`,
        { command, fields: ["variant"], ref: input.variant, reason: "not-a-variant" },
      );
    }
    const view = { kind: "variant", variant } as const;
    const index = viewRuleIndexOf(ctx.workspace, store, metamodel);
    const rule = viewRuleIn(index, view);
    const added = rule.addedOf();
    const replaced = rule.replacedOf();
    const excluded = rule.excludedOf();
    const validity = validityOf(metamodel);
    const sources = new Set(
      index.items
        .filter((item) =>
          item.meaning === "exclusion" ? item.source === variant : appliesIn(validity, item.source, view),
        )
        .map((item) => key(item.source.repository, item.source.id)),
    );
    const problems = (await ctx.workspace.get(targetNotCoreProblemsState)).filter((p) =>
      sources.has(key(p.repository, p.elementId)),
    );
    const names = namesOfRecords({ metamodel, store, shortIds }, [
      ...added,
      ...replaced.flatMap((row) => [row.core, row.replacement]),
      ...excluded,
    ]);
    return {
      added: added.map((e) => e.id),
      replaced: replaced.map((row) => ({ core: row.core.id, replacement: row.replacement.id })),
      excluded: excluded.map((e) => e.id),
      ...namesField(names),
      ...(problems.length === 0 ? {} : { problems }),
      incomplete: layout.repositories.some((r) => !r.available),
    };
  },
});
