// The steps of the twelve commands that change the metamodel (SR-236 AK11, the mockup of #1931): the
// command prompt asks only what the place does not give (D-077), the definition, the field to change and its
// new value, one step at a time, in place of the walk over the catalog's arguments (`catalog-commands.ts`).
//
// - Each step offers the definitions of the metamodel (`metamodel.get`) as hits with their key beside
//   (SR-215 AK1); "Add property" and "Add status" also take a typed name, which starts a new definition.
// - The key of a new definition is prefilled with the key core makes from its name, and the prefix of a new
//   type with the initials of its name (`@reqseq/core/suggested-key`, SR-236 AK6); both can be changed before it runs.
// - A field whose change the use of the definition locks shows the number of uses from `metamodel.get uses`
//   and cannot be chosen (SR-236 AK8): the prefix of a type and the abstract mark of one without it (removing
//   it always works, SR-237 AK3), the value kind and several values of a property, and a fixed value that
//   elements have, which cannot be removed.
// - Several types are marks, with "Any type" as a hit of its own that writes no list; fixed values are marks of
//   name and key; limits are the target types marked for them ("Limits for", from every type), then a minimum
//   and a maximum per marked type, each a number or empty (SR-236 AK11). Escape keeps the marks of a step, and
//   the step shows them when it is asked again (SR-215 AK5, AK9).
// - Values given before the prompt asks (`startCommand`'s `prefilled`, SR-199) count as answered.
//
// The app builds the input and decides nothing about what is allowed (ADR-0002): core checks it. A refusal of
// the input asks the step it names again with core's message (`refusedStep`), any other refusal, such as a
// read-only metamodel repository (SR-236 AK5), is said in the echo area and nothing more is asked.

import type { CommandTypes } from "@reqseq/core";
import { keyFromName, prefixFromName } from "@reqseq/core/suggested-key";
import type { CommandListing } from "../shared/protocol.js";
import type { ArgumentExplanation, Choice, Prompt, PromptFill, PromptMark } from "./action-types.js";
import type { CatalogContext } from "./catalog-arguments.js";
import { schemaOf } from "./catalog-arguments.js";
import type { Entry } from "./catalog-entry.js";
import type { Prefilled } from "./matrix-menu.js";
import { drafted, notSaved, show } from "./catalog-preview.js";
import { askTypes, typeMark } from "./type-mark.js";

type Metamodel = CommandTypes["metamodel.get"]["output"];
type Values = Readonly<Record<string, unknown>>;
type Input = Record<string, unknown>;

/** A value a step gives, how the line names it, and the values it gives with it (a new property's name). */
interface Given {
  readonly value: unknown;
  readonly label: string;
  readonly also?: Values;
}

/** One hit of a step; a locked one shows why and cannot be chosen (SR-236 AK8). */
interface Hit {
  readonly name: string;
  readonly key?: string;
  readonly locked?: string;
  readonly given: Given;
}

/** What a step asks. */
type Ask =
  /** Hits, and with `typed` a typed text as a hit of its own ("New property <text>"). */
  | {
      readonly kind: "hits";
      readonly hits: readonly Hit[];
      readonly typed?: (text: string) => Hit | undefined;
    }
  /** Typed text, starting with `initial`; an empty input gives `empty`, else it is asked again. */
  | {
      readonly kind: "text";
      readonly initial?: string;
      readonly empty?: Given;
      readonly parse?: (text: string) => Given | undefined;
    }
  /**
   * Several types as marks (SR-215 AK5), starting with `initial`; while the mark is empty a hit `anyName`
   * ("Any type") comes first, which gives `any`.
   */
  | {
      readonly kind: "types";
      readonly any: Given;
      readonly anyName?: string;
      readonly initial?: readonly string[];
    }
  /** New fixed values as marks of name and key; an empty input without marks gives `none`. */
  | { readonly kind: "choices"; readonly none?: Given };

interface Step {
  /** The value's name in `Values`: a field of the input, or a value of the steps (`what`). */
  readonly id: string;
  readonly label: string;
  readonly ask: Ask;
}

/** The steps of one command for the values given so far, and the input they make. */
interface Flow {
  readonly steps: (metamodel: Metamodel, values: Values) => readonly Step[];
  readonly input: (values: Values, metamodel: Metamodel) => Input;
}

/**
 * One answer: the step, its value and its label; one given before the prompt asked is `prefilled`. An answer of
 * a marks step keeps its `marks` (the type keys, the new fixed values), which show again when it is asked again.
 */
interface Answer extends Given {
  readonly id: string;
  readonly prefilled?: true;
  readonly marks?: readonly unknown[];
}

/** Where the entry of one command stands. */
interface State {
  readonly context: CatalogContext;
  readonly command: CommandListing;
  readonly flow: Flow;
  readonly metamodel: Metamodel;
  readonly answers: readonly Answer[];
  /**
   * The marks of the marks steps left without taking them, or asked again, by `draftKey`: Escape removes no
   * mark, and a step asked again shows its marks again (SR-215 AK5, AK9).
   */
  readonly drafts: Readonly<Record<string, readonly unknown[]>>;
  /** Core's message of the refusal, said in the step asked again. */
  readonly error?: string;
}

const valuesOf = (answers: readonly Answer[]): Values =>
  Object.fromEntries(
    answers.flatMap((answer) => [[answer.id, answer.value], ...Object.entries(answer.also ?? {})]),
  );

