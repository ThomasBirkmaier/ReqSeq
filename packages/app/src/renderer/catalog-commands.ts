// Catalog commands in the command prompt (SR-073 AK2, SR-108, #85). The prompt lists the implemented read
// commands and the write commands of `WRITES` by their `title`, except those an app action covers; while
// the workspace is read-only, no write command that core refuses then. Choosing
// one asks its arguments one by one in the minibuffer, Emacs `completing-read` style, in the order of the
// catalog's `arguments`; each
// source is answered by one existing read command and shown as it is (ADR-0002: the app builds the input
// and decides nothing about what is allowed; core validates). The output opens a result buffer.
//
// Keys: Enter takes the selected candidate or the typed text; Backspace in an empty input goes back one
// argument; Escape ends the command; Ctrl/Cmd+Enter takes the answer and then offers the optional
// arguments ("Run" first). A list field (`refs`) takes one value per Enter, and Enter on an empty input ends it.
// A refused input (`input.invalid`) asks again, with core's message, the value core names in the details
// of the error: the field of the first schema violation (`refs[0]`, `properties.<key>`,
// `runtime/input-errors.ts`), else the property core names in `key` (for example `withChoiceKeys`: an
// unknown or ambiguous choice). The answer takes the refused value's place; the other values stay, except
// those read from it (the properties of a type, an argument whose offer reads it). A refusal that names
// nothing asked in this run asks the value given last.
//
// "Create element" (`element.create`, SR-064) asks, after the type and the title, each required property of
// the type in turn (`create-element.ts`): a choice among the choices of the metamodel, a relation target
// found by search among its target types, or typed text; a list property takes one value per Enter. An
// empty input skips the property, or ends the values of a list. The optional `properties` are not offered:
// the other properties are added in the element buffer ("Add property", SR-104). The new element opens in
// its element buffer, and the minibuffer says how many hints core gave.
//
// A write command is asked like a read command, with two more rules: one without required arguments asks
// its first argument (`hint.confirm`: `ref`), and an optional argument whose explicit `of` names a field
// given in this run is asked after the required ones (`hintIds` of `ref`, `value` of `property`); Enter on
// an empty input skips it. Before it runs, the input of every open buffer is saved; when one cannot be
// saved, it does not run. Its output opens a result buffer that is not asked again (that would write
// again). `element.bulkUpdate` writes only with `confirm` yes, given with Ctrl/Cmd+Enter; without it, it
// shows what it would change. The sources only write commands use (status, invalidStatus, relationTarget,
// relation, property, value, hint, filter) are typed as text until #85 PR 5b's sources follow.
import type { CommandTypes } from "@logreq/core";
import type { CommandListing } from "../shared/protocol.js";
import type { Action, ActionContext, Choice, Prompt, PromptFill } from "./actions.js";
import { findElements } from "./actions.js";
import type { Buffer } from "./buffers.js";
import { bufferName, elementBufferOf, resultBuffer } from "./buffers.js";
import type { PropertyAnswer, RequiredProperty } from "./create-element.js";
import { CREATE_COMMAND, creatableTypes, createdEcho, propertiesInput } from "./create-element.js";
import { choiceItems } from "./property-edit.js";
import type { Row } from "./rows.js";

type Argument = CommandListing["arguments"][number];
type Source = Argument["complete"];

/** The part of an input schema the prompt reads: top-level and inline only, never a `$ref`. */
interface FieldSchema {
  readonly type?: unknown;
  readonly enum?: readonly unknown[];
  readonly items?: { readonly enum?: readonly unknown[] };
}

/** One value given to an argument, and how the prompt shows it. */
interface Given {
  readonly field: string;
  readonly value: unknown;
  readonly label: string;
  /** A value of one property of the field (`properties`, SR-064): the key; no value when it was skipped. */
  readonly property?: string;
  /** The properties this value asks next: the required properties of the type of a new element (SR-064). */
  readonly asks?: readonly RequiredProperty[];
  /** An optional argument a write command asked was skipped (Enter on an empty input): no value. */
  readonly skipped?: true;
  /**
   * Where the value stands among the values given (`ordered`): the next number when it is given, the
   * number of the value it replaces when it is asked again, so it keeps that value's place.
   */
  readonly rank: number;
}

/** A value as it is given; `appended` numbers it. */
type Giving = Omit<Given, "rank">;

