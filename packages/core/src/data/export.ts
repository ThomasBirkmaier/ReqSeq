// The data of a state as JSON (SR-061, `data-export.schema.json`, D-008): what `data.export` gives
// and, with SR-062, what `data.store` writes. Read only: nothing is written and no status is set
// (D-030); Git is only read for the commit of each repository (`repositoryCommit`, ADR-0006).
//
// - Elements (AK1, assumption A3 of #590 Q1): every element of the selection in store order, the
//   superseded ones included (D-045), each as `element.list` gives it (`listElements`: properties
//   with unknown keys, own relations, property relations and the successors' relations, current
//   `version`, `problems` of an element without version), with:
//   - `verification`: the core and every variant it applies in, whatever view selected it (A2), and
//     `validation` (SR-038), from `withEvidenceStatus`, the one status source of evidence.status and
//     element.get (SR-080 AK2);
//   - `validity`: the UUIDs of the variants its property with the meaning `validity` names, `[]`
//     for the core and all variants (SR-040 AK1, D-020); left out without such a property;
//   - `packages`: the UUIDs of the packages its property with the meaning `packages` names, `[]` for
//     none; left out without such a property;
//   - each relation with the current version of its other end (`currentVersion`, when it is
//     available and has one) and `outdated` (SR-025, `isOutdatedVersion`), as trace.matrix gives
//     them: an outgoing relation against its target, an incoming one (a successor's) against the
//     element itself. A relation whose target is outside the selection is still measured, so a
//     narrowed export tells outdated links too.
//   Not in it: the text, other incoming relations (each relation is at its source), the version
//   date (D-013 is about display; Git history per element is too slow at N-036), the records.
// - Header (A5): `generated` = the time of the call (UTC, seconds); `selection` as given;
//   `repositories`: each of the workspace file with `available` and, when Git tells it, `commit`
//   (`dirty` comes with SR-062, #531 Q2); `incomplete` (SR-006 AK2): the selection is incomplete or an
//   evidence location is in a repository that is not on this machine.
// - Workspace problems (A6): the schema has no place for them. Element problems stay in
//   `elements[].problems`; a repository, evidence location or baselines folder that is not here sets
//   `incomplete`; layout, metamodel and record problems and a refused Git (`git.unavailable`, then
//   there is no `commit`) are left to `workspace check`. A broken workspace is exported (#590 Q3).
// - A baseline selection exports the elements as they are now: one changed since the baseline has
//   another `version` than the baseline lists, and nothing marks it (A1, #530 Q4).
// Cost (N-036): the versions of the selection are read once (`listElements`), those the status needs
// in one batch (`verificationState`), and those of relation targets outside the selection in one
// more batch, none when there is no such target. No paging: one call gives the whole selection.
import type {
  DataExportElement,
  DataExportFile,
  DataExportOutput,
  DataExportRelation,
  ElementSelection,
} from "../generated/types.js";
import type { VersionReader } from "../evidence/index.js";
import { evidenceReadState, withEvidenceStatus, workspaceStatus } from "../evidence/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { propertyWithMeaning } from "../metamodel/index.js";
import type { CurrentVersion, ElementRecord, ElementStore } from "../model/index.js";
import {
  currentVersionsOf,
  isOutdatedVersion,
  isUuid,
  listElements,
  relationKey,
  repositoryCommit,
} from "../model/index.js";
import type { Selected } from "../query/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { Validity } from "../variants/index.js";
import { validityEntries, validityOf, validityTarget } from "../variants/index.js";
import { workspaceLayoutState } from "../workspace/index.js";

/** The relation properties `exportedElement` gives as lists of UUIDs. */
export interface ExportedProperties {
  readonly validity: Pick<Validity, "key" | "many"> | undefined;
  readonly packages: Pick<Validity, "key" | "many"> | undefined;
}

/** The property with the meaning `packages`, when it holds relations (as `validityOf` reads the validity). */
const packagesOf = (metamodel: Metamodel): Pick<Validity, "key" | "many"> | undefined => {
  const property = propertyWithMeaning(metamodel, "packages");
  const relation = property === undefined ? undefined : relationKey(metamodel, property.key);
  return property === undefined || relation === undefined
    ? undefined
    : { key: property.key, many: relation.many };
};

/** The relation properties of `metamodel` that `exportedElement` gives (see the file comment). */
export const exportedProperties = (metamodel: Metamodel): ExportedProperties => ({
  validity: validityOf(metamodel),
  packages: packagesOf(metamodel),
});

/** The UUIDs the entries of `property` in `record` name, in their order; entries that name none are left out. */
const targetIds = (property: Pick<Validity, "key" | "many">, record: ElementRecord): string[] =>
  validityEntries(property, record).flatMap((entry) => {
    const target = validityTarget(entry.value, record);
    return target !== undefined && isUuid(target.id) ? [target.id] : [];
  });

