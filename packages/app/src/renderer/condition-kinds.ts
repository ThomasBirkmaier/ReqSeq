// The kinds of a condition (SR-215 AK3) and their values, shared by the condition of "Save filter" and "Save
// perspective" (`condition-prompt.ts`) and by "Filter list" (`list-actions.ts`, SR-124 AK5, AK6). Each value
// is a condition with the label of the same list filter step (`list-filters.ts`) where a list has one: the
// condition prompt sets it as a mark, "Filter list" adds it as a step. The app builds the condition and
// decides nothing about what it selects (ADR-0002).
//
// The values come from read commands: types and relation kinds from `metamodel.get`; statuses and properties
// with their values from `element.facets` over the elements the values are for (`KindSource.facets`), the
// statuses by their name in `metamodel.get`, the properties by SR-124 AK2 and AK3 (`choosableProperties`);
// verification and validation statuses from the condition's schema in the catalog; the views of validity from
// `viewsOf`. A text search has no values: it takes the typed words.
import type { ElementFacetsOutput } from "@reqseq/core";
import type { CommandListing } from "../shared/protocol.js";
import type { FilterStep } from "./buffers.js";
import type { Call } from "./call.js";
import type { Facet } from "./list-filters.js";
import {
  choosableProperties,
  facetValueStep,
  missingStep,
  statusStep,
  textStep,
  typeStep,
  valueName,
} from "./list-filters.js";
import { viewName, viewsOf } from "./views.js";

/** One condition, with the label its mark or its list filter step shows ("status: approved"). */
export interface ConditionMark {
  readonly label: string;
  readonly condition: unknown;
}

/** The condition of a list filter step, with its label. */
export const stepMark = (step: FilterStep): ConditionMark => ({
  label: step.label,
  condition: step.selection.where,
});

/** What the values of the kinds are read from. */
export interface KindSource {
  /** Calls core: the metamodel and the views. */
  readonly call: Call;
  /** The facets of the elements the values are for. */
  readonly facets: () => Promise<
    | { readonly ok: true; readonly output: ElementFacetsOutput }
    | { readonly ok: false; readonly message: string }
  >;
  /** The condition's schema in the catalog: the verification and validation statuses are its enums. */
  readonly schema: unknown;
}

/** A value of a kind: its name, the key shown as its hint where it differs, and its condition. */
export interface KindValue {
  readonly name: string;
  readonly key?: string;
  readonly mark: ConditionMark;
}

/** A hit of a kind that asks a step of its own before a value: a property, whose values come next. */
export interface KindChoice {
  readonly name: string;
  readonly key: string;
  readonly values: readonly KindValue[];
}

export type KindHit = KindValue | KindChoice;

export type KindHits = readonly KindHit[] | { readonly failed: string };

/** A kind of condition (SR-215 AK3): `hits` its values; without them a text search, which takes typed words. */
export interface ConditionKind {
  readonly key: string;
  readonly name: string;
  readonly hits?: (source: KindSource) => Promise<KindHits>;
}

/** The condition a text search adds for the typed words. */
export const textMark = (query: string): ConditionMark => stepMark(textStep(query));

/** The values of a property among the elements of the facets, as a list filter step names them. */
export const valueHits = (facet: Facet): KindValue[] => [
  ...(facet.values ?? []).map((value) => {
    const name = value.name ?? valueName(facet, value);
    const key = String(value.value);
    return {
      name,
      ...(facet.kind === "choice" && key !== name ? { key } : {}),
      mark: stepMark(facetValueStep(facet, value)),
    };
  }),
  ...(facet.missing > 0 ? [{ name: "(no value)", mark: stepMark(missingStep(facet.key)) }] : []),
];

/** The values of `field` in a branch of the condition's schema: its enum, or its items' enum. */
const enumOf = (schema: unknown, field: string): readonly string[] => {
  const branches = (schema as { readonly oneOf?: readonly unknown[] } | undefined)?.oneOf ?? [];
  for (const branch of branches) {
    const part = (
      branch as {
        readonly properties?: Readonly<
          Record<
            string,
            { readonly enum?: readonly unknown[]; readonly items?: { readonly enum?: readonly unknown[] } }
          >
        >;
      }
    ).properties?.[field];
    const values = part?.items?.enum ?? part?.enum;
    if (values !== undefined) {
      return values.map(String);
    }
  }
  return [];
};

