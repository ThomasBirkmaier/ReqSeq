// Whether a value is a version (ADR-0005) as the schema defines it (`common.schema.json#/$defs/version`):
// one check for every place that reads a stored or given version.
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { VersionForms } from "../version/version.js";
import { formOf, sameVersion } from "../version/version.js";

/** Whether `value` is a version of any normal form (`n<k>:<16 hex>`). */
export const isVersion = (value: unknown): value is string =>
  fileSchemaValidator("common.schema.json#/$defs/version")(value);

/**
 * A version of a normal form this tool computes (n1, n2; ADR-0005); any other stored value is not
 * compared (SR-085 reports it on a relation).
 */
export const isKnownVersion = (value: unknown): value is string =>
  isVersion(value) && formOf(value) !== undefined;

/**
 * Whether a link is outdated (SR-025): it stores a version of a normal form this tool computes, its
 * target has a current version, and the two differ, compared in the stored version's form
 * (`sameVersion`). The one rule of the hints and of `trace.neighbourhood`.
 */
export const isOutdatedVersion = (stored: unknown, current: VersionForms | undefined): boolean =>
  isKnownVersion(stored) && current !== undefined && !sameVersion(stored, current);
