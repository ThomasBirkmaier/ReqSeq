// The app's own actions, which the command prompt (Ctrl/Cmd+Shift+P) lists by name and runs, and the
// prompts they open. Only what applies to the shown buffer is offered. Every datum comes from a catalog
// command, shown as it is (ADR-0002); filter and sort only build the input of `element.list`. Each filter
// is a step that narrows the list the one before gave (SR-124 AK1, `list-filters.ts`): the conditions are
// ANDed in the selection; the values of "Filter list by property" come from `element.facets`.
//
// The prompt finds the app's actions and the catalog's read commands (`catalog-commands.ts`, ThomasBirkmaier/ReqSeq-archive#85); an
// action that does what a command does covers it, so the prompt lists it once.
import type { AboutInfo } from "./about.js";
import type { Command } from "@codemirror/view";
import type { DataExportElement, ElementSelection } from "@reqseq/core";
import type {
  Buffer,
  BufferAction,
  Buffers,
  ElementBuffer,
  GraphBuffer,
  MetamodelBuffer,
  ResultBuffer,
} from "./buffers.js";
import {
  bufferName,
  elementBuffer,
  elementBufferOf,
  graphBuffer,
  metamodelBuffer,
  neighbourhoodBuffer,
  onlyOverview,
  overviewBuffer,
  searchBuffer,
  showBuffer,
} from "./buffers.js";
import type { Call } from "./call.js";
import { bindingLabel } from "./bindings.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import { LIST_ACTIONS, MATRIX_SHORTCUT, choice } from "./list-actions.js";
import { linesOf, resultText } from "./result-copy.js";
import type { KeyPress, Shortcut } from "./keys.js";
import { shortcutLabel } from "./keys.js";
import { OPEN_WORKSPACE_ACTION } from "../shared/open-hint.js";
import type { SwipeDirection } from "../shared/protocol.js";
import type { GraphChoice, GraphFilterChoice } from "./graph-choices.js";
import {
  DEPTH_KEYS,
  EVERYTHING,
  alsoChoices,
  depthChoices,
  hasFilter,
  onlyChoices,
} from "./graph-choices.js";
import { mermaidInput } from "./graph.js";
import { cycleKey } from "./buffer-cycle.js";
import { criterionLabel, criterionReferenceOf } from "@reqseq/core/criterion-items";
import { TEXT_ACTIONS } from "./text-actions.js";
import { ENTRY_ACTIONS } from "./entry-menu.js";
import type { GivenArguments, MatrixSpot } from "./matrix-menu.js";
import { FIND_ACTIONS } from "./find-actions.js";
import { HEADING_ACTIONS } from "./heading-actions.js";
import type { HeadingControls } from "./heading-actions.js";
import { labelMarks, rowName, searchRows } from "./rows.js";
import type { Range, Row, Snippet } from "./rows.js";
import type { Theme } from "./theme.js";
import type { Side } from "./window-layout.js";
import type { PromptUse } from "./usage.js";
import type { ShownView } from "./views.js";
import { viewName, viewsOf } from "./views.js";
import type { WorkspaceControls } from "./workspaces.js";
import type { FoldChoice } from "./fold-statuses.js";
import { foldPrompt } from "./fold-actions.js";
import { workspacePrompt } from "./workspaces.js";

/** One entry of a prompt: what is listed, and what Enter does. */
export interface Choice {
  readonly id: string;
  readonly name: string;
  /** Shown right-aligned in muted text: the shortcut, or a count (the values of a property). */
  readonly hint?: string;
  /** The title of an element hit, without its ID: the one whose title is the typed text comes first (#195). */
  readonly title?: string;
  /** Lower case words of `name` to mark (element hits). */
  readonly terms?: readonly string[];
  /** The parts of `name` to mark, as core marked them (a hit of the search prompt, SR-183 AK3). */
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
  /** It fits the shown view (SR-133): it comes before the others when nothing is typed and among equal matches. */
  readonly fits?: boolean;
  /**
   * The explanation line while it is marked: the catalog command it runs, or the action's description (SR-210 AK1,
   * AK5).
   */
  readonly explain?: CommandExplanation;
  /** The command help of the catalog command it runs, or the action's description, shown on Ctrl+H (SR-210 AK3). */
  readonly help?: CommandHelp;
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
}

/** What the minibuffer asks for. */
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
   * The card keeps the place of the explanation line under the hits, also while the marked entry has none or there
   * is no hit, so the hits do not move (the command prompt, SR-210 AK1).
   */
  readonly explains?: boolean;
  /**
   * Escape only: back to the prompt asked before in the same action (SR-134 AK1). Without it and `back`,
   * Escape ends the prompt (the first step, AK2).
   */
  readonly previous?: () => void;
  /** Ctrl/Cmd+Enter with no candidate: take the typed text and offer the optional arguments. */
  readonly more?: (text: string) => void;
  /** Enter on an empty input: end a list argument; `more` (Ctrl/Cmd+Enter) offers the optional arguments next. */
  readonly empty?: (more: boolean) => void;
  /** What was chosen before, to order equal matches and to put the command chosen for this text first (the command prompt). */
  readonly use?: PromptUse;
  /**
   * The parts that come later (a catalog argument's values): the prompt is open and takes keys while they
   * load; then they replace the given parts, and Enter or Ctrl/Cmd+Enter pressed meanwhile acts on them.
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
  Pick<Prompt, "label" | "items" | "find" | "seek" | "text" | "more" | "literal">
>;

/** How `ElementControls.text` runs its command. */
export interface TextOptions {
  /** The field gets the focus afterwards (default); false: it stays where it is (the minibuffer of "Find in element", SR-189). */
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
   * command name or an action ID; says in the minibuffer whether it could. Absent: the app cannot.
   */
  readonly docs?: (topic?: string) => void;
  /** Says `text` in the modeline for a few seconds (the status of find and replace, SR-189 AK3). Absent: the minibuffer says it. */
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
   * on the line pressed, also inside a selection whose caret is on another line. Absent elsewhere.
   */
  readonly pressed?: Element;
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
}

