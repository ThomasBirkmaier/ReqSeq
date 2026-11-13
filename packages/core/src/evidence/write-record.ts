// `evidence.record` (SR-030, ADR-0012 "Manual record"): writes one manual verification or validation
// record (Datensatz) as a new Markdown file (`evidence-record.schema.json`) into an evidence folder of
// the workspace. D-026: „Bei der Erfassung im Tool sind ID und aktuelle Fassung vorbelegt.“ D-007:
// „Belege schreibt es nie, Datensätze darf es schreiben (D-026).“
//
// 1. Element: `resolveRef`. D-012: a verification names a requirement, a validation a need or a
//    requirement (by the meaning of the element's type); anything else is `input.invalid`. A given
//    `variant` must be a variant (`core` names none: a record for the core gives no variant, #464)
//    whose view holds the element by the view rule, as the views decide it (SR-040, SR-043 AK10: an
//    element of a type without the validity property is in every view), else the record would count
//    nowhere; for a core requirement the variant excludes or replaces the refusal names the exclusion
//    or the replacing requirements (SR-047 AK4). Without `variant` a verification record holds in the
//    core, so the core must hold the element, or a variant for an element of a repository marked
//    `variant-independent` (SR-173 AK1), else it is `counts-in-no-view` (SR-047 AK5). A validation
//    record takes no variant (SR-038 AK4, D-007).
// 2. ID and current version (AK1): the UUID and `currentVersionsOf` (one file read in a fresh process,
//    N-036); neither is an input. No current version: `file.faulty`, nothing written.
// 3. Fields as given; `date` defaults to the time of the call, UTC, whole seconds. The frontmatter is
//    checked against the format before anything is done on disk, so the format's rules (`method` and
//    `item` for a verification; `reason` with the result `inconclusive` and only there, which only a
//    validation may have, SR-172 AK1) give `input.invalid` naming the input field. `criteria` (SR-030
//    AK4, AK5, D-072) names criteria of the current version by number or key; the file gets their
//    keys, in code-unit order as the reader keeps them, and the output names each with number, key
//    and the first 60 characters of its text. A criterion without key, a key two criteria carry, and a
//    number or key the current version does not have are `input.invalid`, and nothing is written (the
//    last an assumption carried in the PR of #1417: it cannot be written by key). For a verification
//    only (`input.invalid` with `validation-with-criteria`: a validation counts per element, SR-030
//    AK3); absent, the record holds for every criterion.
// 4. Folder (AK2, "in der gewählten Ablage"): an evidence location of the workspace file or a folder
//    below one, relative to the workspace root; default the first location whose repository is on this
//    machine. The full target passes the rules of every new ReqSeq file (`refuseUnlisted`) before and
//    after a missing folder is created, so a refused folder leaves nothing behind (D-036, D-045).
// 5. Name (ADR-0012): `<day>-<short id>-<method>.md` (`validation` for a validation record), with the
//    variant's short ID after the element's for a record of a variant (#647), `<day>` the first ten
//    characters of `date`; a taken name (any case, NFC) gets `-2`, `-3`, ...; the file is only
//    ever created, never replaced (`writeFileAtomic` with no snapshot), and a name taken meanwhile is
//    retried with the next one, at most `TRIES` times.
// 6. Read back (ADR-0007 pattern): the bytes must give exactly the intended record through the Markdown
//    reader, else `internal` and nothing written.
// 7. The evidence state is updated with the record (S1 of the plan review): a built read gets the
//    record at its walk position (`withRecord`), one that runs is reset, an unbuilt (or failed, so dropped) one stays.
//    When another call replaced the read in between (two calls at once), the replace fails and the read
//    is reset (#308).
// The element's file and status are never read for writing or changed (D-030); the Beleg is never opened.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { createFolder, renderYamlDocument, writeFileAtomic } from "../files/index.js";
import type {
  EvidenceRecordFile,
  EvidenceRecordInput,
  EvidenceRecordOutput,
  WorkspaceLocation,
} from "../generated/types.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import {
  acceptanceCriteriaKeyOf,
  compareCriterionRefs,
  criteriaItemsOf,
  criterionKey,
  isKeyedCriterion,
  clashKey,
  currentVersionsOf,
  elementStoreState,
  NORMAL_FORM,
  ownEvidenceWrite,
  refuseUnlisted,
  resolveRef,
  shortIdState,
  workspacePath,
} from "../model/index.js";
import type { SchemaViolation } from "../runtime/contracts.js";
import { fileSchemaValidator, schemaViolations } from "../runtime/contracts.js";
import { settledValue } from "../runtime/settled.js";
import type { Workspace } from "../runtime/workspace.js";
import { resolveView } from "../variants/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { locate, variantIndependentOf, workspaceLayoutState } from "../workspace/index.js";
import type { RecordViewContext } from "./in-variant.js";
import { outOfView, recordOutOfView, recordViewContext } from "./in-variant.js";
import {
  CRITERIA_VERIFICATION_ONLY,
  INCONCLUSIVE_REASON_REQUIRED,
  INCONCLUSIVE_VALIDATION_ONLY,
  misplacedReason,
  readMarkdownRecord,
  RECORD_KEY,
  REASON_INCONCLUSIVE_ONLY,
  VALIDATION_VARIANT_REASON,
  verificationInconclusive,
} from "./markdown.js";
import { withEvidenceSource } from "./evidence-source.js";
import type { EvidenceRecord } from "./record.js";
import { criterionNameAt } from "./criteria.js";
import { criterionLineOf, withCriterionLines } from "./record.js";
import type { EvidenceRead } from "./state.js";
import { evidenceReadState, evidenceRecordsState, registerInsertion } from "./state.js";

