// From a value of the shown element to the list of every element with that value (SR-132). The list is an
// ordinary filtered list with one step, the step "Filter list by property" or "Filter list by status" would
// add (SR-124), so it narrows further like any list (AK5). Which values can be listed is what
// `element.facets` gives for the one element, the rule of filtering (SR-132's rationale: „Welche Properties
// sich dafür eignen, gilt wie beim Filtern nach SR-124“): its status and type, each value of a choice or
// relation property, and the values of a text, number or date property with few shared values in the
// workspace. Long free text (title, rationale, acceptance criteria) has no values there, so it is never
// offered (AK4). Every value is one that `{ property, op: "eq", value }` selects exactly (core's facets),
// so the list holds what the CLI, the API and the MCP server give for that condition (AK2). Pure: the app
// builds the step, core filters (ADR-0002).
import type { DataExportElement, DataExportRelation, ElementFacetsOutput } from "@logreq/core";
import type { Prompt } from "./actions.js";
import type { FilterStep } from "./buffers.js";
import { exactTypeStep, facetValueStep, statusStep, valueName } from "./list-filters.js";

/** One value of the shown element that opens a list: its status, its type or a value of a property. */
export interface ListableValue {
  /** `status`, `type` or the key of the property. */
  readonly key: string;
  readonly value: string | number | boolean;
  /** How the prompt names it: "topic: Bearbeiten und Finden". */
  readonly name: string;
  /** The display name of a choice or a type, when it is not the key. */
  readonly hint?: string;
  /** The filter step of the list. */
  readonly step: FilterStep;
}

/** What the user points at: a box (and in it a line of a text box or a target of a relation box), or no box. */
export type Pointer =
  | { readonly kind: "none" }
  | {
      readonly kind: "box";
      readonly key: string;
      /** The line of a text box with the caret. */
      readonly line?: string;
      /** The focused target link of a relation box. */
      readonly target?: { readonly id: string; readonly repository: string };
    };

export const NO_POINTER: Pointer = { kind: "none" };

/** What the pointer gives: one value to list, the values to ask among, or nothing to list. */
export type Pointed =
  | { readonly kind: "open"; readonly value: ListableValue }
  | { readonly kind: "ask"; readonly values: readonly ListableValue[] }
  | { readonly kind: "none" };

const named = (name: string, key: string): { readonly hint?: string } => (name === key ? {} : { hint: name });

/**
 * The values of the element `facets` describes (`element.facets` with the element's ID): the status, the
 * type, then every value of each property that has values to choose from, in the order of the boxes
 * (`boxOrder`; a property without a box after them, in the order core gives).
 */
export const listableValues = (
  facets: ElementFacetsOutput,
  boxOrder: readonly string[],
): readonly ListableValue[] => {
  const place = (key: string): number => {
    const at = boxOrder.indexOf(key);
    return at === -1 ? boxOrder.length : at;
  };
  const properties = facets.properties
    .flatMap((facet, at) => {
      const values = facet.values ?? [];
      return values.length === 0 ? [] : [{ facet, values, at }];
    })
    .sort((a, b) => place(a.facet.key) - place(b.facet.key) || a.at - b.at);
  return [
    ...facets.statuses.map(({ key }) => ({
      key: "status",
      value: key,
      name: `status: ${key}`,
      step: statusStep(key),
    })),
    ...facets.types.map(({ key, name }) => ({
      key: "type",
      value: key,
      name: `type: ${key}`,
      ...named(name, key),
      step: exactTypeStep(key),
    })),
    ...properties.flatMap(({ facet, values }) =>
      values.map((value) => ({
        key: facet.key,
        value: value.value,
        name: `${facet.key}: ${valueName(facet, value)}`,
        ...(value.name === undefined ? {} : named(value.name, String(value.value))),
        step: facetValueStep(facet, value),
      })),
    ),
  ];
};

/** The short ID of a target of the relation property `key`, as the element stores it (the value `eq` takes). */
const targetShortId = (
  relations: readonly DataExportRelation[],
  key: string,
  target: { readonly id: string; readonly repository: string },
): string | undefined =>
  relations.find(
    (relation) =>
      relation.property === true &&
      relation.direction === "out" &&
      relation.kind === key &&
      relation.id === target.id &&
      (relation.repository ?? "") === target.repository,
  )?.shortId;

/**
 * What the key or the command does at `pointer`:
 *
 * - on a box with listable values and a line or target that is one of them: that value;
 * - on such a box without one: its only value, else the prompt among its values; a line or target that
 *   is none of them (input not saved) asks among them too;
 * - on a box without listable values (free text, AK4) or on no box (the title, the text, the page): the
 *   prompt among all listable values, never the free text itself.
 */
export const pointedValue = (
  values: readonly ListableValue[],
  pointer: Pointer,
  relations: readonly DataExportRelation[],
): Pointed => {
  if (values.length === 0) {
    return { kind: "none" };
  }
  if (pointer.kind === "none") {
    return { kind: "ask", values };
  }
  const own = values.filter((value) => value.key === pointer.key);
  const [only] = own;
  if (only === undefined) {
    return { kind: "ask", values };
  }
  const { line, target } = pointer;
  let wanted: string | undefined;
  if (target !== undefined) {
    wanted = targetShortId(relations, pointer.key, target) ?? "";
  } else if (line !== undefined) {
    wanted = line;
  }
  if (wanted === undefined) {
    return own.length === 1 ? { kind: "open", value: only } : { kind: "ask", values: own };
  }
  const match = own.find((value) => String(value.value) === wanted);
  return match === undefined ? { kind: "ask", values: own } : { kind: "open", value: match };
};

/** The prompt "Elements with": the values to choose from; taking one opens its list. */
export const valuesPrompt = (
  values: readonly ListableValue[],
  open: (value: ListableValue) => void,
): Prompt => ({
  label: "Elements with",
  items: values.map((value) => ({
    id: `${value.key}\n${String(value.value)}`,
    name: value.name,
    ...(value.hint === undefined ? {} : { hint: value.hint }),
    run: () => {
      open(value);
    },
  })),
});

/**
 * What decides which values the element has to list: its type, status and stored properties. The facets
 * are asked again only when this changes (or the workspace changed outside), not after every save of the
 * text (N-036).
 */
export const valueSignature = (
  element: Pick<DataExportElement, "id" | "repository" | "type" | "status" | "properties">,
): string =>
  JSON.stringify([element.id, element.repository, element.type, element.status ?? null, element.properties]);

/** What decides the values of the shown element that open a list (SR-132); none while it is not shown. */
export const valueKeyOf = (element: DataExportElement | undefined): string | undefined =>
  element === undefined ? undefined : valueSignature(element);