/** Where the argument entry of one command stands. */
interface Entry {
  readonly command: CommandListing;
  readonly given: readonly Given[];
  /** The list field that takes more values (Enter on an empty input ends it). */
  readonly collecting?: string;
  /** The list property that takes more values (Enter on an empty input ends it, SR-064). */
  readonly filling?: string;
  /** Ctrl/Cmd+Enter was pressed: the optional arguments are offered before the command runs. */
  readonly more: boolean;
  /** Why core refused the input, shown with the argument asked again. */
  readonly error?: string;
  /** The rank of the value asked again: the answer takes its place (`Given.rank`). */
  readonly again?: number;
}

/** The values given with one more: in the place of the value asked again, else after the others. */
const appended = (entry: Entry, value: Giving): Given[] => [
  ...entry.given,
  { ...value, rank: entry.again ?? Math.max(0, ...entry.given.map((given) => given.rank)) + 1 },
];

/**
 * The values given in the order of their places, for the prompt's line and the input: each argument (each
 * property) where its first value stands, its values in their order. `given` itself stays in the order of
 * the answers, so Backspace takes back the answer given last.
 */
const ordered = (given: readonly Given[]): Given[] => {
  const group = (value: Given): string => `${value.field}\u0000${value.property ?? ""}`;
  const place = (value: Given): number =>
    Math.min(...given.filter((other) => group(other) === group(value)).map((other) => other.rank));
  return given
    .map((value) => ({ value, place: place(value) }))
    .sort((a, b) => a.place - b.place || a.value.rank - b.value.rank)
    .map(({ value }) => value);
};

/** One value of a closed list; `asks` goes with it to the value given (`Given.asks`). */
interface Value {
  readonly value: unknown;
  readonly name: string;
  readonly asks?: readonly RequiredProperty[];
}

/** What one argument offers: a closed list, elements found by search, or typed text. */
type Offer =
  | { readonly kind: "list"; readonly values: readonly Value[] }
  | { readonly kind: "element" }
  | { readonly kind: "text"; readonly parse: (text: string) => unknown };

/** What the loop needs besides the actions' context. */
export interface CatalogContext extends ActionContext {
  /** The revision of the workspace now, read when the command runs (the result buffer asks again after a change). */
  readonly revision: () => number;
  /** Opens the command prompt again: Backspace before the first argument. */
  readonly reopen: () => void;
}

/** The sources an earlier field may have for a source that reads one (`of`); as in `catalog-checks.mjs`. */
const ELEMENTS: readonly Source[] = ["element", "relationTarget"];
const FITTING: Partial<Record<Source, readonly Source[]>> = {
  status: ELEMENTS,
  invalidStatus: ELEMENTS,
  relationKind: ELEMENTS,
  hint: ELEMENTS,
  property: ELEMENTS,
  relation: [...ELEMENTS, "relation"],
  relationTarget: ["relationKind"],
  value: ["property"],
};

/** The field a source reads: `of`, else the nearest earlier field of a fitting source. */
export const contextField = (args: readonly Argument[], at: number): string | undefined => {
  const arg = args[at];
  if (arg?.of !== undefined) {
    return arg.of;
  }
  const fitting = arg === undefined ? undefined : FITTING[arg.complete];
  return args
    .slice(0, at)
    .reverse()
    .find((earlier) => fitting?.includes(earlier.complete) === true)?.field;
};

const schemaOf = (command: CommandListing, field: string): FieldSchema => {
  const properties = (command.input as { readonly properties?: Readonly<Record<string, FieldSchema>> })
    .properties;
  return properties?.[field] ?? {};
};

const requiredOf = (command: CommandListing): readonly string[] =>
  (command.input as { readonly required?: readonly string[] }).required ?? [];

const isWrite = (command: CommandListing): boolean => command.effect !== "read";

/**
 * The arguments asked before the command runs: the required ones. A write command without any asks its
 * first argument as if it were required (`hint.confirm`: `ref`, the shown element first), so it never runs
 * at once on an empty input.
 */
const askedOf = (command: CommandListing): readonly string[] => {
  const required = requiredOf(command);
  const first = command.arguments.find((arg) => arg.complete !== "selection");
  return required.length > 0 || !isWrite(command) || first === undefined ? required : [first.field];
};

