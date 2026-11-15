// "Rename perspective", "Delete perspective", "Rename saved filter" and "Delete saved filter" (SR-218): app actions
// that cover `perspective.rename`, `perspective.delete`, `filter.rename` and `filter.delete` and run them in the
// command prompt only (D-062). Core decides what is renamed or deleted (ADR-0002); the app orders the calls, shows
// what core gives, and lets the open buffers follow (pure display).
//
// - The first step offers the perspectives in the order of "Open perspective" (SR-214 AK1), the one of the shown
//   buffer first, or the saved filters by name; faulty files are rows that cannot be chosen; without any the
//   command prompt says there are none (AK1).
// - "Rename …" asks the new name with the old one in the input; for a saved filter the perspectives that name it
//   are rows that cannot be chosen, their count in the first (AK2). Enter renames; the command prompt says the
//   result, or core's refusal, which asks the step again.
// - "Delete …" first calls the command without `confirm`: the explanation line names the name and the file core
//   gives, that a file Git does not track does not come back, and for a "modified" buffer that its changes are lost.
//   Ctrl/Cmd+Enter offers "Yes, delete" and "No"; "Yes, delete" calls the command with `confirm` and the `file` and
//   `expectedFileSha256` of the first call, so only the file shown is deleted (ADR-0002 rule 3, #1738). Enter
//   without the confirmation deletes nothing (AK3).
// - After a rename the buffers follow (`perspective-renamed`, `filter-renamed` in `buffers.ts`, AK4, AK5); after a
//   delete the perspective's buffer closes as "Close buffer" closes it (AK6).
import type { CommandTypes } from "@reqseq/core";
import { fold } from "@reqseq/core/fold";
import type { Action, ActionContext, ArgumentExplanation, Choice, Prompt } from "./actions.js";
import { bufferName, perspectiveKey, perspectiveModified } from "./buffers.js";
import { unsavedBefore } from "./unsaved-before.js";
import { NONE, inert, perspectiveChoices } from "./perspective-actions.js";
import { shortcutLabel } from "./keys.js";
import { INCOMPLETE } from "./modeline.js";
import { MORE_SHORTCUT } from "./prompt-keys.js";

/** The two kinds of saved file the actions rename and delete. */
interface Kind {
  readonly perspective: boolean;
  /** How messages name one: "perspective", "saved filter". */
  readonly noun: string;
  readonly rename: "perspective.rename" | "filter.rename";
  readonly delete: "perspective.delete" | "filter.delete";
}

const PERSPECTIVE: Kind = {
  perspective: true,
  noun: "perspective",
  rename: "perspective.rename",
  delete: "perspective.delete",
};
const FILTER: Kind = {
  perspective: false,
  noun: "saved filter",
  rename: "filter.rename",
  delete: "filter.delete",
};

/** What the command prompt says for a workspace without saved filters (SR-218 AK1). */
export const NO_FILTERS = "The workspace has no saved filters.";

/** The answers the explanation lines name. */
export const YES_DELETE = "Yes, delete";
export const NO = "No";

/** The title of a catalog command, as the action has it. */
const TITLES: Readonly<Record<Kind["rename"] | Kind["delete"], string>> = {
  "perspective.rename": "Rename perspective",
  "perspective.delete": "Delete perspective",
  "filter.rename": "Rename saved filter",
  "filter.delete": "Delete saved filter",
};

/** A step asked again shows why before its label, as a refused catalog argument does. */
const withError = (error: string | undefined, label: string): string =>
  error === undefined ? label : `${error} · ${label}`;

/**
 * The explanation line of `field` of `command` (SR-210 AK2): its name and catalog description; Escape goes back
 * where `back` is given.
 */
const explanation = (context: ActionContext, command: string, field: string): ArgumentExplanation => {
  const listed = context.catalog?.().find((entry) => entry.name === command);
  const input = listed?.input as
    { readonly properties?: Readonly<Record<string, { readonly description?: unknown }>> } | undefined;
  const schema = input?.properties?.[field];
  const description = schema?.description;
  return {
    name: field,
    ...(typeof description === "string" ? { description } : {}),
    list: false,
    ends: false,
    skips: false,
    more: false,
  };
};

