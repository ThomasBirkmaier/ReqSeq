// Required properties without a value (SR-015 AK3, D-012; the hint SR-064 AK2 asks for). A type's required
// properties (Pflicht-Properties, own and inherited, SR-012) may be empty: the file is read and
// kept unchanged, and every required property without a value is a hint (`warning`: it blocks
// nothing and changes no status, glossary "Hinweis"). "Without a value" is a key that is absent,
// `null`, an empty or blank string or an empty list; `metamodel.schema.json` says of `required`:
// "Empty values are allowed but give a hint (SR-064)". So a new required property in the
// metamodel gives a hint for every element that lacks it, and no file is written (SR-015). An
// element of an unknown type gets none: it has `element.unknown-type` (SR-016).
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";

/**
 * A required property without a value (path `[key]`, code `element.missing-required`, severity
 * `warning`), before its line is known: `locateFindings` adds the line of the key when the file
 * has it with an empty value; an absent key has no line.
 */
export type RequiredFinding = LocatableFinding & { readonly path: readonly [key: string] };

/**
 * Whether a value counts as no value: absent, `null`, an empty or blank string, or an empty list.
 * This is about whether a person filled the property in, so a blank string counts as empty; the
 * version (ADR-0005) is another question and keeps a blank string as a value of its own.
 * `values.ts` reports no wrong value kind for such a value, so it gives one hint, not two.
 */
export const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

/** The display name of every property by key, one map per metamodel object. */
const namesByMetamodel = new WeakMap<Metamodel, ReadonlyMap<string, string>>();

const propertyNames = (metamodel: Metamodel): ReadonlyMap<string, string> => {
  const known = namesByMetamodel.get(metamodel);
  if (known !== undefined) {
    return known;
  }
  const names = new Map(metamodel.properties.map((p) => [p.key, p.name]));
  namesByMetamodel.set(metamodel, names);
  return names;
};

const collect = (element: ElementRecord, metamodel: Metamodel, out: RequiredFinding[]): void => {
  const type = findType(metamodel, element.type);
  if (type === undefined) {
    return;
  }
  for (const key of type.required) {
    if (!isEmptyValue(element.data[key])) {
      continue;
    }
    const name = propertyNames(metamodel).get(key) ?? key;
    out.push({
      element,
      path: [key],
      at: "key",
      problem: {
        code: "element.missing-required",
        severity: "warning",
        message: `Required property ${name} (${key}) of type ${type.name} (${type.key}) has no value; ReqSeq changes no file`,
        repository: element.repository,
        file: element.file,
        elementId: element.id,
      },
    });
  }
};

/**
 * The required properties of one element without a value, in the order of the type's `required`
 * (inherited first). For a command about one element: `elementView`.
 */
export const requiredFindings = (
  element: ElementRecord,
  metamodel: Metamodel,
): readonly RequiredFinding[] => {
  const out: RequiredFinding[] = [];
  collect(element, metamodel, out);
  return out;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allRequiredFindings = (
  store: ElementStore,
  metamodel: Metamodel,
): readonly RequiredFinding[] => {
  const out: RequiredFinding[] = [];
  for (const element of store.elements) {
    collect(element, metamodel, out);
  }
  return out;
};

/**
 * Every required property without a value in the workspace, as a problem with repository, file,
 * line of the key when there is one, and element ID (SR-015 AK3), for `workspace.check` (SR-019).
 * Kept until the element store or the metamodel is reset, so a changed metamodel gives its hints
 * on the next read without any file written.
 */
export const requiredProblemsState = defineWorkspaceState(
  "missing-required",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const store = await workspace.get(elementStoreState);
    return locateFindings(layout, allRequiredFindings(store, metamodel));
  },
  {
    dependsOn: [elementStoreState, metamodelState],
    // A save or a watcher batch finds and locates the changed files only (#184).
    carry: carryStoreUpdate((value, update, workspace) => {
      const metamodel = workspace.get(metamodelState);
      return carryProblems(workspace, value, update, {
        findingsOf: metamodel.then((m) => (element) => requiredFindings(element, m)),
        // Nothing against a metamodel that is not valid, as a full build (#208, #220).
        skip: metamodel.then((m) => !m.valid),
      });
    }),
  },
);
