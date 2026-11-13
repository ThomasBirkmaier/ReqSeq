// The field choice of the search prompt (SR-216 AK6, AK7, AK9): Ctrl/Cmd+Enter at the search words asks for the
// fields to search in, as hits from `element.searchFields` with the key beside each name; each one chosen is a mark,
// and the first hit goes back to the search words with the marks and the text. Which fields there are and what a
// search in them finds is core's (ADR-0002); the app only leaves out what a mark already covers.
import type { ActionContext, ArgumentExplanation, Choice, Prompt } from "./actions.js";
import type { SearchField } from "./buffers.js";
import type { CommandListing } from "../shared/protocol.js";

/** The catalog command the search runs. */
export const SEARCH_COMMAND = "element.search";

/** The key of all properties: with it, a single property adds nothing (SR-216 AK2, AK6). */
const ALL_PROPERTIES = "properties";

/** The keys that are no single property: title, text, IDs and all properties (SR-216 AK2). */
const FIXED = new Set(["title", "text", "id", ALL_PROPERTIES]);

/** The command `name` of the catalog read last, if it was read. */
const commandOf = (context: ActionContext, name: string): CommandListing | undefined =>
  context.catalog?.().find((command) => command.name === name);

/** The summary of the catalog command `name`, for an explanation line (SR-216 AK9). */
export const summaryOf = (context: ActionContext, name: string): { readonly summary?: string } => {
  const summary = commandOf(context, name)?.summary;
  return summary === undefined ? {} : { summary };
};

/** The description of the argument `field` of the catalog command `name` (SR-210 AK2). */
const descriptionOf = (
  context: ActionContext,
  name: string,
  field: string,
): { readonly description?: string } => {
  const input = commandOf(context, name)?.input as
    { readonly properties?: Readonly<Record<string, { readonly description?: unknown }>> } | undefined;
  const description = input?.properties?.[field]?.description;
  return typeof description === "string" ? { description } : {};
};

/**
 * The fields still to offer when `taken` are chosen: not those, and after all properties no single property
 * (SR-216 AK6). The fields keep core's order.
 */
export const offeredFields = <T extends { readonly key: string }>(
  fields: readonly T[],
  taken: readonly unknown[],
): T[] =>
  fields.filter(
    (field) => !taken.includes(field.key) && (FIXED.has(field.key) || !taken.includes(ALL_PROPERTIES)),
  );

/** The fields after `field` is chosen: all properties takes the place of the single properties (SR-216 AK6). */
export const withField = (fields: readonly SearchField[], field: SearchField): readonly SearchField[] => [
  ...(field.key === ALL_PROPERTIES ? fields.filter((other) => FIXED.has(other.key)) : fields),
  field,
];

/** "Search in 2 fields", or "Search all fields" without one: the hit back to the search words (SR-216 AK6). */
const backName = (fields: readonly SearchField[]): string =>
  fields.length === 0
    ? "Search all fields"
    : `Search in ${String(fields.length)} field${fields.length === 1 ? "" : "s"}`;

/**
 * The field choice: the hit back to the search words first and marked, then the fields of `element.searchFields`
 * not chosen yet, by name with the key beside (SR-216 AK3, AK6); Enter or a click sets one as a mark, and the
 * prompt asks again. The × of a mark and Backspace on an empty input remove one (AK7, SR-134 AK4); Escape, and
 * Backspace without a mark, go back to the search words with the marks. `words` is the text of the search, kept.
 */
export const searchFieldsPrompt = (
  context: ActionContext,
  fields: readonly SearchField[],
  words: string,
  back: (fields: readonly SearchField[], words: string) => void,
): Prompt => {
  const again = (next: readonly SearchField[]): void => {
    context.ask(searchFieldsPrompt(context, next, words, back));
  };
  const label = "Search · fields:";
  const first: Choice = {
    id: "search-words",
    name: backName(fields),
    run: () => {
      back(fields, words);
    },
  };
  const explain: ArgumentExplanation = {
    name: "fields",
    ...descriptionOf(context, SEARCH_COMMAND, "fields"),
    list: false,
    ends: false,
    skips: false,
    more: false,
    building: { enter: "adds the field", unmark: fields.length > 0, json: false },
  };
  return {
    label,
    items: [first],
    marks: fields.map((field) => ({
      label: field.name,
      remove: () => {
        again(fields.filter((other) => other !== field));
      },
    })),
    unmark: true,
    back: () => {
      back(fields, words);
    },
    explain,
    fill: context.call("element.searchFields", {}).then((answer) => {
      if (!answer.ok) {
        return { label: `${answer.message} · ${label}` };
      }
      const taken = fields.map((field) => field.key);
      return {
        items: [
          first,
          ...offeredFields(answer.output.fields, taken).map((field): Choice => ({
            id: `field:${field.key}`,
            name: field.name,
            hint: field.key,
            run: () => {
              again(withField(fields, { key: field.key, name: field.name }));
            },
          })),
        ],
      };
    }),
  };
};