/** The order of use of the perspectives: display state of the app, never in the workspace (SR-214 AK1). */
export interface PerspectiveUse {
  /** The names opened last, the most recent first. */
  readonly used: () => readonly string[];
  /** The user opened the perspective of this name. */
  readonly opened: (name: string) => void;
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
  /** Catalog commands this action does, so the command prompt does not list them as well (ThomasBirkmaier/ReqSeq-archive#85). */
  readonly covers?: readonly string[];
  /**
   * Its shortcut works also while a prompt is open, since it only opens a prompt of its own in place of that one.
   * Every other shortcut does nothing then: the keys belong to the input of the prompt, and an action on the
   * shown buffer would take the focus from it while the prompt stays open (#1577).
   */
  readonly inPrompt?: true;
  readonly available: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}

/** What the actions that set what the shown graph follows run (SR-210 AK5). */
const GRAPH_RUNS: readonly CommandIn[] = [{ where: "in the graph", command: "trace.graph" }];

/** Ctrl/Cmd+S saves the text of the shown element. */
const SAVE_SHORTCUT: Shortcut = { mod: true, shift: false, key: "s" };

/**
 * Ctrl/Cmd+Alt+A (macOS ⌥⌘A) adds a property to the shown element (SR-104 AK2). Not Cmd+Shift+A: with
 * text selected, macOS gives that to the service "Search man Page Index in Terminal".
 */
const ADD_PROPERTY_SHORTCUT: Shortcut = { mod: true, shift: false, alt: true, key: "a" };

/** Ctrl/Cmd+J shows the neighbourhood of the shown element (SR-107), and on the neighbourhood the element again. */
const NEIGHBOURHOOD_SHORTCUT: Shortcut = { mod: true, shift: false, key: "j" };

/**
 * Ctrl/Cmd+Shift+G shows the graph of the shown element (SR-111), and on the graph the element again.
 * Not Ctrl/Cmd+G: Ctrl+G is the Emacs keyboard-quit (SR-121) and stays free.
 */
export const GRAPH_SHORTCUT: Shortcut = { mod: true, shift: true, key: "g" };

/**
 * Ctrl/Cmd+T also shows the metamodel as text, and the text as a graph again (SR-130 AK4): the key that
 * switches the representation of the shown buffer. Never available together with the matrix actions.
 */
const METAMODEL_SHORTCUT: Shortcut = MATRIX_SHORTCUT;

/**
 * Ctrl/Cmd+Shift+Enter lists the elements with the value at the cursor (SR-132). Ctrl/Cmd+Enter stays
 * "Follow reference", which opens the target of a relation box and the reference of a Markdown box (ThomasBirkmaier/ReqSeq-archive#610).
 */
const LIST_VALUE_SHORTCUT: Shortcut = { mod: true, shift: true, key: "enter" };

/**
 * Alt+P (Option+P on macOS) goes back to the buffer shown before, Alt+N forward again (SR-115 AK5), also while typing in an editor. Alt alone: Ctrl/Cmd+N and Ctrl/Cmd+P are other keys (SR-122).
 */
export const NEXT_BUFFER_SHORTCUT: Shortcut = { mod: false, shift: false, alt: true, key: "n" };
export const PREVIOUS_BUFFER_SHORTCUT: Shortcut = { mod: false, shift: false, alt: true, key: "p" };
/**
 * The mouse buttons Back and Forward (`MouseEvent.button` 3 and 4, as Chromium reports them on macOS, Windows
 * and Linux) do what Alt+P and Alt+N do (SR-163 AK1, AK2): the action of the button where it applies; other
 * buttons have none.
 */
const MOUSE_BUTTON_ACTIONS: Readonly<Partial<Record<number, string>>> = {
  3: "previous-buffer",
  4: "next-buffer",
};
export const mouseButtonAction = (context: ActionContext, button: number): Action | undefined => {
  const id = MOUSE_BUTTON_ACTIONS[button];
  return ACTIONS.find((action) => action.id === id && action.available(context));
};
/** Whether `button` is Back or Forward, which `mouseButtonAction` takes. */
export const isBufferMouseButton = (button: number): boolean => MOUSE_BUTTON_ACTIONS[button] !== undefined;
/** A swipe macOS reports to the window does what the mouse buttons do (SR-163 AK4): left Back, right Forward. */
const SWIPE_BUTTONS: Readonly<Record<SwipeDirection, number>> = { left: 3, right: 4 };
export const swipeAction = (context: ActionContext, direction: SwipeDirection): Action | undefined =>
  mouseButtonAction(context, SWIPE_BUTTONS[direction]);
