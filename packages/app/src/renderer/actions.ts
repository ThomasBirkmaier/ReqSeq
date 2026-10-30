// The app's own actions, which the command prompt (Ctrl/Cmd+Shift+P) lists by name and runs, and the
// prompts they open. Only what applies to the shown buffer is offered. Every datum comes from a catalog
// command, shown as it is (ADR-0002); filter and sort only build the input of `element.list`. Each filter
// is a step that narrows the list the one before gave (SR-124 AK1, `list-filters.ts`): the conditions are
// ANDed in the selection; the values of "Filter list by property" come from `element.facets`.
//
// The prompt finds the app's actions and the catalog's read commands (`catalog-commands.ts`, #85); an
// action that does what a command does covers it, so the prompt lists it once.
import type { DataExportElement, ElementSelection, FilterSortKeyWithDefaults } from "@reqseq/core";
import type {
  Buffer,
  BufferAction,
  Buffers,
  ElementBuffer,
  FilterStep,
  GraphBuffer,
  ListBuffer,
  MetamodelBuffer,
} from "./buffers.js";
import {
  DEFAULT_SORT,
  bufferName,
  elementBuffer,
  filteredList,
  graphBuffer,
  listBuffer,
  metamodelBuffer,
  neighbourhoodBuffer,
  onlyOverview,
  overviewBuffer,
  searchBuffer,
  withMatrix,
} from "./buffers.js";
import type { Answer, Call } from "./call.js";
import { bindingLabel } from "./bindings.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import type { Shortcut } from "./keys.js";
import { shortcutLabel } from "./keys.js";
import type { GraphChoice, GraphFilterChoice } from "./graph-choices.js";
import {
  DEPTH_KEYS,
  EVERYTHING,
  alsoChoices,
  depthChoices,
  hasFilter,
  onlyChoices,
} from "./graph-choices.js";
import { cycleKey } from "./opening-order.js";
import {
  hasSavedFilter,
  propertyChoices,
  savedStep,
  statusStep,
  textStep,
  typeStep,
} from "./list-filters.js";
import { packageSelection } from "./package-page.js";
import { searchRows } from "./rows.js";
import type { Row } from "./rows.js";
import type { Theme } from "./theme.js";
import type { PromptUse } from "./usage.js";
import type { ShownView } from "./views.js";
import { viewName, viewsOf } from "./views.js";
import type { WorkspaceControls } from "./workspaces.js";
import { workspacePrompt } from "./workspaces.js";

/** One entry of a prompt: what is listed, and what Enter does. */
export interface Choice {
  readonly id: string;
  readonly name: string;
  /** Shown right-aligned in muted text: the shortcut, or a count (the values of a property). */
  readonly hint?: string;
  /** Lower case words of `name` to mark (element hits). */
  readonly terms?: readonly string[];
  readonly run: () => void;
  /** What Ctrl/Cmd+Enter does with it: take it and offer the optional arguments (catalog commands). */
  readonly more?: () => void;
  /** It fits the shown view (SR-133): it comes before the others when nothing is typed and among equal matches. */
  readonly fits?: boolean;
}

/** What the minibuffer asks for. */
export interface Prompt {
  readonly label: string;
  readonly items: readonly Choice[];
  /** More choices for the typed text, from core (the jump prompt finds elements). */
  readonly find?: (query: string) => Promise<readonly Choice[]>;
  /** Free text: Enter runs it (the search prompt). */
  readonly text?: (text: string) => void;
  /**
   * A choice for the typed text itself, when it is one ("Open workspace": a folder path, SR-131 AK5): it
   * comes first, so Enter takes it, and Down reaches the others.
   */
  readonly literal?: (query: string) => Choice | undefined;
  /** Escape ends the prompt without an answer (not called when a choice is run, nor when text is entered). */
  readonly cancel?: () => void;
  /** Backspace in an empty input: one argument back (catalog commands). */
  readonly back?: () => void;
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

/** The parts of a prompt that can come later. */
export type PromptFill = Partial<Pick<Prompt, "label" | "items" | "find" | "text" | "more">>;

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
   * "Edit title", #621). Given by the element buffer; a control without it offers no "Edit title".
   */
  readonly editTitle?: () => void;
  /** Opens the element of the inline reference at the cursor (the action "Follow reference", #424). */
  readonly follow: () => void;
  /** Copies the field with the cursor, else the ID (the action "Copy field", SR-128). */
  readonly copy: () => void;
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
}

