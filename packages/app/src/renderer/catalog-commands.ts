// Catalog commands in the command prompt (SR-073 AK2, SR-108, ThomasBirkmaier/ReqSeq-archive#85). The prompt lists the implemented read
// and write commands by their `title`, except those an app action covers; while the workspace is
// read-only, no write command that core refuses then; while a folder without a workspace is open, only
// "Initialise workspace". Choosing one asks its arguments one by one in the minibuffer, Emacs
// `completing-read` style, in the order of the catalog's `arguments`; each source is answered by one
// existing read command and shown as it is (ADR-0002: the app builds the input and decides nothing about
// what is allowed; core validates). The output opens a result buffer.
//
// Keys: Enter takes the selected candidate or the typed text; Backspace in an empty input goes back one
// argument, and so does Escape (SR-134 AK1), before the first to the command prompt; Ctrl/Cmd+Enter takes the answer and then offers the optional
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
// shows what it would change. A confirmation writes only the plan of an open preview of the same input
// (#836): it passes that preview's `plan`; without one it opens the preview and writes nothing,
// and when core refuses the plan (`plan-changed`) it shows the new preview.
//
// The arguments a command expects are completed with the values the metamodel allows (SR-108 AK4), each
// source from one read command: `status` the statuses of the element's type (`element.get`,
// `metamodel.get`; of a list of elements its first), `invalidStatus` the invalid ones; `property` the
// properties of the element's type, without an element every property of the metamodel, never the title;
// `value` the choices of the property, elements of its target types, else text; `relationTarget` elements
// of the target types of the kind (`relation.options` from the source, else the metamodel); `relation` the
// kinds of the element's outgoing relations, then the targets of that kind; `hint` the hints of the element
// that can be confirmed (`hint.list`); `view` the core and the variants of the workspace (`views.ts`, #285);
// `baseline` the baselines by name (`baseline.list`), by file name where two share a name; `perspective`
// the perspectives by name (`perspective.list`); `filter` the saved filters by name (`filter.list`); an
// `element` with a `meaning` the variants or packages (`metamodel.get`, `element.list`); `criterion` the
// acceptance criteria of the element that have a key (`element.get`); `evidenceLocation` the evidence
// locations evidence.record takes (`workspace.status`), typed text too; `elementFile` the file of the
// element, or those of an ambiguous reference (`ref.ambiguous`); `metamodelLocation` the repository, then
// the path; a `condition` is built from hits as marks (`condition-prompt.ts`, SR-215 AK3). A hit the
// metamodel names shows its key beside the name (SR-215 AK1). A `selection` is never
// asked: it is the shown list's, or on a package page its package (`selection.package`), for every command
// with a selection, reads and writes alike.
import type { AboutInfo } from "./about.js";
import { ABOUT_COMMAND } from "./about.js";
import type { CommandTypes } from "@reqseq/core";
import type { CommandListing } from "../shared/protocol.js";
import type {
  Action,
  ActionContext,
  ArgumentExplanation,
  Choice,
  CommandExplanation,
  CommandHelp,
  Prompt,
  PromptFill,
} from "./actions.js";
import { ACTIONS, findElements } from "./actions.js";
import { criterionLabel, criterionReferenceOf } from "@reqseq/core/criterion-items";
import { packagePage } from "./list-actions.js";
import { bindingLabel } from "./bindings.js";
import { coveredCommand, coveringAction } from "./command-entry.js";
import type { Buffer, ElementBuffer, NeighbourhoodBuffer } from "./buffers.js";
import { bufferName, elementBufferOf, listing, resultBuffer } from "./buffers.js";
import type { PropertyAnswer, RequiredProperty } from "./create-element.js";
import { CREATE_COMMAND, creatableTypes, createdEcho, propertiesInput } from "./create-element.js";
import { idOfName, refIdTitle, shownId, shownIdTitle } from "./id-title.js";
import type { Prefilled } from "./matrix-menu.js";
import { isWindows } from "./keys.js";
import { pathSeeker } from "./path-completion.js";
import { choiceItems } from "./property-edit.js";
import type { ConditionMark } from "./condition-prompt.js";
import { askCondition, conditionLabel, conditionOf } from "./condition-prompt.js";
import { rowName } from "./rows.js";
import type { Row } from "./rows.js";
import { selectionInView, viewName, viewsOf } from "./views.js";

type Argument = CommandListing["arguments"][number];
type Source = Argument["complete"];

/**
 * The part of an input schema the prompt reads: top-level and inline only, never a `$ref` (the core process
 * puts the enum a `choice` field names by a `$ref` inline, `core/listing.ts`).
 */
interface FieldSchema {
  readonly type?: unknown;
  readonly description?: unknown;
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
  /** Given before the prompt asked (`startCommand`, SR-199): not offered first to another argument. */
  readonly prefilled?: true;
  /** A condition built from hits (SR-215 AK3): its marks, which stand again when it is asked again (AK9). */
  readonly marks?: readonly ConditionMark[];
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
  /** The marks of the condition asked again (SR-215 AK6, AK9). */
  readonly marks?: readonly ConditionMark[];
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
  /** Shown beside the name (SR-215 AK1): the key of a value the metamodel names, or where the value lies. */
  readonly key?: string;
  /** How the prompt's line names it once given, when not by `name`: an element by its ID, as a search hit. */
  readonly label?: string;
  /** The hit's id, when the value is not unique among the hits (one file in two repositories). */
  readonly id?: string;
  /** Another argument given with it: the repository of a file that two repositories hold (`elementFile`). */
  readonly also?: { readonly field: string; readonly value: string };
  readonly asks?: readonly RequiredProperty[];
}

/** What one argument offers: a closed list, elements found by search, or typed text. */
type Offer =
  | {
      readonly kind: "list";
      readonly values: readonly Value[];
      /** Typed text is taken too: Enter with no hit, or "Use <text>" for a folder below a value (`typedFill`). */
      readonly typed?: true;
    }
  /** Elements found by `element.search`, among `types` when given (the target types of a kind or property). */
  | {
      readonly kind: "element";
      readonly types?: readonly string[];
      /** The value is a relation target `{ id, repository }` (a relation property's value), not a reference. */
      readonly target?: true;
    }
  | { readonly kind: "text"; readonly parse: (text: string) => unknown }
  /** A path typed and completed from the file system (SR-143 AK2): folders, and files too with `files`. */
  | { readonly kind: "path"; readonly files: boolean }
  /**
   * Where the metamodel of a new workspace lies (`workspace.init metamodel`), asked in two steps: the
   * repository, then the path, completed below `base` (the folder of the new workspace) in the main one.
   */
  | { readonly kind: "location"; readonly base?: string };

