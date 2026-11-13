// The groups of a list (SR-149): how their headings read and which loaded rows stand under each, and what
// the prompt "Group by" offers. The core groups (`element.list` with `group`) and says which properties
// have values to choose (`element.facets`); the app lays out what it gives (ADR-0002).
import type { ElementFacetsOutput, ElementListOutput } from "@reqseq/core";
import type { Choice } from "./actions.js";
import { shownIdTitle } from "./id-title.js";
import { choosableProperties } from "./list-filters.js";

export type ListGroup = NonNullable<ElementListOutput["groups"]>[number];

/**
 * What the heading of a group names: the display name of a type, status or choice, a package or another
 * target by short ID with identifier (SR-084 AK4) and title, else the value as written; "(no value)" for the last group.
 */
export const groupName = (group: ListGroup): string => {
  if (group.value === undefined) {
    return "(no value)";
  }
  const value = String(group.value);
  if (group.title !== undefined || group.identifier !== undefined) {
    return shownIdTitle(value, group.identifier, group.title);
  }
  return group.name ?? value;
};

/** The count of a group, and in the last group of a relation the elements whose targets are not available. */
export const groupCount = (group: ListGroup): string =>
  group.unavailable === undefined
    ? String(group.count)
    : `${String(group.count)} · ${String(group.unavailable)} with targets not available`;

/** One group as the list shows it: its heading and the loaded rows `from` to `to` (exclusive) under it. */
export interface GroupSection {
  readonly group: ListGroup;
  readonly from: number;
  readonly to: number;
}

/**
 * The groups with loaded rows, the first `loaded` rows of the grouped list: each group holds the rows from
 * its `offset` on (`element.list`), so a group of a later page shows once its rows are there.
 */
export const groupSections = (groups: readonly ListGroup[], loaded: number): GroupSection[] =>
  groups.flatMap((group) => {
    const to = Math.min(group.offset + group.count, loaded);
    return group.offset < to ? [{ group, from: group.offset, to }] : [];
  });

/** The groupings every list offers, before the properties. */
const BUILT_IN = [
  { group: "type", name: "Type" },
  { group: "status", name: "Status" },
  { group: "package", name: "Package" },
] as const;

/** One grouping a list can take: its `group` key, its name and, for a property, how many values it has. */
export interface Grouping {
  readonly group: string;
  readonly name: string;
  readonly values?: number;
}

/**
 * The groupings of the elements `facets` describes (SR-149 AK4): type, status and package, then each property
 * of the elements whose values can be chosen (`choosableProperties`, as "Filter by" offers them), but not the
 * property of the packages (`packages`), which "Package" groups by. Without a property of the packages there
 * is no "Package": `element.list` would refuse it (`metamodel.meaning-unassigned`). "Group list" and the
 * `group` of the command prompt offer them (SR-215 AK1).
 */
export const groupings = (facets: ElementFacetsOutput, packages: readonly string[]): Grouping[] => [
  ...BUILT_IN.filter(({ group }) => group !== "package" || packages.length > 0),
  ...choosableProperties(facets).flatMap(({ facet, values }) =>
    packages.includes(facet.key) ? [] : [{ group: facet.key, name: facet.name, values: values.length }],
  ),
];

/** The choices of the prompt "Group by" (`groupings`); `apply` gets the `group` of the one that is taken. */
export const groupChoices = (
  facets: ElementFacetsOutput,
  packages: readonly string[],
  apply: (group: string) => void,
): Choice[] =>
  groupings(facets, packages).map(({ group, name, values }) => ({
    id: values === undefined ? group : `property:${group}`,
    name,
    ...(values === undefined ? {} : { hint: String(values) }),
    run: () => {
      apply(group);
    },
  }));
