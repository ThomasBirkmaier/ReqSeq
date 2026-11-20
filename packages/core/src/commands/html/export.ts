// html.export (SR-231, SR-235): the workspace as an HTML export in the folder `output`, written by
// the html-export block (packages/core/docs/html-export.md). The path rule of the access (SR-142)
// has refused an API or MCP target outside the repositories before this runs (SR-235 AK3).
// No status is changed (D-030), no element file is written, and Git is only read (D-036). The start page names what
// changed since the newest baseline (SR-233 AK3): the baseline with the latest date (at the same instant the later
// file), counted as `baseline.get` counts it (`baselineCounts`).
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { CommandContext } from "../../catalog.js";
import type { Baseline } from "../../baselines/index.js";
import { workspaceBaselines } from "../../baselines/index.js";
import type { Problem } from "../../generated/types.js";
import type { NewestBaseline } from "../../html-export/index.js";
import { writeHtmlExport } from "../../html-export/index.js";
import { baselineCounts } from "../baseline/get.js";
import { counted, problemsNote, sentence } from "../answer.js";

/** `absolute` relative to the workspace `root` when it lies inside, else as it is. */
const shown = (root: string, absolute: string): string => {
  const relative = path.relative(root, absolute);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? absolute
    : relative.split(path.sep).join("/");
};

/**
 * The newest baseline and what changed since (see the file comment), undefined without one, with the warnings of
 * `baseline.get` on it.
 */
const newestBaseline = async (
  ctx: CommandContext,
): Promise<{ readonly newest: NewestBaseline | undefined; readonly problems: readonly Problem[] }> => {
  const { baselines } = await workspaceBaselines(ctx.workspace);
  let baseline: Baseline | undefined;
  let latest = Number.NEGATIVE_INFINITY;
  for (const candidate of baselines) {
    // A date that does not parse (a leap second, `…:60Z`) counts as the earliest.
    const parsed = Date.parse(candidate.data.date);
    const time = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
    if (time >= latest) {
      baseline = candidate;
      latest = time;
    }
  }
  if (baseline === undefined) {
    return { newest: undefined, problems: [] };
  }
  const { counts, selectionKnown, problems } = await baselineCounts(ctx, baseline);
  return {
    newest: {
      name: baseline.name,
      date: baseline.data.date,
      changed: counts.changed,
      added: counts.added,
      selectionKnown,
    },
    problems,
  };
};

export default defineCommand({
  name: "html.export",
  answer: (output) =>
    sentence(
      `Exported ${counted(output.pages, "element page")} to ${output.folder}`,
      output.removed === 0 ? "" : `${counted(output.removed, "file")} of the earlier export removed`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"html.export">> => {
    const { workspace } = ctx;
    const target = path.resolve(workspace.root, input.output);
    const { newest, problems } = await newestBaseline(ctx);
    const result = await writeHtmlExport(
      workspace,
      target,
      newest === undefined ? {} : { newestBaseline: newest },
    );
    return {
      folder: shown(workspace.root, target),
      pages: result.pages,
      exportedElements: [...result.exported],
      removed: result.removed,
      problems: [...problems, ...result.problems],
    };
  },
});
