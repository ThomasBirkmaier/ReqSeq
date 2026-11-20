// Running a write command from the command prompt (`catalog-commands.ts`): the input of the open buffers is
// saved first (`notSaved`), the output is shown or said in the command line (`show`, SR-223 AK8), and `element.bulkUpdate` shows its preview and asks
// the confirmation before it writes (`previewed`, SR-071 AK5).

import type { AboutInfo } from "./about.js";
import { ABOUT_COMMAND } from "./about.js";
import type { CommandTypes } from "@reqseq/core";
import { bufferName, elementBufferOf, outputSelectionList, resultBuffer } from "./buffers.js";
import { CREATE_COMMAND, createdEcho } from "./create-element.js";
import type { Entry } from "./catalog-entry.js";
import { lineOf } from "./catalog-entry.js";
import { unsavedBefore } from "./unsaved-before.js";
import { confirmationPrompt } from "./confirmation.js";
import type { CatalogContext, Input, Preview } from "./catalog-arguments.js";
import { isWrite, PREVIEWED, titleOf } from "./catalog-arguments.js";

/** One argument back from the confirmation: the value given last is asked again. */
type Back = (context: CatalogContext, entry: Entry) => void;

/** "1 element", "2 elements". */
const elements = (count: number): string => `${String(count)} ${count === 1 ? "element" : "elements"}`;

/**
 * Shows the preview of a bulk update in a result buffer and asks the confirmation as the next step (SR-071 AK5):
 * "No", first and marked, and "Yes, apply"; the explanation line names the elements it writes and those it skips
 * (AK3). "Yes, apply" and Ctrl/Cmd+Enter write the plan of this preview; "No" and Escape go back to the last
 * argument, and the preview stays open. A preview that writes no element is not asked: the prompt says so.
 * `why` says why it is asked again (`plan-changed`). `back` is the step back of the argument entry
 * (`catalog-commands.ts`).
 */
