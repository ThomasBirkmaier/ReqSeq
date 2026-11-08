// The actions of the command prompt on the headings of the text (SR-191): "Fold section", "Unfold section" and
// "Go to heading". They change only what the editor shows and where its cursor is, never the text, so they work on
// an element that cannot be changed too. The logic is in `editor/folding.ts`. Editor-only, no catalog command,
// like the slash menu (ADR-0010).
import type { Command } from "@codemirror/view";
import type { Action, ActionContext } from "./actions.js";
import type { Heading } from "./editor/folding.js";
import { foldSection, unfoldSection } from "./editor/folding.js";

/** What the shown element buffer lets these actions do with its text. */
export interface HeadingControls {
  /** The headings of the text, in order; none while the text is not there yet. */
  readonly list: () => readonly Heading[];
  /**
   * Runs `command` at the cursor of the text editor and gives it the focus, or says `none` when it does not apply
   * there or the cursor is in the title or a box.
   */
  readonly run: (command: Command, none: string) => void;
  /** Puts the cursor of the text at `from` and gives it the focus, wherever the cursor was. */
  readonly goTo: (from: number) => void;
}

const hasHeadings = (context: ActionContext): boolean =>
  context.buffers[0]?.kind === "element" && context.element?.headings !== undefined;

export const HEADING_ACTIONS: readonly Action[] = [
  {
    // SR-191 AK1.
    id: "fold-section",
    title: "Fold section",
    available: hasHeadings,
    run: (context: ActionContext): void => {
      context.element?.headings?.run(foldSection, "No section to fold here");
    },
  },
  {
    // SR-191 AK2.
    id: "unfold-section",
    title: "Unfold section",
    available: hasHeadings,
    run: (context: ActionContext): void => {
      context.element?.headings?.run(unfoldSection, "No folded section here");
    },
  },
  {
    // SR-191 AK3: the headings in the order of the text, found by the fuzzy match of the prompt.
    id: "go-to-heading",
    title: "Go to heading",
    available: hasHeadings,
    run: (context: ActionContext): void => {
      const controls = context.element?.headings;
      const found = controls?.list() ?? [];
      if (controls === undefined || found.length === 0) {
        context.echo("The text has no heading");
        return;
      }
      context.ask({
        label: "Go to heading",
        items: found.map((heading, index) => ({
          id: `heading-${String(index)}`,
          name: heading.name,
          hint: `H${String(heading.level)}`,
          run: () => {
            controls.goTo(heading.from);
          },
        })),
      });
    },
  },
];
