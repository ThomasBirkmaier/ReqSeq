// The app's own actions, which the command prompt (Ctrl/Cmd+Shift+P) lists by name and runs, and the
// prompts they open. Only what applies to the shown buffer is offered. Every datum comes from a catalog
// command, shown as it is (ADR-0002); filter and sort only build the input of `element.list`. Each filter
// is a step that narrows the list the one before gave (SR-124 AK1, `list-filters.ts`): the conditions are
// ANDed in the selection; the values of "Filter list by property" come from `element.facets`.
//
// The prompt finds the app's actions. Catalog commands come with #85: they need arguments, so they wait
// for argument entry.
import type { DataExportElement, FilterSortKeyWithDefaults } from "@logreq/core";
import type { Buffer, BufferAction, Buffers, ElementBuffer, FilterStep, ListBuffer } from "./buffers.js";
import {
  DEFAULT_SORT,
  bufferName,
  elementBuffer,
  filteredList,
  listBuffer,
  neighbourhoodBuffer,
  onlyOverview,
  overviewBuffer,
  searchBuffer,
} from "./buffers.js";
import type { Answer, Call } from "./call.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import type { Shortcut } from "./keys.js";
import { shortcutLabel } from "./keys.js";
import {
  hasSavedFilter,
  propertyChoices,
  savedStep,
  statusStep,
  textStep,
  typeStep,
} from "./list-filters.js";
import { searchRows } from "./rows.js";
import type { Row } from "./rows.js";
import type { Theme } from "./theme.js";

/** One entry of a prompt: what is listed, and what Enter does. */
export interface Choice {
  readonly id: string;
  readonly name: string;
  /** Shown right-aligned in muted text: the shortcut, or a count (the values of a property). */
  readonly hint?: string;
  /** Lower case words of `name` to mark (element hits). */
  readonly terms?: readonly string[];
  readonly run: () => void;
}

/** What the minibuffer asks for. */
export interface Prompt {
  readonly label: string;
  readonly items: readonly Choice[];
  /** More choices for the typed text, from core (the jump prompt finds elements). */
  readonly find?: (query: string) => Promise<readonly Choice[]>;
  /** Free text: Enter runs it (the search prompt). */
  readonly text?: (text: string) => void;
  /** Escape ends the prompt without an answer (not called when a choice is run, nor when text is entered). */
  readonly cancel?: () => void;
}

/** What the shown element buffer lets the app do with its text (SR-065). */
export interface ElementControls {
  /** Saves the text with `element.update` (the action "Save element"). */
  readonly save: () => void;
  /** Gives the text editor the focus (the action "Edit text"). */
  readonly edit: () => void;
  /** Opens the element of the inline reference at the cursor (the action "Follow reference", #424). */
  readonly follow: () => void;
  /** Copies the field with the cursor, else the ID (the action "Copy field", SR-128). */
  readonly copy: () => void;
  /** The shown element is a package: its page lists the elements that name it, and "Sort list" sorts them (SR-112). */
  readonly members?: boolean;
}

export interface ActionContext {
  /** A workspace is open. */
  readonly workspace: boolean;
  /** The open buffers, the most recent first; the first one is shown. */
  readonly buffers: Buffers;
  readonly mac: boolean;
  /** Light and dark (SR-113). */
  readonly theme: Theme;
  readonly call: Call;
  readonly dispatch: (action: BufferAction) => void;
  readonly ask: (prompt: Prompt) => void;
  readonly echo: (message: string) => void;
  /** The shown element buffer, when it has loaded. */
  readonly element?: ElementControls;
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
}

export interface Action {
  readonly id: string;
  readonly title: string;
  readonly shortcut?: Shortcut;
  /** Shown in the command prompt in place of a shortcut: a key that only works in the buffer ("Enter"). */
  readonly hint?: string;
  readonly available: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}

/** Ctrl/Cmd+S saves the text of the shown element. */
const SAVE_SHORTCUT: Shortcut = { mod: true, shift: false, key: "s" };

/** Ctrl/Cmd+J shows the neighbourhood of the shown element (SR-107), and on the neighbourhood the element again. */
const NEIGHBOURHOOD_SHORTCUT: Shortcut = { mod: true, shift: false, key: "j" };

/** The command prompt itself; it is not listed in itself. */
export const COMMAND_SHORTCUT: Shortcut = { mod: true, shift: true, key: "p" };

const currentList = (context: ActionContext): ListBuffer | undefined => {
  const current = context.buffers[0];
  return current?.kind === "list" ? current : undefined;
};

const isList = (context: ActionContext): boolean => currentList(context) !== undefined;
const isFiltered = (context: ActionContext): boolean => (currentList(context)?.steps.length ?? 0) > 0;
const isChained = (context: ActionContext): boolean => (currentList(context)?.steps.length ?? 0) > 1;
const isElement = (context: ActionContext): boolean => context.buffers[0]?.kind === "element";
const isNeighbourhood = (context: ActionContext): boolean => context.buffers[0]?.kind === "neighbourhood";
/** The shown element buffer when it is a package page (SR-112); its elements are a list that sorts like any list. */
const packagePage = (context: ActionContext): ElementBuffer | undefined => {
  const shown = context.buffers[0];
  return shown?.kind === "element" && context.element?.members === true ? shown : undefined;
};
const hasWorkspace = (context: ActionContext): boolean => context.workspace;
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
const showBuffer = (context: ActionContext, buffer: Buffer): void => {
  context.dispatch(
    context.buffers.some((open) => open.key === buffer.key)
      ? { type: "switch", key: buffer.key }
      : { type: "open", buffer },
  );
};

