// Confirming hints (SR-027, D-042): "Wenn ein Mensch einen Hinweis auf eine geänderte Fassung
// bestätigt, muss das Tool die neue Fassung in die betroffene Datei schreiben." `hint.confirm`
// takes hint IDs (`hint-id.ts`, SR-025) and writes the current version of each target into the
// relation item or inline reference the ID names (AK1, SR-102 AK1), and nothing else but the
// current titles of the same-repository relation targets of the written file (decision on spec
// question #307: `writeElementFiles` refreshes them on every write, `withCurrentTitles`).
//
// - Which hints: an ID is confirmed when the open outdated relations and references of its source
//   (`outdatedOfShown`, by the rules of the check, SR-025) have its canonical form (`hintIdOf` of
//   the parsed ID, so parameter order and percent-encoding do not matter). The source is the record
//   of the element store with the repository, file and UUID the ID names. Items of one list that
//   share the ID (the same target written twice by hand) are confirmed together.
// - What is written: a relation item gets the text of its `version` scalar replaced, in its own
//   quoting (`set-scalar` of `files/edit.ts`), and its `title` set to the target's current title
//   when the target is in the same repository (`withCurrentTitles`, decision on #307); other keys,
//   comments and layout stay. This works for relation kinds and for relation-valued properties
//   (validity, packages; ADR-0004), as a list or a single target. An inline reference gets only the value of its first `version=`
//   parameter replaced; label and other parameters stay.
// - Several hints (AK2), each as if confirmed on its own: a write can change the version of its
//   source (ADR-0005: the text counts), so a hint of the same call whose target is such a source
//   gets the version the target has after this call, not the one before: the edits are planned,
//   the new versions of the planned sources computed from their bytes, and the sources whose
//   targets changed planned again until no version changes (at most one round per planned target
//   and one more). Inline references that point at each other in a ring never settle (#281): the
//   last plan is written. One write per file. Every check comes before the first write
//   (`assertElementWritable`, `readUnchanged`); `writeElementFiles` writes, restores on a failure and
//   records the writes in the element store.
// - IDs that confirm nothing are problems, not a failure of the call, so the other IDs still count:
//   `hint.not-confirmable` (error) for an ID of no confirmable hint (only version hints can be
//   confirmed, D-042; every other hint, for example an unknown property, has no hint ID and goes
//   away when its cause is fixed; spec question #299), and for the IDs of a file the writer cannot
//   change in place (a version held by a YAML alias or anchor): that file is not written, the
//   others are. A core requirement changed or new since a variant's baseline (SR-103 AK5) has no
//   hint ID; `kind` naming its code, or an ID starting with it, is `hint.not-confirmable` naming the
//   reason: only a new baseline of the variant settles it (D-042). `hint.not-found` (warning, exit code 0) for an ID of that form that no open hint has
//   (confirmed already, the target changed again, the relation or the file is gone).
// - All hints of one element (#310): `ref` selects the open hints its file stores, `target` those
//   on relations and inline references that point at it (its sources from the incoming index, so
//   no walk over the store, N-036), both together those of `ref` that point at `target`; `kind`
//   narrows the selection to some codes. These are the hints `hint.list` gives with a hint ID for
//   that element, found as an ID is (`outdatedOfShown`). The selected IDs join `hintIds`: one set,
//   each ID once, confirmed together as AK2 asks ("mehrere ausgewählte Hinweise"); `confirmed`
//   names the given IDs first, then the selected ones. A selection that finds no open hint to
//   confirm is a `hint.not-found` warning, and so is an empty `hintIds` alone. No `hintIds`, `ref`
//   or `target`, or `kind` without `ref` or `target`, is `input.invalid`: a call never confirms
//   every hint of the workspace by accident. (This rule is not in the input schema: an `anyOf` at
//   the root of a tool input schema is refused by some MCP clients.)
//   A selected ID that a given ID names in another spelling is listed once, as given.
// - Only element files are written: never Git (D-036), never a status (SR-087 AK2), nothing is
//   deleted (D-045). The command is refused while the workspace is read-only (ADR-0002 rule 5).
import { isDeepStrictEqual } from "node:util";
import { Scalar, isScalar } from "yaml";
import type { CommandName, Problem } from "../catalog.js";
import { CommandError, commandErrorOrThrow } from "../catalog.js";
import type { FrontmatterEdit, ParsedFile } from "../files/index.js";
import { editElementFile } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import {
  assertElementWritable,
  elementStoreState,
  elementVersion,
  embeddedImages,
  ignoredBy,
  incomingFor,
  incomingTo,
  resolveRef,
  shortIdState,
  writtenElement,
} from "../model/index.js";
import { inlineReferences } from "../model/references.js";
import type { ElementFileWrite, UnchangedElement } from "../model/write.js";
import { readUnchanged, writeElementFiles } from "../model/write.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { HintTarget } from "./hint-id.js";
import { hintIdOf, parseHintId } from "./hint-id.js";
import type { Candidate, ShownContext } from "./outdated.js";
import { outdatedOfShown } from "./outdated.js";
import { SINCE_BASELINE_CODES } from "./since-baseline.js";

