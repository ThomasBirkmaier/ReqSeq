// The times of the versions that a sort by `versionDate` reads (SR-075 AK6, D-013; `sortValuesFor`,
// ordered.ts): for each element
// of the selection its current version (`currentVersionsOf`) and the time Git gives that version
// (`versionTimes`, model/version-date.ts). One walk per HEAD for all files, which the workspace keeps
// (N-036, SR-082 AK4: the limit holds once the sort was applied since the start): never one git call
// per element.
//
// - A version dated by its start: the milliseconds of that date. A version newer than every commit
//   (the content differs from the last commit that changed the file, or the file is in no commit):
//   `Infinity`, so it follows every dated one ascending and leads descending.
// - No time (no current version, no Git, a shallow clone, a failed git call): none, last in both
//   orders. The same where git did not answer in time; those are named per repository by a warning
//   `sort.incomplete`, since the order is then not completely determined.
import type { Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { NORMAL_FORM } from "../model/index.js";
import { currentVersionsOf } from "../model/current-versions.js";
import type { VersionDateRequest } from "../model/version-date.js";
import { versionTimes } from "../model/version-date.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";

/** What a sort by `versionDate` reads: the time of each element, and the warnings of the order. */
export interface VersionTimesOf {
  readonly versionTimes: (element: ElementRecord) => number | undefined;
  readonly problems: readonly Problem[];
}

/** The time of the version of each of `elements` and the warnings of the order (see the file comment). */
export const versionTimesOf = async (
  workspace: Workspace,
  elements: readonly ElementRecord[],
): Promise<VersionTimesOf> => {
  const [layout, metamodel, versions] = await Promise.all([
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
    currentVersionsOf(workspace, elements),
  ]);
  const asked: ElementRecord[] = [];
  const requests: VersionDateRequest[] = [];
  for (const element of elements) {
    const entry = versions.get(element);
    if (entry?.kind === "version") {
      asked.push(element);
      requests.push({
        repository: element.repository,
        file: element.file,
        id: element.id,
        version: entry.forms[NORMAL_FORM],
      });
    }
  }
  const times = new Map<ElementRecord, number>();
  const late = new Map<string, number>();
  const answers = await versionTimes({ workspace, layout, metamodel }, requests);
  asked.forEach((element, index) => {
    const time = answers[index];
    if (time?.kind === "dated") {
      times.set(element, Date.parse(time.date));
    } else if (time?.kind === "uncommitted") {
      times.set(element, Number.POSITIVE_INFINITY);
    } else if (time?.kind === "late") {
      late.set(element.repository, (late.get(element.repository) ?? 0) + 1);
    }
  });
  return {
    versionTimes: (element) => times.get(element),
    problems: [...late].map(([repository, count]): Problem => ({
      code: "sort.incomplete",
      severity: "warning",
      message: `Git did not give the version dates of ${String(count)} ${count === 1 ? "element" : "elements"} of repository ${repository} in time, so the order by versionDate is not completely determined: they are listed last; a new call asks Git again`,
      repository,
    })),
  };
};