/** What the loop needs besides the actions' context. */
export interface CatalogContext extends ActionContext {
  /** The revision of the workspace now, read when the command runs (the result buffer asks again after a change). */
  readonly revision: () => number;
  /** Opens the command prompt again: Backspace before the first argument. */
  readonly reopen: () => void;
}

/**
 * The sources an earlier field may have for a source that reads one (`of`); as `CONTEXT` in
 * `catalog-checks.mjs`, which the tests compare over the whole catalog.
 */
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
  criterion: ["element"],
  elementFile: ["element"],
  properties: ["type"],
  relations: ["type"],
  metamodelLocation: ["folder"],
};

/**
 * The field a source reads: `of`, else the nearest earlier field of a fitting source, never an element
 * field with a `meaning` (a variant or a package: `evidence.record criteria` reads `ref`, not `variant`).
 */
export const contextField = (args: readonly Argument[], at: number): string | undefined => {
  const arg = args[at];
  if (arg?.of !== undefined) {
    return arg.of;
  }
  const fitting = arg === undefined ? undefined : FITTING[arg.complete];
  return args
    .slice(0, at)
    .reverse()
    .find((earlier) => fitting?.includes(earlier.complete) === true && earlier.meaning === undefined)?.field;
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

/** The arguments the prompt can ask: all but a `selection`, which the shown list or page gives (`shownSelection`). */
const askable = (command: CommandListing): readonly Argument[] =>
  command.arguments.filter((arg) => arg.complete !== "selection");

/**
 * The explanation line of the entry of `command` while it is marked (SR-210 AK1): its summary and the number of
 * the optional arguments Ctrl/Cmd+Enter offers, as the catalog has them; not those `given` before the prompt asks
 * (SR-199), which it does not ask.
 */
const commandExplanation = (
  command: CommandListing,
  given: readonly Prefilled[] = [],
): CommandExplanation => {
  const asked = askedOf(command);
  const optional = askable(command).filter(
    (arg) => !asked.includes(arg.field) && !given.some((value) => value.field === arg.field),
  );
  return { summary: command.summary, optional: optional.length };
};

/**
 * The command help of `command` (SR-210 AK3), as the catalog has it: title, summary and details of its reference
 * page, each argument with its description and whether the command requires it, and its call on the command line.
 */
export const commandHelp = (command: CommandListing): CommandHelp => {
  const required = requiredOf(command);
  return {
    title: command.title,
    summary: command.summary,
    ...(command.details === undefined ? {} : { details: command.details }),
    arguments: command.arguments.map(({ field }) => {
      const { description } = schemaOf(command, field);
      return {
        name: field,
        required: required.includes(field),
        ...(typeof description === "string" ? { description } : {}),
      };
    }),
    cli: command.cliUsage,
  };
};

/**
 * `prompt` with the explanation line (SR-210 AK1, AK5): the prompt keeps its place for it (`explains`), and each
 * action has one. An action that runs one catalog command (`coveredCommand`) has that command's summary, without
 * its arguments, which the action asks its own way or not at all; Ctrl+H shows the action's title with that summary,
 * without the arguments and the call on the command line, and F1 opens the command's reference page. Any other
 * action has its own `description`, which the keyboard reference names too (SR-139 AK6); Ctrl+H shows it with the
 * action's key and the catalog commands it runs by display, and F1 opens its row of the keyboard reference. The
 * entries of catalog commands have theirs (`catalogItems`); an element or a buffer has none.
 */
export const withExplanations = (
  prompt: Prompt,
  catalog: readonly CommandListing[],
  actions: readonly Action[] = ACTIONS,
): Prompt => ({
  ...prompt,
  explains: true,
  items: prompt.items.map((item) => {
    const action = actions.find((candidate) => candidate.id === item.id);
    if (action === undefined) {
      return item;
    }
    const command = coveredCommand(action, catalog);
    if (command !== undefined) {
      // Its summary, but neither the arguments nor the call on the command line (AK5).
      return {
        ...item,
        explain: { summary: command.summary },
        help: { title: action.title, summary: command.summary },
      };
    }
    const { description, runs } = action;
    return description === undefined
      ? item
      : {
          ...item,
          explain: { summary: description },
          // Its key as the prompt shows it, and the catalog commands it runs by display (AK5).
          help: {
            title: action.title,
            summary: description,
            ...(item.hint === undefined ? {} : { key: item.hint }),
            ...(runs === undefined ? {} : { runs }),
            keyReference: true,
          },
        };
  }),
});

/** A list or a package page is shown: it gives the selection of a `selection` argument. */
const givesSelection = (context: ActionContext): boolean =>
  listing(context.buffers[0]) || packagePage(context) !== undefined;

/**
 * The selection a `selection` argument takes (it is never asked): the shown list's, or on a package page its
 * package (`selection.package`, SR-050 AK1: "Create baseline" on a package page asks only the name).
 */
const shownSelection = (context: ActionContext): object | undefined => {
  const shown = context.buffers[0];
  const page = packagePage(context);
  return listing(shown) ? shown.selection : page === undefined ? undefined : { package: page.id };
};

/** A command that needs a selection is offered only while a list or a package page is shown. */
const offered = (context: ActionContext, command: CommandListing): boolean =>
  command.arguments.every(
    (arg) => arg.complete !== "selection" || !askedOf(command).includes(arg.field) || givesSelection(context),
  );

/**
 * Whether the command fits the shown view (SR-133 AK1): the view gives one of its arguments. A list or a
 * package page gives its selection; an element buffer or a neighbourhood gives its element to a required element argument,
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
      ? givesSelection(context)
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
  /** The value of the field the source reads (`contextField`); of a list field (`refs`) its first value. */
  readonly of: unknown;
  /** The source of that field: an element, a relation kind, a relation, a property. */
  readonly ofSource?: Source;
  /**
   * The value of the field that field reads in turn: the source of a kind (`relation.add target` ← `kind` ←
   * `source`). The chain is at most these two steps (the plan's rule for `of`); a source never reads further.
   */
  readonly before: unknown;
  /** The values already given to this field (a list such as `hintIds`): not offered again. */
  readonly taken: readonly unknown[];
  /** The meaning of the type of the elements an element argument takes (`variant`, `package`). */
  readonly meaning?: string;
  /** The value given to `repository` in this run, if any: the files of an ambiguous reference are its. */
  readonly repository?: unknown;
}

