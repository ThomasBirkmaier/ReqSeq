// workspace.init (SR-014): create a workspace with the shipped standard model as its metamodel in
// a folder (created when only it is missing, #637), then open it once and return its problems (none for a new standard
// workspace; an own metamodel repository that is not there yet shows up here, SR-018), with the next steps
// (SR-226 AK2), without those the new workspace refuses while it is read-only (AK6). Unless `skill` is false, it also writes the skill file as `tool.guide` with `write` does, without
// `replace`, at each place of D-079 (SR-229 AK9, `writeSkillFiles`): each place written is listed among the files; an
// existing own file is left and not listed (SR-014 AK1); each place refused is one problem
// `workspace.skill-not-written` with the place and the reason, and the workspace stays created. An error that is
// no refusal (a bug) stops at its place and is one such problem without a place, with only its code.
import fs from "node:fs/promises";
import path from "node:path";
import type { CommandOutput, LocalPaths } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { CommandCatalog, Problem } from "../../generated/types.js";
import {
  STANDARD_MODEL_FILE,
  STANDARD_MODEL_TEXT,
  metamodelState,
  runnableSteps,
} from "../../metamodel/index.js";
import { contractsBundle } from "../../runtime/contracts.js";
import { Workspace } from "../../runtime/workspace.js";
import { createWorkspace, workspaceLayoutState } from "../../workspace/index.js";
import { filesNote, problemsNote, sentence } from "../answer.js";
import { afterInitSteps } from "../../next-steps.js";
import { writeSkillFiles } from "../tool/guide/skill-file.js";

/** The catalog commands of this version, which the skill file names. */
const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;

/** The warning that the skill file was not written at a place, with its message and, when known, the place. */
const notWritten = (message: string, file: string | undefined): Problem => ({
  code: "workspace.skill-not-written",
  severity: "warning",
  message,
  ...(file === undefined ? {} : { file }),
});

/**
 * The skill file of the new workspace (SR-229 AK9), written without `replace` and leaving ReqSeq's own file of
 * another version in place (SR-014 AK1, SR-229 AK9): the places written, and one warning per place not written. The
 * workspace is complete here, so no failure of this step fails the call.
 */
const writeSkill = async (
  created: Workspace,
  localPaths: LocalPaths,
): Promise<{ readonly files: readonly string[]; readonly problems: readonly Problem[] }> => {
  const places = await writeSkillFiles(created, ENTRIES, { replace: false, keepOwn: true, localPaths }).catch(
    (error: unknown) => ({ failed: error }),
  );
  if ("failed" in places) {
    // Only the code: a message of the file system holds absolute paths (ADR-0009).
    const code = (places.failed as NodeJS.ErrnoException | undefined)?.code ?? "unknown";
    return {
      files: [],
      problems: [notWritten(`Not written: the skill file cannot be written (${code})`, undefined)],
    };
  }
  return {
    files: places.flatMap((place) =>
      "refused" in place || place.action === "unchanged" ? [] : [place.path],
    ),
    problems: places.flatMap((place) =>
      "refused" in place ? [notWritten(place.refused.message, place.path)] : [],
    ),
  };
};

/** The path with links resolved, so two spellings of one folder compare equal; the path itself when it does not exist. */
const realPath = async (folder: string): Promise<string> => fs.realpath(folder).catch(() => folder);

export default defineCommand({
  name: "workspace.init",
  answer: (output, input) =>
    sentence(
      output.files.length === 0 ? `Created no workspace ${input.name}` : `Created workspace ${input.name}`,
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"workspace.init">> => {
    // `localPath`: the CLI passes it absolute, API and MCP relative to the workspace root.
    const root = path.resolve(ctx.workspace.root, input.path);
    const files = await createWorkspace(root, {
      name: input.name,
      metamodel: input.metamodel,
      metamodelFile: { name: STANDARD_MODEL_FILE, text: STANDARD_MODEL_TEXT },
    });
    const own = (await realPath(root)) === (await realPath(ctx.workspace.root));
    if (own) {
      // Later calls on the same Workspace object (API, MCP, app) see the new workspace file.
      await ctx.workspace.reset(workspaceLayoutState);
    }
    const created = new Workspace(root);
    try {
      const layout = await created.get(workspaceLayoutState);
      const metamodel = await created.get(metamodelState);
      const skill = input.skill ? await writeSkill(created, ctx.localPaths) : { files: [], problems: [] };
      return {
        files: [...files, ...skill.files],
        // The next steps run in the new workspace (SR-226 AK2), named by its absolute path; while it is
        // read-only (an own metamodel that is not there yet), without those it refuses then (AK6).
        next: await runnableSteps(created, afterInitSteps(root)),
        problems: [...layout.problems, ...metamodel.problems, ...skill.problems],
      };
    } finally {
      await created.close();
    }
  },
});
