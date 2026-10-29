// `evidence.record` (SR-030, ADR-0012 "Manual record"): writes one manual verification or validation
// record (Datensatz) as a new Markdown file (`evidence-record.schema.json`) into an evidence folder of
// the workspace. D-026: „Bei der Erfassung im Tool sind ID und aktuelle Fassung vorbelegt.“ D-007:
// „Belege schreibt es nie, Datensätze darf es schreiben (D-026).“
//
// 1. Element: `resolveRef`. D-012: a verification names a requirement, a validation a need or a
//    requirement (by the meaning of the element's type); anything else is `input.invalid`. A given
//    `variant` must be a variant the element applies in (SR-040), else the record would count nowhere.
// 2. ID and current version (AK1): the UUID and `currentVersionsOf` (one file read in a fresh process,
//    N-036); neither is an input. No current version: `file.faulty`, nothing written.
// 3. Fields as given; `date` defaults to the time of the call, UTC, whole seconds. The frontmatter is
//    checked against the format before anything is done on disk, so the format's rules (`method` and
//    `item` for a verification) give `input.invalid` naming the input field.
// 4. Folder (AK2, "in der gewählten Ablage"): an evidence location of the workspace file or a folder
//    below one, relative to the workspace root; default the first location whose repository is on this
//    machine. The full target passes the rules of every new ReqSeq file (`refuseUnlisted`) before and
//    after a missing folder is created, so a refused folder leaves nothing behind (D-036, D-045).
// 5. Name (ADR-0012): `<day>-<short id>-<method>.md` (`validation` for a validation record), `<day>` the
//    first ten characters of `date`; a taken name (any case, NFC) gets `-2`, `-3`, ...; the file is only
//    ever created, never replaced (`writeFileAtomic` with no snapshot), and a name taken meanwhile is
//    retried with the next one, at most `TRIES` times.
// 6. Read back (ADR-0007 pattern): the bytes must give exactly the intended record through the Markdown
//    reader, else `internal` and nothing written.
// 7. The evidence state is updated with the record (S1 of the plan review): a built read gets the
//    record at its walk position (`withRecord`), one that runs is reset, an unbuilt (or failed, so dropped) one stays.
// The element's file and status are never read for writing or changed (D-030); the Beleg is never opened.
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { createFolder, renderYamlDocument, writeFileAtomic } from "../files/index.js";
import type { EvidenceRecordFile, EvidenceRecordInput, EvidenceRecordOutput } from "../generated/types.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import {
  clashKey,
  currentVersionsOf,
  elementStoreState,
  refuseUnlisted,
  resolveRef,
  shortIdState,
  workspacePath,
} from "../model/index.js";
import type { SchemaViolation } from "../runtime/contracts.js";
import { fileSchemaValidator, schemaViolations } from "../runtime/contracts.js";
import { settledValue } from "../runtime/settled.js";
import type { Workspace } from "../runtime/workspace.js";
import { appliesIn, resolveView, validityOf } from "../variants/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { locate, workspaceLayoutState } from "../workspace/index.js";
import { readMarkdownRecord, RECORD_KEY } from "./markdown.js";
import type { EvidenceRecord } from "./record.js";
import type { EvidenceRead } from "./state.js";
import { evidenceReadState, evidenceRecordsState, registerInsertion } from "./state.js";

const COMMAND = "evidence.record";

/** Names a create is tried under before `file.changed-on-disk` stands (rule 5). */
const TRIES = 3;

/** The frontmatter of a record file as ReqSeq writes it, in schema order (rule 3). */
export type RecordFields = Omit<EvidenceRecordFile, "logreq-record">;

/** What `recordEvidence` uses to render, write and tell the time; tests inject other ones (seams). */
export interface RecordDeps {
  readonly render: (fields: RecordFields) => string;
  readonly write: typeof writeFileAtomic;
  readonly now: () => Date;
}

/**
 * The bytes of a record file (pure): `---`, the frontmatter in schema order with `logreq-record: 1`
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

/** The keys of the format after `logreq-record`, in schema order. */
const FORMAT_ORDER: readonly (keyof RecordFields)[] = [
  "kind",
  "element",
  "version",
  "method",
  "variant",
  "item",
  "result",
  "date",
  "evidence",
  "test-case",
];

const DEFAULT_DEPS: RecordDeps = {
  render: renderRecordFile,
  write: writeFileAtomic,
  now: () => new Date(),
};

/**
 * The file name of a record (rule 5): `<day>-<short id>-<what>.md`, with `-<n>` before `.md` from the
 * second name on; `what` is `validation` for a validation record, else the method.
 */
