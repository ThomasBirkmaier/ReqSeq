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
import { workspaceBaselines } from "../../baselines/index.js";
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

/** The newest baseline and what changed since (see the file comment); undefined without one. */
const newestBaseline = async (ctx: CommandContext): Promise<NewestBaseline | undefined> => {
  const { baselines } = await workspaceBaselines(ctx.workspace);
  // A leap second (`…:60Z`) parses as NaN; its comparisons then fall back to file order.
  const [newest] = baselines
    .map((baseline, at) => ({ baseline, at, time: Date.parse(baseline.data.date) }))
    .sort((a, b) => b.time - a.time || b.at - a.at);
  if (newest === undefined) {
    return undefined;
  }
  const { baseline } = newest;
  const { counts, selectionKnown } = await baselineCounts(ctx, baseline);
  return {
    name: baseline.name,
    date: baseline.data.date,
    changed: counts.changed,
    added: counts.added,
    selectionKnown,
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
    const baseline = await newestBaseline(ctx);
    const result = await writeHtmlExport(
      workspace,
      target,
      baseline === undefined ? {} : { newestBaseline: baseline },
    );
    return {
      folder: shown(workspace.root, target),
      pages: result.pages,
      exportedElements: [...result.exported],
      removed: result.removed,
      problems: [...result.problems],
    };
  },
});