/**
 * Cmd+[ and Cmd+] on macOS do what the mouse buttons Back and Forward do (SR-163 AK3): mouse software such as
 * Logi Options+ sends the side buttons as these keys, as Finder takes them. By the character or by the
 * physical key, since a German layout has "ü" and "+" there: Cmd alone on the physical key, Cmd with or
 * without Option on the character, which a German layout types with Option (⌘⌥5, ⌘⌥6).
 */
const HISTORY_CHARACTERS: ReadonlyMap<string, number> = new Map([
  ["[", 3],
  ["]", 4],
]);
const HISTORY_CODES: ReadonlyMap<string, number> = new Map([
  ["BracketLeft", 3],
  ["BracketRight", 4],
]);
export const historyKeyAction = (context: ActionContext, event: KeyPress): Action | undefined => {
  if (!context.mac || !event.metaKey || event.ctrlKey || event.shiftKey) {
    return undefined;
  }
  const button =
    HISTORY_CHARACTERS.get(event.key) ?? (event.altKey ? undefined : HISTORY_CODES.get(event.code ?? ""));
  return button === undefined ? undefined : mouseButtonAction(context, button);
};
/**
 * "Other window" (SR-150 AK7): Alt+O, beside Alt+N and Alt+P, because Ctrl/Cmd+O opens a workspace and the
 * physical Ctrl key on macOS belongs to the editor.
 */
export const OTHER_WINDOW_SHORTCUT: Shortcut = { mod: false, shift: false, alt: true, key: "o" };

/**
 * Ctrl/Cmd+Shift+O turns the mode „Agent folgen“ on, and off again (SR-117 AK4). Not Shift+G: that is the
 * graph (SR-111); Ctrl/Cmd+G stays free for the keyboard-quit, Ctrl/Cmd+K is the prefix key
 * (`bindings.ts`, ThomasBirkmaier/ReqSeq-archive#472).
 */
export const FOLLOW_SHORTCUT: Shortcut = { mod: true, shift: true, key: "o" };

const isElement = (context: ActionContext): boolean => context.buffers[0]?.kind === "element";
const isNeighbourhood = (context: ActionContext): boolean => context.buffers[0]?.kind === "neighbourhood";
const isGraph = (context: ActionContext): boolean => context.buffers[0]?.kind === "graph";
const hasWorkspace = (context: ActionContext): boolean => context.workspace;
/** There is another buffer to switch to (SR-115 AK5: „mehrere geöffnete Buffer“). */
const hasOthers = (context: ActionContext): boolean => context.buffers.length > 1;
/** A buffer is open that can be closed: the lone overview cannot, it comes back (SR-118). */
const hasBuffers = (context: ActionContext): boolean =>
  context.buffers.length > 0 && !onlyOverview(context.buffers);
const isOverview = (context: ActionContext): boolean => context.buffers[0]?.kind === "overview";
/** The shown result buffer with an output (none while it failed). */
const shownResult = (context: ActionContext): ResultBuffer | undefined => {
  const shown = context.buffers[0];
  return shown?.kind === "result" && shown.output !== undefined ? shown : undefined;
};
const hasElementText = (context: ActionContext): boolean =>
  isElement(context) && context.element !== undefined;
/** The shown buffer when it is the metamodel in `mode`. */
const metamodelIn = (context: ActionContext, mode: MetamodelBuffer["mode"]): MetamodelBuffer | undefined => {
  const shown = context.buffers[0];
  return shown?.kind === "metamodel" && shown.mode === mode ? shown : undefined;
};

/** Shows the metamodel in `to` when it is shown in `from`; the selection stays. */
const switchMetamodel =
  (from: MetamodelBuffer["mode"], to: MetamodelBuffer["mode"]) =>
  (context: ActionContext): void => {
    const shown = metamodelIn(context, from);
    if (shown !== undefined) {
      context.dispatch({ type: "open", buffer: { ...shown, mode: to } });
    }
  };

/**
 * An action on the shown graph that asks with `label` for one of the entries `choices` gives: taking one
 * shows its graph buffer, the same buffer with another depth or filter, so the graph asks `trace.graph`
 * again and keeps the selected node while it is still there. `nothing` is said when there is no entry (only
 * "Also show" can have none: the depths are always there, and "Show only" always has "Everything").
 */
const graphPrompt =
  (
    label: string,
    choices: (graph: GraphBuffer, filters: readonly GraphFilterChoice[]) => readonly GraphChoice[],
    nothing?: string,
  ) =>
  (context: ActionContext): void => {
    const graph = context.buffers[0];
    if (graph?.kind !== "graph") {
      return;
    }
    const items = choices(graph, context.graphChoices ?? [EVERYTHING]);
    if (items.length === 0 && nothing !== undefined) {
      context.echo(nothing);
      return;
    }
    context.ask({
      label,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        ...(item.hint === undefined ? {} : { hint: item.hint }),
        run: () => {
          context.dispatch({ type: "open", buffer: item.buffer });
        },
      })),
    });
  };

/** What `findElements` takes besides what choosing a row does. */
export interface FindOptions {
  /** Limits the search, such as to the target types of a relation property (SR-104). */
  readonly selection?: ElementSelection;
  /** What Ctrl/Cmd+Enter on a row does (a catalog argument: take it and offer the optional arguments, ThomasBirkmaier/ReqSeq-archive#85). */
  readonly more?: (row: Row) => void;
}

