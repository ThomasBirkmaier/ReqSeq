// Level 2 of the status model (#1396): a generated workspace as it is written to disk, and the model's reading of it.
// `statusModelFileWorkspace` adds to a workspace of `statusModelWorkspace` what only files have: the files of one UUID
// with criteria and a version of their own (R4), the version a current record was written against (one of the UUID's
// files), both version forms, Markdown or JUnit, two evidence locations, CRLF files and records the reader refuses.
// `modelOfFiles` (rules R4, R5 in README.md) turns it into the workspace the model reads. Pure, so a seed replays a
// case and shrinking works.
import fc from "fast-check";
import { UNREADABLE_DATE, criteriaArbitrary, renderDate } from "./generator.js";
import { CURRENT, type ModelCriterion, type ModelRecord, instantOf } from "./model.js";
import { statusModelWorkspace } from "./workspace-generator.js";
import type { ModelWorkspace, ModelWorkspaceElement } from "./workspace-model.js";

/** Why the reader refuses a record (R5); `unreadable-date` comes from the base generator's dates. */
export type ModelRefusal =
  "inconclusive-verification" | "validation-with-variant" | "inconclusive-without-reason" | "unreadable-date";

export interface ModelFileRecord {
  readonly record: ModelRecord;
  /** For a current record: the file of the UUID (position among its files) whose version it names. */
  readonly pin: number;
  readonly form: "n1" | "n2";
  /** JUnit only for a verification record the reader takes; anything else is written as Markdown. */
  readonly format: "markdown" | "junit";
  /** Evidence location: 0 the main repository's, 1 the other's. Validation records lie in 0 (A6 index order). */
  readonly location: 0 | 1;
  readonly crlf: boolean;
  /** Set when the reader refuses the record (R5): the generator wrote it so. */
  readonly refusal?: ModelRefusal;
}

export interface ModelFileWorkspace {
  readonly base: ModelWorkspace;
  /** Per element (same index): its own criteria when they differ from the UUID's first file (twins, R4). */
  readonly criteria: readonly (readonly ModelCriterion[] | undefined)[];
  /** Per element file: written with CRLF line ends. */
  readonly crlf: readonly boolean[];
  /** The records written per UUID, in file order (their position names the file). */
  readonly records: Readonly<Record<string, readonly ModelFileRecord[]>>;
}

/** The version a pinned current record names that is not this file's: an older version without known criteria. */
export const TWIN_VERSION = "twin";

/** The files of `id`, in element order. */
export function filesOf(base: ModelWorkspace, id: string): ModelWorkspaceElement[] {
  return base.elements.filter((element) => element.id === id);
}

/** Why the reader refuses `file`, if it does (R5). */
export function refusalOf(file: ModelFileRecord): ModelRefusal | undefined {
  return file.refusal ?? (file.record.date === UNREADABLE_DATE ? "unreadable-date" : undefined);
}

// R4, R5, V13 (SR-031 AK11, SR-038 AK4, SR-172 AK1, AK3; ADR-0012 "Which records count"): what the model reads of the
// files. Each file gets its own criteria; the records of its UUID that the reader takes, in index order (newest first,
// then file, A6); a current record names this file's version only when written against it, else it is a record of an
// older version. Without Git the criteria of an older version are not known.
export function modelOfFiles(files: ModelFileWorkspace): ModelWorkspace {
  const elements = files.base.elements.map((element, index) => {
    const position = filesOf(files.base, element.id).indexOf(element);
    const records = (files.records[element.id] ?? [])
      .map((file, at) => ({ file, at }))
      .filter(({ file }) => refusalOf(file) === undefined)
      .sort((a, b) => instantOf(b.file.record.date) - instantOf(a.file.record.date) || a.at - b.at)
      .map(({ file }) =>
        file.record.version === CURRENT && file.pin !== position
          ? { ...file.record, version: TWIN_VERSION }
          : file.record,
      );
    return {
      ...element,
      own: {
        criteria: files.criteria[index] ?? element.own.criteria,
        olderVersions: element.own.olderVersions.map(({ id }) => ({ id })),
        records,
      },
    };
  });
  return { ...files.base, elements };
}

