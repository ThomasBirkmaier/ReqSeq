// A list item that must be there. The compiler counts every index as possibly out of range
// (`noUncheckedIndexedAccess`); where the index comes from the same data, an item that is missing is a
// bug and fails loudly.

/** The item at `index` of `list`. */
export const nth = <T>(list: readonly T[], index: number): T => {
  const found = list.at(index);
  if (found === undefined) {
    throw new RangeError(`There is no item at ${String(index)}`);
  }
  return found;
};
