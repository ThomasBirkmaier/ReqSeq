// "Open perspective" (SR-214 AK1–AK4, SR-213 AK6–AK8): the prompt lists the perspectives of the workspace
// (`perspective.list`), the ones opened last first, and the faulty files with their reason; Enter opens the
// chosen one as a buffer of its own (`perspectiveBuffer`), or shows it again as saved when it is open.
// Opening first asks `element.list` with the perspective, so core says why it cannot be listed (AK6) or
// that its grouping can no longer be chosen (AK7); the buffer then asks with what was saved.
//
// "Save list as perspective" (SR-214 AK5) writes the shown list through `perspective.save`: its filter
// steps, its grouping and the sort it is shown in; the list then is the buffer of that perspective, as
// saved. Only the input of the core is built (ADR-0002).
import type { CommandTypes, ElementListOutput, ElementSelection, PerspectiveListOutput } from "@reqseq/core";
import { fold } from "@reqseq/core/fold";
import type { Action, ActionContext, Choice } from "./actions.js";
import type { FilterStep, ListBuffer, ListedPerspective } from "./buffers.js";
import { inMatrix, listSort, listing, perspectiveBuffer, savedOf, selectionOf } from "./buffers.js";
import type { Answer, Call } from "./call.js";
import { conditionOf, shownMarks } from "./condition-prompt.js";
import { INCOMPLETE } from "./modeline.js";
import { inOrderOfUse } from "./perspective-recent.js";

/** The ID of the action, which the prefix letter V runs (`bindings.ts`). */
export const OPEN_PERSPECTIVE = "open-perspective";

/** The code of the warning `element.list` gives for a grouping that can no longer be chosen (SR-213 AK7). */
const GROUP_UNAVAILABLE = "perspective.group-unavailable";

/** A perspective buffer as saved, with core's warning when its grouping was left out (SR-213 AK7). */
export interface Checked {
  readonly buffer: ListBuffer;
  readonly warning?: string;
}

/**
 * The buffer of `listed` as saved, after `element.list` with the perspective gave `output`: without the
 * grouping, and with core's warning, when the grouping can no longer be chosen (SR-213 AK7). A buffer
 * that comes back at a restart (`restored`) keeps the warning to say it when it is shown.
 */
export const checkedBuffer = (
  listed: ListedPerspective,
  output: ElementListOutput,
  restored = false,
): Checked => {
  const warning = output.problems?.find((problem) => problem.code === GROUP_UNAVAILABLE)?.message;
  const saved = savedOf(listed, warning === undefined);
  const kept = restored && warning !== undefined ? { warning } : {};
  const buffer = perspectiveBuffer({ name: listed.name, saved, ...kept });
  return warning === undefined ? { buffer } : { buffer, warning };
};

/** Asks `element.list` with the perspective, for one row only: whether and how it can be listed. */
export const checkPerspective = (call: Call, name: string): Promise<Answer<"element.list">> =>
  call("element.list", { perspective: name, limit: 1, fields: ["identifier"] });

/**
 * Asks `element.list` with the perspective for its count only (SR-118 AK6): one row, in no order (`sort: []`),
 * as the order does not change the `total` and costs the most of the call.
 */
export const countPerspective = (call: Call, name: string): Promise<Answer<"element.list">> =>
  call("element.list", { perspective: name, limit: 1, fields: ["identifier"], sort: [] });

/** The perspective of `name` among `listed`, as core compares the names (ignoring case and normal form). */
export const perspectiveNamed = (
  listed: readonly ListedPerspective[],
  name: string,
): ListedPerspective | undefined => listed.find((perspective) => fold(perspective.name) === fold(name));

/**
 * Opens the perspective `name` as it is saved (SR-214 AK2, AK4), in the view of the window, and records
 * the opening for the order of the prompt (AK1). Every opening by the user goes through here: the prompt,
 * and the row of the overview (SR-118 AK7, #1620). An open buffer of the perspective is replaced by it.
 */
