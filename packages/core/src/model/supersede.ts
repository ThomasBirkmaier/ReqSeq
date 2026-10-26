// Superseding an element instead of deleting it (SR-072 AK1, D-045, ADR-0004). The element gets the
// status the caller chose, which must be one the metamodel marks invalid (D-044); the tool never
// picks one (D-030). On request, a successor replaces it: a relation of a kind with the meaning
// `replacement` (D-059) from the successor to the element, written into the successor's file
// (source = new, target = old), so the element's own file changes only in its status line. The
// relation stores the element's UUID and current version like every new relation (SR-021,
// `currentTarget`); one the successor already has is kept with its stored version (#177 (a)).
// Relations to the superseded element then get hints (`superseded.ts`, SR-072 AK2).
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { editElementFile } from "../files/index.js";
import type { MetamodelEffectiveType, MetamodelRelationKind } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import {
  allowsType,
  findNamed,
  listNamed,
  metamodelState,
  relationKindsWithMeaning,
  requireMeaning,
} from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS } from "./elements.js";
import { resolveRef } from "./resolve.js";
import { shortIdState } from "./short-id.js";
import { statusKey } from "./status.js";
import { elementStoreState } from "./store.js";
import { invalidStatuses, supersededTargetProblems } from "./superseded.js";
import { currentTarget } from "./targets.js";
import type { ElementFileWrite } from "./write.js";
import { assertElementWritable, readUnchanged, writeElementFiles } from "./write.js";

export interface SupersedeInput {
  readonly ref: string;
  readonly status: string;
  readonly successor?: string;
  readonly relation?: string;
}

/** What `element.supersede` returns. */
export interface SupersedeResult {
  /** Written files relative to the workspace root, `/` as separator; a file that would not change is not written. */
  readonly files: readonly string[];
  /** The hints on relations to the superseded element (SR-072 AK2). */
  readonly problems: readonly Problem[];
}

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/**
 * The key of the status `given` names (`statusKey`: key or display name, #309), which must be one the
 * metamodel marks invalid (D-044); else `input.invalid` with the invalid statuses as `key (Name)`.
 */
const invalidStatusKey = (metamodel: Metamodel, given: string): string => {
  const invalidOnes = invalidStatuses(metamodel);
  const allowed = [...invalidOnes.keys()];
  const list =
    allowed.length === 0
      ? "the metamodel marks no status invalid"
      : `the invalid statuses are: ${listNamed([...invalidOnes.values()])}`;
  const match = findNamed(metamodel.statuses, given);
  if (match.kind === "ambiguous") {
    // The same refusal as element.setStatus gives, with every status to choose from.
    statusKey(metamodel, given);
  }
  if (match.kind !== "found") {
    throw invalid(`${given} is not a status of the metamodel; ${list}`, {
      status: given,
      reason: "unknown-status",
      allowed,
    });
  }
  if (!invalidOnes.has(match.key)) {
    throw invalid(
      `${given} is not marked invalid in the metamodel, so it cannot supersede an element; ${list}`,
      { status: given, reason: "not-invalid", allowed },
    );
  }
  return match.key;
};

/**
 * The relation kind with the meaning `replacement` that goes from the successor's type to the
 * element's type (`source-types`, `target-types`, subtypes included, SR-086). `wanted` names it;
 * without it exactly one kind must fit (ADR-0004: the caller names it when several do), or, when
 * several fit, the successor must already have the relation under exactly one of them (`present`),
 * so a repeat needs no `relation`.
 */
