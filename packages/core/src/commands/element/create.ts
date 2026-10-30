// element.create (SR-001, SR-002): a new element in its own Markdown file with YAML frontmatter,
// named from the type prefix and the last 12 digits of a new random UUID v4 (D-017, D-056). The
// element gets the initial status of the metamodel (ADR-0002 rule 6). See model/write.ts. A variant
// is not written with validity entries (SR-039 AK2, variants/nested.ts).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { createElement } from "../../model/index.js";
import { elementHints } from "../../hints/index.js";
import { nestedVariantCheck } from "../../variants/index.js";

export default defineCommand({
  name: "element.create",
  run: async (ctx, input): Promise<CommandOutput<"element.create">> => {
    const { element, files, problems } = await createElement(
      ctx.workspace,
      input,
      elementHints,
      await nestedVariantCheck(ctx.workspace, "element.create"),
    );
    return { element, files: [...files], problems: [...problems] };
  },
});