export const openPerspective = async (context: ActionContext, name: string): Promise<void> => {
  const call = context.shownCall ?? context.call;
  const [listed, check] = await Promise.all([call("perspective.list", {}), checkPerspective(call, name)]);
  if (!check.ok) {
    // Core names the perspective and, for its saved filter, the filter too (SR-213 AK6).
    context.echo(check.message);
    return;
  }
  if (!listed.ok) {
    context.echo(listed.message);
    return;
  }
  const found = perspectiveNamed(listed.output.perspectives, name);
  if (found === undefined) {
    // Removed between the two reads.
    context.echo(`No perspective is named ${name}`);
    return;
  }
  const checked = checkedBuffer(found, check.output);
  context.dispatch({ type: "open", buffer: checked.buffer });
  context.perspectives?.opened(found.name);
  if (checked.warning !== undefined) {
    context.echo(checked.warning);
  }
};

const inert = (id: string, name: string): Choice => ({
  id,
  name,
  inert: true,
  run: () => {
    // Informs only.
  },
});

/**
 * The rows of the prompt: the perspectives in the order of use (AK1), then each file that could not be
 * read, with its file and reason (SR-213 AK8), and a note when a repository with perspectives is missing.
 */
export const perspectiveChoices = (
  context: ActionContext,
  output: PerspectiveListOutput,
): readonly Choice[] => {
  const ordered = inOrderOfUse(output.perspectives, context.perspectives?.used() ?? []);
  const problems = (output.problems ?? []).map((problem, at) =>
    inert(
      `perspective-problem:${String(at)}`,
      problem.file === undefined || problem.message.includes(problem.file)
        ? problem.message
        : `${problem.file}: ${problem.message}`,
    ),
  );
  return [
    ...(ordered.length === 0 ? [inert("perspective-none", NONE)] : []),
    ...ordered.map((perspective): Choice => ({
      id: `perspective:${perspective.name}`,
      name: perspective.name,
      run: () => {
        void openPerspective(context, perspective.name);
      },
    })),
    ...problems,
    ...(output.incomplete === true ? [inert("perspective-incomplete", INCOMPLETE)] : []),
  ];
};

/** What the minibuffer says for a workspace without perspectives (AK1). */
export const NONE = "The workspace has no perspectives.";

/** The ID of "Save list as perspective". */
export const SAVE_PERSPECTIVE = "save-perspective";

type Condition = NonNullable<ElementSelection["where"]>;

/**
 * The conditions of the steps as the `where` of a perspective. The selection of a perspective, the first step
 * of its buffer, with no further condition stays as stored, so saving it again under its name changes no line
 * of it (SR-213 AK3). Otherwise always under one `all`, in the order of the steps, none as `{ all: [] }` (a text
 * step is its `text` condition, SR-068), the perspective's stored `all` giving its parts, a stored condition of
 * another kind one part: the marks the condition of "Save perspective" takes from the shown list
 * (`shownMarks`, SR-215 AK5), so for a list without an unchanged perspective selection both ways write the
 * same file (SR-214 AK5).
 */
export const perspectiveWhere = (steps: readonly FilterStep[]): Condition => {
  const [first, ...rest] = steps;
  const stored = first?.perspective === true ? first.selection.where : undefined;
  return stored !== undefined && rest.every((step) => step.selection.where === undefined)
    ? stored
    : (conditionOf(shownMarks(steps)) as Condition);
};

/**
 * The input of `perspective.save` for the list shown in `list` under `name`: the conditions of its steps,
 * the saved filter of a step by its name, its grouping, and the sort it is shown in (`listSort`), so the
 * other accesses give the same order (SR-213 AK4). A list sorted by nothing chosen and without a saved
 * filter is shown in `DEFAULT_SORT`, which is then written. No `description`: core keeps the one saved.
 */
