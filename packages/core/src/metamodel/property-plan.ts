// What the property commands (metamodel.addProperty, metamodel.changeProperty,
// metamodel.removeProperty, SR-238) check and plan on a metamodel before the write layer writes it.
//
// - Names: a property name another property has, or a fixed value name another fixed value of the
//   same property has, is refused as `taken` (SR-236 AK2), compared in Unicode normal form NFC.
// - Keys: a property key counts against the keys of properties and relation kinds, a fixed value key
//   against the fixed values of its property (SR-236 AK6).
// - Fields of a value kind: fixed values only with `choice`, target types only with `relation`,
//   Markdown only with `text`, maximum entries never with `relation` (SR-238 AK1, AK3; the loader
//   refuses `markdown` and `max-items` elsewhere too). `fieldsOutside` gives the fields a definition
//   loses with a new kind.
import { CommandError } from "../catalog.js";
import type { MetamodelNamed, MetamodelProperty, MetamodelType } from "../generated/types.js";
import type { EffectiveType } from "./inheritance.js";
import type { Metamodel } from "./load.js";
import { keyFromName, keyOrMade } from "./new-key.js";

export type PropertyKind = MetamodelProperty["kind"];

/** The fields of a property definition that belong to some value kinds only. */
export type KindField = "choices" | "target-types" | "max-items" | "markdown";

/** `input.invalid`, reason `unknown`: no definition of `what` has the key. */
export const unknownDefinition = (what: "type" | "property", key: string): CommandError =>
  new CommandError("input.invalid", `Unknown ${what} ${key}: the metamodel has no ${what} with this key`, {
    reason: "unknown",
    [what]: key,
  });

/** The definition of the property `key`; refused as `unknown` when the metamodel has none. */
export const propertyDefinition = (metamodel: Metamodel, key: string): MetamodelProperty => {
  const property = metamodel.properties.find((p) => p.key === key);
  if (property === undefined) {
    throw unknownDefinition("property", key);
  }
  return property;
};

/** The fixed values of `property`, none when it has no list. */
export const choicesOf = (property: MetamodelProperty): readonly MetamodelNamed[] => property.choices ?? [];

const same = (a: string, b: string): boolean => a.normalize("NFC") === b.normalize("NFC");

/** Refuses `name` when a property other than `except` has it (SR-236 AK2). */
export const refusePropertyName = (metamodel: Metamodel, name: string, except?: string): void => {
  const other = metamodel.properties.find((p) => p.key !== except && same(p.name, name));
  if (other !== undefined) {
    throw new CommandError("input.invalid", `Property ${other.key} already has the name ${name}`, {
      reason: "taken",
      field: "name",
      key: other.key,
    });
  }
};

/** Whether `key` is the key of a property or a relation kind (SR-236 AK6: they count together). */
const keyInUse = (metamodel: Metamodel, key: string): boolean =>
  metamodel.properties.some((p) => p.key === key) || metamodel.relations.some((r) => r.key === key);

/** The keys every element file holds itself: no property may have one of them. */
const STRUCTURAL_KEYS: readonly string[] = ["id", "type", "status"];

/**
 * The key of a new property: as given, else made from its name; refused when taken (SR-236 AK6) or
 * when it is a field every element has, given (`structural-key`) or made (`key-required`).
 */
export const newPropertyKey = (metamodel: Metamodel, name: string, key: string | undefined): string => {
  const candidate = key ?? keyFromName(name).key;
  if (STRUCTURAL_KEYS.includes(candidate)) {
    const message = `Property key ${candidate} is a field every element has (D-012); choose another key`;
    throw new CommandError(
      "input.invalid",
      key === undefined ? `Give a key: ${message}` : message,
      key === undefined
        ? { reason: "key-required", key: candidate }
        : { reason: "structural-key", key: candidate },
    );
  }
  if (key !== undefined && keyInUse(metamodel, key)) {
    throw new CommandError("input.invalid", `A property or relation kind already has the key ${key}`, {
      reason: "taken",
      field: "key",
      key,
    });
  }
  return keyOrMade(name, key, (made) => keyInUse(metamodel, made), "a property or relation kind");
};

