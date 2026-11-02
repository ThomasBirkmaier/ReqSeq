// reqif.analyze (SR-055 AK1; ADR-0013 "Import"): the preview of `reqif.import`, which writes
// nothing. It runs the same phases up to the plan: the file (`reqif.invalid`), the mapping, then
// `planImport`. When the mapping neither maps nor omits every entry, the list is `unmapped`, the one
// `reqif.import` refuses with (`reqif.unmapped`); otherwise `new` lists every object the import
// would create and `losses` what it would lose. Without a mapping, a file of ReqSeq (REQ-IF-TOOL-ID
// `reqseq`, SR-052 AK3) is planned with the mapping `reqif.import` builds for it (`ownMappingOf`:
// the saved one of the source, extended, or the one-to-one one), whose `reqif.mapping-differs`
// warning is in `problems`; of any other file every type and relation type is unmapped, with the
// attributes of each type.
//
// A repeated delivery (SR-056 AK1): `changed` lists every element of the source the delivery
// changes, `conflicts` those of them also changed locally, `dropped` the elements whose object the
// file no longer has, each with its UUID; `problems` warns of a title or property the import would
// write back (`reqif.replaces-local`) and of a repository not on this machine, which `reqif.import`
// refuses (`workspace.repository-missing`), and of an element file the store cannot read, which
// it refuses too (the store's problem as a warning, #575/8).
import path from "node:path";
import type { CommandOutput, Problem } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { Metamodel } from "../../metamodel/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState } from "../../model/index.js";
import type { AnyMapping } from "../../reqif/index.js";
import {
  OWN_TOOL_ID,
  existingElements,
  imageReader,
  importDate,
  originKeys,
  ownMappingOf,
  planImport,
  readDelivery,
  readMappingFile,
  unreadableFiles,
} from "../../reqif/index.js";
import type { ReqifFile } from "../../reqif/model.js";
import type { WorkspaceLayout } from "../../workspace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Analysis = CommandOutput<"reqif.analyze">;
type Unmapped = Analysis["unmapped"][number];

const command = "reqif.analyze";

/**
 * The mapping of the analysis: the file `mapping` names, else for a file of ReqSeq the one
 * `reqif.import` builds, else an empty one named `source`, the header TITLE or IDENTIFIER.
 */
const mappingOf = async (
  root: string,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  delivery: ReqifFile,
  own: boolean,
  input: { readonly mapping?: string; readonly source?: string },
): Promise<{ readonly mapping: AnyMapping; readonly problems: readonly Problem[] }> => {
  if (input.mapping !== undefined) {
    return {
      mapping: (await readMappingFile(layout, metamodel, root, input.mapping, command)).mapping,
      problems: [],
    };
  }
  if (own) {
    return await ownMappingOf(root, layout, metamodel, delivery, input.source, command);
  }
  const name = input.source ?? delivery.header.title ?? delivery.header.identifier;
  return { mapping: { "reqseq-reqif-mapping": 1, source: { name } }, problems: [] };
};

export default defineCommand({
  name: "reqif.analyze",
  run: async (ctx, input): Promise<Analysis> => {
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const delivery = await readDelivery(workspace.root, input.file);
    const own = delivery.header.toolId === OWN_TOOL_ID;
    const mapped = await mappingOf(workspace.root, layout, metamodel, delivery, own, input);
    const { mapping } = mapped;
    const missing = layout.repositories.filter((r) => !r.available).map((r) => r.name);
    const problems: Analysis["problems"] = [
      ...missing.map((name) => ({
        code: "workspace.repository-missing" as const,
        severity: "warning" as const,
        message: `Repository ${name} is not on this machine: elements of an earlier delivery there are not matched, and reqif.import refuses until it is there`,
        repository: name,
      })),
      ...unreadableFiles(await workspace.get(elementStoreState)).map((p) => ({
        ...p,
        severity: "warning" as const,
        message: `${String(p.file)} is not matched, as it cannot be read as an element (${p.message}); reqif.import refuses until it is fixed`,
      })),
      ...mapped.problems,
    ];
    const empty: Analysis = {
      unmapped: [],
      new: [],
      changed: [],
      dropped: [],
      conflicts: [],
      losses: [],
      ...(problems.length === 0 ? {} : { problems }),
    };
    try {
      const existing = await existingElements(
        workspace,
        layout,
        metamodel,
        delivery,
        mapping.source.name,
        originKeys(metamodel),
      );
      const plan = await planImport(
        delivery,
        mapping,
        layout,
        metamodel,
        // Never written: the analysis names no delivery.
        { delivery: "", date: importDate(new Date()) },
        imageReader(path.resolve(workspace.root, input.file), ctx.localPaths),
        // A file of ReqSeq is planned as reqif.import plans it, from its channels (SR-052).
        own,
        { existing },
      );
      // The planned UUIDs name no element yet, so neither list carries them; existing ones do.
      const planned = new Set(plan.created.map(({ id }) => id));
      return {
        ...empty,
        new: plan.created.map(({ identifier }) => ({ identifier })),
        changed: [...plan.changed],
        dropped: [...plan.dropped],
        conflicts: [...plan.conflicts],
        losses: plan.losses.map(({ id, ...loss }) =>
          id === undefined || planned.has(id) ? loss : { ...loss, id },
        ),
        ...(problems.length + plan.problems.length === 0
          ? {}
          : { problems: [...problems, ...plan.problems] }),
      };
    } catch (error) {
      if (error instanceof CommandError && error.code === "reqif.unmapped") {
        return { ...empty, unmapped: error.details?.["unmapped"] as Unmapped[] };
      }
      throw error;
    }
  },
});
