// Relations and inline references to missing targets (SR-089, N-065, D-041, D-058). A relation
// names its target by UUID and, across repositories, by the workspace name of the target's
// repository; so does an inline reference in the text (decision on spec question #177 (c)). When
// that repository is on this machine and has no element with the UUID (the target file was removed
// or the UUID is wrong), the relation or reference is a finding with source and target ID; ReqSeq
// changes no file. Severity `error`: SR-089 asks for a "Befund", not a "Hinweis", and SR-019 AK2
// ends the check with exit code 1 for it (ADR-0009). Where the target is comes from `targetState`,
// which the element view also uses (SR-080):
// - `missing`: reported here.
// - `inaccessible` (the repository is in the workspace file but not here): not a finding, SR-006
//   shows it as not accessible (SR-089 AK2).
// - `unknown-repository` (the workspace file lists no such repository): not a finding either; it is
//   no "lokal vorhandenes Repository" and counts like an inaccessible one (spec question #193).
// - `ambiguous`: SR-088 reports the files that share the UUID.
// Checked are the items of relation kinds and the values of relation-valued properties
// (`relationItems`: a property wins over a relation kind), whatever the source's type. An item
// counts as a target when it is a mapping with a UUID as `id`, as in the element view; a missing
// or wrong `version` or other keys do not matter here (ADR-0004 keeps such entries). Values of
// another shape (no mapping, no UUID, one mapping where a list belongs or the reverse) are left to
// the value-kind check (SR-085).
// Inline references come from the element store (`ElementRecord.references`, and for properties marked
// `markdown` `propertyReferences`, SR-127; `referencesOf`), so no text is read.
// Their state comes from `referenceTargetState`: one with `repository` like a relation target, one
// without in the source's own repository (D-058), which is always here, so its target is missing
// when no repository here has the UUID, whichever repository is not on this machine. A target
// found once in another repository counts (links written before references named their
// repository).
// A target whose file cannot be read (faulty YAML, conflict markers, SR-008) is not in the store,
// so it counts as missing too; when a file with a problem in that repository carries the target's
// UUID digits in its name (D-056), the message says the target may be in that file.
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { isUuid } from "./elements.js";
import { FILE_NAME_DIGITS } from "./file-name.js";
import type { LocatableFinding } from "./locate.js";
import { findingLocator } from "./locate.js";
import type { LinkedReference } from "./references.js";
import {
  placeOfReference,
  referenceTargetState,
  referencesOf,
  unavailableRepositoryHint,
} from "./references.js";
import { hasId, relationItems, relationKey } from "./relation-keys.js";
import { targetState } from "./relations.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import type { ValuePath } from "./values.js";