export interface ActionContext {
  /** A workspace is open. */
  readonly workspace: boolean;
  /** The open workspace is read-only (`workspace.status`, as the modeline shows it); absent: it is not. */
  readonly readOnly?: boolean;
  /** The open buffers, the most recent first; the first one is shown. */
  readonly buffers: Buffers;
  /** The keys of the open buffers in the order of opening (`opening-order.ts`): "Next buffer" walks it. */
  readonly opened: readonly string[];
  /** Takes the focus out of a text editor that has it, so that the editor gets no more of the key. */
  readonly leaveEditor: () => void;
  readonly mac: boolean;
  /** Light and dark (SR-113). */
  readonly theme: Theme;
  readonly call: Call;
  readonly dispatch: (action: BufferAction) => void;
  readonly ask: (prompt: Prompt) => void;
  readonly echo: (message: string) => void;
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
  readonly shortcut?: Shortcut;
  /** Shown in the command prompt in place of a shortcut: a key that only works in the buffer ("Enter"). */
  readonly hint?: string;
  /** Catalog commands this action does, so the command prompt does not list them as well (#85). */
  readonly covers?: readonly string[];
  readonly available: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}

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

/** Ctrl/Cmd+T shows the list as a traceability matrix (SR-125), and the matrix as a list again. */
const MATRIX_SHORTCUT: Shortcut = { mod: true, shift: false, key: "t" };

/**
 * Ctrl/Cmd+T also shows the metamodel as text, and the text as a graph again (SR-130 AK4): the key that
 * switches the representation of the shown buffer. Never available together with the matrix actions.
 */
const METAMODEL_SHORTCUT: Shortcut = MATRIX_SHORTCUT;

/**
 * Ctrl/Cmd+Shift+Enter lists the elements with the value at the cursor (SR-132). Ctrl/Cmd+Enter stays
 * "Follow reference", which opens the target of a relation box and the reference of a Markdown box (#610).
 */
const LIST_VALUE_SHORTCUT: Shortcut = { mod: true, shift: true, key: "enter" };

/** The command prompt itself; it is not listed in itself. */
export const COMMAND_SHORTCUT: Shortcut = { mod: true, shift: true, key: "p" };

/**
 * Alt+N (Option+N on macOS) shows the next buffer in the order of opening, Alt+P the previous one (SR-115
 * AK5), also while typing in an editor. Alt alone: Ctrl/Cmd+N and Ctrl/Cmd+P are other keys (SR-122).
 */
export const NEXT_BUFFER_SHORTCUT: Shortcut = { mod: false, shift: false, alt: true, key: "n" };
export const PREVIOUS_BUFFER_SHORTCUT: Shortcut = { mod: false, shift: false, alt: true, key: "p" };

/**
 * Ctrl/Cmd+Shift+O turns the mode „Agent folgen“ on, and off again (SR-117 AK4). Not Shift+G: that is the
 * graph (SR-111); Ctrl/Cmd+G stays free for the keyboard-quit, Ctrl/Cmd+K is the prefix key
 * (`bindings.ts`, #472).
 */
export const FOLLOW_SHORTCUT: Shortcut = { mod: true, shift: true, key: "o" };

const currentList = (context: ActionContext): ListBuffer | undefined => {
  const current = context.buffers[0];
  return current?.kind === "list" ? current : undefined;
};

