// The app's own actions, which the command prompt (Ctrl/Cmd+Shift+P) lists by name and runs, and the
// prompts they open. Only what applies to the shown buffer is offered. Every datum comes from a catalog
// command, shown as it is (ADR-0002); filter and sort only build the input of `element.list`. Each filter
// is a step that narrows the list the one before gave (SR-124 AK1, `list-filters.ts`): the conditions are
// ANDed in the selection; the values of "Filter list" come from `element.facets`.
//
// The prompt finds the app's actions and the catalog's read commands (`catalog-commands.ts`, ThomasBirkmaier/ReqSeq-archive#85); an
// action that does what a command does covers it, so the prompt lists it once.
//
// `ACTIONS` gathers the groups of actions, each in its module (`buffer-actions.ts`, `graph-actions.ts`,
// `app-actions.ts`, `list-actions.ts` and the others below); their types are in `action-types.ts`, and
// where they are available is in `action-conditions.ts`.
import type { DataExportElement, ElementSelection } from "@reqseq/core";
import type { SearchField } from "./buffers.js";
import { bufferName, elementBufferOf, overviewBuffer, fieldsInput, searchBuffer } from "./buffers.js";
import { SEARCH_COMMAND, searchFieldsPrompt, summaryOf } from "./search-fields.js";
import { PREFIX_BINDINGS, bindingLabel } from "./bindings.js";
import { ALL_COMMANDS, ALL_COMMANDS_DESCRIPTION } from "./prompt-keys.js";
import type { ReferenceRequest } from "./editor/slash-menu.js";
import { LIST_ACTIONS } from "./list-actions.js";
import { linesOf, resultText } from "./result-copy.js";
import type { KeyPress, Shortcut } from "./keys.js";
import { SAVE_SHORTCUT, shortcutLabel } from "./keys.js";
import type { SwipeDirection } from "../shared/protocol.js";
import { criterionLabel, criterionReferenceOf } from "@reqseq/core/criterion-items";
import { TEXT_ACTIONS } from "./text-actions.js";
import { ENTRY_ACTIONS } from "./entry-menu.js";
import { FIND_ACTIONS } from "./find-actions.js";
import { HEADING_ACTIONS } from "./heading-actions.js";
import { labelMarks, rowName, searchRows } from "./rows.js";
import type { Range, Row } from "./rows.js";
import type { PromptUse } from "./usage.js";
import type { Choice, Prompt, ActionContext, Action } from "./action-types.js";
import { isElement, hasWorkspace, isOverview, shownResult, hasElementText } from "./action-conditions.js";
import { GRAPH_ACTIONS } from "./graph-actions.js";
import { BUFFER_ACTIONS } from "./buffer-actions.js";
import { APP_ACTIONS } from "./app-actions.js";

/**
 * Ctrl/Cmd+Alt+A (macOS ⌥⌘A) adds a property to the shown element (SR-104 AK2). Not Cmd+Shift+A: with
 * text selected, macOS gives that to the service "Search man Page Index in Terminal".
 */
const ADD_PROPERTY_SHORTCUT: Shortcut = { mod: true, shift: false, alt: true, key: "a" };

/**
 * Ctrl/Cmd+Shift+Enter lists the elements with the value at the cursor (SR-132). Ctrl/Cmd+Enter stays
 * "Follow reference", which opens the target of a relation box and the reference of a Markdown box (ThomasBirkmaier/ReqSeq-archive#610).
 */
const LIST_VALUE_SHORTCUT: Shortcut = { mod: true, shift: true, key: "enter" };

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
      // As the search prompt marks them: a phrase whole (SR-174 AK6), never its words elsewhere.
      marks: nameMarks(row, query),
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
 * Enter on a chosen hit opens it, Enter without one opens the search buffer. The `fields` chosen (SR-216) stand as
 * marks before the text, and the hits and the search buffer come only from them (AK8); Ctrl/Cmd+Enter, or a click
 * on it in the explanation line, chooses them (AK6, `search-fields.ts`), and the text `words` stays.
 */
export const searchPrompt = (
  context: ActionContext,
  fields: readonly SearchField[] = [],
  words = "",
): Prompt => {
  // The text typed so far, kept when a mark is removed or the fields are chosen.
  let typed = words;
  const again = (next: readonly SearchField[], text: string): void => {
    context.ask(searchPrompt(context, next, text));
  };
  return {
    label: "Search",
    items: [],
    preview: true,
    ...(words === "" ? {} : { initial: words }),
    typing: (text) => {
      typed = text;
    },
    marks: fields.map((field) => ({
      label: field.name,
      remove: () => {
        again(
          fields.filter((other) => other !== field),
          typed,
        );
      },
    })),
    // Backspace on an empty input removes the last field (SR-134 AK4, SR-216 AK7).
    unmark: true,
    explainStep: {
      ...summaryOf(context, SEARCH_COMMAND),
      enter: "opens the list of search hits",
      more: "chooses fields",
    },
    more: (text) => {
      context.ask(searchFieldsPrompt(context, fields, text, again));
    },
    find: async (text) => {
      // The query and fields of the search buffer, so the hits are its first ones (SR-183 AK2, SR-216 AK8).
      const answer = await context.call(SEARCH_COMMAND, {
        query: text.trim(),
        ...fieldsInput(fields),
        limit: CARD_LINES,
      });
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
        context.dispatch({ type: "open", buffer: searchBuffer(query, [], undefined, fields) });
      }
    },
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
      // A new search starts without fields (SR-216 AK10).
      context.ask(searchPrompt(context));
    },
  },
  ...LIST_ACTIONS,
  ...BUFFER_ACTIONS,
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
  ...GRAPH_ACTIONS,
  ...APP_ACTIONS,
  // The actions on the element of an entry (SR-197, `entry-menu.ts`): last, so a catalog command with the
  // same title is covered by the action on the shown element, whose key it shows (`coveringAction`).
  ...ENTRY_ACTIONS,
];

