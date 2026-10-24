// Setting the status of elements (SR-017, D-030, ADR-0002 rule 6). The statuses the tool offers are
// the ones of the metamodel, in metamodel order (`metamodel.get` lists them); `element.setStatus`
// takes only those. The value always comes from the caller: the tool never picks or computes one.
// Only the `status` line of each file is rewritten (ADR-0007); UUID, type and file name stay.
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { editElementFile } from "../files/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS } from "./elements.js";
import { resolveRef } from "./resolve.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState } from "./store.js";
import type { ElementFileWrite } from "./write.js";
import { assertElementWritable, readUnchanged, writeElementFiles } from "./write.js";

export interface SetStatusInput {
  readonly refs: readonly string[];
  readonly status: string;
}

/** What `element.setStatus` returns. */
export interface SetStatusResult {
  /** Written files relative to the workspace root, `/` as separator; an element that has the status already is not written. */
  readonly files: readonly string[];
  readonly problems: readonly Problem[];
}

/**
 * The status values the tool offers when a status is set (SR-017): the keys of the metamodel's
 * statuses, in metamodel order.
 */
export const statusValues = (metamodel: Metamodel): readonly string[] => metamodel.statuses.map((s) => s.key);

/** Throws `input.invalid` with `reason: unknown-status` and the allowed values unless `status` is one. */
const checkStatus = (metamodel: Metamodel, status: string): void => {
  const allowed = statusValues(metamodel);
  if (!allowed.includes(status)) {
    throw new CommandError(
      "input.invalid",
      `${status} is not a status of the metamodel; the statuses are: ${allowed.join(", ")}`,
      { status, reason: "unknown-status", allowed: [...allowed] },
    );
  }
};

/**
 * `element.setStatus` (SR-017, SR-087): sets `input.status`, a status of the metamodel, on every
 * element of `input.refs`. Every check comes before the first write: the status, each reference,
 * that each element may be written (SR-016 AK3) and that no file changed on disk since the element
 * store read it (`file.changed-on-disk`; the store is then read again on the next call). A write
 * that is still refused (a read-only file, a change in the meantime) rolls back the files already
 * written as far as possible (`writeElementFiles`). A reference given twice is written once.
 */
export const setElementStatus = async (
  workspace: Workspace,
  input: SetStatusInput,
): Promise<SetStatusResult> => {
  const metamodel = await workspace.get(metamodelState);
  checkStatus(metamodel, input.status);
  const layout = await workspace.get(workspaceLayoutState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const records = new Map<string, ElementRecord>();
  for (const ref of input.refs) {
    const record = resolveRef(store, shortIds, ref);
    assertElementWritable(metamodel, record);
    records.set(`${record.repository}\0${record.file}`, record);
  }
  const writes: ElementFileWrite[] = [];
  for (const record of records.values()) {
    const { repository, current } = await readUnchanged(workspace, layout, record);
    const { bytes, changed } = editElementFile(current.file, {
      edits: [{ kind: "set", key: "status", value: input.status }],
      keyOrder: STRUCTURAL_KEYS,
    });
    if (changed) {
      writes.push({ repository, current, bytes });
    }
  }
  const files = (await writeElementFiles(workspace, layout, writes)).map((w) => w.file);
  return { files, problems: [] };
};
