// The limits of patching the element store and the maps built on it (#215, ADR-0008 file watching),
// in a module of their own so that tests can lower them (`carry-oracle.test.ts`).

/**
 * From this many touched files a change assembles the store anew (one pass over every file) instead
 * of patching it (`patchStore`): a pull or a bulk write, where the patch would cost more than it saves.
 */
export const PATCH_LIMIT = 1_000;

/**
 * From this many overlay entries `PatchedMap.patch` builds a new base for a map of `size` entries
 * (compaction): `max(1,024, size / 16)`, so a long run of patches neither grows the overlay without
 * bound nor copies a large map often.
 */
export const compactAt = (size: number): number => Math.max(1_024, Math.floor(size / 16));

/**
 * From this many lookups through `recordsOf` a patched `byId` of `size` UUIDs gets its plain view
 * (`max(1,024, size / 8)`): a check looks a UUID up once per relation (200,000 at N-036), a carry
 * over one changed file a few times.
 */
export const plainAt = (size: number): number => Math.max(1_024, Math.floor(size / 8));