/** The field core names in the details of an `input.invalid`: `fields[0]`, or the field of the first schema error. */
const refusedField = (details: unknown): string | undefined => {
  const { fields, errors } = (details ?? {}) as { readonly fields?: unknown; readonly errors?: unknown };
  const named: unknown = Array.isArray(fields) ? fields[0] : undefined;
  if (typeof named === "string") {
    return named;
  }
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  const field = (first as { readonly field?: unknown } | undefined)?.field;
  return typeof field === "string" ? (/^[^.[\]]+/u.exec(field)?.[0] ?? field) : undefined;
};

/** Saves the input of every open buffer before a write (as a catalog write command does); false when one is left. */
const saved = async (context: ActionContext, title: string): Promise<boolean> => {
  const drafted = context.buffers.some((buffer) => context.drafted(buffer.key));
  const unsaved = drafted ? await unsavedBefore(context) : undefined;
  if (unsaved !== undefined) {
    context.echo(`${bufferName(unsaved)} could not be saved: ${title} did not run`);
    return false;
  }
  return true;
};

/** The warnings core gave with an output, after the message. */
const withProblems = (
  message: string,
  problems: readonly { readonly message: string }[] | undefined,
): string => [message, ...(problems ?? []).map((problem) => problem.message)].join(" · ");

/** The perspective of the shown buffer, if it is one (SR-218 AK1: it stands first). */
const shownPerspective = (context: ActionContext): string | undefined => {
  const [shown] = context.buffers;
  return shown?.kind === "list" ? shown.perspective?.name : undefined;
};

/**
 * The first step (SR-218 AK1): the perspectives or saved filters as hits; `choose` takes one. Without any, the
 * command prompt says there are none.
 */
const askSaved = (
  context: ActionContext,
  kind: Kind,
  title: string,
  command: string,
  choose: (name: string) => void,
  error?: string,
): void => {
  const label = withError(error, `${title} · name:`);
  const explain = explanation(context, command, "name");
  // Escape goes back to the command prompt, or ends the prompt, also when the step is asked again: every step
  // has its own `back`, so none goes back to the prompt asked before it (SR-134 AK1, AK2).
  const back =
    context.reopen ??
    ((): void => {
      // The prompt ends.
    });
  if (kind.perspective) {
    void context.call("perspective.list", {}).then((answer) => {
      if (!answer.ok) {
        context.echo(answer.message);
        return;
      }
      const { perspectives, problems, incomplete } = answer.output;
      if (perspectives.length === 0 && (problems ?? []).length === 0 && incomplete !== true) {
        context.echo(NONE);
        return;
      }
      context.ask({
        label,
        items: perspectiveChoices(context, answer.output, choose, shownPerspective(context)),
        explain,
        back,
      });
    });
    return;
  }
  void context.call("filter.list", {}).then((answer) => {
    if (!answer.ok) {
      context.echo(answer.message);
      return;
    }
    const { filters, problems, incomplete } = answer.output;
    if (filters.length === 0 && (problems ?? []).length === 0 && incomplete !== true) {
      context.echo(NO_FILTERS);
      return;
    }
    const items: Choice[] = [
      ...(filters.length === 0 ? [inert("filter-none", NO_FILTERS)] : []),
      ...[...filters]
        .sort((a, b) => fold(a.name).localeCompare(fold(b.name), "en"))
        .map((filter) => ({
          id: `filter:${filter.name}`,
          name: filter.name,
          run: () => {
            choose(filter.name);
          },
        })),
      ...(problems ?? []).map((problem, at) =>
        inert(
          `filter-problem:${String(at)}`,
          problem.file === undefined || problem.message.includes(problem.file)
            ? problem.message
            : `${problem.file}: ${problem.message}`,
        ),
      ),
      ...(incomplete === true ? [inert("filter-incomplete", INCOMPLETE)] : []),
    ];
    context.ask({ label, items, explain, back });
  });
};

/** The perspectives that name the saved filter `name` (`perspective.list`), as core compares names. */
const naming = async (context: ActionContext, name: string): Promise<readonly string[]> => {
  const listed = await context.call("perspective.list", {});
  return listed.ok
    ? listed.output.perspectives
        .filter((perspective) => perspective.filter !== undefined && fold(perspective.filter) === fold(name))
        .map((perspective) => perspective.name)
    : [];
};