const COMMAND = "evidence.record";

/** Names a create is tried under before `file.changed-on-disk` stands (rule 5). */
const TRIES = 3;

/** The frontmatter of a record file as ReqSeq writes it, in schema order (rule 3). */
export type RecordFields = Omit<EvidenceRecordFile, "reqseq-record">;

/** What `recordEvidence` uses to render, write and tell the time; tests inject other ones (seams). */
export interface RecordDeps {
  readonly render: (fields: RecordFields) => string;
  readonly write: typeof writeFileAtomic;
  readonly now: () => Date;
}

/**
 * The bytes of a record file (pure): `---`, the frontmatter in schema order with `reqseq-record: 1`
 * first and absent fields left out, `---`, and no body (the text below is the user's to add). LF, no BOM.
 */
export const renderRecordFile = (fields: RecordFields): string => {
  const frontmatter: Record<string, unknown> = { [RECORD_KEY]: 1 };
  for (const key of FORMAT_ORDER) {
    const value = fields[key];
    if (value !== undefined) {
      frontmatter[key] = value;
    }
  }
  return `---\n${renderYamlDocument(frontmatter)}---\n`;
};

/** The keys of the format after `reqseq-record`, in schema order. */
const FORMAT_ORDER: readonly (keyof RecordFields)[] = [
  "kind",
  "element",
  "version",
  "method",
  "variant",
  "item",
  "result",
  "reason",
  "date",
  "evidence",
  "test-case",
  "criteria",
];

const DEFAULT_DEPS: RecordDeps = {
  render: renderRecordFile,
  write: writeFileAtomic,
  now: () => new Date(),
};

/**
 * The file name of a record (rule 5): `<day>-<short id>-<what>.md`, with `-<variant short id>` after the
 * short ID for a record of a variant (#647) and `-<n>` before `.md` from the second name on; `what` is
 * `validation` for a validation record, else the method.
 */
export const recordFileName = (
  day: string,
  shortId: string,
  what: string,
  n: number,
  variantShortId?: string,
): string =>
  `${day}-${shortId}${variantShortId === undefined ? "" : `-${variantShortId}`}-${what}${n === 1 ? "" : `-${String(n)}`}.md`;

/** `date` as the record writes it when none is given: UTC, whole seconds (`2026-10-27T10:00:00Z`). */
export const recordDate = (now: Date): string => `${now.toISOString().slice(0, 19)}Z`;

/** The input field of a key of the format (N3 of the plan review). */
const fieldOf = (key: string): string => (key === "test-case" ? "testCase" : key);

