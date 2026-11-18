// The actions that close, switch and split buffers; `ACTIONS` (`actions.ts`) lists them.
import type { Buffer, Buffers } from "./buffers.js";
import { bufferName, onlyOverview } from "./buffers.js";
import { choice } from "./list-actions.js";
import type { Shortcut } from "./keys.js";
import { SAVE_SHORTCUT, shortcutLabel } from "./keys.js";
import { cycleKey } from "./buffer-cycle.js";
import type { ActionContext, Action } from "./action-types.js";
import { hasOthers, hasBuffers } from "./action-conditions.js";

/**
 * Alt+P (Option+P on macOS) goes back to the buffer shown before, Alt+N forward again (SR-115 AK5), also while typing in an editor. Alt alone: Ctrl/Cmd+N and Ctrl/Cmd+P are other keys (SR-122).
 */
export const NEXT_BUFFER_SHORTCUT: Shortcut = { mod: false, shift: false, alt: true, key: "n" };
export const PREVIOUS_BUFFER_SHORTCUT: Shortcut = { mod: false, shift: false, alt: true, key: "p" };

/**
 * "Other pane" (SR-150 AK7): Alt+O, beside Alt+N and Alt+P, because Ctrl/Cmd+O opens a workspace and the
 * physical Ctrl key on macOS belongs to the editor.
 */
export const OTHER_WINDOW_SHORTCUT: Shortcut = { mod: false, shift: false, alt: true, key: "o" };

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/**
 * Closes the buffers, drops their unsaved text and says how many were closed. The overview is not counted
 * and not closed: it is what remains (SR-118).
 */
const closeBuffers = (context: ActionContext, all: Buffers): void => {
  const buffers = all.filter((buffer) => buffer.kind !== "overview");
  for (const buffer of buffers) {
    context.discard(buffer.key);
    context.dispatch({ type: "close", key: buffer.key });
  }
  context.echo(`Closed ${plural(buffers.length, "buffer")}`);
};

/** The names of at most three buffers, then "and N more". */
const someNames = (buffers: Buffers): string => {
  const names = buffers.slice(0, 3).map(bufferName);
  return buffers.length > 3 ? `${names.join(", ")} and ${String(buffers.length - 3)} more` : names.join(", ");
};

/**
 * "Close all buffers" (SR-123): closing leaves the elements, so their unsaved text is saved first (SR-105
 * AK1), and the buffers close. Only text that could not be saved makes the command prompt ask, not a dialog
 * (SR-123 AK2): the first choice, which Enter takes, keeps the buffers that have unsaved text; the second
 * discards it.
 */
/**
 * Saves the buffer with `key` before it closes; once more when input is left, which may be keys typed while
 * the first save ran (they wait for its answer). True when no input is left unsaved.
 */
const saveBeforeClose = async (saveDraft: (key: string) => Promise<boolean>, key: string): Promise<boolean> =>
  (await saveDraft(key)) || saveDraft(key);

const closeAll = (context: ActionContext): void => {
  const open = context.buffers.filter((buffer) => buffer.kind !== "overview");
  const unsaved = open.filter((buffer) => context.drafted(buffer.key));
  const { saveDraft } = context;
  if (unsaved.length === 0) {
    closeBuffers(context, open);
  } else if (saveDraft === undefined) {
    askCloseAll(context, open, unsaved);
  } else {
    void (async () => {
      const left: Buffer[] = [];
      for (const buffer of unsaved) {
        if (!(await saveBeforeClose(saveDraft, buffer.key))) {
          left.push(buffer);
        }
      }
      if (left.length === 0) {
        closeBuffers(context, open);
      } else {
        askCloseAll(context, open, left);
      }
    })();
  }
};

/** "Close all buffers" asks about the buffers with unsaved text (`unsaved`) among the `open` ones. */
const askCloseAll = (context: ActionContext, open: Buffers, unsaved: Buffers): void => {
  context.ask({
    label: `${plural(unsaved.length, "buffer")} with unsaved changes (${someNames(unsaved)})`,
    items: [
      choice("Close all but the buffers with unsaved changes", () => {
        closeBuffers(
          context,
          open.filter((buffer) => !context.drafted(buffer.key)),
        );
      }),
      choice("Close all and discard the unsaved changes", () => {
        closeBuffers(context, open);
      }),
    ],
  });
};

