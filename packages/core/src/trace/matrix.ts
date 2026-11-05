// The traceability matrix of a selection (SR-125, N-076, D-062): "je Element eine Zeile und je
// Beziehungsart eine Spalte mit den verbundenen Elementen". The `trace.matrix` command is
// `matrixColumns` over the whole selection and `matrixRows` for one page of it.
//
// - Columns (AK2): a Beziehungsart is a relation kind of the metamodel (D-043, D-037); the relation
//   properties (packages, validity) are their own built-in meanings (D-012), so they form a column
//   only when `kinds` names them, and inline references never do (`matrixKeys`). One column per key
//   and direction that occurs in the selection: `out` is what the row element's file stores, `in`
//   what other elements store about it.
// - One enumerator for the counts and the cells (`outgoingItems`, `incomingRelations`), so the header
//   and the cells never disagree: the items of a key as the element view reads them (`relationItems`,
//   `hasId`, `isUuid`, as `relationsUnder`); the incoming relations of the index under a followed key
//   that point into the row element's repository, none while other files of that repository share
//   its UUID (SR-088), as `incomingOf` of the neighbourhood. In a view (SR-040) a link whose other end
//   is available and does not apply in it is left out of both; a missing or unreachable end cannot
//   be judged and stays.
// - Counts (SR-125 AK3, SR-153): `count` is the rows with at least one such link, whatever state its
//   other end is in. A gap is only what the metamodel requires (SR-153): the `out` column of a
//   relation kind with a minimum (`minimaOf`, `min` of 1 or more) for the row's type marks the row a
//   gap (`gaps`) when it undershoots one of them, counted as SR-152 counts (`limitCount`, one rule
//   with the hints; spec question #838); a minimum whose count an unreachable target leaves open is
//   neither gap nor met (Q5). In a view only the targets that apply count (Q3). Such a column has
//   `expected`, the rows of the whole selection with a minimum of its kind, `met`, those that meet
//   all of them, and `share`, `met / expected` (Q2); it is there even when no row has a link (Q1).
//   Every other column has `count` only, and an empty cell there is no gap. The pass reads the
//   records and the index only: no file, no version, a target lookup only in a view or under a
//   minimum.
// - Cells (AK2, AK4): of the page only, built by `relationLink` and `sourceLink`, the builders of
//   `element.get`, so a cell names short ID and title as the element view does. The current
//   versions are read for the page's rows and their available targets (`currentVersionsOf`), so a
//   page of a 50,000-element selection reads the files of the page only (N-036). `outdated` is the
//   rule of SR-025 (`isOutdatedVersion`): for `out` against the target's current version, for `in`
//   against the row element's, whichever column shows the link.
// - Evidence columns (SR-126): not a column type. The caller passes `rowFields`, which gives a row's
//   `testCases` and `verification` from the version this file read for it; this block imports no
//   evidence (`evidence/coverage.ts` imports trace), so the fields come from `evidence/matrix.ts`
//   through the command.
import type { DataExportRelation, MetamodelRelationKind, TraceMatrixOutput } from "../generated/types.js";
import type { Metamodel, Minima, RelationMinimum } from "../metamodel/index.js";
import { keyDefinition, minimaOf } from "../metamodel/index.js";
import type { ElementRecord, IncomingRelation, RelationKey, ShortIds, TargetItem } from "../model/index.js";
import {
  hasId,
  identifierField,
  isOutdatedVersion,
  isUuid,
  limitCount,
  limitedType,
  relationKey,
  relationLink,
  sourceLink,
  targetState,
  titleKeyOrEmpty,
} from "../model/index.js";
import type { TraceContext } from "./graph.js";
import type { VersionsOf } from "./neighbourhood.js";
import type { VersionForms } from "../model/index.js";
import { NORMAL_FORM } from "../model/index.js";

/** A key that makes columns of the matrix, with how the output names it. */
export interface MatrixKey {
  readonly key: string;
  readonly relation: RelationKey;
  /** The key of a property of kind `relation`, not of a relation kind (ADR-0004). */
  readonly property: boolean;
  readonly meaning: MetamodelRelationKind["meaning"];
  /** The name of the outgoing column. */
  readonly name: string;
  /** The name of the incoming column: the kind's `inverse-name`, else its `name`. */
  readonly inverseName: string;
}

/**
 * The keys that can make columns, in the order of the output: the relation kinds of `metamodel` in
 * its order, then the properties of kind `relation` in property order. Without `kinds`, the relation
 * kinds only (see the file comment); with it, the keys named (the caller has checked that each is a
 * key of `relationKeysOf`).
 */