/**
 * The violations of the frontmatter of `fields` against `evidence-record.schema.json` as `input.invalid` violations
 * (`InputViolation` of the runtime): each names the input field, so every access (and the CLI's
 * spelling of flags) shows the same; empty when it is valid.
 */
export const recordViolations = (
  fields: RecordFields,
): { path: string; field: string; keyword: string; message: string; params: SchemaViolation["params"] }[] => {
  const frontmatter = { [RECORD_KEY]: 1, ...fields };
  const validate = fileSchemaValidator("evidence-record.schema.json");
  if (validate(frontmatter)) {
    return [];
  }
  // `if` repeats the violation of its `then` (a verification record without `method` or `item`).
  return schemaViolations(validate.errors)
    .filter((v) => v.keyword !== "if")
    .map((v) => {
      if (v.keyword === "required") {
        const field = fieldOf(String(v.params["missingProperty"]));
        return {
          path: "",
          field,
          keyword: v.keyword,
          message:
            field === "reason"
              ? `reason is required: ${INCONCLUSIVE_REASON_REQUIRED}`
              : `${field} is required for a ${fields.kind} record`,
          params: { missingProperty: field },
        };
      }
      const field = fieldOf(v.path.slice(1));
      const why = misplacedReason(v)
        ? `: ${REASON_INCONCLUSIVE_ONLY}`
        : verificationInconclusive(v)
          ? `: ${INCONCLUSIVE_VALIDATION_ONLY}`
          : ` ${v.message}`;
      return {
        path: `/${field}`,
        field,
        keyword: v.keyword,
        message: `${field}${why}`,
        params: v.params,
      };
    });
};

const invalid = (message: string, details: Readonly<Record<string, unknown>>): CommandError =>
  new CommandError("input.invalid", message, { command: COMMAND, ...details });

/** Rule 1, D-012: the element may get a record of `kind`; `input.invalid` naming D-012 otherwise. */
const checkKind = (
  types: { readonly requirements: ReadonlySet<string>; readonly needs: ReadonlySet<string> },
  element: ElementRecord,
  kind: EvidenceRecordInput["kind"],
  ref: string,
): void => {
  const isRequirement = types.requirements.has(element.type);
  if (isRequirement || (kind === "validation" && types.needs.has(element.type))) {
    return;
  }
  throw invalid(
    `${ref} is of type ${element.type}: a verification record names a requirement, a validation record a need or a requirement (D-012)`,
    { fields: ["ref"], reason: "D-012", type: element.type },
  );
};

/** A folder as given: `/` as separator, normalized, no trailing `/`, `""` for the workspace root. */
const normalFolder = (folder: string): string => {
  const normal = path.posix.normalize(folder.replaceAll("\\", "/")).replace(/\/+$/, "");
  return normal === "." ? "" : normal;
};

/** Whether `folder` is `base` or lies below it, segment by segment (both as `normalFolder` gives them). */
const atOrBelow = (folder: string, base: string): boolean =>
  base === ""
    ? folder !== ".." && !folder.startsWith("../") && !folder.startsWith("/")
    : folder === base || folder.startsWith(`${base}/`);

/** One evidence location of the workspace file, located. */
interface Location {
  readonly repository: RepositoryLocation;
  /** Relative to the repository, as `normalFolder` gives it. */
  readonly start: string;
  /** Relative to the workspace root, as `normalFolder` gives it. */
  readonly shown: string;
}

/** An evidence location of the workspace file, located; undefined when the file does not list its repository. */
const locatedOf = (layout: WorkspaceLayout, location: WorkspaceLocation): Location | undefined => {
  const { repository } = locate(layout, location);
  if (repository === undefined) {
    return undefined;
  }
  const start = normalFolder(location.path);
  return { repository, start, shown: normalFolder(workspacePath(layout, repository, start)) };
};

/** The evidence locations of the workspace file whose repository it lists, in its order. */
const locationsOf = (layout: WorkspaceLayout): Location[] =>
  (layout.file.evidence ?? []).flatMap((location) => locatedOf(layout, location) ?? []);

/** A location's folder as `folder` of evidence.record takes it: relative to the workspace root, `.` for the root. */
const folderOf = (location: Location): string => (location.shown === "" ? "." : location.shown);