export const recordFileName = (day: string, shortId: string, what: string, n: number): string =>
  `${day}-${shortId}-${what}${n === 1 ? "" : `-${String(n)}`}.md`;

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
          message: `${field} is required for a ${fields.kind} record`,
          params: { missingProperty: field },
        };
      }
      const field = fieldOf(v.path.slice(1));
      return {
        path: `/${field}`,
        field,
        keyword: v.keyword,
        message: `${field} ${v.message}`,
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

/** The evidence locations of the workspace file whose repository it lists, in its order. */
const locationsOf = (layout: WorkspaceLayout): Location[] =>
  (layout.file.evidence ?? []).flatMap((location) => {
    const { repository } = locate(layout, location);
    if (repository === undefined) {
      return [];
    }
    const start = normalFolder(location.path);
    return [{ repository, start, shown: normalFolder(workspacePath(layout, repository, start)) }];
  });

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
  const listed = locations.map((l) => (l.shown === "" ? "." : l.shown)).join(", ");
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
 * a read that runs is reset, an unbuilt one stays unbuilt.
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
  // through the seam of #127 (then the index is of those, and the states are reset as before).
  const records = workspace.peek(evidenceRecordsState);
  const ofRead = records === undefined || (await settledValue(records)) === read.records;
  const next = Promise.resolve(withRecord(layout, read, record));
  // The states built on the read carry the one record over (#278); no `await` from here to `replace`.
  if (ofRead && workspace.peek(evidenceRecordsState) === records) {
    registerInsertion(next, record);
  }
  await workspace.replace(evidenceReadState, from, next);
};

/** The element of a record and the fields to write (rules 1 to 3). */
interface Prepared {
  readonly element: ElementRecord;
  readonly shortId: string;
  readonly fields: RecordFields;
}

/** The variant of rule 1: its UUID, undefined for the core; `input.invalid` when the element does not apply in it. */
const variantOf = (
  context: Parameters<typeof resolveView>[0],
  element: ElementRecord,
  input: EvidenceRecordInput,
): string | undefined => {
  if (input.variant === undefined) {
    return undefined;
  }
  const view = resolveView(context, input.variant, COMMAND, "variant", false);
  if (!appliesIn(validityOf(context.metamodel), element, view)) {
    throw invalid(
      `${input.ref} does not apply in ${input.variant}, so a record for it there would count nowhere (SR-040)`,
      { fields: ["variant"], reason: "not-valid-in-variant" },
    );
  }
  return view.kind === "core" ? undefined : view.variant.id;
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
  const variant = variantOf({ metamodel, store, shortIds }, element, input);
  // AK1: `currentVersionsOf` gives an entry for every record it is given.
  const entry = (await currentVersionsOf(workspace, [element])).get(element);
  if (entry?.kind !== "version") {
    throw new CommandError(
      "file.faulty",
      `Not written: ${input.ref} has no current version (${String(entry?.message)})`,
      {
        elementId: element.id,
        reason: entry?.reason,
      },
    );
  }
  const fields: RecordFields = {
    kind: input.kind,
    element: element.id,
    version: entry.version,
    ...(input.method === undefined ? {} : { method: input.method }),
    ...(variant === undefined ? {} : { variant }),
    ...(input.item === undefined ? {} : { item: input.item }),
    result: input.result,
    date: input.date ?? recordDate(now()),
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(input.testCase === undefined ? {} : { "test-case": input.testCase }),
  };
  const errors = recordViolations(fields);
  if (errors.length > 0) {
    throw new CommandError(
      "input.invalid",
      `Invalid input for ${COMMAND}: ${errors.map((e) => e.message).join("; ")}`,
      { command: COMMAND, errors },
    );
  }
  return { element, shortId: shortIds.of(element), fields };
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
  // The folder as the walk sees it: spelled as on disk where only the normal form differs (#194).
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
  const { shortId, fields } = await prepare(workspace, input, deps.now);
  const { location, folder } = targetOf(layout, input.folder);
  const { repository } = location;
  const bytes = Buffer.from(deps.render(fields), "utf8");
  const what = fields.method === undefined || fields.kind === "validation" ? "validation" : fields.method;
  const name = (n: number): string => recordFileName(fields.date.slice(0, 10), shortId, what, n);
  const read = readBack(fields, bytes, repository.name, inFolder(folder, name(1)));
  const file = await createRecordFile(layout, repository, folder, name, bytes, deps.write);
  const record: PlacedRecord = { ...read, repository: repository.name, file };
  await updateEvidence(workspace, layout, record);
  return { files: [workspacePath(layout, repository, file)], record, problems: [] };
};