export const matrixKeys = (metamodel: Metamodel, kinds: readonly string[] | undefined): MatrixKey[] => {
  const candidates = new Set([
    ...metamodel.relations.map((r) => r.key),
    ...metamodel.properties.filter((p) => p.kind === "relation").map((p) => p.key),
  ]);
  return [...candidates].flatMap((key): MatrixKey[] => {
    const found = keyDefinition(metamodel, key);
    const relation = relationKey(metamodel, key);
    if (found === undefined || relation === undefined) {
      return [];
    }
    if (kinds === undefined ? found.kind !== "relation" : !kinds.includes(key)) {
      return [];
    }
    const { definition } = found;
    return [
      found.kind === "relation"
        ? {
            key,
            relation,
            property: false,
            meaning: found.definition.meaning,
            name: definition.name,
            inverseName: found.definition["inverse-name"] ?? definition.name,
          }
        : {
            key,
            relation,
            property: true,
            meaning: undefined,
            name: definition.name,
            inverseName: definition.name,
          },
    ];
  });
};

/** What the matrix reads. */
export interface MatrixContext extends TraceContext {
  readonly shortIds: ShortIds;
  /** The keys of the columns that can occur (`matrixKeys`). */
  readonly keys: readonly MatrixKey[];
  /** The same keys as a set. */
  readonly followed: ReadonlySet<string>;
  /** Whether an element applies in the view of the selection (SR-040); undefined without a view. */
  readonly includes?: (element: ElementRecord) => boolean;
  /** The minima per type and relation kind (`minimaOf`, SR-153). */
  readonly minima: Minima;
}

/** The context of a matrix: `base` with the keys `matrixKeys` gives and, in a view, `includes`. */
export const matrixContext = (
  base: TraceContext,
  options: {
    readonly shortIds: ShortIds;
    readonly kinds: readonly string[] | undefined;
    readonly includes?: (element: ElementRecord) => boolean;
  },
): MatrixContext => {
  const keys = matrixKeys(base.metamodel, options.kinds);
  return {
    ...base,
    shortIds: options.shortIds,
    keys,
    followed: new Set(keys.map((k) => k.key)),
    minima: minimaOf(base.metamodel),
    ...(options.includes === undefined ? {} : { includes: options.includes }),
  };
};

const NONE: readonly never[] = Object.freeze([]);

/** The items under `key` in `record`, as `relationItems` reads them, without their paths. */
const itemsOf = (record: ElementRecord, key: MatrixKey): readonly unknown[] => {
  const value: unknown = record.data[key.key];
  if (value === undefined || value === null) {
    return NONE;
  }
  if (key.relation.many) {
    return Array.isArray(value) ? (value as readonly unknown[]) : NONE;
  }
  return Array.isArray(value) ? NONE : [value];
};

/**
 * Whether the matrix shows `item` of `record`: a target with a UUID (`relationsUnder`), except an
 * available one that does not apply in the view.
 */
const showsOutgoing = (context: MatrixContext, record: ElementRecord, item: unknown): item is TargetItem => {
  if (!hasId(item) || !isUuid(item.id)) {
    return false;
  }
  const { includes } = context;
  if (includes === undefined) {
    return true;
  }
  const state = targetState(context.layout, context.store, record.repository, item);
  return state.kind !== "available" || includes(state.element);
};

/**
 * Whether the matrix shows `link`, a relation of the index that points at `record`: a followed key
 * into the repository of `record`, from a source that applies in the view.
 */
const showsIncoming = (context: MatrixContext, record: ElementRecord, link: IncomingRelation): boolean =>
  link.repository === record.repository &&
  context.followed.has(link.key) &&
  (context.includes === undefined || context.includes(link.source));

/** Whether other files of the repository of `record` share its UUID (SR-088): no incoming relation is shown. */
const sharesUuid = (context: MatrixContext, { id, repository }: ElementRecord): boolean => {
  const records = context.store.byId.get(id);
  return (
    records !== undefined &&
    records.length > 1 &&
    records.filter((r) => r.repository === repository).length > 1
  );
};

/** The relations of the index that the matrix shows as pointing at `record` (see the file comment). */
const incomingRelations = (context: MatrixContext, record: ElementRecord): readonly IncomingRelation[] => {
  const links = context.incoming.relationsById.get(record.id);
  return links === undefined || sharesUuid(context, record)
    ? NONE
    : links.filter((link) => showsIncoming(context, record, link));
};

/** The items of `record` under `key` that the matrix shows. */
const outgoingItems = (
  context: MatrixContext,
  record: ElementRecord,
  key: MatrixKey,
): readonly TargetItem[] =>
  itemsOf(record, key).filter((item): item is TargetItem => showsOutgoing(context, record, item));