/**
 * An optional argument a write command asks right after the required ones, in catalog order: one whose
 * explicit `of` names a field given in this run (`hint.confirm hintIds` of `ref`, `element.bulkUpdate value`
 * of `property`). Enter on an empty input skips it, or ends its values. The nearest-field default of
 * `contextField` pulls nothing in, and a read command asks only its required arguments.
 */
const follows = (entry: Entry, arg: Argument): boolean =>
  isWrite(entry.command) &&
  arg.of !== undefined &&
  !askedOf(entry.command).includes(arg.field) &&
  entry.given.some((given) => given.field === arg.of && given.skipped !== true);

const isListField = (command: CommandListing, field: string): boolean =>
  schemaOf(command, field).type === "array";

/** The shown list's selection, for a `selection` argument (it is never asked). */
const shownSelection = (context: ActionContext): unknown => {
  const shown = context.buffers[0];
  return shown?.kind === "list" ? shown.selection : undefined;
};

/** A command that needs the selection of a list is offered only while a list is shown. */
const offered = (context: ActionContext, command: CommandListing): boolean =>
  command.arguments.every(
    (arg) =>
      arg.complete !== "selection" ||
      !askedOf(command).includes(arg.field) ||
      context.buffers[0]?.kind === "list",
  );

/**
 * Whether the command fits the shown view (SR-133 AK1): the view gives one of its arguments. A list gives
 * its selection; an element buffer or a neighbourhood gives its element to a required element argument,
 * which the prompt offers first for it. A selection counts even when it is optional, because `inputOf`
 * fills it in from the list without asking, so the command runs on what the list shows. An optional
 * element argument does not count: it is asked only after Ctrl/Cmd+Enter and the command runs without
 * it, so the shown element plays no part in a plain run.
 */
export const fits = (context: ActionContext, command: CommandListing): boolean => {
  const shown = context.buffers[0]?.kind;
  const required = askedOf(command);
  return command.arguments.some((arg) =>
    arg.complete === "selection"
      ? shown === "list"
      : arg.complete === "element" &&
        required.includes(arg.field) &&
        (shown === "element" || shown === "neighbourhood"),
  );
};

const numberOr = (text: string): unknown => {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) ? value : text;
};

const jsonOr = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON: core says what is wrong with the text.
    return text;
  }
};

interface Failed {
  readonly kind: "failed";
  readonly message: string;
}

/** What a source needs to offer its values: the command, the field and the value of the field it reads. */
interface Asked {
  readonly context: ActionContext;
  readonly command: CommandListing;
  readonly field: string;
  readonly of: unknown;
}

const listOf = <T>(
  answer: { readonly ok: true; readonly output: T } | { readonly ok: false; readonly message: string },
  values: (output: T) => readonly Value[],
): Offer | Failed =>
  answer.ok ? { kind: "list", values: values(answer.output) } : { kind: "failed", message: answer.message };

const typed = (parse: (text: string) => unknown) => (): Promise<Offer> =>
  Promise.resolve({ kind: "text", parse });
const asText = typed((text) => text);

/**
 * Each source and the read command that gives its values (ADR-0002 rule 1). `relationKind`: the kinds
 * `relation.options` allows from the element it reads, without one every kind of the metamodel.
 */
const OFFERS: Readonly<Record<Source, (asked: Asked) => Promise<Offer | Failed>>> = {
  element: () => Promise.resolve({ kind: "element" }),
  // A new element: only the types that are not abstract, each with the required properties asked next.
  type: async ({ context, command }) =>
    listOf(await context.call("metamodel.get", {}), (output) =>
      command.name === CREATE_COMMAND
        ? creatableTypes(output).map((type) => ({ value: type.key, name: type.name, asks: type.required }))
        : output.types.map((type) => ({ value: type.key, name: type.name })),
    ),
  relationKind: async ({ context, of }) =>
    typeof of === "string"
      ? listOf(await context.call("relation.options", { ref: of }), (output) =>
          output.kinds.map((kind) => ({ value: kind.kind, name: kind.name })),
        )
      : listOf(await context.call("metamodel.get", {}), (output) =>
          output.relations.map((kind) => ({ value: kind.key, name: kind.name })),
        ),
  repository: async ({ context }) =>
    listOf(await context.call("workspace.status", {}), (output) =>
      output.repositories.map((repository) => ({ value: repository.name, name: repository.name })),
    ),
  choice: ({ command, field }) => {
    const schema = schemaOf(command, field);
    const values = (schema.enum ?? schema.items?.enum ?? []).map(String);
    return Promise.resolve({ kind: "list", values: values.map((value) => ({ value, name: value })) });
  },
  boolean: () =>
    Promise.resolve({
      kind: "list",
      values: [
        { value: true, name: "yes" },
        { value: false, name: "no" },
      ],
    }),
  number: typed(numberOr),
  json: typed(jsonOr),
  text: asText,
  // Never asked: the shown list's selection (`inputOf`).
  selection: asText,
  // The sources of the write commands (#85 PR 5b); typed as text until then.
  status: asText,
  invalidStatus: asText,
  relationTarget: asText,
  relation: asText,
  property: asText,
  value: asText,
  hint: asText,
  filter: asText,
};

