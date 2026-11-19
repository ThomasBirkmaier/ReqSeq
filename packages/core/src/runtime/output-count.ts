// A number of elements of a command's output, named for `selection.output.count` (SR-224 AK4, #1915): the
// field of the number as the catalog's `outputFields` gives its path, and for each list it is in (each `[]`)
// the entry, by the fields the catalog names for it (`keys`, `x-key` of the list). `invoke` checks the
// count against the catalog (`checkedCount`) and resolves it:
//
// - A number whose paths name the answer of the output (`total` of element.list) gives the answer over all
//   pages (`outputElements`).
// - A number whose paths name lists of the same output (evidence.coverage), or that is marked `selection`,
//   gives what the command's `countedElements` gives: the records the command counted, so a number that
//   counts one copy of a UUID found twice (SR-088) lists that copy only.
//
// An entry matches a key when each key field of the list has the same value in both, compared by type, a
// field neither has included; a key that names no entry gives no elements.
import type { OutputCount } from "../catalog.js";
import { CommandError } from "../catalog.js";

/** What the catalog gives of an output field (`outputFields`). */
export interface CatalogOutputField {
  readonly path: string;
  readonly elements?: true | "answer" | "selection" | readonly string[];
  readonly keys?: readonly (readonly string[])[];
}

/** Where `selection.output.count` is, as messages and `details` name fields. */
const COUNT = "selection.output.count";

/**
 * `count` checked against the field the catalog gives for it in `fields` (see the file comment), with one key
 * per list, else `input.invalid` naming `selection.output.count`: a field the output has not, no number of
 * elements, a wrong number of keys, or a key field the list does not name.
 */
export const checkedCount = (
  caller: string,
  name: string,
  fields: readonly CatalogOutputField[],
  count: { readonly field: string; readonly key?: readonly Readonly<Record<string, unknown>>[] },
): {
  readonly field: CatalogOutputField;
  readonly elements: "selection" | readonly string[];
  readonly count: OutputCount;
} => {
  const invalid = (at: string, message: string): CommandError =>
    new CommandError("input.invalid", `${at}: ${message}`, { command: caller, fields: [at] });
  const field = fields.find((f) => f.path === count.field);
  if (field === undefined) {
    throw invalid(`${COUNT}.field`, `${name} has no output field ${count.field}`);
  }
  const { elements } = field;
  if (elements === undefined || elements === true || elements === "answer") {
    throw invalid(
      `${COUNT}.field`,
      `${count.field} of ${name} is no number of elements; the catalog marks those in outputFields with elements`,
    );
  }
  const keys = field.keys ?? [];
  const key = count.key ?? [];
  if (key.length !== keys.length) {
    throw invalid(
      `${COUNT}.key`,
      `${count.field} is in ${String(keys.length)} ${keys.length === 1 ? "list" : "lists"}; give one entry for each, outermost first`,
    );
  }
  key.forEach((entry, level) => {
    const named = keys.slice(level, level + 1).flat();
    const unknown = Object.keys(entry).filter((f) => !named.includes(f));
    if (unknown.length > 0) {
      throw invalid(
        `${COUNT}.key`,
        `entry ${String(level + 1)} names ${unknown.join(", ")}; an entry of that list is named by ${named.join(", ")}`,
      );
    }
  });
  return { field, elements, count: { field: count.field, key } };
};

/** Whether the paths of a number name only the answer of its output (see the file comment). */
export const countsAnswer = (field: CatalogOutputField, fields: readonly CatalogOutputField[]): boolean =>
  Array.isArray(field.elements) &&
  field.elements.every((path) => fields.find((f) => f.path === path)?.elements === "answer");
