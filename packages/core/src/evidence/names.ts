// The elements that verification entries name by UUID only (#588): the variant of a view other than
// the core and the missing children (SR-034). The commands that give such entries (`evidence.status`,
// `trace.matrix`) name them in `names` (`namesOf` of the model block), so a reader shows short IDs.
import type { DataExportVerificationEntry } from "../generated/types.js";

/** The UUID of the variant of a view (`viewId`), none for the core. */
export const variantIdsOf = (view: string): string[] => (view === "core" ? [] : [view]);

/**
 * The UUIDs that `entries` name: of each entry the variant of its view, then its missing children;
 * each once, in that order.
 */
export const verificationNameIds = (entries: Iterable<DataExportVerificationEntry>): string[] => {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const id of [...variantIdsOf(entry.view), ...(entry.missingChildren ?? [])]) {
      ids.add(id);
    }
  }
  return [...ids];
};