/** What the argument at `at` offers, or why its values cannot be read. */
const offerFor = (
  context: ActionContext,
  entry: Entry,
  at: number,
  arg: Argument,
): Promise<Offer | Failed> => {
  const of = contextField(entry.command.arguments, at);
  return OFFERS[arg.complete]({
    context,
    command: entry.command,
    field: arg.field,
    of: entry.given.find((given) => given.field === of)?.value,
  });
};

/** "Show relation options SR-1" : the title and the values given so far (a skipped property shows nothing). */
const lineOf = (entry: Entry): string =>
  [
    entry.command.title,
    ...ordered(entry.given)
      .map((given) => given.label)
      .filter((label) => label !== ""),
  ].join(" ");

/** The properties the given values ask (SR-064): the required properties of the type of a new element. */
const asksOf = (entry: Entry): readonly RequiredProperty[] =>
  entry.given.flatMap((given) => given.asks ?? []);

/** The values given to the properties, without the skipped ones. */
const answersOf = (entry: Entry): { readonly key: string; readonly value: PropertyAnswer }[] =>
  ordered(entry.given).flatMap((given) =>
    given.property === undefined || given.value === undefined
      ? []
      : [{ key: given.property, value: given.value as PropertyAnswer }],
  );

/** The input the given values make, with the shown list's selection for a `selection` argument. */
const inputOf = (context: ActionContext, entry: Entry): Record<string, unknown> => {
  const input: Record<string, unknown> = {};
  const selection = shownSelection(context);
  for (const arg of entry.command.arguments) {
    const values = ordered(entry.given)
      .filter((given) => given.field === arg.field && given.skipped !== true)
      .map((given) => given.value);
    if (arg.complete === "selection") {
      if (selection !== undefined) {
        input[arg.field] = selection;
      }
    } else if (entry.given.some((given) => given.field === arg.field && given.property !== undefined)) {
      const properties = propertiesInput(asksOf(entry), answersOf(entry));
      if (Object.keys(properties).length > 0) {
        input[arg.field] = properties;
      }
    } else if (values.length > 0) {
      input[arg.field] = isListField(entry.command, arg.field) ? values : values[0];
    }
  }
  return input;
};

/**
 * Saves the input of every open buffer before a write command runs, so the command neither loses it nor
 * takes its own write for a change on disk; resolves the first buffer whose input could not be saved.
 * Without `saveDraft` nothing is saved, as before autosave.
 */
const unsavedBefore = async (context: CatalogContext): Promise<Buffer | undefined> => {
  const { saveDraft } = context;
  if (saveDraft !== undefined) {
    for (const buffer of context.buffers) {
      if (context.drafted(buffer.key) && !(await saveDraft(buffer.key))) {
        return buffer;
      }
    }
  }
  return undefined;
};

/**
 * Runs the command with the given values: the output opens a result buffer (of a write command, one that
 * is not asked again), a new element its element buffer (SR-064); a refused input asks again. A write
 * command first saves the input of every open buffer, and does not run when one cannot be saved.
 */