/**
 * The elements `element.search` finds for the typed text, as the choices of a prompt; `run` is what
 * choosing one does. The prompts "Go to", "Insert reference" (SR-129), the one of a relation property
 * (SR-104) and an element argument of a catalog command (ThomasBirkmaier/ReqSeq-archive#85) find them the same way.
 */
export const findElements =
  (context: Pick<ActionContext, "call" | "echo">, run: (row: Row) => void, options: FindOptions = {}) =>
  async (query: string): Promise<readonly Choice[]> => {
    const { selection, more } = options;
    const answer = await context.call("element.search", {
      query,
      ...(selection === undefined ? {} : { selection }),
      fields: ["id", "title"],
      limit: 20,
    });
    if (!answer.ok) {
      context.echo(answer.message);
      return [];
    }
    return searchRows(answer.output).map((row) => ({
      id: row.open.key,
      name: rowName(row),
      title: row.title,
      terms: [
        ...row.terms,
        ...labelMarks(row, query).map(([start, end]) => row.label.slice(start, end).toLowerCase()),
      ],
      run: () => {
        run(row);
      },
      ...(more === undefined
        ? {}
        : {
            more: () => {
              more(row);
            },
          }),
    }));
  };

/**
 * The prompt of Ctrl/Cmd+P (SR-115 AK1): the open buffers but the shown one, the one used last first, then
 * the elements shown last that are not open (newest first), and elements found by `element.search` for
 * the typed text; a hit whose whole title is the typed text comes first (#195). The fuzzy ranking keeps
 * this order among equal matches. The recent elements come with
 * their names, so the prompt asks core nothing when it opens and the search is not queued behind reads.
 */
export const jumpPrompt = (context: ActionContext): Prompt => {
  const open = new Set(context.buffers.map((buffer) => buffer.key));
  const closed = (context.recent?.() ?? []).filter((buffer) => !open.has(buffer.key));
  return {
    label: "Go to",
    items: [
      ...context.buffers.slice(1).map((buffer): Choice => ({
        id: buffer.key,
        name: bufferName(buffer),
        run: () => {
          context.dispatch({ type: "switch", key: buffer.key });
        },
      })),
      ...closed.map((buffer): Choice => ({
        id: buffer.key,
        name: bufferName(buffer),
        run: () => {
          context.dispatch({ type: "open", buffer });
        },
      })),
    ],
    find: async (query) => {
      const [criterion, found] = await Promise.all([
        criterionChoices(context, query),
        findElements(context, (row) => {
          context.dispatch({ type: "open", buffer: row.open });
        })(query),
      ]);
      return [...criterion, ...found];
    },
  };
};

/**
 * The choice "Go to" offers for a typed reference to an acceptance criterion, `[SR-036/AK-k7f3]` from a
 * failing test (SR-205 AK5): `element.resolve` names the requirement and the criterion's number and
 * text, and choosing it opens the requirement. None for other text (`criterionReferenceOf` of core reads
 * it as enrich-junit does); a refused reference in brackets says why in the echo area.
 */
export const criterionChoices = async (context: ActionContext, query: string): Promise<readonly Choice[]> => {
  if (typeof criterionReferenceOf(query)?.criterion !== "string") {
    return [];
  }
  const answer = await context.call("element.resolve", { ref: query.trim() });
  if (!answer.ok) {
    // Only a closed bracket token is complete: a reference without brackets may still be being typed.
    if (query.trim().startsWith("[")) {
      context.echo(answer.message);
    }
    return [];
  }
  const { element, criterion } = answer.output;
  if (criterion === undefined) {
    return [];
  }
  const buffer = elementBufferOf(element);
  return [
    {
      id: `criterion:${buffer.key}:${criterion.key ?? String(criterion.criterion)}`,
      name: `${buffer.name} · ${criterionLabel(criterion)} · ${criterion.text}`,
      run: () => {
        context.dispatch({ type: "open", buffer });
      },
    },
  ];
};

/** The prompt of the slash menu's "Reference to element" (SR-129): an element is picked, the editor writes the reference. */
export const referencePrompt = (context: ActionContext, request: ReferenceRequest): Prompt => ({
  label: "Insert reference",
  items: [],
  find: findElements(context, (row) => {
    request.insert({
      id: row.open.id,
      title: row.title,
      // The link text of an untitled element stays what the file stored before SR-084 AK4: its identifier,
      // else (none or blank) the short ID.
      label: row.identifier !== undefined && row.identifier.trim() !== "" ? row.identifier : row.shortId,
      shortId: row.shortId,
      repository: row.open.repository,
    });
  }),
  cancel: request.cancel,
});

/** The lines of the hit card at the size it has for commands: `.card-list` in styles.css is as high. */
export const CARD_LINES = 10;

/**
 * The first `rows` that fit the hit card without making it higher (SR-183 AK1): in their order, a hit
 * with a snippet takes two lines, one without it one (`.card-list li.hit` in styles.css).
 */
export const fittingRows = (rows: readonly Row[], lines = CARD_LINES): Row[] => {
  const fit: Row[] = [];
  let left = lines;
  for (const row of rows) {
    left -= row.snippet === undefined ? 1 : 2;
    if (left < 0) {
      break;
    }
    fit.push(row);
  }
  return fit;
};

