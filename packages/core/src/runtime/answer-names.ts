// How an answer names what the metamodel defines and the elements of its input (`AnswerNames`, SR-224 AK1),
// from the states the command left. Nothing is read and no whole-workspace state is built for an answer
// (ADR-0008): a command whose answer names a type has read the metamodel in `run`, and one whose answer
// names an element of its input has resolved it with the element store and the short IDs. So the answer
// is the same whether the input names an element by its UUID (the app), its short ID or its identifier
// (#1998). A state that is not there names a type by its key and an element by the reference as given, so
// a successful command never fails for its answer: a store or metamodel that a watcher reset after `run`
// (the next read builds it again), or short IDs that belong to another store than the one kept.
import type { AnswerNames } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import type { ElementCopy, ElementStore, ShortIds } from "../model/index.js";
import { elementStoreState, resolveRef, shortIdState, shortIdsBuiltFrom } from "../model/index.js";
import { settledValue } from "./settled.js";
import type { Workspace } from "./workspace.js";

/** The settled value of a kept state, or undefined when it is not built, still building or failed. */
const settled = async <T>(promise: Promise<T> | undefined): Promise<T | undefined> =>
  settledValue(promise).catch(() => undefined);

/**
 * The value of kept short IDs: waited for, since after a write they are carried to the new store with a
 * step of their own (`updateShortIds`), which may not have settled yet; undefined when none are kept or
 * they failed.
 */
const awaited = async <T>(promise: Promise<T> | undefined): Promise<T | undefined> =>
  promise?.catch(() => undefined);

/**
 * The element `ref` (with `copy`, as the command took it) names, as a sentence names it (`named` in
 * commands/answer.ts: by its identifier, else its short ID); `ref` as given when it names no one element.
 * Only the `CommandError`s of `resolveRef` (`ref.unknown`, `ref.ambiguous`) fall back: any other failure
 * is a bug, and fails the call.
 */
const elementNamer =
  (store: ElementStore, shortIds: ShortIds) =>
  (ref: string, copy?: ElementCopy): string => {
    try {
      const element = resolveRef(store, shortIds, ref, copy);
      return shortIds.identifierOf(element) ?? shortIds.of(element);
    } catch (error) {
      if (error instanceof CommandError) {
        return ref;
      }
      throw error;
    }
  };

/** The names of the answers of a command, from the states of `workspace` when it has run. */
export const answerNames = async (workspace: Workspace): Promise<AnswerNames> => {
  const [metamodel, store] = await Promise.all([
    settled(workspace.peek(metamodelState)),
    settled(workspace.peek(elementStoreState)),
  ]);
  const shortIds = store === undefined ? undefined : await awaited(workspace.peek(shortIdState));
  return {
    type: (key) => (metamodel === undefined ? undefined : findType(metamodel, key)?.name) ?? key,
    element:
      store === undefined || shortIds === undefined || !builtFrom(shortIds, store, metamodel)
        ? (ref) => ref
        : elementNamer(store, shortIds),
  };
};

/** Whether `shortIds` belong to `store` and `metamodel`, so that they name the elements of one view (ADR-0008). */
const builtFrom = (shortIds: ShortIds, store: ElementStore, metamodel: Metamodel | undefined): boolean =>
  metamodel !== undefined && shortIdsBuiltFrom(shortIds, store.byId, metamodel);
