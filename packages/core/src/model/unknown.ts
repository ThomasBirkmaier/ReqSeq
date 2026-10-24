// Properties and types the metamodel does not know (SR-016, D-012). Such a file is still an element
// (spec question #145 option 1): its unknown keys are kept unchanged by every write (the lossless
// writer, ADR-0007), an unknown type makes it read-only (`assertElementWritable` in `write.ts`), and
// both are reported here as hints (`warning`: they block nothing and change no status, glossary
// "Hinweis"). D-012: "Ein Element darf Properties tragen, die sein Typ nicht kennt. Das Tool zeigt
// sie als Hinweis an, blockiert aber nichts." So a key is reported when the element's type does not
// have it as a property (inheritance resolved, SR-012), whether the metamodel defines it for other
// types or not at all; the message tells the two apart. For an element of an unknown type only keys
// the metamodel does not define at all are reported. Keys of relation kinds are never reported
// here: which types a relation may join is SR-086.
import type { Problem } from "../catalog.js";
import type { EffectiveType, Metamodel } from "../metamodel/index.js";
import { findType, keyDefinition, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

/**
 * An unknown type (path `["type"]`, code `element.unknown-type`) or an unknown property (path
 * `[key]`, code `element.unknown-property`), severity `warning`, before its line is known
 * (`locateFindings` adds the line of the key).
 */
export type UnknownFinding = LocatableFinding & { readonly path: readonly [key: string] };

const finding = (
  element: ElementRecord,
  key: string,
  code: "element.unknown-type" | "element.unknown-property",
  message: string,
): UnknownFinding => ({
  element,
  path: [key],
  at: "key",
  problem: {
    code,
    severity: "warning",
    message,
    repository: element.repository,
    file: element.file,
    elementId: element.id,
  },
});

const KEPT = "LogReq keeps it and its value unchanged";

/** Why the type does not know the property `key`; undefined when it does, or for a relation kind. */
const unknownKeyMessage = (
  metamodel: Metamodel,
  type: EffectiveType | undefined,
  key: string,
): string | undefined => {
  const found = keyDefinition(metamodel, key);
  if (found === undefined) {
    return `Property ${key} is not in the metamodel; ${KEPT}`;
  }
  if (found.kind === "relation" || type === undefined || type.properties.includes(key)) {
    return undefined;
  }
  return `Property ${found.definition.name} (${key}) is not a property of type ${type.name} (${type.key}); ${KEPT}`;
};

const collect = (element: ElementRecord, metamodel: Metamodel, out: UnknownFinding[]): void => {
  const type = findType(metamodel, element.type);
  if (type === undefined) {
    out.push(
      finding(
        element,
        "type",
        "element.unknown-type",
        `Type ${element.type} is not in the metamodel; LogReq shows the element and only reads it`,
      ),
    );
  }
  for (const key of Object.keys(element.data)) {
    const message = STRUCTURAL_KEYS.includes(key) ? undefined : unknownKeyMessage(metamodel, type, key);
    if (message !== undefined) {
      out.push(finding(element, key, "element.unknown-property", message));
    }
  }
};

/**
 * The unknown type and the unknown properties of one element: the type first, then the keys in the
 * order of `Object.keys` of the frontmatter data (integer-like keys first, then the order of the
 * file). For a command about one element: `elementView` (lines from the file at hand) and
 * `element.get` (with `locateFindings`).
 */
export const unknownFindings = (element: ElementRecord, metamodel: Metamodel): readonly UnknownFinding[] => {
  const out: UnknownFinding[] = [];
  collect(element, metamodel, out);
  return out;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allUnknownFindings = (store: ElementStore, metamodel: Metamodel): readonly UnknownFinding[] => {
  const out: UnknownFinding[] = [];
  for (const element of store.elements) {
    collect(element, metamodel, out);
  }
  return out;
};

/**
 * Every unknown type and property of the workspace as a problem with repository, file, line of the
 * key and element ID (SR-016 AK1, AK3), for `workspace.check` (SR-019). Reads every file with
 * findings again for the lines (`locateFindings`). Kept until the element store or the metamodel is
 * reset.
 */
export const unknownProblemsState = defineWorkspaceState(
  "unknown-keys",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const store = await workspace.get(elementStoreState);
    return locateFindings(layout, allUnknownFindings(store, metamodel));
  },
  { dependsOn: [elementStoreState, metamodelState] },
);