/**
 * The marks of a hit's name, `rowName(row)`: the ID when it matched, and the words core marked in
 * the title, as the search buffer marks them (SR-183 AK3).
 */
export const nameMarks = (row: Row, query: string): Range[] => {
  const name = rowName(row);
  const label = labelMarks(row, query);
  if (name === row.label.trim()) {
    return label;
  }
  // The title stands after the ID and a space, without the spaces it starts with.
  const shift = name.length - row.title.trim().length - (row.title.length - row.title.trimStart().length);
  return [...label, ...row.titleMarks.map(([start, end]): Range => [start + shift, end + shift])];
};

/**
 * The prompt of Ctrl/Cmd+Shift+F (SR-183): while typing it shows the first hits of the search buffer for
 * the text, in its order, as many as fit the card, each with its title and snippet; none is chosen.
 * Enter on a chosen hit opens it, Enter without one opens the search buffer.
 */
const searchPrompt = (context: ActionContext): Prompt => ({
  label: "Search",
  items: [],
  preview: true,
  find: async (text) => {
    // The query of the search buffer, so the hits are its first ones (AK2).
    const answer = await context.call("element.search", { query: text.trim(), limit: CARD_LINES });
    if (!answer.ok) {
      context.echo(answer.message);
      return [];
    }
    return fittingRows(searchRows(answer.output)).map((row) => ({
      id: row.open.key,
      name: rowName(row),
      marks: nameMarks(row, text),
      ...(row.status === undefined ? {} : { hint: row.status }),
      ...(row.snippet === undefined ? {} : { snippet: row.snippet }),
      run: () => {
        context.dispatch({ type: "open", buffer: row.open });
      },
    }));
  },
  text: (text) => {
    const query = text.trim();
    if (query !== "") {
      context.dispatch({ type: "open", buffer: searchBuffer(query) });
    }
  },
});

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
 * AK1), and the buffers close. Only text that could not be saved makes the minibuffer ask, not a dialog
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

/** "All elements" ends a view; the window shows no view at the start. */
const ALL_VIEWS = "All elements";

/**
 * The prompt "View" of "Choose view" (SR-043 AK1): all elements, the core and each variant of the
 * workspace (`viewsOf`), the one shown marked. It opens at once and takes keys while core reads them.
 */
const viewPrompt = (context: ActionContext, views: ViewControls): Prompt => {
  const choice = (id: string, name: string, next: ShownView | undefined): Choice => ({
    id,
    name,
    ...(views.shown?.view === next?.view ? { hint: "shown" } : {}),
    run: () => {
      views.choose(next);
      context.echo(next === undefined ? "Showing all elements" : `Showing the view ${viewName(next)}`);
    },
  });
  return {
    label: "View",
    items: [],
    fill: viewsOf(context.call).then((read): PromptFill => {
      if (!read.ok) {
        context.echo(read.message);
      }
      return {
        items: [
          choice("view:all", ALL_VIEWS, undefined),
          ...(read.ok ? read.views : []).map((shown) => choice(`view:${shown.view}`, viewName(shown), shown)),
        ],
      };
    }),
  };
};

/** The line of "Show element ID and version": the UUID and the date of the version (D-013). */
const versionLine = (element: DataExportElement): string =>
  `${element.id} · version of ${element.versionDate ?? "unknown date"} · ${element.repository}:${element.file}`;

