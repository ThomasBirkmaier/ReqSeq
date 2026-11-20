// The context menus of the metamodel's graph (SR-199 AK2, AK5 to AK7): the metamodel commands of the place,
// started with the clicked definition given (`startCommand`'s `prefilled`), so the command prompt asks only the
// rest (`metamodel-prompt.ts`). The graph marks each place (`MetamodelView.tsx`) and names its definitions in
// `data-given-*` attributes, key and name; the app adds no rule of the metamodel, core decides (ADR-0002).
// - The sheet outside the boxes and labels, an inheritance curve or label line and the box "Any type":
//   "Add type", "Add relation kind", then "Show metamodel as text" and "Copy graph as Mermaid" (AK2).
// - The head of a type (name, "abstract", prefix): "Add property to type", "Add status to type", "Change type
//   definition", "Add relation kind" with the type as its source type, and "Remove type" (AK5).
// - A property row of a type or the label line of a relation property: "Change property definition" and
//   "Remove property from type", given the property and the type that has it itself (AK6).
// - A status of a type: "Change status definition" and "Remove status from type", given the status and the type.
// - The label line of a relation kind: "Change relation kind" and "Remove relation kind" (AK7).
import type { MenuEntry, MenuPlace } from "./context-menu.js";
import type { GivenArguments, Prefilled } from "./matrix-menu.js";

const entries = (...names: readonly string[]): readonly MenuEntry[] =>
  names.map((name) => ({ id: `command:metamodel.${name}` }));

/** AK2: before "Show metamodel as text" and "Copy graph as Mermaid". */
export const METAMODEL_SHEET_MENU = entries("addType", "addRelationKind");
export const METAMODEL_TYPE_MENU = entries(
  "addProperty",
  "addStatus",
  "changeType",
  "addRelationKind",
  "removeType",
);
export const METAMODEL_PROPERTY_MENU = entries("changeProperty", "removeProperty");
export const METAMODEL_STATUS_MENU = entries("changeStatus", "removeStatus");
export const METAMODEL_KIND_MENU = entries("changeRelationKind", "removeRelationKind");

/** The places of the definitions in the graph, each marked with `data-given-<what>` and `data-given-<what>-name`. */
const GIVEN_PLACES: ReadonlySet<MenuPlace> = new Set([
  "metamodel-type",
  "metamodel-property",
  "metamodel-status",
  "metamodel-kind",
]);

/** The definition `what` the place names, as the value of the field of that name; undefined when it names none. */
const read = (place: Element, what: string): Prefilled | undefined => {
  const value = place.getAttribute(`data-given-${what}`);
  return value === null
    ? undefined
    : { field: what, value, label: place.getAttribute(`data-given-${what}-name`) ?? value };
};

/** The arguments the menu at `place` gives for the press on `target`; none outside the graph's definitions. */
export const metamodelGiven = (place: MenuPlace, target: Element | undefined): GivenArguments | undefined => {
  const marked = GIVEN_PLACES.has(place) ? target?.closest(`[data-menu="${place}"]`) : undefined;
  if (marked === undefined || marked === null) {
    return undefined;
  }
  const type = read(marked, "type");
  const property = read(marked, "property");
  const status = read(marked, "status");
  const kind = read(marked, "kind");
  if (place === "metamodel-type" && type !== undefined) {
    return {
      "metamodel.addProperty": [type],
      "metamodel.addStatus": [type],
      "metamodel.changeType": [type],
      "metamodel.addRelationKind": [{ ...type, field: "sourceTypes", value: [type.value] }],
      "metamodel.removeType": [type],
    };
  }
  if (place === "metamodel-property" && type !== undefined && property !== undefined) {
    return { "metamodel.changeProperty": [property, type], "metamodel.removeProperty": [type, property] };
  }
  if (place === "metamodel-status" && type !== undefined && status !== undefined) {
    return { "metamodel.changeStatus": [status], "metamodel.removeStatus": [type, status] };
  }
  if (place === "metamodel-kind" && kind !== undefined) {
    return { "metamodel.changeRelationKind": [kind], "metamodel.removeRelationKind": [kind] };
  }
  return undefined;
};
