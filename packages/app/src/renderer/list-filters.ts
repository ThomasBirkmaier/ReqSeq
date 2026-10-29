// The steps of a list filter (SR-124) and the prompts that choose them. A step only says what it adds to
// the selection of `element.list`; the core filters (ADR-0002). Which values a property has in the shown
// list comes from `element.facets`: the app shows them and builds the step, it counts nothing.
import type { ElementFacetsOutput } from "@reqseq/core";
import type { Choice, Prompt } from "./actions.js";
import type { FilterStep } from "./buffers.js";

export type Facet = ElementFacetsOutput["properties"][number];
export type FacetValue = NonNullable<Facet["values"]>[number];

/** The step for a type; its label is the text before the name in the list's label ("type: need"). */
export const typeStep = (key: string): FilterStep => ({
  label: `type: ${key}`,
  selection: { where: { type: [key] } },
});

/**
 * The step of a type line of the overview (SR-118 AK2): the elements of exactly this type, as the count of
 * the line counts them (`element.facets`), without the elements of its subtypes. "Filter list by type"
 * keeps `typeStep`, which takes the subtypes along.
 */
export const exactTypeStep = (key: string): FilterStep => ({
  label: `type: ${key}`,
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

/** What a value of a property is called in the prompt: a relation target by identifier or short ID and title. */
export const valueName = (facet: Facet, value: FacetValue): string =>
  facet.kind === "relation"
    ? `${value.identifier ?? String(value.value)} ${value.title ?? ""}`.trim()
    : String(value.value);

/**
 * The step that keeps the elements with this value of the property (`eq`), labelled with the title of a
 * relation target or the value itself. "Filter list by property" (SR-124) and the list of the elements
 * with a value (SR-132) build the same step.
 */
export const facetValueStep = (facet: Facet, value: FacetValue): FilterStep =>
  propertyStep(facet.key, value.title ?? String(value.value), value.value);

/** The prompt for the value of one property: its values with their counts, and no value when some lack it. */
const valuePrompt = (
  facet: Facet,
  values: readonly FacetValue[],
  run: (step: FilterStep) => void,
): Prompt => ({
  label: facet.key,
  items: [
    ...values.map((value) => ({
      id: JSON.stringify(value.value),
      name: valueName(facet, value),
      hint: String(value.count),
      run: () => {
        run(facetValueStep(facet, value));
      },
    })),
    ...(facet.missing > 0
      ? [
          {
            id: "missing",
            name: "(no value)",
            hint: String(facet.missing),
            run: () => {
              run(missingStep(facet.key));
            },
          },
        ]
      : []),
  ],
});

/** The prompt for the status: the statuses of the list with their counts. */
const statusPrompt = (
  statuses: ElementFacetsOutput["statuses"],
  run: (step: FilterStep) => void,
): Prompt => ({
  label: "status",
  items: statuses.map(({ key, count }) => ({
    id: key,
    name: key,
    hint: String(count),
    run: () => {
      run(statusStep(key));
    },
  })),
});

/**
 * The entries of the property prompt for the elements `facets` describes (SR-124 AK2): the status when the
 * list has one, then each property whose values can be chosen, in the order the core gives. Free text has
 * no values and is not offered (AK3). Choosing one asks (`ask`) for the value and runs `run` with the step.
 * Empty when there is nothing to choose.
 */
export const propertyChoices = (
  facets: ElementFacetsOutput,
  run: (step: FilterStep) => void,
  ask: (prompt: Prompt) => void,
): readonly Choice[] => [
  ...(facets.statuses.length === 0
    ? []
    : [
        {
          id: "status",
          name: "status",
          hint: String(facets.statuses.length),
          run: () => {
            ask(statusPrompt(facets.statuses, run));
          },
        },
      ]),
  ...facets.properties.flatMap((facet) => {
    const { values } = facet;
    return values === undefined || values.length === 0
      ? []
      : [
          {
            id: facet.key,
            name: facet.key,
            hint: String(values.length),
            run: () => {
              ask(valuePrompt(facet, values, run));
            },
          },
        ];
  }),
];