export const ACTIONS: readonly Action[] = [
  {
    id: "go-to",
    title: "Go to element or buffer",
    shortcut: { mod: true, shift: false, key: "p" },
    inPrompt: true,
    covers: ["element.get"],
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      context.ask(jumpPrompt(context));
    },
  },
  {
    id: "overview",
    title: "Show overview",
    description: "Show the overview of the workspace.",
    available: (context) => hasWorkspace(context) && !isOverview(context),
    run: (context: ActionContext): void => {
      context.dispatch({ type: "open", buffer: overviewBuffer() });
    },
  },
  {
    id: "search",
    title: "Search elements",
    shortcut: { mod: true, shift: true, key: "f" },
    inPrompt: true,
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      context.ask(searchPrompt(context));
    },
  },
  ...LIST_ACTIONS,
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
    title: "Other window",
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
  {
    id: "save",
    title: "Save element",
    shortcut: SAVE_SHORTCUT,
    // With "Edit title", "Add property" and "Clear property" the element buffer does `element.update`.
    covers: ["element.update"],
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.save();
    },
  },
  {
    id: "edit",
    title: "Edit text",
    description: "Start editing the text of the shown element.",
    hint: "Enter",
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.edit();
    },
  },
  {
    // ThomasBirkmaier/ReqSeq-archive#621: the title is edited in its heading, like the text in the editor (SR-073 AK2: found by its name).
    id: "edit-title",
    title: "Edit title",
    description: "Start editing the title of the shown element.",
    hint: "Enter on the title",
    available: (context: ActionContext): boolean => context.element?.editTitle !== undefined,
    run: (context: ActionContext): void => {
      context.element?.editTitle?.();
    },
  },
  {
    id: "follow-reference",
    title: "Follow reference",
    description: "Open the element that the reference at the cursor points to.",
    shortcut: { mod: true, shift: false, key: "enter" },
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.follow();
    },
  },
  {
    // SR-132: shown on every element, whatever core answers about its values (it always has a type).
    id: "list-value",
    title: "List elements with this value",
    description: "Open the list of all elements that have the value at the cursor.",
    runs: [{ where: "in the list", command: "element.list" }],
    shortcut: LIST_VALUE_SHORTCUT,
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.listValue();
    },
  },
  {
    id: "copy-field",
    title: "Copy field",
    description: "Copy the value of the field at the cursor to the clipboard.",
    shortcut: { mod: true, shift: true, key: "c" },
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.copy();
    },
  },
  {
    // SR-205 AK4: the reference for a test name of the acceptance criterion with the cursor.
    id: "copy-criterion-reference",
    title: "Copy criterion reference",
    description: "Copy the test name tag of the acceptance criterion at the cursor.",
    available: (context: ActionContext): boolean =>
      hasElementText(context) && context.element?.onCriterion?.(context.pressed) === true,
    run: (context: ActionContext): void => {
      context.element?.copyCriterionReference?.(context.pressed);
    },
  },
  {
    // The whole output of the shown result buffer as one block, whichever command gave it.
    id: "copy-result",
    title: "Copy result",
    description: "Copy the whole output of the shown command to the clipboard.",
    available: (context: ActionContext): boolean => shownResult(context) !== undefined,
    run: (context: ActionContext): void => {
      const result = shownResult(context);
      if (result !== undefined) {
        context.copy?.("result", resultText(linesOf(result)));
      }
    },
  },
  {
    id: "add-property",
    title: "Add property",
    description: "Add one of the properties of its type to the shown element.",
    shortcut: ADD_PROPERTY_SHORTCUT,
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.addProperty();
    },
  },
  {
    // SR-106 AK2: no shortcut (Enter on a block "On disk" asks too).
    id: "resolve-change",
    title: "Resolve change on disk",
    description: "Choose what happens to a change made outside the app to the file of the shown element.",
    available: (context: ActionContext): boolean => context.element?.resolve !== undefined,
    run: (context: ActionContext): void => {
      context.element?.resolve?.();
    },
  },
  {
    id: "clear-property",
    title: "Clear property",
    description: "Clear the value of a property of the shown element.",
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.clearProperty();
    },
  },
  {
    // SR-097: the catalog command "Add attachment" with the shown element, its Markdown put into the text.
    id: "insert-image",
    title: "Insert image",
    covers: ["element.addAttachment"],
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.insertImage();
    },
  },
  // The actions that edit the text at its cursor (D-073), each in its module (`text-actions.ts`).
  ...TEXT_ACTIONS,
  // Find and replace in the text (SR-189, `find-actions.ts`).
  ...FIND_ACTIONS,
  // The actions on the headings of the text (SR-191, `heading-actions.ts`).
  ...HEADING_ACTIONS,
  {
    id: "version",
    title: "Show element ID and version",
    description: "Show the ID of the shown element, the date of its version and its file.",
    available: isElement,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "element") {
        void context
          .call("element.get", { ref: current.id, repository: current.repository, versionDate: true })
          .then((answer) => {
            context.echo(answer.ok ? versionLine(answer.output.element) : answer.message);
          });
      }
    },
  },
  {
    id: "neighbourhood",
    title: "Show neighbourhood",
    shortcut: NEIGHBOURHOOD_SHORTCUT,
    available: isElement,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "element") {
        showBuffer(context, neighbourhoodBuffer(current.id, current.repository, current.name));
      }
    },
  },
  {
    id: "neighbourhood-back",
    title: "Show element",
    description: "Show the element of the shown neighbourhood again.",
    shortcut: NEIGHBOURHOOD_SHORTCUT,
    available: isNeighbourhood,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "neighbourhood") {
        showBuffer(context, elementBuffer(current.id, current.repository, current.name));
      }
    },
  },
  {
    // The title of `trace.graph` in the catalog; it covers that command, so the command prompt lists it
    // once and its output opens the graph buffer, never a result buffer (ADR-0002).
    id: "graph",
    title: "Show graph",
    shortcut: GRAPH_SHORTCUT,
    covers: ["trace.graph"],
    available: (context: ActionContext): boolean => isElement(context) || isNeighbourhood(context),
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "element" || current?.kind === "neighbourhood") {
        showBuffer(context, graphBuffer(current.id, current.repository, current.name));
      }
    },
  },
  {
    id: "graph-back",
    title: "Show element",
    description: "Show the element of the shown graph again.",
    shortcut: GRAPH_SHORTCUT,
    available: isGraph,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "graph") {
        showBuffer(context, elementBuffer(current.id, current.repository, current.name));
      }
    },
  },
  {
    // SR-111 AK2: the same as `+` and `-` on the graph, which the hint names.
    id: "graph-depth",
    title: "Graph depth",
    description: "Set how many levels the shown graph follows.",
    runs: GRAPH_RUNS,
    hint: DEPTH_KEYS,
    available: isGraph,
    run: graphPrompt("Graph depth", (graph) => depthChoices(graph)),
  },
  {
    // SR-111 AK3: one kind, a meaning or everything in place of the filter.
    id: "graph-only",
    title: "Show only relation kind",
    description: "Let the shown graph follow only one relation kind.",
    runs: GRAPH_RUNS,
    available: isGraph,
    run: graphPrompt("Show only", onlyChoices),
  },
  {
    // SR-111 AK3: one more kind or meaning while the graph follows some kinds only, or the evidence
    // while it is not shown.
    id: "graph-also",
    title: "Also show relation kind",
    description: "Let the shown graph follow one more relation kind.",
    runs: GRAPH_RUNS,
    available: (context: ActionContext): boolean => {
      const shown = context.buffers[0];
      return (
        shown?.kind === "graph" &&
        (hasFilter(shown) || alsoChoices(shown, context.graphChoices ?? [EVERYTHING]).length > 0)
      );
    },
    run: graphPrompt("Also show", alsoChoices, "Every relation kind is shown already."),
  },
  {
    // SR-130 AK1: the title of `metamodel.get` in the catalog; it covers that command, so the command
    // prompt lists it once (initials "sm") and its output opens the metamodel buffer as a graph, never a
    // result buffer. No key of its own (keys are scarce, Ctrl/Cmd+K is the prefix key, ThomasBirkmaier/ReqSeq-archive#472). Not
    // offered on the metamodel itself (SR-133): there the toggle switches between graph and text, so on
    // the text "sm" finds "Show metamodel as graph" only with more letters (review N2). An open metamodel
    // buffer is shown as a graph and keeps its selection.
    id: "metamodel",
    title: "Show metamodel",
    covers: ["metamodel.get"],
    available: (context: ActionContext): boolean =>
      hasWorkspace(context) && context.buffers[0]?.kind !== "metamodel",
    run: (context: ActionContext): void => {
      const open = context.buffers.find((buffer) => buffer.kind === "metamodel");
      context.dispatch({
        type: "open",
        buffer: open === undefined ? metamodelBuffer() : { ...open, mode: "graph" },
      });
    },
  },
  {
    // SR-151 AK5: only on the graph of an element or of the metamodel, with the graph's own depth, kinds and
    // view; the text is core's (`trace.mermaid`, `metamodel.mermaid`), and the modeline confirms the copy
    // (SR-128 AK2). It covers both commands, so the command prompt offers no other entry for them.
    id: "copy-mermaid",
    title: "Copy graph as Mermaid",
    description: "Copy the shown graph of an element or of the metamodel as a Mermaid flowchart.",
    runs: [
      { where: "in the graph of an element", command: "trace.mermaid" },
      { where: "in the graph of the metamodel", command: "metamodel.mermaid" },
    ],
    covers: ["trace.mermaid", "metamodel.mermaid"],
    available: (context: ActionContext): boolean =>
      isGraph(context) || metamodelIn(context, "graph") !== undefined,
    run: (context: ActionContext): void => {
      const shown = context.buffers[0];
      const call = context.shownCall ?? context.call;
      void (
        shown?.kind === "graph" ? call("trace.mermaid", mermaidInput(shown)) : call("metamodel.mermaid", {})
      ).then((answer) => {
        if (answer.ok) {
          context.copy?.("graph as Mermaid", answer.output.mermaid);
        } else {
          context.echo(answer.message);
        }
      });
    },
  },
  {
    // SR-130 AK4: Ctrl/Cmd+T switches the shown metamodel between graph and text; the selected type stays.
    id: "metamodel-text",
    title: "Show metamodel as text",
    description: "Show the metamodel as text in place of the graph.",
    shortcut: METAMODEL_SHORTCUT,
    available: (context: ActionContext): boolean => metamodelIn(context, "graph") !== undefined,
    run: switchMetamodel("graph", "text"),
  },
  {
    id: "metamodel-graph",
    title: "Show metamodel as graph",
    description: "Show the metamodel as a graph in place of the text.",
    shortcut: METAMODEL_SHORTCUT,
    available: (context: ActionContext): boolean => metamodelIn(context, "text") !== undefined,
    run: switchMetamodel("text", "graph"),
  },
  {
    id: "choose-view",
    title: "Choose view",
    description: "Choose the view the app shows: the view of the core or of a variant.",
    available: (context: ActionContext): boolean => context.workspace && context.views !== undefined,
    run: (context: ActionContext): void => {
      const { views } = context;
      if (views !== undefined) {
        context.ask(viewPrompt(context, views));
      }
    },
  },
  {
    id: "toggle-dark-mode",
    title: "Toggle dark mode",
    description: "Switch between light and dark mode until the app quits.",
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      const scheme = context.theme.toggle();
      context.echo(scheme === "dark" ? "Dark mode until the app quits" : "Light mode until the app quits");
    },
  },
  {
    // Also without an open workspace: then it is the one action of the command prompt (SR-131).
    id: "open-workspace",
    title: OPEN_WORKSPACE_ACTION,
    description: "Open a workspace opened before, or the one in a typed folder.",
    available: (context: ActionContext): boolean => context.workspaces !== undefined,
    run: (context: ActionContext): void => {
      const { workspaces } = context;
      if (workspaces !== undefined) {
        context.ask(workspacePrompt({ workspaces, echo: context.echo }));
      }
    },
  },
  {
    // Also without a workspace: the documentation helps most before one is open (SR-141).
    id: "open-documentation",
    title: "Open documentation",
    description: "Open the documentation of ReqSeq in the browser.",
    available: (context: ActionContext): boolean => context.docs !== undefined,
    run: (context: ActionContext): void => {
      context.docs?.();
    },
  },
  {
    id: "follow-system-theme",
    title: "Follow system light or dark mode",
    description: "Follow the computer's light or dark setting again.",
    available: (context: ActionContext): boolean => context.workspace && context.theme.chosen(),
    run: (context: ActionContext): void => {
      context.theme.follow();
      context.echo("Light or dark as the system says");
    },
  },
  {
    id: "fold-status",
    title: "Fold status in lists",
    description:
      "Choose a status whose elements fold to the end of every list, or whose folded elements go back to their place.",
    available: (context: ActionContext): boolean => context.workspace && context.folds !== undefined,
    run: (context: ActionContext): void => {
      const { folds } = context;
      if (folds !== undefined) {
        context.ask(foldPrompt(context, folds));
      }
    },
  },
  {
    // Offered only after a choice, as "Follow system light or dark mode".
    id: "fold-invalid-statuses",
    title: "Fold invalid statuses in lists",
    description: "Fold the elements in invalid statuses to the end of every list again.",
    available: (context: ActionContext): boolean => context.workspace && context.folds?.choice !== undefined,
    run: (context: ActionContext): void => {
      context.folds?.choose(undefined);
      context.echo("Invalid statuses fold in lists");
    },
  },
  {
    id: "follow-agent",
    title: "Follow agent",
    description: "Show each element when it is read or changed through the API or MCP.",
    shortcut: FOLLOW_SHORTCUT,
    available: (context: ActionContext): boolean => context.workspace && context.follow?.on === false,
    run: (context: ActionContext): void => {
      context.follow?.start();
    },
  },
  {
    id: "stop-following-agent",
    title: "Stop following agent",
    description: "Stop showing the elements read or changed through the API or MCP.",
    shortcut: FOLLOW_SHORTCUT,
    available: (context: ActionContext): boolean => context.workspace && context.follow?.on === true,
    run: (context: ActionContext): void => {
      context.follow?.stop();
    },
  },
  // The actions on the element of an entry (SR-197, `entry-menu.ts`): last, so a catalog command with the
  // same title is covered by the action on the shown element, whose key it shows (`coveringAction`).
  ...ENTRY_ACTIONS,
];

