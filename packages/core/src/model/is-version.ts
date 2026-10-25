// Whether a value is a version (ADR-0005) as the schema defines it (`common.schema.json#/$defs/version`):
// one check for every place that reads a stored or given version.
import { fileSchemaValidator } from "../runtime/contracts.js";

/** Whether `value` is a version of any normal form (`n<k>:<16 hex>`). */
export const isVersion = (value: unknown): value is string =>
  fileSchemaValidator("common.schema.json#/$defs/version")(value);
