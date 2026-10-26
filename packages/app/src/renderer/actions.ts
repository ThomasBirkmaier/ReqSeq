// The app's own actions, which the command prompt (Ctrl/Cmd+Shift+P) lists by name and runs, and the
// prompts they open. Only what applies to the shown buffer is offered. Every datum comes from a catalog
// command, shown as it is (ADR-0002); filter and sort only build the input of `element.list`.
//
// The prompt finds the app's actions. Catalog commands come with #85: they need arguments, so they wait
// for argument entry.
import type { DataExportElement, ElementSelection, FilterSortKeyWithDefaults } from "@logreq/core";
import type { BufferAction, Buffers, ListBuffer } from "./buffers.js";
import { bufferName, listBuffer, searchBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { Shortcut } from "./keys.js";
import { shortcutLabel } from "./keys.js";
import { searchRows } from "./rows.js";

/** One entry of a prompt: what is listed, and what Enter does. */
export interface Choice {
  readonly id: string;
  readonly name: string;
  /** Shown right-aligned in muted text: the shortcut. */
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
}

export interface ActionContext {
  /** A workspace is open. */
  readonly workspace: boolean;
  /** The open buffers, the most recent first; the first one is shown. */
  readonly buffers: Buffers;
  readonly mac: boolean;
  readonly call: Call;
  readonly dispatch: (action: BufferAction) => void;
  readonly ask: (prompt: Prompt) => void;
  readonly echo: (message: string) => void;
}

export interface Action {
  readonly id: string;
  readonly title: string;
  readonly shortcut?: Shortcut;
  readonly available: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}

/** The command prompt itself; it is not listed in itself. */
export const COMMAND_SHORTCUT: Shortcut = { mod: true, shift: true, key: "p" };

const currentList = (context: ActionContext): ListBuffer | undefined => {
  const current = context.buffers[0];
  return current?.kind === "list" ? current : undefined;
};

const isList = (context: ActionContext): boolean => currentList(context) !== undefined;
const isFiltered = (context: ActionContext): boolean => currentList(context)?.selection !== undefined;
const isElement = (context: ActionContext): boolean => context.buffers[0]?.kind === "element";
const hasWorkspace = (context: ActionContext): boolean => context.workspace;
const hasBuffers = (context: ActionContext): boolean => context.buffers.length > 0;

/** An action on the shown list; without one it does nothing. */
const onList =
  (run: (context: ActionContext, list: ListBuffer) => void) =>
  (context: ActionContext): void => {
    const list = currentList(context);
    if (list !== undefined) {
      run(context, list);
    }
  };

const choice = (name: string, run: () => void): Choice => ({ id: name, name, run });

const SORTS: readonly (readonly [string, readonly FilterSortKeyWithDefaults[] | undefined])[] = [
  ["Workspace order", undefined],
  ["ID ascending", [{ by: "id", order: "asc" }]],
  ["ID descending", [{ by: "id", order: "desc" }]],
  ["Title ascending", [{ by: "title", order: "asc" }]],
  ["Title descending", [{ by: "title", order: "desc" }]],
  ["Type ascending", [{ by: "type", order: "asc" }]],
  ["Type descending", [{ by: "type", order: "desc" }]],
  ["Status ascending", [{ by: "status", order: "asc" }]],
  ["Status descending", [{ by: "status", order: "desc" }]],
  ["Hierarchy (tree)", [{ by: "hierarchy", order: "asc" }]],
];

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
  find: async (query) => {
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
        context.dispatch({ type: "open", buffer: row.open });
      },
    }));
  },
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
  /** The label of the prompt, and the text before the name in the list's label ("type: need"). */
  readonly label: string;
  readonly nothing: string;
  readonly names: (call: Call) => Promise<Names>;
  readonly selection: (name: string) => ElementSelection;
}

const filterBy = (by: FilterBy): Action => ({
  id: by.id,
  title: by.title,
  available: isList,
  run: onList((context, list) => {
    void by.names(context.call).then((found) => {
      if (!found.ok) {
        context.echo(found.message);
      } else if (found.names.length === 0) {
        context.echo(by.nothing);
      } else {
        context.ask({
          label: by.label,
          items: found.names.map((name) =>
            choice(name, () => {
              context.dispatch({
                type: "open",
                buffer: listBuffer(`${by.label.toLowerCase()}: ${name}`, by.selection(name), list.sort),
              });
            }),
          ),
        });
      }
    });
  }),
});

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
    selection: (name: string): ElementSelection => ({ where: { type: [name] } }),
  }),
  filterBy({
    id: "filter-status",
    title: "Filter list by status",
    label: "Status",
    nothing: "The metamodel has no statuses.",
    names: async (call: Call): Promise<Names> => {
      const answer = await call("metamodel.get", {});
      return answer.ok ? { ok: true, names: answer.output.statuses.map((status) => status.key) } : answer;
    },
    selection: (name: string): ElementSelection => ({ where: { status: [name] } }),
  }),
  filterBy({
    id: "filter-saved",
    title: "Filter list by saved filter",
    label: "Filter",
    nothing: "The workspace has no saved filters.",
    names: async (call: Call): Promise<Names> => {
      const answer = await call("filter.list", {});
      return answer.ok ? { ok: true, names: answer.output.filters.map((filter) => filter.name) } : answer;
    },
    selection: (name: string): ElementSelection => ({ filter: name }),
  }),
  {
    id: "clear-filter",
    title: "Clear list filter",
    available: isFiltered,
    run: onList((context, list) => {
      context.dispatch({ type: "open", buffer: listBuffer("All elements", undefined, list.sort) });
    }),
  },
  {
    id: "sort",
    title: "Sort list",
    available: isList,
    run: onList((context, list) => {
      context.ask({
        label: "Sort by",
        items: SORTS.map(([name, sort]) =>
          choice(name, () => {
            context.dispatch({ type: "open", buffer: listBuffer(list.label, list.selection, sort) });
          }),
        ),
      });
    }),
  },
  {
    id: "close",
    title: "Close buffer",
    available: hasBuffers,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current !== undefined) {
        context.dispatch({ type: "close", key: current.key });
      }
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
];

/** The command prompt: the actions that apply now, with their shortcuts. */
export const commandPrompt = (context: ActionContext): Prompt => ({
  label: "Command",
  items: ACTIONS.filter((action) => action.available(context)).map((action) => ({
    id: action.id,
    name: action.title,
    ...(action.shortcut === undefined ? {} : { hint: shortcutLabel(action.shortcut, context.mac) }),
    run: () => {
      action.run(context);
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