/** What the check needs: where targets are (layout and store), messages show short IDs (SR-084). */
export interface MissingTargetContext {
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/**
 * A relation whose target is missing, before its line is known (`locateFindings` adds the line of
 * the item). `element` is the source; the problem has code `relation.missing-target`, severity
 * `error`, repository, file, element ID (the source) and target ID.
 */
export type MissingTargetFinding = LocatableFinding & {
  readonly path: ValuePath;
  /**
   * The target as written in the source file: a mapping with a UUID as `id`. Its other keys are
   * not checked here (ADR-0004 keeps such entries; their shape is SR-085's).
   */
  readonly target: Readonly<Record<string, unknown>> & { readonly id: string };
};

/**
 * An inline reference whose target is missing (SR-089 AK1). `element` is the source; the problem has
 * code `relation.missing-target`, severity `error`, repository, file, the line of the link (as the
 * store read the file), element ID (the source) and target ID.
 */
export interface MissingReferenceFinding {
  readonly element: ElementRecord;
  readonly reference: LinkedReference;
  readonly problem: Problem;
}

/** The last 12 hex digits of a UUID, as element file names carry them (D-056). */
const fileDigits = (id: string): string => id.replaceAll("-", "").slice(-FILE_NAME_DIGITS).toLowerCase();

const FILE_DIGITS = new RegExp(`-([0-9a-fA-F]{${String(FILE_NAME_DIGITS)}})\\.md$`, "i");

/** One index per store: the files with a problem (not read as elements), by repository and file-name digits. */
const unreadable = new WeakMap<ElementStore, ReadonlyMap<string, string>>();

/** The file of `repository` whose name carries the digits of `id` and that has a problem (SR-008), if any. */
const unreadableFile = (store: ElementStore, repository: string, id: string): string | undefined => {
  let index = unreadable.get(store);
  if (index === undefined) {
    const built = new Map<string, string>();
    // A file with only a warning (e.g. `file.yaml-warning`) is still read as an element: never name it.
    const read = new Set(store.elements.map((e) => `${e.repository}\n${e.file}`));
    for (const { repository: where, file } of store.problems) {
      const match = FILE_DIGITS.exec(file ?? "");
      if (where === undefined || match === null || read.has(`${where}\n${match.input}`)) {
        continue;
      }
      built.set(`${where}\n${String(match[1]).toLowerCase()}`, match.input);
    }
    unreadable.set(store, built);
    index = built;
  }
  return index.get(`${repository}\n${fileDigits(id)}`);
};

/** What a message calls the source: its type name (or key, when unknown) and short ID. */
const sourceName = (element: ElementRecord, context: MissingTargetContext): string =>
  `${findType(context.metamodel, element.type)?.name ?? element.type} ${context.shortIds.of(element)}`;

/** The note on a file of `repository` that cannot be read and may hold `id`, or "" (SR-008). */
const unreadableNote = (store: ElementStore, repository: string, id: string): string => {
  const file = unreadableFile(store, repository, id);
  return file === undefined ? "" : `; its file may be ${file}, which ReqSeq cannot read`;
};

const collect = (
  element: ElementRecord,
  context: MissingTargetContext,
  out: MissingTargetFinding[],
): void => {
  const { layout, store, metamodel } = context;
  let source: string | undefined;
  for (const [key, value] of Object.entries(element.data)) {
    const relation = relationKey(metamodel, key);
    if (relation === undefined) {
      continue;
    }
    for (const [path, item] of relationItems(key, relation, value)) {
      if (!hasId(item)) {
        continue;
      }
      const state = targetState(layout, store, element.repository, item);
      // The UUID check only for the few missing targets, not for every relation (N-036).
      if (state.kind !== "missing" || !isUuid(item.id)) {
        continue;
      }
      const note = unreadableNote(store, state.repository, item.id);
      source ??= sourceName(element, context);
      out.push({
        element,
        path,
        target: item,
        problem: {
          code: "relation.missing-target",
          severity: "error",
          message: `${relation.label} of ${source} points to ${item.id}, which is not in repository ${state.repository}${note}`,
          repository: element.repository,
          file: element.file,
          elementId: element.id,
          targetId: item.id,
        },
      });
    }
  }
};

const collectReferences = (
  element: ElementRecord,
  context: MissingTargetContext,
  out: MissingReferenceFinding[],
): void => {
  const { layout, store, metamodel } = context;
  let source: string | undefined;
  for (const reference of referencesOf(element, metamodel)) {
    const state = referenceTargetState(layout, store, element.repository, reference);
    // The UUID check only for the few missing targets; the store and its cache give UUIDs anyway.
    if (state.kind !== "missing" || !isUuid(reference.id)) {
      continue;
    }
    // A link without repository (D-058) may mean one that is not here: say how to name it.
    const hint = reference.repository === undefined ? unavailableRepositoryHint(layout) : "";
    const note = `${unreadableNote(store, state.repository, reference.id)}${hint}`;
    source ??= sourceName(element, context);
    out.push({
      element,
      reference,
      problem: {
        code: "relation.missing-target",
        severity: "error",
        message: `Reference in ${placeOfReference(reference)} of ${source} points to ${reference.id}, which is not in repository ${state.repository}${note}`,
        repository: element.repository,
        file: element.file,
        line: reference.line,
        elementId: element.id,
        targetId: reference.id,
      },
    });
  }
};

/**
 * The inline references in the text of one element whose target is missing (SR-089 AK1), in text
 * order, each with the line of its link.
 */
export const missingReferenceFindings = (
  element: ElementRecord,
  context: MissingTargetContext,
): readonly MissingReferenceFinding[] => {
  const out: MissingReferenceFinding[] = [];
  collectReferences(element, context, out);
  return out;
};

/** The reference findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allMissingReferenceFindings = (
  context: MissingTargetContext,
): readonly MissingReferenceFinding[] => {
  const out: MissingReferenceFinding[] = [];
  for (const element of context.store.elements) {
    collectReferences(element, context, out);
  }
  return out;
};

/**
 * The relations of one element whose target is missing (SR-089 AK1), in the order of the keys in
 * the file, then of the list items. For a command about one element (`element.get`, with
 * `locateFindings` for the lines of just this element) and a command that has just written it.
 */
export const missingTargetFindings = (
  element: ElementRecord,
  context: MissingTargetContext,
): readonly MissingTargetFinding[] => {
  const out: MissingTargetFinding[] = [];
  collect(element, context, out);
  return out;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allMissingTargetFindings = (context: MissingTargetContext): readonly MissingTargetFinding[] => {
  const out: MissingTargetFinding[] = [];
  for (const element of context.store.elements) {
    collect(element, context, out);
  }
  return out;
};

/**
 * Every relation and inline reference of the workspace whose target is missing, as a problem with
 * repository, file, line, element ID (the source) and target ID (SR-089 AK1), for
 * `workspace.check` (SR-019): per element in store order its relations, then its references.
 * Reads every file with relation findings again for their lines (`findingLocator`); a reference
 * has its line from the store. Kept until the element store or the metamodel is reset. It has no
 * `carry` hook (ADR-0008, #184); one added later must also look again at every source whose
 * relations or references point at a UUID of a changed file, not only at the changed files.
 */
export const missingTargetProblemsState = defineWorkspaceState(
  "missing-targets",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const shortIds = await workspace.get(shortIdState);
    const context = { layout, store, metamodel, shortIds };
    const relations = allMissingTargetFindings(context);
    const locate = await findingLocator(layout, relations);
    const problems: Problem[] = [];
    let next = 0;
    for (const element of store.elements) {
      // The relation findings are in store order too, so they are taken element by element.
      for (let finding = relations[next]; finding?.element === element; finding = relations[next]) {
        problems.push(locate(finding));
        next += 1;
      }
      for (const finding of missingReferenceFindings(element, context)) {
        problems.push(finding.problem);
      }
    }
    return problems;
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
