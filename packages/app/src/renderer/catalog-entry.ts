// The state of the argument entry of one catalog command (`catalog-commands.ts`, which walks the catalog), and
// what the values built from hits share with it: the condition (`condition-prompt.ts`), the sort
// (`sort-prompt.ts`), the grouping (`group-prompt.ts`) and the properties and relations of a new element
// (`create-prompt.ts`). Each of them is asked through one shape (`BuiltAsk`): the line, back with the marks
// held, and the value the marks give, which the walk takes as the argument's value.
import type { CommandListing } from "../shared/protocol.js";
import type { ActionContext, ArgumentExplanation } from "./actions.js";
import type { ConditionMark } from "./condition-prompt.js";
import type { RequiredProperty } from "./create-element.js";
import type { PropertyMark, RelationMark } from "./create-prompt.js";
import type { SortMark } from "./sort-prompt.js";

/** A part of a value built from hits (`condition-prompt.ts`, `sort-prompt.ts`, `create-prompt.ts`). */
export type BuiltMark = ConditionMark | SortMark | PropertyMark | RelationMark;

/** One value given to an argument, and how the prompt shows it. */
export interface Given {
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
  /** A condition or sort built from hits (SR-215 AK3, AK7): its marks, which stand again when it is asked again (AK9). */
  readonly marks?: readonly BuiltMark[];
  /**
   * Where the value stands among the values given (`ordered`): the next number when it is given, the
   * number of the value it replaces when it is asked again, so it keeps that value's place.
   */
  readonly rank: number;
}

/** A value as it is given; `appended` numbers it. */
export type Giving = Omit<Given, "rank">;

/** Where the argument entry of one command stands. */
export interface Entry {
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
  /** The marks of the condition or sort asked again (SR-215 AK6, AK9). */
  readonly marks?: readonly BuiltMark[];
  /**
   * The marks of a condition or sort left by going back before it was taken (Escape, SR-215 AK9): they stand
   * again when the prompt returns to its field.
   */
  readonly held?: { readonly field: string; readonly marks: readonly BuiltMark[] };
}

/** The values given with one more: in the place of the value asked again, else after the others. */
export const appended = (entry: Entry, value: Giving): Given[] => [
  ...entry.given,
  { ...value, rank: entry.again ?? Math.max(0, ...entry.given.map((given) => given.rank)) + 1 },
];

/**
 * The values given in the order of their places, for the prompt's line and the input: each argument (each
 * property) where its first value stands, its values in their order. `given` itself stays in the order of
 * the answers, so Backspace takes back the answer given last.
 */
export const ordered = (given: readonly Given[]): Given[] => {
  const group = (value: Given): string => `${value.field}\u0000${value.property ?? ""}`;
  const place = (value: Given): number =>
    Math.min(...given.filter((other) => group(other) === group(value)).map((other) => other.rank));
  return given
    .map((value) => ({ value, place: place(value) }))
    .sort((a, b) => a.place - b.place || a.value.rank - b.value.rank)
    .map(({ value }) => value);
};

/** One value of a closed list; `asks` goes with it to the value given (`Given.asks`). */
export interface Value {
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
export type Offer =
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

export interface Failed {
  readonly kind: "failed";
  readonly message: string;
}

export const listOf = <T>(
  answer: { readonly ok: true; readonly output: T } | { readonly ok: false; readonly message: string },
  values: (output: T) => readonly Value[],
): Offer | Failed =>
  answer.ok ? { kind: "list", values: values(answer.output) } : { kind: "failed", message: answer.message };

export const failed = (value: unknown): value is Failed =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "failed";

/** "Create relation SR-1" : the title and the values given so far (a skipped property shows nothing). */
export const lineOf = (entry: Entry): string =>
  [
    entry.command.title,
    ...ordered(entry.given)
      .map((given) => given.label)
      .filter((label) => label !== ""),
  ].join(" ");

/** `entry` without the marks held for `field`, which its value takes; those of another field stay held. */
export const unheld = (entry: Entry, field: string): Entry => {
  const { held, ...rest } = entry;
  return held === undefined || held.field === field ? rest : entry;
};

/** The marks a condition or sort asked at `field` starts with: those asked again, else those held (AK9). */
export const heldMarks = (entry: Entry, field: string): readonly BuiltMark[] =>
  entry.marks ?? (entry.held?.field === field ? entry.held.marks : []);

/** What the steps of a value built from hits need from the argument entry: its marks are of kind `M`. */
export interface BuiltAsk<M> {
  readonly context: ActionContext;
  /** The command's line and the field, "Save filter open · where": the prompts' labels start with it. */
  readonly line: string;
  /** Why core refused the value, said in the first step when it is asked again (SR-215 AK6). */
  readonly error?: string;
  /** The explanation line of the argument (SR-210 AK2), to which each step adds its keys. */
  readonly explain: ArgumentExplanation;
  /** One argument back, with the marks given, which stand again when the argument is asked again (SR-215 AK9). */
  readonly back: (marks: readonly M[]) => void;
  /** Takes the marks as the value; `more` (Ctrl/Cmd+Enter) offers the optional arguments next. */
  readonly take: (marks: readonly M[], more: boolean) => void;
}