const COMMAND: CommandName = "hint.confirm";

/** The input `hint.confirm` takes (see the file comment). */
export interface ConfirmInput {
  readonly hintIds?: readonly string[];
  readonly ref?: string;
  readonly target?: string;
  readonly kind?: readonly string[];
}

/** What `hint.confirm` did. */
export interface ConfirmedHints {
  /** The IDs confirmed, each once: those of `hintIds` in the order given, then those `ref` and `target` selected. */
  readonly confirmed: string[];
  /** The written files, relative to the workspace root, `/` as separator. */
  readonly files: string[];
  /** One problem per ID that confirmed nothing. */
  readonly problems: Problem[];
}

/** One parsed ID and the open hints of its source that have it (at least one). */
interface Found {
  /** The IDs as given that name it. */
  readonly ids: string[];
  readonly target: HintTarget;
  readonly candidates: readonly Candidate[];
  /** The first of them (a link has only one). */
  readonly first: Candidate;
}

/** One source to write: the file as read and the hints confirmed in it. */
interface Source {
  readonly unchanged: UnchangedElement;
  readonly found: Found[];
}

/** The version each planned source has after this call, by its record in the store. */
type NewVersions = ReadonlyMap<ElementRecord, string>;

const NOT_CONFIRMABLE =
  "only a hint on a changed version (relation.outdated or variant.core-changed, with its hintId in hint.list) is confirmed, by writing the current version (D-042); other hints go away when what they report is changed";

const notConfirmable = (
  id: string,
  reason = `${id} is no ID of a hint that can be confirmed: ${NOT_CONFIRMABLE}`,
): Problem => ({
  code: "hint.not-confirmable",
  severity: "error",
  message: reason,
  hintId: id,
});

/** The refusal of a since-baseline code (SR-103 AK5), given as `kind` or as the start of an ID. */
const sinceBaselineRefusal = (given: string, code: string): Problem => ({
  code: "hint.not-confirmable",
  severity: "error",
  message: `${given} is not confirmed: a ${code} hint is settled only by a new baseline of its variant (baseline.create with the view of the variant), not by confirming it (D-042)`,
});

/** The refusal of `kind` for each since-baseline code it names. */
const kindRefusals = (kind: readonly string[] = []): Problem[] =>
  [...new Set(kind)]
    .filter((code) => SINCE_BASELINE_CODES.has(code))
    .map((code) => sinceBaselineRefusal(`kind ${code}`, code));

/** The refusal of `id`, which has no hint ID form: of a since-baseline code when it starts with one. */
const refusalOf = (id: string): Problem => {
  const code = [...SINCE_BASELINE_CODES].find((c) => id === c || id.startsWith(`${c}/`));
  return code === undefined ? notConfirmable(id) : { ...sinceBaselineRefusal(id, code), hintId: id };
};

const notFound = (id: string, target: HintTarget): Problem => ({
  code: "hint.not-found",
  severity: "warning",
  message: `No open hint has the ID ${id}, so nothing was written for it (a warning, exit code 0): it is confirmed already, or the relation, its target or the file changed since; hint.list gives the open hints`,
  repository: target.sourceRepository,
  file: target.file,
  elementId: target.source,
  targetId: target.target,
  hintId: id,
});

/** The version `candidate` writes: the target's version after this call when this call writes it. */
const versionFor = (candidate: Candidate, versions: NewVersions): string =>
  versions.get(candidate.finding.target) ?? candidate.finding.current;

