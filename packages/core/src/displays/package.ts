// The display model of the elements of a package on its page (SR-233 AK4; the app's package page), ADR-0019
// points 1, 2, 7, 8 and 9(a): per element its identifier, title, status and verification status, by the same rule as
// `element.list` with `where.package` (D-040), on top of the rows of the list display (`ListRowInput`, `rowId`,
// `rowCell`).
//
// - Members (`packageMembers`): the elements whose property with the meaning `packages` names the package, in the
//   repository the entry names or in the element's own (D-058), as the condition `package` reads them; read from the
//   relations of `element.list` (`property: true`, `direction: out`, `repository` as the output resolves it). An
//   element in several packages stands in each; nested packages are members like any other element. One pass over the
//   rows, for all packages at once (N-036): the export, which calls no command, takes its members from it; the app
//   asks `element.list` `where.package` for one package.
// - Rows: in the order given (the caller's identifier order, ADR-0019 point 3). Option `invalid` (point 9(a)):
//   `omit` drops an element whose status the metamodel marks invalid, as the export's pages hold none (SR-231 AK1);
//   `keep` shows it, marked by `ref.invalid`.
// - Cells: the identifier (option `id`, as `listDisplay`), the title, the status (`EMPTY_VALUE` without one) and the
//   verification status in the row's view, the status alone; `EMPTY_VALUE` for an element that is no requirement and
//   for a requirement outside that view (SR-137 AK4, as the lists).
import type { ElementTarget } from "./element-ref.js";
import { elementRef, invalidStatusKeys } from "./element-ref.js";
import { EMPTY_VALUE } from "./labels.js";
import type {
  ListCell,
  ListColumnDisplay,
  ListMetamodel,
  ListOptions,
  ListRowDisplay,
  ListRowInput,
} from "./list.js";
import { rowCell, rowId } from "./list.js";

/** A row of the package page: an element as `element.list` gives it, with its verification in the page's view. */
export type PackageRowInput = Pick<ListRowInput, "element" | "verification">;

export interface PackageOptions extends Pick<ListOptions<unknown>, "id"> {
  /** `omit` for the export (SR-231 AK1), `keep` for the app. */
  readonly invalid: "omit" | "keep";
}

/** A cell of a member: its identifier, a text, or its verification status (the cells of a list, without hints). */
export type PackageCell = Exclude<ListCell, { readonly kind: "hints" }>;

/** A row of the elements of a package: the element and its cells, in the order of `columns`. */
export interface PackageRowDisplay {
  readonly ref: ListRowDisplay["ref"];
  readonly cells: readonly PackageCell[];
}

export interface PackageDisplay {
  /** The package whose page this is: an element of a type with the meaning package (`isPackageType`). */
  readonly package: ElementTarget;
  readonly columns: readonly ListColumnDisplay[];
  readonly rows: readonly PackageRowDisplay[];
}

/** What the page says when no element names the package. */
export const NO_MEMBERS = "No element names this package.";

/** Whether an element of the type `type` has a package page: its type has the meaning package (`metamodel.get`). */
export const isPackageType = (metamodel: Pick<ListMetamodel, "types">, type: string): boolean =>
  metamodel.types.find((t) => t.key === type)?.meaning === "package";

/** The key of an element target in the maps of this module. */
export const targetKey = (target: ElementTarget): string => `${target.id}\n${target.repository}`;

/** The key of the property with the meaning `packages`, undefined without one. */
const packagesKey = (metamodel: Pick<ListMetamodel, "properties">): string | undefined =>
  metamodel.properties.find((p) => p.meaning === "packages")?.key;

/**
 * The members of each of `packages`, by `targetKey`, each in the order of `rows` and once: the rows whose property
 * with the meaning `packages` names it (see the file comment). One pass over the rows and their relations.
 */
export const packageMembers = <R extends PackageRowInput>(
  packages: readonly ElementTarget[],
  rows: readonly R[],
  metamodel: Pick<ListMetamodel, "properties">,
): ReadonlyMap<string, readonly R[]> => {
  const key = packagesKey(metamodel);
  const members = new Map<string, R[]>(packages.map((target) => [targetKey(target), []]));
  for (const row of rows) {
    const named = new Set<string>();
    for (const relation of row.element.relations) {
      // A stored `repository` that is not text names no repository: the output leaves it out (D-058).
      if (
        relation.property === true &&
        relation.kind === key &&
        relation.direction === "out" &&
        relation.repository !== undefined
      ) {
        named.add(targetKey({ id: relation.id, repository: relation.repository }));
      }
    }
    for (const target of named) {
      members.get(target)?.push(row);
    }
  }
  return members;
};

const COLUMNS: readonly ListColumnDisplay[] = [
  { label: "Identifier" },
  { label: "Title" },
  { label: "Status" },
  { label: "Verification status in the core" },
];

/** The display model of the elements `rows` of the package `target`, in the order given (see the file comment). */
export const packageDisplay = (
  input: {
    readonly package: ElementTarget;
    readonly rows: readonly PackageRowInput[];
    readonly metamodel: Pick<ListMetamodel, "statuses">;
  },
  options: PackageOptions,
): PackageDisplay => {
  const invalid = invalidStatusKeys(input.metamodel);
  const rows = input.rows.flatMap((row): PackageRowDisplay[] => {
    const ref = elementRef(row.element, invalid);
    if (ref.invalid && options.invalid === "omit") {
      return [];
    }
    const cell = rowCell(row);
    const cells: PackageCell[] = [
      { kind: "id", text: rowId(row.element, options.id) },
      { kind: "text", text: row.element.title },
      { kind: "text", text: row.element.status ?? EMPTY_VALUE },
      { kind: "verification", cell, text: cell === undefined ? EMPTY_VALUE : cell.status },
    ];
    return [{ ref, cells }];
  });
  return { package: { id: input.package.id, repository: input.package.repository }, columns: COLUMNS, rows };
};
