// The display model of the type lines of the app's overview and the HTML export's start page (SR-233 AK3),
// ADR-0019 points 1, 5 and 9(a): one line per type with at least one element and the number of its elements, in the
// order of `element.facets` `types` (the metamodel's types in its order, then a type it does not know in the order its
// first element appears, named by its key), each leading to the list of its type.
//
// The counts follow each side's list (point 9(a)): the app passes `element.facets` `types` of every element; the export
// passes `typeCounts` of the elements its lists hold, which are the elements of `listElements` without an invalid
// status (SR-231 AK1), the same numbers `element.facets` gives for the selection `{ where: { invalid: false } }`,
// except for the copies of a UUID several files share, which get no page and so are not counted.
import type { ElementFacetsOutput, MetamodelGetOutput } from "../generated/types.js";
import { inTypeOrder } from "../type-order.js";

/** A type with its number of elements, as `element.facets` gives it. */
export type TypeCount = ElementFacetsOutput["types"][number];

/** Where a type line leads: the list of the elements of exactly that type, by its key (point 5: no URL). */
export interface ListTarget {
  readonly list: string;
}

/** A type line: "System Requirement 117". */
export interface TypeLineDisplay extends TypeCount {
  readonly target: ListTarget;
}

export interface OverviewDisplay {
  readonly types: readonly TypeLineDisplay[];
}

/** What the model is built from: `element.facets` `types`, or for the export `typeCounts` of its listed elements. */
export interface OverviewInput {
  readonly types: readonly TypeCount[];
}

/**
 * The number of `elements` of each type, as `element.facets` counts the types of a selection: exactly the type
 * written, with its name, in the order of `inTypeOrder` (unknown keys as they first appear, named by the key). One
 * pass over `elements`.
 */
export const typeCounts = (
  elements: readonly { readonly type: string }[],
  metamodel: { readonly types: readonly Pick<MetamodelGetOutput["types"][number], "key" | "name">[] },
): readonly TypeCount[] => {
  const counts = new Map<string, number>();
  for (const { type } of elements) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const names = new Map(metamodel.types.map((type) => [type.key, type.name]));
  return inTypeOrder(
    [...counts].map(([key, count]) => ({ key, name: names.get(key) ?? key, count })),
    (type) => type.key,
    metamodel.types,
  );
};

/** The type lines of the overview and the start page (see the file comment). */
export const overviewDisplay = (input: OverviewInput): OverviewDisplay => ({
  types: input.types.map(({ key, name, count }) => ({ key, name, count, target: { list: key } })),
});