/** The frontmatter edits of the relation items of `found`: the `version` of each item, nothing else. */
const itemEdits = (found: readonly Found[], versions: NewVersions): FrontmatterEdit[] =>
  found.flatMap(({ candidates }) =>
    candidates.flatMap((candidate): FrontmatterEdit[] => {
      const { path } = candidate;
      if (path === undefined) {
        return [];
      }
      const [key, index] = path;
      const at = index === undefined ? ["version"] : [index, "version"];
      return [{ kind: "set-scalar", key, path: at, value: versionFor(candidate, versions) }];
    }),
  );

/** The destination with the value of its first `version=` parameter replaced by `version`. */
const withVersion = (destination: string, version: string): string => {
  const query = destination.indexOf("?") + 1;
  const params = destination.slice(query).split("&");
  const at = params.findIndex((p) => p.startsWith("version="));
  return `${destination.slice(0, query)}${params.toSpliced(at, 1, `version=${version}`).join("&")}`;
};

/**
 * The version each reference of `found` in the text (`property` undefined) or in the property
 * `property` (SR-127) is to get, by its place: target, repository, stored version and `n`.
 */
const versionsToWrite = (
  found: readonly Found[],
  versions: NewVersions,
  property: string | undefined,
): Map<string, string> => {
  const current = new Map<string, string>();
  for (const { target, first } of found) {
    if (target.kind === "reference" && target.property === property) {
      const place = JSON.stringify([target.target, target.repository ?? null, target.version]);
      current.set(`${place}#${String(target.occurrence)}`, versionFor(first, versions));
    }
  }
  return current;
};

/**
 * `text` with the version of the references named in `current` replaced: the `n`-th link with the
 * target, repository and stored version the ID names, counted as `outdated.ts` counts. `seen` holds
 * the counts so far, so the values of one property are counted as one text.
 */
const confirmedReferences = (
  text: string,
  current: ReadonlyMap<string, string>,
  seen: Map<string, number>,
): string => {
  const parts: string[] = [];
  let last = 0;
  for (const reference of inlineReferences(text)) {
    const place = JSON.stringify([reference.id, reference.repository ?? null, reference.version ?? null]);
    const occurrence = (seen.get(place) ?? 0) + 1;
    seen.set(place, occurrence);
    const version = current.get(`${place}#${String(occurrence)}`);
    if (version !== undefined) {
      parts.push(text.slice(last, reference.start), withVersion(reference.destination, version));
      last = reference.end;
    }
  }
  parts.push(text.slice(last));
  return parts.join("");
};

/**
 * The body with the versions of the inline references of `found` replaced; undefined when `found`
 * names no reference of the text.
 */
const confirmedText = (body: string, found: readonly Found[], versions: NewVersions): string | undefined => {
  const current = versionsToWrite(found, versions, undefined);
  return current.size === 0 ? undefined : confirmedReferences(body, current, new Map());
};

/** The text of the scalar at `path` of the frontmatter as written in the file, with its quotes. */
const sourceOf = (file: ParsedFile, path: readonly (string | number)[]): string | undefined => {
  const node: unknown = file.document.getIn(path, true);
  if (!isScalar(node)) {
    return undefined;
  }
  // A scalar of a parsed document has its range.
  const [start, end] = node.range as [number, number, number];
  return file.frontmatter.slice(start, end);
};

/** Whether `a` and `b` hold the same inline references (what they link to, and how). */
const sameLinks = (a: string, b: string): boolean => {
  const destinations = (text: string): string[] => inlineReferences(text).map((r) => r.destination);
  return isDeepStrictEqual(destinations(a), destinations(b));
};

/** Whether the value at `path` of the frontmatter is a block scalar (`|`, `>`), which `set-scalar` does not edit. */
const isBlockScalar = (file: ParsedFile, path: readonly (string | number)[]): boolean => {
  const node: unknown = file.document.getIn(path, true);
  return isScalar(node) && (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED);
};

/** The edits for the references in properties marked `markdown` (SR-127): most as `set-scalar`, the rest as `fallback`. */
interface PropertyEdits {
  readonly scalar: FrontmatterEdit[];
  readonly fallback: FrontmatterEdit[];
}

