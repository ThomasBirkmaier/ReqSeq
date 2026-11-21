// element.create (SR-001, SR-002): a new element in its own Markdown file with YAML frontmatter,
// named from the type prefix and the last 12 digits of a new random UUID v4 (D-017, D-056). The
// element gets the initial status of the metamodel (ADR-0002 rule 6). See model/write.ts. A variant
// is not written with validity entries (SR-039 AK2, variants/nested.ts). The element has its verification
// and validation status as element.get gives it (#214), with `names` for its variants and views (#1216).
// With `nextIdentifier` it gets the identifier after the highest of its type (SR-245,
// model/next-identifier.ts), and the output is `incomplete` while a repository is not here (AK9).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { createElement } from "../../model/index.js";
import { elementHints } from "../../hints/index.js";
import { writtenWithNames } from "../../data/index.js";
import { nestedVariantCheck } from "../../variants/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { filesNote, incompleteNote, named, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "element.create",
  answer: (output, _input, names) =>
    sentence(
      `Created ${names.type(output.element.type)} ${named(output.element)}`,
      filesNote(output.files),
      incompleteNote(output.incomplete),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"element.create">> => {
    const written = await createElement(
      ctx.workspace,
      input,
      elementHints,
      await nestedVariantCheck(ctx.workspace, "element.create"),
    );
    const { files, problems } = written;
    const { element, ...names } = await writtenWithNames(ctx.workspace, written.element);
    const incomplete =
      input.nextIdentifier === true &&
      (await ctx.workspace.get(workspaceLayoutState)).repositories.some((r) => !r.available);
    return {
      element,
      ...names,
      files: [...files],
      ...(incomplete ? { incomplete } : {}),
      problems: [...problems],
    };
  },
});
