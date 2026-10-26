// Whether a value is a version (ADR-0005) as the schema defines it (`common.schema.json#/$defs/version`):
// one check for every place that reads a stored or given version.
import { fileSchemaValidator } from "../runtime/contracts.js";

/** Whether `value` is a version of any normal form (`n<k>:<16 hex>`). */
export const isVersion = (value: unknown): value is string =>
  fileSchemaValidator("common.schema.json#/$defs/version")(value);

/** A version of normal form 1 (ADR-0005); any other stored value is not compared (SR-085 reports it on a relation). */
export const isN1Version = (value: unknown): value is string => isVersion(value) && value.startsWith("n1:");

/**
 * Whether a link is outdated (SR-025): it stores a version of normal form 1, its target has a
 * current version, and the two differ. The one rule of the hints and of `trace.neighbourhood`.
 */
export const isOutdatedVersion = (stored: unknown, current: string | undefined): boolean =>
  isN1Version(stored) && current !== undefined && current !== stored;
