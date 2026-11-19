// Catalog commands in the command prompt (SR-073 AK2, SR-108, ThomasBirkmaier/ReqSeq-archive#85). The prompt lists the implemented read
// and write commands by their `title`, except those an app action covers; while the workspace is
// read-only, no write command that core refuses then; while a folder without a workspace is open, only
// "Create workspace". Choosing one asks its arguments one by one in the command prompt, Emacs
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
// nothing asked in this run asks the value given last. The message stays with the argument it names: a step back
// drops it (#1703).
//
// "Create element" (`element.create`, SR-064) asks, after the type and the title, each required property of
// the type in turn (`create-element.ts`): a choice among the choices of the metamodel, a relation target
// found by search among its target types, or typed text; a list property takes one value per Enter. An
// empty input skips the property, or ends the values of a list. With Ctrl/Cmd+Enter `properties` and `relations`
// are built from marks (`create-prompt.ts`, SR-215 AK8). The new element opens in its element buffer, and the
// command prompt says how many hints core gave.
//
// A write command is asked like a read command, with two more rules: one without required arguments asks
// its first argument (`hint.confirm`: `ref`), and an optional argument whose explicit `of` names a field
// given in this run is asked after the required ones (`hintIds` of `ref`, `value` of `property`); Enter on
// an empty input skips it. Before it runs, the input of every open buffer is saved; when one cannot be
// saved, it does not run. Its output opens a result buffer that is not asked again (that would write
// again). `element.bulkUpdate` asks no `confirm`, `plan` or `expected` (SR-215 AK2): after its last argument
// it shows the preview in a result buffer and asks the confirmation as the next step (`confirmation.ts`,
// SR-071 AK5); confirming sends the shown preview's `plan`, and when core refuses the plan (`plan-changed`)
// it shows the new preview and asks again.
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
// the path; `group` the groupings of the elements the call's earlier `where`, `filter`, `perspective` and shown
// selection select (one `element.facets`, `group-prompt.ts`); a `condition` is built from hits as marks
// (`condition-prompt.ts`, SR-215 AK3). A hit the
// metamodel names shows its key beside the name (SR-215 AK1). A `selection` is never
// asked: it is the shown list's, or on a package page its package (`selection.package`), for every command
// with a selection, reads and writes alike.
//
// This file walks the catalog: the state of the entry and the shape the values built from hits share are in
// `catalog-entry.ts`; what the prompt reads of the arguments and the input they make in `catalog-arguments.ts`,
// the values each source offers in `catalog-offers.ts`, the run of a write command with the preview of a bulk
// update in `catalog-preview.ts`, and typed text and paths in `catalog-fills.ts`. Each value built from hits is a module of its own with its steps and the value it gives
// (`condition-prompt.ts`, `sort-prompt.ts`, `create-prompt.ts`); the grouping's offer is `group-prompt.ts`.
// "New perspective" and "New saved filter" ask the steps of `perspective.save` and `filter.save` in turn
// (`startBuilder`, SR-219).