/**
 * The folder of an evidence location of the workspace file as `folder` of evidence.record takes it
 * (`workspace.status` `evidence[].folder`); undefined when the workspace file does not list its repository.
 */
export const evidenceFolder = (layout: WorkspaceLayout, location: WorkspaceLocation): string | undefined => {
  const located = locatedOf(layout, location);
  return located === undefined ? undefined : folderOf(located);
};

/** Where the record goes (rule 4): the repository and the folder relative to it. */
interface Target {
  readonly location: Location;
  /** Relative to the repository, `/`, `""` for its root. */
  readonly folder: string;
}

/**
 * The folder of the record (rule 4): `folder` (relative to the workspace root) at or below an
 * evidence location, the most specific one when several hold it; default the first location whose
 * repository is on this machine. `input.invalid` for no location, a folder below none, or a location
 * whose repository is not on this machine (SR-006).
 */
const targetOf = (layout: WorkspaceLayout, folder: string | undefined): Target => {
  const locations = locationsOf(layout);
  const listed = locations.map(folderOf).join(", ");
  if (locations.length === 0) {
    throw invalid("The workspace file lists no evidence location, so a record has no folder that is read", {
      fields: ["folder"],
      reason: "no-evidence-location",
    });
  }
  if (folder === undefined) {
    const first = locations.find((l) => l.repository.available);
    if (first === undefined) {
      throw invalid(
        `No evidence location lies in a repository on this machine (${listed}); give folder in an available one`,
        { fields: ["folder"], reason: "not-available" },
      );
    }
    return { location: first, folder: first.start };
  }
  const wanted = normalFolder(folder);
  const holding = locations
    .filter((l) => atOrBelow(wanted, l.shown))
    .sort((x, y) => y.shown.length - x.shown.length);
  const location = holding[0];
  if (location === undefined) {
    throw invalid(
      `${folder} is no evidence location and lies below none, so its records would not be read; the locations are: ${listed}`,
      { fields: ["folder"], reason: "not-evidence", locations: locations.map((l) => l.shown) },
    );
  }
  if (!location.repository.available) {
    throw invalid(`Repository ${location.repository.name} of ${folder} is not available on this machine`, {
      fields: ["folder"],
      reason: "not-available",
      repository: location.repository.name,
    });
  }
  const rest = wanted.slice(location.shown.length).replace(/^\//, "");
  return { location, folder: [location.start, rest].filter((s) => s !== "").join("/") };
};

/** `name` in `folder` (relative to the repository, `""` for its root). */
const inFolder = (folder: string, name: string): string => (folder === "" ? name : `${folder}/${name}`);

/** The names in `folder` as `clashKey` gives them; none when it cannot be listed (it is created or refused later). */
const takenNames = async (repository: RepositoryLocation, folder: string): Promise<Set<string>> => {
  const names = await fs.readdir(path.join(repository.folder, ...folder.split("/"))).catch(() => []);
  return new Set(names.map(clashKey));
};

/** The first of `name(1)`, `name(2)`, ... that clashes with none of `taken`. */
const freeName = (taken: ReadonlySet<string>, name: (n: number) => string): string => {
  let n = 1;
  while (taken.has(clashKey(name(n)))) {
    n += 1;
  }
  return name(n);
};

/** The record without where it lies, to compare with the intended fields. */
const fieldsOfRecord = ({
  source: _s,
  repository: _r,
  file: _f,
  line: _l,
  ...rest
}: EvidenceRecord): unknown => rest;

/** The record of `fields` as the reader gives it (rule 6), or `internal` when the bytes do not read back. */
const readBack = (
  fields: RecordFields,
  bytes: Uint8Array,
  repository: string,
  file: string,
): EvidenceRecord => {
  const read = readMarkdownRecord({ repository, file, absolute: file, ext: "md" }, bytes);
  const [record] = read.records;
  const { "test-case": testCase, ...rest } = fields;
  const intended = { ...rest, ...(testCase === undefined ? {} : { testCase }) };
  if (
    record === undefined ||
    read.records.length !== 1 ||
    read.problems !== undefined ||
    !isDeepStrictEqual(fieldsOfRecord(record), intended)
  ) {
    throw new CommandError("internal", "The record does not read back as intended; nothing written", {
      command: COMMAND,
    });
  }
  return record;
};

/**
 * The walk position of a record: the index of the first location (workspace-file order) that holds
 * its file, as `evidenceFiles` lists a file two locations reach; -1 for a record without a place.
 */
const positionOf = (
  locations: readonly Location[],
  record: Pick<EvidenceRecord, "repository" | "file">,
): number =>
  locations.findIndex(
    (l) =>
      record.file !== undefined && l.repository.name === record.repository && atOrBelow(record.file, l.start),
  );

/** A record of a file that ReqSeq wrote: with its place. */
export type PlacedRecord = EvidenceRecord & { readonly repository: string; readonly file: string };

/**
 * `read` with `record` (the read-back record of a new file) at its walk position: by location in the
 * order of the workspace file, then by path in code units, as `evidenceFiles` lists the files.
 * Records without a place (injected through the state) are passed over. An `evidence.folder-missing`
 * of a folder above the file is dropped: the folder exists now.
 */
export const withRecord = (
  layout: WorkspaceLayout,
  read: EvidenceRead,
  record: PlacedRecord,
): EvidenceRead => {
  const locations = locationsOf(layout);
  const at = positionOf(locations, record);
  const index = read.records.findIndex((r) => {
    const position = positionOf(locations, r);
    // A record at `at` has a file (`positionOf`).
    return position > at || (position === at && String(r.file) > record.file);
  });
  const records = [...read.records];
  records.splice(index === -1 ? records.length : index, 0, record);
  const kept = (p: Problem): boolean =>
    !(
      p.code === "evidence.folder-missing" &&
      p.repository === record.repository &&
      record.file.startsWith(`${String(p.file)}/`)
    );
  return { ...read, records, problems: read.problems.filter(kept) };
};

/**
 * Rule 7: the evidence state after `record` was written: a built read gets the record (`withRecord`;
 * `replace` carries the records, the index and the status over the one record, `registerInsertion`),
 * a read that runs is reset, an unbuilt one stays unbuilt. When another write replaced the read
 * while this one waited for it (two calls at once), the replace fails and the read is reset (#308).
 */
const updateEvidence = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  record: PlacedRecord,
): Promise<void> => {
  const from = workspace.peek(evidenceReadState);
  if (from === undefined) {
    return;
  }
  // A failed read is dropped by the workspace, so it is unbuilt here; one that runs is reset.
  const read = await settledValue(from);
  if (read === undefined) {
    await workspace.reset(evidenceReadState);
    return;
  }
  // The records state carries only as the read's own records: not after records were put in place
  // through the seam of ThomasBirkmaier/ReqSeq-archive#127 (then the index is of those, and the states are reset as before).
  const records = workspace.peek(evidenceRecordsState);
  const ofRead = records === undefined || (await settledValue(records)) === read.records;
  const next = Promise.resolve(withRecord(layout, read, record));
  // The states built on the read carry the one record over (#278); no `await` from here to `replace`.
  if (ofRead && workspace.peek(evidenceRecordsState) === records) {
    registerInsertion(next, record);
  }
  if (!(await workspace.replace(evidenceReadState, from, next))) {
    // Another write replaced the read in between (#308): the files are right, so read them again.
    await workspace.reset(evidenceReadState);
  }
};

