// reqif.import (SR-053; ADR-0013 "Import"): imports a ReqIF 1.2 file through a saved mapping, all or
// nothing. Parse (`reqif.invalid`), mapping (`readMappingFile`, SR-054 AK2), the plan in memory
// (reqif/import.ts: `reqif.unmapped`, losses), then every new element file at once
// (`createElementFiles`); a refusal comes before any write. The own metamodel is only read (SR-054
// AK3), and no status is set but the initial one (D-030).
//
// Not yet: the origin properties (SR-057), updating the elements of an earlier delivery and the
// conflicts `take` and `keep` decide (SR-056; until then no import finds a conflict, so both lists
// change nothing), the one-to-one mapping of a ReqSeq file (SR-052) and images (SR-095).
import fs from "node:fs/promises";
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { createFolder } from "../../files/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { createElementFiles, refuseUnlisted } from "../../model/index.js";
import { REQIF_LIMITS, parseReqif, planImport, readMappingFile } from "../../reqif/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/** The bytes of the ReqIF file at the local path `given`, within the size limit. */
const readDelivery = async (root: string, given: string): Promise<Uint8Array> => {
  const absolute = path.resolve(root, given);
  const name = path.basename(absolute);
  try {
    const stat = await fs.stat(absolute);
    if (stat.size > REQIF_LIMITS.bytes) {
      throw new CommandError(
        "reqif.invalid",
        `file: ${name} is larger than ${String(REQIF_LIMITS.bytes)} bytes, the most ReqSeq reads`,
        { fields: ["file"] },
      );
    }
    return await fs.readFile(absolute);
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    throw new CommandError(
      "file.faulty",
      `file: cannot read ${name}: ${String((error as NodeJS.ErrnoException).code)}`,
      {
        fields: ["file"],
      },
    );
  }
};

export default defineCommand({
  name: "reqif.import",
  run: async (ctx, input): Promise<CommandOutput<"reqif.import">> => {
    const command = "reqif.import";
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    if (input.mapping === undefined) {
      throw new CommandError(
        "input.invalid",
        "mapping: name the mapping file of the source (reqif.saveMapping); a file of ReqSeq without mapping is not read yet",
        { command, fields: ["mapping"] },
      );
    }
    const parsed = parseReqif(await readDelivery(workspace.root, input.file));
    if (parsed.kind === "refused") {
      throw new CommandError("reqif.invalid", `file: line ${String(parsed.line)}: ${parsed.message}`, {
        fields: ["file"],
        line: parsed.line,
      });
    }
    const { mapping } = await readMappingFile(layout, metamodel, workspace.root, input.mapping, command);
    const plan = planImport(parsed.file, mapping, layout, metamodel);
    const [first] = plan.files;
    let files: string[] = [];
    if (first !== undefined) {
      // Every file of the plan lies in the one target folder: the rules of the walk are checked once.
      await refuseUnlisted(layout, plan.repository, first.file);
      if (plan.folder !== "") {
        await createFolder(plan.repository.folder, plan.folder);
      }
      files = await createElementFiles(workspace, layout, plan.repository, plan.files);
    }
    return {
      created: [...plan.created],
      updated: [],
      kept: [],
      dropped: [],
      losses: [...plan.losses],
      files,
      problems: [],
    };
  },
});
