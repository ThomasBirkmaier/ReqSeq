// element.list (SR-069, SR-101, SR-112 AK1, SR-043 with the validity of SR-040, SR-075, SR-070): the
// elements of a selection (query/selection.ts), sorted (query/sort.ts; without `sort`, by the sort of
// the saved filter the selection names), as list commands give them
// (model/list.ts), one page at a time; `total` counts every match and `incomplete` follows SR-006
// AK2. Only the page is built, so a filter over the 50,000 elements of N-036 reads the files of the
// page only. Sorted by `hierarchy` (SR-075 AK2), the list is the derivation tree depth first and
// `tree` gives the place of each element of the page. Nothing about the order is written (AK3).
// With `group` (SR-149, query/group.ts) the list is the elements of each group in turn, sorted inside
// the group as without it (`orderedGroups`); an element in several groups is a row in each, so the
// page is built from its distinct records and then laid out as rows again. Nothing about the groups
// is written (AK5).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { ElementListInput, ElementListOutput } from "../../generated/types.js";
import type { ElementRecord } from "../../model/index.js";
import { listElements } from "../../model/index.js";
import type { Selected, TreePlace } from "../../query/index.js";
import { groupingOf, orderedGroups, orderedSelection, resolveSelection } from "../../query/index.js";
import type { Workspace } from "../../runtime/workspace.js";

type TreeEntry = NonNullable<ElementListOutput["tree"]>[number];

const named = (element: ElementRecord): { readonly id: string; readonly repository: string } => ({
  id: element.id,
  repository: element.repository,
});

const entryOf = ({ element, depth, parent }: TreePlace): TreeEntry => ({
  ...named(element),
  depth,
  ...(parent === undefined ? {} : { parent: named(parent) }),
});

type Group = NonNullable<ElementListOutput["groups"]>[number];

/** The output of a grouped list (see the file comment). */
const grouped = async (
  workspace: Workspace,
  selected: Selected,
  input: ElementListInput & { readonly group: string; readonly offset: number; readonly limit: number },
): Promise<CommandOutput<"element.list">> => {
  const command = "element.list";
  const { heads, groupsOf } = groupingOf(selected, command, input.group);
  const sorted = orderedGroups(selected, command, input.sort, groupsOf, heads.length);
  const rows: ElementRecord[] = [];
  // Under `hierarchy` every group has its tree, so `places` runs parallel to `rows`.
  const places: TreePlace[] = [];
  const groups: Group[] = [];
  sorted.forEach(({ elements, tree }, index) => {
    if (elements.length > 0) {
      groups.push({ ...heads[index], count: elements.length, offset: rows.length });
      rows.push(...elements);
      places.push(...(tree ?? []));
    }
  });
  const end = input.offset + input.limit;
  const page = rows.slice(input.offset, end);
  // The page's distinct records, and for each row the index of its record among them.
  const indexOf = new Map<ElementRecord, number>();
  const indexes = page.map((record) => {
    const known = indexOf.get(record);
    if (known !== undefined) {
      return known;
    }
    indexOf.set(record, indexOf.size);
    return indexOf.size - 1;
  });
  const listed = await listElements(workspace, selected, [...indexOf.keys()], {
    withText: input.withText === true,
  });
  return {
    // `listElements` gives one element per record, in their order.
    elements: indexes.flatMap((index) => listed.slice(index, index + 1)),
    ...(sorted.some((group) => group.tree !== undefined)
      ? { tree: places.slice(input.offset, end).map(entryOf) }
      : {}),
    groups,
    offset: input.offset,
    rows: rows.length,
    total: selected.elements.length,
    incomplete: selected.incomplete,
  };
};

export default defineCommand({
  name: "element.list",
  run: async (ctx, input): Promise<CommandOutput<"element.list">> => {
    const command = "element.list";
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, command);
    if (input.group !== undefined) {
      return grouped(ctx.workspace, selected, { ...input, group: input.group });
    }
    const sorted = orderedSelection(selected, command, input.sort);
    const end = input.offset + input.limit;
    const page = sorted.elements.slice(input.offset, end);
    const elements = await listElements(ctx.workspace, selected, page, { withText: input.withText === true });
    return {
      elements,
      ...(sorted.tree === undefined ? {} : { tree: sorted.tree.slice(input.offset, end).map(entryOf) }),
      total: selected.elements.length,
      incomplete: selected.incomplete,
    };
  },
});
