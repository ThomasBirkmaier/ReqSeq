// The types of the app's actions and of the prompts they open (`actions.ts`).
import type { AboutInfo } from "./about.js";
import type { Command } from "@codemirror/view";
import type { BufferAction, Buffers, ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { Shortcut } from "./keys.js";
import type { CommandListing } from "../shared/protocol.js";
import type { GraphFilterChoice } from "./graph-choices.js";
import type { GivenArguments, MatrixSpot } from "./matrix-menu.js";
import type { HeadingControls } from "./heading-actions.js";
import type { Range, Snippet } from "./rows.js";
import type { Theme } from "./theme.js";
import type { Side } from "./window-layout.js";
import type { PromptUse } from "./usage.js";
import type { ShownView } from "./views.js";
import type { WorkspaceControls } from "./workspaces.js";
import type { FoldChoice } from "./fold-statuses.js";

/** One entry of a prompt: what is listed, and what Enter does. */
export interface Choice {
  readonly id: string;
  readonly name: string;
  /**
   * Shown right-aligned in muted text: the shortcut, a count (the values of a property), the key of a value
   * beside its name, or a note such as `default` ("Main repository" of a metamodel location; SR-215 AK1).
   */
  readonly hint?: string;
  /** The title of an element hit, without its ID: the one whose title is the typed text comes first (#195). */
  readonly title?: string;
  /** The parts of `name` to mark, as core marked them (an element hit, SR-183 AK3). */
  readonly marks?: readonly Range[];
  /** Shown under the name: where a hit was found and one line around it (SR-174, SR-183 AK3). */
  readonly snippet?: Snippet;
  readonly run: () => void;
  /**
   * Choosing it puts this text in the input in place of the typed one, and the prompt stays open, so
   * typing goes on (a folder of a path, SR-143 AK1); `run` is then not called.
   */
  readonly complete?: string;
  /** It only informs ("… n more", SR-143 AK5): it cannot be selected or chosen. */
  readonly inert?: boolean;
  /** What Ctrl/Cmd+Enter does with it: take it and offer the optional arguments (catalog commands). */
  readonly more?: () => void;
  /** It fits the shown view (SR-133): only such entries are among the first nine of an empty input, and they come first among equal matches. */
  readonly fits?: boolean;
  /**
   * The explanation line while it is marked: the catalog command it runs, or the action's description (SR-210 AK1,
   * AK5).
   */
  readonly explain?: CommandExplanation;
  /** The command help of the catalog command it runs, or the action's description, shown on Ctrl+H (SR-210 AK3). */
  readonly help?: CommandHelp;
  /**
   * It opens another list of the same prompt ("All commands…", SR-133 AK3): only Enter or a click takes it, so
   * Ctrl/Cmd+Enter does nothing, and F1 opens the start page of the documentation (SR-210 AK5).
   */
  readonly opens?: true;
}

/**
 * The command help of a catalog command (SR-210 AK3), from the catalog: the summary and details of its reference
 * page, each argument with its description and whether it is required, and its call on the command line.
 */
export interface CommandHelp {
  readonly title: string;
  readonly summary: string;
  readonly details?: string;
  /** The arguments of a catalog command; an action of the app has none (its `description` is the summary). */
  readonly arguments?: readonly {
    readonly name: string;
    readonly required: boolean;
    readonly description?: string;
  }[];
  /** `reqseq element get <ref> [options]`: a catalog command only. */
  readonly cli?: string;
  /** The key of an action with its own description, as the command prompt shows it (SR-210 AK5). */
  readonly key?: string;
  /** The catalog commands an action with its own description runs, each with the display it runs it in (AK5). */
  readonly runs?: readonly CommandIn[];
  /** F1 and the link open the action's entry in the keyboard reference, not a reference page (AK5). */
  readonly keyReference?: true;
}

/** A catalog command an action runs, with the display it runs it in ("in the list", SR-210 AK5). */
export interface CommandIn {
  /** The display, as the command help names it: "in the list", "on the package page". */
  readonly where: string;
  readonly command: string;
}

/** What the explanation line of a marked entry says (SR-210 AK1, AK5). */
export interface CommandExplanation {
  /** The summary of the catalog command, or the description of an action of the app. */
  readonly summary: string;
  /**
   * How many optional arguments Ctrl/Cmd+Enter offers: on the entry of a catalog command only. An action that runs
   * the command asks none of them (SR-210 AK5).
   */
  readonly optional?: number;
  /** At the right the key Enter alone, which takes the entry: the row "All commands…" (SR-210 AK5). */
  readonly enter?: true;
}

/** What the explanation line of an asked argument says (SR-210 AK2): its catalog text and the keys of the step. */
export interface ArgumentExplanation {
  readonly name: string;
  /** The argument's description in the catalog. */
  readonly description?: string;
  /** It takes several values: Enter adds one. */
  readonly list: boolean;
  /** Enter on an empty input ends the values given (SR-108 AK6). */
  readonly ends: boolean;
  /** Enter on an empty input skips the optional argument. */
  readonly skips: boolean;
  /** Ctrl/Cmd+Enter offers optional arguments the command still has. */
  readonly more: boolean;
  /** What the line says Ctrl/Cmd+Enter does, in place of "more arguments": "deletes" (SR-218 AK3). */
  readonly moreDoes?: string;
  /**
   * A step of a value built from hits (SR-215): what Enter does with the marked hit, whether Backspace on an
   * empty input removes the last mark, and whether "{" starts a condition in JSON (SR-210 AK2). It takes the
   * place of the keys of `list`, `ends` and `skips`.
   */
  readonly building?: {
    readonly enter: string;
    readonly unmark: boolean;
    readonly json: boolean;
  };
  /**
   * What the line says before the keys for the typed text, if anything: that the name of a builder replaces a
   * saved perspective or saved filter (SR-219 AK4).
   */
  readonly note?: (text: string) => string | undefined;
}

/**
 * The explanation line of the search words (SR-216 AK9): the summary of the catalog command the search runs, and in
 * the second line what Enter and Ctrl/Cmd+Enter do; a click on Ctrl/Cmd+Enter there does what the key does (AK6).
 */
export interface StepExplanation {
  readonly summary?: string;
  readonly enter: string;
  readonly more: string;
}

/** A part of a value built from hits, shown as a mark in the input with an × that removes it (SR-215 AK3, AK9). */
export interface PromptMark {
  readonly label: string;
  readonly remove: () => void;
}

/** What the command prompt asks for. */
export interface Prompt {
  readonly label: string;
  readonly items: readonly Choice[];
  /** More choices for the typed text, from core (the jump prompt finds elements). */
  readonly find?: (query: string) => Promise<readonly Choice[]>;
  /**
   * As `find`, with a note for the label and whether the choices take the place of the prompt's own items
   * (the folder of a typed path, SR-143); it is asked in place of `find`.
   */
  readonly seek?: (query: string) => Promise<Found>;
  /** Free text: Enter runs it (the search prompt). */
  readonly text?: (text: string) => void;
  /**
   * The hits only preview: none is chosen until Ctrl+N, Ctrl+P or an arrow chooses one, and Enter without
   * one runs `text` at once, without waiting for the hits (the search prompt, SR-183 AK1, AK5).
   */
  readonly preview?: boolean;
  /**
   * A choice for the typed text itself, when it is one ("Open workspace": a folder path, SR-131 AK5): it
   * comes first, so Enter takes it, and Down reaches the others.
   */
  readonly literal?: (query: string) => Choice | undefined;
  /** The text typed so far, on every change of it (the search of "Find in element" marks its hits, SR-189 AK1). */
  readonly typing?: (text: string) => void;
  /**
   * Enter (`back` false) and Shift+Enter (`back` true) act on the typed text and the prompt stays open, until
   * Escape (the hits of "Find in element", SR-189 AK1). It takes the place of `text`.
   */
  readonly step?: (text: string, back: boolean) => void;
  /** The text the input starts with (the search of the last "Find in element" for "Replace"). */
  readonly initial?: string;
  /**
   * F1 (`HELP_KEY`): open the documentation of the chosen entry, or with none the start page, in the browser; the
   * prompt stays open (the command prompt, SR-141 AK3).
   */
  readonly help?: (choice: Choice | undefined) => void;
  /** Escape ends the prompt without an answer (not called when a choice is run, nor when text is entered). */
  readonly cancel?: () => void;
  /** Backspace in an empty input and Escape (SR-134 AK1): one argument back (catalog commands). */
  readonly back?: () => void;
  /** The explanation line of the argument asked (SR-210 AK2). */
  readonly explain?: ArgumentExplanation;
  /**
   * A confirmation step (`confirmation.ts`, SR-218 AK3): Ctrl/Cmd+Enter confirms, whichever hit is marked, and a key
   * press that began before the step was shown, a key that repeats and the second click of a double click do
   * nothing on it.
   */
  readonly confirm?: () => void;
  /**
   * The first step of an action, asked again (SR-218: after a step back or a refusal): Escape does what it did the
   * first time, back to the command prompt the action was chosen in or the end of the prompt, not back to the
   * prompt asked before it (SR-134 AK1, AK2).
   */
  readonly restart?: true;
  /** The explanation line of a step of an action of its own, the search words (SR-216 AK9). */
  readonly explainStep?: StepExplanation;
  /** The marks of the steps before in a builder, without × (SR-219 AK6): before `marks`, which they never are. */
  readonly earlier?: readonly string[];
  /** The marks in the input before the typed text (SR-215 AK3). */
  readonly marks?: readonly PromptMark[];
  /** Backspace in an empty input removes the last mark, while there is one, before it goes back (SR-215 AK9). */
  readonly unmark?: boolean;
  /**
   * The card keeps the place of the explanation line under the hits, also while the marked entry has none or there
   * is no hit, so the hits do not move (the command prompt, SR-210 AK1).
   */
  readonly explains?: boolean;
  /**
   * Escape, and Backspace on an empty input: back to the prompt asked before in the same action (SR-134 AK1, AK4). Without it and `back`,
   * Escape ends the prompt (the first step, AK2).
   */
  readonly previous?: () => void;
  /**
   * Ctrl/Cmd+Enter with no candidate: take the typed text and offer the optional arguments; in a prompt whose hits
   * only preview, also with a chosen one (the fields of a search, SR-216 AK6).
   */
  readonly more?: (text: string) => void;
  /** Enter on an empty input: end a list argument; `more` (Ctrl/Cmd+Enter) offers the optional arguments next. */
  readonly empty?: (more: boolean) => void;
  /** What was chosen before, to order equal matches and to put the command chosen for this text first (the command prompt). */
  readonly use?: PromptUse;
  /**
   * What an empty input shows of the items (the command prompt, SR-133 AK1, AK3). `first`: the first that many
   * items that fit, in the order of `rankByUse`, then `last`; a prompt with at most one item more than `first`
   * shows them all without `last`. `"as-given"`: every item in the order given (alphabetically by name). A typed
   * text finds among all items as without it, never `last`.
   */
  readonly opening?: { readonly first: number; readonly last: Choice } | "as-given";
  /**
   * The parts that come later (a catalog argument's values): the prompt is open and takes keys while they
   * load; then they replace the given parts, and Enter or Ctrl/Cmd+Enter pressed meanwhile acts on them. In a
   * prompt whose hits only preview, `text` and `more` belong to the given parts, not to `fill`: Enter and
   * Ctrl/Cmd+Enter without a chosen hit take the typed text at once with the given ones, also while the parts
   * load (`PromptLine.tsx`, SR-183 AK5).
   */
  readonly fill?: Promise<PromptFill>;
}

/** What `find` found for a text, with more than the choices (the folder of a typed path, SR-143). */
export interface Found {
  readonly choices: readonly Choice[];
  /** Said before the label while these choices are shown: why there are none (a folder that is missing). */
  readonly note?: string;
  /** The choices take the place of the prompt's own items for this text (a path in "Open workspace"). */
  readonly alone?: boolean;
}

/** The parts of a prompt that can come later. */
export type PromptFill = Partial<
  Pick<Prompt, "label" | "items" | "find" | "seek" | "text" | "more" | "literal" | "explain">
>;

/** How `ElementControls.text` runs its command. */
export interface TextOptions {
  /** The field gets the focus afterwards (default); false: it stays where it is (the command prompt of "Find in element", SR-189). */
  readonly focus?: boolean;
  /** On the text of the element, whichever field had the cursor (find and replace search the text, SR-189). */
  readonly inText?: boolean;
  /** The command changes no text, only marks and the caret: it runs also where the element takes no input. */
  readonly read?: boolean;
}

/** What the shown element buffer lets the app do with its text (SR-065). */
export interface ElementControls {
  /** Saves the input now with `element.update` and says so (the action "Save element"). */
  readonly save: () => void;
  /**
   * Saves the input now, quietly (SR-105 AK1: the buffer is closed, another workspace opens); resolves
   * true when no input is left unsaved.
   */
  readonly flush: () => Promise<boolean>;
  /** A prompt opens: the input typed so far is saved now (autosave does not wait for the prompt). */
  readonly prompting: () => void;
  /** Gives the text editor the focus (the action "Edit text"). */
  readonly edit: () => void;
  /**
   * Puts the caret at the end of the title, in its heading, or says why it cannot be edited (the action
   * "Edit title", ThomasBirkmaier/ReqSeq-archive#621). Given by the element buffer; a control without it offers no "Edit title".
   */
  readonly editTitle?: () => void;
  /** Opens the element of the inline reference at the cursor (the action "Follow reference", ThomasBirkmaier/ReqSeq-archive#424). */
  readonly follow: () => void;
  /** Copies the field with the cursor, else the ID (the action "Copy field", SR-128). */
  readonly copy: () => void;
  /**
   * Whether the cursor is on an acceptance criterion in its box, or was there last (SR-205 AK4); with
   * `pressed` (`ActionContext.pressed`), whether that line of a box is a criterion.
   */
  readonly onCriterion?: (pressed?: Element) => boolean;
  /**
   * Saves the input, then copies the reference for a test name of the criterion with the cursor, or on the
   * line `pressed`, or says why it has none (the action "Copy criterion reference", SR-205 AK4).
   */
  readonly copyCriterionReference?: (pressed?: Element) => void;
  /**
   * Opens the list of the elements with the value the cursor is on, or asks among the values of the element
   * that can be listed (the action "List elements with this value", SR-132).
   */
  readonly listValue: () => void;
  /** Asks which property to add and shows its empty box with the cursor in it (the action "Add property", SR-104 AK2). */
  readonly addProperty: () => void;
  /** Empties the box with the cursor, or the one the cursor was in last (the action "Clear property", SR-104 AK4). */
  readonly clearProperty: () => void;
  /**
   * Asks for an image file, copies it next to the element file and writes the Markdown that embeds it at
   * the caret of the text (the action "Insert image", SR-097, `insert-image.ts`).
   */
  readonly insertImage: () => void;
  /**
   * Runs an editing command at the cursor of the text and gives the text the focus, or says `none` when it does
   * not apply there, or why the element cannot be changed (the text actions, `text-actions.ts`).
   */
  readonly text?: (command: Command, none: string, options?: TextOptions) => void;
  /**
   * The headings of the text, and folding and the cursor of the text editor (SR-191, `heading-actions.ts`). They
   * change no text, so they are there for an element that cannot be changed too.
   */
  readonly headings?: HeadingControls;
  /** The shown element is a package: its page lists the elements that name it, and "Sort list" sorts them (SR-112). */
  readonly members?: boolean;
  /**
   * Asks which version holds, the input or the file's (the action "Resolve change on disk"). Only while the
   * file changed outside and the buffer has input that it no longer agrees with (SR-106 AK2): nothing is
   * saved until the user chose.
   */
  readonly resolve?: () => void;
}

/** The mode „Agent folgen“ (SR-117, `use-follow.ts`): display state of the app, switched only by its two actions (AK4). */
export interface FollowControls {
  readonly on: boolean;
  readonly start: () => void;
  readonly stop: () => void;
}

/**
 * The areas of the window (SR-115 AK3, `window-layout.ts`): display state of the app, like the mode
 * „Agent folgen“. The first buffer is shown in the active area.
 */
export interface LayoutControls {
  /** The key of the buffer in the inactive area; undefined while the window has one area. */
  readonly other: string | undefined;
  readonly split: () => void;
  readonly unsplit: () => void;
  /** Opens an element in the area on this side (SR-150 AK1 to AK3, `window-layout.ts`). */
  readonly beside: (side: Side, buffer: ElementBuffer) => void;
}

export interface ActionContext {
  /** A workspace is open. */
  readonly workspace: boolean;
  /** The open workspace is read-only (`workspace.status`, as the modeline shows it); absent: it is not. */
  readonly readOnly?: boolean;
  /** The open buffers, the most recent first; the first one is shown. */
  readonly buffers: Buffers;
  /** The keys of the open buffers, the most recently shown first (`buffer-cycle.ts`): "Next buffer" walks it. */
  readonly cycleOrder: readonly string[];
  /**
   * Notes that Next or Previous buffer (`step` as in `cycleKey`) switches to `key`, so that the order stays
   * while the keys walk it, and so that the switch slides (SR-212). Called after `leaveEditor`, before the switch.
   */
  readonly cycled: (key: string, step: 1 | -1) => void;
  /** Takes the focus out of a text editor that has it, so that the editor gets no more of the key. */
  readonly leaveEditor: () => void;
  readonly mac: boolean;
  /** Light and dark (SR-113). */
  readonly theme: Theme;
  /** Calls core in no view: the element offers of every prompt ("Go to", arguments, relation targets, references). */
  readonly call: Call;
  /**
   * Calls core in the view the window shows (`views.ts`, SR-043 AK1): the facets of the shown list and the
   * run of a catalog command. Absent: `call`.
   */
  readonly shownCall?: Call;
  readonly dispatch: (action: BufferAction) => void;
  readonly ask: (prompt: Prompt) => void;
  readonly echo: (message: string) => void;
  /**
   * Says `message` in the command line like `echo`, and a click on the message runs `open` (SR-223 AK8: the
   * output of a write command). Absent: `echo`, and the message opens nothing.
   */
  readonly report?: (message: string, open: () => void) => void;
  /** Shows the window "About ReqSeq" with the output of `tool.info` (SR-161). Absent: a result buffer shows it. */
  readonly about?: (info: AboutInfo) => void;
  /** Puts `text` on the clipboard, and the modeline confirms it with `label` (SR-128 AK2). */
  readonly copy?: (label: string, text: string) => void;
  /**
   * Has main paste the clipboard into the focused field, as Ctrl/Cmd+V does (SR-195 AK3); the renderer
   * never reads the clipboard. Absent: "Paste" says it cannot.
   */
  readonly paste?: () => void;
  /**
   * Opens the bundled documentation in the browser (SR-141): the start page, or the page of `topic`, a catalog
   * command name or an action ID; says in the command prompt whether it could. Absent: the app cannot.
   */
  readonly docs?: (topic?: string) => void;
  /** Says `text` in the modeline for a few seconds (the status of find and replace, SR-189 AK3). Absent: the command prompt says it. */
  readonly notify?: (text: string) => void;
  /**
   * The elements shown last in this workspace, newest first, as buffers (`recent.ts`, SR-118; their names
   * as the overview read them or as they were shown), read when "Go to" opens: it offers those that are
   * not open after the open buffers (SR-115 AK1). Absent: none.
   */
  readonly recent?: () => readonly ElementBuffer[];
  /** The shown element buffer, when it has loaded. */
  readonly element?: ElementControls;
  /** The element of the selected row of the shown list or search, when it has loaded. */
  readonly row?: ElementBuffer;
  /**
   * The element marked in the shown buffer (`markedElement`, SR-150): a selected row or graph node. Absent:
   * none is.
   */
  readonly marked?: ElementBuffer;
  /**
   * The element of the entry the commands act on (SR-197, `promptEntry`, `menuContext`): the marked element while the
   * context menu of an entry is open, and in a buffer without an element of its own (a list, a search, the
   * overview, the matrix). The entry actions act on it, and an element argument offers it first. Absent: the
   * commands act on the shown element.
   */
  readonly entry?: ElementBuffer;
  /**
   * Where the matrix's cursor or right-click stands (`matrix-menu.ts`, SR-199): the row, the column and a
   * connected element. Absent elsewhere.
   */
  readonly matrix?: MatrixSpot;
  /**
   * Arguments given to catalog commands before the prompt asks the others, by command name: the matrix's
   * "Create relation" and "Remove relation" while its menu is open (`menuContext`, SR-199). Absent: none.
   */
  readonly given?: GivenArguments;
  /**
   * What was pressed for the open context menu of a property box (`menuContext`, SR-205 AK4): its entries act
   * on the line pressed, also inside marked text whose caret is on another line. Absent elsewhere.
   */
  readonly pressed?: Element;
  /**
   * A metamodel command succeeded with `output` (SR-130 AK7): the graph and the text of the metamodel mark
   * what it added or changed (`metamodel-changes.ts`). Absent: nothing is marked.
   */
  readonly metamodelChanged?: (command: string, output: unknown) => void;
  /** The shown buffer has unsaved changes. */
  readonly modified: boolean;
  /** Whether "Close buffer" asked about the unsaved changes of the buffer with this key just now: closing again discards them. */
  readonly closeArmed: (key: string) => boolean;
  /** Remembers that closing asked about the buffer with this key, or (undefined) that it did not. */
  readonly armClose: (key: string | undefined) => void;
  /** Drops the unsaved changes of the buffer with this key. */
  readonly discard: (key: string) => void;
  /** The buffer with this key has unsaved changes. */
  readonly drafted: (key: string) => boolean;
  /**
   * Saves the unsaved changes of the buffer with this key now (SR-105 AK1); resolves true when none are
   * left unsaved. Absent: nothing is saved, as before autosave.
   */
  readonly saveDraft?: (key: string) => Promise<boolean>;
  /**
   * The entries of the relation kind prompts of a graph (`graph-choices.ts`), from the catalog and the
   * metamodel; without them only "Everything" is offered.
   */
  readonly graphChoices?: readonly GraphFilterChoice[];
  /** The command catalog as read last: the texts of the explanation lines of the search (SR-216 AK9). */
  readonly catalog?: () => readonly CommandListing[];
  /** The mode „Agent folgen“ (SR-117); absent where the window offers no such mode. */
  readonly follow?: FollowControls;
  /** The workspaces opened last and the switch between them (SR-131), where the window offers them. */
  readonly workspaces?: WorkspaceControls;
  /** "Split window" and its areas (SR-115 AK3), where the window offers them. */
  readonly layout?: LayoutControls;
  /** The view the window shows and "Choose view" (SR-043 AK1), where the window offers them. */
  readonly views?: ViewControls;
  /** Which statuses fold to the end of lists (SR-201, `fold-statuses.ts`), where the window offers it. */
  readonly folds?: FoldControls;
  /** The perspectives opened last (SR-214 AK1, `perspective-recent.ts`), where the window keeps them. */
  readonly perspectives?: PerspectiveUse;
  /**
   * Starts the builder of a perspective or a saved filter in the command prompt (SR-219 AK2, AK3,
   * `startBuilder` in `catalog-commands.ts`) in `context`, the one the action runs in, where the window has the
   * catalog.
   */
  readonly build?: (command: BuiltCommand, context: ActionContext) => void;
  /**
   * "Connect AI agent" (SR-227, `use-connect-agent.ts`) in `context`: asks the client, without an open workspace
   * after the workspace (SR-225 AK7). Absent: the window offers it not.
   */
  readonly connectAgent?: (context: ActionContext) => void;
  /**
   * "Write skill file" (SR-229 AK16, `write-skill.ts`) in `context`: runs `tool.guide` with `skill` and `write`
   * at once. Absent: the window offers it not.
   */
  readonly writeSkill?: (context: ActionContext) => void;
}

/** The catalog commands a builder runs (SR-219 AK1): "New perspective" and "New saved filter". */
export type BuiltCommand = "perspective.save" | "filter.save";

/** The order of use of the perspectives: display state of the app, never in the workspace (SR-214 AK1). */
export interface PerspectiveUse {
  /** The names opened last, the most recent first. */
  readonly used: () => readonly string[];
  /** The user opened the perspective of this name. */
  readonly opened: (name: string) => void;
  /** The perspective `from` was renamed to `to` in the app (SR-218 AK4): it keeps its place in the order. */
  readonly renamed?: (from: string, to: string) => void;
}

/** The statuses folded in lists (SR-201): display state of the app, kept for this user (AK4). */
export interface FoldControls {
  /** The chosen statuses; undefined while none are chosen and the invalid ones fold. */
  readonly choice: FoldChoice;
  readonly choose: (next: FoldChoice) => void;
}

/** The view of the workspace the window shows (`views.ts`): display state, like the areas. */
export interface ViewControls {
  /** Undefined while all elements are shown. */
  readonly shown: ShownView | undefined;
  readonly choose: (next: ShownView | undefined) => void;
}

export interface Action {
  readonly id: string;
  readonly title: string;
  /**
   * What it does, in one sentence: the explanation line and the command help show it, and the keyboard reference
   * names it (SR-210 AK5, SR-139 AK6). Only an action that runs no catalog command, or one of several by the shown
   * buffer, has one; one that runs exactly one shows that command's summary (`coveredCommand`).
   */
  readonly description?: string;
  /**
   * The catalog commands an action with a `description` runs, each with the display it runs it in: the command
   * help names them (SR-210 AK5). Absent for an action that runs none.
   */
  readonly runs?: readonly CommandIn[];
  readonly shortcut?: Shortcut;
  /** Shown in the command prompt in place of a shortcut: a key that only works in the buffer ("Enter"). */
  readonly hint?: string;
  /**
   * The key of the system that does the same in the field itself (Ctrl/Cmd+X, C, V, SR-195 AK3): shown as
   * the hint, but the window binds nothing to it, since the field takes the key first.
   */
  readonly systemKey?: Shortcut;
  /**
   * Catalog commands this action does, so the command prompt does not list them as well (ThomasBirkmaier/ReqSeq-archive#85).
   * Without it, the command with the action's title; empty: none, for an action that only shares a title.
   */
  readonly covers?: readonly string[];
  /**
   * Its shortcut works also while a prompt is open, since it only opens a prompt of its own in place of that one.
   * Every other shortcut does nothing then: the keys belong to the input of the prompt, and an action on the
   * shown buffer would take the focus from it while the prompt stays open (#1577).
   */
  readonly inPrompt?: true;
  readonly available: (context: ActionContext) => boolean;
  /**
   * Whether it fits the shown view (SR-133 AK1) where it is available; absent, it fits wherever it is available
   * ("New perspective" fits only the overview and a list, SR-219 AK1).
   */
  readonly fits?: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}