const isList = (context: ActionContext): boolean => currentList(context) !== undefined;
const isMatrix = (context: ActionContext): boolean => currentList(context)?.matrix === true;
const isFiltered = (context: ActionContext): boolean => (currentList(context)?.steps.length ?? 0) > 0;
const isChained = (context: ActionContext): boolean => (currentList(context)?.steps.length ?? 0) > 1;
const isElement = (context: ActionContext): boolean => context.buffers[0]?.kind === "element";
const isNeighbourhood = (context: ActionContext): boolean => context.buffers[0]?.kind === "neighbourhood";
const isGraph = (context: ActionContext): boolean => context.buffers[0]?.kind === "graph";
/** The shown element buffer when it is a package page (SR-112); its elements are a list that sorts like any list. */
const packagePage = (context: ActionContext): ElementBuffer | undefined => {
  const shown = context.buffers[0];
  return shown?.kind === "element" && context.element?.members === true ? shown : undefined;
};
const hasWorkspace = (context: ActionContext): boolean => context.workspace;
/** There is another buffer to switch to (SR-115 AK5: „mehrere geöffnete Buffer“). */
const hasOthers = (context: ActionContext): boolean => context.buffers.length > 1;
/** A buffer is open that can be closed: the lone overview cannot, it comes back (SR-118). */
const hasBuffers = (context: ActionContext): boolean =>
  context.buffers.length > 0 && !onlyOverview(context.buffers);
const isOverview = (context: ActionContext): boolean => context.buffers[0]?.kind === "overview";
const hasElementText = (context: ActionContext): boolean =>
  isElement(context) && context.element !== undefined;
/** An action on the shown list; without one it does nothing. */
const onList =
  (run: (context: ActionContext, list: ListBuffer) => void) =>
  (context: ActionContext): void => {
    const list = currentList(context);
    if (list !== undefined) {
      run(context, list);
    }
  };

/** Shows the buffer: the open one with its key (its text and rows kept), else `buffer`, a new one. */
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

const showBuffer = (context: ActionContext, buffer: Buffer): void => {
  context.dispatch(
    context.buffers.some((open) => open.key === buffer.key)
      ? { type: "switch", key: buffer.key }
      : { type: "open", buffer },
  );
};

const choice = (name: string, run: () => void): Choice => ({ id: name, name, run });

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

// "Type and ID" is the explicit default and "Workspace order" is `[]`, so a choice holds on a list with a
// saved filter too (it does not fall back to the sort of the filter). "ID" is what the rows show.
const SORTS: readonly (readonly [string, readonly FilterSortKeyWithDefaults[]])[] = [
  ["Type and ID", DEFAULT_SORT],
  ["Workspace order", []],
  ["ID ascending", [{ by: "identifier", order: "asc" }]],
  ["ID descending", [{ by: "identifier", order: "desc" }]],
  ["Title ascending", [{ by: "title", order: "asc" }]],
  ["Title descending", [{ by: "title", order: "desc" }]],
  ["Type ascending", [{ by: "type", order: "asc" }]],
  ["Type descending", [{ by: "type", order: "desc" }]],
  ["Status ascending", [{ by: "status", order: "asc" }]],
  ["Status descending", [{ by: "status", order: "desc" }]],
  ["Hierarchy (tree)", [{ by: "hierarchy", order: "asc" }]],
];

/** The choices of the prompt "Sort by"; `apply` gets the sort of the one that is taken. */
const sortChoices = (apply: (sort: readonly FilterSortKeyWithDefaults[]) => void): Choice[] =>
  SORTS.map(([name, sort]) =>
    choice(name, () => {
      apply(sort);
    }),
  );

/** What `findElements` takes besides what choosing a row does. */
export interface FindOptions {
  /** Limits the search, such as to the target types of a relation property (SR-104). */
  readonly selection?: ElementSelection;
  /** What Ctrl/Cmd+Enter on a row does (a catalog argument: take it and offer the optional arguments, #85). */
  readonly more?: (row: Row) => void;
}