/** The minima of `record` by relation kind key (SR-153), undefined when it has none. */
const minimaOfRow = (
  context: MatrixContext,
  record: ElementRecord,
): ReadonlyMap<string, readonly RelationMinimum[]> | undefined => {
  if (context.minima.size === 0) {
    return undefined;
  }
  const type = limitedType(record, context.metamodel);
  return type === undefined ? undefined : context.minima.get(type.key);
};

/** A minimum of a row that its cell undershoots (SR-153 AK1). */
interface MinimumGap {
  readonly limit: RelationMinimum;
  readonly count: number;
}

/**
 * The minima of one kind that `record` undershoots (`gaps`) and whether it meets all of them
 * (`met`), counted as SR-152 counts (see the file comment). An undershot minimum with an
 * unreachable target is neither.
 */
const minimumGaps = (
  context: MatrixContext,
  record: ElementRecord,
  limits: readonly RelationMinimum[],
): { readonly gaps: readonly MinimumGap[]; readonly met: boolean } => {
  const gaps: MinimumGap[] = [];
  let met = true;
  for (const limit of limits) {
    const { count, unreachable } = limitCount(record, limit, context, context.includes);
    if (count < limit.min) {
      met = false;
      if (!unreachable) {
        gaps.push({ limit, count });
      }
    }
  }
  return { gaps, met };
};

/** A column of the matrix: a key in one direction and how many rows of the selection have a link in it. */
export interface MatrixColumn {
  readonly key: MatrixKey;
  readonly direction: "out" | "in";
  readonly count: number;
  /** The rows with a minimum of the kind (SR-153); 0 for a column without one. */
  readonly expected: number;
  /** The rows of `expected` that meet all of them. */
  readonly met: number;
}

/** The rows of the selection that have a link under a key, per direction, and its minima (SR-153). */
interface Tally {
  readonly key: MatrixKey;
  out: number;
  in: number;
  expected: number;
  met: number;
}

/** Whether `record` has a link under `key` that the matrix shows: `outgoingItems` without building them. */
const hasOutgoing = (context: MatrixContext, record: ElementRecord, key: MatrixKey): boolean => {
  for (const item of itemsOf(record, key)) {
    if (showsOutgoing(context, record, item)) {
      return true;
    }
  }
  return false;
};

/**
 * Counts for `record`, once per key, the relations in `links` (all point at `record`) that the
 * matrix shows. The ambiguity of `record` is looked up only when some relation is shown.
 */
const countIncoming = (
  context: MatrixContext,
  record: ElementRecord,
  links: readonly IncomingRelation[],
  byKey: ReadonlyMap<string, Tally>,
): void => {
  const counted: Tally[] = [];
  for (const link of links) {
    const tally = byKey.get(link.key);
    if (tally !== undefined && !counted.includes(tally) && showsIncoming(context, record, link)) {
      counted.push(tally);
    }
  }
  if (counted.length > 0 && !sharesUuid(context, record)) {
    for (const tally of counted) {
      tally.in += 1;
    }
  }
};

/**
 * The columns the selection `records` has (every key and direction with at least one row, and the
 * `out` column of a kind with a minimum for a row), with the rows that have a link in each and the
 * rows that meet its minima, over the whole selection. One pass over the records and the incoming
 * index (see the file comment).
 */
export const matrixColumns = (context: MatrixContext, records: readonly ElementRecord[]): MatrixColumn[] => {
  const tallies: Tally[] = context.keys.map((key) => ({ key, out: 0, in: 0, expected: 0, met: 0 }));
  const byKey = new Map(tallies.map((tally) => [tally.key.key, tally]));
  for (const record of records) {
    const minima = minimaOfRow(context, record);
    for (const tally of tallies) {
      if (hasOutgoing(context, record, tally.key)) {
        tally.out += 1;
      }
      const limits = tally.key.property ? undefined : minima?.get(tally.key.key);
      if (limits !== undefined) {
        tally.expected += 1;
        if (minimumGaps(context, record, limits).met) {
          tally.met += 1;
        }
      }
    }
    const links = context.incoming.relationsById.get(record.id);
    if (links !== undefined) {
      countIncoming(context, record, links, byKey);
    }
  }
  return tallies.flatMap(({ key, out, in: into, expected, met }) =>
    [
      { key, direction: "out" as const, count: out, expected, met },
      { key, direction: "in" as const, count: into, expected: 0, met: 0 },
    ].filter((column) => column.count > 0 || column.expected > 0),
  );
};

