// "Write skill file" (SR-229 AK16): the catalog command `tool.guide` with `skill` and `write`, run at once without
// asking an argument, also with Ctrl/Cmd+Enter. Core writes the file at each place of D-079 by its rules (AK8) and
// gives the answer, which names each place with its result; the output page shows it with the text of the skill
// file once, and a place not written is core's error in the command line, which names each place with its result,
// with no buffer opened (ADR-0002: the app only gives the fixed input).
import type { CommandListing } from "../shared/protocol.js";
import type { CatalogContext } from "./catalog-arguments.js";
import { startCommand } from "./catalog-commands.js";
import type { Prefilled } from "./matrix-menu.js";

/** The catalog command the entry runs. */
export const AGENT_GUIDE = "tool.guide";

/** The entry in the command prompt, and its action. */
export const WRITE_SKILL_FILE = "Write skill file";
export const WRITE_SKILL_ACTION = "write-skill-file";

/** The fixed input: exactly `skill` and `write`, never `replace` (SR-229 AK16). */
export const SKILL_INPUT: readonly Prefilled[] = [
  { field: "skill", value: true, label: "skill" },
  { field: "write", value: true, label: "write" },
];

/** Runs `tool.guide` with `SKILL_INPUT` in `context`; a catalog without it says so, an empty one nothing more. */
export const writeSkill = (context: CatalogContext, catalog: readonly CommandListing[]): void => {
  const command = catalog.find((listed) => listed.name === AGENT_GUIDE);
  if (command === undefined) {
    // An empty catalog is one that could not be read: the minibuffer says why already.
    if (catalog.length > 0) {
      context.echo(`The command catalog has no ${AGENT_GUIDE}`);
    }
    return;
  }
  startCommand(context, command, false, SKILL_INPUT);
};