/**
 * The elements `element.search` finds for the typed text, as the choices of a prompt; `run` is what
 * choosing one does. The prompts "Go to", "Insert reference" (SR-129), the one of a relation property
 * (SR-104) and an element argument of a catalog command (#85) find them the same way.
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
      name: `${row.label} ${row.title}`.trim(),
      terms: row.markLabel ? [...row.terms, row.label.toLowerCase()] : row.terms,
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
 * the typed text. The fuzzy ranking keeps this order among equal matches. The recent elements come with
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
    find: findElements(context, (row) => {
      context.dispatch({ type: "open", buffer: row.open });
    }),
  };
};

/** The prompt of the slash menu's "Reference to element" (SR-129): an element is picked, the editor writes the reference. */
export const referencePrompt = (context: ActionContext, request: ReferenceRequest): Prompt => ({
  label: "Insert reference",
  items: [],
  find: findElements(context, (row) => {
    request.insert({
      id: row.open.id,
      title: row.title,
      label: row.label,
      shortId: row.shortId,
      repository: row.open.repository,
    });
  }),
  cancel: request.cancel,
});

const searchPrompt = (context: ActionContext): Prompt => ({
  label: "Search",
  items: [],
  text: (text) => {
    const query = text.trim();
    if (query !== "") {
      context.dispatch({ type: "open", buffer: searchBuffer(query) });
    }
  },
});

/** The names a filter can be chosen from, or why there are none. */
type Names =
  { readonly ok: true; readonly names: readonly string[] } | { readonly ok: false; readonly message: string };

interface FilterBy {
  readonly id: string;
  readonly title: string;
  /** The label of the prompt. */
  readonly label: string;
  readonly nothing: string;
  /** Without it, whenever a list is shown. */
  readonly available?: (context: ActionContext) => boolean;
  readonly names: (call: Call, list: ListBuffer) => Promise<Names>;
  readonly step: (name: string) => FilterStep;
}

/** The list the steps of `list` give with one more, which keeps the sort. */
const addStep = (context: ActionContext, list: ListBuffer, step: FilterStep): void => {
  context.dispatch({
    type: "open",
    buffer: filteredList([...list.steps, step], list.sort, list.matrix === true),
  });
};