type MatrixOutputColumn = TraceMatrixOutput["columns"][number];
type MatrixOutputRow = TraceMatrixOutput["rows"][number];

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The column as the output gives it: `expected`, `met` and `share` only for a column with minima (SR-153). */
export const columnOutput = ({ key, direction, count, expected, met }: MatrixColumn): MatrixOutputColumn => ({
  type: "relation",
  kind: key.key,
  ...(key.property ? { property: true as const } : {}),
  ...(key.meaning === undefined ? {} : { meaning: key.meaning }),
  direction,
  name: direction === "out" ? key.name : key.inverseName,
  count,
  ...(expected === 0 ? {} : { expected, met, share: met / expected }),
});

/** The gaps of a row (SR-153 AK1): one per minimum of an `out` column that its cell undershoots. */
const rowGaps = (
  context: MatrixContext,
  record: ElementRecord,
  columns: readonly MatrixColumn[],
): NonNullable<MatrixOutputRow["gaps"]> => {
  const minima = minimaOfRow(context, record);
  if (minima === undefined) {
    return [];
  }
  return columns.flatMap(({ key, direction }, column) => {
    const limits = direction === "out" && !key.property ? minima.get(key.key) : undefined;
    return limits === undefined
      ? []
      : minimumGaps(context, record, limits).gaps.map(({ limit, count }) => ({
          column,
          targetType: limit.targetType,
          targetName: limit.targetName,
          count,
          min: limit.min,
        }));
  });
};

/** What a cell holds before the current versions are known. */
interface Pending {
  readonly link: DataExportRelation;
  /** The element whose current version the link is compared with: the target (out) or the row (in). */
  readonly other: ElementRecord | undefined;
}

/**
 * The fields a caller adds to a row (SR-126, see the file comment), from the row's element and the
 * current version read for it (undefined when it is not known).
 */
export type MatrixRowFields = (
  element: ElementRecord,
  current: VersionForms | undefined,
) => Pick<MatrixOutputRow, "testCases" | "verification">;

/** One row to build: its element, and with a derivation tree (`hierarchy`) its depth in it. */
export interface MatrixPlace {
  readonly element: ElementRecord;
  readonly depth?: number;
}

/**
 * The rows for `page`, in its order, with one cell per column (see the file comment). `versionsOf`
 * gives the current versions of the page's rows and of the available targets of their relations;
 * it is called once, with each element once. `rowFields`, when given, adds its fields to each row,
 * called once per row after that read.
 */
export const matrixRows = async (
  context: MatrixContext,
  page: readonly MatrixPlace[],
  columns: readonly MatrixColumn[],
  versionsOf: VersionsOf,
  rowFields?: MatrixRowFields,
): Promise<TraceMatrixOutput["rows"]> => {
  const { layout, store, shortIds, metamodel } = context;
  const titleKey = titleKeyOrEmpty(metamodel);
  const input = { layout, store, shortIds, titleKey };
  const built = page.map(({ element: record, depth }) => {
    const incoming = incomingRelations(context, record);
    const cells = columns.map(({ key, direction }): Pending[] => {
      const extra = key.property
        ? { property: true as const }
        : key.meaning === undefined
          ? {}
          : { meaning: key.meaning };
      if (direction === "in") {
        return incoming
          .filter((link) => link.key === key.key)
          .map((link) => ({
            link: sourceLink(input, link.source, key.key, link.item, extra),
            other: record,
          }));
      }
      return outgoingItems(context, record, key).map((item) => {
        const state = targetState(layout, store, record.repository, item);
        return {
          link: relationLink(input, record, key.key, item, extra),
          other: state.kind === "available" ? state.element : undefined,
        };
      });
    });
    return { record, depth, cells };
  });
  const needed = new Set<ElementRecord>(built.map(({ record }) => record));
  for (const { cells } of built) {
    for (const cell of cells) {
      for (const { other } of cell) {
        if (other !== undefined) {
          needed.add(other);
        }
      }
    }
  }
  const versionOf = await versionsOf([...needed]);
  return built.map(({ record, depth, cells }): MatrixOutputRow => {
    const status = text(record.data["status"]);
    const gaps = rowGaps(context, record, columns);
    return {
      id: record.id,
      repository: record.repository,
      shortId: shortIds.of(record),
      ...identifierField(shortIds, record),
      type: record.type,
      ...(status === "" ? {} : { status }),
      title: text(record.data[titleKey]),
      file: record.file,
      ...(depth === undefined ? {} : { depth }),
      ...rowFields?.(record, versionOf(record)),
      cells: cells.map((cell) =>
        cell.map(({ link, other }): DataExportRelation => {
          const current = other === undefined ? undefined : versionOf(other);
          return {
            ...link,
            ...(current === undefined ? {} : { currentVersion: current[NORMAL_FORM] }),
            outdated: isOutdatedVersion(link.storedVersion, current),
          };
        }),
      ),
      ...(gaps.length === 0 ? {} : { gaps }),
    };
  });
};
