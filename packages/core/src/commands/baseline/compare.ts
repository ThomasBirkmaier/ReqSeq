// baseline.compare (SR-051 AK4): the two commits and the Git command that show the difference of an
// element since a baseline (baselines/compare.ts, ADR-0018 "Git"). Runs nothing (D-033, SR-083).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { compareBaseline, namedBaseline } from "../../baselines/index.js";
import { sentence, shortCommit } from "../answer.js";

export default defineCommand({
  name: "baseline.compare",
  answer: (output) =>
    sentence(
      `The Git command of this output shows how ${output.file} in ${output.repository} changed from commit ${shortCommit(output.from)} to ${output.to === null ? "the working copy" : `commit ${shortCommit(output.to)}`}`,
    ),
  run: async ({ workspace }, input): Promise<CommandOutput<"baseline.compare">> =>
    compareBaseline(workspace, await namedBaseline(workspace, input.baseline, "baseline.compare"), input.ref),
});