/** The element of a record and the fields to write (rules 1 to 3). */
interface Prepared {
  readonly element: ElementRecord;
  readonly shortId: string;
  /** The short ID of the record's variant, for the file name; undefined for the core. */
  readonly variantShortId: string | undefined;
  readonly fields: RecordFields;
  /** The criteria the record is written for, with number, key and the start of the text (SR-030 AK4). */
  readonly criteria?: readonly WrittenCriterion[];
  /** The acceptance criteria of the current version, to name those of the record with their whole texts (SR-205 AK2). */
  readonly items: readonly unknown[];
}

/**
 * Rule 1 for a verification record without variant: it holds in the core, so the core's view must hold
 * the element, or, for an element of a repository marked `variant-independent`, a variant's view
 * (SR-173 AK1); else the record would count in no view and is `input.invalid` (SR-047 AK5). A
 * validation record counts per element, in no view.
 */
const coreOutOfView = (
  context: RecordViewContext,
  element: ElementRecord,
  input: EvidenceRecordInput,
): void => {
  if (input.kind === "validation") {
    return;
  }
  const out = recordOutOfView(context, element, { kind: "core" });
  if (out === undefined) {
    return;
  }
  throw invalid(`${context.shortIds.of(element)} ${out.why}; give a variant whose view holds it (SR-047)`, {
    fields: ["variant"],
    reason: "counts-in-no-view",
  });
};