const execute = async (context: CatalogContext, entry: Entry): Promise<void> => {
  const input = inputOf(context, entry);
  const name = entry.command.name as keyof CommandTypes;
  const write = isWrite(entry.command);
  // Only when there is input to save: the command is sent at once otherwise.
  const drafted = write && context.buffers.some((buffer) => context.drafted(buffer.key));
  const unsaved = drafted ? await unsavedBefore(context) : undefined;
  if (unsaved !== undefined) {
    context.echo(`${bufferName(unsaved)} could not be saved: ${entry.command.title} did not run`);
    return;
  }
  // The revision the command reads: a change while it runs makes the result view ask again.
  const revision = context.revision();
  const answer = await context.call(name, input);
  if (answer.ok && name === CREATE_COMMAND) {
    const created = answer.output as CommandTypes[typeof CREATE_COMMAND]["output"];
    context.dispatch({ type: "open", buffer: elementBufferOf(created.element) });
    context.echo(createdEcho(created));
  } else if (answer.ok) {
    context.dispatch({
      type: "open",
      buffer: resultBuffer(name, input, lineOf(entry), answer.output, revision, write),
    });
  } else if (answer.code === "input.invalid" && entry.given.length > 0) {
    // The prompt asks the value core refused again, else the one given last, with core's message.
    askAgain(context, { ...entry, error: answer.message }, refusedAt(entry, answer.details));
  } else {
    context.echo(answer.message);
  }
};

/** What a refusal names: an argument of the command, or a property of a new element (SR-064). */
interface Refused {
  readonly field: string;
  readonly property?: string;
  /** Which value of a list: by its place (`refs[1]`), or by the value core names. */
  readonly index?: number;
  readonly value?: unknown;
}

/** `refs[0]`, `properties.requirement-type`, `properties.tags[1]`: the field, its place, a property's key. */
const FIELD_PATH = /^([^.[\]]+)(?:\[(\d+)\])?(?:\.([^.[\]]+)(?:\[(\d+)\])?)?/u;

/**
 * What core refused, read from the details of an `input.invalid` (ADR-0010): a schema violation names the
 * field in `errors[0].field` (`runtime/input-errors.ts`); a value refused while the input is written names
 * the property in `key` (`withChoiceKeys`: `unknown-choice`, `ambiguous-choice`) and the value in `value`.
 */
export const refusedOf = (details: Readonly<Record<string, unknown>> | undefined): Refused | undefined => {
  if (details === undefined) {
    return undefined;
  }
  const errors = details["errors"];
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  const path =
    typeof first === "object" && first !== null && "field" in first && typeof first.field === "string"
      ? FIELD_PATH.exec(first.field)
      : null;
  if (path !== null) {
    const [, field = "", index, key, item] = path;
    return field === PROPERTIES && key !== undefined
      ? { field, property: key, ...(item === undefined ? {} : { index: Number(item) }) }
      : { field, ...(index === undefined ? {} : { index: Number(index) }) };
  }
  const key = details["key"];
  return typeof key === "string"
    ? { field: PROPERTIES, property: key, ...("value" in details ? { value: details["value"] } : {}) }
    : undefined;
};

/**
 * The place in `given` of the value core refused: the value of that argument or property given in this
 * run (of a list the one at that place, or the one core names, else the last); else the value given last,
 * as for a refusal that names nothing the prompt asked (another kind of refusal, a field it never asks).
 */
const refusedAt = (entry: Entry, details: Readonly<Record<string, unknown>> | undefined): number => {
  const refused = refusedOf(details);
  const places = entry.given.flatMap((given, at) =>
    refused?.field === given.field && refused.property === given.property ? [at] : [],
  );
  const named =
    refused?.index !== undefined
      ? places[refused.index]
      : refused !== undefined && "value" in refused
        ? places.find((at) => JSON.stringify(entry.given[at]?.value) === JSON.stringify(refused.value))
        : undefined;
  return named ?? places.at(-1) ?? entry.given.length - 1;
};

/** The arguments whose offer reads `field`, also through another one (`contextField`: `target` ← `kind` ← `source`). */
const readersOf = (args: readonly Argument[], field: string): ReadonlySet<string> => {
  const readers = new Set<string>();
  let grown = true;
  while (grown) {
    grown = false;
    args.forEach((arg, at) => {
      const read = contextField(args, at);
      if (!readers.has(arg.field) && read !== undefined && (read === field || readers.has(read))) {
        readers.add(arg.field);
        grown = true;
      }
    });
  }
  return readers;
};

/**
 * Asks the value at `at` in `given` again, without it, in its place; the other values stay, except those
 * read from it: the properties a type asks (SR-064) and the arguments whose offer reads it (`of`), which
 * are asked again after it. Before the first value, the command prompt.
 */