/**
 * Shows the buffer shown before (`step` 1) or after (-1) the shown one, wrapping (SR-115 AK5); none when
 * the shown one is not in the order.
 *
 * In a text editor the key must insert no character. The window's listener prevents the key, so the
 * editor gets no keydown. On macOS, Option+N is a dead key ("~"), and Chromium hands it to the input
 * method before the page sees the keydown, whether or not it is prevented. What keeps the "~" out: the
 * focus leaves the editor first, synchronously in the keydown (`leaveEditor`), and the switch then
 * unmounts the editor: React shows the other buffer in a microtask after the listener, the App's focus
 * effect moves the focus to the new buffer, which cannot be edited, and a composition aimed at a focus
 * that is no text input inserts nothing. Leaving the editor first also covers a later case where the
 * editor stays shown (a split window, SR-115 AK3). The picture of the buffer that is left, for the motion of the
 * switch (SR-212), is taken in `cycled`, after the editor is left, so it shows no caret.
 */
const cycleBuffer = (context: ActionContext, step: 1 | -1): void => {
  const key = cycleKey(context.cycleOrder, context.buffers[0]?.key, step);
  if (key !== undefined) {
    context.leaveEditor();
    context.cycled(key, step);
    context.dispatch({ type: "switch", key });
  }
};

export const BUFFER_ACTIONS: readonly Action[] = [
  {
    id: "close",
    title: "Close buffer",
    description: "Close the shown buffer.",
    available: hasBuffers,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current === undefined) {
        return;
      }
      const close = (): void => {
        context.discard(current.key);
        context.dispatch({ type: "close", key: current.key });
      };
      if (!context.modified || context.closeArmed(current.key)) {
        close();
        return;
      }
      const { saveDraft } = context;
      if (saveDraft === undefined) {
        context.armClose(current.key);
        context.echo(
          `${bufferName(current)} has unsaved changes: ${shortcutLabel(SAVE_SHORTCUT, context.mac)} saves them, closing again discards them`,
        );
        return;
      }
      // Closing leaves the element: its input is saved first (SR-105 AK1). Only input that could not be
      // saved (a change on disk, a deleted file, a value core refuses) asks once.
      void saveBeforeClose(saveDraft, current.key).then((saved) => {
        if (saved) {
          close();
        } else {
          context.armClose(current.key);
          context.echo(
            `${bufferName(current)} has unsaved changes that were not saved: closing again discards them`,
          );
        }
      });
    },
  },
  {
    id: "close-all",
    title: "Close all buffers",
    description: "Close every buffer except the overview.",
    available: hasBuffers,
    run: closeAll,
  },
  {
    id: "next-buffer",
    title: "Next buffer",
    description: "Show the next open buffer.",
    shortcut: NEXT_BUFFER_SHORTCUT,
    available: hasOthers,
    run: (context: ActionContext): void => {
      cycleBuffer(context, -1);
    },
  },
  {
    id: "previous-buffer",
    title: "Previous buffer",
    description: "Show the previous open buffer.",
    shortcut: PREVIOUS_BUFFER_SHORTCUT,
    available: hasOthers,
    run: (context: ActionContext): void => {
      cycleBuffer(context, 1);
    },
  },
  // SR-115 AK3: two buffers side by side. Commands of the prompt only, no keys (ThomasBirkmaier/ReqSeq-archive#472).
  {
    id: "split-window",
    title: "Split window",
    description: "Split the window into two panes side by side.",
    available: (context: ActionContext): boolean =>
      context.workspace &&
      context.layout !== undefined &&
      context.layout.other === undefined &&
      context.buffers.length > 0 &&
      !onlyOverview(context.buffers),
    run: (context: ActionContext): void => {
      context.layout?.split();
    },
  },
  {
    id: "other-window",
    title: "Other pane",
    description: "Move to the other pane of the window.",
    shortcut: OTHER_WINDOW_SHORTCUT,
    available: (context: ActionContext): boolean => context.layout?.other !== undefined,
    run: (context: ActionContext): void => {
      const other = context.layout?.other;
      if (other !== undefined) {
        context.dispatch({ type: "switch", key: other });
      }
    },
  },
  // SR-150 AK1 to AK3: the marked element in the area on that side. Commands of the prompt only, no keys.
  ...(["right", "left"] as const).map((side): Action => ({
    id: `open-${side}`,
    title: `Open to the ${side}`,
    description: `Open the marked element in the pane on the ${side}.`,
    available: (context: ActionContext): boolean =>
      context.workspace && context.layout !== undefined && context.marked !== undefined,
    run: (context: ActionContext): void => {
      if (context.marked !== undefined) {
        context.layout?.beside(side, context.marked);
      }
    },
  })),
  {
    id: "unsplit-window",
    title: "Unsplit window",
    description: "Show the window with one pane again.",
    available: (context: ActionContext): boolean => context.layout?.other !== undefined,
    run: (context: ActionContext): void => {
      context.layout?.unsplit();
    },
  },
];
