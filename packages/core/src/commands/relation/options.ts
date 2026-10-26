// relation.options (SR-067 AK1, AK2; SR-012, SR-086): the relation kinds the metamodel allows from
// an element, each with the types its target may have, by the rule `relation.add` sets them with
// (`relationOptions`, metamodel/relation-options.ts). The target is searched with `element.search`
// and `selection.where: { type: targetTypes }` (AK2): the search shows only elements of allowed
// target types, and every access gives the same result because both are catalog commands.
//
// - `kind` keeps only that kind: none when the element's type does not allow it; a key that is no
//   relation kind is `input.invalid`, with the message and details of `relation.add`.
// - What is offered does not depend on whether the element may be written: `relation.add` says that.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { metamodelState, relationKindFor, relationOptions } from "../../metamodel/index.js";
import { elementStoreState, resolveRef, shortIdState } from "../../model/index.js";

export default defineCommand({
  name: "relation.options",
  run: async (ctx, input): Promise<CommandOutput<"relation.options">> => {
    const metamodel = await ctx.workspace.get(metamodelState);
    const store = await ctx.workspace.get(elementStoreState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const source = resolveRef(store, shortIds, input.ref);
    const { kind } = input;
    if (kind !== undefined) {
      relationKindFor(metamodel, kind, source.type);
    }
    return {
      kinds: relationOptions(metamodel, source.type)
        .filter((option) => kind === undefined || option.kind.key === kind)
        .map((option) => ({
          kind: option.kind.key,
          name: option.kind.name,
          targetTypes: [...option.targetTypes],
        })),
    };
  },
});