/** The fields of `values` that the input has, without those left out (`undefined`). */
const pick = (values: Values, fields: readonly string[]): Input =>
  Object.fromEntries(
    fields.flatMap((field) => (values[field] === undefined ? [] : [[field, values[field]]])),
  );

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/** "locked: 3 elements", for a field whose change the use locks (SR-236 AK8); none while unused. */
const lockedBy = (uses: number | undefined): string | undefined =>
  uses === undefined || uses === 0 ? undefined : `locked: ${plural(uses, "element")}`;

/** The number of uses of the definition `key` in a list of `metamodel.get uses`; none for a key it has not. */
const usesOf = (list: readonly { readonly key: string; readonly count: number }[], key: unknown) =>
  list.find((entry) => entry.key === key)?.count;

/** The numbers of uses of the fixed values of the property `key`, by choice key. */
const valueUses = (metamodel: Metamodel, key: string): Readonly<Record<string, number>> =>
  Object.fromEntries(
    metamodel.uses.values
      .filter((entry) => entry.property === key)
      .map((entry) => [entry.value, entry.count]),
  );

const YES_NO: readonly Hit[] = [
  { name: "no", given: { value: false, label: "no" } },
  { name: "yes", given: { value: true, label: "yes" } },
];

const typeHits = (metamodel: Metamodel, keep: (type: Metamodel["types"][number]) => boolean = () => true) =>
  metamodel.types
    .filter(keep)
    .map((type): Hit => ({ name: type.name, key: type.key, given: { value: type.key, label: type.name } }));

const propertyHits = (properties: Metamodel["properties"]): readonly Hit[] =>
  properties.map((property) => ({
    name: property.name,
    key: property.key,
    given: { value: property.key, label: property.name },
  }));

const statusHits = (statuses: Metamodel["statuses"]): readonly Hit[] =>
  statuses.map((status) => ({
    name: status.name,
    key: status.key,
    given: { value: status.key, label: status.name },
  }));

const kindHits = (metamodel: Metamodel): readonly Hit[] =>
  metamodel.relations.map((kind) => ({
    name: kind.name,
    key: kind.key,
    given: { value: kind.key, label: kind.name },
  }));

/** A value of an enum as a hit names it. */
const shownValue = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** The values the catalog fixes for `field` (`choice`), null as `none` ("No meaning"). */
const enumHits = (command: CommandListing, field: string, none: string): readonly Hit[] =>
  (schemaOf(command, field).enum ?? []).map((value) =>
    value === null
      ? { name: none, given: { value: null, label: none } }
      : { name: shownValue(value), given: { value, label: shownValue(value) } },
  );

/** Whether `field` of `command` takes null: a change that removes the line (`description: null`). */
const nullable = (command: CommandListing, field: string): boolean => {
  const schema = schemaOf(command, field) as { readonly anyOf?: readonly { readonly type?: unknown }[] };
  return schema.anyOf?.some((part) => part.type === "null") === true;
};

/** A text step; with `empty` an empty input gives it. */
const text = (id: string, label: string, initial?: string, empty?: Given): Step => ({
  id,
  label,
  ask: {
    kind: "text",
    ...(initial === undefined ? {} : { initial }),
    ...(empty === undefined ? {} : { empty }),
  },
});

/** The key of a new definition, prefilled with the key core makes from its name (SR-236 AK6). */
const keyStep = (name: unknown): Step => text("key", "Key", keyFromName(String(name)).key);

/** A number or empty (SR-236 AK11): empty gives `empty`. */
const numberStep = (id: string, label: string, initial: number | undefined, empty: Given): Step => ({
  id,
  label,
  ask: {
    kind: "text",
    ...(initial === undefined ? {} : { initial: String(initial) }),
    empty,
    parse: (typed) => {
      const given = typed.trim();
      // Digits only are a number; other text goes in as it is typed, and core says what is wrong with it.
      return { value: /^\d+$/u.test(given) ? Number(given) : given, label: given };
    },
  },
});

const NONE: Given = { value: undefined, label: "" };
const REMOVED: Given = { value: null, label: "none" };

/** The target types picked for limits ("Limits for"), in their order; none before the step is answered. */
const limitTargets = (values: Values): readonly string[] =>
  Array.isArray(values["limitTargets"]) ? (values["limitTargets"] as readonly string[]) : [];

type Limits = NonNullable<Metamodel["relations"][number]["limits"]>;

/** The limits for any source type (none with `source-type`): the ones the limit steps ask and change. */
const askedLimits = (limits: Limits = []): Limits =>
  limits.filter((limit) => limit["source-type"] === undefined);

/**
 * "Limits for": the target types that get a minimum and a maximum, as marks from every type (SR-236 AK11), so a
 * kind open to any type and a subtype of a target type get limits too. The target types of the limits there
 * are marked to start with; with no mark, "No limits" gives none.
 */
const limitTargetsStep = (limits: Limits = []): Step => ({
  id: "limitTargets",
  label: "Limits for",
  ask: {
    kind: "types",
    any: { value: [], label: "no limits" },
    anyName: "No limits",
    initial: [...new Set(askedLimits(limits).map((limit) => limit["target-type"]))],
  },
});

/** The limits the minimum and maximum steps give, one per target type with a number; none when all are empty. */
const limitsOf = (values: Values): readonly { readonly "target-type": string }[] =>
  limitTargets(values).flatMap((target) => {
    const min = values[`min:${target}`];
    const max = values[`max:${target}`];
    return min === undefined && max === undefined
      ? []
      : [
          {
            "target-type": target,
            ...(min === undefined ? {} : { min }),
            ...(max === undefined ? {} : { max }),
          },
        ];
  });

/**
 * The minimum and maximum steps per target type picked (SR-236 AK11), each with the limit there is as its
 * start; of several limits to one target type, the first that has it.
 */
