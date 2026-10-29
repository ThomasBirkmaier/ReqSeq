// The UUID test of the model block, in a module of its own so that `elements.ts`, `references.ts`
// (which `elements.ts` imports) and the model cache share it.
import { fileSchemaValidator } from "../runtime/contracts.js";

/** A UUID as ReqSeq writes it: version 4, lower case (`common.schema.json#/$defs/uuid`, D-017). */
export const isUuid = (value: unknown): value is string =>
  fileSchemaValidator("common.schema.json#/$defs/uuid")(value);

/** A UUID version 4 in any case (`common.schema.json#/$defs/uuidRef`). */
const ANY_CASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A short ID in any case: prefix, dash, hex digits (`common.schema.json#/$defs/shortId`). */
const ANY_CASE_SHORT_ID = /^[a-z][a-z0-9]*-[0-9a-f]{6,32}$/i;

/** Whether `ref` has the form of a short ID, in any case: prefix, dash, 6 to 32 hex digits. */
export const isShortIdForm = (ref: string): boolean => ANY_CASE_SHORT_ID.test(ref);

/**
 * A reference as ReqSeq writes it (#309, spec question #316): a UUID in lower case, a short ID with
 * its prefix in upper case and its digits in lower case (`sr-5A8B25` -> `SR-5a8b25`). Prefixes are
 * upper case by schema and hex digits have no case, so no two elements differ only in case. Any other
 * text is returned as it is.
 */
export const normalizeRef = (ref: string): string => {
  if (ANY_CASE_UUID.test(ref)) {
    return ref.toLowerCase();
  }
  if (!isShortIdForm(ref)) {
    return ref;
  }
  const dash = ref.indexOf("-");
  return `${ref.slice(0, dash).toUpperCase()}${ref.slice(dash).toLowerCase()}`;
};