/**
 * The edits for the references of `found` in properties marked `markdown` (SR-127): per value that
 * holds one, the value with the new versions. A value is written by `set-scalar`, which rewrites
 * only that scalar in its own quoting (SR-027 AK1). A block scalar (`|`, `>`) cannot be, so its
 * value is a `fallback` edit: the item replaced (a list) or the key set (one value), as one line.
 * The two kinds are applied one after the other, as `set-scalar` allows no other edit of its key.
 */
const propertyEdits = (file: ParsedFile, found: readonly Found[], versions: NewVersions): PropertyEdits => {
  const keys = new Set(
    found.flatMap(({ target }) =>
      target.kind === "reference" && target.property !== undefined ? [target.property] : [],
    ),
  );
  const data = file.data as Readonly<Record<string, unknown>>;
  const scalar: FrontmatterEdit[] = [];
  const fallback: FrontmatterEdit[] = [];
  for (const key of keys) {
    const current = versionsToWrite(found, versions, key);
    const value = data[key];
    const list = Array.isArray(value);
    const seen = new Map<string, number>();
    ((list ? value : [value]) as unknown[]).forEach((item, index) => {
      const counted = new Map(seen);
      const text = typeof item === "string" ? confirmedReferences(item, current, seen) : item;
      if (text === item) {
        return;
      }
      const path = list ? [key, index] : [key];
      const place = list ? [index] : [];
      if (isBlockScalar(file, path)) {
        fallback.push(
          list
            ? { kind: "replace-item", key, index, value: text as string }
            : { kind: "set", key, value: text as string },
        );
        return;
      }
      // The scalar as written, with the versions replaced in it: its quoting stays, whatever it is.
      const written = sourceOf(file, path);
      const source = written === undefined ? undefined : confirmedReferences(written, current, counted);
      const same = source !== undefined && sameLinks(source, text as string);
      scalar.push({
        kind: "set-scalar",
        key,
        path: place,
        value: text as string,
        ...(same ? { source } : {}),
      });
    });
  }
  return { scalar, fallback };
};

/** The new bytes of `source` with `versions`. */
const planned = (source: Source, versions: NewVersions): Uint8Array => {
  const { unchanged, found } = source;
  const { file } = unchanged.current;
  const body = confirmedText(file.body, found, versions);
  const { scalar, fallback } = propertyEdits(file, found, versions);
  const { bytes } = editElementFile(file, {
    edits: [...itemEdits(found, versions), ...scalar],
    ...(body === undefined ? {} : { body }),
  });
  if (fallback.length === 0) {
    return bytes;
  }
  // The block scalars, now that the other scalars of their keys are written.
  const { file: written } = writtenElement(unchanged.repository.name, bytes, file.snapshot);
  return editElementFile(written, { edits: fallback }).bytes;
};

/** The version of the element `bytes` of `source` hold (ADR-0005), with the images its text embeds. */
const versionOf = async (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  { unchanged }: Source,
  bytes: Uint8Array,
): Promise<string> => {
  const { repository, current } = unchanged;
  const { record, file } = writtenElement(repository.name, bytes, current.file.snapshot);
  const images = await embeddedImages({ repository, ignored: ignoredBy(layout) }, record.file, file.body);
  return elementVersion(record, file.body, metamodel, images);
};

/** A source planned: its new bytes. */
interface Planned {
  readonly source: Source;
  readonly bytes: Uint8Array;
}

/** A source the writer cannot change in place, with its error. */
interface Failed {
  readonly source: Source;
  readonly error: CommandError;
}

/**
 * The bytes of every source, planned until the versions of the written sources that are targets of
 * a hint of this call no longer change (see the file comment). The first plan writes the versions
 * the hints found; after it, only the sources with a hint on a target whose version changed in the
 * round before are planned again, so a ring costs its own files per round, not every file of the
 * call. At most one round per planned source that is a target of a hint, and one more. A source
 * the writer cannot change in place is left out, with the error (`CommandError`) of the writer:
 * that does not depend on the versions written.
 */
