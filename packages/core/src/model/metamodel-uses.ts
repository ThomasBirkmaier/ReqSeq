// The use of metamodel definitions by elements (SR-236 AK7, AK8): what locks a removal or a change
// that is only possible while nothing uses the definition. One pass over the element store in
// memory, no file read (N-036 names no threshold here). Every element counts, in any status (D-045).
//
// - A type is used by each element of that type.
// - A property by each element, of any type, also of a type the metamodel does not know, whose file
//   holds its key, also with an empty value: the use `metamodel.get` shows (SR-236 AK8) and the one
//   that locks its value kind and several values (`propertyUse`). Removing it from a type counts
//   only the elements of the types that lose it (`lostUses`), so that removal can succeed while
//   the shown count is above 0.
// - A fixed value (a choice) by each element whose value of the property is it or, for several
//   values, holds it, whatever the element's type.
// - A relation kind by each element whose file holds its key: a relation of the kind, or an empty list.
// - A status by each element with that status, of any type, also of a type the metamodel does not
//   know (SR-236 AK8), so a definition that stays after `metamodel.removeStatus` shows the number of
//   the elements that keep it (SR-240 AK3). Removing it from a type counts only the elements of the
//   types that lose it (`lostUses`), so that removal can succeed while the shown count is above 0.
//
// Each number is a number of elements (SR-224 AK4): `usingElements` gives the elements it counts, by
// the same rule as the count (`visitUses`), for `selection.output` of `metamodel.get`.
//
// The counts cover the elements the store could read on this machine; a change that needs them is
// refused while one may be missing (`refuseIncompleteStore`). `metamodelUsesState` keeps them until
// the store or the metamodel is replaced, as `metamodel.get` is asked at almost every step of the
// command prompt.
//
// A refusal names the number and the first 20 elements by short ID (code-unit order). A change that
// needs a count is refused while a repository of the workspace is not on this machine
// (`file.folder-missing`) or the store cannot read an element file (`file.faulty`), as the elements
// there are not known. The saved filters, perspectives and mapping files that name a removed key are
// listed, never changed (`mentioningFiles`).
import path from "node:path";
import { CommandError, matchesKey } from "../catalog.js";
import { listFolderFiles, readYamlFile } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { settingLocation } from "../workspace/index.js";
import type { MetamodelGetOutput, Problem } from "../generated/types.js";
import type { ElementRecord } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

/**
 * The uses of every definition, in metamodel order, as `metamodel.get` gives them: each definition is
 * there, 0 when unused (SR-236 AK8), and each number is a number of elements (SR-224 AK4).
 */
export type MetamodelUses = MetamodelGetOutput["uses"];

/** A list of `MetamodelUses`: the definitions of one kind with their numbers. */
export type UseList = keyof MetamodelUses;

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

/** How many elements, or element files, a refusal names. */
export const USES_NAMED = 20;

