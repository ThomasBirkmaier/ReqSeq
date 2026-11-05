// Versions in every normal form for tests that give a component one version (ADR-0005 "Normal form 2").
import type { VersionForms } from "../version/version.js";
import { NORMAL_FORM, storedForms } from "../version/version.js";

/** `version` as the current versions of an element: that version in its form, no version in the other. */
export function forms(version: string): VersionForms;
export function forms(version: string | undefined): VersionForms | undefined;
export function forms(version: string | undefined): VersionForms | undefined {
  return version === undefined ? undefined : storedForms(version, undefined);
}

/** The pattern of a version in the form the tool writes (`NORMAL_FORM`), as source for a larger pattern. */
export const WRITTEN_VERSION_SOURCE = `${NORMAL_FORM}:[0-9a-f]{16}`;

/** A version in the form the tool writes (`NORMAL_FORM`). */
export const WRITTEN_VERSION = new RegExp(`^${WRITTEN_VERSION_SOURCE}$`, "u");