/**
 * The context of one run of an action: Escape in each prompt it asks goes back to the prompt it asked before
 * (`previous`, SR-134 AK1), in the first one to `first` (the command prompt the action was chosen in); without
 * `first` the first one closes (AK2). A prompt with its own `back` (catalog commands) is left as it is, and so
 * is one that steps through hits, which Escape ends (`step`, SR-189 AK1).
 */
const steppedContext = (context: ActionContext, first?: () => void): ActionContext => {
  let shown: Prompt | undefined;
  const ask = (prompt: Prompt): void => {
    const before = shown;
    const previous =
      before === undefined
        ? first
        : (): void => {
            shown = before;
            context.ask(before);
          };
    const next =
      previous === undefined || prompt.back !== undefined || prompt.step !== undefined
        ? prompt
        : { ...prompt, previous };
    shown = next;
    context.ask(next);
  };
  return { ...context, ask };
};

/**
 * Runs an action. Any action but "Close buffer" ends a question that closing asked. `first`: the action was
 * chosen in the command prompt, and Escape in its first prompt opens that again (SR-134 AK1).
 */
export const runAction = (action: Action, context: ActionContext, first?: () => void): void => {
  if (action.id !== "close") {
    context.armClose(undefined);
  }
  action.run(steppedContext(context, first));
};