const choice = (name: string, run: () => void): Choice => ({ id: name, name, run });

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

/**
 * The elements `element.search` finds for the typed text, as the choices of a prompt; `run` is what
 * choosing one does. The prompts "Go to" and "Insert reference" (SR-129) find them the same way.
 */
export const findElements =
  (context: ActionContext, run: (row: Row) => void) =>
  async (query: string): Promise<readonly Choice[]> => {
    const answer = await context.call("element.search", { query, fields: ["id", "title"], limit: 20 });
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
    }));
  };

/** The prompt of Ctrl/Cmd+P: the open buffers (not the shown one), and elements found by `element.search`. */
export const jumpPrompt = (context: ActionContext): Prompt => ({
  label: "Go to",
  items: context.buffers.slice(1).map((buffer) => ({
    id: buffer.key,
    name: bufferName(buffer),
    run: () => {
      context.dispatch({ type: "switch", key: buffer.key });
    },
  })),
  find: findElements(context, (row) => {
    context.dispatch({ type: "open", buffer: row.open });
  }),
});

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
  context.dispatch({ type: "open", buffer: filteredList([...list.steps, step], list.sort) });
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
 * "Close all buffers" (SR-123): buffers without unsaved text close at once. With unsaved text the
 * minibuffer asks, not a dialog (SR-123 AK2): the first choice, which Enter takes, keeps the buffers that
 * have unsaved text; the second discards it.
 */
const closeAll = (context: ActionContext): void => {
  const open = context.buffers.filter((buffer) => buffer.kind !== "overview");
  const unsaved = open.filter((buffer) => context.drafted(buffer.key));
  if (unsaved.length === 0) {
    closeBuffers(context, open);
    return;
  }
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

/** The facets of the shown list: what its elements have, from the core (`element.facets`). */
const facetsOf = (call: Call, list: ListBuffer): Promise<Answer<"element.facets">> =>
  call("element.facets", list.selection === undefined ? {} : { selection: list.selection });

/** The line of "Show element ID and version": the UUID and the date of the version (D-013). */
const versionLine = (element: DataExportElement): string =>
  `${element.id} · version of ${element.versionDate ?? "unknown date"} · ${element.repository}:${element.file}`;

export const ACTIONS: readonly Action[] = [
  {
    id: "go-to",
    title: "Go to element or buffer",
    shortcut: { mod: true, shift: false, key: "p" },
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
      context.dispatch({ type: "open", buffer: filteredList(list.steps.slice(0, -1), list.sort) });
    }),
  },
  {
    id: "clear-filters",
    title: "Clear all list filters",
    available: isChained,
    run: onList((context, list) => {
      context.dispatch({ type: "open", buffer: filteredList([], list.sort) });
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
          context.dispatch({ type: "open", buffer: filteredList(list.steps, sort) });
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
    id: "close",
    title: "Close buffer",
    available: hasBuffers,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current === undefined) {
        return;
      }
      if (context.modified && !context.closeArmed(current.key)) {
        context.armClose(current.key);
        context.echo(
          `${bufferName(current)} has unsaved changes: ${shortcutLabel(SAVE_SHORTCUT, context.mac)} saves them, closing again discards them`,
        );
        return;
      }
      context.discard(current.key);
      context.dispatch({ type: "close", key: current.key });
    },
  },
  { id: "close-all", title: "Close all buffers", available: hasBuffers, run: closeAll },
  {
    id: "save",
    title: "Save element",
    shortcut: SAVE_SHORTCUT,
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
    id: "follow-reference",
    title: "Follow reference",
    shortcut: { mod: true, shift: false, key: "enter" },
    available: hasElementText,
    run: (context: ActionContext): void => {
      context.element?.follow();
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
    id: "toggle-dark-mode",
    title: "Toggle dark mode",
    available: hasWorkspace,
    run: (context: ActionContext): void => {
      const scheme = context.theme.toggle();
      context.echo(scheme === "dark" ? "Dark mode until the app quits" : "Light mode until the app quits");
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
];

/** Runs an action. Any action but "Close buffer" ends a question that closing asked. */
export const runAction = (action: Action, context: ActionContext): void => {
  if (action.id !== "close") {
    context.armClose(undefined);
  }
  action.run(context);
};

/** The hint of a prompt entry: the shortcut, or else the key that works in the buffer. */
const hintOf = (action: Action, mac: boolean): { readonly hint?: string } => {
  const hint = action.shortcut === undefined ? action.hint : shortcutLabel(action.shortcut, mac);
  return hint === undefined ? {} : { hint };
};

/** The command prompt: the actions that apply now, with their shortcuts. */
export const commandPrompt = (context: ActionContext): Prompt => ({
  label: "Command",
  items: ACTIONS.filter((action) => action.available(context)).map((action) => ({
    id: action.id,
    name: action.title,
    ...hintOf(action, context.mac),
    run: () => {
      runAction(action, context);
    },
  })),
});

/** The action with a shortcut that `pressed` accepts, when it applies now. */
export const actionFor = (
  context: ActionContext,
  pressed: (shortcut: Shortcut) => boolean,
): Action | undefined =>
  ACTIONS.find(
    (action) => action.shortcut !== undefined && pressed(action.shortcut) && action.available(context),
  );
