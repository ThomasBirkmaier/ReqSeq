// reqif.analyze (SR-055 AK1; ADR-0013 "Import"): the preview of `reqif.import`, which writes
// nothing. It runs the same phases up to the plan: the file (`reqif.invalid`), the mapping, then
// `planImport`. When the mapping neither maps nor omits every entry, the list is `unmapped`, the one
// `reqif.import` refuses with (`reqif.unmapped`); otherwise `new` lists every object the import
// would create and `losses` what it would lose. Without a mapping every type and relation type of
// the file is unmapped, with the attributes of each type.
//
// Not yet: the one-to-one mapping of a ReqSeq file and `source` (SR-052), and `changed`, `dropped`
// and `conflicts` of a repeated delivery (SR-056), which stay empty, as `reqif.import` creates new
// elements on every import.
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import type { AnyMapping } from "../../reqif/index.js";
import { imageReader, importDate, planImport, readDelivery, readMappingFile } from "../../reqif/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Analysis = CommandOutput<"reqif.analyze">;
type Unmapped = Analysis["unmapped"][number];

export default defineCommand({
  name: "reqif.analyze",
  run: async (ctx, input): Promise<Analysis> => {
    const command = "reqif.analyze";
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const delivery = await readDelivery(workspace.root, input.file);
    const mapping: AnyMapping =
      input.mapping === undefined
        ? {
            "reqseq-reqif-mapping": 1,
            source: { name: input.source ?? delivery.header.title ?? delivery.header.identifier },
          }
        : (await readMappingFile(layout, metamodel, workspace.root, input.mapping, command)).mapping;
    const empty: Analysis = { unmapped: [], new: [], changed: [], dropped: [], conflicts: [], losses: [] };
    try {
      const plan = await planImport(
        delivery,
        mapping,
        layout,
        metamodel,
        // Never written: the analysis names no delivery.
        { delivery: "", date: importDate(new Date()) },
        imageReader(path.resolve(workspace.root, input.file), ctx.localPaths),
      );
      // The planned UUIDs name no element yet, so neither list carries them.
      return {
        ...empty,
        new: plan.created.map(({ identifier }) => ({ identifier })),
        losses: plan.losses.map(({ id: _id, ...loss }) => loss),
      };
    } catch (error) {
      if (error instanceof CommandError && error.code === "reqif.unmapped") {
        return { ...empty, unmapped: error.details?.["unmapped"] as Unmapped[] };
      }
      throw error;
    }
  },
});
