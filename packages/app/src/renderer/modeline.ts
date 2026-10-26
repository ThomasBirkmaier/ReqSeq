// What the modeline and the minibuffer show of the open workspace (`workspace.status`). Pure display
// (SR-080 AK1): every value comes from the command's output or error object as it is.
import type { DataExportElement } from "@logreq/core";
import type { InvokeResult } from "../shared/protocol.js";
import type { Buffer } from "./buffers.js";
import { bufferName } from "./buffers.js";

/** The part of the `workspace.status` output the modeline shows. */
interface StatusOutput {
  readonly name: string;
  readonly readOnly: boolean;
  readonly problems?: readonly { readonly severity: string }[];
}

export interface WorkspaceView {
  /** The workspace's name; undefined while none is open. */
  readonly name: string | undefined;
  /** Further parts of the modeline, each only when it means something. */
  readonly marks: readonly string[];
  /** The line for the minibuffer: why no workspace is open. */
  readonly message: string;
}

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

export const workspaceView = (result: InvokeResult): WorkspaceView => {
  if (!result.ok) {
    return { name: undefined, marks: [], message: result.error.message };
  }
  const status = result.output as StatusOutput;
  const problems = status.problems ?? [];
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  return {
    name: status.name,
    marks: [
      ...(status.readOnly ? ["read-only"] : []),
      ...(errors > 0 ? [plural(errors, "error")] : []),
      ...(warnings > 0 ? [plural(warnings, "warning")] : []),
    ],
    message: "",
  };
};

/** What a buffer has loaded, for its part of the modeline. */
export type BufferData =
  | { readonly kind: "list" | "search"; readonly total: number; readonly incomplete: boolean }
  | { readonly kind: "element"; readonly element: DataExportElement };

/**
 * The parts of the modeline for the shown buffer, left of the workspace; each only when it says
 * something. Values are the output's as they are: nothing is computed about a status.
 */
export const bufferView = (buffer: Buffer, data: BufferData | undefined): string[] => {
  if (data === undefined) {
    return [bufferName(buffer)];
  }
  if (data.kind === "element") {
    const { element } = data;
    const outdated = element.relations.filter((relation) => relation.outdated === true).length;
    const hints = element.problems?.length ?? 0;
    return [
      element.identifier ?? element.shortId,
      element.type,
      ...(element.status === undefined ? [] : [element.status]),
      ...(element.readOnly === true ? ["read-only"] : []),
      ...(outdated > 0 ? [`${String(outdated)} outdated`] : []),
      ...(hints > 0 ? [plural(hints, "hint")] : []),
    ];
  }
  return [
    bufferName(buffer),
    plural(data.total, data.kind === "list" ? "element" : "hit"),
    ...(data.incomplete ? ["incomplete: a repository is missing"] : []),
  ];
};