/**
 * The hint of a prompt entry: the shortcut, else its letter after the prefix key ("Ctrl+K L", SR-121
 * AK3), else the key that works in the buffer.
 */
const hintOf = (action: Action, mac: boolean): { readonly hint?: string } => {
  const shown = action.shortcut ?? action.systemKey;
  const hint =
    shown === undefined ? (bindingLabel(action.id, mac) ?? action.hint) : shortcutLabel(shown, mac);
  return hint === undefined ? {} : { hint };
};

/**
 * The command prompt: the actions that apply now, with their shortcuts, then `commands` (the catalog's,
 * `catalog-commands.ts`), ordered by `use` (SR-108 AK3, SR-121 AK2). An action is shown only where it
 * applies, so each one fits the view (SR-133 AK1).
 */
export const commandPrompt = (
  context: ActionContext,
  use?: PromptUse,
  commands: readonly Choice[] = [],
  reopen?: () => void,
): Prompt => ({
  label: "Command",
  ...(use === undefined ? {} : { use }),
  items: [
    ...ACTIONS.filter((action) => action.available(context)).map((action) => ({
      id: action.id,
      name: action.title,
      ...hintOf(action, context.mac),
      fits: true,
      run: () => {
        runAction(action, context, reopen);
      },
    })),
    ...commands,
  ],
});

/**
 * The action with a shortcut that `pressed` accepts, when it applies now. While a prompt is open (`prompting`),
 * only one that opens a prompt of its own (`inPrompt`).
 */
export const actionFor = (
  context: ActionContext,
  pressed: (shortcut: Shortcut) => boolean,
  prompting = false,
): Action | undefined =>
  ACTIONS.find(
    (action) =>
      action.shortcut !== undefined &&
      (!prompting || action.inPrompt === true) &&
      pressed(action.shortcut) &&
      action.available(context),
  );