const replacementKind = (
  metamodel: Metamodel,
  successorType: MetamodelEffectiveType,
  type: MetamodelEffectiveType,
  wanted: string | undefined,
  present: (kind: MetamodelRelationKind) => boolean,
): MetamodelRelationKind => {
  requireMeaning(metamodel, "replacement", "element.supersede");
  const kinds = relationKindsWithMeaning(metamodel, "replacement");
  const fits = (kind: MetamodelRelationKind): boolean =>
    allowsType(kind["source-types"], successorType.key, metamodel) &&
    allowsType(kind["target-types"], type.key, metamodel);
  const types = { sourceType: successorType.key, targetType: type.key };
  if (wanted !== undefined) {
    const kind = kinds.find((k) => k.key === wanted);
    if (kind === undefined) {
      throw invalid(
        `${wanted} is no relation kind with the meaning replacement; these are: ${kinds.map((k) => k.key).join(", ")}`,
        { relation: wanted, reason: "not-a-replacement", allowed: kinds.map((k) => k.key) },
      );
    }
    if (!fits(kind)) {
      throw new CommandError(
        "relation.not-allowed",
        `Relation ${kind.name} (${kind.key}) from ${successorType.name} to ${type.name} is not allowed`,
        { relation: kind.key, ...types },
      );
    }
    return kind;
  }
  const fitting = kinds.filter(fits);
  const [first, ...others] = fitting;
  if (first === undefined) {
    throw new CommandError(
      "relation.not-allowed",
      `No relation kind with the meaning replacement may go from ${successorType.name} to ${type.name}`,
      { ...types, candidates: [] },
    );
  }
  const [existing, ...more] = fitting.filter(present);
  if (others.length > 0 && (existing === undefined || more.length > 0)) {
    throw invalid(
      `More than one relation kind with the meaning replacement fits from ${successorType.name} to ${type.name}: ${fitting.map((k) => k.key).join(", ")}; name one as relation`,
      { ...types, reason: "relation-ambiguous", candidates: fitting.map((k) => k.key) },
    );
  }
  // With one kind that fits, `existing` is that kind or absent.
  return existing ?? first;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `source` already has a relation under `key` to `target` (same UUID and repository, D-058). */
const hasRelation = (source: ElementRecord, key: string, target: ElementRecord): boolean => {
  const value = source.data[key];
  return (
    Array.isArray(value) &&
    value.some(
      (item: unknown) =>
        isRecord(item) &&
        item["id"] === target.id &&
        (item["repository"] ?? source.repository) === target.repository,
    )
  );
};

/**
 * `element.supersede` (SR-072 AK1, SR-087): sets `input.status`, a status the metamodel marks
 * invalid, on the element `input.ref` and, with `input.successor`, adds a relation of the
 * replacement kind (`input.relation`, or the one that fits) from the successor to it. Every check
 * comes before the first write: the status, both references, that both elements may be written
 * (SR-016 AK3), the relation kind and that no file changed on disk since the element store read it
 * (`file.changed-on-disk`). Both files are written with `writeElementFiles` (best-effort rollback).
 * Returns the hints on all relations to the element as the store holds them after the write.
 */
export const supersedeElement = async (
  workspace: Workspace,
  input: SupersedeInput,
): Promise<SupersedeResult> => {
  const metamodel = await workspace.get(metamodelState);
  const statusValue = invalidStatusKey(metamodel, input.status);
  const layout = await workspace.get(workspaceLayoutState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const record = resolveRef(store, shortIds, input.ref);
  const type = assertElementWritable(metamodel, record);
  const successor = input.successor === undefined ? undefined : resolveRef(store, shortIds, input.successor);
  if (successor === undefined && input.relation !== undefined) {
    throw invalid("relation names the kind of the relation from a successor; give successor too", {
      relation: input.relation,
      reason: "relation-without-successor",
    });
  }
  if (successor?.repository === record.repository && successor.file === record.file) {
    throw invalid(`${input.ref} cannot be its own successor`, { ref: input.ref, reason: "self" });
  }
  const successorType = successor === undefined ? undefined : assertElementWritable(metamodel, successor);
  const kind =
    successor === undefined || successorType === undefined
      ? undefined
      : replacementKind(metamodel, successorType, type, input.relation, (k) =>
          hasRelation(successor, k.key, record),
        );

  const writes: ElementFileWrite[] = [];
  const old = await readUnchanged(workspace, layout, record);
  const status = editElementFile(old.current.file, {
    edits: [{ kind: "set", key: "status", value: statusValue }],
    keyOrder: STRUCTURAL_KEYS,
  });
  if (status.changed) {
    writes.push({ ...old, bytes: status.bytes });
  }
  if (successor !== undefined && successorType !== undefined && kind !== undefined) {
    const next = await readUnchanged(workspace, layout, successor);
    if (!hasRelation(next.current.record, kind.key, record)) {
      const target = await currentTarget({ layout, metamodel, store }, successor.repository, {
        id: record.id,
        repository: record.repository,
      });
      const { bytes } = editElementFile(next.current.file, {
        // A relation target is a flow mapping of strings (ADR-0004).
        edits: [{ kind: "append-item", key: kind.key, value: { ...target } }],
        keyOrder: successorType.properties,
      });
      writes.push({ ...next, bytes });
    }
  }
  const files = (await writeElementFiles(workspace, layout, writes)).map((w) => w.file);
  return { files, problems: [...(await supersededTargetProblems(workspace, [record]))] };
};