const plan = async (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  sources: ReadonlyMap<ElementRecord, Source>,
): Promise<{ bytes: Map<ElementRecord, Planned>; failed: Map<ElementRecord, Failed> }> => {
  const failed = new Map<ElementRecord, Failed>();
  const bytes = new Map<ElementRecord, Planned>();
  for (const [record, source] of sources) {
    try {
      bytes.set(record, { source, bytes: planned(source, new Map()) });
    } catch (error) {
      failed.set(record, { source, error: commandErrorOrThrow(error) });
    }
  }
  // The planned sources with a hint on each planned source.
  const dependents = new Map<ElementRecord, Map<ElementRecord, Source>>();
  for (const [record, { source }] of bytes) {
    for (const { finding } of source.found.flatMap((f) => f.candidates)) {
      if (bytes.has(finding.target)) {
        dependents.set(
          finding.target,
          (dependents.get(finding.target) ?? new Map<ElementRecord, Source>()).set(record, source),
        );
      }
    }
  }
  const versions = new Map<ElementRecord, string>();
  let changed = new Set<ElementRecord>();
  for (const [record, entry] of bytes) {
    if (dependents.has(record)) {
      versions.set(record, await versionOf(layout, metamodel, entry.source, entry.bytes));
      changed.add(record);
    }
  }
  for (let round = 0; round <= dependents.size && changed.size > 0; round++) {
    const again = new Map(
      [...dependents].filter(([target]) => changed.has(target)).flatMap(([, of]) => [...of]),
    );
    changed = new Set();
    for (const [record, source] of again) {
      const entry = { source, bytes: planned(source, versions) };
      bytes.set(record, entry);
      if (dependents.has(record)) {
        const version = await versionOf(layout, metamodel, source, entry.bytes);
        if (versions.get(record) !== version) {
          versions.set(record, version);
          changed.add(record);
        }
      }
    }
  }
  return { bytes, failed };
};

/** `input.invalid` for an input that selects no hint: no IDs, no `ref`, no `target`, or `kind` alone. */
const assertSelects = (input: ConfirmInput): void => {
  const byElement = input.ref !== undefined || input.target !== undefined;
  if (!byElement && input.hintIds === undefined) {
    throw new CommandError(
      "input.invalid",
      "Give hintIds, ref or target: which hints to confirm (hint.list gives the open ones)",
      { command: COMMAND, fields: ["hintIds", "ref", "target"] },
    );
  }
  if (!byElement && input.kind !== undefined) {
    throw new CommandError("input.invalid", "kind narrows the hints of ref or target: give one of them", {
      command: COMMAND,
      fields: ["kind"],
    });
  }
};

/** The elements whose files store relations or inline references to `target`, each once, in index order. */
const sourcesOf = (context: ShownContext, target: ElementRecord): ElementRecord[] => {
  const index = incomingFor(context.workspace, context.store, context.metamodel);
  return [...new Set(incomingTo(index, target.repository, target.id).map((link) => link.source))];
};

/**
 * The IDs of the open hints `ref` and `target` select, narrowed by `kind` (see the file comment);
 * undefined when the input selects by neither. A ref that names no element, or several, fails as
 * everywhere (`ref.unknown`, `ref.ambiguous`).
 */
const selectedIds = async (
  context: ShownContext,
  input: ConfirmInput,
  openOf: (record: ElementRecord) => Promise<Candidate[]>,
): Promise<string[] | undefined> => {
  const { store, shortIds } = context;
  const source = input.ref === undefined ? undefined : resolveRef(store, shortIds, input.ref);
  const target = input.target === undefined ? undefined : resolveRef(store, shortIds, input.target);
  const sources =
    source !== undefined ? [source] : target !== undefined ? sourcesOf(context, target) : undefined;
  if (sources === undefined) {
    return undefined;
  }
  const kinds = input.kind === undefined ? undefined : new Set(input.kind);
  const ids: string[] = [];
  for (const record of sources) {
    for (const { finding } of await openOf(record)) {
      if (
        (target === undefined || finding.target === target) &&
        (kinds === undefined || kinds.has(finding.problem.code))
      ) {
        ids.push(finding.hintId);
      }
    }
  }
  return ids;
};

/** The warning for a selection by `ref` or `target` that finds no open hint to confirm, or for no hint ID at all. */
const nothingSelected = (input: ConfirmInput): Problem => {
  const about = [
    input.ref === undefined ? undefined : `about ${input.ref}`,
    input.target === undefined ? undefined : `pointing at ${input.target}`,
    input.kind === undefined ? undefined : `of kind ${input.kind.join(", ")}`,
  ].filter((part) => part !== undefined);
  return {
    code: "hint.not-found",
    severity: "warning",
    message:
      about.length === 0
        ? "No hint ID is given, so nothing was written (a warning, exit code 0); hint.list gives the open hints"
        : `No open hint ${about.join(" ")} can be confirmed, so nothing was written for it (a warning, exit code 0); hint.list gives the open hints`,
  };
};

