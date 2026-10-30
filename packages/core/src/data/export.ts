// The data of a state as JSON (SR-061, `data-export.schema.json`, D-008): what `data.export` gives
// and, with SR-062, what `data.store` writes. Read only: nothing is written and no status is set
// (D-030); Git is only read for the commit of each repository and whether its files differ from it
// (`repositoryState`, model/uncommitted.ts, ADR-0006).
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
//   - `replacedBy` and `excludedBy` of a core requirement: the variants that replace it (with the
//     replacement) or exclude it by the view rule, whatever view selected it (SR-046 AK3,
//     `replacedExcludedOf`, as element.get gives them); left out when empty;
//   - each relation with the current version of its other end (`currentVersion`, when it is
//     available and has one) and `outdated` (SR-025, `isOutdatedVersion`), as trace.matrix gives
//     them: an outgoing relation against its target, an incoming one (a successor's) against the
//     element itself. A relation whose target is outside the selection is still measured, so a
//     narrowed export tells outdated links too.
//   Not in it: the text, other incoming relations (each relation is at its source), the version
//   date (D-013 is about display; Git history per element is too slow at N-036), the records.
// - Header (A5): `reqseq-data` 2; `commit`, HEAD of the main repository, and `dirty`, false only when
//   every available repository has a known commit and is known clean (the state data.store names
//   its file after; both also on every line of the JSON Lines form, `$defs/line`, #319);
//   `generated` = the time of the call (UTC, seconds); `selection` as given;
//   `repositories`: each of the workspace file with `available` and, when Git tells it, `commit`
//   and `dirty` (SR-062, #531 Q2: uncommitted changes to the files the data is made of, by content);
//   `incomplete` (SR-006 AK2): the selection is incomplete or an evidence location is in a repository
//   that is not on this machine.
// - Workspace problems (A6): the schema has no place for them. Element problems stay in
//   `elements[].problems`; a repository or evidence location that is not here sets `incomplete`. A
//   baselines folder that is not here holds no baseline, so `selection.baseline` is `input.invalid`
//   with the reason (query/selection.ts), never an empty export. Layout, metamodel and record
//   problems are left to `workspace check`, and an unknown Git state (no `commit` or no `dirty`) to
//   `data.store`, which reports it as `git.unavailable` (`exportDataWithProblems`). A broken
//   workspace is exported (#590 Q3).
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
import type { Problem } from "../catalog.js";
import type { GitUnknownReason } from "../git/reader.js";
import type {
  CurrentVersion,
  CurrentVersions,
  ElementRecord,
  ElementStore,
  RepositoryState,
  StateReader,
} from "../model/index.js";
import {
  currentVersions,
  currentVersionsOf,
  NO_COMMIT_TEXT,
  isOutdatedVersion,
  isUuid,
  listElements,
  relationKey,
  repositoryState,
  stateRules,
} from "../model/index.js";
import type { Selected } from "../query/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { ReplacedExcluded, Validity } from "../variants/index.js";
import { replacedExcludedOf, validityEntries, validityOf, validityTarget } from "../variants/index.js";
import type { RepositoryLocation } from "../workspace/index.js";
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
export const targetIds = (property: Pick<Validity, "key" | "many">, record: ElementRecord): string[] =>
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

/** `element` with `replacedBy` and `excludedBy` from `uses` (SR-046 AK3), each left out when empty. */
export const withReplacedExcluded = (
  uses: ReplacedExcluded,
  element: DataExportElement,
): DataExportElement => ({
  ...element,
  ...(uses.replacedBy.length === 0
    ? {}
    : { replacedBy: uses.replacedBy.map((u) => ({ variant: u.variant.id, replacement: u.replacement.id })) }),
  ...(uses.excludedBy.length === 0 ? {} : { excludedBy: uses.excludedBy.map((v) => v.id) }),
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
  /** The name of the main repository (the one with the workspace file): its commit is `commit`. */
  readonly main: string;
  readonly generated: string;
  readonly selection: ElementSelection | undefined;
  readonly repositories: readonly {
    readonly name: string;
    readonly available: boolean;
    readonly commit?: string;
    readonly dirty?: boolean;
  }[];
  readonly incomplete: boolean;
}): Omit<DataExportFile, "elements"> => {
  const commit = input.repositories.find((r) => r.name === input.main)?.commit;
  return {
    "reqseq-data": 3,
    ...(commit === undefined ? {} : { commit }),
    dirty: !input.repositories.every((r) => !r.available || r.dirty === false),
    workspace: input.name,
    generated: input.generated,
    ...(input.selection === undefined ? {} : { selection: input.selection }),
    repositories: input.repositories.map(({ name, available, commit, dirty }) => ({
      name,
      available,
      ...(commit === undefined ? {} : { commit }),
      ...(dirty === undefined ? {} : { dirty }),
    })),
    incomplete: input.incomplete,
  };
};

/** How `exportData` reads what it does not get from the workspace (tests). */
export interface ExportOptions {
  /** Reads the versions of relation targets outside the selection; default `currentVersionsOf`. */
  readonly read?: VersionReader;
  /** The time of the export; default now. */
  readonly now?: () => Date;
  /** Reads Git and the disk for `dirty`; default `DEFAULT_STATE_READER` (model/uncommitted.ts). */
  readonly state?: StateReader;
}

