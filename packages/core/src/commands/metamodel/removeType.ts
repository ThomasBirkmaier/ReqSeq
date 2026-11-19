// metamodel.removeType (SR-237 AK5, frame SR-236): removes a type that nothing uses or names, with
// the definitions only it had, from the files they are in (SR-236 AK3, AK4). No element and no
// element file changes (D-045): an element of the type, in any status, refuses the command.
//
// - Refused, with every reason at once: a type that extends it, a relation kind that names it in
//   `source-types`, `target-types` or a limit, a property that names it in `target-types`, and the
//   elements of the type (SR-236 AK7).
// - Dropped with it (SR-238 AK5, SR-240 AK3): its own properties that no other type lists, and the
//   statuses it has that no other type has, except the initial status. A type without a status list
//   has every status, so a status is dropped only while every other type has a list without it.
// - Saved filters, perspectives and mapping files that name a removed key are listed, not changed.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { removeListItem } from "../../files/index.js";
import type { DefinitionList, DefinitionPlace, LineEdit, Metamodel } from "../../metamodel/index.js";
import { definitionAt, definitionsOf, editedFiles, findType } from "../../metamodel/index.js";
import {
  mentioningFiles,
  refuseMissingRepositories,
  refuseUses,
  shortIdState,
  useOf,
  writeMetamodel,
} from "../../model/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

const COMMAND = "metamodel.removeType";

/** The definitions that name `type`, in words, in metamodel order (SR-237 AK5). */
const namedBy = (metamodel: Metamodel, type: string): readonly string[] => [
  ...metamodel.types.filter((t) => t.extends === type).map((t) => `type ${t.key} extends it`),
  ...metamodel.relations.flatMap((r) => [
    ...(r["source-types"]?.includes(type) === true ? [`relation kind ${r.key} has it as source type`] : []),
    ...(r["target-types"]?.includes(type) === true ? [`relation kind ${r.key} has it as target type`] : []),
    ...((r.limits ?? []).some((l) => l["source-type"] === type || l["target-type"] === type)
      ? [`relation kind ${r.key} names it in a limit`]
      : []),
  ]),
  ...metamodel.properties
    .filter((p) => p["target-types"]?.includes(type) === true)
    .map((p) => `property ${p.key} has it as target type`),
];

/** The properties and statuses that only `type` has, which go with it (see the file comment). */
const droppedWith = (
  metamodel: Metamodel,
  type: string,
): { readonly properties: readonly string[]; readonly statuses: readonly string[] } => {
  // No type extends it, so what it has and no other type has is its own: inherited ones the parent has.
  const others = metamodel.effectiveTypes.filter((t) => t.key !== type);
  const own = findType(metamodel, type);
  const only = (of: "properties" | "statuses"): ((key: string) => boolean) => {
    const kept = new Set(others.flatMap((t) => t[of]));
    const had = new Set(own?.[of]);
    return (key) => had.has(key) && !kept.has(key);
  };
  const property = only("properties");
  const status = only("statuses");
  return {
    properties: metamodel.properties.map((p) => p.key).filter(property),
    statuses: metamodel.statuses
      .filter((s) => s.initial !== true)
      .map((s) => s.key)
      .filter(status),
  };
};

/** The removals at `places`, each list of a file from its last item up, so positions hold. */
const removals = (
  places: readonly { readonly list: DefinitionList; readonly place: DefinitionPlace }[],
): readonly { readonly file: DefinitionPlace["file"]; readonly edit: LineEdit }[] =>
  [...places]
    // From the last position down: a removal moves only the items after it, of its own list.
    .sort((a, b) => b.place.index - a.place.index)
    .map(({ list, place }) => ({
      file: place.file,
      edit: (yaml) => removeListItem(yaml, place.file.path, [list], place.index),
    }));

export default defineCommand({
  name: COMMAND,
  run: async (ctx, input): Promise<CommandOutput<"metamodel.removeType">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files, store }) => {
      const place = definitionAt(files, "types", input.type);
      if (place === undefined) {
        throw new CommandError(
          "input.invalid",
          `Unknown type ${input.type}: the metamodel has no type with this key`,
          {
            reason: "unknown",
            type: input.type,
          },
        );
      }
      refuseMissingRepositories(layout, COMMAND);
      refuseUses(
        `Type ${input.type} cannot be removed`,
        [useOf(store, shortIds, "type", input.type, (e) => e.type === input.type)],
        namedBy(metamodel, input.type),
      );
      const removed = droppedWith(metamodel, input.type);
      const dropped = (list: DefinitionList, keys: readonly string[]): typeof places =>
        definitionsOf(files, list)
          .filter((p) => keys.includes(p.key as string))
          .map(({ file, index }) => ({ list, place: { file, index } }));
      const places: { readonly list: DefinitionList; readonly place: DefinitionPlace }[] = [
        { list: "types", place },
        ...dropped("properties", removed.properties),
        ...dropped("statuses", removed.statuses),
      ];
      return { bytes: editedFiles(removals(places)), result: removed };
    });
    const keys = new Set([input.type, ...change.result.properties, ...change.result.statuses]);
    return {
      type: input.type,
      removed: { properties: [...change.result.properties], statuses: [...change.result.statuses] },
      mentions: [...(await mentioningFiles(layout, keys))],
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      problems: change.warnings,
    };
  },
});
