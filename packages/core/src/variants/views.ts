// Validity as a list of variants (SR-040, D-020): every requirement carries a validity, the list of
// the variants it applies to; an empty list means all. The validity is the property with the meaning
// `validity` (D-012), a relation-valued property (ADR-0004) whose entries name variants by UUID and,
// across repositories, by the workspace name of the repository (D-058), never by a free name.
//
// `appliesIn` is the part of the views of the core and of the variants that the validity decides;
// replacement and exclusion (SR-041, SR-042) narrow a variant's view further (view-rule.ts). The core
// view shows only requirements without validity (SR-043 AK9, glossary "Kern"), so a requirement with
// a validity is not in it.
//
// Entries are read as the missing-target check reads relation items (SR-089, model/relation-keys.ts):
// `relationKey` and `relationItems`, so under a key with `many` only a list has entries and one value
// where a list belongs gives none (the value-kind check, SR-085, reports it). An entry names a target
// when `hasId` holds (a mapping with a text `id`); its other keys are SR-085's. The view and the hint
// (superseded-validity.ts) share this reading.
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { propertyWithMeaning, requireMeaning, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, RelationKey, ShortIds } from "../model/index.js";
import { hasId, relationItems, relationKey, resolveRef } from "../model/index.js";

/** A view the tool computes: the core, or one variant. */
export type View =
  | { readonly kind: "core" }
  | { readonly kind: "variant"; readonly variant: Pick<ElementRecord, "id" | "repository"> };

/** A view as `resolveView` gives it: a variant's view with the variant's record. */
export type ResolvedView =
  { readonly kind: "core" } | { readonly kind: "variant"; readonly variant: ElementRecord };

/** The validity property: its key, how messages name it and whether it holds a list (`relationKey`). */
export type Validity = Pick<RelationKey, "label" | "many"> & { readonly key: string };

/**
 * The property with the meaning `validity`, when it holds relations (kind `relation`); undefined
 * otherwise. Then no element has a validity and everything applies everywhere. The stage-5 view
 * commands must not rely on this fallback: they call `requireMeaning` first and report
 * `metamodel.meaning-unassigned` (SR-013 AK3).
 */
export const validityOf = (metamodel: Metamodel): Validity | undefined => {
  const property = propertyWithMeaning(metamodel, "validity");
  const relation = property === undefined ? undefined : relationKey(metamodel, property.key);
  return property === undefined || relation === undefined
    ? undefined
    : { key: property.key, label: relation.label, many: relation.many };
};

/** One entry of a validity with its key path in the file: `[key, i]` in a list, `[key]` for one value. */
export interface ValidityEntry {
  readonly path: readonly [string] | readonly [string, number];
  readonly value: unknown;
}

/**
 * The entries of the validity of `element` (`relationItems`): none without a validity property or
 * when the value is absent, `null` or an empty list (the same, as for the version, ADR-0005). With
 * `many`, only a list has entries; without, the one value is the entry and a list gives none.
 */
export const validityEntries = (
  validity: Pick<Validity, "key" | "many"> | undefined,
  element: ElementRecord,
): readonly ValidityEntry[] => {
  const value = validity === undefined ? undefined : element.data[validity.key];
  if (validity === undefined || value === undefined || value === null) {
    return [];
  }
  return relationItems(validity.key, validity, value).map(([path, item]) => ({ path, value: item }));
};

/** The place an entry names: a UUID and the workspace name of a repository. */
export interface ValidityTarget {
  readonly id: string;
  readonly repository: string;
}

/**
 * The variant an entry names, the one cheap predicate the view and the hint share: a mapping (not a
 * list) with a text `id`, in the repository it names, or in the source's own when it names none
 * (D-058, as `targetState`). Undefined for a free name or any other value (D-020), and when
 * `repository` is given but not text (it then names no repository of the workspace).
 */
export const validityTarget = (
  entry: unknown,
  source: Pick<ElementRecord, "repository">,
): ValidityTarget | undefined => {
  if (!hasId(entry)) {
    return undefined;
  }
  const { id, repository } = entry;
  if (repository === undefined) {
    return { id, repository: source.repository };
  }
  return typeof repository === "string" ? { id, repository } : undefined;
};

/**
 * Whether `element` applies in `view` by its validity (`validityOf`): with no validity (absent,
 * `null` or an empty list) in the core and in every variant (SR-040 AK1); with any other value only
 * in the variants its entries name, not in the core (SR-040 AK2, SR-043 AK9). A value of the wrong
 * shape names no variant, so it applies in no view; the value-kind check reports it (SR-085). Pure
 * and cheap: no store lookup, no schema validation.
 */
export const appliesIn = (
  validity: Pick<Validity, "key" | "many"> | undefined,
  element: ElementRecord,
  view: View,
): boolean => {
  const value = validity === undefined ? undefined : element.data[validity.key];
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    return true;
  }
  if (view.kind === "core") {
    return false;
  }
  const { variant } = view;
  return validityEntries(validity, element).some((entry) => {
    const target = validityTarget(entry.value, element);
    return target?.id === variant.id && target.repository === variant.repository;
  });
};

/** The effective type keys with the meaning `variant` (own or inherited, SR-012). */
export const variantTypes = (metamodel: Metamodel): ReadonlySet<string> =>
  new Set(typesWithMeaning(metamodel, "variant").map((t) => t.key));

/** The variants of the workspace: elements whose type has the meaning `variant`, in store order. */
export const variantsOf = (store: ElementStore, metamodel: Metamodel): readonly ElementRecord[] => {
  const types = variantTypes(metamodel);
  return store.elements.filter((e) => types.has(e.type));
};

/**
 * The view a command input names (`common.schema.json#/$defs/view`): `core`, or a reference to a
 * variant (`resolveRef`: `ref.unknown`, `ref.ambiguous`). The view is decided by the validity, so
 * `command` needs the meaning `validity`, and for a variant the meaning `variant` (SR-013 AK3:
 * `metamodel.meaning-unassigned`). A reference to an element whose type has not the meaning
 * `variant` is `input.invalid`.
 */
export const resolveView = (
  context: { readonly metamodel: Metamodel; readonly store: ElementStore; readonly shortIds: ShortIds },
  view: string,
  command: CommandName,
  /** The input field that names the view, for `input.invalid` (`hint.list` names it `variant`). */
  field = "view",
  /** Whether the field takes `core` too, as `view` does; the message says so. */
  takesCore = field === "view",
): ResolvedView => {
  const { metamodel, store, shortIds } = context;
  requireMeaning(metamodel, "validity", command);
  // In any case, as element references are (#309, #305).
  if (view.toLowerCase() === "core") {
    return { kind: "core" };
  }
  requireMeaning(metamodel, "variant", command);
  const variant = resolveRef(store, shortIds, view);
  if (!variantTypes(metamodel).has(variant.type)) {
    throw new CommandError(
      "input.invalid",
      `${view} is no variant: ${field} takes ${takesCore ? "core or " : ""}a variant, an element whose type has the meaning variant`,
      { command, fields: [field] },
    );
  }
  return { kind: "variant", variant };
};
