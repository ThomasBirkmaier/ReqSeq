// What a list page shows besides its base (a type, a package, a saved filter, a perspective, a search): the
// values picked in the facets, the sort, the grouping and the search words. It lives in the parameters of the
// hash route, so a list can be bookmarked and the way back finds it again. Pure functions; the conditions they
// build are those of the filter language (SR-069), checked by ReqSeq.
import type { InputOf } from "./api.js";

export type Condition = NonNullable<NonNullable<InputOf<"element.list">["selection"]>["where"]>;
export type SortKey = NonNullable<InputOf<"element.list">["sort"]>[number];
/** A value of a facet: what `element.facets` gives, or `null` for the elements without a value. */
export type FacetValue = string | number | boolean | null;

/** A facet: `type`, `status`, or `p.<property key>`. */
export type FacetKey = "type" | "status" | `p.${string}`;

export interface ListState {
  /** The values picked per facet; a facet without picks is not in the map. */
  readonly picks: ReadonlyMap<FacetKey, readonly FacetValue[]>;
  readonly sort?: SortKey | undefined;
  readonly group?: string | undefined;
  readonly query?: string | undefined;
}

export const EMPTY: ListState = { picks: new Map() };

const isFacetKey = (name: string): name is FacetKey =>
  name === "type" || name === "status" || (name.startsWith("p.") && name.length > 2);

/** A property value in the address: JSON, so a number stays a number and `null` means "no value". */
const decodeValue = (key: FacetKey, text: string): FacetValue => {
  if (key === "type" || key === "status") {
    return text;
  }
  try {
    const value: unknown = JSON.parse(text);
    return value === null || ["string", "number", "boolean"].includes(typeof value)
      ? (value as FacetValue)
      : text;
  } catch {
    return text;
  }
};

const encodeValue = (key: FacetKey, value: FacetValue): string =>
  key === "type" || key === "status" ? String(value) : JSON.stringify(value);

/** The state of the parameters of a route. */
export function parseState(params: URLSearchParams): ListState {
  const picks = new Map<FacetKey, FacetValue[]>();
  for (const [name, text] of params) {
    if (isFacetKey(name)) {
      const value = decodeValue(name, text);
      const list = picks.get(name) ?? [];
      if (!list.includes(value)) {
        picks.set(name, [...list, value]);
      }
    }
  }
  const by = params.get("sort") ?? "";
  const group = params.get("group") ?? "";
  const query = params.get("q") ?? "";
  return {
    picks,
    ...(by === "" ? {} : { sort: { by, order: params.get("order") === "desc" ? "desc" : "asc" } }),
    ...(group === "" ? {} : { group }),
    ...(query.trim() === "" ? {} : { query }),
  };
}

/** The parameters of `state`, in a fixed order; empty when nothing is picked. */
export function stateParams(state: ListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query !== undefined) {
    params.append("q", state.query);
  }
  for (const [key, values] of state.picks) {
    for (const value of values) {
      params.append(key, encodeValue(key, value));
    }
  }
  if (state.sort !== undefined) {
    params.append("sort", state.sort.by);
    if (state.sort.order === "desc") {
      params.append("order", "desc");
    }
  }
  if (state.group !== undefined) {
    params.append("group", state.group);
  }
  return params;
}

/** The query part of a hash for `state`: `?…`, or nothing. */
export const queryOf = (state: ListState): string => {
  const text = stateParams(state).toString();
  return text === "" ? "" : `?${text}`;
};

export const isPicked = (state: ListState, key: FacetKey, value: FacetValue): boolean =>
  state.picks.get(key)?.includes(value) ?? false;

/** `state` with `value` of facet `key` picked, or no longer picked. */
export function toggle(state: ListState, key: FacetKey, value: FacetValue): ListState {
  const picks = new Map(state.picks);
  const list = picks.get(key) ?? [];
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  if (next.length === 0) {
    picks.delete(key);
  } else {
    picks.set(key, next);
  }
  return { ...state, picks };
}

/** `state` without any picks. */
export const withoutPicks = (state: ListState): ListState => ({ ...state, picks: new Map() });

/** The condition of one facet's picks: one of the picked values (or no value, for `null`). */
function facetCondition(key: FacetKey, values: readonly FacetValue[]): Condition {
  if (key === "type") {
    // A facet counts the elements of exactly a type, so it selects them the same way.
    return { type: values.map(String), subtypes: false };
  }
  if (key === "status") {
    return { status: values.map(String) };
  }
  const property = key.slice(2);
  const given = values.filter((v): v is string | number | boolean => v !== null);
  const parts: Condition[] = [
    ...(given.length === 0 ? [] : [{ property, op: "in" as const, value: given }]),
    ...(values.includes(null) ? [{ property, op: "missing" as const }] : []),
  ];
  return parts.length === 1 && parts[0] !== undefined ? parts[0] : { any: parts };
}

/** The conditions of the picks, all of which must hold; `except` leaves one facet out (for its own counts). */
export const pickConditions = (state: ListState, except?: FacetKey): Condition[] =>
  [...state.picks]
    .filter(([key, values]) => key !== except && values.length > 0)
    .map(([key, values]) => facetCondition(key, values));

/** All of `conditions`: `{ all: [] }` for none, the condition itself for one. */
export function allOf(conditions: readonly (Condition | undefined)[]): Condition {
  const given = conditions.filter((c): c is Condition => c !== undefined);
  return given.length === 1 && given[0] !== undefined ? given[0] : { all: given };
}

/** Whether `state` changes the list of its base: picks, a sort or a grouping. */
export const changesList = (state: ListState): boolean =>
  state.picks.size > 0 || state.sort !== undefined || state.group !== undefined;