/** The choice keys of a value: one text, or the texts of a list. */
const choicesOf = (value: unknown): readonly string[] =>
  (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string");

/** Whether the file of `element` holds `key`, also with an empty value. */
export const holdsKey = (element: Pick<ElementRecord, "data">, key: string): boolean =>
  Object.hasOwn(element.data, key);

/** Whether `element` has the status `key`. */
export const hasStatus = (element: Pick<ElementRecord, "data">, key: string): boolean =>
  element.data["status"] === key;

/** The key a fixed value is counted under: its property and choice; any other definition by its own key. */
const valueKey = (property: string, choice: string): string => JSON.stringify([property, choice]);

/** The keys of the properties with choices, whose values are counted per choice. */
const choiceProperties = (metamodel: Metamodel): ReadonlySet<string> =>
  new Set(metamodel.properties.filter((p) => p.choices !== undefined).map((p) => p.key));

/**
 * Calls `visit` once for each definition `element` may use, by its list and its key (`valueKey` for a
 * fixed value), whether the metamodel defines it or not (see the file comment): the one rule both the
 * numbers and their elements follow (SR-224 AK4). A list that holds a choice twice uses it once.
 */
const visitUses = (
  element: ElementRecord,
  choices: ReadonlySet<string>,
  visit: (list: UseList, key: string) => void,
): void => {
  visit("types", element.type);
  // A status counts on every element with it, whatever its type (SR-236 AK8).
  const status = element.data["status"];
  if (typeof status === "string") {
    visit("statuses", status);
  }
  for (const key of Object.keys(element.data)) {
    // A property counts on every element whose file holds its key, whatever its type (SR-236 AK8).
    visit("properties", key);
    visit("relations", key);
    // A fixed value counts on every element with the value, whatever its type (SR-236 AK7).
    if (choices.has(key)) {
      for (const choice of new Set(choicesOf(element.data[key]))) {
        visit("values", valueKey(key, choice));
      }
    }
  }
};

/** The uses of every definition of `metamodel` by the elements of `store` (SR-236 AK7, AK8). */
export const metamodelUses = (store: ElementStore, metamodel: Metamodel): MetamodelUses => {
  const keyed = ({ key }: { readonly key: string }): { key: string; count: number } => ({ key, count: 0 });
  const uses = {
    types: metamodel.types.map(keyed),
    properties: metamodel.properties.map(keyed),
    values: metamodel.properties.flatMap((p) =>
      (p.choices ?? []).map((c) => ({ property: p.key, value: c.key, count: 0 })),
    ),
    relations: metamodel.relations.map(keyed),
    statuses: metamodel.statuses.map(keyed),
  };
  // The entry of each definition by its key (`valueKey` for a fixed value), in a map, so a key such as
  // `constructor` or `__proto__` of an element file never reads or writes what objects inherit.
  const byKey = <E extends { key: string }>(list: readonly E[]): Map<string, E> =>
    new Map(list.map((e) => [e.key, e]));
  const entries: Record<UseList, Map<string, { count: number }>> = {
    types: byKey(uses.types),
    properties: byKey(uses.properties),
    values: new Map(uses.values.map((e) => [valueKey(e.property, e.value), e])),
    relations: byKey(uses.relations),
    statuses: byKey(uses.statuses),
  };
  const choices = choiceProperties(metamodel);
  for (const element of store.elements) {
    visitUses(element, choices, (list, key) => {
      const entry = entries[list].get(key);
      if (entry !== undefined) {
        entry.count += 1;
      }
    });
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

/**
 * The elements the number of the entry `key` of the list `list` of `uses` counts (SR-224 AK4), by the
 * rule of the numbers (`visitUses`), in store order; none when `uses` has no such entry. `key` names a
 * fixed value by `property` and `value`, any other definition by `key`.
 */
export const usingElements = (
  store: ElementStore,
  metamodel: Metamodel,
  uses: MetamodelUses,
  list: UseList,
  key: Readonly<Record<string, unknown>>,
): readonly ElementRecord[] => {
  const [wanted] =
    list === "values"
      ? uses.values
          .filter((e) => matchesKey(e, key, ["property", "value"]))
          .map((e) => valueKey(e.property, e.value))
      : uses[list].filter((e) => matchesKey(e, key, ["key"])).map((e) => e.key);
  if (wanted === undefined) {
    return [];
  }
  const choices = choiceProperties(metamodel);
  return store.elements.filter((element) => {
    const used: string[] = [];
    visitUses(element, choices, (at, key) => {
      if (at === list) {
        used.push(key);
      }
    });
    return used.includes(wanted);
  });
};

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

/**
 * The use of the property `key` that locks a change of its value kind or several values (SR-236
 * AK7): each element, of any type, also of a type the metamodel does not know, whose file holds the
 * key, also with an empty value. The same number as `metamodel.get` shows (SR-236 AK8).
 */
export const propertyUse = (store: ElementStore, shortIds: ShortIds, key: string): Use =>
  useOf(store, shortIds, "property", key, (e) => holdsKey(e, key));

/**
 * The use of the fixed value `choice` of the property `property` (SR-236 AK7): each element whose
 * value of the property is it or, for several values, holds it, whatever the element's type.
 */
export const valueUse = (store: ElementStore, shortIds: ShortIds, property: string, choice: string): Use =>
  useOf(
    store,
    shortIds,
    "value",
    `${property}.${choice}`,
    (e) => holdsKey(e, property) && choicesOf(e.data[property]).includes(choice),
  );

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

/** A property or status definition that no type has any more and that stays, as elements hold it. */
export interface Kept {
  readonly kind: "property" | "status";
  readonly key: string;
  /** The elements that hold it, of any type: those of `elements`. */
  readonly count: number;
  /** The elements that hold it, in store order (SR-224 AK4). */
  readonly elements: readonly {
    readonly id: string;
    readonly shortId: string;
    readonly repository: string;
  }[];
}

/**
 * Splits the property and status definitions that no type has any more into those that go and those
 * that stay (SR-238 AK5, SR-240 AK3, SR-237 AK5): one stays while an element has the status or holds
 * the property key in its file, also with an empty value, whatever its type, also a type the
 * metamodel does not know. The store holds the elements of every repository of the workspace (a
 * missing one is refused before, `refuseIncompleteStore`). `kept` keeps the order of the input,
 * properties first.
 */
export const keptDefinitions = (
  store: ElementStore,
  shortIds: ShortIds,
  unhad: { readonly properties: readonly string[]; readonly statuses: readonly string[] },
): {
  readonly properties: readonly string[];
  readonly statuses: readonly string[];
  readonly kept: readonly Kept[];
} => {
  const kept: Kept[] = [];
  const drop = (kind: Kept["kind"], keys: readonly string[]): readonly string[] =>
    keys.filter((key) => {
      const elements = store.elements
        .filter((e) => (kind === "property" ? holdsKey(e, key) : hasStatus(e, key)))
        .map((e) => ({ id: e.id, shortId: shortIds.of(e), repository: e.repository }));
      if (elements.length > 0) {
        kept.push({ kind, key, count: elements.length, elements });
      }
      return elements.length === 0;
    });
  const properties = drop("property", unhad.properties);
  const statuses = drop("status", unhad.statuses);
  return { properties, statuses, kept };
};

/** The verb a note on a kept definition uses, by kind and by one element or more. */
const HOLD = {
  property: ["holds", "hold"],
  status: ["has", "have"],
} as const;

/**
 * The note on `kept`: `no type has the property remark any more, but its definition stays, as 2
 * elements hold it`; "" when empty.
 */
export const keptNote = (kept: readonly Kept[]): string =>
  kept
    .map(
      (k) =>
        `no type has the ${k.kind} ${k.key} any more, but its definition stays, as ${String(k.count)} ${
          k.count === 1 ? "element" : "elements"
        } ${HOLD[k.kind][k.count === 1 ? 0 : 1]} it`,
    )
    .join("; ");

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

/** An element file the store cannot read, by its repository and its path relative to it. */
export interface UnreadableFile {
  readonly repository: string;
  readonly file: string;
}

/** -1, 0 or 1 as `a` comes before, with or after `b` in code-unit order. */
const units = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The element files the store cannot read, by repository and path, each once: an error at a file
 * (faulty YAML header, conflict markers, an invalid `id` or `type`, a folder that cannot be listed,
 * SR-008 AK1, AK2), also when its header does not show whether it is an element, as `reqif.import`
 * counts them (SR-053 AK3).
 */
export const unreadableElementFiles = (problems: readonly Problem[]): readonly UnreadableFile[] => {
  const files = new Map<string, UnreadableFile>();
  for (const { severity, repository, file } of problems) {
    if (severity === "error" && file !== undefined) {
      const at = { repository: repository ?? "", file };
      files.set(JSON.stringify([at.repository, at.file]), at);
    }
  }
  return [...files.values()].sort((a, b) => units(a.repository, b.repository) || units(a.file, b.file));
};

/** `file` in a message: `repository:path`. */
const fileText = ({ repository, file }: UnreadableFile): string => `${repository}:${file}`;

/**
 * Refuses a change that needs a use count while the elements of the workspace are not all known
 * (SR-236 AK7, SR-008 AK3), and writes nothing:
 *
 * - while a repository of the workspace is not on this machine: `file.folder-missing` names the
 *   repository, also when an element file cannot be read as well;
 * - while the store cannot read an element file, which may hold the definition: `file.faulty` names
 *   the number of these files (`details.count`) and the first 20 by repository and path
 *   (`details.files`, each with repository and path), as `reqif.import` refuses (SR-053 AK3).
 */
export const refuseIncompleteStore = (
  layout: WorkspaceLayout,
  store: ElementStore,
  command: string,
): void => {
  const missing = layout.repositories.filter((r) => !r.available).map((r) => r.name);
  if (missing.length > 0) {
    throw new CommandError(
      "file.folder-missing",
      `${command} needs every element to count the uses, and the repository ${missing.join(", ")} is not on this machine; nothing is written`,
      { command, repository: missing[0], repositories: missing },
    );
  }
  const unreadable = unreadableElementFiles(store.problems);
  if (unreadable.length > 0) {
    const named = unreadable.slice(0, USES_NAMED);
    const count = unreadable.length;
    throw new CommandError(
      "file.faulty",
      `${command} needs every element to count the uses, and ${String(count)} element ${count === 1 ? "file" : "files"} cannot be read (${named.map(fileText).join(", ")}${count > named.length ? ", …" : ""}); nothing is written. Fix them first.`,
      { command, count, files: named },
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