const askAgain = (context: CatalogContext, answered: Entry, at: number): void => {
  const again = answered.given[at];
  const entry = { ...answered, ...(again === undefined ? {} : { again: again.rank }) };
  const itsProperties = new Set((again?.asks ?? []).map((asked) => asked.key));
  const readers = again === undefined ? new Set<string>() : readersOf(entry.command.arguments, again.field);
  const given = entry.given.filter(
    (value, place) =>
      place !== at &&
      !readers.has(value.field) &&
      (value.property === undefined || !itsProperties.has(value.property)),
  );
  const property = asksOf(entry).find((asked) => asked.key === again?.property);
  if (property !== undefined) {
    const { collecting: _was, filling: _filling, ...rest } = entry;
    // A list property that keeps values takes more again.
    const keeps = given.some((value) => value.property === property.key);
    askProperty(context, { ...rest, given, ...(keeps ? { filling: property.key } : {}) }, property);
    return;
  }
  const index = entry.command.arguments.findIndex((arg) => arg.field === again?.field);
  const arg = entry.command.arguments[index];
  if (again === undefined || arg === undefined) {
    context.reopen();
    return;
  }
  const { collecting: _was, ...rest } = entry;
  // A list argument that keeps values takes more again (Enter on an empty input ends it).
  const keeps = isListField(entry.command, again.field) && given.some((value) => value.field === again.field);
  ask(context, { ...rest, given, ...(keeps ? { collecting: again.field } : {}) }, arg, index);
};

/** One argument back: the value given last is asked again; before the first, the command prompt. */
const back = (context: CatalogContext, entry: Entry): void => {
  askAgain(context, entry, entry.given.length - 1);
};

/** Takes a value for `field`; `more` (Ctrl/Cmd+Enter) offers the optional arguments next. */
const give = (
  context: CatalogContext,
  entry: Entry,
  field: string,
  value: unknown,
  label: string,
  more: boolean,
  asks?: readonly RequiredProperty[],
): void => {
  const { collecting: _was, error: _error, ...rest } = entry;
  step(context, {
    ...rest,
    given: appended(entry, { field, value, label, ...(asks === undefined ? {} : { asks }) }),
    more: entry.more || more,
    ...(isListField(entry.command, field) && !more ? { collecting: field } : {}),
  });
};

/** Skips an optional argument a write command asked (`follows`); `more` offers the optional arguments next. */
const skip = (context: CatalogContext, entry: Entry, field: string, more: boolean): void => {
  const { error: _error, ...rest } = entry;
  step(context, {
    ...rest,
    given: appended(entry, { field, value: undefined, label: "", skipped: true }),
    more: entry.more || more,
  });
};

/** The field of the input that holds the properties (`element.create`: `properties`). */
const PROPERTIES = "properties";

/**
 * Takes a value for a property (SR-064); none skips it. A list property takes more values, unless `more`
 * (Ctrl/Cmd+Enter) offers the optional arguments next.
 */
const giveProperty = (
  context: CatalogContext,
  entry: Entry,
  property: RequiredProperty,
  answer: { readonly value: PropertyAnswer; readonly label: string } | undefined,
  more: boolean,
): void => {
  const { filling: _was, error: _error, ...rest } = entry;
  step(context, {
    ...rest,
    given: appended(entry, {
      field: PROPERTIES,
      property: property.key,
      value: answer?.value,
      label: answer?.label ?? "",
    }),
    more: entry.more || more,
    ...(answer !== undefined && property.info.many && !more ? { filling: property.key } : {}),
  });
};

/** The target a found element is, for a relation property. */
const targetOf = (row: Row): { readonly value: PropertyAnswer; readonly label: string } => {
  const label = `${row.label} ${row.title}`.trim();
  return { value: { id: row.open.id, repository: row.open.repository, label }, label: row.label };
};

/**
 * Asks a required property of a new element (SR-064): a choice among its choices (in a list, those not
 * taken yet), a target among the elements of its target types, or text. An empty input skips it, or ends
 * the values of a list.
 */
