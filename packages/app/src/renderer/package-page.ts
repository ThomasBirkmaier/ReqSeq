// The package page (SR-112, D-062): an element whose type has the meaning `package` shows below its
// title and text the elements that name it. This module only builds the input of `element.list`
// (`where.package`) and tells which types are packages; core selects and sorts (ADR-0002). The rule
// "which types are packages" is the one of core: the effective `meaning` of the type in `metamodel.get`.
import type { ElementSelection, MetamodelGetOutput } from "@reqseq/core";
import type { ElementBuffer, ListBuffer } from "./buffers.js";
import { sortLabel } from "./buffers.js";
import type { BufferData } from "./modeline.js";
import { INCOMPLETE } from "./modeline.js";

export interface PackageModel {
  /** The keys of the types with the meaning `package`, inherited meanings included. */
  readonly types: ReadonlySet<string>;
  /** The key of the property that names the packages of an element (the meaning `packages`). */
  readonly key: string;
}

/** The package model of the metamodel; undefined when it has no package type or no such property. */
export const packageModel = (
  metamodel: Pick<MetamodelGetOutput, "types" | "meanings">,
): PackageModel | undefined => {
  const types = new Set(metamodel.types.filter((type) => type.meaning === "package").map((type) => type.key));
  const key = metamodel.meanings["packages"]?.[0];
  return types.size === 0 || key === undefined ? undefined : { types, key };
};

/** The model when `type` is a package type, else undefined: the element of this type has a package page. */
export const packageOf = (model: PackageModel | undefined, type: string): PackageModel | undefined =>
  model?.types.has(type) === true ? model : undefined;

/** The selection of the elements that name the package with this UUID (D-040). */
export const packageSelection = (id: string): ElementSelection => ({ where: { package: id } });

/**
 * The list buffer the members of a package are shown with. It has the key of the element buffer, so the
 * row that the list reports lands on the element buffer. `selection` is passed in, and kept the same
 * object by the caller, because the list asks again whenever its selection is another object.
 */
export const memberList = (buffer: ElementBuffer, selection: ElementSelection): ListBuffer => ({
  kind: "list",
  key: buffer.key,
  label: `package: ${buffer.name}`,
  steps: [],
  selection,
  ...(buffer.memberSort === undefined ? {} : { sort: buffer.memberSort }),
  cursor: buffer.memberCursor ?? 0,
});

/** How many elements the page found, and whether a repository was missing for the answer. */
export interface MemberCount {
  readonly total: number;
  readonly incomplete: boolean;
}

/** What the list of the elements reports (`BufferData`) as the count of the heading. */
export const memberCount = (data: BufferData | undefined): MemberCount | undefined =>
  data?.kind === "list" ? { total: data.total, incomplete: data.incomplete } : undefined;

/** The muted part of the heading: "37", "37 · tree", "37 · incomplete: a repository is missing · sorted by title". */
export const memberSummary = (count: MemberCount, sort: ElementBuffer["memberSort"]): string =>
  `${String(count.total)}${count.incomplete ? ` · ${INCOMPLETE}` : ""}${sortLabel(sort)}`;
