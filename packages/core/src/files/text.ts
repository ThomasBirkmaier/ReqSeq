// The text of an element and the body of its file (ADR-0004, #308). The body is everything after
// the closing `---` line, as `splitFrontmatter` keeps it; the files ReqSeq writes and most files
// written by hand have one blank line there, which separates the frontmatter from the text and is
// not part of it. Reading and the version (ADR-0005) keep using the body, so the separator never
// changes a version; only the text the commands show and take goes through these functions.

const LINE_BREAK = /\r\n?/g;

/** The one blank line right after the closing `---` line, if the body has it. */
const separatorOf = (body: string): string =>
  body.startsWith("\n") ? "\n" : body.startsWith("\r\n") ? "\r\n" : "";

/** The text of an element: its body without the blank line after the frontmatter. */
export const elementText = (body: string): string => body.slice(separatorOf(body).length);

const sameLines = (a: string, b: string): boolean =>
  a.replace(LINE_BREAK, "\n") === b.replace(LINE_BREAK, "\n");

/**
 * The body that holds `text`, for a file whose body is now `body` (`""` for a new file). A text
 * equal to the stored one (line breaks aside) keeps the body byte for byte, so the text
 * `element.get` gives can be passed back unchanged. Any other text gets LF and a final line break,
 * and keeps the layout of the file: the blank line after the frontmatter stays, a file written
 * without it stays without (unless the text starts with a blank line), a file without text gets
 * it. An empty text is no body. `editElementFile` applies the file's own line ending.
 */
export const bodyForText = (body: string, text: string): string => {
  if (sameLines(text, elementText(body))) {
    return body;
  }
  if (text === "") {
    return "";
  }
  const lf = text.replace(LINE_BREAK, "\n");
  // A text that starts with a blank line always needs the separator, so it reads back the same.
  const separator = separatorOf(body) || (body === "" || lf.startsWith("\n") ? "\n" : "");
  return `${separator}${lf}${lf.endsWith("\n") ? "" : "\n"}`;
};