import type { CommandTypes } from "@reqseq/core";
import type { CommandListing } from "../shared/protocol.js";
import type {
  Action,
  BuiltCommand,
  ArgumentExplanation,
  Choice,
  Prompt,
  PromptFill,
} from "./action-types.js";
import { ACTIONS, findElements } from "./actions.js";
import { bindingLabel } from "./bindings.js";
import { coveredCommand, coveringAction, shownIn } from "./command-entry.js";
import type { ElementBuffer, NeighbourhoodBuffer } from "./buffers.js";
import { DEFAULT_SORT, bufferName, perspectiveModified } from "./buffers.js";
import type { PropertyAnswer, RequiredProperty } from "./create-element.js";
import { idOfName } from "./id-title.js";
import type { Prefilled } from "./matrix-menu.js";
import { choiceItems } from "./property-edit.js";
import type { Builder, BuiltAsk, BuiltMark, Entry, Failed, Given, Value } from "./catalog-entry.js";
import { appended, failed, heldMarks, lineOf, ordered, unheld } from "./catalog-entry.js";
import type { ConditionAsk, ConditionMark } from "./condition-prompt.js";
import { askCondition, conditionLabel, conditionOf } from "./condition-prompt.js";
import type { SortAsk, SortMark } from "./sort-prompt.js";
import type { BuildAsk, PropertyMark, RelationMark } from "./create-prompt.js";
import { askProperties, askRelations, marksLabel, propertiesOf, relationsOf } from "./create-prompt.js";
import { SAVE, askSort, keyLabel, sortMarksLabel, sortOf } from "./sort-prompt.js";
import { NO_GROUPING } from "./group-prompt.js";
import { fold } from "@reqseq/core/fold";
import { openPerspective, replacesFilter } from "./perspective-actions.js";
import { rowName } from "./rows.js";
import type { Row } from "./rows.js";
import type { Argument, CatalogContext, Preview } from "./catalog-arguments.js";
import {
  contextField,
  groupReads,
  schemaOf,
  isWrite,
  askedOf,
  follows,
  isListField,
  PREVIEWED,
  promptable,
  commandExplanation,
  commandHelp,
  offered,
  fits,
  asksOf,
  answersOf,
  inputOf,
} from "./catalog-arguments.js";
import { offerFor } from "./catalog-offers.js";
import { previewed, drafted, notSaved, show } from "./catalog-preview.js";
import { withTypedReference, typedFill, pathFill } from "./catalog-fills.js";

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

/**
 * Runs the command with the given values and shows its output (`show`); a refused input asks again. A write
 * command first saves the input of every open buffer, and does not run when one cannot be saved.
 */
const execute = async (context: CatalogContext, entry: Entry): Promise<void> => {
  const name = entry.command.name as keyof CommandTypes;
  const input = inputOf(context, entry);
  if (isWrite(entry.command) && drafted(context) && (await notSaved(context, entry))) {
    return;
  }
  // The revision the command reads: a change while it runs makes the result view ask again.
  const revision = context.revision();
  const answer = await (context.shownCall ?? context.call)(name, input);
  if (entry.builder !== undefined) {
    await builderAnswered(context, entry, input, answer);
  } else if (answer.ok && name === PREVIEWED) {
    previewed(context, entry, input, answer.output as Preview, revision, back);
  } else if (answer.ok) {
    show(context, entry, input, answer.output, revision);
  } else if (answer.code === "input.invalid" && entry.given.length > 0) {
    // The prompt asks the value core refused again, else the one given last, with core's message.
    askAgain(context, { ...entry, error: answer.message }, refusedAt(entry, answer.details));
  } else {
    context.echo(answer.message);
  }
};

/**
 * After "Save" in a builder: the saved perspective or filter (`saved`); a refusal asks the step of the refused
 * argument again with core's message, else the last step; the answers stand (SR-219 AK7).
 */
const builderAnswered = async (
  context: CatalogContext,
  entry: Entry,
  input: Record<string, unknown>,
  answer: Awaited<ReturnType<CatalogContext["call"]>>,
): Promise<void> => {
  if (answer.ok) {
    await saved(context, entry, String(input["name"]));
    return;
  }
  const at = answer.code === "input.invalid" ? refusedAt(entry, answer.details) : entry.given.length - 1;
  askAgain(context, { ...entry, error: answer.message }, at);
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
  // A property of the marks of `properties` (SR-215 AK8) is refused in the value built from them.
  const built = (given: Given): boolean =>
    given.property === undefined &&
    given.marks?.some((mark) => "property" in mark && mark.property === refused?.property) === true;
  const places = entry.given.flatMap((given, at) =>
    refused?.field === given.field && (refused.property === given.property || built(given)) ? [at] : [],
  );
  const named =
    refused?.index !== undefined
      ? places[refused.index]
      : refused !== undefined && "value" in refused
        ? places.find((at) => JSON.stringify(entry.given[at]?.value) === JSON.stringify(refused.value))
        : undefined;
  return named ?? places.at(-1) ?? entry.given.length - 1;
};

/**
 * The arguments whose offer reads `field`, also through another one (`contextField`: `target` ← `kind` ←
 * `source`), and a `group` the fields its selection comes from (`groupReads`).
 */
