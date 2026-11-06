// The package page (SR-112, D-062): an element whose type has the meaning `package` shows below its
// title and text the elements that name it. This module only builds the input of `element.list`
// (`where.package`) and tells which types are packages; core selects and sorts (ADR-0002). The rule
// "which types are packages" is the one of core: the effective `meaning` of the type in `metamodel.get`.
// The line under the title (AK3, AK4) is core's counts with core's formatter (`packageSummaryText`).
import type {
  ElementSelection,
  EvidenceCoverageInput,
  EvidenceCoverageOutput,
  MetamodelGetOutput,
} from "@reqseq/core";
import { packageSummaryText } from "@reqseq/core/verification-degree";
import type { ElementBuffer, FilterStep, ListBuffer, ResultBuffer } from "./buffers.js";
import { resultBuffer, selectionOf, sortLabel } from "./buffers.js";
import type { Call } from "./call.js";
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
 * The selection of the elements of the package with this UUID that meet the filter steps of its page
 * (SR-112 AK2): the package and each step together, as a list ANDs its steps (SR-124).
 */
export const memberSelection = (id: string, steps: readonly FilterStep[]): ElementSelection =>
  steps.length === 0
    ? packageSelection(id)
    : (selectionOf([{ label: "package", selection: packageSelection(id) }, ...steps]) ??
      packageSelection(id));

/** The heading of the elements of a package page: the property, and the filter steps when there are any. */
export const memberHeading = (key: string, steps: readonly FilterStep[] | undefined): string =>
  steps === undefined || steps.length === 0
    ? key
    : [key, ...steps.map((step) => step.heading ?? step.label)].join(" · ");

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

/** What the line under a title counts: a package, or the selection of a list. */
export type SummarySelection = NonNullable<EvidenceCoverageInput["selection"]>;

/** The line under the title of a package page (SR-112 AK3, AK4): undefined when it has none, or the message of a failed call. */
export type PackageSummary =
  | { readonly ok: true; readonly line: string | undefined; readonly coverage: EvidenceCoverageOutput }
  | { readonly ok: false; readonly message: string };

/**
 * Asks `evidence.coverage` and `evidence.degree` for the package with this UUID, side by side, as the CLI,
 * API and MCP do with `selection.package`. No line without a counted requirement (AK4); "incomplete" when a
 * repository was missing for either answer.
 */
export const askPackageSummary = (call: Call, id: string): Promise<PackageSummary> =>
  askSummary(call, { package: id });

/**
 * The same line for any selection (SR-148: a list shows it for the elements it shows): `evidence.coverage`
 * and `evidence.degree` with this selection, side by side.
 */
export const askSummary = async (call: Call, selection: SummarySelection): Promise<PackageSummary> => {
  const [coverage, degree] = await Promise.all([
    call("evidence.coverage", { selection }),
    call("evidence.degree", { selection }),
  ]);
  if (!coverage.ok) {
    return { ok: false, message: coverage.message };
  }
  if (!degree.ok) {
    return { ok: false, message: degree.message };
  }
  const text = packageSummaryText(coverage.output.levels, degree.output.degree);
  const incomplete = coverage.output.incomplete === true || degree.output.incomplete === true;
  return {
    ok: true,
    line: text === undefined || !incomplete ? text : `${text} · ${INCOMPLETE}`,
    coverage: coverage.output,
  };
};

/**
 * The result buffer a click on the line opens (SR-036 AK2): core's `evidence.coverage` of the package, the
 * answer the line was counted from, which lists under every number its requirements, those without children
 * or evidence included. One buffer per package: a
 * second click shows it again.
 */
export const coverageBuffer = (
  id: string,
  name: string,
  coverage: EvidenceCoverageOutput,
  revision: number,
): ResultBuffer => selectionCoverageBuffer({ package: id }, name, coverage, revision);

/** The result buffer of the coverage of any selection, with the answer the line was counted from. */
export const selectionCoverageBuffer = (
  selection: SummarySelection,
  name: string,
  coverage: EvidenceCoverageOutput,
  revision: number,
): ResultBuffer =>
  resultBuffer("evidence.coverage", { selection }, `Show evidence coverage ${name}`, coverage, revision);
