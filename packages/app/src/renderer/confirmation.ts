// The confirmation step of the command prompt (SR-218 AK3), shared by the actions whose confirmed call cannot be
// taken back: "Delete …" of a perspective or saved filter, and the bulk update (#1778). It is the step right after
// the last answer, with the hits "No", first and marked, and "Yes, <verb>"; the explanation line (SR-210) says what
// confirming does and that Ctrl/Cmd+Enter does it.
//
// - Enter or a click on "Yes, <verb>" confirms; Ctrl/Cmd+Enter confirms too, whichever hit is marked, and offers no
//   optional arguments (`Prompt.confirm`, an exception to SR-108 AK6). Enter on "No", a click on it, Escape and
//   Backspace in an empty input go one step back (`back`).
// - The guard is in `PromptLine.tsx`: a key press that began before the step was shown, a key that only repeats
//   because it is held (`event.repeat`), and the second click of a double click (`event.detail`) do nothing on it,
//   and a key typed ahead for the prompt before (#1763) does not act on it.
import type { Prompt } from "./action-types.js";

/** The hit that goes back a step. */
export const NO = "No";

/** The hit that confirms: "Yes, delete", "Yes, apply". */
export const yesLabel = (verb: string): string => `Yes, ${verb}`;

/** What a confirmation step asks and does. */
export interface Confirmation {
  /** The label before the input: the command and what it acts on. */
  readonly label: string;
  /** The verb of the hit that confirms: "delete" gives "Yes, delete". */
  readonly verb: string;
  /** What the explanation line says Ctrl/Cmd+Enter does: "deletes". */
  readonly does: string;
  /** The name at the start of the explanation line. */
  readonly name: string;
  /** The rest of its first line: what confirming does. */
  readonly text: string;
  /** Confirming: the confirmed call. */
  readonly yes: () => void;
  /** One step back: "No", Escape, Backspace in an empty input. */
  readonly back: () => void;
}

/** The prompt of a confirmation step: "No" first, so it is marked, then "Yes, <verb>". */
export const confirmationPrompt = (step: Confirmation): Prompt => ({
  label: step.label,
  items: [
    { id: "confirm:no", name: NO, run: step.back },
    { id: "confirm:yes", name: yesLabel(step.verb), run: step.yes },
  ],
  explain: {
    name: step.name,
    description: step.text,
    list: false,
    ends: false,
    skips: false,
    more: true,
    moreDoes: step.does,
  },
  back: step.back,
  confirm: step.yes,
});
