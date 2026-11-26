// html.export (SR-231, SR-235): the workspace as an HTML export in the folder `output`, written by
// the html-export block (packages/core/docs/html-export.md). The path rule of the access (SR-142)
// has refused an API or MCP target outside the repositories before this runs (SR-235 AK3).
// No status is changed (D-030), no element file is written, and Git is only read (D-036). Every valid baseline is
// passed as `baseline.get` gives it with all its rows (`baselineShown`), newest first: by date, at the same instant
// the later file first, a date that does not parse as the earliest. The pages of the baselines, the change since each
// on the element pages and in the lists (SR-232 AK7, SR-233 AK2, SR-234 AK1, AK2) and the counts of the newest one
// on the start page (SR-233 AK3) come from them, with the warnings of `baseline.get` on each, given once. The warnings
// on missing version dates (SR-254) are given once for all pages instead (`undatedOf`): for the rows whose version a
// page shows with its date (changed, removed, unchanged), and the pages do not change. `incomplete`
// (SR-006 AK2): a repository of the workspace file is not on this machine, as the start page says.
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { CommandContext } from "../../catalog.js";
import type { Baseline } from "../../baselines/index.js";
import { workspaceBaselines } from "../../baselines/index.js";
import type { Problem } from "../../generated/types.js";
import type { ExportBaseline, NewestBaseline } from "../../html-export/index.js";
import { baselinePage, writeHtmlExport } from "../../html-export/index.js";
import type { UndatedVersion } from "../../model/index.js";
import { UNDATED_CODES, elementStoreState, undatedWarnings } from "../../model/index.js";
import { baselineShown } from "../baseline/get.js";
import { counted, incompleteNote, problemsNote, sentence } from "../answer.js";

/** `absolute` relative to the workspace `root` when it lies inside, else as it is. */
const shown = (root: string, absolute: string): string => {
  const relative = path.relative(root, absolute);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? absolute
    : relative.split(path.sep).join("/");
};

/** The time of a baseline's date; a date that does not parse (a leap second, `…:60Z`) counts as the earliest. */
const timeOf = (baseline: Baseline): number => {
  const parsed = Date.parse(baseline.data.date);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

/** Every valid baseline as `baseline.get` gives it, newest first (see the file comment), with its warnings. */
const exportBaselines = async (
  ctx: CommandContext,
): Promise<{ readonly baselines: readonly ExportBaseline[]; readonly problems: readonly Problem[] }> => {
  const { baselines } = await workspaceBaselines(ctx.workspace);
  // Files in file order: the later of two at the same instant comes first.
  const ordered = baselines
    .map((baseline, index) => ({ baseline, index, time: timeOf(baseline) }))
    .sort((a, b) => b.time - a.time || b.index - a.index);
  const shown: ExportBaseline[] = [];
  // A problem several baselines give (two naming the same commit) once, in the order first given.
  const problems = new Map<string, Problem>();
  for (const { baseline } of ordered) {
    const output = await baselineShown(ctx, baseline);
    shown.push(output);
    for (const problem of output.problems ?? []) {
      if (!UNDATED_CODES.has(problem.code)) {
        problems.set(JSON.stringify(problem), problem);
      }
    }
  }
  return { baselines: shown, problems: [...problems.values(), ...(await undatedOf(ctx, shown))] };
};

/** The states of the rows whose version with its date the pages show (SR-232 AK7, SR-234 AK1). */
const DATED_STATES: ReadonlySet<string> = new Set(["changed", "removed", "unchanged"]);

/**
 * The warnings of SR-254 for the versions without date that a page names (see the file comment), each once for all
 * pages: of every baseline, the rows of an element of the workspace whose version the pages show with its date.
 */
const undatedOf = async (ctx: CommandContext, baselines: readonly ExportBaseline[]): Promise<Problem[]> => {
  const store = await ctx.workspace.get(elementStoreState);
  const undated = baselines.flatMap((baseline) =>
    baseline.elements.flatMap((row): UndatedVersion[] => {
      const element = store.byId.get(row.id)?.find((r) => r.repository === row.repository);
      return row.version === undefined ||
        row.versionDate !== null ||
        !DATED_STATES.has(row.state) ||
        element === undefined
        ? []
        : [{ repository: element.repository, id: element.id, element, version: row.version }];
    }),
  );
  return undatedWarnings(ctx.workspace, undated);
};

/** The newest baseline as the start page names it; undefined without one. */
const newestOf = (baselines: readonly ExportBaseline[]): NewestBaseline | undefined => {
  const [newest] = baselines;
  return newest === undefined
    ? undefined
    : {
        name: newest.name,
        date: newest.date,
        page: baselinePage(newest),
        changed: newest.counts.changed,
        added: newest.counts.added,
        selectionKnown: newest.selectionKnown,
      };
};

export default defineCommand({
  name: "html.export",
  answer: (output) =>
    sentence(
      `Exported ${counted(output.pages, "element page")} to ${output.folder}`,
      output.removed === 0 ? "" : `${counted(output.removed, "file")} of the earlier export removed`,
      incompleteNote(output.incomplete),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"html.export">> => {
    const { workspace } = ctx;
    const target = path.resolve(workspace.root, input.output);
    const { baselines, problems } = await exportBaselines(ctx);
    const newest = newestOf(baselines);
    const result = await writeHtmlExport(workspace, target, {
      baselines,
      ...(newest === undefined ? {} : { newestBaseline: newest }),
    });
    return {
      folder: shown(workspace.root, target),
      pages: result.pages,
      exportedElements: [...result.exported],
      removed: result.removed,
      incomplete: result.incomplete,
      problems: [...problems, ...result.problems],
    };
  },
});