const limitSteps = (metamodel: Metamodel, values: Values, limits: Limits = []): readonly Step[] =>
  limitTargets(values).flatMap((target) => {
    const name = metamodel.types.find((type) => type.key === target)?.name ?? target;
    const given = askedLimits(limits).filter((limit) => limit["target-type"] === target);
    return [
      numberStep(
        `min:${target}`,
        `At least, to ${name}`,
        given.find((limit) => limit.min !== undefined)?.min,
        NONE,
      ),
      numberStep(
        `max:${target}`,
        `At most, to ${name}`,
        given.find((limit) => limit.max !== undefined)?.max,
        NONE,
      ),
    ];
  });

/** A choice of the "Change" step: the field's name, the steps of its new value, and whether it is locked. */
interface Field {
  readonly name: string;
  readonly locked?: string;
  readonly steps: readonly Step[];
}

/** The "Change" step (D-077): the fields of the definition by name; a locked one is not chosen (SR-236 AK8). */
const whatStep = (fields: readonly Field[]): Step => ({
  id: "what",
  label: "Change",
  ask: {
    kind: "hits",
    hits: fields.map((field) => ({
      name: field.name,
      ...(field.locked === undefined ? {} : { locked: field.locked }),
      given: { value: field.name, label: field.name },
    })),
  },
});

/** The steps of a change: the "Change" step, then the steps of the field chosen. */
const changeSteps = (fields: readonly Field[], values: Values): readonly Step[] => [
  whatStep(fields),
  ...(fields.find((field) => field.name === values["what"])?.steps ?? []),
];

/** The text field of a change: the current value to start with, empty removes it where the field takes null. */
const textField = (
  command: CommandListing,
  field: string,
  name: string,
  current: string | undefined,
): Field => ({
  name,
  // "New value", as the field's name is in the line already (the mockup of #1931).
  steps: [text(field, "New value", current, nullable(command, field) ? REMOVED : undefined)],
});

const booleanField = (field: string, name: string, locked?: string): Field => ({
  name,
  ...(locked === undefined ? {} : { locked }),
  steps: [{ id: field, label: "New value", ask: { kind: "hits", hits: YES_NO } }],
});

const typesStep = (id: string, label: string, any: Given): Step => ({
  id,
  label,
  ask: { kind: "types", any },
});

const meaningField = (command: CommandListing): Field => ({
  name: "Meaning",
  steps: [
    {
      id: "meaning",
      label: "Meaning",
      ask: { kind: "hits", hits: enumHits(command, "meaning", "No meaning") },
    },
  ],
});

const typeOf = (metamodel: Metamodel, key: unknown): Metamodel["types"][number] | undefined =>
  metamodel.types.find((type) => type.key === key);
const propertyOf = (metamodel: Metamodel, key: unknown): Metamodel["properties"][number] | undefined =>
  metamodel.properties.find((property) => property.key === key);

/** The fields of the fixed values of a property (SR-238 AK3): add, rename, and remove one that is unused (AK8). */
const choiceFields = (
  property: Metamodel["properties"][number] | undefined,
  used: Readonly<Record<string, number>>,
  values: Values,
): readonly Field[] => {
  const choices = property?.choices ?? [];
  const choice = choices.find((given) => given.key === values["choice"]);
  const pickChoice: Step = {
    id: "choice",
    label: "Fixed value",
    ask: {
      kind: "hits",
      hits: choices.map((given) => ({
        name: given.name,
        key: given.key,
        given: { value: given.key, label: given.name },
      })),
    },
  };
  return [
    ...(property?.kind === "choice"
      ? [
          {
            name: "Add fixed values",
            steps: [
              {
                id: "addChoices",
                label: "Fixed value",
                // At least one: a change without a fixed value would change nothing.
                ask: { kind: "choices" },
              } satisfies Step,
            ],
          },
        ]
      : []),
    ...(choices.length > 0
      ? [
          {
            name: "Rename fixed value",
            steps: [pickChoice, text("choiceName", "New name", choice?.name)],
          },
          {
            name: "Describe fixed value",
            steps: [
              pickChoice,
              // Empty removes the description.
              text("choiceDescription", "Description", choice?.description, REMOVED),
            ],
          },
          {
            name: "Remove fixed value",
            steps: [
              {
                id: "removeChoices",
                label: "Fixed value",
                ask: {
                  kind: "hits",
                  hits: choices.map((given) => {
                    const lock = lockedBy(used[given.key]);
                    return {
                      name: given.name,
                      key: given.key,
                      ...(lock === undefined ? {} : { locked: lock }),
                      given: { value: [given.key], label: given.name },
                    };
                  }),
                },
              } satisfies Step,
            ],
          },
        ]
      : []),
  ];
};