export const perspectiveInput = (
  list: ListBuffer,
  name: string,
): CommandTypes["perspective.save"]["input"] => {
  const filter = selectionOf(list.steps)?.filter;
  const sort = listSort(list);
  return {
    name,
    where: perspectiveWhere(list.steps),
    ...(filter === undefined ? {} : { filter }),
    ...(list.group === undefined ? {} : { group: list.group }),
    ...(sort === undefined ? {} : { sort: [...sort] }),
  };
};

/**
 * Saves the shown `list` as the perspective `name` (SR-214 AK5). The list then is the buffer of that
 * perspective as saved, at the same row: under the name of its own perspective it shows no "modified" any
 * more (AK6), and under another name, or for a list that was no perspective, it takes the place of the
 * buffer it was, as that perspective's buffer (one already open of it is replaced).
 */
export const savePerspective = async (
  context: ActionContext,
  list: ListBuffer,
  name: string,
): Promise<void> => {
  const saved = await context.call("perspective.save", perspectiveInput(list, name));
  if (!saved.ok) {
    context.echo(saved.message);
    return;
  }
  const listed = await context.call("perspective.list", {});
  if (!listed.ok) {
    context.echo(listed.message);
    return;
  }
  const found = perspectiveNamed(listed.output.perspectives, name);
  if (found === undefined) {
    context.echo(`No perspective is named ${name}`);
    return;
  }
  const buffer = {
    ...perspectiveBuffer({ name: found.name, saved: savedOf(found, true) }),
    cursor: list.cursor,
  };
  context.dispatch({ type: "open", buffer, replacing: list.key });
  context.echo(`Saved perspective ${found.name}`);
};

/**
 * The list "Save list as perspective" saves: the shown list, unless it is in the matrix (which shows no
 * groups), lists nothing, or the workspace is read-only (`perspective.save` refuses then). The hits of a
 * search and the elements of a package page are no list buffer (SR-214 rationale).
 */
const savableList = (context: ActionContext): ListBuffer | undefined => {
  const [shown] = context.buffers;
  return context.workspace && context.readOnly !== true && listing(shown) && !inMatrix(shown)
    ? shown
    : undefined;
};

export const PERSPECTIVE_ACTIONS: readonly Action[] = [
  {
    id: OPEN_PERSPECTIVE,
    title: "Open perspective",
    description: "Open a perspective in a buffer of its own.",
    runs: [
      { where: "in the prompt", command: "perspective.list" },
      { where: "in the list", command: "element.list" },
    ],
    available: (context: ActionContext): boolean => context.workspace,
    run: (context: ActionContext): void => {
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
        // No `use` (SR-121 AK2): the order is the order of use of the perspectives (AK1).
        context.ask({ label: "Perspective", items: perspectiveChoices(context, answer.output) });
      });
    },
  },
  {
    id: SAVE_PERSPECTIVE,
    title: "Save list as perspective",
    description: "Save the filters, grouping and sort of the shown list as a perspective.",
    runs: [
      { where: "in the prompt", command: "perspective.list" },
      { where: "in the list", command: "perspective.save" },
    ],
    available: (context: ActionContext): boolean => savableList(context) !== undefined,
    run: (context: ActionContext): void => {
      const list = savableList(context);
      if (list === undefined) {
        return;
      }
      void context.call("perspective.list", {}).then((answer) => {
        if (!answer.ok) {
          context.echo(answer.message);
          return;
        }
        const names = answer.output.perspectives.map((perspective) => perspective.name);
        const save = (name: string): void => {
          const given = name.trim();
          if (given !== "") {
            void savePerspective(context, list, given);
          }
        };
        // Only the name (AK5): that of the perspective the list comes from to start with, and the
        // perspectives there are while typing; Enter takes the typed name unless one of them is chosen.
        context.ask({
          label: "Perspective name",
          items: names.map((name) => ({
            id: `perspective:${name}`,
            name,
            run: () => {
              save(name);
            },
          })),
          text: save,
          preview: true,
          ...(list.perspective === undefined ? {} : { initial: list.perspective.name }),
        });
      });
    },
  },
];
