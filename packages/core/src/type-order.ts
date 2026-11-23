// The order of types wherever types are listed with their elements (`element.facets` `types`; the type
// lines and lists of the HTML export, SR-233 AK1, AK3): the types of the metamodel in its order, then a key it does not
// know in the order the input gives it. A root module that imports nothing, like `hint-order.ts`, so `query/`, the
// display models (`displays/`, ADR-0019 point 3) and the HTML export use the same rule.

/** `items` by the position of `keyOf(item)` among `types`, an unknown key after them; stable, so unknown keys keep their order. */
export const inTypeOrder = <T>(
  items: Iterable<T>,
  keyOf: (item: T) => string,
  types: readonly { readonly key: string }[],
): T[] => {
  const position = new Map(types.map((type, index) => [type.key, index]));
  const rank = (item: T): number => position.get(keyOf(item)) ?? position.size;
  return [...items].sort((a, b) => rank(a) - rank(b));
};
