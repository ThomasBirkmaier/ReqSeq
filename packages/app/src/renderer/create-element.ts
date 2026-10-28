// Creating an element in the command prompt (SR-064): "Create element", the catalog command `element.create`,
// asks the type, the title and then each required property of the type in turn, one after the other in the
// minibuffer (no form, D-062); an empty input skips a property (`catalog-commands.ts`). Core creates the
// element with what was given and saves it also with empty required properties, with a hint for each
// (AK2). The element buffer then shows only the filled properties (D-062, SR-104 AK1), the modeline counts
// the hints, and "Add property" offers every other property of the type (AK3). These helpers only read
// what `metamodel.get` and `element.create` give (ADR-0002).
import type { ElementCreateOutput, ElementInputValue, MetamodelGetOutput } from "@logreq/core";
import { elementBufferOf } from "./buffers.js";
import type { PropertyInfo } from "./element-view.js";
import { propertyInfo } from "./element-view.js";
import type { RelationTarget } from "./property-edit.js";
import { inputValueOf, relationDoc } from "./property-edit.js";

/** The catalog command that creates an element. */
export const CREATE_COMMAND = "element.create";

/** A required property of a type, asked after the title when an element of the type is created. */
export interface RequiredProperty {
  readonly key: string;
  readonly info: PropertyInfo;
}

/** One value given to a property in the prompt: a text, the key of a choice, or the target of a relation. */
export type PropertyAnswer = string | RelationTarget;

/** A type an element can be created of, with the required properties the prompt asks for it. */
export interface CreatableType {
  readonly key: string;
  readonly name: string;
  readonly required: readonly RequiredProperty[];
}

/**
 * The types an element can be created of: those that are not abstract, in the order of the metamodel. Each
 * with its required properties as the prompt asks them: in the order of `required` (own and inherited),
 * without the title (asked before them) and without a key the metamodel defines no property for (there is
 * nothing to ask it with; core gives its hint).
 */
export const creatableTypes = (
  metamodel: Pick<MetamodelGetOutput, "types" | "properties">,
): CreatableType[] => {
  const defined = new Map(metamodel.properties.map((property) => [property.key, property]));
  return metamodel.types
    .filter((type) => !type.abstract)
    .map((type) => ({
      key: type.key,
      name: type.name,
      required: type.required.flatMap((key): RequiredProperty[] => {
        const property = defined.get(key);
        return property === undefined || property.meaning === "title"
          ? []
          : [{ key, info: propertyInfo(property) }];
      }),
    }));
};

const sameTarget = (a: RelationTarget, b: RelationTarget): boolean =>
  a.id === b.id && a.repository === b.repository;

/** The document of the values given to one property, as its box would hold them (a target taken twice once). */
const docOf = (info: PropertyInfo, values: readonly PropertyAnswer[]): string => {
  if (info.kind === "relation") {
    const targets = values.filter((value): value is RelationTarget => typeof value !== "string");
    return relationDoc(
      targets.filter((target, at) => targets.findIndex((t) => sameTarget(t, target)) === at),
    );
  }
  return values.filter((value): value is string => typeof value === "string").join("\n");
};

/**
 * The `properties` of `element.create` from the values given in the prompt, in the order the properties
 * were asked: each as a box with those values saves it (`inputValueOf`), so a blank text gives nothing.
 */
export const propertiesInput = (
  asked: readonly RequiredProperty[],
  given: readonly { readonly key: string; readonly value: PropertyAnswer }[],
): Record<string, ElementInputValue> => {
  const input: Record<string, ElementInputValue> = {};
  for (const { key, info } of asked) {
    const value = inputValueOf(
      info,
      docOf(
        info,
        given.filter((answer) => answer.key === key).map((answer) => answer.value),
      ),
    );
    if (value !== undefined) {
      input[key] = value;
    }
  }
  return input;
};

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** What the minibuffer says once the element is created: its name and how many hints core gave (AK2). */
export const createdEcho = (output: Pick<ElementCreateOutput, "element" | "problems">): string => {
  const hints = output.problems?.length ?? 0;
  const name = elementBufferOf(output.element).name;
  return hints === 0 ? `Created ${name}` : `Created ${name} · ${plural(hints, "hint")}`;
};