/** The flows by command; each reads its command for the values the catalog fixes. */
const flows = (command: CommandListing): Flow | undefined => {
  switch (command.name) {
    case "metamodel.addType":
      return {
        steps: (metamodel, values) => [
          text("name", "Name"),
          keyStep(values["name"]),
          text(
            "prefix",
            "Prefix",
            prefixFromName(
              String(values["name"]),
              metamodel.types.map((type) => type.prefix),
            ),
          ),
          {
            id: "extends",
            label: "Parent type",
            ask: { kind: "hits", hits: [{ name: "No parent type", given: NONE }, ...typeHits(metamodel)] },
          },
          { id: "abstract", label: "Abstract", ask: { kind: "hits", hits: YES_NO } },
        ],
        input: (values) => ({
          ...pick(values, ["name", "key", "prefix", "extends"]),
          // `abstract: false` is the default, so only `true` goes in.
          ...(values["abstract"] === true ? { abstract: true } : {}),
        }),
      };
    case "metamodel.changeType":
      return {
        steps: (metamodel, values) => {
          const type = typeOf(metamodel, values["type"]);
          const locked = lockedBy(usesOf(metamodel.uses.types, values["type"]));
          return [
            { id: "type", label: "Type", ask: { kind: "hits", hits: typeHits(metamodel) } },
            ...changeSteps(
              [
                textField(command, "name", "Name", type?.name),
                textField(command, "description", "Description", type?.description),
                {
                  ...textField(command, "prefix", "Prefix", type?.prefix),
                  ...(locked === undefined ? {} : { locked }),
                },
                {
                  name: "Parent type",
                  steps: [
                    {
                      id: "extends",
                      label: "Parent type",
                      ask: {
                        kind: "hits",
                        hits: [
                          { name: "No parent type", given: REMOVED },
                          ...typeHits(metamodel, (other) => other.key !== type?.key),
                        ],
                      },
                    },
                  ],
                },
                // Removing the abstract mark always works (SR-237 AK3).
                booleanField("abstract", "Abstract", type?.abstract === true ? undefined : locked),
                meaningField(command),
              ],
              values,
            ),
          ];
        },
        input: (values) =>
          pick(values, ["type", "name", "description", "prefix", "extends", "abstract", "meaning"]),
      };
    case "metamodel.removeType":
      return {
        steps: (metamodel) => [
          { id: "type", label: "Type", ask: { kind: "hits", hits: typeHits(metamodel) } },
        ],
        input: (values) => pick(values, ["type"]),
      };
    case "metamodel.addProperty":
      return {
        steps: (metamodel, values) => {
          const type = typeOf(metamodel, values["type"]);
          const fresh = values["name"] !== undefined;
          const kind = values["kind"];
          return [
            { id: "type", label: "Type", ask: { kind: "hits", hits: typeHits(metamodel) } },
            {
              id: "property",
              label: "Property",
              ask: {
                kind: "hits",
                hits: propertyHits(
                  metamodel.properties.filter((property) => type?.properties.includes(property.key) !== true),
                ),
                typed: (typed) =>
                  typed.trim() === ""
                    ? undefined
                    : {
                        name: `New property ${typed.trim()}`,
                        given: { value: undefined, label: typed.trim(), also: { name: typed.trim() } },
                      },
              },
            },
            ...(fresh
              ? [
                  keyStep(values["name"]),
                  {
                    id: "kind",
                    label: "Value kind",
                    ask: { kind: "hits", hits: enumHits(command, "kind", "") },
                  } satisfies Step,
                  ...(kind === "choice"
                    ? [
                        {
                          id: "choices",
                          label: "Fixed value",
                          ask: { kind: "choices", none: NONE },
                        } satisfies Step,
                      ]
                    : []),
                  ...(kind === "relation" ? [typesStep("targetTypes", "Target types", NONE)] : []),
                  { id: "many", label: "Several values", ask: { kind: "hits", hits: YES_NO } } satisfies Step,
                  ...(values["many"] === true && kind !== "relation"
                    ? [numberStep("maxItems", "Most entries", undefined, NONE)]
                    : []),
                ]
              : []),
            { id: "required", label: "Required", ask: { kind: "hits", hits: YES_NO } },
          ];
        },
        input: (values) => ({
          ...pick(values, [
            "type",
            "required",
            "property",
            "name",
            "key",
            "kind",
            "choices",
            "targetTypes",
            "maxItems",
          ]),
          // `many: false` is the default, so only `true` goes in.
          ...(values["many"] === true ? { many: true } : {}),
        }),
      };
    case "metamodel.changeProperty":
      return {
        steps: (metamodel, values) => {
          const property = propertyOf(metamodel, values["property"]);
          const key = String(values["property"]);
          const locked = lockedBy(usesOf(metamodel.uses.properties, key));
          const fields: Field[] = [
            textField(command, "name", "Name", property?.name),
            textField(command, "description", "Description", property?.description),
            {
              name: "Value kind",
              ...(locked === undefined ? {} : { locked }),
              steps: [
                {
                  id: "kind",
                  label: "Value kind",
                  ask: { kind: "hits", hits: enumHits(command, "kind", "") },
                },
              ],
            },
            booleanField("many", "Several values", locked),
            ...(property?.many === true && property.kind !== "relation"
              ? [
                  {
                    name: "Most entries",
                    steps: [numberStep("maxItems", "New value", property["max-items"], REMOVED)],
                  },
                ]
              : []),
            ...(property?.kind === "relation"
              ? [{ name: "Target types", steps: [typesStep("targetTypes", "Target types", REMOVED)] }]
              : []),
            ...(property?.kind === "text" ? [booleanField("markdown", "Markdown")] : []),
            booleanField("content", "Part of the version"),
            meaningField(command),
            {
              name: "Required in a type",
              steps: [
                {
                  id: "type",
                  label: "Type",
                  ask: { kind: "hits", hits: typeHits(metamodel, (type) => type.properties.includes(key)) },
                },
                { id: "required", label: "Required", ask: { kind: "hits", hits: YES_NO } },
              ],
            },
            ...choiceFields(property, valueUses(metamodel, key), values),
          ];
          return [
            {
              id: "property",
              label: "Property",
              ask: { kind: "hits", hits: propertyHits(metamodel.properties) },
            },
            ...changeSteps(fields, values),
          ];
        },
        input: (values) => ({
          ...pick(values, [
            "property",
            "name",
            "description",
            "kind",
            "many",
            "maxItems",
            "targetTypes",
            "markdown",
            "content",
            "meaning",
            "addChoices",
            "removeChoices",
          ]),
          // A type given by the place (SR-199) goes in only with `required`, which core needs with it.
          ...(values["required"] === undefined ? {} : pick(values, ["type", "required"])),
          ...(values["choice"] === undefined
            ? {}
            : {
                changeChoices: [
                  {
                    choice: values["choice"],
                    ...(values["choiceName"] === undefined ? {} : { name: values["choiceName"] }),
                    ...("choiceDescription" in values ? { description: values["choiceDescription"] } : {}),
                  },
                ],
              }),
        }),
      };
    case "metamodel.removeProperty":
      return {
        steps: (metamodel, values) => {
          const type = typeOf(metamodel, values["type"]);
          return [
            { id: "type", label: "Type", ask: { kind: "hits", hits: typeHits(metamodel) } },
            {
              id: "property",
              label: "Property",
              ask: {
                kind: "hits",
                hits: propertyHits(
                  metamodel.properties.filter((property) => type?.properties.includes(property.key) === true),
                ),
              },
            },
          ];
        },
        input: (values) => pick(values, ["type", "property"]),
      };
    case "metamodel.addRelationKind":
      return {
        steps: (metamodel, values) => [
          text("name", "Name"),
          keyStep(values["name"]),
          text("inverseName", "Inverse name", undefined, NONE),
          typesStep("sourceTypes", "Source types", NONE),
          typesStep("targetTypes", "Target types", NONE),
          limitTargetsStep(),
          ...limitSteps(metamodel, values),
        ],
        input: (values) => {
          const limits = limitsOf(values);
          return {
            ...pick(values, ["name", "key", "inverseName", "sourceTypes", "targetTypes"]),
            ...(limits.length === 0 ? {} : { limits }),
          };
        },
      };
    case "metamodel.changeRelationKind":
      return {
        steps: (metamodel, values) => {
          const kind = metamodel.relations.find((given) => given.key === values["kind"]);
          return [
            { id: "kind", label: "Relation kind", ask: { kind: "hits", hits: kindHits(metamodel) } },
            ...changeSteps(
              [
                textField(command, "name", "Name", kind?.name),
                textField(command, "inverseName", "Inverse name", kind?.["inverse-name"]),
                textField(command, "description", "Description", kind?.description),
                { name: "Source types", steps: [typesStep("sourceTypes", "Source types", REMOVED)] },
                { name: "Target types", steps: [typesStep("targetTypes", "Target types", REMOVED)] },
                {
                  name: "Limits",
                  steps: [limitTargetsStep(kind?.limits), ...limitSteps(metamodel, values, kind?.limits)],
                },
                meaningField(command),
              ],
              values,
            ),
          ];
        },
        input: (values, metamodel) => {
          const base = pick(values, [
            "kind",
            "name",
            "inverseName",
            "description",
            "sourceTypes",
            "targetTypes",
            "meaning",
          ]);
          if (values["what"] !== "Limits") {
            return base;
          }
          // The limits for one source type, which the steps do not ask, stay; every other limit is shown with its
          // target type marked, and a target type unmarked or with both numbers empty loses its limit.
          // Each limit keeps its place in the list; a new target type comes at the end.
          const asked = new Map(limitsOf(values).map((limit) => [limit["target-type"], limit]));
          const limits = (
            metamodel.relations.find((given) => given.key === values["kind"])?.limits ?? []
          ).flatMap((limit): readonly object[] => {
            if (limit["source-type"] !== undefined) {
              return [limit];
            }
            const changed = asked.get(limit["target-type"]);
            asked.delete(limit["target-type"]);
            return changed === undefined ? [] : [changed];
          });
          const all = [...limits, ...asked.values()];
          return { ...base, limits: all.length === 0 ? null : all };
        },
      };
    case "metamodel.removeRelationKind":
      return {
        steps: (metamodel) => [
          { id: "kind", label: "Relation kind", ask: { kind: "hits", hits: kindHits(metamodel) } },
        ],
        input: (values) => pick(values, ["kind"]),
      };
    case "metamodel.addStatus":
      return {
        steps: (metamodel, values) => {
          const type = typeOf(metamodel, values["type"]);
          return [
            { id: "type", label: "Type", ask: { kind: "hits", hits: typeHits(metamodel) } },
            {
              id: "status",
              label: "Status",
              ask: {
                kind: "hits",
                hits: statusHits(
                  metamodel.statuses.filter((status) => type?.statuses.includes(status.key) !== true),
                ),
                typed: (typed) =>
                  typed.trim() === ""
                    ? undefined
                    : {
                        name: `New status ${typed.trim()}`,
                        given: { value: undefined, label: typed.trim(), also: { name: typed.trim() } },
                      },
              },
            },
            ...(values["name"] === undefined
              ? []
              : [
                  keyStep(values["name"]),
                  { id: "invalid", label: "Invalid", ask: { kind: "hits", hits: YES_NO } } satisfies Step,
                ]),
          ];
        },
        input: (values) => ({
          ...pick(values, ["type", "status", "name", "key"]),
          ...(values["invalid"] === true ? { invalid: true } : {}),
        }),
      };
    case "metamodel.changeStatus":
      return {
        steps: (metamodel, values) => {
          const status = metamodel.statuses.find((given) => given.key === values["status"]);
          return [
            { id: "status", label: "Status", ask: { kind: "hits", hits: statusHits(metamodel.statuses) } },
            ...changeSteps(
              [
                textField(command, "name", "Name", status?.name),
                textField(command, "description", "Description", status?.description),
                booleanField("invalid", "Invalid"),
                booleanField("initial", "Initial status"),
              ],
              values,
            ),
          ];
        },
        input: (values) => pick(values, ["status", "name", "description", "invalid", "initial"]),
      };
    case "metamodel.removeStatus":
      return {
        steps: (metamodel, values) => {
          const type = typeOf(metamodel, values["type"]);
          return [
            { id: "type", label: "Type", ask: { kind: "hits", hits: typeHits(metamodel) } },
            {
              id: "status",
              label: "Status",
              ask: {
                kind: "hits",
                hits: statusHits(
                  metamodel.statuses.filter((status) => type?.statuses.includes(status.key) === true),
                ),
              },
            },
          ];
        },
        input: (values) => pick(values, ["type", "status"]),
      };
    default:
      return undefined;
  }
};