const readersOf = (args: readonly Argument[], field: string): ReadonlySet<string> => {
  const readers = new Set<string>();
  let grown = true;
  while (grown) {
    grown = false;
    args.forEach((arg, at) => {
      const reads = [contextField(args, at), ...groupReads(args, at)];
      if (
        !readers.has(arg.field) &&
        reads.some((read) => read === field || (read !== undefined && readers.has(read)))
      ) {
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
  if (answered.builder === undefined) {
    askCommandAgain(context, answered, at);
  } else {
    builderAgain(context, answered, answered.builder, at);
  }
};

/** `askAgain` outside a builder. */
const askCommandAgain = (context: CatalogContext, answered: Entry, at: number): void => {
  const again = answered.given[at];
  const readers =
    again === undefined ? new Set<string>() : readersOf(answered.command.arguments, again.field);
  // Marks held for a reader go with the value it reads (a new type has other properties, SR-215 AK8).
  const { held, ...kept } = answered;
  const entry = {
    ...kept,
    ...(held === undefined || readers.has(held.field) ? {} : { held }),
    ...(again === undefined ? {} : { again: again.rank }),
    ...(again?.marks === undefined ? {} : { marks: again.marks }),
  };
  const itsProperties = new Set((again?.asks ?? []).map((asked) => asked.key));
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

/**
 * One argument back: the value given last is asked again; before the first, the command prompt. Core's
 * message of a refusal stays with the argument it names, so the step back drops it (#1703).
 */
const back = (context: CatalogContext, entry: Entry): void => {
  const { error: _error, ...rest } = entry;
  if (rest.builder === undefined) {
    askAgain(context, rest, rest.given.length - 1);
  } else {
    // A builder shows the step answered last again, with its answer and marks (SR-219 AK6).
    buildStep(context, rest, rest.builder, rest.builder.done);
  }
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
    // A sort built from hits is given whole: its list takes no more values.
    ...(isListField(entry.command, field) && !more && extra.marks === undefined ? { collecting: field } : {}),
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

/**
 * What the steps of a value built from hits at `field` share (`BuiltAsk`): the line, back with the marks held,
 * the marks taken as the value `value` gives them, named by `label`, and the argument skipped.
 */
const builtAsk = <M extends BuiltMark>(
  context: CatalogContext,
  entry: Entry,
  field: string,
  explain: ArgumentExplanation,
  value: (marks: readonly M[]) => unknown,
  label: (marks: readonly M[]) => string,
): BuiltAsk<M> & { readonly skip: (more: boolean) => void } => {
  const rest = unheld(entry, field);
  return {
    context,
    line: `${lineOf(entry)} · ${field}`,
    ...(entry.error === undefined ? {} : { error: entry.error }),
    explain,
    back: (marks) => {
      const { marks: _again, ...left } = entry;
      back(context, { ...left, held: { field, marks } });
    },
    take: (marks, more) => {
      give(context, rest, field, value(marks), label(marks), more, { marks });
    },
    skip: (more) => {
      skip(context, rest, field, more);
    },
  };
};

/**
 * What the steps of a condition need (SR-215): its schema, the line, back with the marks held, the value the
 * marks give; in a builder the name of its take hit, "Next: <step>" (SR-219 AK2, AK3). Its back keeps the marks
 * asked again in the entry.
 */
const conditionAsk = (
  context: CatalogContext,
  entry: Entry,
  field: string,
  explain: ArgumentExplanation,
): ConditionAsk => {
  const next = nextStep(entry);
  return {
    ...builtAsk(context, entry, field, explain, conditionOf, conditionLabel),
    schema: schemaOf(entry.command, field),
    back: (marks) => {
      back(context, { ...entry, held: { field, marks } });
    },
    ...(next === undefined ? {} : { next: `Next: ${next}` }),
  };
};

/** Asks the properties or the relations of a new element of the type given from marks (SR-215 AK8). */
const askBuilt = (
  context: CatalogContext,
  entry: Entry,
  arg: Argument,
  at: number,
  explain: ArgumentExplanation,
): void => {
  const { field } = arg;
  const of = contextField(entry.command.arguments, at);
  const shared = <M extends BuiltMark>(value: (marks: readonly M[]) => unknown): BuildAsk<M> => ({
    ...builtAsk(context, entry, field, explain, value, marksLabel),
    type: ordered(entry.given).find((given) => given.field === of && given.skipped !== true)?.value,
    filled: answersOf(entry).map((answer) => answer.key),
  });
  const held = heldMarks(entry, field);
  if (arg.complete === "properties") {
    askProperties(
      shared(propertiesOf),
      held.filter((mark): mark is PropertyMark => "property" in mark),
    );
  } else {
    askRelations(
      shared(relationsOf),
      held.filter((mark): mark is RelationMark => "target" in mark),
    );
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
      conditionAsk(context, entry, field, shared.explain),
      heldMarks(entry, field).filter((mark): mark is ConditionMark => "condition" in mark),
    );
    return;
  }
  if (arg.complete === "sort") {
    askSort(
      sortAsk(context, entry, builtAsk(context, entry, field, shared.explain, sortOf, sortMarksLabel)),
      heldMarks(entry, field).filter((mark): mark is SortMark => "key" in mark),
    );
    return;
  }
  if (arg.complete === "properties" || arg.complete === "relations") {
    askBuilt(context, entry, arg, at, shared.explain);
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
        // A builder goes on without the groupings it could not read (SR-219 AK2).
        return { label: `${offer.message} · ${label}`, items: noGrouping(context, entry, arg) };
      }
      if (offer.kind === "list") {
        return {
          items: builderOrder(
            context,
            entry,
            arg,
            offer.values.map(({ value, name, key, label: given, id, also, asks }) => ({
              value,
              choice: {
                id: id ?? JSON.stringify(value),
                name,
                ...(key === undefined || key === name ? {} : { hint: key }),
                ...take(value, given ?? name, asks, also),
              },
            })),
          ),
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
            context,
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

/**
 * Whether the prompt of the optional arguments offers `arg`: one it can ask that has no value yet; the properties
 * of a new element also after its required ones were asked (SR-215 AK8), until they are built from marks.
 */
const offeredLater = (entry: Entry, arg: Argument): boolean =>
  promptable(entry.command, arg) &&
  !entry.given.some(
    (given) => given.field === arg.field && given.skipped !== true && given.property === undefined,
  );

/**
 * The explanation line of `arg` while it is asked (SR-210 AK2): its name and catalog description, and what
 * the keys of this step do, as `ask` sets them: Enter adds a value of a list, Enter on an empty input ends
 * its values once one is given or skips an optional argument (`follows`), Ctrl/Cmd+Enter offers the optional
 * arguments the command still has (`moreArguments`).
 */
const argumentExplanation = (entry: Entry, arg: Argument): ArgumentExplanation => {
  const { description } = schemaOf(entry.command, arg.field);
  // A builder offers the optional arguments that are no step (SR-219 AK5).
  const asked = entry.builder?.steps ?? askedOf(entry.command);
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
  if (entry.builder !== undefined) {
    builderStep(context, entry, entry.builder);
    return;
  }
  const { arguments: args } = entry.command;
  const asked = askedOf(entry.command);
  const open = (arg: Argument): boolean =>
    promptable(entry.command, arg) && !entry.given.some((given) => given.field === arg.field);
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
 * The steps of the builders (SR-219 AK2, AK3): "New perspective" asks name, condition, grouping and sort, "New
 * saved filter" name, condition and sort. Their other optional arguments come with Ctrl/Cmd+Enter (AK5).
 */
const BUILT_STEPS: Readonly<Record<BuiltCommand, readonly string[]>> = {
  "perspective.save": ["name", "where", "group", "sort"],
  "filter.save": ["name", "where", "sort"],
};

/** How "Next: <step>" names a step of a builder (SR-219 AK2, AK3). */
const STEP_NAMES: Readonly<Record<string, string>> = { where: "condition", group: "grouping", sort: "sort" };

/** The step after the one a builder asks now, by its name in "Next: <step>"; none outside a builder. */
const nextStep = (entry: Entry): string | undefined => {
  const field = entry.builder?.steps[entry.builder.done + 2];
  return field === undefined ? undefined : (STEP_NAMES[field] ?? field);
};

/**
 * `context` whose prompts show the marks of the steps of the builder before step `at`, without × (SR-219 AK6):
 * the marks of a condition or sort, and the grouping. A prompt that has them already keeps its own.
 */
const withEarlier = (context: CatalogContext, entry: Entry, at: number): CatalogContext => {
  const earlier = (entry.builder?.steps ?? []).slice(1, at).flatMap((field) => {
    const given = entry.given.find((value) => value.field === field && value.skipped !== true);
    if (given === undefined) {
      return [];
    }
    return given.marks === undefined ? [`grouped by ${given.label}`] : given.marks.map((mark) => mark.label);
  });
  return {
    ...context,
    ask: (prompt) => {
      context.ask({ earlier, ...prompt });
    },
  };
};

/**
 * Asks step `at` of a builder (SR-219): before the first, the command prompt; after the last, the command runs. A
 * step that has an answer (after a refusal, AK7) is asked again with it and its marks, in its place.
 */
const buildStep = (context: CatalogContext, entry: Entry, builder: Builder, at: number): void => {
  if (at < 0) {
    context.reopen();
    return;
  }
  const field = builder.steps[at];
  const index = entry.command.arguments.findIndex((arg) => arg.field === field);
  const arg = entry.command.arguments[index];
  if (arg === undefined) {
    void execute(context, { ...entry, builder });
    return;
  }
  const answered = entry.given.find((given) => given.field === field);
  const { again: _again, marks: _marks, previous: _previous, ...rest } = entry;
  const next: Entry = {
    ...rest,
    builder: { ...builder, done: at - 1 },
    given: entry.given.filter((given) => given !== answered),
    ...(answered === undefined ? {} : { again: answered.rank }),
    ...(answered?.marks === undefined ? {} : { marks: answered.marks }),
    ...(answered === undefined || answered.skipped === true
      ? {}
      : { previous: { field: arg.field, value: answered.value } }),
  };
  if (at === 0) {
    askName(withEarlier(context, next, at), next, arg, answered?.value);
  } else {
    ask(withEarlier(context, next, at), next, arg, index);
  }
};

/**
 * The step after an answer in a builder (SR-219 AK5): the next step, never the run before "Save"; after
 * Ctrl/Cmd+Enter first the optional arguments that are no step (`builderMore`).
 */
const builderStep = (context: CatalogContext, entry: Entry, builder: Builder): void => {
  const last = entry.given.at(-1);
  const done =
    last !== undefined && last.field === builder.steps[builder.done + 1] ? builder.done + 1 : builder.done;
  const now = { ...builder, done };
  const answered: Entry = { ...entry, more: false, builder: now };
  if (entry.more) {
    const shown = withEarlier(context, answered, done + 1);
    shown.ask(builderMore(shown, answered, now));
  } else {
    buildStep(context, answered, now, done + 1);
  }
};

/**
 * The optional arguments of a builder that are no step (SR-219 AK5): "Next: <step>" first, after the last step
 * "Save", then each one not given yet; an answer goes on with the next step. Escape shows the step answered last.
 */
const builderMore = (context: CatalogContext, entry: Entry, builder: Builder): Prompt => {
  const next = nextStep({ ...entry, builder: { ...builder, done: builder.done - 1 } });
  const go = (): void => {
    buildStep(context, entry, builder, builder.done + 1);
  };
  return {
    label: `${lineOf(entry)} · more arguments:`,
    back: () => {
      buildStep(context, entry, builder, builder.done);
    },
    items: [
      { id: "next", name: next === undefined ? SAVE : `Next: ${next}`, run: go, more: go },
      ...entry.command.arguments.flatMap((arg, at) =>
        !builder.steps.includes(arg.field) && offeredLater(entry, arg)
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

/**
 * Asks again what core refused in a builder (SR-219 AK7): the step of the value at `at` with core's message, its
 * answer and marks there; an optional argument that is no step itself, and after it the last step. The other
 * answers stay.
 */
const builderAgain = (context: CatalogContext, answered: Entry, builder: Builder, at: number): void => {
  const again = answered.given[at];
  const index = answered.command.arguments.findIndex((arg) => arg.field === again?.field);
  const arg = answered.command.arguments[index];
  const place = builder.steps.indexOf(arg?.field ?? "");
  if (again === undefined || arg === undefined || place >= 0) {
    buildStep(context, answered, builder, place >= 0 ? place : builder.steps.length - 1);
    return;
  }
  const entry: Entry = {
    ...answered,
    given: answered.given.filter((_, value) => value !== at),
    again: again.rank,
    builder: { ...builder, done: builder.steps.length - 2 },
  };
  ask(withEarlier(context, entry, builder.steps.length - 1), entry, arg, index);
};

/** How the line names the sort a perspective saves without a key (SR-219 AK2): `DEFAULT_SORT`. */
const DEFAULT_SORT_LABEL = sortMarksLabel(DEFAULT_SORT.map((key) => ({ label: keyLabel(key), key })));

/**
 * What "Save" takes in the last step of a builder (SR-219 AK2, AK3): the marks; without one a perspective the
 * sort by type and ID, as "Save list as perspective" saves a list sorted by nothing chosen (SR-214 AK5), and a
 * saved filter no sort.
 */
const builderSort =
  (
    context: CatalogContext,
    entry: Entry,
    built: {
      readonly take: (marks: readonly SortMark[], more: boolean) => void;
      readonly skip: (more: boolean) => void;
    },
  ) =>
  (marks: readonly SortMark[], more: boolean): void => {
    if (marks.length > 0) {
      built.take(marks, more);
    } else if (entry.command.name === "perspective.save") {
      give(context, unheld(entry, "sort"), "sort", [...DEFAULT_SORT], DEFAULT_SORT_LABEL, more, {
        marks: [],
      });
    } else {
      built.skip(more);
    }
  };

/** In the grouping step of a builder every step goes on (SR-219 AK2): "No grouping" first, which skips it. */
const noGrouping = (context: CatalogContext, entry: Entry, arg: Argument): readonly Choice[] =>
  arg.complete === "group" && entry.builder !== undefined
    ? [
        {
          id: "no-grouping",
          name: NO_GROUPING,
          run: () => {
            skip(context, entry, arg.field, false);
          },
          more: () => {
            skip(context, entry, arg.field, true);
          },
        },
      ]
    : [];

/**
 * The hits of a list: in a builder the answer of the step asked again first, so Enter keeps it (SR-219 AK6,
 * AK7), then "No grouping" in the grouping step, then the others.
 */
const builderOrder = (
  context: CatalogContext,
  entry: Entry,
  arg: Argument,
  offered: readonly { readonly value: unknown; readonly choice: Choice }[],
): readonly Choice[] => {
  const previous = entry.previous?.field === arg.field ? JSON.stringify(entry.previous.value) : undefined;
  const at = offered.findIndex((hit) => previous !== undefined && JSON.stringify(hit.value) === previous);
  const choices = offered.map((hit) => hit.choice);
  const first = choices.slice(at, at + 1);
  return [
    ...(at < 0 ? [] : first),
    ...noGrouping(context, entry, arg),
    ...choices.filter((_, place) => place !== at),
  ];
};

/** The steps of a sort: in a builder the last step, which "Save" ends (SR-219 AK2, AK3). */
const sortAsk = (context: CatalogContext, entry: Entry, built: SortAsk): SortAsk =>
  entry.builder === undefined ? built : { ...built, save: true, take: builderSort(context, entry, built) };

/** The names of the saved perspectives (`perspective.list`) or saved filters (`filter.list`). */
const savedNames = async (
  context: CatalogContext,
  perspective: boolean,
): Promise<readonly string[] | Failed> => {
  if (perspective) {
    const listed = await context.call("perspective.list", {});
    return listed.ok
      ? listed.output.perspectives.map((saved) => saved.name)
      : { kind: "failed", message: listed.message };
  }
  const listed = await context.call("filter.list", {});
  return listed.ok
    ? listed.output.filters.map((saved) => saved.name)
    : { kind: "failed", message: listed.message };
};

/**
 * What the explanation line says for the typed name (SR-219 AK4): that it replaces the saved one of that name, as
 * core compares names (ignoring case and Unicode normal form); for a perspective whose buffer shows "modified"
 * (SR-214 AK6), that its changes are lost.
 */
const replacing = (
  context: CatalogContext,
  names: readonly string[],
  text: string,
  perspective: boolean,
): string | undefined => {
  if (!perspective) {
    return replacesFilter(names, text);
  }
  const name = names.find((known) => fold(known) === fold(text.trim()));
  if (name === undefined) {
    return undefined;
  }
  const modified = context.buffers.some(
    (buffer) =>
      buffer.kind === "list" &&
      buffer.perspective !== undefined &&
      fold(buffer.perspective.name) === fold(name) &&
      perspectiveModified(buffer),
  );
  return `Replaces the perspective ${name}${modified ? "; the changes of its modified buffer are lost" : ""}`;
};

/**
 * Asks the name, the first step of a builder (SR-219 AK4): the saved perspectives or saved filters are hits that
 * only preview, and Enter takes the typed name unless one is chosen; an empty name is asked again. `initial` is
 * the name given before, when the step is asked again.
 */
const askName = (context: CatalogContext, entry: Entry, arg: Argument, initial: unknown): void => {
  const perspective = entry.command.name === "perspective.save";
  const label = `${entry.error === undefined ? "" : `${entry.error} · `}${lineOf(entry)} · ${arg.field}:`;
  const explain = argumentExplanation(entry, arg);
  const take =
    (more: boolean) =>
    (text: string): void => {
      const name = text.trim();
      if (name === "") {
        askName(context, entry, arg, initial);
      } else {
        give(context, entry, arg.field, name, name, more);
      }
    };
  context.ask({
    label,
    items: [],
    preview: true,
    ...(typeof initial === "string" ? { initial } : {}),
    explain,
    back: () => {
      back(context, entry);
    },
    text: take(false),
    more: take(true),
    fill: savedNames(context, perspective).then((names): PromptFill =>
      failed(names)
        ? { label: `${names.message} · ${label}` }
        : {
            items: names.map((name) => ({
              id: `name:${name}`,
              name,
              run: () => {
                take(false)(name);
              },
            })),
            explain: {
              ...explain,
              note: (text) => replacing(context, names, text, perspective),
            },
          },
    ),
  });
};

/**
 * After "Save" (SR-219 AK7): "New perspective" opens the perspective as saved in a buffer of its own, first in
 * "Open perspective" then (`openPerspective`), and says "Saved perspective <name>", with why it did not open or
 * the warning it opened with; "New saved filter" says "Saved filter <name>" and leaves the shown view as it is.
 */
const saved = async (context: CatalogContext, entry: Entry, name: string): Promise<void> => {
  if (entry.command.name !== "perspective.save") {
    context.echo(`Saved filter ${name}`);
    return;
  }
  const messages: string[] = [];
  const opened = await openPerspective(context, name, (message) => {
    messages.push(message);
  });
  context.echo([`Saved perspective ${opened ?? name}`, ...messages].join(" · "));
};

/**
 * Starts "New perspective" (`perspective.save`) or "New saved filter" (`filter.save`), SR-219 AK2, AK3: empty, at
 * its first step, under the title of the action that covers it.
 */
export const startBuilder = (
  context: CatalogContext,
  name: BuiltCommand,
  catalog: readonly CommandListing[],
): void => {
  const command = catalog.find((listed) => listed.name === name);
  if (command === undefined) {
    context.echo(`The command catalog has no ${name}`);
    return;
  }
  const title = coveringAction(command)?.title ?? command.title;
  buildStep(context, { command, given: [], more: false }, { title, steps: BUILT_STEPS[name], done: -1 }, 0);
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
 * Whether the prompt may offer the command (SR-073 AK2: every function of the app by its name): every
 * implemented read and write command, and only `workspace.init` while no workspace is open. `catalogItems`
 * then leaves out the covered ones (`element.update`: "Save element", with "Edit title", "Add property" and
 * "Clear property") and those whose output other commands show (`shownIn`, SR-133 AK4).
 */
const listed = (context: CatalogContext, command: CommandListing): boolean =>
  command.implemented && (context.workspace || command.name === WITHOUT_WORKSPACE);

/**
 * The catalog commands the command prompt offers now (`listed`) that no action covers (by title or by
 * `covers`) and whose output the app does not show only in another command (`shownIn`, SR-133 AK4), each by its title and whether it fits the shown view (SR-133). While the workspace is
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
        shownIn(command) === undefined &&
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