/** The rows of the perspectives that change with a renamed filter (SR-218 AK2): their count first. */
const namingRows = (names: readonly string[]): Choice[] =>
  names.length === 0
    ? []
    : [
        inert(
          "naming-count",
          `${String(names.length)} ${names.length === 1 ? "perspective names" : "perspectives name"} this saved filter and change with it`,
        ),
        ...names.map((name) => inert(`naming:${name}`, name)),
      ];

/** What a successful rename says (SR-218 AK2): the names, and the perspectives changed with a filter. */
const renamedMessage = (
  kind: Kind,
  from: string,
  to: string,
  output: CommandTypes["perspective.rename"]["output"] | CommandTypes["filter.rename"]["output"],
): string => {
  if (output.files.length === 0) {
    return withProblems(`Nothing changed: the ${kind.noun} ${from} has this name`, output.problems);
  }
  const changed = "perspectives" in output ? output.perspectives.map((perspective) => perspective.name) : [];
  return withProblems(
    `Renamed ${kind.noun} ${from} to ${to}${changed.length === 0 ? "" : `; changed with it: ${changed.join(", ")}`}`,
    output.problems,
  );
};

/** The new name (SR-218 AK2): the old one in the input; Enter renames. */
const askNewName = (
  context: ActionContext,
  kind: Kind,
  name: string,
  initial: string,
  names: readonly string[],
  error?: string,
): void => {
  const title = TITLES[kind.rename];
  const rows = namingRows(names);
  const again = (message: string | undefined, typed: string): void => {
    askNewName(context, kind, name, typed, names, message);
  };
  const rename = async (typed: string): Promise<void> => {
    const newName = typed.trim();
    if (newName === "") {
      again(undefined, typed);
      return;
    }
    if (!(await saved(context, title))) {
      return;
    }
    const answer = await context.call(kind.rename, { name, newName });
    if (!answer.ok) {
      if (answer.code !== "input.invalid") {
        context.echo(answer.message);
      } else if (refusedField(answer.details) === "name") {
        start(context, kind, true, answer.message);
      } else {
        again(answer.message, typed);
      }
      return;
    }
    if (answer.output.files.length > 0) {
      if (kind.perspective) {
        context.dispatch({ type: "perspective-renamed", from: name, to: newName });
        context.perspectives?.renamed?.(name, newName);
      } else {
        context.dispatch({ type: "filter-renamed", from: name, to: newName });
      }
    }
    context.echo(renamedMessage(kind, name, newName, answer.output));
  };
  context.ask({
    label: withError(error, `${title} ${name} · newName:`),
    items: rows,
    // The rows only inform: Enter takes the typed name, and they stay while it is typed.
    preview: true,
    seek: () => Promise.resolve({ choices: rows, alone: true }),
    initial,
    explain: explanation(context, kind.rename, "newName"),
    back: () => {
      start(context, kind, true);
    },
    text: (typed) => {
      void rename(typed);
    },
  });
};

type Deleting = CommandTypes["perspective.delete"]["output"];

/**
 * What the explanation line says before the confirmation (SR-218 AK3): the name and file, that a file Git does
 * not track does not come back, and for a perspective whose buffer is "modified" that its changes are lost.
 */
const deletingText = (context: ActionContext, kind: Kind, output: Deleting): string => {
  const modified =
    kind.perspective &&
    context.buffers.some(
      (buffer) =>
        buffer.kind === "list" &&
        buffer.perspective !== undefined &&
        fold(buffer.perspective.name) === fold(output.name) &&
        perspectiveModified(buffer),
    );
  return withProblems(
    `Deletes the ${kind.noun} ${output.name}, file ${output.file}; a file Git does not track does not come back${
      modified ? "; the changes of its modified buffer are lost" : ""
    }`,
    output.problems,
  );
};