/** Whether the prompt asks `command` in steps of its own here. */
export const asksInSteps = (command: CommandListing): boolean => flows(command) !== undefined;

/** "Change property definition Requirement Type Name": the title and the labels given. */
const lineOf = (state: State): string =>
  [state.command.title, ...state.answers.map((answer) => answer.label).filter((label) => label !== "")].join(
    " ",
  );

/** The entry `show` names the result by (its line), as the walk over the catalog has it. */
const entryOf = (state: State): Entry => ({
  command: state.command,
  given: state.answers.map((answer, at) => ({
    field: answer.id,
    value: answer.value,
    label: answer.label,
    rank: at + 1,
  })),
  more: false,
});

/** The explanation line of a step (SR-210 AK2): the field and its description in the catalog. */
const explainOf = (state: State, step: Step, skips: boolean): ArgumentExplanation => {
  const { description } = schemaOf(state.command, step.id);
  return {
    name: step.label,
    ...(typeof description === "string" ? { description } : {}),
    list: false,
    ends: false,
    skips,
    more: false,
  };
};

/** The next step: the first one without an answer, or none: then the command runs. */
const nextStep = (state: State): Step | undefined => {
  const values = valuesOf(state.answers);
  return state.flow.steps(state.metamodel, values).find((step) => !(step.id in values));
};