export const previewed = (
  context: CatalogContext,
  entry: Entry,
  input: Input,
  preview: Preview,
  revision: number,
  back: Back,
  why?: string,
): void => {
  context.dispatch({
    type: "open",
    buffer: resultBuffer(PREVIEWED, input, lineOf(entry), preview, revision, true),
  });
  const skipped = `skips ${elements(preview.skipped.length)}`;
  const withWhy = (text: string): string => (why === undefined ? text : `${why} · ${text}`);
  if (preview.count === 0) {
    context.echo(
      withWhy(`${entry.command.title} writes no element (${skipped}), so there is nothing to confirm`),
    );
    return;
  }
  context.ask(
    confirmationPrompt({
      label: withWhy(`${lineOf(entry)} · confirm:`),
      verb: "apply",
      does: "writes",
      name: "confirm",
      text: `Writes ${elements(preview.count)}, ${skipped}`,
      yes: () => {
        void apply(context, entry, input, preview.plan, back);
      },
      back: () => {
        back(context, entry);
      },
    }),
  );
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
 * The confirmed bulk update: the preview's input with `confirm` and its `plan` (SR-071 AK2). When core refuses the
 * plan (`plan-changed`), the new preview is shown and asked again (AK5); another refusal is said.
 */
const apply = async (
  context: CatalogContext,
  entry: Entry,
  input: Input,
  plan: string,
  back: Back,
): Promise<void> => {
  if (drafted(context) && (await notSaved(context, entry))) {
    return;
  }
  const confirmed = { ...input, confirm: true, plan };
  const revision = context.revision();
  const call = context.shownCall ?? context.call;
  const answer = await call(PREVIEWED, confirmed);
  if (answer.ok) {
    show(context, entry, confirmed, answer.output, revision);
    return;
  }
  if (!planChanged(answer)) {
    context.echo(answer.message);
    return;
  }
  const again = context.revision();
  const preview = await call(PREVIEWED, input);
  if (preview.ok) {
    previewed(
      context,
      entry,
      input,
      preview.output,
      again,
      back,
      "Something changed since the preview, so nothing was written; this is the new preview",
    );
  } else {
    context.echo(preview.message);
  }
};

/** Whether an open buffer has input to save before a write command runs. */
export const drafted = (context: CatalogContext): boolean =>
  context.buffers.some((buffer) => context.drafted(buffer.key));

/**
 * Saves the input of every open buffer before a write command; whether one could not be saved, so the command does
 * not run, which the prompt says. Called only when there is input to save (`drafted`): the command is sent at once
 * otherwise.
 */
export const notSaved = async (context: CatalogContext, entry: Entry): Promise<boolean> => {
  const buffer = await unsavedBefore(context);
  if (buffer === undefined) {
    return false;
  }
  context.echo(`${bufferName(buffer)} could not be saved: ${titleOf(entry)} did not run`);
  return true;
};

/**
 * Shows the output of a command: a new element in its element buffer (SR-064), "About ReqSeq" in its own
 * window (SR-161, D-062), the output of a write command without `showsOutput` as a message (`reported`, SR-223
 * AK8), the output of a read command whose elements are its answer as a list of them under its answer (SR-223 AK6),
 * any other output in a result buffer (of a write command, one that is not asked again).
 */
export const show = (
  context: CatalogContext,
  entry: Entry,
  input: Input,
  output: unknown,
  revision: number,
): void => {
  const name = entry.command.name as keyof CommandTypes;
  const open = (): void => {
    context.dispatch({
      type: "open",
      buffer: resultBuffer(name, input, lineOf(entry), output, revision, isWrite(entry.command)),
    });
  };
  if (name === CREATE_COMMAND) {
    const created = output as CommandTypes[typeof CREATE_COMMAND]["output"];
    context.dispatch({ type: "open", buffer: elementBufferOf(created.element) });
    context.echo(createdEcho(created));
  } else if (name === ABOUT_COMMAND && context.about !== undefined) {
    context.about(output as AboutInfo);
  } else if (isWrite(entry.command) && entry.command.showsOutput !== true) {
    reported(context, entry, output, open);
  } else if (!isWrite(entry.command) && listsElements(entry.command)) {
    // The elements are the answer: a list of them (SR-223 AK6), as the command line, API and MCP give them.
    // The output of this run is what the list shows besides its rows, so the command does not run again for it.
    const answer = (output as { readonly answer?: unknown } | undefined)?.answer;
    const list = outputSelectionList(typeof answer === "string" ? answer : lineOf(entry), {
      command: name,
      input,
    });
    context.dispatch({ type: "open", buffer: { ...list, answered: { output, revision } } });
  } else {
    open();
  }
};

/**
 * The catalog marks a field of the command's output as the elements of its answer (`x-elements: "answer"`), and each
 * of them is an element as a list row shows it, with its short ID and title. An answer whose entries are records of
 * another shape, such as the entries of a baseline with the state of each, which the page shows at its row
 * (`baseline.get`, SR-051 AK2, AK3), stays an output page: an assumption where SR-223 AK6 would hide the states
 * behind "Show details".
 */
const listsElements = (command: Entry["command"]): boolean => {
  const fields = command.outputFields ?? [];
  const has = (path: string): boolean => fields.some((field) => field.path === path);
  return fields.some(
    (field) => field.elements === "answer" && has(`${field.path}[].shortId`) && has(`${field.path}[].title`),
  );
};

/**
 * A write command the catalog does not mark `showsOutput` keeps the shown buffer (SR-223 AK8): the command
 * line says its answer, which core gives with the number of its problems (`problemsNote`), and a click on the
 * message opens the output (`open`). An output without an answer (a test catalog) is named by its command line.
 */
const reported = (context: CatalogContext, entry: Entry, output: unknown, open: () => void): void => {
  const answer = (output as { readonly answer?: unknown } | undefined)?.answer;
  const message = typeof answer === "string" ? answer : lineOf(entry);
  if (context.report === undefined) {
    context.echo(message);
  } else {
    context.report(message, open);
  }
};
