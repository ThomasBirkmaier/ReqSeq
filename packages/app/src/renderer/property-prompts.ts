// The prompts that set the value of a property box (SR-104): the minibuffer is the only control (D-062), so a
// property is added, a choice taken and a relation target set in it, with the same fuzzy search as the
// command line. The prompts only list what core and the metamodel allow and hand the result back; the box
// builds `element.update` from it (`property-edit.ts`, ADR-0002).
import type { Choice, Prompt } from "./actions.js";
import { elementBuffer } from "./buffers.js";
import { idTitle } from "./id-title.js";
import type { PropertyInfo } from "./element-view.js";
import type { RelationTarget } from "./property-edit.js";
import { choiceItems, chooseKey, chooseTarget } from "./property-edit.js";
import type { Row } from "./rows.js";

/** The prompt "Add property": the properties the element lacks, by name, the key as hint. */
export const addPropertyPrompt = <T extends { readonly key: string; readonly name: string }>(
  addable: readonly T[],
  add: (property: T) => void,
): Prompt => ({
  label: "Add property",
  items: addable.map((property) => ({
    id: property.key,
    name: property.name,
    hint: property.key,
    run: () => {
      add(property);
    },
  })),
});

/**
 * The prompt of a choice property: only the choices of the metamodel, no free text (SR-104 AK3). Taking one
 * gives the keys the property holds then (`apply`); `done` runs after any answer and on Escape, where the
 * focus goes back to the box.
 */
export const choicePrompt = (
  name: string,
  info: PropertyInfo,
  current: readonly string[],
  apply: (keys: string[]) => void,
  done: () => void,
): Prompt => ({
  label: name,
  items: choiceItems(info, current).map(({ key, name: label, hint }): Choice => ({
    id: key,
    name: label,
    hint,
    run: () => {
      apply(chooseKey(info, current, key));
      done();
    },
  })),
  cancel: done,
});

/** The target a found element is. */
const targetOfRow = (row: Row): RelationTarget => ({
  id: row.open.id,
  repository: row.open.repository,
  label: idTitle(row.label, row.title),
});

/**
 * The prompt of a relation property: the targets it holds (taking one removes it) and the elements the
 * search finds for the typed text (taking one sets it: it replaces the target of a single relation and is
 * appended to a list). `search` makes the `find` of the prompt from what taking a found element does; none
 * when the property may point at no type.
 */
export const relationPrompt = (
  name: string,
  info: PropertyInfo,
  current: readonly RelationTarget[],
  apply: (targets: RelationTarget[]) => void,
  search: ((run: (row: Row) => void) => NonNullable<Prompt["find"]>) | undefined,
  done: () => void,
): Prompt => {
  const take = (target: RelationTarget): void => {
    apply(chooseTarget(info, current, target));
    done();
  };
  return {
    label: name,
    items: current.map((target): Choice => ({
      // The id of a found element, so the search does not list it twice.
      id: elementBuffer(target.id, target.repository, target.label).key,
      name: target.label,
      hint: "set",
      run: () => {
        take(target);
      },
    })),
    ...(search === undefined
      ? {}
      : {
          find: search((row) => {
            take(targetOfRow(row));
          }),
        }),
    cancel: done,
  };
};
