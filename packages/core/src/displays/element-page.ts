// The display model of an element's page (ADR-0019 points 1, 2, 4, 9): what the app's element buffer and the HTML
// export's element page show of `element.get` besides text and properties: its verification status per view, its
// relations by group and its open hints. Both sides render it; neither groups, orders or words these rows itself.
//
// - Verification: one cell per entry of `verification`, in core's order; none for an element that is no
//   requirement or need.
// - Relation groups: one per relation kind and direction, or relation property for incoming relations (the targets
//   of an outgoing relation property are the values of that property, and stand with the properties). The
//   outgoing groups first, then the incoming ones; within each, the kinds in the order of the metamodel, then a kind
//   the metamodel does not know in the order it first appears, headed by its key (`relationGroupLabel`). Within a
//   group the relations in the order of `element.get`. The export page shows the outgoing ones only (SR-232 AK1,
//   option `relations`).
// - Open hints: those `hint.list` gives for the element, in its order (SR-232 AK4, ADR-0019 point 9(c)); without a
//   `hint.list` answer, those of `element.get` by the rule of `hint.list` (`openHints`), so the app's status line
//   counts the same set.
// - `readOnly` as `element.get` gives it (point 6); the export ignores it.
import type { DataExportElement, DataExportRelation, MetamodelGetOutput } from "../generated/types.js";
import type { ElementRef } from "./element-ref.js";
import { elementRef, invalidStatusKeys } from "./element-ref.js";
import type { RelationNames } from "./labels.js";
import { relationGroupLabel } from "./labels.js";
import { openHints } from "./open-hints.js";
import type { VerificationCell } from "./verification.js";

/** A group of relations of the element. */
export interface RelationGroupDisplay {
  /** Tells the groups apart: direction, whether a property, and key. */
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly direction: "in" | "out";
  readonly relations: readonly DataExportRelation[];
}

/** A hint as a page lists it: its kind and reason as the command gives them. */
export interface HintDisplay {
  readonly code: string;
  readonly message: string;
}

export interface ElementPageDisplay {
  readonly ref: ElementRef;
  /** Undefined for an element without a verification status. */
  readonly verification: readonly VerificationCell[] | undefined;
  readonly relationGroups: readonly RelationGroupDisplay[];
  readonly hints: readonly HintDisplay[];
  readonly readOnly: boolean;
}

/** What the model is built from: command outputs as they are. */
export interface ElementPageInput {
  /** `element.get` `element` (the export: the same shape from `listElements`). */
  readonly element: DataExportElement;
  /** `hint.list { ref }` `hints`; left out: taken from `element.problems` by the rule of `hint.list`. */
  readonly hints?: readonly { readonly code: string; readonly message: string }[];
  readonly metamodel: RelationNames & Pick<MetamodelGetOutput, "statuses">;
}

export interface ElementPageOptions {
  /** Which relations the groups hold: every one (app), or the outgoing ones only (export page, SR-232 AK1). */
  readonly relations: "all" | "outgoing";
}

/** A relation that is the value of a property of kind `relation` (ADR-0004), not a relation kind. */
export const isPropertyTarget = (relation: Pick<DataExportRelation, "property" | "direction">): boolean =>
  relation.property === true && relation.direction === "out";

/** The groups of `relations` (see the file comment). */
export const relationGroupsOf = (
  relations: readonly DataExportRelation[],
  names: RelationNames,
  options: ElementPageOptions,
): RelationGroupDisplay[] => {
  const groups = new Map<
    string,
    { group: Omit<RelationGroupDisplay, "relations">; relations: DataExportRelation[] }
  >();
  for (const relation of relations) {
    if (isPropertyTarget(relation) || (options.relations === "outgoing" && relation.direction === "in")) {
      continue;
    }
    const property = relation.property === true;
    const key = `${relation.direction}:${property ? "property" : "kind"}:${relation.kind}`;
    const found = groups.get(key);
    if (found === undefined) {
      const link = { kind: relation.kind, property, direction: relation.direction };
      groups.set(key, {
        group: {
          key,
          label: relationGroupLabel(link, names),
          kind: relation.kind,
          direction: relation.direction,
        },
        relations: [relation],
      });
    } else {
      found.relations.push(relation);
    }
  }
  const rank = new Map(names.relations.map((kind, at) => [kind.key, at]));
  const rankOf = ({ group }: { group: Omit<RelationGroupDisplay, "relations"> }): number =>
    (group.direction === "out" ? 0 : 1) * (names.relations.length + 1) +
    (group.key.includes(":property:")
      ? names.relations.length
      : (rank.get(group.kind) ?? names.relations.length));
  // A stable sort: groups of the same rank keep the order they first appear in.
  return [...groups.values()]
    .sort((a, b) => rankOf(a) - rankOf(b))
    .map(({ group, relations: grouped }) => ({ ...group, relations: grouped }));
};

/** The display model of the page of `input.element` (see the file comment). */
export const elementPageDisplay = (
  input: ElementPageInput,
  options: ElementPageOptions,
): ElementPageDisplay => {
  const { element, metamodel } = input;
  const hints = input.hints ?? openHints(element.problems);
  return {
    ref: elementRef(element, invalidStatusKeys(metamodel)),
    verification: element.verification?.map(({ view, status, criteria, missingChildren }) => ({
      view,
      status,
      ...(criteria === undefined ? {} : { criteria }),
      ...(missingChildren === undefined ? {} : { missingChildren }),
    })),
    relationGroups: relationGroupsOf(element.relations, metamodel, options),
    hints: hints.map(({ code, message }) => ({ code, message })),
    readOnly: element.readOnly === true,
  };
};
