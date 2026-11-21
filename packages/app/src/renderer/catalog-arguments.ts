// The arguments of a catalog command as the command prompt reads them (`catalog-commands.ts` walks the
// catalog): the field a source reads, which arguments are asked and when, whether a command fits the shown
// view, its explanation line and help, and the input the given values make (`inputOf`).

import type { CommandTypes } from "@reqseq/core";
import type { CommandListing } from "../shared/protocol.js";
import type { ActionContext, CommandExplanation, CommandHelp } from "./action-types.js";
import { packagePage } from "./list-actions.js";
import { listing } from "./buffers.js";
import type { PropertyAnswer, RequiredProperty } from "./create-element.js";
import { propertiesInput } from "./create-element.js";
import type { Prefilled } from "./matrix-menu.js";
import type { Entry, Given } from "./catalog-entry.js";
import { ordered } from "./catalog-entry.js";
import { selectionInView } from "./views.js";

export type Argument = CommandListing["arguments"][number];
export type Source = Argument["complete"];

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

/**
 * The fields of the call a `group` reads, besides `contextField`: the selection its elements come from
 * (SR-215 AK1, #1647), each one before it in the catalog's order.
 */
const GROUP_READS: readonly string[] = ["where", "filter", "perspective", "selection"];

/** The earlier fields the argument at `at` reads for its selection: those of `GROUP_READS` for a `group`. */
export const groupReads = (args: readonly Argument[], at: number): readonly string[] =>
  args[at]?.complete === "group"
    ? args.slice(0, at).flatMap((earlier) => (GROUP_READS.includes(earlier.field) ? [earlier.field] : []))
    : [];

export const schemaOf = (command: CommandListing, field: string): FieldSchema => {
  const properties = (command.input as { readonly properties?: Readonly<Record<string, FieldSchema>> })
    .properties;
  return properties?.[field] ?? {};
};

const requiredOf = (command: CommandListing): readonly string[] =>
  (command.input as { readonly required?: readonly string[] }).required ?? [];

export const isWrite = (command: CommandListing): boolean => command.effect !== "read";

/**
 * The optional arguments the app asks as steps, as if they were required, by command: "Connect AI agent" asks
 * the client among its fixed values (SR-227 AK1), while CLI, API and MCP without it list the clients. Named
 * here one by one, so the other optional arguments of read commands stay behind Ctrl/Cmd+Enter.
 */
export const ASKED_IN_APP: ReadonlyMap<string, readonly string[]> = new Map([
  ["workspace.connectAgent", ["client"]],
]);

/**
 * The write commands that run at once without asking an argument: "Agent guide" shows the agent guide with the
 * calls of the command line and writes nothing without `write` (SR-229 AK18); its other arguments stay behind
 * Ctrl/Cmd+Enter.
 */
const RUNS_AT_ONCE: ReadonlySet<string> = new Set(["tool.guide"]);

/**
 * The arguments asked before the command runs: the required ones, and those of `ASKED_IN_APP`. A write command
 * without any asks its first argument as if it were required (`hint.confirm`: `ref`, the shown element first),
 * so it never runs at once on an empty input, except those of `RUNS_AT_ONCE`.
 */
export const askedOf = (command: CommandListing): readonly string[] => {
  const required = [...requiredOf(command), ...(ASKED_IN_APP.get(command.name) ?? [])];
  const first = command.arguments.find((arg) => arg.complete !== "selection");
  return required.length > 0 || !isWrite(command) || first === undefined || RUNS_AT_ONCE.has(command.name)
    ? required
    : [first.field];
};

/**
 * An optional argument a write command asks right after the required ones, in catalog order: one whose
 * explicit `of` names a field given in this run (`hint.confirm hintIds` of `ref`, `element.bulkUpdate value`
 * of `property`). Enter on an empty input skips it, or ends its values. The nearest-field default of
 * `contextField` pulls nothing in, and a read command asks only its required arguments.
 */
export const follows = (entry: Entry, arg: Argument): boolean =>
  isWrite(entry.command) &&
  arg.of !== undefined &&
  !askedOf(entry.command).includes(arg.field) &&
  entry.given.some((given) => given.field === arg.of && given.skipped !== true);

export const isListField = (command: CommandListing, field: string): boolean =>
  schemaOf(command, field).type === "array";

/**
 * The one command with a flow of its own (SR-071 AK5; an exception to ADR-0002 rule 3): after the last argument of
 * `element.bulkUpdate` the app runs the preview (the call without `confirm`), shows it in a result buffer and asks the
 * confirmation (`confirmation.ts`); confirming sends the shown preview's `plan` with `confirm` (SR-071 AK2, #158).
 * The app passes the plan through and handles the refusal; core decides. The prompt asks none of `CONFIRMING`
 * itself (SR-215 AK2); CLI, API and MCP take them as the catalog has them.
 */