/** Where the marks of step `id` are kept: the step and the answers before it, as the step depends on them. */
const draftKey = (answers: readonly Answer[], id: string): string =>
  // A value left out (`undefined`) is not the null that removes a field.
  JSON.stringify([...answers.map((given) => [given.id, given.value === undefined ? {} : given.value]), id]);

/** The drafts with the marks `marks` of step `id` after `answers`; none is a draft too, an empty mark. */
const withDraft = (
  drafts: State["drafts"],
  answers: readonly Answer[],
  id: string,
  marks: readonly unknown[],
): State["drafts"] => ({
  ...drafts,
  [draftKey(answers, id)]: marks,
});

/** The marks step `step` was left with, or answered with before it is asked again; none before. */
const draftOf = (state: State, step: Step): readonly unknown[] | undefined =>
  state.drafts[draftKey(state.answers, step.id)];

/**
 * The answers before `at`, the marks of each answer from `at` on kept as a draft, so a marks step asked again
 * shows them (SR-215 AK9).
 */
const dropFrom = (state: State, at: number): Pick<State, "answers" | "drafts"> => ({
  answers: state.answers.slice(0, at),
  drafts: state.answers
    .slice(at)
    .reduce(
      (drafts, given, place) =>
        given.marks === undefined
          ? drafts
          : withDraft(drafts, state.answers.slice(0, at + place), given.id, given.marks),
      state.drafts,
    ),
});

/**
 * Takes `given` for `step` and goes on. An answer of a marks step keeps its `marks`, none for "Any type" and
 * the like, which a step asked again shows (`dropFrom`).
 */
const answer = (state: State, step: Step, given: Given, marks: readonly unknown[] = []): void => {
  const { error: _error, ...rest } = state;
  const kept = step.ask.kind === "types" || step.ask.kind === "choices" ? { marks } : {};
  proceed({ ...rest, answers: [...rest.answers, { id: step.id, ...given, ...kept }] });
};

/**
 * One step back: the answer given last is asked again; before the first (or only those given before), the
 * command prompt. A marks step keeps the `marks` of `step` it leaves: Escape removes no mark (SR-215 AK9).
 */
const back = (state: State, step?: Step, marks: readonly unknown[] = []): void => {
  const { error: _error, ...rest } = state;
  const kept: State = {
    ...rest,
    drafts: step === undefined ? rest.drafts : withDraft(rest.drafts, rest.answers, step.id, marks),
  };
  const last = kept.answers.at(-1);
  if (last === undefined || last.prefilled === true) {
    state.context.reopen();
    return;
  }
  proceed({ ...kept, ...dropFrom(kept, kept.answers.length - 1) });
};

const choiceOf = (state: State, step: Step, hit: Hit, at: number): Choice => {
  const run = (): void => {
    answer(state, step, hit.given);
  };
  return {
    id: `${String(at)}:${hit.name}`,
    name: hit.name,
    ...(hit.locked === undefined
      ? hit.key === undefined || hit.key === hit.name
        ? {}
        : { hint: hit.key }
      : { hint: hit.locked, inert: true }),
    run,
    more: run,
  };
};

