// The skill file of an older ReqSeq version a full workspace check reports (SR-229 AK10, #1920): ReqSeq's own skill file at the
// place of D-079 (`readSkillFile`) whose version is older than this version of the tool (`compareVersions`) and
// whose content differs from what this version writes apart from that version (`sameContent`), so a file that
// differs only in its version line is not reported. One `workspace.skill-older-version` info at the file, with the
// command-line call that renews it: `tool.guide` with `skill` and `write`, plus `replace` when the file was
// changed since ReqSeq wrote it (AK8 replaces such a file only on request). The command line, since it writes
// at every place of D-079, while the API and the MCP server refuse one outside the repositories (AK8).
//
// Not reported: a newer or the same version, a version that is no version (`compareVersions` undefined), a
// missing file or one ReqSeq did not write, a place that cannot be looked at or read (the refusals of
// `readSkillFile`), and a check restricted to changed elements (SR-092), since the file is no element.
// The file is read on every call (its place is outside the files the workspace states keep), with no input
// path, so the result is the same in every access (SR-080 AK2): the place of D-079 is fixed and only read,
// also when it lies in a Git root above the workspace folder, where API and MCP do not write (AK8).
// "Content apart from the version and the check value that follows from it (AK7)" (SR-229 AK10): a file that differs only there is not reported.
import type { Problem } from "../../../catalog.js";
import { CommandError } from "../../../catalog.js";
import type { CommandCatalog } from "../../../generated/types.js";
import { PRODUCT_VERSION } from "../../../product.js";
import { contractsBundle } from "../../../runtime/contracts.js";
import type { Workspace } from "../../../runtime/workspace.js";
import { renderCall } from "./calls.js";
import { readSkillFile } from "./skill-file.js";
import { compareVersions } from "./skill.js";

/** The catalog commands of this version, which the skill file and the call name. */
const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;

/** What a file at the place of the skill is, or undefined when the place cannot be looked at or read. */
const lookedAt = async (
  workspace: Workspace,
): Promise<Awaited<ReturnType<typeof readSkillFile>> | undefined> => {
  try {
    return await readSkillFile(workspace, ENTRIES);
  } catch (error) {
    if (error instanceof CommandError) {
      return undefined;
    }
    throw error;
  }
};

/** The info of AK10, or none (see the file comment). */
export const olderSkillProblems = async (
  workspace: Workspace,
  context: {
    /** The check is restricted to changed elements (SR-092): nothing is reported. */
    readonly restricted: boolean;
  },
): Promise<Problem[]> => {
  if (context.restricted) {
    return [];
  }
  const found = await lookedAt(workspace);
  if (
    found?.state !== "own" ||
    found.sameContent ||
    !((compareVersions(found.version, PRODUCT_VERSION) ?? 0) < 0)
  ) {
    return [];
  }
  const call = renderCall(
    {
      command: "tool.guide",
      input: { skill: true, write: true, ...(found.intact ? {} : { replace: true }) },
    },
    "cli",
    ENTRIES,
  );
  const renew = found.intact
    ? `${call} renews it`
    : `it was changed since, so ${call} renews it and drops those changes`;
  return [
    {
      code: "workspace.skill-older-version",
      severity: "info",
      file: found.path,
      message: `The skill file ${found.path} was written by ReqSeq ${found.version}, and ReqSeq ${PRODUCT_VERSION} writes another; ${renew}`,
    },
  ];
};
