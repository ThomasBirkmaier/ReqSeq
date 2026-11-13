// perspective.save (SR-213 AK1, AK3): saves a list with its selection, grouping and sort as a
// perspective with its name, a YAML file in the perspectives folder of the workspace file
// (query/perspectives.ts), so everyone who opens the repository has it (AK2). No view is saved (AK1).
//
// - The input is checked as `element.list` checks it: `where` is compiled (errors name `where...`),
//   `sort` checked against the metamodel, `group` by the rule of `element.list` over the whole
//   workspace (`checkGroupKey`), `filter` must name a saved filter (`input.invalid` at `filter`, or
//   `file.faulty` when only a faulty file holds it). The file gets element references as UUIDs and
//   choices by key (query/canonical.ts), and the filter by its name as saved.
// - Written by `writeSaved` (query/saved-files.ts): a new name gets a new file; an existing name,
//   ignoring case and normal form (AK3), is replaced in its own file, only the top-level keys whose
//   value changed are rewritten and every other byte stays, so comments on unchanged lines stay.
//   Unlike `filter.save`, a `description` the input leaves out stays in the file (AK3); an empty one
//   removes it, and is not written to a new file. `filter`, `group` and `sort` left out are removed.
//   Nothing changed: nothing is written. Refused: a name only a faulty file holds (`file.faulty`), a
//   file changed on disk since it was read (`file.changed-on-disk`), a place in Git (D-036).
// - Perspectives are not elements (D-056); nothing is ever deleted or renamed, no status is touched.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { PerspectiveFile } from "../../generated/types.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState, shortIdState } from "../../model/index.js";
import type { QueryContext } from "../../query/index.js";
import {
  PERSPECTIVES,
  canonicalCondition,
  checkGroupKey,
  compileWhere,
  keyEdits,
  savedFilterFor,
  sortElements,
  writeSaved,
} from "../../query/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/** The keys of a perspective file, in the order a new file has them. */
const KEYS = ["reqseq-perspective", "name", "description", "filter", "where", "group", "sort"] as const;

/** The keys compared when the input leaves out `description`, which then stays (AK3). */
const KEYS_KEEPING_DESCRIPTION = KEYS.filter((key) => key !== "description");

export default defineCommand({
  name: "perspective.save",
  run: async (ctx, input): Promise<CommandOutput<"perspective.save">> => {
    const command = "perspective.save";
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const store = await workspace.get(elementStoreState);
    const shortIds = await workspace.get(shortIdState);
    const context: QueryContext = { workspace, command, layout, metamodel, store, shortIds, view: undefined };
    await compileWhere(context, input.where, "where");
    sortElements(context, [], input.sort ?? []);
    if (input.group !== undefined) {
      checkGroupKey(
        { elements: [], incomplete: false, layout, metamodel, store, shortIds, views: [] },
        command,
        input.group,
      );
    }
    const filter =
      input.filter === undefined
        ? undefined
        : (await savedFilterFor(layout, input.filter, command, "filter")).name;
    const data: PerspectiveFile = {
      "reqseq-perspective": 1,
      name: input.name,
      ...(input.description === undefined || input.description === ""
        ? {}
        : { description: input.description }),
      ...(filter === undefined ? {} : { filter }),
      where: canonicalCondition(context, input.where, "where"),
      ...(input.group === undefined ? {} : { group: input.group }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
    };
    const keys = input.description === undefined ? KEYS_KEEPING_DESCRIPTION : KEYS;
    const files = await writeSaved(layout, PERSPECTIVES, data, (current) => keyEdits(keys, current, data));
    return { files: [...files], problems: [] };
  },
});
