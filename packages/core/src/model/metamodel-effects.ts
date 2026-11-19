// What a metamodel change does to the elements (SR-236 AK9): how many change their version
// (SR-015 AK4) and how many now miss a required property they did not miss before (SR-015 AK3),
// with the elements each number counts (SR-224 AK4), named by their short IDs under the new metamodel.
// One pass over the element store in memory, no file read (N-036); only elements of a type whose
// counted definitions or required properties differ are looked at.
//
// The version depends on the metamodel only through the definitions of the element's type that
// count (`content: true`) and hold a value, and whether they hold relations (ADR-0005). So the
// canonical content of the element's values without its text, under each metamodel, is equal
// exactly when its version is: the text and the embedded files are the same on both sides.
import type { Metamodel } from "../metamodel/index.js";
import { findType } from "../metamodel/index.js";
import { NORMAL_FORM, comparableContent } from "../version/version.js";
import type { ElementRecord } from "./elements.js";
import { versionDefinitions, versionInputOf } from "./loaded-version.js";
import { requiredFindings } from "./required.js";
import type { ShortIds } from "./short-id.js";
import { buildShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";

/** An element a count names (SR-224 AK4). */
export interface EffectElement {
  readonly id: string;
  readonly shortId: string;
  readonly repository: string;
}

export interface MetamodelEffects {
  /** Elements whose version differs under the new metamodel. */
  readonly versionsChanged: number;
  /** Elements that miss a required property under the new metamodel that they did not miss before. */
  readonly missingRequired: number;
  /** The elements `versionsChanged` counts, in store order. */
  readonly versionsChangedElements: readonly EffectElement[];
  /** The elements `missingRequired` counts, in store order. */
  readonly missingRequiredElements: readonly EffectElement[];
}

/** What of a type decides the two counts, as one text. */
const typeShape = (metamodel: Metamodel, type: string): string =>
  JSON.stringify([versionDefinitions({ type }, metamodel), findType(metamodel, type)?.required ?? []]);

const content = (element: ElementRecord, metamodel: Metamodel): string =>
  comparableContent(versionInputOf(element, "", versionDefinitions(element, metamodel), []), NORMAL_FORM);

const missing = (element: ElementRecord, metamodel: Metamodel): ReadonlySet<string> =>
  new Set(requiredFindings(element, metamodel).map((finding) => finding.path[0]));

/** The counts of a change from `before` to `after` over the elements of `store`. */
export const metamodelEffects = (
  store: ElementStore,
  before: Metamodel,
  after: Metamodel,
): MetamodelEffects => {
  const changed = new Map<string, boolean>();
  const typeChanged = (type: string): boolean => {
    let known = changed.get(type);
    if (known === undefined) {
      known = typeShape(before, type) !== typeShape(after, type);
      changed.set(type, known);
    }
    return known;
  };
  const versions: ElementRecord[] = [];
  const required: ElementRecord[] = [];
  for (const element of store.elements) {
    if (!typeChanged(element.type)) {
      continue;
    }
    if (content(element, before) !== content(element, after)) {
      versions.push(element);
    }
    const was = missing(element, before);
    if ([...missing(element, after)].some((key) => !was.has(key))) {
      required.push(element);
    }
  }
  // Built at the first named element: the short IDs take one pass over the whole store.
  let shortIds: ShortIds | undefined;
  const named = (elements: readonly ElementRecord[]): EffectElement[] =>
    elements.map((element) => ({
      id: element.id,
      shortId: (shortIds ??= buildShortIds(store.byId, after)).of(element),
      repository: element.repository,
    }));
  return {
    versionsChanged: versions.length,
    missingRequired: required.length,
    versionsChangedElements: named(versions),
    missingRequiredElements: named(required),
  };
};
