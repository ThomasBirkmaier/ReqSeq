// Catalog commands in the command prompt (SR-073 AK2, SR-108, #85). The prompt lists the implemented read
// commands by their `title`, except those an app action covers. Choosing one asks its arguments one by
// one in the minibuffer, Emacs `completing-read` style, in the order of the catalog's `arguments`; each
// source is answered by one existing read command and shown as it is (ADR-0002: the app builds the input
// and decides nothing about what is allowed; core validates). The output opens a result buffer.
//
// Keys: Enter takes the selected candidate or the typed text; Backspace in an empty input goes back one
// argument; Escape ends the command; Ctrl/Cmd+Enter takes the answer and then offers the optional
// arguments ("Run" first). A list field (`refs`) takes one value per Enter, and Enter on an empty input ends it.
//
// Write commands follow with #85 PR 5b, and with them the sources only they use (status, invalidStatus,
// relationTarget, relation, property, value, hint, filter); until then those are typed as text.
import type { CommandTypes } from "@logreq/core";
import type { CommandListing } from "../shared/protocol.js";
import type { Action, ActionContext, Choice, Prompt, PromptFill } from "./actions.js";
import { findElements } from "./actions.js";
import { bufferName, resultBuffer } from "./buffers.js";

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
}

/** Where the argument entry of one command stands. */
interface Entry {
  readonly command: CommandListing;
  readonly given: readonly Given[];
  /** The list field that takes more values (Enter on an empty input ends it). */
  readonly collecting?: string;
  /** Ctrl/Cmd+Enter was pressed: the optional arguments are offered before the command runs. */
  readonly more: boolean;
  /** Why core refused the input, shown with the argument asked again. */
  readonly error?: string;
}

/** What one argument offers: a closed list, elements found by search, or typed text. */
type Offer =
  | { readonly kind: "list"; readonly values: readonly { readonly value: unknown; readonly name: string }[] }
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
      !requiredOf(command).includes(arg.field) ||
      context.buffers[0]?.kind === "list",
  );

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
  values: (output: T) => readonly { readonly value: unknown; readonly name: string }[],
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
  type: async ({ context }) =>
    listOf(await context.call("metamodel.get", {}), (output) =>
      output.types.map((type) => ({ value: type.key, name: type.name })),
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

/** "Show relation options SR-1" : the title and the values given so far. */
const lineOf = (entry: Entry): string =>
  [entry.command.title, ...entry.given.map((given) => given.label)].join(" ");

/** The input the given values make, with the shown list's selection for a `selection` argument. */
const inputOf = (context: ActionContext, entry: Entry): Record<string, unknown> => {
  const input: Record<string, unknown> = {};
  const selection = shownSelection(context);
  for (const arg of entry.command.arguments) {
    const values = entry.given.filter((given) => given.field === arg.field).map((given) => given.value);
    if (arg.complete === "selection") {
      if (selection !== undefined) {
        input[arg.field] = selection;
      }
    } else if (values.length > 0) {
      input[arg.field] = isListField(entry.command, arg.field) ? values : values[0];
    }
  }
  return input;
};

/** Runs the command with the given values: the output opens a result buffer; a refused input asks again. */
const execute = async (context: CatalogContext, entry: Entry): Promise<void> => {
  const input = inputOf(context, entry);
  const name = entry.command.name as keyof CommandTypes;
  // The revision the command reads: a change while it runs makes the result view ask again.
  const revision = context.revision();
  const answer = await context.call(name, input);
  if (answer.ok) {
    context.dispatch({
      type: "open",
      buffer: resultBuffer(name, input, lineOf(entry), answer.output, revision),
    });
  } else if (answer.code === "input.invalid" && entry.given.length > 0) {
    // The prompt stays on the argument given last, with core's message.
    back(context, { ...entry, error: answer.message });
  } else {
    context.echo(answer.message);
  }
};

/** One argument back: the value given last is asked again; before the first, the command prompt. */
const back = (context: CatalogContext, entry: Entry): void => {
  const last = entry.given.at(-1);
  const at = entry.command.arguments.findIndex((arg) => arg.field === last?.field);
  const arg = entry.command.arguments[at];
  if (last === undefined || arg === undefined) {
    context.reopen();
    return;
  }
  const { collecting: _was, ...rest } = entry;
  const given = entry.given.slice(0, -1);
  // A list argument that keeps values takes more again (Enter on an empty input ends it).
  const keeps = isListField(entry.command, last.field) && given.some((value) => value.field === last.field);
  ask(context, { ...rest, given, ...(keeps ? { collecting: last.field } : {}) }, arg, at);
};

/** Takes a value for `field`; `more` (Ctrl/Cmd+Enter) offers the optional arguments next. */
const give = (
  context: CatalogContext,
  entry: Entry,
  field: string,
  value: unknown,
  label: string,
  more: boolean,
): void => {
  const { collecting: _was, error: _error, ...rest } = entry;
  step(context, {
    ...rest,
    given: [...entry.given, { field, value, label }],
    more: entry.more || more,
    ...(isListField(entry.command, field) && !more ? { collecting: field } : {}),
  });
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
      : {}),
  };
  const take = (value: unknown, name: string): Pick<Choice, "run" | "more"> => ({
    run: () => {
      give(context, entry, field, value, name, false);
    },
    more: () => {
      give(context, entry, field, value, name, true);
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
          items: offer.values.map(({ value, name }) => ({
            id: JSON.stringify(value),
            name,
            ...take(value, name),
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
        arg.complete === "selection" || entry.given.some((given) => given.field === arg.field)
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

/** The next step: the list field being filled, the next required argument, the optional ones, or the run. */
const step = (context: CatalogContext, entry: Entry): void => {
  const { arguments: args } = entry.command;
  const required = requiredOf(entry.command);
  const next =
    entry.collecting === undefined
      ? args.findIndex(
          (arg) =>
            arg.complete !== "selection" &&
            required.includes(arg.field) &&
            !entry.given.some((given) => given.field === arg.field),
        )
      : args.findIndex((arg) => arg.field === entry.collecting);
  const arg = args[next];
  if (arg !== undefined) {
    ask(context, entry, arg, next);
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
 * The catalog commands the command prompt offers now: implemented read commands that no action covers
 * (by title or by `covers`), each by its title. Write commands follow with #85 PR 5b.
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
        command.effect === "read" &&
        !covered.has(command.title) &&
        !covered.has(command.name) &&
        offered(context, command),
    )
    .map((command) => ({
      id: `command:${command.name}`,
      name: command.title,
      run: () => {
        startCommand(context, command, false);
      },
      more: () => {
        startCommand(context, command, true);
      },
    }));
};