/**
 * The variant of rule 1: its record, undefined when none is given (the core); `input.invalid` for
 * `core`, which names no variant (#464), for a validation record (SR-038 AK4), and when the variant's
 * view (`outOfView`: the view rule, as the views decide it) leaves the element out: it does not apply there
 * (SR-040), or the variant excludes or replaces it (SR-047 AK4).
 * Every refusal of the view names the element and the variant by short ID (the app gives UUIDs) and
 * gives `details.variant`, the UUID of the variant.
 */
const variantOf = (
  context: RecordViewContext,
  element: ElementRecord,
  input: EvidenceRecordInput,
): ElementRecord | undefined => {
  if (input.variant === undefined) {
    coreOutOfView(context, element, input);
    return undefined;
  }
  const view = resolveView(context, input.variant, COMMAND, "variant", false);
  if (view.kind === "core") {
    throw invalid(
      `${input.variant} is no variant: variant takes a variant, an element whose type has the meaning variant; leave it out for a record of the core`,
      { fields: ["variant"], reason: "core-is-no-variant" },
    );
  }
  if (input.kind === "validation") {
    throw invalid(`Not written: ${VALIDATION_VARIANT_REASON}`, {
      fields: ["variant"],
      reason: "validation-with-variant",
      variant: view.variant.id,
    });
  }
  const out = outOfView(context, element, view);
  if (out === undefined) {
    return view.variant;
  }
  throw invalid(`${context.shortIds.of(element)} ${out.why}`, {
    fields: ["variant"],
    reason: out.reason,
    variant: view.variant.id,
    ...(out.replacedBy === undefined ? {} : { replacedBy: out.replacedBy }),
  });
};

/** How many characters of a criterion's text the output names (SR-030 AK4: „den Anfang des Texts“). */
const TEXT_START = 60;

/** A criterion the record is written for (rule 3): its number, its key, the start of its text. */
type WrittenCriterion = NonNullable<EvidenceRecordOutput["criteria"]>[number];

/** The refusal of a criterion of rule 3, naming it as given. */
const refusedCriterion = (given: number | string, why: string, reason: string): CommandError =>
  invalid(`Not written: acceptance criterion ${String(given)} ${why}`, {
    fields: ["criteria"],
    reason,
    criterion: given,
  });

/**
 * The position (from 1) of the criterion `given` names in the current `items` (rule 3): a number (or
 * digits) is its position, a key the one item that carries it. `input.invalid` for a number or key
 * the current version does not have, and for a key several criteria carry (SR-030 AK5).
 */
const criterionPositionOf = (items: readonly unknown[], given: number | string): number => {
  const asNumber = typeof given === "number" ? given : /^[0-9]+$/.test(given) ? Number(given) : undefined;
  if (asNumber !== undefined) {
    if (asNumber > items.length) {
      throw refusedCriterion(
        given,
        `is not in the current version, which has ${String(items.length)}`,
        "unknown-criterion",
      );
    }
    return asNumber;
  }
  const found = items.flatMap((item, i) => (criterionKey(item) === given ? [i + 1] : []));
  const [position] = found;
  if (position === undefined) {
    throw refusedCriterion(given, "is not in the current version", "unknown-criterion");
  }
  if (found.length > 1) {
    throw refusedCriterion(
      given,
      `is carried by ${String(found.length)} criteria of the current version; give each its own key first (SR-204)`,
      "criterion-key-duplicate",
    );
  }
  return position;
};

/**
 * Rule 3: the criteria the record is written for, by position, with their keys (SR-030 AK4); none
 * without the input. `input.invalid` on a validation record, which counts per element (SR-030 AK3),
 * and for a criterion `criterionPositionOf` refuses, one without key (`criterion-without-key`: the file names
 * criteria by key only), and one whose key another criterion carries too (SR-030 AK5, SR-204 AK10).
 */