/**
 * The fixed values `added` with their keys, after `existing` (SR-238 AK1, AK4): a key as given, else
 * made from the name; refused when a key is that of another fixed value of the property, and when a
 * name is that of another one of `existing` (as they are afterwards) or of `added` (SR-236 AK2, AK6).
 */
export const newChoices = (
  existing: readonly MetamodelNamed[],
  added: readonly { readonly name: string; readonly key?: string }[],
): readonly MetamodelNamed[] => {
  const result: MetamodelNamed[] = [];
  const all = (): readonly MetamodelNamed[] => [...existing, ...result];
  for (const { name, key } of added) {
    const other = all().find((c) => same(c.name, name) || c.key === key);
    if (other !== undefined) {
      const field = same(other.name, name) ? "name" : "key";
      throw new CommandError(
        "input.invalid",
        `The fixed value ${other.key} already has the ${field} ${field === "name" ? name : other.key}`,
        { reason: "taken", field, key: other.key },
      );
    }
    const made = keyOrMade(name, key, (k) => all().some((c) => c.key === k), "a fixed value of the property");
    result.push({ key: made, name });
  }
  return result;
};

/** The kinds each field of `KindField` belongs to. */
const BELONGS: Readonly<Record<KindField, (kind: PropertyKind) => boolean>> = {
  choices: (kind) => kind === "choice",
  "target-types": (kind) => kind === "relation",
  "max-items": (kind) => kind !== "relation",
  markdown: (kind) => kind === "text",
};

/** Refuses each of `given` (fields of the input with a value) that does not belong to `kind`. */
export const refuseOutsideKind = (kind: PropertyKind, given: readonly KindField[]): void => {
  const outside = given.find((field) => !BELONGS[field](kind));
  if (outside !== undefined) {
    throw new CommandError(
      "input.invalid",
      `A property of kind ${kind} has no ${outside}; give it with a kind it belongs to`,
      { reason: "kind-field", field: outside, kind },
    );
  }
};

/**
 * Refuses a maximum of entries (`limit`) for a property that holds a single value: `max-items` needs
 * `many: true` (SR-171), so it would be refused by the loader, or dropped with `many: false`.
 */
export const refuseSingleLimit = (many: boolean, limit: boolean): void => {
  if (limit && !many) {
    throw new CommandError(
      "input.invalid",
      "A property with a single value has no max-items; give it with many: true",
      { reason: "single-value" },
    );
  }
};

/** The fields `property` has that do not belong to `kind`, in the order of `KindField`. */
export const fieldsOutside = (property: MetamodelProperty, kind: PropertyKind): readonly KindField[] =>
  (Object.keys(BELONGS) as KindField[]).filter(
    (field) => property[field] !== undefined && property[field] !== false && !BELONGS[field](kind),
  );

/** Which own lists of `type` hold `key`. */
export const ownLists = (
  type: MetamodelType,
  key: string,
): { readonly properties: number; readonly required: number } => ({
  properties: type.properties?.indexOf(key) ?? -1,
  required: type.required?.indexOf(key) ?? -1,
});

/**
 * The closest ancestor of `type` whose own `of` list holds `key`, for a refusal that names where an
 * inherited property is changed (SR-238 AK5); undefined when none does.
 */
export const ownerAbove = (
  metamodel: Metamodel,
  type: EffectiveType,
  key: string,
  of: "properties" | "required",
): string | undefined => {
  const owners = new Set(
    metamodel.types
      .filter((t) => {
        const lists = ownLists(t, key);
        // Required keys are properties too (metamodel.schema.json).
        return lists.required !== -1 || (of === "properties" && lists.properties !== -1);
      })
      .map((t) => t.key),
  );
  return type.ancestors.find((ancestor) => owners.has(ancestor));
};
