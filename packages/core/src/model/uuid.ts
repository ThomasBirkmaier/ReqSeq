// The UUID test of the model block, in a module of its own so that `elements.ts`, `references.ts`
// (which `elements.ts` imports) and the model cache share it.
import { fileSchemaValidator } from "../runtime/contracts.js";

/** A UUID as LogReq writes it: version 4, lower case (`common.schema.json#/$defs/uuid`, D-017). */
export const isUuid = (value: unknown): value is string =>
  fileSchemaValidator("common.schema.json#/$defs/uuid")(value);