const criteriaOfInput = (
  input: EvidenceRecordInput,
  items: readonly unknown[],
): readonly WrittenCriterion[] | undefined => {
  if (input.criteria === undefined) {
    return undefined;
  }
  if (input.kind === "validation") {
    throw invalid(`Not written: ${CRITERIA_VERIFICATION_ONLY}`, {
      fields: ["criteria"],
      reason: "validation-with-criteria",
    });
  }
  const positions = [...new Set(input.criteria.map((given) => criterionPositionOf(items, given)))].sort(
    (a, b) => a - b,
  );
  return positions.map((position) => {
    const item = items[position - 1];
    if (!isKeyedCriterion(item)) {
      throw refusedCriterion(
        position,
        "has no criterion key; give the criteria their keys first (SR-204)",
        "criterion-without-key",
      );
    }
    const { key, text } = item;
    if (items.filter((other) => criterionKey(other) === key).length > 1) {
      throw refusedCriterion(
        position,
        `has the key ${key}, which another criterion of the current version carries too; give each its own key first (SR-204)`,
        "criterion-key-duplicate",
      );
    }
    return { criterion: position, key, text: text.slice(0, TEXT_START) };
  });
};

/** The current version of `element` in its normal form; `file.faulty` when it has none (rule 2). */
const currentVersionToWrite = async (
  workspace: Workspace,
  element: ElementRecord,
  ref: string,
): Promise<string> => {
  // AK1: `currentVersionsOf` gives an entry for every record it is given.
  const entry = (await currentVersionsOf(workspace, [element])).get(element);
  if (entry?.kind !== "version") {
    throw new CommandError(
      "file.faulty",
      `Not written: ${ref} has no current version (${String(entry?.message)})`,
      {
        elementId: element.id,
        reason: entry?.reason,
      },
    );
  }
  return entry.forms[NORMAL_FORM];
};

/** Rules 1 to 3: the element, its current version and the fields, checked against the format. */
const prepare = async (
  workspace: Workspace,
  input: EvidenceRecordInput,
  now: () => Date,
): Promise<Prepared> => {
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const element = resolveRef(store, shortIds, input.ref);
  const keys = (meaning: "requirement" | "need"): Set<string> =>
    new Set(typesWithMeaning(metamodel, meaning).map((t) => t.key));
  checkKind({ requirements: keys("requirement"), needs: keys("need") }, element, input.kind, input.ref);
  const independent = variantIndependentOf(await workspace.get(workspaceLayoutState));
  const variant = variantOf(
    recordViewContext({ workspace, metamodel, store, shortIds }, independent),
    element,
    input,
  );
  const items = criteriaItemsOf(element.data, acceptanceCriteriaKeyOf(metamodel));
  const written = criteriaOfInput(input, items);
  const fields: RecordFields = {
    kind: input.kind,
    element: element.id,
    version: await currentVersionToWrite(workspace, element, input.ref),
    ...(input.method === undefined ? {} : { method: input.method }),
    ...(variant === undefined ? {} : { variant: variant.id }),
    ...(input.item === undefined ? {} : { item: input.item }),
    result: input.result,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    date: input.date ?? recordDate(now()),
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(input.testCase === undefined ? {} : { "test-case": input.testCase }),
    // Keys in code-unit order, as the reader keeps them (rule 6).
    ...(written === undefined ? {} : { criteria: written.map(({ key }) => key).sort(compareCriterionRefs) }),
  };
  const errors = recordViolations(fields);
  if (errors.length > 0) {
    throw new CommandError(
      "input.invalid",
      `Invalid input for ${COMMAND}: ${errors.map((e) => e.message).join("; ")}`,
      { command: COMMAND, errors },
    );
  }
  return {
    element,
    shortId: shortIds.of(element),
    variantShortId: variant === undefined ? undefined : shortIds.of(variant),
    fields,
    ...(written === undefined ? {} : { criteria: written }),
    items,
  };
};

/**
 * Rules 4 and 5: creates the file `name(n)` with `bytes` in `asGiven` of `repository`, the first `n`
 * whose name is free; the walk rules are checked on the full target before and after a missing
 * folder is created. Returns the file, relative to the repository.
 */
