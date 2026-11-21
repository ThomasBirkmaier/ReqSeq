// baseline.compare (SR-051 AK4 to AK7): the difference of an element since a baseline, by the rule of
// the HTML export, with the two commits and the Git command that show it (baselines/compare.ts,
// ADR-0018 "Git"). Runs nothing (SR-083); Git is only read (D-036).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { compareBaseline, namedBaseline } from "../../baselines/index.js";
import { counted, sentence, shortCommit } from "../answer.js";

type Output = CommandOutput<"baseline.compare">;

/** The changes the difference names: the text, each criterion and property, each relation added or removed. */
const changes = ({ difference: d }: Output): number =>
  (d.text === undefined ? 0 : 1) +
  d.criteria.length +
  d.properties.length +
  d.addedRelations.length +
  d.removedRelations.length;

export default defineCommand({
  name: "baseline.compare",
  answer: (output) => {
    const span = `${output.file} in ${output.repository} from commit ${shortCommit(output.from)} to ${output.to === null ? "the working copy" : `commit ${shortCommit(output.to)}`}`;
    const count = changes(output);
    return sentence(
      count === 0
        ? `Found no difference in text, acceptance criteria, properties or relations of ${span}`
        : `Found ${counted(count, "difference")} in text, acceptance criteria, properties and relations of ${span}; the Git command of this output shows the whole diff of the file`,
    );
  },
  run: async ({ workspace }, input): Promise<Output> =>
    compareBaseline(workspace, await namedBaseline(workspace, input.baseline, "baseline.compare"), input.ref),
});
