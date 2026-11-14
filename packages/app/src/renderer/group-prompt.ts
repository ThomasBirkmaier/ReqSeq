// The grouping (`group` of "Save perspective", SR-215 AK1, AK5, #1647), offered as a closed list: the
// groupings "Group list" offers (`list-groups.ts`) of the elements the call's earlier `where`, `filter`,
// `perspective` and shown selection select, from one `element.facets`; on a grouped list its grouping first.
import type { CommandTypes } from "@reqseq/core";
import type { ActionContext, Choice } from "./actions.js";
import { listGroup, listing } from "./buffers.js";
import type { Entry, Failed, Offer, Value } from "./catalog-entry.js";
import { failed, listOf } from "./catalog-entry.js";
import { groupings } from "./list-groups.js";

type Selection = NonNullable<CommandTypes["element.facets"]["input"]["selection"]>;
type Condition = NonNullable<Selection["where"]>;

/**
 * The selection whose elements a `group` is offered for (`groupReads` in `catalog-commands.ts`): the shown one (`selection`), the
 * condition (`where`), the saved filter (`filter`, else the shown one's) and the selection of the perspective
 * (`perspective`, from `perspective.list`), all of whose conditions must hold; its saved filter counts only
 * where no other is given, since a selection names one. None without any of them: every element.
 */
const groupSelection = async (
  context: ActionContext,
  reads: Readonly<Record<string, unknown>>,
): Promise<Selection | Failed | undefined> => {
  const { where: shownWhere, filter: shownFilter, ...shown } = (reads["selection"] ?? {}) as Selection;
  let saved: { readonly where?: Condition; readonly filter?: string } | undefined;
  const perspective = reads["perspective"];
  if (typeof perspective === "string") {
    const listed = await context.call("perspective.list", {});
    if (!listed.ok) {
      return { kind: "failed", message: listed.message };
    }
    saved = listed.output.perspectives.find((candidate) => candidate.name === perspective);
  }
  const conditions = [shownWhere, reads["where"] as Condition | undefined, saved?.where].filter(
    (condition) => condition !== undefined,
  );
  const given = reads["filter"];
  const filter = typeof given === "string" ? given : (shownFilter ?? saved?.filter);
  const selection: Selection = {
    ...shown,
    ...(conditions.length === 0
      ? {}
      : { where: conditions.length === 1 ? conditions[0] : { all: conditions } }),
    ...(filter === undefined ? {} : { filter }),
  };
  return Object.keys(selection).length === 0 ? undefined : selection;
};

/**
 * The groupings of the elements the call selects (`groupSelection`), as "Group list" offers them, by name with
 * the key beside: one `element.facets`, which the prompt then narrows as typed (SR-108 AK5).
 */
export const offerGroups = async (
  context: ActionContext,
  reads: Readonly<Record<string, unknown>>,
): Promise<Offer | Failed> => {
  const selection = await groupSelection(context, reads);
  if (failed(selection)) {
    return selection;
  }
  const [facets, metamodel] = await Promise.all([
    context.call("element.facets", selection === undefined ? {} : { selection }),
    context.call("metamodel.get", {}),
  ]);
  const packages = metamodel.ok ? (metamodel.output.meanings["packages"] ?? []) : [];
  return listOf(facets, (output) =>
    groupings(output, packages).map(({ group, name }) => ({ value: group, name, key: group })),
  );
};

/** The first hit of the grouping of "Save perspective" on a grouped list (SR-215 AK5). */
export const SHOWN_GROUP = "Grouping of the shown list";

/**
 * The grouping of the shown list for the grouping of "Save perspective" (SR-215 AK5), the first hit: of a list,
 * not the matrix, the search hits or a package page, the grouping it is shown in, as "Save list as perspective"
 * saves it, by its name among the groupings offered (`values`), else by its key; none for a list without groups.
 */
export const shownGroup = (
  context: ActionContext,
  entry: Entry,
  values: readonly Value[],
  take: (value: unknown, name: string) => Pick<Choice, "run" | "more">,
): Choice[] => {
  const list = context.buffers[0];
  const group = entry.command.name === "perspective.save" && listing(list) ? listGroup(list) : undefined;
  if (group === undefined) {
    return [];
  }
  const name = values.find(({ value }) => value === group)?.name ?? group;
  return [{ id: "shown", name: SHOWN_GROUP, hint: name, ...take(group, name) }];
};