const createRecordFile = async (
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  asGiven: string,
  name: (n: number) => string,
  bytes: Uint8Array,
  write: RecordDeps["write"],
): Promise<string> => {
  // The folder as the walk sees it: spelled as on disk where only the normal form differs (ThomasBirkmaier/ReqSeq-archive#194).
  const spelled = path.posix.dirname(await refuseUnlisted(layout, repository, inFolder(asGiven, name(1))));
  const folder = spelled === "." ? "" : spelled;
  const taken = await takenNames(repository, folder);
  let file = await refuseUnlisted(layout, repository, inFolder(folder, freeName(taken, name)));
  if (folder !== "") {
    await createFolder(repository.folder, folder);
  }
  for (let tries = 1; ; tries++) {
    // Checked again with the folder there, so a link or `.git` entry put there meanwhile is not written into.
    file = await refuseUnlisted(layout, repository, file);
    try {
      await write(repository.folder, file, bytes, null);
      return file;
    } catch (error) {
      // With no snapshot, `file.changed-on-disk` can only mean the file exists now: take the next name.
      if (!(error instanceof CommandError) || error.code !== "file.changed-on-disk" || tries === TRIES) {
        throw error;
      }
      taken.add(clashKey(path.posix.basename(file)));
      file = inFolder(folder, freeName(taken, name));
    }
  }
};

/** `record` with `criterionNames` from the criteria it was written for, in the order of its `criteria` (SR-205 AK2). */
const withNamedCriteria = (record: EvidenceRecord, prepared: Prepared): EvidenceRecord => {
  const written = prepared.criteria;
  return written === undefined
    ? record
    : {
        ...record,
        // `criteria` holds their keys in code-unit order (rule 6).
        criterionNames: [...written]
          .sort((a, b) => compareCriterionRefs(a.key, b.key))
          .map(({ criterion }) => criterionNameAt(prepared.items, criterion)),
      };
};

/**
 * `evidence.record` (SR-030): writes the record of `input` for the element `input.ref` as a new
 * Markdown file in an evidence folder and returns the file and the record (see the file comment).
 * Every refusal comes before a folder is created (B1 of the plan review).
 */
export const recordEvidence = async (
  workspace: Workspace,
  input: EvidenceRecordInput,
  deps: RecordDeps = DEFAULT_DEPS,
): Promise<EvidenceRecordOutput> => {
  const layout = await workspace.get(workspaceLayoutState);
  const prepared = await prepare(workspace, input, deps.now);
  const { shortId, variantShortId, fields } = prepared;
  const { location, folder } = targetOf(layout, input.folder);
  const { repository } = location;
  const bytes = Buffer.from(deps.render(fields), "utf8");
  const what = fields.method === undefined || fields.kind === "validation" ? "validation" : fields.method;
  const name = (n: number): string =>
    recordFileName(fields.date.slice(0, 10), shortId, what, n, variantShortId);
  const read = readBack(fields, bytes, repository.name, inFolder(folder, name(1)));
  const file = await createRecordFile(layout, repository, folder, name, bytes, deps.write);
  // The watcher leaves the read alone for this file while it holds these bytes (#785).
  ownEvidenceWrite(
    workspace,
    path.join(repository.folder, file),
    createHash("sha256").update(bytes).digest("hex"),
  );
  const record: PlacedRecord = { ...read, repository: repository.name, file };
  const { criteria } = record;
  if (criteria !== undefined) {
    // The line of `criteria` in the file, for the findings of `workspace check` (SR-028 AK5).
    withCriterionLines(record, new Map(criteria.map((ref) => [ref, Number(criterionLineOf(read, ref))])));
  }
  await updateEvidence(workspace, layout, record);
  return {
    files: [workspacePath(layout, repository, file)],
    ...(prepared.criteria === undefined ? {} : { criteria: [...prepared.criteria] }),
    // A copy with its evidence source (#821): the evidence state keeps `record` as read. Its criteria
    // named with number, key and whole text (SR-205 AK2); `criteria` above keeps the start (SR-030 AK4).
    record: withNamedCriteria(withEvidenceSource(record), prepared),
    problems: [],
  };
};
