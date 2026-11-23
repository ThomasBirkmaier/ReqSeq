// An element as every display names it (ADR-0019 point 4): what a row needs to show it and where it leads
// (point 5: a target by UUID and repository, never a URL).
import type { MetamodelGetOutput } from "../generated/types.js";

/** Where a row leads: an element by its UUID and the repository of the copy. */
export interface ElementTarget {
  readonly id: string;
  readonly repository: string;
}

/** An element as a row shows it. */
export interface ElementRef extends ElementTarget {
  /** The key of its type: the app opens a package page in its own way. */
  readonly type: string;
  readonly shortId: string;
  readonly identifier?: string | undefined;
  readonly title: string;
  readonly status?: string | undefined;
  /** Its status is marked invalid (D-044): the HTML export gives it no page (SR-232 AK6). */
  readonly invalid: boolean;
  /** The file of the element in its repository, where the output gives it: two copies of a UUID differ in it (SR-088). */
  readonly file?: string | undefined;
}

/** The keys of the statuses `metamodel.get` marks invalid. */
export const invalidStatusKeys = (metamodel: {
  readonly statuses: readonly Pick<MetamodelGetOutput["statuses"][number], "key" | "invalid">[];
}): ReadonlySet<string> => new Set(metamodel.statuses.filter((s) => s.invalid === true).map((s) => s.key));

/** The reference of `element`, as a command output names it. */
export const elementRef = (
  element: ElementTarget & Pick<ElementRef, "type" | "shortId" | "identifier" | "title" | "status" | "file">,
  invalid: ReadonlySet<string>,
): ElementRef => ({
  id: element.id,
  repository: element.repository,
  type: element.type,
  shortId: element.shortId,
  ...(element.identifier === undefined ? {} : { identifier: element.identifier }),
  title: element.title,
  ...(element.status === undefined ? {} : { status: element.status }),
  invalid: element.status !== undefined && invalid.has(element.status),
  ...(element.file === undefined ? {} : { file: element.file }),
});
