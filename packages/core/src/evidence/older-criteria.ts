// The acceptance criteria of older versions that records name (D-072, SR-031 AK11): one lookup
// `(id, version) → items` that every status path shares (`statusSource`, `display.ts`,
// `hints/evidence.ts`, `baseline.get`), so they agree (SR-080 AK2). The items of an older version are
// those of the newest commit that has it (SR-028 AK5), from the walk of the version dates
// (`versionValues`, ADR-0005).
//
// Git is walked only where an answer can change a count: for a verification record of an older
// version that names a number while the element's current criteria carry a key, or that names a key
// the current criteria lack (its text for SR-205 AK2). A key that the current criteria carry needs no
// Git. Without Git, in a shallow clone, or for a version Git does not have, the lookup gives nothing:
// such a number counts for no criterion (product owner decision, 2026-11-11, #1502), so the counts per
// criterion can depend on the depth of the clone. Elements with several copies (SR-088) are left out.
// The state is built again whenever the store or the records change (`carry`), from the walks the
// version dates keep per HEAD.
import { isDeepStrictEqual } from "node:util";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { CriterionRef, ElementRecord, ElementStore } from "../model/index.js";
import {
  acceptanceCriteriaKeyOf,
  criteriaItemsOf,
  criterionKey,
  currentVersionsOf,
  elementStoreState,
  formsOfEntry,
  sameVersion,
} from "../model/index.js";
import { versionValues } from "../model/version-date.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { OlderCriteria } from "./criteria.js";
import { NO_OLDER_CRITERIA } from "./criteria.js";
import type { EvidenceRecord } from "./record.js";
import { evidenceRecordsState } from "./state.js";

const lookupKey = (id: string, version: string): string => `${id}\n${version}`;

/** The items behind each lookup `olderCriteriaOf` built, for `sameOlderCriteria`. */
const entriesOf = new WeakMap<OlderCriteria, ReadonlyMap<string, readonly unknown[]>>();

/** No entries: the lookup `NO_OLDER_CRITERIA`, or one that was not built here. */
const NO_ENTRIES: ReadonlyMap<string, readonly unknown[]> = new Map();

/**
 * The UUIDs for which two lookups give other items for some version, or items for a version only
 * one of them knows: the elements whose status a carried status computes again (`verificationState`).
 */
export const changedOlderIds = (a: OlderCriteria, b: OlderCriteria): ReadonlySet<string> => {
  const changed = new Set<string>();
  if (a === b) {
    return changed;
  }
  const before = entriesOf.get(a) ?? NO_ENTRIES;
  const after = entriesOf.get(b) ?? NO_ENTRIES;
  const idOf = (key: string): string => key.slice(0, key.indexOf("\n"));
  for (const [key, items] of before) {
    // An entry `after` lacks compares unequal too (undefined).
    if (!isDeepStrictEqual(items, after.get(key))) {
      changed.add(idOf(key));
    }
  }
  for (const key of after.keys()) {
    if (!before.has(key)) {
      changed.add(idOf(key));
    }
  }
  return changed;
};

/** Whether two lookups give the same items for every UUID and version (a carried status stays valid). */
export const sameOlderCriteria = (a: OlderCriteria, b: OlderCriteria): boolean =>
  changedOlderIds(a, b).size === 0;

/** The criterion keys of current items, one set per items array (N-036: asked per record). */
const keySets = new WeakMap<readonly unknown[], ReadonlySet<string>>();

const keysOf = (items: readonly unknown[]): ReadonlySet<string> => {
  const known = keySets.get(items);
  if (known !== undefined) {
    return known;
  }
  const keys = new Set(items.map(criterionKey).filter((k) => k !== undefined));
  keySets.set(items, keys);
  return keys;
};

/**
 * Whether the criteria `refs` a verification record names can resolve otherwise through an older
 * version's items than without them: a number while the current items carry a key, or a key they lack.
 */
const needsOlder = (refs: readonly CriterionRef[], items: readonly unknown[]): boolean => {
  const keys = keysOf(items);
  return refs.some((ref) => (typeof ref === "number" ? keys.size > 0 : !keys.has(ref)));
};

/** The element of each verification record that `needsOlder`, with one copy in `store`. */
const candidates = (
  records: readonly EvidenceRecord[],
  store: ElementStore,
  key: string | undefined,
): { readonly record: EvidenceRecord; readonly element: ElementRecord }[] =>
  records.flatMap((record) => {
    const { criteria } = record;
    if (record.kind !== "verification" || criteria === undefined) {
      return [];
    }
    const [element, ...others] = store.byId.get(record.element) ?? [];
    return element === undefined ||
      others.length > 0 ||
      !needsOlder(criteria, criteriaItemsOf(element.data, key))
      ? []
      : [{ record, element }];
  });

/** The lookup of older criteria for `records` (see the file comment). */
export const olderCriteriaOf = async (
  workspace: Workspace,
  metamodel: Metamodel,
  store: ElementStore,
  records: readonly EvidenceRecord[],
): Promise<OlderCriteria> => {
  const key = acceptanceCriteriaKeyOf(metamodel);
  const found = metamodel.valid && key !== undefined ? candidates(records, store, key) : [];
  if (found.length === 0) {
    return NO_OLDER_CRITERIA;
  }
  const versions = await currentVersionsOf(
    workspace,
    found.map(({ element }) => element),
  );
  const older = found.filter(({ record, element }) => {
    const current = formsOfEntry(versions.get(element));
    return current === undefined || !sameVersion(record.version, current);
  });
  const asked = new Map<string, (typeof older)[number]>();
  for (const target of older) {
    asked.set(lookupKey(target.element.id, target.record.version), target);
  }
  if (asked.size === 0) {
    return NO_OLDER_CRITERIA;
  }
  const layout = await workspace.get(workspaceLayoutState);
  const targets = [...asked.values()];
  const values = await versionValues(
    { workspace, layout, metamodel },
    targets.map(({ record, element }) => ({
      repository: element.repository,
      file: element.file,
      id: element.id,
      version: record.version,
    })),
  );
  const items = new Map<string, readonly unknown[]>();
  targets.forEach(({ record, element }, i) => {
    const at = values[i];
    if (at !== undefined && at !== null) {
      items.set(lookupKey(element.id, record.version), criteriaItemsOf(at, key));
    }
  });
  if (items.size === 0) {
    return NO_OLDER_CRITERIA;
  }
  const lookup: OlderCriteria = (id, version) => items.get(lookupKey(id, version));
  entriesOf.set(lookup, items);
  return lookup;
};

/** `olderCriteriaOf` of the workspace's states. */
const build = async (workspace: Workspace): Promise<OlderCriteria> => {
  const [metamodel, store, records] = await Promise.all([
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
    workspace.get(evidenceRecordsState),
  ]);
  return olderCriteriaOf(workspace, metamodel, store, records);
};

/** The lookup of older criteria of the workspace's records (see the file comment). */
export const olderCriteriaState = defineWorkspaceState("older-criteria", build, {
  dependsOn: [metamodelState, elementStoreState, evidenceRecordsState, workspaceLayoutState],
  // Built again over a carried store or record (cheap where nothing names a number of an older
  // version), so the states that carry over the same change (`verificationState`) can carry too
  // and compare the lookups (`sameOlderCriteria`).
  carry: (_value, _change, workspace) => build(workspace),
});