const askProperty = (context: CatalogContext, entry: Entry, property: RequiredProperty): void => {
  const { key, info } = property;
  const label = `${entry.error === undefined ? "" : `${entry.error} · `}${lineOf(entry)} · ${key}:`;
  const take = (answer: { readonly value: PropertyAnswer; readonly label: string }) => ({
    run: () => {
      giveProperty(context, entry, property, answer, false);
    },
    more: () => {
      giveProperty(context, entry, property, answer, true);
    },
  });
  const shared = {
    label,
    back: () => {
      back(context, entry);
    },
    empty: (more: boolean) => {
      if (entry.filling === key) {
        const { filling: _was, error: _error, ...rest } = entry;
        step(context, { ...rest, more: entry.more || more });
      } else {
        giveProperty(context, entry, property, undefined, more);
      }
    },
  };
  if (info.kind === "choice") {
    // The choices of the metamodel (SR-104 AK3) that are not taken yet.
    const taken = answersOf(entry).flatMap((answer) =>
      answer.key === key && typeof answer.value === "string" ? [answer.value] : [],
    );
    context.ask({
      ...shared,
      items: choiceItems(info, taken)
        .filter((choice) => !choice.set)
        .map((choice) => ({
          id: JSON.stringify(choice.key),
          name: choice.name,
          hint: choice.hint,
          ...take({ value: choice.key, label: choice.name }),
        })),
    });
  } else if (info.kind === "relation") {
    const types = info.targetTypes;
    context.ask({
      ...shared,
      items: [],
      // A relation property that may point at no type finds nothing: it can only be skipped.
      ...(types?.length === 0
        ? {}
        : {
            find: findElements(
              context,
              (row) => {
                take(targetOf(row)).run();
              },
              {
                ...(types === undefined ? {} : { selection: { where: { type: [...types] } } }),
                more: (row) => {
                  take(targetOf(row)).more();
                },
              },
            ),
          }),
    });
  } else {
    context.ask({
      ...shared,
      items: [],
      text: (text) => {
        take({ value: text, label: text }).run();
      },
      more: (text) => {
        take({ value: text, label: text }).more();
      },
    });
  }
};

/** Asks the argument at `at`: its candidates from its source, or its text. */
const ask = (context: CatalogContext, entry: Entry, arg: Argument, at: number): void => {
  const field = arg.field;
  const label = `${entry.error === undefined ? "" : `${entry.error} · `}${lineOf(entry)} · ${field}:`;
  const shared = {
    label,
    back: () => {
      back(context, entry);
    },
    ...(entry.collecting === field
      ? {
          empty: (more: boolean) => {
            const { collecting: _was, ...rest } = entry;
            step(context, { ...rest, more: entry.more || more });
          },
        }
      : follows(entry, arg)
        ? {
            empty: (more: boolean) => {
              skip(context, entry, field, more);
            },
          }
        : {}),
  };
  const take = (
    value: unknown,
    name: string,
    asks?: readonly RequiredProperty[],
  ): Pick<Choice, "run" | "more"> => ({
    run: () => {
      give(context, entry, field, value, name, false, asks);
    },
    more: () => {
      give(context, entry, field, value, name, true, asks);
    },
  });
  // The prompt opens at once with its label, so no key goes to the buffer and Escape ends it while the
  // values load; the candidates fill in when they arrive.
  context.ask({
    ...shared,
    items: [],
    fill: offerFor(context, entry, at, arg).then((offer): PromptFill => {
      if (offer.kind === "failed") {
        return { label: `${offer.message} · ${label}` };
      }
      if (offer.kind === "list") {
        return {
          items: offer.values.map(({ value, name, asks }) => ({
            id: JSON.stringify(value),
            name,
            ...take(value, name, asks),
          })),
        };
      }
      if (offer.kind === "element") {
        // The element shown, else the selected row of the shown list, comes first, so Enter takes it.
        const shown = context.buffers[0];
        const first = shown?.kind === "element" || shown?.kind === "neighbourhood" ? shown : context.row;
        return {
          items:
            first === undefined
              ? []
              : [
                  {
                    id: first.key,
                    name: bufferName(first),
                    ...take(first.id, first.name.replace(/ .*$/su, "")),
                  },
                ],
          find: findElements(
            context,
            (row) => {
              give(context, entry, field, row.open.id, row.label, false);
            },
            {
              more: (row) => {
                give(context, entry, field, row.open.id, row.label, true);
              },
            },
          ),
        };
      }
      return {
        text: (text) => {
          give(context, entry, field, offer.parse(text), text, false);
        },
        more: (text) => {
          give(context, entry, field, offer.parse(text), text, true);
        },
      };
    }),
  });
};