/** The canonical form of a hint ID (`hintIdOf`), or the ID itself when it has no hint ID form. */
const canonicalOf = (id: string): string => {
  const target = parseHintId(id);
  return target === undefined ? id : hintIdOf(target);
};

/**
 * The IDs to confirm: `hintIds` as given, then the selected ones (canonical) that no given ID names in
 * any spelling, so no hint is listed twice in `confirmed`; the warning of an empty selection, or of
 * an empty `hintIds` without a selection.
 */
const idsToConfirm = async (
  context: ShownContext,
  input: ConfirmInput,
  openOf: (record: ElementRecord) => Promise<Candidate[]>,
): Promise<{ readonly ids: string[]; readonly problems: Problem[] }> => {
  const given = [...new Set(input.hintIds)];
  const selected = await selectedIds(context, input, openOf);
  const named = new Set(given.map(canonicalOf));
  const empty = selected === undefined ? given.length === 0 : selected.length === 0;
  return {
    ids: [...given, ...[...new Set(selected)].filter((id) => !named.has(id))],
    problems: empty ? [nothingSelected(input)] : [],
  };
};

/** `hint.confirm`: confirms the hints `hintIds` names and those `ref` and `target` select (see the file comment). */
export const confirmHints = async (workspace: Workspace, input: ConfirmInput): Promise<ConfirmedHints> => {
  assertSelects(input);
  const [layout, metamodel, store, shortIds] = await Promise.all([
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
    workspace.get(shortIdState),
  ]);
  const context: ShownContext = { workspace, layout, metamodel, store, shortIds };
  // The confirmable IDs by their source record, in the order of their first ID; by canonical ID.
  const bySource = new Map<ElementRecord, Map<string, Found>>();
  // The open outdated relations and references of each source, computed once.
  const open = new Map<ElementRecord, Promise<Candidate[]>>();
  const openOf = (record: ElementRecord): Promise<Candidate[]> => {
    const known = open.get(record) ?? outdatedOfShown(context, record);
    open.set(record, known);
    return known;
  };
  const { ids, problems } = await idsToConfirm(context, input, openOf);
  problems.push(...kindRefusals(input.kind));
  for (const id of ids) {
    const target = parseHintId(id);
    if (target === undefined) {
      problems.push(refusalOf(id));
      continue;
    }
    const canonical = hintIdOf(target);
    const record = (store.byId.get(target.source) ?? []).find(
      (r) => r.repository === target.sourceRepository && r.file === target.file,
    );
    const candidates =
      record === undefined ? [] : (await openOf(record)).filter((c) => c.finding.hintId === canonical);
    const [first] = candidates;
    if (record === undefined || first === undefined) {
      problems.push(notFound(id, target));
      continue;
    }
    const found = bySource.get(record) ?? new Map<string, Found>();
    bySource.set(record, found);
    // Another spelling of an ID given before names the same items: they are written once.
    found.set(canonical, { ids: [...(found.get(canonical)?.ids ?? []), id], target, candidates, first });
  }
  // Every check before the first write.
  const sources = new Map<ElementRecord, Source>();
  for (const [record, found] of bySource) {
    assertElementWritable(metamodel, record);
    sources.set(record, {
      unchanged: await readUnchanged(workspace, layout, record),
      found: [...found.values()],
    });
  }
  const { bytes, failed } = await plan(layout, metamodel, sources);
  const writes: ElementFileWrite[] = [];
  const confirmedIds = new Set<string>();
  for (const { source, bytes: planned } of bytes.values()) {
    writes.push({ ...source.unchanged, bytes: planned });
    for (const { ids } of source.found) {
      ids.forEach((id) => confirmedIds.add(id));
    }
  }
  for (const [record, { source, error }] of failed) {
    for (const id of source.found.flatMap((f) => f.ids)) {
      problems.push(
        notConfirmable(
          id,
          `${id} is not confirmed: ${record.file} cannot be changed in place (${error.message}); correct the file by hand`,
        ),
      );
    }
  }
  const written = await writeElementFiles(workspace, layout, writes, { titles: { metamodel, store } });
  return {
    confirmed: ids.filter((id) => confirmedIds.has(id)),
    files: written.map((w) => w.file),
    problems,
  };
};