/**
 * The schema of a condition in the catalog: that of the first argument that is built as one (`filter.save
 * where`), with its parts inline (`core/listing.ts`). Undefined without one.
 */
export const conditionSchema = (catalog: readonly CommandListing[]): unknown => {
  for (const command of catalog) {
    const arg = command.arguments.find((candidate) => candidate.complete === "condition");
    if (arg !== undefined) {
      return (command.input as { readonly properties?: Readonly<Record<string, unknown>> }).properties?.[
        arg.field
      ];
    }
  }
  return undefined;
};

/** A kind whose values are the enum of its field in the schema: "verification: failed". */
const enumKind = (key: string, name: string, label: string): ConditionKind => ({
  key,
  name,
  hits: (source) =>
    Promise.resolve(
      enumOf(source.schema, key).map((value) => ({
        name: value,
        mark: { label: `${label}: ${value}`, condition: { [key]: [value] } },
      })),
    ),
});

const relationHit = (
  name: string,
  relation: Readonly<Record<string, string>>,
  exists: boolean,
  key?: string,
): KindValue => ({
  name,
  ...(key === undefined ? {} : { key }),
  mark: { label: `relation: ${name}`, condition: { relation, exists } },
});

/** Parent and child are the ends of a derivation (glossary); evidence is a direction of its own. */
const RELATION_ENDS: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
  ["child", { meaning: "derivation", direction: "down" }],
  ["parent", { meaning: "derivation", direction: "up" }],
  ["evidence", { direction: "evidence" }],
];

/** The kinds of a condition, in the order the prompts offer them (SR-215 AK3, SR-124 AK5). */
export const CONDITION_KINDS: readonly ConditionKind[] = [
  {
    key: "type",
    name: "Type",
    hits: async ({ call }: KindSource): Promise<KindHits> => {
      const answer = await call("metamodel.get", {});
      return answer.ok
        ? answer.output.types.map((type) => ({
            name: type.name,
            key: type.key,
            mark: stepMark(typeStep(type.key)),
          }))
        : { failed: answer.message };
    },
  },
  {
    key: "status",
    name: "Status",
    hits: async ({ call, facets }: KindSource): Promise<KindHits> => {
      const [found, metamodel] = await Promise.all([facets(), call("metamodel.get", {})]);
      if (!found.ok) {
        return { failed: found.message };
      }
      if (!metamodel.ok) {
        return { failed: metamodel.message };
      }
      return found.output.statuses.map(({ key }) => {
        const name = metamodel.output.statuses.find((status) => status.key === key)?.name ?? key;
        return { name, ...(name === key ? {} : { key }), mark: stepMark(statusStep(key)) };
      });
    },
  },
  {
    key: "property",
    name: "Property",
    hits: async ({ facets }: KindSource): Promise<KindHits> => {
      const found = await facets();
      return found.ok
        ? choosableProperties(found.output).map(({ facet }) => ({
            name: facet.name,
            key: facet.key,
            values: valueHits(facet),
          }))
        : { failed: found.message };
    },
  },
  enumKind("verification", "Verification status", "verification"),
  enumKind("validation", "Validation status", "validation"),
  {
    key: "validFor",
    name: "Validity",
    hits: async ({ call }: KindSource): Promise<KindHits> => {
      const views = await viewsOf(call);
      return views.ok
        ? views.views.map((shown) => ({
            name: viewName(shown),
            key: shown.view,
            mark: { label: `validity: ${viewName(shown)}`, condition: { validFor: shown.view } },
          }))
        : { failed: views.message };
    },
  },
  {
    key: "relation",
    name: "Relation",
    hits: async ({ call }: KindSource): Promise<KindHits> => {
      const answer = await call("metamodel.get", {});
      if (!answer.ok) {
        return { failed: answer.message };
      }
      const kinds = [
        ...answer.output.relations.map((kind) => ({ key: kind.key, name: kind.name })),
        ...answer.output.properties.filter((property) => property.kind === "relation"),
      ];
      return [
        ...RELATION_ENDS.flatMap(([end, relation]) => [
          relationHit(`without ${end}`, relation, false),
          relationHit(`with ${end}`, relation, true),
        ]),
        ...kinds.flatMap(({ key, name }) => [
          relationHit(`without ${name}`, { kind: key }, false, key),
          relationHit(`with ${name}`, { kind: key }, true, key),
        ]),
      ];
    },
  },
  { key: "text", name: "Text search" },
];