/** A record the reader refuses (R5), for the core or a variant. */
function refusedArbitrary(variants: readonly string[]): fc.Arbitrary<ModelFileRecord> {
  return fc
    .record({
      kind: fc.constantFrom<ModelRefusal>(
        "inconclusive-verification",
        "validation-with-variant",
        "inconclusive-without-reason",
      ),
      hour: fc.integer({ min: 0, max: 4 }),
    })
    .map(({ kind, hour }) => {
      const date = renderDate(hour, "Z");
      const variant = variants[0];
      if (kind === "validation-with-variant" && variant !== undefined) {
        return refused({ kind: "validation", version: CURRENT, date, result: "passed", variant }, kind);
      }
      return kind === "inconclusive-verification"
        ? refused(
            { kind: "verification", version: CURRENT, date, result: "inconclusive", reason: "no decision" },
            kind,
          )
        : refused(
            { kind: "validation", version: CURRENT, date, result: "inconclusive" },
            "inconclusive-without-reason",
          );
    });
}

function refused(record: ModelRecord, refusal: ModelRefusal): ModelFileRecord {
  return { record, pin: 0, form: "n2", format: "markdown", location: 0, crlf: false, refusal };
}

/**
 * Two inconclusive validation records of the current version at one instant newer than the base generator's dates,
 * written in two offsets with two reasons, so the index order picks the reason (A6).
 */
function inconclusiveTie(): ModelFileRecord[] {
  return [renderDate(4, "+02:00"), renderDate(4, "Z")].map((date, index) => ({
    record: {
      kind: "validation",
      version: CURRENT,
      date,
      result: "inconclusive",
      reason: `tie ${String(index + 1)}`,
    },
    pin: 0,
    form: "n1",
    format: "markdown",
    location: 0,
    crlf: false,
  }));
}

/** How one record of the base generator is written. */
function writtenArbitrary(record: ModelRecord): fc.Arbitrary<ModelFileRecord> {
  return fc
    .record({
      pin: fc.integer({ min: 0, max: 2 }),
      form: fc.constantFrom("n1" as const, "n2" as const),
      junit: fc.boolean(),
      location: fc.constantFrom(0 as const, 1 as const),
      crlf: fc.integer({ min: 0, max: 3 }).map((value) => value === 0),
    })
    .map(({ pin, form, junit, location, crlf }) => {
      const verification = record.kind === "verification";
      const readable = record.date !== UNREADABLE_DATE;
      return {
        record,
        pin,
        form,
        format: verification && readable && junit ? "junit" : "markdown",
        location: verification ? location : 0,
        crlf,
      };
    });
}

/** A workspace of `statusModelWorkspace` as files (see the file comment). */
export function statusModelFileWorkspace(): fc.Arbitrary<ModelFileWorkspace> {
  return statusModelWorkspace().chain((base) => {
    const variants = base.variants.map((variant) => variant.id);
    // The first file of each UUID, in element order: its own part holds the UUID's records (R4).
    const firsts = base.elements.filter(
      (element, index) => base.elements.findIndex((other) => other.id === element.id) === index,
    );
    const recordsOf = ({ id, own }: ModelWorkspaceElement) =>
      fc
        .tuple(
          fc.tuple(...own.records.map(writtenArbitrary)),
          fc.integer({ min: 0, max: 3 }).map((value) => (value === 0 ? inconclusiveTie() : [])),
          fc.array(refusedArbitrary(variants), { maxLength: 2 }),
        )
        .map(([written, tie, refused]) => {
          const count = filesOf(base, id).length;
          return [
            id,
            [...written.map((file) => ({ ...file, pin: file.pin % count })), ...tie, ...refused],
          ] as const;
        });
    return fc
      .record({
        criteria: fc.tuple(
          ...base.elements.map((element, index) =>
            base.elements.findIndex((other) => other.id === element.id) === index
              ? fc.constant(undefined)
              : fc.option(criteriaArbitrary(), { nil: undefined }),
          ),
        ),
        crlf: fc.tuple(
          ...base.elements.map(() => fc.integer({ min: 0, max: 3 }).map((value) => value === 0)),
        ),
        records: fc.tuple(...firsts.map(recordsOf)),
      })
      .map(({ criteria, crlf, records }) => ({
        base,
        criteria,
        crlf,
        records: Object.fromEntries(records),
      }));
  });
}