/** The prompt of a step of hits or text; the types and fixed values ask steps of their own (`askStep`). */
const promptOf = (state: State, step: Step): Prompt | undefined => {
  const label = `${state.error === undefined ? "" : `${state.error} · `}${lineOf(state)} · ${step.label}:`;
  const shared = {
    label,
    back: () => {
      back(state);
    },
  };
  const { ask } = step;
  if (ask.kind === "hits") {
    return {
      ...shared,
      explain: explainOf(state, step, false),
      items: ask.hits.map((hit, at) => choiceOf(state, step, hit, at)),
      ...(ask.typed === undefined
        ? {}
        : {
            literal: (typed: string) => {
              const hit = ask.typed?.(typed);
              return hit === undefined ? undefined : choiceOf(state, step, hit, -1);
            },
          }),
    };
  }
  if (ask.kind !== "text") {
    return undefined;
  }
  const take = (typed: string): void => {
    if (typed.trim() === "") {
      if (ask.empty === undefined) {
        askStep(state, step);
      } else {
        answer(state, step, ask.empty);
      }
      return;
    }
    answer(state, step, ask.parse?.(typed) ?? { value: typed.trim(), label: typed.trim() });
  };
  return {
    ...shared,
    explain: explainOf(state, step, ask.empty !== undefined),
    items: [],
    ...(ask.initial === undefined || ask.initial === "" ? {} : { initial: ask.initial }),
    text: take,
    more: take,
    ...(ask.empty === undefined
      ? {}
      : {
          empty: () => {
            take("");
          },
        }),
  };
};

/** Asks `step`. */
const askStep = (state: State, step: Step): void => {
  const prompt = promptOf(state, step);
  if (prompt !== undefined) {
    state.context.ask(prompt);
  } else if (step.ask.kind === "types") {
    askTypeMarks(
      state,
      step,
      step.ask,
      (draftOf(state, step) as readonly string[] | undefined) ?? step.ask.initial ?? [],
    );
  } else if (step.ask.kind === "choices") {
    askChoices(state, step, step.ask.none, (draftOf(state, step) as readonly NewChoice[] | undefined) ?? []);
  }
};

/**
 * Several types as marks (SR-236 AK11, SR-215 AK5): "Any type" (`anyName`) first while the mark is empty, which
 * gives `any`; Escape goes back with the mark kept.
 */
const askTypeMarks = (
  state: State,
  step: Step,
  ask: Extract<Ask, { kind: "types" }>,
  keys: readonly string[],
): void => {
  const label = `${state.error === undefined ? "" : `${state.error} · `}${lineOf(state)} · ${step.label}:`;
  const names = (given: readonly string[]): string =>
    given.map((key) => typeOf(state.metamodel, key)?.name ?? key).join(", ");
  askTypes({
    ask: (prompt: Prompt) => {
      const anyHit: Choice = {
        id: "any",
        name: ask.anyName ?? "Any type",
        run: () => {
          answer(state, step, ask.any);
        },
      };
      state.context.ask(
        (prompt.marks?.length ?? 0) > 0
          ? prompt
          : {
              ...prompt,
              // With the types, not before them: a key typed while they load would cancel an Enter on it (SR-119),
              // as `askTypes` holds "Take <n> types" back.
              ...(prompt.fill === undefined
                ? {}
                : {
                    fill: prompt.fill.then((filled): PromptFill => ({
                      ...filled,
                      items: [anyHit, ...(filled.items ?? [])],
                    })),
                  }),
            },
      );
    },
    call: state.context.call,
    label,
    keys,
    marks: (given): readonly PromptMark[] =>
      given.length === 0
        ? []
        : [
            {
              label: typeMark(given).label,
              remove: () => {
                askTypeMarks(state, step, ask, []);
              },
            },
          ],
    take: (given) => {
      answer(state, step, { value: [...given], label: names(given) }, given);
    },
    back: (given) => {
      back(state, step, given);
    },
    explain: explainOf(state, step, false),
  });
};

interface NewChoice {
  readonly name: string;
  readonly key: string;
}

/**
 * New fixed values as marks (SR-236 AK11): a typed name, then its key, prefilled with the key core makes from
 * it (SR-236 AK6), gives a mark "Name · key"; "Take <n> fixed values" takes the marks, and an empty input
 * without one gives `none`.
 */
const askChoices = (state: State, step: Step, none: Given | undefined, marks: readonly NewChoice[]): void => {
  const label = `${state.error === undefined ? "" : `${state.error} · `}${lineOf(state)} · ${step.label}:`;
  const take = (): void => {
    if (marks.length === 0) {
      if (none === undefined) {
        askChoices(state, step, none, marks);
      } else {
        answer(state, step, none);
      }
    } else {
      answer(
        state,
        step,
        {
          value: marks.map((mark) => ({ name: mark.name, key: mark.key })),
          label: marks.map((mark) => mark.name).join(", "),
        },
        marks,
      );
    }
  };
  const shown = (): readonly PromptMark[] =>
    marks.map((mark, at) => ({
      label: `${mark.name} · ${mark.key}`,
      remove: () => {
        askChoices(
          state,
          step,
          none,
          marks.filter((_, place) => place !== at),
        );
      },
    }));
  const named = (name: string): void => {
    const again = (): void => {
      askChoices(state, step, none, marks);
    };
    state.context.ask({
      label: `${state.error === undefined ? "" : `${state.error} · `}${lineOf(state)} · ${step.label} ${name} · Key:`,
      items: [],
      marks: shown(),
      initial: keyFromName(name).key,
      explain: explainOf(state, step, false),
      back: again,
      text: (typed) => {
        if (typed.trim() === "") {
          again();
        } else {
          askChoices(state, step, none, [...marks, { name, key: typed.trim() }]);
        }
      },
    });
  };
  state.context.ask({
    label,
    items:
      marks.length === 0
        ? []
        : [{ id: "take", name: `Take ${plural(marks.length, "fixed value")}`, run: take, more: take }],
    marks: shown(),
    unmark: marks.length > 0,
    explain: {
      ...explainOf(state, step, marks.length === 0),
      building: { enter: "adds the fixed value, or takes the marks", unmark: marks.length > 0, json: false },
    },
    // Escape goes back with the marks kept (SR-215 AK9); Backspace removes the last one (`unmark`).
    back: () => {
      back(state, step, marks);
    },
    literal: (typed) =>
      typed.trim() === ""
        ? undefined
        : {
            id: "new",
            name: `Fixed value ${typed.trim()}`,
            run: () => {
              named(typed.trim());
            },
          },
    empty: take,
  });
};

