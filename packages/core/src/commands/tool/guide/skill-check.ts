// The skill file findings of a full workspace check (SR-229 AK10, #1920), per place of D-079 (`readSkillFiles`):
// - `workspace.skill-older-version`: ReqSeq's own skill file at a place whose version is older than this version of
//   the tool (`compareVersions`) and whose content differs from what this version writes apart from that version
//   (`sameContent`), so a file that differs only in its version line is not reported. One info at that file, with
//   the command-line call that renews it: `tool.guide` with `skill` and `write`, plus `replace` when the file was
//   changed since ReqSeq wrote it (AK8 replaces such a file only on request).
// - `workspace.skill-missing`: a place where nothing lies, while another place holds ReqSeq's own file of any
//   version, changed or not. One info naming that place, with the call that creates it, without `replace`.
// Each finding also says what its call does at every other place where it would not just create, replace or leave
// ReqSeq's own unchanged file (AK10, last sentence): with `replace` it replaces a file ReqSeq did not write or that
// was changed since; without, it writes nothing there and fails (AK8); at a `blocked` place it writes nothing and
// fails either way. The command line, since it writes at every place of D-079, while the API and the MCP server
// refuse one outside the repositories (AK8).
//
// Not reported: a newer or the same version, a version that is no version (`compareVersions` undefined), a
// file ReqSeq did not write, a place that cannot be looked at or written (`blocked`: a link, a folder, a file in the
// way of its folders, a Git place) as a missing place, no file at any place, and a check restricted to changed
// elements (SR-092), since the files are no elements. They are read on every call (their places are outside the
// files the workspace states keep), with no input path, so the result is the same in every access (SR-080 AK2):
// the places of D-079 are fixed and only read, also when they lie in a Git root above the workspace folder, where
// API and MCP do not write (AK8).
import type { Problem } from "../../../catalog.js";
import type { CommandCatalog } from "../../../generated/types.js";
import { PRODUCT_VERSION } from "../../../product.js";
import { contractsBundle } from "../../../runtime/contracts.js";
import type { Workspace } from "../../../runtime/workspace.js";
import { renderCall } from "./calls.js";
import type { SkillPlaceState } from "./skill-file.js";
import { readSkillFiles } from "./skill-file.js";
import { compareVersions } from "./skill.js";

/** The catalog commands of this version, which the skill file and the call name. */
const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;

/** The command-line call that writes the skill file, with `replace` or without. */
const writeCall = (replace: boolean): string =>
  renderCall(
    { command: "tool.guide", input: { skill: true, write: true, ...(replace ? { replace: true } : {}) } },
    "cli",
    ENTRIES,
  );

/** What the call with or without `replace` does at `other`, when that is more than create, replace or leave its own file. */
const atOther = (other: SkillPlaceState, replace: boolean): string | undefined => {
  if (other.state === "blocked") {
    return `writes nothing at ${other.path}, where it cannot write, and so fails`;
  }
  const what =
    other.state === "foreign"
      ? "which ReqSeq did not write"
      : other.state === "own" && !other.intact
        ? "which was changed since ReqSeq wrote it"
        : undefined;
  if (what === undefined) {
    return undefined;
  }
  return replace
    ? `also replaces ${other.path}, ${what}`
    : `writes nothing at ${other.path}, ${what}, and so fails`;
};

/** The sentence on the other places for a finding at `place` whose call has `replace` or not; empty when none. */
const others = (places: readonly SkillPlaceState[], place: SkillPlaceState, replace: boolean): string =>
  places
    .filter((other) => other !== place)
    .flatMap((other) => {
      const said = atOther(other, replace);
      return said === undefined ? [] : [`; the call ${said}`];
    })
    .join("");

/** Whether `place` holds ReqSeq's own file of an older version whose content differs from this version's. */
const olderOwn = (place: SkillPlaceState): place is SkillPlaceState & { readonly state: "own" } =>
  place.state === "own" && !place.sameContent && (compareVersions(place.version, PRODUCT_VERSION) ?? 0) < 0;

/** The infos of AK10, or none (see the file comment). */
export const skillProblems = async (
  workspace: Workspace,
  context: {
    /** The check is restricted to changed elements (SR-092): nothing is reported. */
    readonly restricted: boolean;
  },
): Promise<Problem[]> => {
  if (context.restricted) {
    return [];
  }
  const places = await readSkillFiles(workspace, ENTRIES);
  const holder = places.find((place) => place.state === "own");
  const problems: Problem[] = [];
  for (const place of places) {
    if (olderOwn(place)) {
      const call = writeCall(!place.intact);
      const renew = place.intact
        ? `${call} renews it`
        : `it was changed since, so ${call} renews it and drops those changes`;
      problems.push({
        code: "workspace.skill-older-version",
        severity: "info",
        file: place.path,
        message: `The skill file ${place.path} was written by ReqSeq ${place.version}, and ReqSeq ${PRODUCT_VERSION} writes another; ${renew}${others(places, place, !place.intact)}`,
      });
    }
    if (place.state === "missing" && holder !== undefined) {
      problems.push({
        code: "workspace.skill-missing",
        severity: "info",
        file: place.path,
        message: `The skill file ${place.path} is missing, while ${holder.path} is ReqSeq's skill file; ${writeCall(false)} creates it${others(places, place, false)}`,
      });
    }
  }
  return problems;
};
