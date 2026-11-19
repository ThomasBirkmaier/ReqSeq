// The use of metamodel definitions by elements (SR-236 AK7, AK8): what locks a removal or a change
// that is only possible while nothing uses the definition. One pass over the element store in
// memory, no file read (N-036 names no threshold here). Every element counts, in any status (D-045).
//
// - A type is used by each element of that type.
// - A property by each element of a type that has it (own or inherited) whose file holds its key,
//   also with an empty value.
// - A fixed value (a choice) by each element whose value of the property is it or, for several
//   values, holds it, whatever the element's type.
// - A relation kind by each element whose file holds its key: a relation of the kind, or an empty list.
// - A status by each element of a type that has it with that status.
//
// The counts cover the elements of the repositories on this machine; a change that needs them is
// refused while one is missing (below). `metamodelUsesState` keeps them until the store or the
// metamodel is replaced, as `metamodel.get` is asked at almost every step of the command prompt.
//
// A refusal names the number and the first 20 elements by short ID (code-unit order). A change that
// needs a count is refused while a repository of the workspace is not on this machine, as its
// elements are not known (`file.folder-missing`). The saved filters, perspectives and mapping files
// that name a removed key are listed, never changed (`mentioningFiles`).
import path from "node:path";
import { CommandError } from "../catalog.js";
import { listFolderFiles, readYamlFile } from "../files/index.js";
import type { EffectiveType, Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { settingLocation } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

/** The uses of every definition, by key; each defined key is there, 0 when unused (SR-236 AK8). */
export interface MetamodelUses {
  readonly types: Record<string, number>;
  readonly properties: Record<string, number>;
  /** By property key, then by choice key; only properties with choices. */
  readonly values: Record<string, Record<string, number>>;
  readonly relations: Record<string, number>;
  readonly statuses: Record<string, number>;
}

/** The kinds of definitions a use is counted for. */
export type UseKind = "type" | "property" | "value" | "relation" | "status";

/** The use of one definition that locks a change: the number and the first 20 elements. */
export interface Use {
  readonly kind: UseKind;
  /** The definition's key; for a value `<property>.<choice>`. */
  readonly key: string;
  readonly count: number;
  /** Short IDs of the first 20 using elements, in code-unit order. */
  readonly elements: readonly string[];
}

/** How many elements a refusal names. */
export const USES_NAMED = 20;

const zeros = (keys: readonly { readonly key: string }[]): Record<string, number> =>
  Object.fromEntries(keys.map((d) => [d.key, 0]));

/** The choice keys of a value: one text, or the texts of a list. */
const choicesOf = (value: unknown): readonly string[] =>
  (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string");

/** Whether the file of `element` holds `key`, also with an empty value. */
export const holdsKey = (element: Pick<ElementRecord, "data">, key: string): boolean =>
  Object.hasOwn(element.data, key);

/** Whether `element` has the status `key`. */
export const hasStatus = (element: Pick<ElementRecord, "data">, key: string): boolean =>
  element.data["status"] === key;

/**
 * Adds one to `counts[key]` when the key is counted there: an own entry only, so a key such as
 * `constructor` or `__proto__` of an element file never reads or writes what objects inherit.
 */
const bump = (counts: Record<string, number>, key: string): void => {
  const count: unknown = Object.hasOwn(counts, key) ? counts[key] : undefined;
  if (typeof count === "number") {
    counts[key] = count + 1;
  }
};

/** Counts the uses of `element`, of the type `type` (undefined when the metamodel has none), into `uses`. */
const countElement = (uses: MetamodelUses, element: ElementRecord, type: EffectiveType | undefined): void => {
  if (type !== undefined) {
    bump(uses.types, type.key);
    for (const key of type.properties.filter((k) => holdsKey(element, k))) {
      bump(uses.properties, key);
    }
    const status = element.data["status"];
    if (typeof status === "string" && type.statuses.includes(status)) {
      bump(uses.statuses, status);
    }
  }
  for (const key of Object.keys(element.data)) {
    bump(uses.relations, key);
    // A fixed value counts on every element with the value, whatever its type (SR-236 AK7).
    const counts = Object.hasOwn(uses.values, key) ? uses.values[key] : undefined;
    if (counts !== undefined) {
      for (const choice of choicesOf(element.data[key])) {
        bump(counts, choice);
      }
    }
  }
};

/** The uses of every definition of `metamodel` by the elements of `store` (SR-236 AK7, AK8). */
export const metamodelUses = (store: ElementStore, metamodel: Metamodel): MetamodelUses => {
  const uses: MetamodelUses = {
    types: zeros(metamodel.types),
    properties: zeros(metamodel.properties),
    values: Object.fromEntries(
      metamodel.properties.flatMap((p) => (p.choices === undefined ? [] : [[p.key, zeros(p.choices)]])),
    ),
    relations: zeros(metamodel.relations),
    statuses: zeros(metamodel.statuses),
  };
  const typeOf = new Map<string, EffectiveType | undefined>();
  for (const element of store.elements) {
    if (!typeOf.has(element.type)) {
      typeOf.set(element.type, findType(metamodel, element.type));
    }
    countElement(uses, element, typeOf.get(element.type));
  }
  return uses;
};

/** The uses of the workspace's definitions (`metamodelUses`), until the store or the metamodel is replaced. */
export const metamodelUsesState = defineWorkspaceState(
  "metamodel-uses",
  async (workspace): Promise<MetamodelUses> =>
    metamodelUses(await workspace.get(elementStoreState), await workspace.get(metamodelState)),
  { dependsOn: [elementStoreState, metamodelState] },
);

/** The use of `key` (of `kind`) by the elements of `store` that pass `uses`. */
export const useOf = (
  store: ElementStore,
  shortIds: ShortIds,
  kind: UseKind,
  key: string,
  uses: (element: ElementRecord) => boolean,
): Use => {
  const users = store.elements.filter(uses).map((element) => shortIds.of(element));
  // Code-unit order, so every access names the same elements (SR-236 AK12).
  users.sort();
  return { kind, key, count: users.length, elements: users.slice(0, USES_NAMED) };
};

/** The keys of `type` and of every type that extends it, over any number of levels. */
export const withSubtypes = (metamodel: Metamodel, type: string): ReadonlySet<string> =>
  new Set(
    metamodel.effectiveTypes.filter((t) => t.key === type || t.ancestors.includes(type)).map((t) => t.key),
  );

/**
 * The uses of the properties and statuses that the types in `scope` have under `before` but not
 * under `after` (SR-237 AK4, SR-238 AK5, SR-240 AK3), each counted over the elements of those types
 * that lose it; in the order of the definitions of `before`. Unused ones are left out.
 */
export const lostUses = (
  store: ElementStore,
  shortIds: ShortIds,
  before: Metamodel,
  after: Metamodel,
  scope: ReadonlySet<string>,
): readonly Use[] => {
  const holding = (metamodel: Metamodel, key: string, of: "properties" | "statuses"): ReadonlySet<string> =>
    new Set(
      metamodel.effectiveTypes.filter((t) => scope.has(t.key) && t[of].includes(key)).map((t) => t.key),
    );
  const lost = (key: string, of: "properties" | "statuses"): ReadonlySet<string> => {
    const has = holding(after, key, of);
    return new Set([...holding(before, key, of)].filter((type) => !has.has(type)));
  };
  const uses: Use[] = [];
  for (const { key } of before.properties) {
    const types = lost(key, "properties");
    if (types.size > 0) {
      uses.push(useOf(store, shortIds, "property", key, (e) => types.has(e.type) && holdsKey(e, key)));
    }
  }
  for (const { key } of before.statuses) {
    const types = lost(key, "statuses");
    if (types.size > 0) {
      uses.push(useOf(store, shortIds, "status", key, (e) => types.has(e.type) && hasStatus(e, key)));
    }
  }
  return uses.filter((use) => use.count > 0);
};

/** `use` in words: `property title: 3 elements (SR-1a2b3c, …)`. */
const useText = (use: Use): string =>
  `${use.kind} ${use.key}: ${String(use.count)} ${use.count === 1 ? "element" : "elements"} (${use.elements.join(", ")}${use.count > use.elements.length ? ", …" : ""})`;

/**
 * Refuses `what` (`Type risk cannot be removed`) when any of `uses` has a count or `named` names a
 * definition, with `input.invalid`, reason `in-use`, the uses and the names in `details`, and
 * nothing written (SR-236 AK7, SR-237 AK5).
 */
export const refuseUses = (what: string, uses: readonly Use[], named: readonly string[] = []): void => {
  const used = uses.filter((use) => use.count > 0);
  if (used.length === 0 && named.length === 0) {
    return;
  }
  throw new CommandError("input.invalid", `${what}: ${[...named, ...used.map(useText)].join("; ")}`, {
    reason: "in-use",
    uses: used,
    ...(named.length === 0 ? {} : { named }),
  });
};

/**
 * Refuses a change that needs a use count while a repository of the workspace is not on this
 * machine: its elements are not known (SR-236 AK7). `file.folder-missing` names the repository.
 */
export const refuseMissingRepositories = (layout: WorkspaceLayout, command: string): void => {
  const missing = layout.repositories.filter((r) => !r.available).map((r) => r.name);
  if (missing.length > 0) {
    throw new CommandError(
      "file.folder-missing",
      `${command} needs every element to count the uses, and the repository ${missing.join(", ")} is not on this machine; nothing is written`,
      { command, repository: missing[0], repositories: missing },
    );
  }
};

/** Whether `data` holds `keys` as a mapping key or text value, except the top-level `name` and `description`. */
const names = (data: unknown, keys: ReadonlySet<string>, top: boolean): boolean => {
  if (typeof data === "string") {
    return keys.has(data);
  }
  if (Array.isArray(data)) {
    return data.some((item) => names(item, keys, false));
  }
  if (data === null || typeof data !== "object") {
    return false;
  }
  return Object.entries(data).some(
    ([key, value]) =>
      !(top && (key === "name" || key === "description")) && (keys.has(key) || names(value, keys, false)),
  );
};

/**
 * The saved filters, perspectives and mapping files (`.yaml` directly in their folders) that name
 * one of `keys` (SR-236 AK7), relative to the workspace root with `/`, in that order of folders,
 * then by file name. A key counts as named where it is a mapping key or a text value anywhere in
 * the file, except the file's own `name` and `description`, so a file may be listed whose value
 * only spells the key. Files that do not read as YAML and folders that are missing are left out.
 */
export const mentioningFiles = async (
  layout: WorkspaceLayout,
  keys: ReadonlySet<string>,
): Promise<readonly string[]> => {
  const found: string[] = [];
  for (const setting of ["filters", "perspectives", "mappings"] as const) {
    const location = settingLocation(layout, setting);
    const repository = layout.repositories.find((r) => r.name === location.repository && r.available);
    if (repository === undefined) {
      continue;
    }
    const folder = path.resolve(repository.folder, location.path);
    // Within its repository only: a folder linked out of it is not read (`listFolderFiles` with a root).
    const listing = await listFolderFiles(folder, repository.folder);
    if (listing.kind !== "names") {
      continue;
    }
    for (const name of listing.names.filter((n) => n.endsWith(".yaml"))) {
      const read = await readYamlFile(folder, name);
      if (read.kind === "parsed" && names(read.file.data, keys, true)) {
        found.push(path.relative(layout.root, path.join(folder, name)).split(path.sep).join("/"));
      }
    }
  }
  return found;
};
