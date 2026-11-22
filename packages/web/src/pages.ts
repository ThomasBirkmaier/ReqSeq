// Reading a whole list: commands answer one page at a time (`limit`, `offset`, `total`). The first page tells how
// many there are; the other pages are read at once, in parallel, so a large workspace takes few round trips.

/** The largest page the list commands give. */
export const PAGE = 5000;

/** Every page of a list: `read(offset)` reads the page at `offset`, `count` tells how many items a page holds. */
export async function allPages<T extends { readonly total: number }>(
  read: (offset: number) => Promise<T>,
  count: (page: T) => number,
): Promise<T[]> {
  const first = await read(0);
  const got = count(first);
  if (got === 0 || got >= first.total) {
    return [first];
  }
  const offsets: number[] = [];
  for (let offset = got; offset < first.total; offset += got) {
    offsets.push(offset);
  }
  return [first, ...(await Promise.all(offsets.map(read)))];
}