export type Input = Readonly<Record<string, unknown>>;
export const PREVIEWED = "element.bulkUpdate" satisfies keyof CommandTypes;
/** The fields of the confirmed call that the preview does not have, which the prompt never asks. */
const CONFIRMING = new Set(["confirm", "plan", "expected"]);
export type Preview = CommandTypes[typeof PREVIEWED]["output"];

/**
 * The commands whose `dryRun` the app does not offer yet (SR-246: its criteria name the CLI, the API and the MCP
 * server; the app's come with a change of the spec of their own), so the prompt never asks it.
 */
const DRY_RUN_LATER: ReadonlySet<string> = new Set(["element.create", "element.update"]);

/**
 * Whether the prompt asks `arg` of `command`: never a `selection`, nor a field of the confirmation step, nor the
 * `dryRun` the app does not offer yet (`DRY_RUN_LATER`).
 */
export const promptable = (command: CommandListing, arg: Argument): boolean =>
  arg.complete !== "selection" &&
  !(command.name === PREVIEWED && CONFIRMING.has(arg.field)) &&
  !(arg.field === "dryRun" && DRY_RUN_LATER.has(command.name));

/**
 * The arguments the prompt can ask: all but a `selection`, which the shown list or page gives (`shownSelection`), and
 * the fields of the confirmation of a bulk update, which is a step of its own (`promptable`, SR-215 AK2).
 */
export const askable = (command: CommandListing): readonly Argument[] =>
  command.arguments.filter((arg) => promptable(command, arg));

/**
 * The explanation line of the entry of `command` while it is marked (SR-210 AK1): its summary and the number of
 * the optional arguments Ctrl/Cmd+Enter offers, as the catalog has them; not those `given` before the prompt asks
 * (SR-199), which it does not ask.
 */
export const commandExplanation = (
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
export const offered = (context: ActionContext, command: CommandListing): boolean =>
  command.arguments.every(
    (arg) => arg.complete !== "selection" || !askedOf(command).includes(arg.field) || givesSelection(context),
  );

/**
 * Whether the command fits the shown view (SR-133 AK1): the view gives one of its arguments. A list or a
 * package page gives its selection; an element buffer or a neighbourhood gives its element to a required element argument,
 * which the prompt offers first for it. A selection counts even when it is optional, because `inputOf`
 * fills it in from the list without asking, so the command runs on what the list shows. An optional
 * element argument does not count: it is asked only after Ctrl/Cmd+Enter and the command runs without
 * it, so the shown element plays no part in a plain run. In the overview every command fits.
 */
export const fits = (context: ActionContext, command: CommandListing): boolean => {
  const shown = context.buffers[0]?.kind;
  const required = askedOf(command);
  return (
    shown === "overview" ||
    command.arguments.some((arg) =>
      arg.complete === "selection"
        ? givesSelection(context)
        : arg.complete === "element" &&
          required.includes(arg.field) &&
          (shown === "element" || shown === "neighbourhood"),
    )
  );
};

/** The properties the given values ask (SR-064): the required properties of the type of a new element. */
export const asksOf = (entry: Entry): readonly RequiredProperty[] =>
  entry.given.flatMap((given) => given.asks ?? []);

/** The values given to the properties, without the skipped ones. */
export const answersOf = (entry: Entry): { readonly key: string; readonly value: PropertyAnswer }[] =>
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

/** The value of a field given `givens`: a list field all of them, but a list built from hits (a sort) is one. */
const fieldValue = (command: CommandListing, field: string, givens: readonly Given[]): unknown =>
  isListField(command, field) && givens[0]?.marks === undefined
    ? givens.map((given) => given.value)
    : givens[0]?.value;

/**
 * The input the given values make, with the shown list's selection for a `selection` argument, in the view
 * the window shows (`selectionInView`): a write on the list acts on the set the list shows.
 */
export const inputOf = (context: ActionContext, entry: Entry): Record<string, unknown> => {
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
    const givens = ordered(entry.given).filter(
      (given) => given.field === arg.field && given.skipped !== true,
    );
    if (arg.complete === "selection") {
      const taken = selection ?? everyElement(context, entry.command, arg.field);
      if (taken !== undefined) {
        input[arg.field] = taken;
      }
    } else if (arg.complete === "properties" && entry.given.some((given) => given.field === arg.field)) {
      // The required properties asked one by one (SR-064), then those built from marks (SR-215 AK8).
      const built = givens.find((given) => given.marks !== undefined)?.value as object | undefined;
      const properties = { ...propertiesInput(asksOf(entry), answersOf(entry)), ...built };
      if (Object.keys(properties).length > 0) {
        input[arg.field] = properties;
      }
    } else if (givens.length > 0) {
      input[arg.field] = fieldValue(entry.command, arg.field, givens);
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

/** The title the command runs under: a builder's (SR-219), else the command's. */
export const titleOf = (entry: Entry): string => entry.builder?.title ?? entry.command.title;
