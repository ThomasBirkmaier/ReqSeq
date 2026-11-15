// The steps of a list filter (SR-124) and the prompts that choose them. A step only says what it adds to
// the selection of `element.list`; the core filters (ADR-0002). Which values a property has in the shown
// list comes from `element.facets`: the app shows them and builds the step, it counts nothing.
import type { ElementFacetsOutput } from "@reqseq/core";
import type { FilterStep } from "./buffers.js";
import { shownIdTitle } from "./id-title.js";

export type Facet = ElementFacetsOutput["properties"][number];
export type FacetValue = NonNullable<Facet["values"]>[number];

/** The step for a type; its label is the text before the name in the list's label ("type: need"). */
export const typeStep = (key: string): FilterStep => ({
  label: `type: ${key}`,
  selection: { where: { type: [key] } },
});

/**
 * The step of a type line of the overview (SR-118 AK2): the elements of exactly this type, as the count of
 * the line counts them (`element.facets`), without the elements of its subtypes. "Filter list" keeps
 * `typeStep`, which takes the subtypes along. With the name of the type, the heading of the list says
 * it („System Requirement“, SR-148); the label, and so the name of the buffer, stays "type: <key>".
 */
export const exactTypeStep = (key: string, name?: string): FilterStep => ({
  label: `type: ${key}`,
  ...(name === undefined ? {} : { heading: name }),
  selection: { where: { type: [key], subtypes: false } },
});

export const statusStep = (key: string): FilterStep => ({
  label: `status: ${key}`,
  selection: { where: { status: [key] } },
});

export const savedStep = (name: string): FilterStep => ({
  label: `filter: ${name}`,
  selection: { filter: name },
});

/** Narrows the list by the SR-068 search of the text within it. */
export const textStep = (query: string): FilterStep => ({
  label: `text: ${query}`,
  selection: { where: { text: query } },
});

/** `shown` is the text after the property in the label; `value` what the condition takes with `eq`. */
export const propertyStep = (key: string, shown: string, value: string | number | boolean): FilterStep => ({
  label: `${key}: ${shown}`,
  selection: { where: { property: key, op: "eq", value } },
});

export const missingStep = (key: string): FilterStep => ({
  label: `${key}: (no value)`,
  selection: { where: { property: key, op: "missing" } },
});

/** Whether a step of the chain is a saved filter: a selection takes one (SR-101). */
export const hasSavedFilter = (steps: readonly FilterStep[]): boolean =>
  steps.some((step) => step.selection.filter !== undefined);

/** What a value of a property is called in the prompt: a relation target by short ID with identifier and title. */
export const valueName = (facet: Facet, value: FacetValue): string =>
  facet.kind === "relation"
    ? shownIdTitle(String(value.value), value.identifier, value.title)
    : String(value.value);

/**
 * The step that keeps the elements with this value of the property (`eq`), labelled with the title of a
 * relation target or the value itself. "Filter list" (SR-124) and the list of the elements with a
 * value (SR-132) build the same step.
 */
export const facetValueStep = (facet: Facet, value: FacetValue): FilterStep =>
  propertyStep(facet.key, value.title ?? String(value.value), value.value);

/** A property whose values can be chosen, with them. */
export interface Choosable {
  readonly facet: Facet;
  readonly values: readonly FacetValue[];
}

/**
 * The properties of the elements `facets` describes whose values can be chosen, in the order the core
 * gives: free text and a property without values among these elements are left out (SR-124 AK3). "Filter
 * list" and "Group by" offer the same ones, the rule `group` of `element.list` accepts (SR-149 AK4).
 */
export const choosableProperties = (facets: ElementFacetsOutput): Choosable[] =>
  facets.properties.flatMap((facet) =>
    facet.values === undefined || facet.values.length === 0 ? [] : [{ facet, values: facet.values }],
  );
