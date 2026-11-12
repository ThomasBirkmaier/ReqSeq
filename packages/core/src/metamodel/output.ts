// The output of metamodel.get (SR-012, SR-013), which metamodel.mermaid writes as text (SR-151 AK2): the
// metamodel of the checked-out state as the tool uses it. The
// types with inheritance resolved, the other definitions as written, the keys assigned to each
// built-in meaning (empty when none, SR-013 AK3) and the problems of the metamodel. Each property
// carries `content`, false when not written, so every access says whether it counts to the version
// (D-057, SR-130 AK5, #624). Also works on a read-only workspace (SR-011 AK3), with whatever the
// valid files define. `files` names the files that were read, so a person sees which ones count
// (#625).
import type { CommandOutput, Problem } from "../catalog.js";
import type { Workspace } from "../runtime/workspace.js";
import { metamodelProblems } from "./access.js";
import { metamodelState } from "./state.js";

/** The output of metamodel.get on `workspace` (see the file comment). */
export const metamodelOutput = async (
  workspace: Workspace,
): Promise<CommandOutput<"metamodel.get"> & { readonly problems: readonly Problem[] }> => {
  const metamodel = await workspace.get(metamodelState);
  return {
    types: metamodel.effectiveTypes,
    properties: metamodel.properties.map((property) => ({
      ...property,
      content: property.content === true,
    })),
    relations: metamodel.relations,
    statuses: metamodel.statuses,
    meanings: metamodel.meanings,
    files: metamodel.files.map((file) => ({ repository: metamodel.repository, path: file })),
    problems: await metamodelProblems(workspace),
  };
};