/** Why Git cannot tell `dirty`, in words (`GitUnknownReason`). */
const DIRTY_UNKNOWN_TEXT: Readonly<Record<GitUnknownReason, string>> = {
  "no-git": NO_COMMIT_TEXT["no-git"],
  refused: NO_COMMIT_TEXT.refused,
  timeout: NO_COMMIT_TEXT.timeout,
  "not-a-repository": "git failed",
};

/**
 * The `git.unavailable` warning of an available repository whose state is not known in full: no
 * commit, or a commit without `dirty`; undefined when both are known. `data.store` names the file
 * `-dirty` then (SR-062 K2).
 */
const stateProblem = (name: string, state: RepositoryState): Problem | undefined => {
  const why =
    state.unknown === undefined
      ? state.dirtyUnknown === undefined
        ? undefined
        : `Git cannot tell whether repository ${name} has uncommitted changes (${DIRTY_UNKNOWN_TEXT[state.dirtyUnknown]})`
      : `The commit of repository ${name} is unknown (${NO_COMMIT_TEXT[state.unknown]})`;
  return why === undefined
    ? undefined
    : {
        code: "git.unavailable",
        severity: "warning",
        repository: name,
        message: `${why}; a stored state is marked dirty`,
      };
};

/** The files elements of `versions` embed, per repository: relative to it with `/`, in NFC. */
const embedsOf = (versions: CurrentVersions): ReadonlyMap<string, ReadonlySet<string>> => {
  const embeds = new Map<string, Set<string>>();
  for (const [record, entry] of versions.byRecord) {
    if (entry.kind === "version") {
      for (const image of entry.images) {
        if (image.found !== "nested") {
          const files = embeds.get(record.repository) ?? new Set();
          files.add(image.names.join("/").normalize("NFC"));
          embeds.set(record.repository, files);
        }
      }
    }
  }
  return embeds;
};

/** One repository of the header with its state (an available one) and its problem. */
interface StatedRepository {
  readonly repository: RepositoryLocation;
  readonly state?: RepositoryState;
}

/** What `data.store` needs beyond the data (SR-062). */
export interface ExportWithProblems {
  readonly data: DataExportOutput;
  /** `git.unavailable` warnings, and the missing repositories when the data is incomplete. */
  readonly problems: readonly Problem[];
  /** Every available repository has a known commit and is known clean. */
  readonly clean: boolean;
}

/** The state of each repository of `workspace` (see `repositoryState`). */
const repositoryStates = async (
  workspace: Workspace,
  selected: Selected,
  state: StateReader | undefined,
): Promise<StatedRepository[]> => {
  const layout = await workspace.get(workspaceLayoutState);
  const embeds = embedsOf(await currentVersions(workspace));
  return Promise.all(
    layout.repositories.map(async (repository): Promise<StatedRepository> => {
      if (!repository.available) {
        return { repository };
      }
      const rules = stateRules(layout, repository, embeds.get(repository.name) ?? new Set());
      const elements = selected.store.elements
        .filter((record) => record.repository === repository.name)
        .map((record) => record.file);
      return { repository, state: await repositoryState(rules, elements, state) };
    }),
  );
};

/**
 * `exportData`, and the problems and the name rule `data.store` gives with it (SR-062 K2, K6): a
 * `git.unavailable` warning per available repository whose commit or `dirty` is unknown, and the
 * `workspace.repository-missing` infos of the layout when the data is incomplete.
 */
export const exportDataWithProblems = async (
  workspace: Workspace,
  selected: Selected,
  selection: ElementSelection | undefined,
  options: ExportOptions = {},
): Promise<ExportWithProblems> => {
  const generated = exportTime((options.now ?? (() => new Date()))());
  const layout = await workspace.get(workspaceLayoutState);
  const status = await workspaceStatus(workspace, selected.elements);
  const properties = exportedProperties(selected.metamodel);
  const rule = { workspace, store: selected.store, metamodel: selected.metamodel };
  const listed = await listElements(workspace, selected, selected.elements, {
    extend: (record, element) =>
      withReplacedExcluded(
        replacedExcludedOf(rule, record),
        exportedElement(properties, record, withEvidenceStatus(status, record, element)),
      ),
  });
  const read = options.read ?? ((records) => currentVersionsOf(workspace, records));
  const [elements, stated, evidence] = await Promise.all([
    withRelationVersions(selected.store, listed, read),
    repositoryStates(workspace, selected, options.state),
    workspace.get(evidenceReadState),
  ]);
  const incomplete = selected.incomplete || evidence.incomplete;
  const data = {
    ...exportHeader({
      name: layout.name,
      main: layout.main,
      generated,
      selection,
      repositories: stated.map(({ repository, state }) => ({
        name: repository.name,
        available: repository.available,
        ...(state?.commit === undefined ? {} : { commit: state.commit }),
        ...(state?.dirty === undefined ? {} : { dirty: state.dirty }),
      })),
      incomplete,
    }),
    elements,
  };
  const problems = [
    ...stated.flatMap(({ repository, state }) => {
      const problem = state === undefined ? undefined : stateProblem(repository.name, state);
      return problem === undefined ? [] : [problem];
    }),
    ...(incomplete ? layout.problems.filter((p) => p.code === "workspace.repository-missing") : []),
  ];
  return { data, problems, clean: !data.dirty };
};

/** The data of the elements `selected` selected in `workspace`, for the input `selection` (see the file comment). */
export const exportData = async (
  workspace: Workspace,
  selected: Selected,
  selection: ElementSelection | undefined,
  options: ExportOptions = {},
): Promise<DataExportOutput> => (await exportDataWithProblems(workspace, selected, selection, options)).data;