/** The prompt of the optional arguments: "Run" first, then each one not given yet. */
const moreArguments = (context: CatalogContext, entry: Entry): Prompt => {
  const run = (): void => {
    void execute(context, entry);
  };
  return {
    label: `${lineOf(entry)} · more arguments:`,
    back: () => {
      back(context, entry);
    },
    items: [
      { id: "run", name: "Run", run, more: run },
      ...entry.command.arguments.flatMap((arg, at) =>
        arg.complete === "selection" ||
        entry.given.some((given) => given.field === arg.field && given.skipped !== true) ||
        (arg.field === PROPERTIES && entry.given.some((given) => given.asks !== undefined))
          ? []
          : [
              {
                id: arg.field,
                name: arg.field,
                run: () => {
                  ask(context, entry, arg, at);
                },
              },
            ],
      ),
    ],
  };
};

/** The property asked next (SR-064): the list property being filled, else the first one not answered yet. */
const nextProperty = (entry: Entry): RequiredProperty | undefined =>
  asksOf(entry).find((asked) =>
    entry.filling === undefined
      ? !entry.given.some((given) => given.property === asked.key)
      : asked.key === entry.filling,
  );

/**
 * The next step: the list field being filled, the next required argument, the optional arguments a write
 * command asks after them (`follows`), the required properties of a new element (SR-064), the optional
 * ones, or the run.
 */
const step = (context: CatalogContext, answered: Entry): void => {
  // The value asked again has its answer: the next one goes after the others.
  const { again: _again, ...entry } = answered;
  const { arguments: args } = entry.command;
  const asked = askedOf(entry.command);
  const open = (arg: Argument): boolean =>
    arg.complete !== "selection" && !entry.given.some((given) => given.field === arg.field);
  const required = args.findIndex((arg) => open(arg) && asked.includes(arg.field));
  const next =
    entry.collecting === undefined
      ? required >= 0
        ? required
        : args.findIndex((arg) => open(arg) && follows(entry, arg))
      : args.findIndex((arg) => arg.field === entry.collecting);
  const arg = args[next];
  const property = nextProperty(entry);
  if (arg !== undefined) {
    ask(context, entry, arg, next);
  } else if (property !== undefined) {
    askProperty(context, entry, property);
  } else if (entry.more) {
    context.ask(moreArguments(context, entry));
  } else {
    void execute(context, entry);
  }
};

/** Starts the argument entry of `command`; `more` (Ctrl/Cmd+Enter on it) offers the optional arguments too. */
export const startCommand = (context: CatalogContext, command: CommandListing, more: boolean): void => {
  step(context, { command, given: [], more });
};

/**
 * The write commands the prompt offers (SR-073 AK2, #85), each asked like a read command. Not offered:
 * `element.update`, which the element buffer does ("Save element" covers it, with "Edit title", "Add
 * property" and "Clear property"); `filter.save`, whose filter is the shown list's, not JSON typed by hand;
 * `workspace.init`, which creates a workspace in another folder ("Open workspace" is the app's way).
 */
export const WRITES: ReadonlySet<string> = new Set([
  CREATE_COMMAND,
  "element.setStatus",
  "element.supersede",
  "relation.add",
  "relation.remove",
  "hint.confirm",
  "element.bulkUpdate",
  "element.addAttachment",
  "evidence.record",
  "evidence.enrichJunit",
  "data.store",
]);

/**
 * The catalog commands the command prompt offers now: implemented read commands and the writes it offers,
 * that no action covers (by title or by `covers`), each by its title and whether it fits the shown view
 * (SR-133). While the workspace is read-only, no write command that core refuses then (`whileReadOnly`).
 */
export const catalogItems = (
  context: CatalogContext,
  catalog: readonly CommandListing[],
  actions: readonly Action[],
): Choice[] => {
  const covered = new Set(actions.flatMap((action) => [action.title, ...(action.covers ?? [])]));
  return catalog
    .filter(
      (command) =>
        command.implemented &&
        (command.effect === "read" || WRITES.has(command.name)) &&
        !(context.readOnly === true && command.whileReadOnly === "refuse") &&
        !covered.has(command.title) &&
        !covered.has(command.name) &&
        offered(context, command),
    )
    .map((command) => ({
      id: `command:${command.name}`,
      name: command.title,
      fits: fits(context, command),
      run: () => {
        startCommand(context, command, false);
      },
      more: () => {
        startCommand(context, command, true);
      },
    }));
};
