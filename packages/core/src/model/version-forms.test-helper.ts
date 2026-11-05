// Versions in every normal form for tests that give a component one version (ADR-0005 "Normal form 2").
import type { VersionForms } from "../version/version.js";
import { storedForms } from "../version/version.js";

/** `version` as the current versions of an element: that version in its form, no version in the other. */
export function forms(version: string): VersionForms;
export function forms(version: string | undefined): VersionForms | undefined;
export function forms(version: string | undefined): VersionForms | undefined {
  return version === undefined ? undefined : storedForms(version, undefined);
}