/** After the confirmation (SR-218 AK3, AK6): the confirmed call, then the buffer closes and the prompt says so. */
const confirmDelete = async (context: ActionContext, kind: Kind, output: Deleting): Promise<void> => {
  const title = TITLES[kind.delete];
  if (!(await saved(context, title))) {
    return;
  }
  const answer = await context.call(kind.delete, {
    name: output.name,
    confirm: true,
    file: output.file,
    expectedFileSha256: output.fileSha256,
  });
  if (!answer.ok) {
    context.echo(answer.message);
    return;
  }
  if (answer.output.deleted && kind.perspective) {
    // As "Close buffer" closes it (AK6): a list buffer has no input to save.
    const key = perspectiveKey(answer.output.name);
    if (context.buffers.some((buffer) => buffer.key === key)) {
      context.discard(key);
      context.dispatch({ type: "close", key });
    }
  }
  context.echo(
    withProblems(
      answer.output.deleted
        ? `Deleted ${kind.noun} ${answer.output.name} (${answer.output.file})`
        : `Nothing was deleted: ${kind.noun} ${answer.output.name}`,
      answer.output.problems,
    ),
  );
};

/** The confirmation (SR-218 AK3): "Yes, delete" deletes, "No" and Escape go back to the step before. */
const askConfirm = (context: ActionContext, kind: Kind, output: Deleting): void => {
  const title = TITLES[kind.delete];
  const back = (): void => {
    askDeleting(context, kind, output);
  };
  context.ask({
    label: `${title} ${output.name} · confirm:`,
    items: [
      {
        id: "confirm:yes",
        name: YES_DELETE,
        run: () => {
          void confirmDelete(context, kind, output);
        },
      },
      { id: "confirm:no", name: NO, run: back },
    ],
    explain: explanation(context, kind.delete, "confirm"),
    back,
  });
};

/** The step before the confirmation (SR-218 AK3): what is deleted; Ctrl/Cmd+Enter confirms, Enter deletes nothing. */
const askDeleting = (context: ActionContext, kind: Kind, output: Deleting, error?: string): void => {
  const title = TITLES[kind.delete];
  const prompt: Prompt = {
    label: withError(error, `${title} ${output.name}:`),
    items: [],
    explain: {
      name: "confirm",
      description: deletingText(context, kind, output),
      list: false,
      ends: false,
      skips: false,
      more: true,
      moreDoes: "confirms",
    },
    back: () => {
      start(context, kind, false);
    },
    text: () => {
      askDeleting(
        context,
        kind,
        output,
        `Nothing was deleted: ${shortcutLabel(MORE_SHORTCUT, context.mac)} offers ${YES_DELETE}`,
      );
    },
    more: () => {
      askConfirm(context, kind, output);
    },
  };
  context.ask(prompt);
};

/** The call without `confirm` for the chosen name: what would be deleted, or core's refusal at the first step. */
const deleting = async (context: ActionContext, kind: Kind, name: string): Promise<void> => {
  const answer = await context.call(kind.delete, { name });
  if (!answer.ok) {
    start(context, kind, false, answer.message);
    return;
  }
  askDeleting(context, kind, answer.output);
};

/** Starts "Rename …" (`rename`) or "Delete …" at the first step, with why it is asked again. */
const start = (context: ActionContext, kind: Kind, rename: boolean, error?: string): void => {
  const command = rename ? kind.rename : kind.delete;
  askSaved(
    context,
    kind,
    TITLES[command],
    command,
    (name) => {
      if (!rename) {
        void deleting(context, kind, name);
      } else if (kind.perspective) {
        askNewName(context, kind, name, name, []);
      } else {
        void naming(context, name).then((names) => {
          askNewName(context, kind, name, name, names);
        });
      }
    },
    error,
  );
};

/** An action that runs `command` (it covers it, so the prompt lists it once, by the command's title). */
const savedAction = (kind: Kind, rename: boolean): Action => {
  const command = rename ? kind.rename : kind.delete;
  return {
    id: command.replace(".", "-"),
    title: TITLES[command],
    covers: [command],
    // As the catalog command, which core refuses while the workspace is read-only (SR-217 AK7).
    available: (context: ActionContext): boolean => context.workspace && context.readOnly !== true,
    run: (context: ActionContext): void => {
      start(context, kind, rename);
    },
  };
};

export const SAVED_FILE_ACTIONS: readonly Action[] = [
  savedAction(PERSPECTIVE, true),
  savedAction(PERSPECTIVE, false),
  savedAction(FILTER, true),
  savedAction(FILTER, false),
];
