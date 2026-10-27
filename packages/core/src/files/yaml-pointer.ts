// The line of a value in a whole-file YAML document, for problems that name a JSON pointer (a schema
// violation of a saved filter or a baseline file).
import { isNode } from "yaml";
import type { ParsedYaml } from "./parse.js";

/** The line of the value `pointer` (a JSON pointer) names, or of the closest value above it that has one. */
export const yamlPointerLine = (
  yaml: Pick<ParsedYaml, "document" | "lines">,
  pointer: string,
): number | undefined => {
  const segments =
    pointer === ""
      ? []
      : pointer
          .slice(1)
          .split("/")
          .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
  for (let n = segments.length; n >= 0; n--) {
    const node: unknown = yaml.document.getIn(segments.slice(0, n), true);
    if (isNode(node) && node.range) {
      return yaml.lines.linePos(node.range[0]).line;
    }
  }
  return undefined;
};