/**
 * The context of one run of an action: Escape, and Backspace on an empty input (AK4), in each prompt it asks goes back to the prompt it asked before
 * (`previous`, SR-134 AK1), in the first one, and in one asked again as the first (`restart`), to `first` (the
 * command prompt the action was chosen in); without `first` the first one closes (AK2). A prompt with its own `back` (catalog commands) is left as it is, and so
 * is one that steps through hits, which Escape ends (`step`, SR-189 AK1).
 */
const steppedContext = (context: ActionContext, first?: () => void): ActionContext => {
  let shown: Prompt | undefined;
  const ask = (prompt: Prompt): void => {
    const before = shown;
    const previous =
      before === undefined || prompt.restart === true
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

/** How many fitting commands the command prompt shows with an empty input, before "All commands…" (SR-133 AK1). */
export const OPENING_COMMANDS = 9;

/**
 * The order of the entries without use (SR-133 AK1): first those with a letter after the prefix key, in the order of
 * the next keys (`PREFIX_BINDINGS`, SR-109 AK3); then the actions with a shortcut of their own, in the order of
 * `ACTIONS` (the order among them is not set by the requirement); then the others by name. `rankByUse` keeps this
 * order among entries in equal use.
 */
export const unusedOrder = (items: readonly Choice[], actions: readonly Action[] = ACTIONS): Choice[] => {
  const place = (item: Choice): readonly [number, number] => {
    const letter = PREFIX_BINDINGS.findIndex((binding) => binding.id === item.id);
    if (letter !== -1) {
      return [0, letter];
    }
    const keyed = actions.findIndex((action) => action.id === item.id && action.shortcut !== undefined);
    return keyed === -1 ? [2, 0] : [1, keyed];
  };
  return items
    .map((item) => ({ item, place: place(item) }))
    .sort(
      (a, b) =>
        a.place[0] - b.place[0] || a.place[1] - b.place[1] || (a.place[0] === 2 ? byName(a.item, b.item) : 0),
    )
    .map(({ item }) => item);
};

/** Two entries alphabetically by their name, ignoring case. */
const byName = (a: Choice, b: Choice): number =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.name.localeCompare(b.name, "en");

/**
 * The last row of the command prompt with an empty input (SR-133 AK3): `open` shows every command. It records no
 * use, has no key and no command help; its explanation line names Enter, which takes it (SR-210 AK5).
 */
const allCommandsRow = (open: () => void): Choice => ({
  id: "all-commands",
  name: ALL_COMMANDS,
  opens: true,
  explain: { summary: ALL_COMMANDS_DESCRIPTION, enter: true },
  run: open,
});

/**
 * The command prompt: the actions that apply now, with their shortcuts, then `commands` (the catalog's,
 * `catalog-commands.ts`), ordered by `use` (SR-108 AK3, SR-121 AK2); the window puts them in `unusedOrder` first.
 * An action is shown only where it applies, so each one fits the view (SR-133 AK1). With `everything`, an
 * empty input shows the first nine that fit and "All commands…", which calls it (SR-133 AK1, AK3).
 */
export const commandPrompt = (
  context: ActionContext,
  use?: PromptUse,
  commands: readonly Choice[] = [],
  reopen?: () => void,
  everything?: () => void,
): Prompt => ({
  label: "Command",
  ...(use === undefined ? {} : { use }),
  ...(everything === undefined
    ? {}
    : { opening: { first: OPENING_COMMANDS, last: allCommandsRow(everything) } }),
  items: [
    ...ACTIONS.filter((action) => action.available(context)).map((action) => ({
      id: action.id,
      name: action.title,
      ...hintOf(action, context.mac),
      fits: action.fits?.(context) ?? true,
      run: () => {
        runAction(action, context, reopen);
      },
    })),
    ...commands,
  ],
});

/**
 * The list of every command of the command prompt `prompt` (SR-133 AK3): an empty input shows all its entries
 * alphabetically by name, the first one marked, under the label "All commands"; a typed text finds as in the
 * command prompt (AK2).
 */
export const allCommandsPrompt = (prompt: Prompt): Prompt => ({
  ...prompt,
  label: "All commands",
  opening: "as-given",
  items: [...prompt.items].sort(byName),
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
