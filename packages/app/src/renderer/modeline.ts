// What the modeline and the minibuffer show of the open workspace (`workspace.status`). Pure display
// (SR-080 AK1): every value comes from the command's output or error object as it is.
import type { InvokeResult } from "../shared/protocol.js";

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