const filterBy = (by: FilterBy): Action => ({
  id: by.id,
  title: by.title,
  available: by.available ?? isList,
  run: onList((context, list) => {
    void by.names(context.call, list).then((found) => {
      if (!found.ok) {
        context.echo(found.message);
      } else if (found.names.length === 0) {
        context.echo(by.nothing);
      } else {
        context.ask({
          label: by.label,
          items: found.names.map((name) =>
            choice(name, () => {
              addStep(context, list, by.step(name));
            }),
          ),
        });
      }
    });
  }),
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
 * Shows the buffer after (`step` 1) or before (-1) the shown one in the order of opening, wrapping
 * (SR-115 AK5); none when the shown one is not in the order.
 *
 * In a text editor the key must insert no character. The window's listener prevents the key, so the
 * editor gets no keydown. On macOS, Option+N is a dead key ("~"), and Chromium hands it to the input
 * method before the page sees the keydown, whether or not it is prevented. What keeps the "~" out: the
 * focus leaves the editor first, synchronously in the keydown (`leaveEditor`), and the switch then
 * unmounts the editor: React shows the other buffer in a microtask after the listener, the App's focus
 * effect moves the focus to the new buffer, which cannot be edited, and a composition aimed at a focus
 * that is no text input inserts nothing. Leaving the editor first also covers a later case where the
 * editor stays shown (a split window, SR-115 AK3).
 */
const cycleBuffer = (context: ActionContext, step: 1 | -1): void => {
  const key = cycleKey(context.opened, context.buffers[0]?.key, step);
  if (key !== undefined) {
    context.leaveEditor();
    context.dispatch({ type: "switch", key });
  }
};

/** The facets of the shown list: what its elements have, from the core (`element.facets`). */
const facetsOf = (call: Call, list: ListBuffer): Promise<Answer<"element.facets">> =>
  call("element.facets", list.selection === undefined ? {} : { selection: list.selection });

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
    covers: ["element.get"],
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      context.ask(jumpPrompt(context));
    },
  },
  {
    id: "overview",
    title: "Show overview",
    available: (context) => hasWorkspace(context) && !isOverview(context),
    run: (context: ActionContext): void => {
      context.dispatch({ type: "open", buffer: overviewBuffer() });
    },
  },
  {
    id: "search",
    title: "Search elements",
    shortcut: { mod: true, shift: true, key: "f" },
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      context.ask(searchPrompt(context));
    },
  },
  {
    id: "list-all",
    title: "List all elements",
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      context.dispatch({
        type: "open",
        buffer: listBuffer("All elements", undefined, currentList(context)?.sort),
      });
    },
  },
  filterBy({
    id: "filter-type",
    title: "Filter list by type",
    label: "Type",
    nothing: "The metamodel has no types.",
    names: async (call: Call): Promise<Names> => {
      const answer = await call("metamodel.get", {});
      return answer.ok ? { ok: true, names: answer.output.types.map((type) => type.key) } : answer;
    },
    step: typeStep,
  }),
  filterBy({
    id: "filter-status",
    title: "Filter list by status",
    label: "Status",
    nothing: "The elements of this list have no status.",
    names: async (call: Call, list: ListBuffer): Promise<Names> => {
      const answer = await facetsOf(call, list);
      return answer.ok ? { ok: true, names: answer.output.statuses.map((status) => status.key) } : answer;
    },
    step: statusStep,
  }),
  {
    id: "filter-property",
    title: "Filter list by property",
    available: isList,
    run: onList((context, list) => {
      void facetsOf(context.call, list).then((answer) => {
        if (!answer.ok) {
          context.echo(answer.message);
          return;
        }
        const items = propertyChoices(
          answer.output,
          (step) => {
            addStep(context, list, step);
          },
          context.ask,
        );
        if (items.length === 0) {
          context.echo("No property of the elements in this list has values to choose from.");
        } else {
          context.ask({ label: "Property", items });
        }
      });
    }),
  },
  {
    id: "filter-text",
    title: "Filter list by text search",
    available: isList,
    run: onList((context, list) => {
      context.ask({
        label: "Text",
        items: [],
        text: (text) => {
          const query = text.trim();
          if (query !== "") {
            addStep(context, list, textStep(query));
          }
        },
      });
    }),
  },
  filterBy({
    id: "filter-saved",
    title: "Filter list by saved filter",
    label: "Filter",
    nothing: "The workspace has no saved filters.",
    available: (context) => {
      const list = currentList(context);
      return list !== undefined && !hasSavedFilter(list.steps);
    },
    names: async (call: Call): Promise<Names> => {
      const answer = await call("filter.list", {});
      return answer.ok ? { ok: true, names: answer.output.filters.map((filter) => filter.name) } : answer;
    },
    step: savedStep,
  }),
  {
    id: "clear-filter",
    title: "Clear list filter",
    available: isFiltered,
    run: onList((context, list) => {
      context.dispatch({
        type: "open",
        buffer: filteredList(list.steps.slice(0, -1), list.sort, list.matrix === true),
      });
    }),
  },
  {
    id: "clear-filters",
    title: "Clear all list filters",
    available: isChained,
    run: onList((context, list) => {
      context.dispatch({ type: "open", buffer: filteredList([], list.sort, list.matrix === true) });
    }),
  },
  {
    id: "sort",
    title: "Sort list",
    available: (context: ActionContext): boolean => isList(context) || packagePage(context) !== undefined,
    run: (context: ActionContext): void => {
      const list = currentList(context);
      const page = packagePage(context);
      let apply: ((sort: readonly FilterSortKeyWithDefaults[]) => void) | undefined;
      if (list !== undefined) {
        apply = (sort) => {
          context.dispatch({ type: "open", buffer: filteredList(list.steps, sort, list.matrix === true) });
        };
      } else if (page !== undefined) {
        // The package page stays the element buffer (editor and draft included): the same key replaces it.
        apply = (sort) => {
          context.dispatch({ type: "open", buffer: { ...page, memberSort: sort, memberCursor: 0 } });
        };
      }
      if (apply !== undefined) {
        context.ask({ label: "Sort by", items: sortChoices(apply) });
      }
    },
  },
  {
    id: "matrix",
    title: "Show traceability matrix",
    shortcut: MATRIX_SHORTCUT,
    available: (context: ActionContext): boolean =>
      (isList(context) && !isMatrix(context)) || packagePage(context) !== undefined,
    run: (context: ActionContext): void => {
      const list = currentList(context);
      const page = packagePage(context);
      if (list !== undefined) {
        context.dispatch({ type: "open", buffer: withMatrix(list, true) });
      } else if (page !== undefined) {
        // The members of the package as a list in matrix mode, in the sort of the page, as its list shows them.
        const step = { label: `package: ${page.name}`, selection: packageSelection(page.id) };
        context.dispatch({ type: "open", buffer: filteredList([step], page.memberSort, true) });
      }
    },
  },
  {
    id: "matrix-list",
    title: "Show as list",
    shortcut: MATRIX_SHORTCUT,
    available: isMatrix,
    run: onList((context, list) => {
      context.dispatch({ type: "open", buffer: withMatrix(list, false) });
    }),
  },
  {
    id: "close",
    title: "Close buffer",
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
  { id: "close-all", title: "Close all buffers", available: hasBuffers, run: closeAll },
  {
    id: "next-buffer",
    title: "Next buffer",
    shortcut: NEXT_BUFFER_SHORTCUT,
    available: hasOthers,
    run: (context: ActionContext): void => {
      cycleBuffer(context, 1);
    },
  },
  {
    id: "previous-buffer",
    title: "Previous buffer",
    shortcut: PREVIOUS_BUFFER_SHORTCUT,
    available: hasOthers,
    run: (context: ActionContext): void => {
      cycleBuffer(context, -1);
    },
  },
  // SR-115 AK3: two buffers side by side. Commands of the prompt only, no keys (#472).
  {
    id: "split-window",
    title: "Split window",
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
    available: (context: ActionContext): boolean => context.layout?.other !== undefined,
    run: (context: ActionContext): void => {
      const other = context.layout?.other;
      if (other !== undefined) {
        context.dispatch({ type: "switch", key: other });
      }
    },
  },
  {
    id: "unsplit-window",
    title: "Unsplit window",
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
    hint: "Enter",
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.edit();
    },
  },
  {
    // #621: the title is edited in its heading, like the text in the editor (SR-073 AK2: found by its name).
    id: "edit-title",
    title: "Edit title",
    hint: "Enter on the title",
    available: (context: ActionContext): boolean => context.element?.editTitle !== undefined,
    run: (context: ActionContext): void => {
      context.element?.editTitle?.();
    },
  },
  {
    id: "follow-reference",
    title: "Follow reference",
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
    shortcut: LIST_VALUE_SHORTCUT,
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.listValue();
    },
  },
  {
    id: "copy-field",
    title: "Copy field",
    shortcut: { mod: true, shift: true, key: "c" },
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.copy();
    },
  },
  {
    id: "add-property",
    title: "Add property",
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
    available: (context: ActionContext): boolean => context.element?.resolve !== undefined,
    run: (context: ActionContext): void => {
      context.element?.resolve?.();
    },
  },
  {
    id: "clear-property",
    title: "Clear property",
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
  {
    id: "version",
    title: "Show element ID and version",
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
    hint: DEPTH_KEYS,
    available: isGraph,
    run: graphPrompt("Graph depth", (graph) => depthChoices(graph)),
  },
  {
    // SR-111 AK3: one kind, a meaning or everything in place of the filter.
    id: "graph-only",
    title: "Show only relation kind",
    available: isGraph,
    run: graphPrompt("Show only", onlyChoices),
  },
  {
    // SR-111 AK3: one more kind or meaning; only while the graph follows some kinds only.
    id: "graph-also",
    title: "Also show relation kind",
    available: (context: ActionContext): boolean => {
      const shown = context.buffers[0];
      return shown?.kind === "graph" && hasFilter(shown);
    },
    run: graphPrompt("Also show", alsoChoices, "Every relation kind is shown already."),
  },
  {
    // SR-130 AK1: the title of `metamodel.get` in the catalog; it covers that command, so the command
    // prompt lists it once (initials "sm") and its output opens the metamodel buffer as a graph, never a
    // result buffer. No key of its own (keys are scarce, Ctrl/Cmd+K is the prefix key, #472). Not
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
    // SR-130 AK4: Ctrl/Cmd+T switches the shown metamodel between graph and text; the selected type stays.
    id: "metamodel-text",
    title: "Show metamodel as text",
    shortcut: METAMODEL_SHORTCUT,
    available: (context: ActionContext): boolean => metamodelIn(context, "graph") !== undefined,
    run: switchMetamodel("graph", "text"),
  },
  {
    id: "metamodel-graph",
    title: "Show metamodel as graph",
    shortcut: METAMODEL_SHORTCUT,
    available: (context: ActionContext): boolean => metamodelIn(context, "text") !== undefined,
    run: switchMetamodel("text", "graph"),
  },
  {
    id: "choose-view",
    title: "Choose view",
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
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      const scheme = context.theme.toggle();
      context.echo(scheme === "dark" ? "Dark mode until the app quits" : "Light mode until the app quits");
    },
  },
  {
    // Also without an open workspace: then it is the one action of the command prompt (SR-131).
    id: "open-workspace",
    title: "Open workspace",
    available: (context: ActionContext): boolean => context.workspaces !== undefined,
    run: (context: ActionContext): void => {
      const { workspaces } = context;
      if (workspaces !== undefined) {
        context.ask(workspacePrompt({ workspaces, echo: context.echo }));
      }
    },
  },
  {
    id: "follow-system-theme",
    title: "Follow system light or dark mode",
    available: (context: ActionContext): boolean => context.workspace && context.theme.chosen(),
    run: (context: ActionContext): void => {
      context.theme.follow();
      context.echo("Light or dark as the system says");
    },
  },
  {
    id: "follow-agent",
    title: "Follow agent",
    shortcut: FOLLOW_SHORTCUT,
    available: (context: ActionContext): boolean => context.workspace && context.follow?.on === false,
    run: (context: ActionContext): void => {
      context.follow?.start();
    },
  },
  {
    id: "stop-following-agent",
    title: "Stop following agent",
    shortcut: FOLLOW_SHORTCUT,
    available: (context: ActionContext): boolean => context.workspace && context.follow?.on === true,
    run: (context: ActionContext): void => {
      context.follow?.stop();
    },
  },
];

/** Runs an action. Any action but "Close buffer" ends a question that closing asked. */
export const runAction = (action: Action, context: ActionContext): void => {
  if (action.id !== "close") {
    context.armClose(undefined);
  }
  action.run(context);
};

/**
 * The hint of a prompt entry: the shortcut, else its letter after the prefix key ("Ctrl+K L", SR-121
 * AK3), else the key that works in the buffer.
 */
const hintOf = (action: Action, mac: boolean): { readonly hint?: string } => {
  const hint =
    action.shortcut === undefined
      ? (bindingLabel(action.id, mac) ?? action.hint)
      : shortcutLabel(action.shortcut, mac);
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
        runAction(action, context);
      },
    })),
    ...commands,
  ],
});

/** The action with a shortcut that `pressed` accepts, when it applies now. */
export const actionFor = (
  context: ActionContext,
  pressed: (shortcut: Shortcut) => boolean,
): Action | undefined =>
  ACTIONS.find(
    (action) => action.shortcut !== undefined && pressed(action.shortcut) && action.available(context),
  );
