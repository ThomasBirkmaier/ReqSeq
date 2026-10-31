// The keyboard reference of the documentation (SR-139 AK5): every key of the app with what it does, on Windows and
// Linux and on macOS, built from the app's own tables, so a changed key shows after the next build of the
// documentation. The documentation generator (ADR-0017) only renders it.
import type { Action } from "./actions.js";
import { ACTIONS, COMMAND_SHORTCUT } from "./actions.js";
import type { PrefixBinding } from "./bindings.js";
import { PREFIX, PREFIX_BINDINGS, PREFIX_KEYS, prefixLabel } from "./bindings.js";
import type { NamedCommand } from "./command-entry.js";
import { coveringAction } from "./command-entry.js";
import { ELEMENT_KEYS } from "./element-keys.js";
import { GRAPH_KEYS, GRAPH_OPEN } from "./graph-nav.js";
import type { KeyRow } from "./keys.js";
import { HISTORY_KEYS, LIST_KEYS, keySpecLabel } from "./keys.js";
import { PROMPT_KEYS } from "./prompt-keys.js";

/**
 * A row of the reference: the keys on Windows and Linux (`keys`) and on macOS (`mac`), each of which does the same,
 * empty where the system has none.
 */
export interface ShortcutRow {
  readonly keys: readonly string[];
  readonly mac: readonly string[];
  readonly does: string;
}

/** A group of keys: where they work, and the rows. */
export interface ShortcutSection {
  readonly title: string;
  readonly about: string;
  readonly rows: readonly ShortcutRow[];
}

/** The tables the reference is built from; a test passes changed ones. */
export interface ShortcutTables {
  readonly global: readonly KeyRow[];
  readonly actions: readonly Action[];
  readonly prefix: readonly KeyRow[];
  readonly bindings: readonly PrefixBinding[];
  readonly prompt: readonly KeyRow[];
  readonly list: readonly KeyRow[];
  readonly graph: readonly KeyRow[];
  readonly element: readonly KeyRow[];
  readonly history: readonly KeyRow[];
}

/** The app's tables. */
export const SHORTCUT_TABLES: ShortcutTables = {
  global: [
    {
      keys: [{ shortcut: COMMAND_SHORTCUT }],
      does: "Open the command prompt: the actions and commands that apply to the shown buffer",
    },
    { keys: [{ shortcut: PREFIX }], does: "The prefix key: then one letter (below)" },
  ],
  actions: ACTIONS,
  prefix: PREFIX_KEYS,
  bindings: PREFIX_BINDINGS,
  prompt: PROMPT_KEYS,
  list: LIST_KEYS,
  graph: [...GRAPH_KEYS, GRAPH_OPEN],
  element: ELEMENT_KEYS,
  history: HISTORY_KEYS,
};

/** The labels of the keys of `row` on one system. */
const labels = (row: KeyRow, mac: boolean): string[] =>
  row.keys.flatMap((spec) => keySpecLabel(spec, mac) ?? []);

const rows = (table: readonly KeyRow[]): ShortcutRow[] =>
  table.map((row) => ({ keys: labels(row, false), mac: labels(row, true), does: row.does }));

/**
 * One row per key of an action, in the order of the actions; actions that share a key (in different buffers) share
 * the row. A key that works only in the buffer (`hint`, "Enter") is written as the action gives it.
 */
const actionRows = (actions: readonly Action[]): ShortcutRow[] => {
  const byKey = new Map<string, { keys: string; mac: string; titles: string[] }>();
  for (const action of actions) {
    const keys =
      action.shortcut === undefined ? undefined : keySpecLabel({ shortcut: action.shortcut }, false);
    const mac = action.shortcut === undefined ? undefined : keySpecLabel({ shortcut: action.shortcut }, true);
    const plain = keys ?? action.hint;
    if (plain === undefined) {
      continue;
    }
    const row = byKey.get(plain) ?? { keys: plain, mac: mac ?? plain, titles: [] };
    byKey.set(plain, row);
    if (!row.titles.includes(action.title)) {
      row.titles.push(action.title);
    }
  }
  return [...byKey.values()].map((row) => ({
    keys: [row.keys],
    mac: [row.mac],
    does: row.titles.join(" / "),
  }));
};

/** What the command prompt names the entry `id`: an action's title, or a catalog command as the app offers it. */
const entryName = (id: string, commands: readonly NamedCommand[], actions: readonly Action[]): string => {
  const name = id.startsWith("command:") ? id.slice("command:".length) : undefined;
  const command = commands.find((candidate) => candidate.name === name);
  const title =
    command === undefined
      ? actions.find((action) => action.id === id)?.title
      : (coveringAction(command, actions)?.title ?? command.title);
  if (title === undefined) {
    throw new Error(`keyboard reference: the prefix key names ${id}, which the app does not offer`);
  }
  return title;
};

/**
 * The sections of the reference from `tables`, the catalog commands (`commands`) naming the letters after the
 * prefix key that run one.
 */
export const shortcutReference = (
  commands: readonly NamedCommand[],
  tables: ShortcutTables = SHORTCUT_TABLES,
): ShortcutSection[] => [
  {
    title: "Everywhere",
    about: "In the main window; the prefix key not while a prompt is open.",
    rows: rows(tables.global),
  },
  {
    title: "Actions",
    about:
      "Each runs where it applies to the shown buffer, as the command prompt lists it; a key shared by several actions does what fits the buffer.",
    rows: actionRows(tables.actions),
  },
  {
    title: "After the prefix key",
    about:
      "Press the prefix key, then the letter, bare or with Ctrl/Cmd held. The letter runs its command where the command prompt offers it; after half a second the minibuffer shows the possible next keys.",
    rows: [
      ...tables.bindings.map((binding) => ({
        keys: [prefixLabel(binding.key, false)],
        mac: [prefixLabel(binding.key, true)],
        does: entryName(binding.id, commands, tables.actions),
      })),
      ...rows(tables.prefix),
    ],
  },
  {
    title: "In a prompt",
    about: "In the command prompt, in “Go to” and while a command asks its arguments in the minibuffer.",
    rows: rows(tables.prompt),
  },
  {
    title: "In a list",
    about:
      "In the overview, a list, a search result, a matrix, a package page, the neighbourhood and the result of a command.",
    rows: rows(tables.list),
  },
  {
    title: "In a graph",
    about: "In the graph of an element and in the metamodel graph.",
    rows: rows(tables.graph),
  },
  {
    title: "On an element",
    about: "On the element buffer, in its text, its title and its property boxes.",
    rows: [...rows(tables.element), ...rows(tables.history)],
  },
];
