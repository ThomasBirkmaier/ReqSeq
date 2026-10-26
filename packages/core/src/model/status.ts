// Setting the status of elements (SR-017, D-030, ADR-0002 rule 6). The statuses the tool offers are
// the ones of the metamodel, in metamodel order (`metamodel.get` lists them); `element.setStatus`
// takes only those. The value always comes from the caller: the tool never picks or computes one.
// Only the `status` line of each file is rewritten (ADR-0007); UUID, type and file name stay.
// A type may restrict the statuses (#306): then only the type's statuses are taken, and an element
// of a type without status gets none. `status: null` removes the status line (#343), only where the
// type's status is optional: a type without status, or one whose statuses are all marked invalid
// (#344, option 1), so a leftover status can be cleared and a retired element made current again.
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { MetamodelEffectiveType } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findNamed, hasWorkingStatus, listNamed, metamodelState, typeStatuses } from "../metamodel/index.js";
import { editElementFile } from "../files/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS } from "./elements.js";
import { resolveRef } from "./resolve.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState } from "./store.js";
import { invalidStatuses, supersededTargetProblems } from "./superseded.js";
import type { ElementFileWrite } from "./write.js";
import { assertElementWritable, readUnchanged, writeElementFiles } from "./write.js";

export interface SetStatusInput {
  readonly refs: readonly string[];
  /** A status key or display name; `null` removes the status line (#343). */
  readonly status: string | null;
}

/** What `element.setStatus` returns. */
export interface SetStatusResult {
  /** Written files relative to the workspace root, `/` as separator; an element that has the status already is not written. */
  readonly files: readonly string[];
  /** With a status the metamodel marks invalid: the hints on relations to these elements (SR-072 AK2). */
  readonly problems: readonly Problem[];
}

/**
 * The status values the tool offers when a status is set (SR-017): the keys of the metamodel's
 * statuses, in metamodel order.
 */
export const statusValues = (metamodel: Metamodel): readonly string[] => metamodel.statuses.map((s) => s.key);

/**
 * The key of the status `given` names: its key, or its display name in any case (#309, spec
 * question #316); the file always gets the key (SR-012 AK3). Throws `input.invalid` with the
 * statuses as `key (Name)` in the message and their keys as `details.allowed`: `reason:
 * unknown-status` when it names none, `ambiguous-status` (with `details.candidates`) when it names
 * more than one.
 */
export const statusKey = (metamodel: Metamodel, given: string): string => {
  const match = findNamed(metamodel.statuses, given);
  if (match.kind === "found") {
    return match.key;
  }
  const allowed = [...statusValues(metamodel)];
  const list = listNamed(metamodel.statuses);
  throw new CommandError(
    "input.invalid",
    match.kind === "unknown"
      ? `${given} is not a status of the metamodel; the statuses are: ${list}`
      : `${given} names more than one status of the metamodel (${match.keys.join(", ")}); give the key. The statuses are: ${list}`,
    match.kind === "unknown"
      ? { status: given, reason: "unknown-status", allowed }
      : { status: given, reason: "ambiguous-status", allowed, candidates: [...match.keys] },
  );
};

/**
 * Refuses `status` (a key of the metamodel) for `ref`, an element of `type`, when the type does not
 * have it (#306): `input.invalid` with `reason: type-without-status` for a type without status, else
 * `status-not-allowed` with the type's statuses as `key (Name)` in the message and their keys as
 * `details.allowed`.
 */
const assertTypeHasStatus = (
  metamodel: Metamodel,
  type: MetamodelEffectiveType,
  ref: string,
  status: string,
): void => {
  if (type.statuses.includes(status)) {
    return;
  }
  const details = { ref, type: type.key, status, allowed: [...type.statuses] };
  if (type.statuses.length === 0) {
    throw new CommandError(
      "input.invalid",
      `Type ${type.name} (${type.key}) has no status, so ${ref} cannot get one`,
      { ...details, reason: "type-without-status" },
    );
  }
  throw new CommandError(
    "input.invalid",
    `${status} is not a status of type ${type.name} (${type.key}) of ${ref}; its statuses are: ${listNamed(typeStatuses(metamodel, type))}`,
    { ...details, reason: "status-not-allowed" },
  );
};

/**
 * Refuses to remove the status of `ref`, an element of `type`, when the type requires one (#343):
 * when it has a status that is not marked invalid (`hasWorkingStatus`). `input.invalid` with `reason:
 * status-required` and the type's statuses as `key (Name)` in the message and their keys as
 * `details.allowed`.
 */
const assertStatusOptional = (metamodel: Metamodel, type: MetamodelEffectiveType, ref: string): void => {
  if (!hasWorkingStatus(metamodel, type)) {
    return;
  }
  throw new CommandError(
    "input.invalid",
    `Type ${type.name} (${type.key}) of ${ref} requires a status, so it cannot be removed; its statuses are: ${listNamed(typeStatuses(metamodel, type))}`,
    { ref, type: type.key, status: null, allowed: [...type.statuses], reason: "status-required" },
  );
};

/**
 * `element.setStatus` (SR-017, SR-087): sets `input.status`, a status of the metamodel (its key or
 * display name, `statusKey`), on every element of `input.refs`. Every check comes before the first
 * write: the status, each reference, that each element may be written (SR-016 AK3), that its type
 * has the status (#306, `assertTypeHasStatus`) and that no file changed on disk since the element
 * store read it (`file.changed-on-disk`; the store is then read again on the next call). A write
 * that is still refused (a read-only file, a change in the meantime) rolls back the files already
 * written as far as possible (`writeElementFiles`). A reference given twice is written once. With a
 * status the metamodel marks invalid, the result has the hints on relations to the elements, the
 * same as `element.supersede` gives (SR-072 AK2).
 *
 * With `status: null` it removes the `status` line instead (#343), on elements whose type has an
 * optional status only (`assertStatusOptional`); an element without the line is not written. Only
 * that line goes (ADR-0007); the element stays (D-045), and nothing is superseded, so no problems.
 */
export const setElementStatus = async (
  workspace: Workspace,
  input: SetStatusInput,
): Promise<SetStatusResult> => {
  const metamodel = await workspace.get(metamodelState);
  // `undefined`: remove the status line (#343).
  const status = input.status === null ? undefined : statusKey(metamodel, input.status);
  const layout = await workspace.get(workspaceLayoutState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const records = new Map<string, ElementRecord>();
  for (const ref of input.refs) {
    const record = resolveRef(store, shortIds, ref);
    const type = assertElementWritable(metamodel, record);
    if (status === undefined) {
      assertStatusOptional(metamodel, type, ref);
    } else {
      assertTypeHasStatus(metamodel, type, ref, status);
    }
    records.set(`${record.repository}\0${record.file}`, record);
  }
  const writes: ElementFileWrite[] = [];
  for (const record of records.values()) {
    const { repository, current } = await readUnchanged(workspace, layout, record);
    const { bytes, changed } = editElementFile(current.file, {
      edits: [
        status === undefined
          ? { kind: "remove", key: "status" }
          : { kind: "set", key: "status", value: status },
      ],
      keyOrder: STRUCTURAL_KEYS,
    });
    if (changed) {
      writes.push({ repository, current, bytes });
    }
  }
  const files = (await writeElementFiles(workspace, layout, writes, { titles: { metamodel, store } })).map(
    (w) => w.file,
  );
  // An invalid status supersedes the elements, whichever command sets it (SR-072 AK2, #84).
  const problems =
    status !== undefined && invalidStatuses(metamodel).has(status)
      ? await supersededTargetProblems(workspace, [...records.values()])
      : [];
  return { files, problems };
};
