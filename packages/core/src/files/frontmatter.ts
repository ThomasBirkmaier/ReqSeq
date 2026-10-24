// Frontmatter split by our own small function (ADR-0007): the file must start with a `---` line
// and have a closing `---` line. No front-matter library.

export type LineEnding = "\n" | "\r\n";

export type FrontmatterSplit =
  /** The file does not start with `---`: not an element file (ADR-0004), ignored. */
  | { readonly kind: "none" }
  /** The file starts with `---` but has no closing `---` line: faulty frontmatter (SR-008 AK1). */
  | { readonly kind: "unclosed" }
  | {
      readonly kind: "frontmatter";
      /** YAML text between the two `---` lines, starting at line 2 of the file. */
      readonly yaml: string;
      /** Everything after the closing line, unchanged. */
      readonly body: string;
      /** Line ending of the opening line; kept on write (ADR-0004). */
      readonly eol: LineEnding;
    };

const DELIMITER = "---";

export const splitFrontmatter = (text: string): FrontmatterSplit => {
  if (!text.startsWith(DELIMITER)) {
    return { kind: "none" };
  }
  if (text === DELIMITER) {
    return { kind: "unclosed" };
  }
  const eol: LineEnding | undefined = text.startsWith("\n", 3)
    ? "\n"
    : text.startsWith("\r\n", 3)
      ? "\r\n"
      : undefined;
  if (eol === undefined) {
    return { kind: "none" };
  }
  const yamlStart = DELIMITER.length + eol.length;
  let lineStart = yamlStart;
  for (;;) {
    const nl = text.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (line === DELIMITER) {
      return {
        kind: "frontmatter",
        yaml: text.slice(yamlStart, lineStart),
        body: nl === -1 ? "" : text.slice(nl + 1),
        eol,
      };
    }
    if (nl === -1) {
      return { kind: "unclosed" };
    }
    lineStart = nl + 1;
  }
};