const listOf = <T>(
  answer: { readonly ok: true; readonly output: T } | { readonly ok: false; readonly message: string },
  values: (output: T) => readonly Value[],
): Offer | Failed =>
  answer.ok ? { kind: "list", values: values(answer.output) } : { kind: "failed", message: answer.message };

/** The element `ref` names, as `element.get` gives it; nothing without a reference. */
const elementOf = async (
  context: ActionContext,
  ref: unknown,
): Promise<CommandTypes["element.get"]["output"]["element"] | Failed | undefined> => {
  if (typeof ref !== "string") {
    return undefined;
  }
  const answer = await context.call("element.get", { ref });
  return answer.ok ? answer.output.element : { kind: "failed", message: answer.message };
};

const failed = (value: unknown): value is Failed =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "failed";

/**
 * The statuses the type of the element `ref` names allows, by name (`metamodel.get`), only the invalid
 * ones for `invalidStatus` (`element.supersede`); without an element every status of the metamodel.
 */
const statuses =
  (invalid: boolean) =>
  async ({ context, of }: Asked): Promise<Offer | Failed> => {
    const element = await elementOf(context, of);
    if (failed(element)) {
      return element;
    }
    return listOf(await context.call("metamodel.get", {}), (output) => {
      const allowed = output.types.find((type) => type.key === element?.type)?.statuses;
      return output.statuses
        .filter((status) => (allowed?.includes(status.key) ?? true) && (!invalid || status.invalid === true))
        .map((status) => ({ value: status.key, name: status.name, key: status.key }));
    });
  };

/** Elements of the types `types` (all types without them; none for an empty list, which allows none). */
const elementsOf = (types: readonly string[] | undefined, target = false): Offer =>
  types?.length === 0
    ? { kind: "list", values: [] }
    : { kind: "element", ...(types === undefined ? {} : { types }), ...(target ? { target: true } : {}) };

const typed = (parse: (text: string) => unknown) => (): Promise<Offer> =>
  Promise.resolve({ kind: "text", parse });
const asText = typed((text) => text);

/**
 * The elements of the types with the meaning `meaning` (`metamodel.get`, then `element.list`), as `viewsOf`
 * reads the variants, without `core`; none when no type has it.
 */
const elementsWithMeaning = async (context: ActionContext, meaning: string): Promise<Offer | Failed> => {
  const metamodel = await context.call("metamodel.get", {});
  if (!metamodel.ok) {
    return { kind: "failed", message: metamodel.message };
  }
  const types = metamodel.output.types.filter((type) => type.meaning === meaning).map((type) => type.key);
  if (types.length === 0) {
    return { kind: "list", values: [] };
  }
  return listOf(
    await context.call("element.list", { selection: { where: { type: types } }, limit: 5000 }),
    (output) =>
      (output.elements ?? []).map((element) => ({
        value: element.id,
        name: shownIdTitle(element.shortId, element.identifier, element.title),
        label: shownId(element.shortId, element.identifier),
      })),
  );
};

/** A file of an element, with its repository beside it. */
interface ElementFile {
  readonly repository: string;
  readonly file: string;
}

/** The elements `details.candidates` of `ref.ambiguous` names by repository and file; none in other details. */
const candidatesOf = (details: Readonly<Record<string, unknown>> | undefined): readonly ElementFile[] => {
  const candidates = details?.["candidates"];
  return Array.isArray(candidates)
    ? candidates.flatMap((candidate: unknown) => {
        const { repository, file } = (candidate ?? {}) as Partial<Record<string, unknown>>;
        return typeof repository === "string" && typeof file === "string" ? [{ repository, file }] : [];
      })
    : [];
};

/**
 * The hits of the files of an ambiguous reference, each by its repository and file. A file two of them hold
 * goes in with its repository, which tells them apart (`element.get` `file`: "Give repository too").
 */
const fileValues = (candidates: readonly ElementFile[]): Value[] =>
  candidates.map((candidate) => ({
    ...fileValue(candidate),
    id: JSON.stringify([candidate.repository, candidate.file]),
    ...(candidates.filter(({ file }) => file === candidate.file).length > 1
      ? { also: { field: "repository", value: candidate.repository } }
      : {}),
  }));

const fileValue = ({ repository, file }: ElementFile): Value => ({
  value: file,
  name: file,
  key: repository,
});

/**
 * Each source and the read command that gives its values (ADR-0002 rule 1). `relationKind`: the kinds
 * `relation.options` allows from the element it reads, without one every kind of the metamodel.
 */