/** `element` (listed from `record`) with `validity` and `packages` (see the file comment). */
export const exportedElement = (
  properties: ExportedProperties,
  record: ElementRecord,
  element: DataExportElement,
): DataExportElement => ({
  ...element,
  ...(properties.validity === undefined ? {} : { validity: targetIds(properties.validity, record) }),
  ...(properties.packages === undefined ? {} : { packages: targetIds(properties.packages, record) }),
});

/** The key of an element by repository and UUID. */
const placeOf = (element: { readonly repository: string; readonly id: string }): string =>
  `${element.repository}\u0000${element.id}`;

/**
 * `listed` (elements of `store`, as listed) with `currentVersion` and `outdated` on every relation
 * (see the file comment): the versions of the listed elements as listed, those of available
 * targets outside them read with `read` in one call, none when there is none. A second pass over
 * the listed elements, since a target can come later in store order than its source.
 */
export const withRelationVersions = async (
  store: ElementStore,
  listed: readonly DataExportElement[],
  read: VersionReader,
): Promise<DataExportElement[]> => {
  const own = new Map(listed.map((element) => [placeOf(element), element.version]));
  // The other end of each relation: the element itself for an incoming relation (a successor's),
  // the target for an outgoing one that is available (exactly one element with its UUID there).
  const linked = listed.map((element) => ({
    element,
    links: element.relations.map((relation) => ({
      relation,
      end:
        relation.direction === "in"
          ? ("self" as const)
          : relation.targetState === "available"
            ? store.byId.get(relation.id)?.find((e) => e.repository === relation.repository)
            : undefined,
    })),
  }));
  const outside = new Set<ElementRecord>();
  for (const { links } of linked) {
    for (const { end } of links) {
      if (end !== undefined && end !== "self" && !own.has(placeOf(end))) {
        outside.add(end);
      }
    }
  }
  const found: ReadonlyMap<ElementRecord, CurrentVersion> =
    outside.size === 0 ? new Map() : await read([...outside]);
  const versionOf = (end: ElementRecord): string | undefined => {
    const place = placeOf(end);
    if (own.has(place)) {
      return own.get(place);
    }
    const entry = found.get(end);
    return entry?.kind === "version" ? entry.version : undefined;
  };
  return linked.map(({ element, links }) => ({
    ...element,
    relations: links.map(({ relation, end }): DataExportRelation => {
      const current = end === undefined ? undefined : end === "self" ? element.version : versionOf(end);
      return {
        ...relation,
        ...(current === undefined ? {} : { currentVersion: current }),
        outdated: isOutdatedVersion(relation.storedVersion, current),
      };
    }),
  }));
};

/** The time of the export: UTC, in seconds (`common.schema.json#/$defs/dateTime`). */
export const exportTime = (now: Date): string => `${now.toISOString().slice(0, 19)}Z`;

/** The header of the export: everything but `elements` (see the file comment). */
export const exportHeader = (input: {
  readonly name: string;
  readonly generated: string;
  readonly selection: ElementSelection | undefined;
  readonly repositories: readonly {
    readonly name: string;
    readonly available: boolean;
    readonly commit?: string;
  }[];
  readonly incomplete: boolean;
}): Omit<DataExportFile, "elements"> => ({
  "logreq-data": 1,
  workspace: input.name,
  generated: input.generated,
  ...(input.selection === undefined ? {} : { selection: input.selection }),
  repositories: input.repositories.map(({ name, available, commit }) => ({
    name,
    available,
    ...(commit === undefined ? {} : { commit }),
  })),
  incomplete: input.incomplete,
});

/** How `exportData` reads what it does not get from the workspace (tests). */
export interface ExportOptions {
  /** Reads the versions of relation targets outside the selection; default `currentVersionsOf`. */
  readonly read?: VersionReader;
  /** The time of the export; default now. */
  readonly now?: () => Date;
}

/** The data of the elements `selected` selected in `workspace`, for the input `selection` (see the file comment). */
export const exportData = async (
  workspace: Workspace,
  selected: Selected,
  selection: ElementSelection | undefined,
  options: ExportOptions = {},
): Promise<DataExportOutput> => {
  const generated = exportTime((options.now ?? (() => new Date()))());
  const layout = await workspace.get(workspaceLayoutState);
  const status = await workspaceStatus(workspace, selected.elements);
  const properties = exportedProperties(selected.metamodel);
  const listed = await listElements(workspace, selected, selected.elements, {
    extend: (record, element) =>
      exportedElement(properties, record, withEvidenceStatus(status, record, element)),
  });
  const read = options.read ?? ((records) => currentVersionsOf(workspace, records));
  const [elements, repositories, evidence] = await Promise.all([
    withRelationVersions(selected.store, listed, read),
    Promise.all(
      layout.repositories.map(async (repository) =>
        repository.available
          ? { name: repository.name, available: true, ...(await repositoryCommit(repository)) }
          : { name: repository.name, available: false },
      ),
    ),
    workspace.get(evidenceReadState),
  ]);
  return {
    ...exportHeader({
      name: layout.name,
      generated,
      selection,
      repositories,
      incomplete: selected.incomplete || evidence.incomplete,
    }),
    elements,
  };
};
