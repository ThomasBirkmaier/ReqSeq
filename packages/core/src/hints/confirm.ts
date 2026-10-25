// Confirming hints (SR-027, D-042): "Wenn ein Mensch einen Hinweis auf eine geänderte Fassung
// bestätigt, muss das Tool die neue Fassung in die betroffene Datei schreiben." `hint.confirm`
// takes hint IDs (`hint-id.ts`, SR-025) and writes the current version of each target into the
// relation item or inline reference the ID names, and nothing else (AK1, SR-102 AK1).
//
// - Which hints: an ID is confirmed when the open outdated relations and references of its source
//   (`outdatedOfShown`, by the rules of the check, SR-025) have its canonical form (`hintIdOf` of
//   the parsed ID, so parameter order and percent-encoding do not matter). The source is the record
//   of the element store with the repository, file and UUID the ID names. Items of one list that
//   share the ID (the same target written twice by hand) are confirmed together.
// - What is written: a relation item gets only the text of its `version` scalar replaced, in its
//   own quoting (`set-scalar` of `files/edit.ts`); title, other keys, comments and layout stay. This
//   works for relation kinds and for relation-valued properties (validity, packages; ADR-0004), as
//   a list or a single target. An inline reference gets only the value of its first `version=`
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
//   others are; `hint.not-found` (warning, exit code 0) for an ID of that form that no open hint has
//   (confirmed already, the target changed again, the relation or the file is gone).
// - Only element files are written: never Git (D-036), never a status (SR-087 AK2), nothing is
//   deleted (D-045). The command is refused while the workspace is read-only (ADR-0002 rule 5).
import type { Problem } from "../catalog.js";
import type { CommandError } from "../catalog.js";
import { commandErrorOrThrow } from "../catalog.js";
import type { FrontmatterEdit } from "../files/index.js";
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

/** What `hint.confirm` did. */
export interface ConfirmedHints {
  /** The IDs confirmed, in the order given, each once. */
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
  "only a hint on a changed version (relation.outdated, with its hintId in hint.list) is confirmed, by writing the current version (D-042); other hints go away when what they report is changed";

const notConfirmable = (
  id: string,
  reason = `${id} is no ID of a hint that can be confirmed: ${NOT_CONFIRMABLE}`,
): Problem => ({
  code: "hint.not-confirmable",
  severity: "error",
  message: reason,
  hintId: id,
});

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
 * `body` with the version of every inline reference of `found` replaced: the `n`-th link of the text
 * with the target, repository and stored version the ID names (counted as `outdated.ts` counts).
 * Undefined when `found` names no reference.
 */
const confirmedText = (body: string, found: readonly Found[], versions: NewVersions): string | undefined => {
  const current = new Map<string, string>();
  for (const { target, first } of found) {
    if (target.kind === "reference") {
      const place = JSON.stringify([target.target, target.repository ?? null, target.version]);
      current.set(`${place}#${String(target.occurrence)}`, versionFor(first, versions));
    }
  }
  if (current.size === 0) {
    return undefined;
  }
  const seen = new Map<string, number>();
  const parts: string[] = [];
  let last = 0;
  for (const reference of inlineReferences(body)) {
    const place = JSON.stringify([reference.id, reference.repository ?? null, reference.version ?? null]);
    const occurrence = (seen.get(place) ?? 0) + 1;
    seen.set(place, occurrence);
    const version = current.get(`${place}#${String(occurrence)}`);
    if (version !== undefined) {
      parts.push(body.slice(last, reference.start), withVersion(reference.destination, version));
      last = reference.end;
    }
  }
  parts.push(body.slice(last));
  return parts.join("");
};

/** The new bytes of `source` with `versions`. */
const planned = (source: Source, versions: NewVersions): Uint8Array => {
  const { file } = source.unchanged.current;
  const body = confirmedText(file.body, source.found, versions);
  return editElementFile(file, {
    edits: itemEdits(source.found, versions),
    ...(body === undefined ? {} : { body }),
  }).bytes;
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

/** `hint.confirm`: confirms the hints `hintIds` names (see the file comment). */
export const confirmHints = async (
  workspace: Workspace,
  input: { readonly hintIds: readonly string[] },
): Promise<ConfirmedHints> => {
  const [layout, metamodel, store, shortIds] = await Promise.all([
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
    workspace.get(shortIdState),
  ]);
  const context: ShownContext = { workspace, layout, metamodel, store, shortIds };
  const problems: Problem[] = [];
  // The confirmable IDs by their source record, in the order of their first ID; by canonical ID.
  const bySource = new Map<ElementRecord, Map<string, Found>>();
  // The open outdated relations and references of each source, computed once.
  const open = new Map<ElementRecord, Promise<Candidate[]>>();
  const openOf = (record: ElementRecord): Promise<Candidate[]> => {
    const known = open.get(record) ?? outdatedOfShown(context, record);
    open.set(record, known);
    return known;
  };
  for (const id of new Set(input.hintIds)) {
    const target = parseHintId(id);
    if (target === undefined) {
      problems.push(notConfirmable(id));
      continue;
    }
    const canonical = hintIdOf(target);
    const record = (store.byId.get(target.source) ?? []).find(
      (r) => r.repository === target.sourceRepository && r.file === target.file,
    );
    const candidates =
      record === undefined
        ? []
        : (await openOf(record)).filter((c) => c.finding.problem.hintId === canonical);
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
  const written = await writeElementFiles(workspace, layout, writes);
  return {
    confirmed: [...new Set(input.hintIds)].filter((id) => confirmedIds.has(id)),
    files: written.map((w) => w.file),
    problems,
  };
};