/** The step core's refusal names (`details.field`, a key it asks for), else the one answered last. */
const refusedStep = (state: State, details: Readonly<Record<string, unknown>> | undefined): number => {
  const named = details?.["reason"] === "key-required" ? "key" : details?.["field"];
  // Limits and fixed value changes are built from steps of their own.
  const field = named === "limits" ? "min:" : named === "changeChoices" ? "choice" : named;
  // The name of a new property or status comes with the answer of its step (`also`).
  const at = state.answers.findIndex(
    (given) =>
      typeof field === "string" &&
      (given.id === field ||
        (field === "min:" && /^(?:min|max):/u.test(given.id)) ||
        (given.also !== undefined && field in given.also)) &&
      given.prefilled !== true,
  );
  // Limits without a number asked: the target types picked for them.
  const targets = field === "min:" ? state.answers.findIndex((given) => given.id === "limitTargets") : -1;
  return at >= 0 ? at : targets >= 0 ? targets : state.answers.length - 1;
};

/** Runs the command with the input the answers make, and shows its output or core's refusal. */
const run = async (state: State): Promise<void> => {
  const { context } = state;
  const entry = entryOf(state);
  const input = state.flow.input(valuesOf(state.answers), state.metamodel);
  if (drafted(context) && (await notSaved(context, entry))) {
    return;
  }
  const revision = context.revision();
  const name = state.command.name as keyof CommandTypes;
  const result = await (context.shownCall ?? context.call)(name, input);
  if (result.ok) {
    // The graph and the text mark what it added or changed (SR-130 AK7).
    context.metamodelChanged?.(name, result.output);
    show(context, entry, input, result.output, revision);
    return;
  }
  const at = result.code === "input.invalid" ? refusedStep(state, result.details) : -1;
  if (at < 0 || state.answers[at]?.prefilled === true) {
    // Nothing to ask again: a read-only repository, a metamodel that does not read (SR-236 AK5).
    context.echo(result.message);
    return;
  }
  // The refused answer is asked again with core's message, and the steps after it, which may read it (a key
  // made from a name, the limits of target types), after it.
  proceed({ ...state, error: result.message, ...dropFrom(state, at) });
};

/** Asks the next step, or runs the command after the last. */
const proceed = (state: State): void => {
  const step = nextStep(state);
  if (step === undefined) {
    void run(state);
  } else {
    askStep(state, step);
  }
};

/** A metamodel without definitions: the first step before the metamodel is read (`startMetamodelCommand`). */
const EMPTY: Metamodel = {
  answer: "",
  types: [],
  properties: [],
  relations: [],
  statuses: [],
  meanings: {},
  relationKinds: {},
  files: [],
  problems: [],
  uses: { types: [], properties: [], values: [], relations: [], statuses: [] },
};

/**
 * Starts the steps of a metamodel command (`asksInSteps`): the first step opens at once with its label, so no
 * key goes to the buffer while the metamodel is read, and its hits fill in when it is there (as the walk over
 * the catalog asks). `prefilled` are the values the place gives (SR-199), by step; when they give every step,
 * the command runs once the metamodel is read.
 */
export const startMetamodelCommand = (
  context: CatalogContext,
  command: CommandListing,
  prefilled: readonly Prefilled[] = [],
): void => {
  const flow = flows(command);
  if (flow === undefined) {
    return;
  }
  const answers = prefilled.map((given): Answer => ({
    id: given.field,
    value: given.value,
    label: given.label,
    prefilled: true,
  }));
  const read = context.call("metamodel.get", {});
  const before: State = { context, command, flow, metamodel: EMPTY, answers, drafts: {} };
  const first = nextStep(before);
  const ready = read.then((answer): State | string =>
    answer.ok ? { ...before, metamodel: answer.output } : answer.message,
  );
  if (first === undefined) {
    void ready.then((state) => {
      if (typeof state === "string") {
        context.echo(state);
      } else {
        proceed(state);
      }
    });
    return;
  }
  const label = `${lineOf(before)} · ${first.label}:`;
  context.ask({
    label,
    items: [],
    back: () => {
      context.reopen();
    },
    fill: ready.then((state): PromptFill => {
      if (typeof state === "string") {
        return { label: `${state} · ${label}` };
      }
      const step = nextStep(state);
      const prompt = step?.id === first.id ? promptOf(state, step) : undefined;
      if (prompt === undefined || prompt.initial !== undefined || prompt.empty !== undefined) {
        // Another kind of step: it takes the place of this prompt.
        proceed(state);
        return {};
      }
      const { label: filled, items, explain, text, more, literal } = prompt;
      return {
        label: filled,
        items,
        ...(explain === undefined ? {} : { explain }),
        ...(text === undefined ? {} : { text }),
        ...(more === undefined ? {} : { more }),
        ...(literal === undefined ? {} : { literal }),
      };
    }),
  });
};
