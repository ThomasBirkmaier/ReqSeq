// html.export (SR-231, SR-235): the workspace as an HTML export in the folder `output`, written by
// the html-export block (packages/core/docs/html-export.md). The path rule of the access (SR-142)
// has refused an API or MCP target outside the repositories before this runs (SR-235 AK3).
// No status is changed (D-030), no element file is written, and Git is only read (D-036).
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { writeHtmlExport } from "../../html-export/index.js";
import { counted, problemsNote, sentence } from "../answer.js";

/** `absolute` relative to the workspace `root` when it lies inside, else as it is. */
const shown = (root: string, absolute: string): string => {
  const relative = path.relative(root, absolute);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? absolute
    : relative.split(path.sep).join("/");
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
    const result = await writeHtmlExport(workspace, target);
    return {
      folder: shown(workspace.root, target),
      pages: result.pages,
      exportedElements: [...result.exported],
      removed: result.removed,
      problems: [...result.problems],
    };
  },
});