const OFFERS: Readonly<Record<Source, (asked: Asked) => Promise<Offer | Failed>>> = {
  // With a meaning, the elements of the types with that meaning (the variants, the packages) as hits.
  element: ({ context, meaning }) =>
    meaning === undefined ? Promise.resolve({ kind: "element" }) : elementsWithMeaning(context, meaning),
  // A new element: only the types that are not abstract, each with the required properties asked next.
  type: async ({ context, command }) =>
    listOf(await context.call("metamodel.get", {}), (output) =>
      command.name === CREATE_COMMAND
        ? creatableTypes(output).map((type) => ({
            value: type.key,
            name: type.name,
            key: type.key,
            asks: type.required,
          }))
        : output.types.map((type) => ({ value: type.key, name: type.name, key: type.key })),
    ),
  relationKind: async ({ context, of }) =>
    typeof of === "string"
      ? listOf(await context.call("relation.options", { ref: of }), (output) =>
          output.kinds.map((kind) => ({ value: kind.kind, name: kind.name, key: kind.kind })),
        )
      : listOf(await context.call("metamodel.get", {}), (output) =>
          output.relations.map((kind) => ({ value: kind.key, name: kind.name, key: kind.key })),
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
  // A path, completed with the entries `workspace.listFolder` gives for the typed text (SR-143 AK2).
  folder: () => Promise.resolve({ kind: "path", files: false }),
  file: () => Promise.resolve({ kind: "path", files: true }),
  // Never asked: the shown list's selection (`inputOf`).
  selection: asText,
  // The sources of the write commands (SR-108 AK4): the values the metamodel allows, each from one read
  // command, as ADR-0010 lists them.
  status: statuses(false),
  invalidStatus: statuses(true),
  // The properties of the element's type; without an element (`element.bulkUpdate`) every property of the
  // metamodel. Never the title, which the commands that take a property refuse.
  property: async ({ context, of }) => {
    const element = await elementOf(context, of);
    if (failed(element)) {
      return element;
    }
    return listOf(await context.call("metamodel.get", {}), (output) => {
      const typed = output.types.find((type) => type.key === element?.type)?.properties;
      return output.properties
        .filter((property) => (typed?.includes(property.key) ?? true) && property.meaning !== "title")
        .map((property) => ({ value: property.key, name: property.name, key: property.key }));
    });
  },
  // The values of the property it reads: its choices, elements of its target types, else typed text.
  value: async ({ context, of }) => {
    const answer = await context.call("metamodel.get", {});
    if (!answer.ok) {
      return { kind: "failed", message: answer.message };
    }
    const property = answer.output.properties.find((candidate) => candidate.key === of);
    return property?.kind === "choice"
      ? {
          kind: "list",
          values: (property.choices ?? []).map((choice) => ({
            value: choice.key,
            name: choice.name,
            key: choice.key,
          })),
        }
      : property?.kind === "relation"
        ? elementsOf(property["target-types"], true)
        : property?.kind === "number"
          ? await typed(numberOr)()
          : await asText();
  },
  // Elements of the target types of the kind it reads: from the element the kind was offered for
  // (`relation.options`), else from the metamodel.
  relationTarget: async ({ context, of, before }) => {
    if (typeof before === "string") {
      const answer = await context.call("relation.options", { ref: before });
      if (!answer.ok) {
        return { kind: "failed", message: answer.message };
      }
      // A kind given before the prompt asked (SR-199) that the source may not have: no target can be taken.
      const kind = answer.output.kinds.find((option) => option.kind === of);
      return kind === undefined
        ? { kind: "failed", message: `The source cannot have a relation of kind ${String(of)}` }
        : elementsOf(kind.targetTypes);
    }
    const answer = await context.call("metamodel.get", {});
    return answer.ok
      ? elementsOf(answer.output.relations.find((kind) => kind.key === of)?.["target-types"])
      : { kind: "failed", message: answer.message };
  },
  // The relations of an element (`relation.remove`): of the element, the kinds of its outgoing relations
  // (relation kinds only, not the properties of kind relation); of a kind, the targets of that kind.
  relation: async ({ context, of, ofSource, before }) => {
    const byKind = ofSource === "relation";
    const element = await elementOf(context, byKind ? before : of);
    if (failed(element)) {
      return element;
    }
    const out = (element?.relations ?? []).filter(
      (relation) => relation.direction === "out" && relation.property !== true,
    );
    if (byKind) {
      return {
        kind: "list",
        values: out
          .filter((relation) => relation.kind === of)
          .map((relation) => ({
            value: relation.id,
            name: refIdTitle(relation),
          })),
      };
    }
    return listOf(await context.call("metamodel.get", {}), (output) =>
      output.relations
        .filter((kind) => out.some((relation) => relation.kind === kind.key))
        .map((kind) => ({ value: kind.key, name: kind.name, key: kind.key })),
    );
  },
  // The hints of the element that can be confirmed (those with a `hintId`), by their target and then
  // their message: the hints of one element differ in their target, which a long message would put out
  // of view (#293). Only the confirmable codes are asked for, on the largest page, so other hints of the
  // element (since a baseline, states) cannot fill the page before them (#146).
  hint: async ({ context, of, taken }) =>
    typeof of === "string"
      ? listOf(
          await context.call("hint.list", {
            ref: of,
            kind: ["relation.outdated", "variant.core-changed"],
            limit: 5000,
          }),
          (output) =>
            output.hints.flatMap((hint) =>
              hint.hintId === undefined || taken.includes(hint.hintId)
                ? []
                : [
                    {
                      value: hint.hintId,
                      name:
                        hint.targetShortId === undefined
                          ? hint.message
                          : `${shownId(hint.targetShortId, hint.targetIdentifier)} · ${hint.message}`,
                    },
                  ],
            ),
        )
      : await asText(),
  // The saved filters of the workspace by name (`filter.list`): "Save perspective" `filter`.
  filter: async ({ context }) =>
    listOf(await context.call("filter.list", {}), (output) =>
      output.filters.map((saved) => ({ value: saved.name, name: saved.name })),
    ),
  // The baselines of the workspace by name (`baseline.list`).
  // A name two files share (ignoring case and Unicode normal form, as core finds it) is ambiguous: such a
  // baseline is given by its file name and shows it.
  baseline: async ({ context }) =>
    listOf(await context.call("baseline.list", {}), (output) => {
      const fold = (name: string): string => name.normalize("NFC").toLowerCase();
      const shared = (name: string): boolean =>
        output.baselines.filter((other) => fold(other.name) === fold(name)).length > 1;
      return output.baselines.map((baseline) => {
        const file = baseline.file.slice(baseline.file.lastIndexOf("/") + 1);
        return shared(baseline.name)
          ? { value: file, name: `${baseline.name} · ${file}` }
          : { value: baseline.name, name: baseline.name };
      });
    }),
  // The perspectives of the workspace by name (`perspective.list`, SR-213).
  perspective: async ({ context }) =>
    listOf(await context.call("perspective.list", {}), (output) =>
      output.perspectives.map((perspective) => ({ value: perspective.name, name: perspective.name })),
    ),
  // `core` and the variants of the workspace, as "Choose view" offers them (#285).
  view: async ({ context }) => {
    const views = await viewsOf(context.call);
    return views.ok
      ? { kind: "list", values: views.views.map((shown) => ({ value: shown.view, name: viewName(shown) })) }
      : { kind: "failed", message: views.message };
  },
  // The acceptance criteria of the element (`element.get` `criterionReferences`) that are not taken yet,
  // by number and text with the key beside; the key goes in, since evidence.record refuses a criterion
  // without one, so such a criterion is not offered (catalog `criterion`). Without an element, typed text.
  criterion: async ({ context, of, taken }) => {
    if (typeof of !== "string") {
      return asText();
    }
    return listOf(await context.call("element.get", { ref: of }), (output) =>
      (output.criterionReferences?.criteria ?? []).flatMap(({ criterion, key, text }) =>
        key === undefined || taken.includes(key)
          ? []
          : [
              {
                value: key,
                name: `AK${String(criterion)} ${text.replace(/\s+/gu, " ")}`,
                key,
                label: criterionLabel({ criterion, key }),
              },
            ],
      ),
    );
  },
  // The evidence locations of the workspace file that evidence.record takes (`workspace.status`
  // `evidence[].folder`, in a repository on this machine), with the repository beside; typed text too,
  // for a folder below one.
  evidenceLocation: async ({ context }) => {
    const offer = listOf(await context.call("workspace.status", {}), (output) => {
      const here = new Set(output.repositories.filter((repo) => repo.available).map((repo) => repo.name));
      const seen = new Set<string>();
      return output.evidence.flatMap(({ folder, repository }) => {
        if (folder === undefined || !here.has(repository) || seen.has(folder)) {
          return [];
        }
        seen.add(folder);
        return [{ value: folder, name: folder, key: repository }];
      });
    });
    return offer.kind === "list" ? { ...offer, typed: true } : offer;
  },
  // The file of the element `of` names (`element.get`), or the files of the elements an ambiguous reference
  // names (`details.candidates` of `ref.ambiguous`, the answer of the same read), the repository beside.
  // A reference element.get does not read (a criterion reference of element.resolve): typed text, which
  // core checks.
  elementFile: async ({ context, of, repository }) => {
    const answer = typeof of === "string" ? await context.call("element.get", { ref: of }) : undefined;
    if (answer?.ok === true) {
      return { kind: "list", values: [fileValue(answer.output.element)] };
    }
    // Only those of a repository given in this run: core refuses the others (`ref.unknown`).
    const candidates = (answer?.code === "ref.ambiguous" ? candidatesOf(answer.details) : []).filter(
      (candidate) => typeof repository !== "string" || candidate.repository === repository,
    );
    return candidates.length > 0 ? { kind: "list", values: fileValues(candidates) } : asText();
  },
  // The repository, then the path below the folder of the new workspace (`ask`, `askLocationPath`).
  metamodelLocation: ({ of }) =>
    Promise.resolve({ kind: "location", ...(typeof of === "string" ? { base: of } : {}) }),
  // The sources the catalog names for SR-215 whose issues are still open (#1646 to #1648) are asked as
  // before: a grouping as text; sorts and the properties and relations of a new element as JSON. Their `FITTING` entries make them readers: a value of one is dropped when the field it reads is
  // refused.
  group: asText,
  // Built step by step from hits (`askCondition`, #1645); never asked through its offer.
  condition: typed(jsonOr),
  sort: typed(jsonOr),
  properties: typed(jsonOr),
  relations: typed(jsonOr),
};

/** What the argument at `at` offers, or why its values cannot be read. */
const offerFor = (
  context: ActionContext,
  entry: Entry,
  at: number,
  arg: Argument,
): Promise<Offer | Failed> => {
  const args = entry.command.arguments;
  const of = contextField(args, at);
  const ofAt = args.findIndex((earlier) => earlier.field === of);
  const before = contextField(args, ofAt);
  const valueOf = (field: string | undefined): unknown =>
    ordered(entry.given).find((given) => given.field === field && given.skipped !== true)?.value;
  const ofSource = args[ofAt]?.complete;
  return OFFERS[arg.complete]({
    context,
    command: entry.command,
    field: arg.field,
    of: valueOf(of),
    ...(ofSource === undefined ? {} : { ofSource }),
    before: valueOf(before),
    taken: entry.given
      .filter((given) => given.field === arg.field && given.skipped !== true)
      .map((given) => given.value),
    ...(arg.meaning === undefined ? {} : { meaning: arg.meaning }),
    repository: valueOf("repository"),
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

/**
 * The list of all elements outside a view shows every element: a command that requires a selection takes
 * all of them, the empty selection (#856: "Bulk update elements" was refused there); else none.
 */
const everyElement = (context: ActionContext, command: CommandListing, field: string): object | undefined =>
  listing(context.buffers[0]) && requiredOf(command).includes(field) ? {} : undefined;

/**
 * The input the given values make, with the shown list's selection for a `selection` argument, in the view
 * the window shows (`selectionInView`): a write on the list acts on the set the list shows.
 */
const inputOf = (context: ActionContext, entry: Entry): Record<string, unknown> => {
  const input: Record<string, unknown> = {};
  const listed = shownSelection(context);
  const shown = context.views?.shown;
  // The list of all elements has no selection: in a view it is the view's (`baseline.create` of a variant's
  // view, SR-103), elsewhere none, or every element for a command that requires one (below).
  const selection =
    shown === undefined || (listed === undefined && context.buffers[0]?.kind !== "list")
      ? listed
      : selectionInView(listed, shown.view);
  for (const arg of entry.command.arguments) {
    const values = ordered(entry.given)
      .filter((given) => given.field === arg.field && given.skipped !== true)
      .map((given) => given.value);
    if (arg.complete === "selection") {
      const taken = selection ?? everyElement(context, entry.command, arg.field);
      if (taken !== undefined) {
        input[arg.field] = taken;
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
  // A field given a value takes the place of the fields it `replaces` (`hint.confirm`: the chosen `hintIds`,
  // not every hint of `ref`, `target` and `kind`; `all` yes, not the shown element as `ref`, #644). `no`
  // takes no place: it chooses nothing.
  const replaced = new Set(
    entry.command.arguments.flatMap((arg) =>
      input[arg.field] === undefined || input[arg.field] === false ? [] : (arg.replaces ?? []),
    ),
  );
  return Object.fromEntries(Object.entries(input).filter(([field]) => !replaced.has(field)));
};

/**
 * Saves the input of every open buffer before a write command runs, so the command neither loses it nor
 * takes its own write for a change on disk; resolves the first buffer whose input could not be saved.
 * Without `saveDraft` nothing is saved, as before autosave.
 */
const unsavedBefore = async (context: CatalogContext): Promise<Buffer | undefined> => {
  const { saveDraft } = context;
  if (saveDraft !== undefined) {
    // The shown buffer last, as a workspace switch saves (`switch.ts`): a failure before it leaves the
    // shown editor as it is.
    for (const buffer of [...context.buffers.slice(1), ...context.buffers.slice(0, 1)]) {
      if (context.drafted(buffer.key) && !(await saveDraft(buffer.key))) {
        return buffer;
      }
    }
  }
  return undefined;
};

/**
 * The one command with a flow of its own (#836; an exception to
 * ADR-0002 rule 3): a confirmation of `element.bulkUpdate` writes only the plan of an open preview of the
 * same input (#158). The app passes the preview's `plan` through and handles the refusal; core decides.
 */
type Input = Readonly<Record<string, unknown>>;
const PREVIEWED: keyof CommandTypes = "element.bulkUpdate";
/** The fields of a confirmation that its preview does not have. */
const CONFIRMING = new Set(["confirm", "plan", "expected"]);

/** The input of the preview of a confirmation: without `confirm`, `plan` and `expected`. */
const previewOf = (input: Input): Input =>
  Object.fromEntries(Object.entries(input).filter(([field]) => !CONFIRMING.has(field)));

/** The `plan` of an open preview of the same input (a result buffer of it), if any. */
const shownPlan = (context: CatalogContext, preview: Input): string | undefined => {
  const wanted = JSON.stringify(preview);
  for (const buffer of context.buffers) {
    if (buffer.kind === "result" && buffer.command === PREVIEWED && JSON.stringify(buffer.input) === wanted) {
      const output = buffer.output as { readonly applied?: unknown; readonly plan?: unknown } | undefined;
      if (output?.applied === false && typeof output.plan === "string") {
        return output.plan;
      }
    }
  }
  return undefined;
};

/** Runs the preview of a confirmation and shows it; `why` says why nothing was written. */
const showPreview = async (
  context: CatalogContext,
  entry: Entry,
  preview: Input,
  why: string,
): Promise<void> => {
  const revision = context.revision();
  const answer = await (context.shownCall ?? context.call)(PREVIEWED, preview);
  if (!answer.ok) {
    context.echo(answer.message);
    return;
  }
  const line = lineOf({ ...entry, given: entry.given.filter((given) => !CONFIRMING.has(given.field)) });
  context.dispatch({
    type: "open",
    buffer: resultBuffer(PREVIEWED, preview, line, answer.output, revision, true),
  });
  context.echo(why);
};

/** Whether the run is a confirmation of a bulk update without a `plan` of its own. */
const isConfirmation = (name: keyof CommandTypes, input: Input): boolean =>
  name === PREVIEWED && input["confirm"] === true && input["plan"] === undefined;

/**
 * The input a confirmation of a bulk update sends: with the plan of an open preview of the same input
 * (#836); without one, the preview is opened first, nothing is written, and the result is undefined.
 */
const planned = async (context: CatalogContext, entry: Entry, given: Input): Promise<Input | undefined> => {
  const plan = shownPlan(context, previewOf(given));
  if (plan === undefined) {
    await showPreview(
      context,
      entry,
      previewOf(given),
      `${entry.command.title}: nothing was written; confirm again to write what the preview shows`,
    );
    return undefined;
  }
  return { ...given, plan };
};

/** Whether core refused a confirmation because the change is no longer the one of its plan (#158). */
const planChanged = (answer: {
  readonly ok: boolean;
  readonly code?: string;
  readonly details?: unknown;
}): boolean =>
  !answer.ok &&
  answer.code === "input.invalid" &&
  (answer.details as { readonly reason?: unknown } | undefined)?.reason === "plan-changed";

/**
 * Shows the output of a command: a new element in its element buffer (SR-064), "About ReqSeq" in its own
 * window (SR-161, D-062), any other output in a result buffer (of a write command, one that is not asked again).
 */
const show = (
  context: CatalogContext,
  entry: Entry,
  input: Input,
  output: unknown,
  revision: number,
): void => {
  const name = entry.command.name as keyof CommandTypes;
  if (name === CREATE_COMMAND) {
    const created = output as CommandTypes[typeof CREATE_COMMAND]["output"];
    context.dispatch({ type: "open", buffer: elementBufferOf(created.element) });
    context.echo(createdEcho(created));
  } else if (name === ABOUT_COMMAND && context.about !== undefined) {
    context.about(output as AboutInfo);
  } else {
    context.dispatch({
      type: "open",
      buffer: resultBuffer(name, input, lineOf(entry), output, revision, isWrite(entry.command)),
    });
  }
};

/**
 * Runs the command with the given values and shows its output (`show`); a refused input asks again. A write
 * command first saves the input of every open buffer, and does not run when one cannot be saved.
 */
const execute = async (context: CatalogContext, entry: Entry): Promise<void> => {
  const name = entry.command.name as keyof CommandTypes;
  const given = inputOf(context, entry);
  const confirming = isConfirmation(name, given);
  // Awaited only for a confirmation, so every other command is sent as before.
  const input = confirming ? await planned(context, entry, given) : given;
  if (input === undefined) {
    return;
  }
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
  const answer = await (context.shownCall ?? context.call)(name, input);
  if (answer.ok) {
    show(context, entry, input, answer.output, revision);
  } else if (confirming && planChanged(answer)) {
    await showPreview(
      context,
      entry,
      previewOf(input),
      `${entry.command.title}: something changed since the preview, so nothing was written; the new preview is shown`,
    );
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
  const entry = {
    ...answered,
    ...(again === undefined ? {} : { again: again.rank }),
    ...(again?.marks === undefined ? {} : { marks: again.marks }),
  };
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

/**
 * The element an element argument offers first: the element of the entry (SR-197: the entry the context
 * menu is open on, or the marked one of a list), else the element shown, else the selected row of the shown
 * list. An element shown read-only (SR-044 AK2) is not offered to a write command, so that buffer stays
 * one a write never starts from by Enter alone; the write can still name it.
 */
const firstOffered = (
  context: CatalogContext,
  entry: Entry,
): ElementBuffer | NeighbourhoodBuffer | undefined => {
  if (context.entry !== undefined) {
    return context.entry;
  }
  const shown = context.buffers[0];
  if (shown?.kind === "element" && shown.readOnly === true && isWrite(entry.command)) {
    return undefined;
  }
  return shown?.kind === "element" || shown?.kind === "neighbourhood" ? shown : context.row;
};

/** One argument back: the value given last is asked again; before the first, the command prompt. */
const back = (context: CatalogContext, entry: Entry): void => {
  askAgain(context, entry, entry.given.length - 1);
};

/**
 * `entry` with `also` given (the repository of a file two repositories hold), in place of a value given to
 * that field before.
 */
const withAlso = (entry: Entry, also: NonNullable<Value["also"]>): Entry => ({
  ...entry,
  given: appended(
    { ...entry, given: entry.given.filter((given) => given.field !== also.field) },
    { field: also.field, value: also.value, label: also.value },
  ),
});

/** Takes a value for `field`; `more` (Ctrl/Cmd+Enter) offers the optional arguments next. */
const give = (
  context: CatalogContext,
  entry: Entry,
  field: string,
  value: unknown,
  label: string,
  more: boolean,
  extra: Pick<Given, "asks" | "marks"> = {},
): void => {
  const { collecting: _was, error: _error, ...rest } = entry;
  step(context, {
    ...rest,
    given: appended(entry, { field, value, label, ...extra }),
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

/** The relation target a found element is, as a property of kind relation takes it (`{ id, repository }`). */
const relationTargetOf = (row: Row): { readonly id: string; readonly repository: string } => ({
  id: row.open.id,
  repository: row.open.repository,
});

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
  const label = rowName(row);
  return { value: { ...relationTargetOf(row), label }, label: row.label };
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
    explain: argumentExplanation(entry, arg),
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
  if (arg.complete === "condition") {
    askCondition(
      {
        context,
        line: `${lineOf(entry)} · ${field}`,
        ...(entry.error === undefined ? {} : { error: entry.error }),
        explain: shared.explain,
        back: shared.back,
        take: (marks, more) => {
          give(context, entry, field, conditionOf(marks), conditionLabel(marks), more, { marks });
        },
      },
      entry.marks ?? [],
    );
    return;
  }
  const take = (
    value: unknown,
    name: string,
    asks?: readonly RequiredProperty[],
    also?: Value["also"],
  ): Pick<Choice, "run" | "more"> => {
    // The other argument goes in first, as if given just before, so Backspace asks this one again.
    const at = also === undefined ? entry : withAlso(entry, also);
    return {
      run: () => {
        give(context, at, field, value, name, false, asks === undefined ? {} : { asks });
      },
      more: () => {
        give(context, at, field, value, name, true, asks === undefined ? {} : { asks });
      },
    };
  };
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
          items: offer.values.map(({ value, name, key, label: given, id, also, asks }) => ({
            id: id ?? JSON.stringify(value),
            name,
            ...(key === undefined || key === name ? {} : { hint: key }),
            ...take(value, given ?? name, asks, also),
          })),
          ...(offer.typed === true
            ? typedFill(offer.values, (text, more) => {
                give(context, entry, field, text, text, more);
              })
            : {}),
        };
      }
      if (offer.kind === "location") {
        return locationFill(context, entry, arg, at, offer.base);
      }
      if (offer.kind === "element") {
        // A relation property's value is a relation target (`inputValue`); an element argument a reference.
        const picked = (row: Row): unknown => (offer.target === true ? relationTargetOf(row) : row.open.id);
        // The element shown, else the selected row of the shown list, comes first, so Enter takes it; not
        // among target types, which it may not have.
        // Not an element given before the prompt asked (the row of the matrix, SR-199 AK3).
        const candidate = offer.types !== undefined ? undefined : firstOffered(context, entry);
        const first = entry.given.some((given) => given.prefilled === true && given.value === candidate?.id)
          ? undefined
          : candidate;
        return {
          items:
            first === undefined
              ? []
              : [
                  {
                    id: first.key,
                    name: bufferName(first),
                    ...take(
                      offer.target === true ? { id: first.id, repository: first.repository } : first.id,
                      idOfName(first.name),
                    ),
                  },
                ],
          find: withTypedReference(
            findElements(
              context,
              (row) => {
                give(context, entry, field, picked(row), row.label, false);
              },
              {
                ...(offer.types === undefined ? {} : { selection: { where: { type: [...offer.types] } } }),
                more: (row) => {
                  give(context, entry, field, picked(row), row.label, true);
                },
              },
            ),
            // Only element.resolve reads a criterion reference; other commands take the element alone.
            offer.target === true || entry.command.name !== "element.resolve"
              ? undefined
              : (text, more) => {
                  give(context, entry, field, text, text, more);
                },
          ),
        };
      }
      if (offer.kind === "path") {
        return pathFill(context, offer.files, (text, more) => {
          give(context, entry, field, text, text, more);
        });
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

/**
 * `find` with the typed text itself first when it is a reference to an acceptance criterion as a test
 * name writes it (`[SR-036/AK-k7f3]`, `criterionReferenceOf` of core), which no search finds: "Resolve
 * reference" takes it so (SR-205 AK5), and core says what is wrong with it. `take` gives the text;
 * without it (a relation target, or an argument of another command than element.resolve) nothing is added.
 */
const withTypedReference =
  (
    find: (query: string) => Promise<readonly Choice[]>,
    take: ((text: string, more: boolean) => void) | undefined,
  ) =>
  async (query: string): Promise<readonly Choice[]> => {
    const found = await find(query);
    const text = query.trim();
    if (take === undefined || criterionReferenceOf(text)?.criterion === undefined) {
      return found;
    }
    return [
      {
        id: `reference:${text}`,
        name: `Use ${text}`,
        run: () => {
          take(text, false);
        },
        more: () => {
          take(text, true);
        },
      },
      ...found,
    ];
  };

/**
 * Typed text besides the hits of a list (an evidence location): Enter with no hit takes it, and a text that
 * names a folder below one of the values ("evidence/manual/2026") is first as "Use <text>", so Enter takes it
 * and not the value it starts with.
 */
const typedFill = (values: readonly Value[], take: (text: string, more: boolean) => void): PromptFill => ({
  literal: (text) =>
    values.some(({ value }) => typeof value === "string" && value !== "." && text.startsWith(`${value}/`))
      ? {
          id: `use:${text}`,
          name: `Use ${text}`,
          run: () => {
            take(text, false);
          },
          more: () => {
            take(text, true);
          },
        }
      : undefined,
  text: (text) => {
    take(text, false);
  },
  more: (text) => {
    take(text, true);
  },
});

/**
 * The first step of a metamodel location (`workspace.init metamodel`): the main repository, the default,
 * or another one typed by its workspace name ("Repository <name>" first while a name is typed); then its
 * path (`askLocationPath`).
 */
const locationFill = (
  context: CatalogContext,
  entry: Entry,
  arg: Argument,
  at: number,
  base: string | undefined,
): PromptFill => {
  const choose = (repository: string | undefined): Pick<Choice, "run" | "more"> => ({
    run: () => {
      askLocationPath(context, entry, arg, at, repository, base, false);
    },
    more: () => {
      askLocationPath(context, entry, arg, at, repository, base, true);
    },
  });
  return {
    items: [{ id: "main", name: "Main repository", hint: "default", ...choose(undefined) }],
    literal: (text) =>
      text.trim() === ""
        ? undefined
        : { id: `repository:${text}`, name: `Repository ${text.trim()}`, ...choose(text.trim()) },
  };
};

/**
 * The second step of a metamodel location: its path, relative to the repository. In the main repository
 * the folders below `base` (the new workspace's folder) complete it and typed text is taken (SR-143 AK4);
 * in another repository, which may not be on this machine yet, it is typed. The value is `{ path }`, or
 * `{ repository, path }`. Backspace in an empty input and Escape go back to the repository.
 */
const askLocationPath = (
  context: CatalogContext,
  entry: Entry,
  arg: Argument,
  at: number,
  repository: string | undefined,
  base: string | undefined,
  more: boolean,
): void => {
  const take = (path: string, also: boolean): void => {
    give(
      context,
      entry,
      arg.field,
      repository === undefined ? { path } : { repository, path },
      repository === undefined ? path : `${repository}:${path}`,
      more || also,
    );
  };
  context.ask({
    label: `${lineOf(entry)} · ${arg.field} · path in ${repository ?? "the main repository"}:`,
    explain: argumentExplanation(entry, arg),
    back: () => {
      ask(context, entry, arg, at);
    },
    items: [],
    ...(repository === undefined && base !== undefined
      ? pathFill(context, false, take, base)
      : {
          text: (text: string) => {
            take(text, false);
          },
          more: (text: string) => {
            take(text, true);
          },
        }),
  });
};

/** `text` below the folder `base`: joined with `/`, which core takes on every platform. */
const below = (base: string, text: string): string =>
  base === "" ? text : `${base.replace(/[\\/]+$/u, "")}/${text}`;

/**
 * The parts of a path argument (SR-143 AK2): the typed text itself first, "Use <path>", so Enter takes a
 * path that names nothing yet (a new export file, AK4), then the entries of its folder, which complete
 * it; relative from the workspace root, `~` for the home folder (core's rule of the app, as the command
 * then resolves it). With `base`, the text is relative to that folder (a metamodel path below a new
 * workspace's folder) and listed there.
 */
const pathFill = (
  context: ActionContext,
  files: boolean,
  take: (text: string, more: boolean) => void,
  base?: string,
): PromptFill => ({
  literal: (text) =>
    text.trim() === ""
      ? undefined
      : {
          id: `use:${text}`,
          name: `Use ${text}`,
          hint: files ? "file" : "folder",
          run: () => {
            take(text, false);
          },
          more: () => {
            take(text, true);
          },
        },
  seek: pathSeeker({
    windows: isWindows(navigator.platform),
    list: async (path) => {
      const answer = await context.call("workspace.listFolder", {
        path: base === undefined ? path : below(base, path),
        files,
      });
      return answer.ok ? answer.output : { failed: answer.message };
    },
  }),
  text: (text) => {
    take(text, false);
  },
  more: (text) => {
    take(text, true);
  },
});

/**
 * Whether the prompt of the optional arguments offers `arg`: one it can ask that has no value yet, and not the
 * properties of a new element once its type asked them (SR-064).
 */
const offeredLater = (entry: Entry, arg: Argument): boolean =>
  arg.complete !== "selection" &&
  !entry.given.some((given) => given.field === arg.field && given.skipped !== true) &&
  !(arg.field === PROPERTIES && entry.given.some((given) => given.asks !== undefined));

/**
 * The explanation line of `arg` while it is asked (SR-210 AK2): its name and catalog description, and what
 * the keys of this step do, as `ask` sets them: Enter adds a value of a list, Enter on an empty input ends
 * its values once one is given or skips an optional argument (`follows`), Ctrl/Cmd+Enter offers the optional
 * arguments the command still has (`moreArguments`).
 */
const argumentExplanation = (entry: Entry, arg: Argument): ArgumentExplanation => {
  const { description } = schemaOf(entry.command, arg.field);
  const asked = askedOf(entry.command);
  const ends = entry.collecting === arg.field;
  return {
    name: arg.field,
    ...(typeof description === "string" ? { description } : {}),
    list: isListField(entry.command, arg.field),
    ends,
    skips: !ends && follows(entry, arg),
    more: entry.command.arguments.some(
      (other) => other.field !== arg.field && !asked.includes(other.field) && offeredLater(entry, other),
    ),
  };
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
        offeredLater(entry, arg)
          ? [
              {
                id: arg.field,
                name: arg.field,
                run: () => {
                  ask(context, entry, arg, at);
                },
              },
            ]
          : [],
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
  const { again: _again, marks: _marks, ...entry } = answered;
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

/**
 * Starts the argument entry of `command`; `more` (Ctrl/Cmd+Enter on it) offers the optional arguments too.
 * The arguments in `prefilled` count as given, in their order (SR-199: the matrix's "Create relation" asks
 * only the other end); the prompt asks the others, and Backspace asks a given one again.
 */
export const startCommand = (
  context: CatalogContext,
  command: CommandListing,
  more: boolean,
  prefilled: readonly Prefilled[] = [],
): void => {
  step(context, {
    command,
    given: prefilled.map((value, at) => ({ ...value, prefilled: true, rank: at + 1 })),
    more,
  });
};

/**
 * The command that runs in a folder without a workspace: core opens such a folder for it (`core/process.ts`),
 * and it is the only catalog command the prompt offers there.
 */
const WITHOUT_WORKSPACE = "workspace.init";

/**
 * Whether the prompt offers the command (SR-073 AK2: every function of the app by its name): every
 * implemented read and write command, except `element.update`, which the element buffer does ("Save
 * element" covers it, with "Edit title", "Add property" and "Clear property"), and only
 * `workspace.init` while no workspace is open.
 */
const listed = (context: CatalogContext, command: CommandListing): boolean =>
  command.implemented && (context.workspace || command.name === WITHOUT_WORKSPACE);

/**
 * The catalog commands the command prompt offers now (`listed`) that no action covers (by title or by
 * `covers`), each by its title and whether it fits the shown view (SR-133). While the workspace is
 * read-only, no write command that core refuses then (`whileReadOnly`).
 */
export const catalogItems = (
  context: CatalogContext,
  catalog: readonly CommandListing[],
  actions: readonly Action[],
): Choice[] => {
  return catalog
    .filter(
      (command) =>
        listed(context, command) &&
        !(context.readOnly === true && command.whileReadOnly === "refuse") &&
        coveringAction(command, actions) === undefined &&
        offered(context, command),
    )
    .map((command) => {
      const id = `command:${command.name}`;
      // A command with a letter after the prefix key shows it ("Ctrl+K E", SR-121 AK3).
      const hint = bindingLabel(id, context.mac);
      return {
        id,
        name: command.title,
        ...(hint === undefined ? {} : { hint }),
        fits: fits(context, command),
        explain: commandExplanation(command, context.given?.[command.name]),
        help: commandHelp(command),
        run: () => {
          startCommand(context, command, false, context.given?.[command.name]);
        },
        more: () => {
          startCommand(context, command, true, context.given?.[command.name]);
        },
      };
    });
};
