// Text of the tool, put into plain Markdown pages (ADR-0017: no MDX). Descriptions use code spans (`name`), which
// stay code; everything else is escaped, so `<ref>` stays text and never becomes HTML.

/** Characters that Markdown or HTML could read as syntax outside code spans. */
const SPECIAL = /[\\*_[\]<>#|~&]/g;

/** One line of text: code spans kept, the rest escaped, line breaks as spaces. */
export function inline(text: string): string {
  return text
    .replace(/\s*\r?\n\s*/g, " ")
    .split(/(`[^`]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(SPECIAL, (char) => `\\${char}`)))
    .join("");
}

/** The content of a table cell: like `inline`, and `|` escaped in code spans too (GitHub tables). */
export function cell(text: string): string {
  return inline(text)
    .split(/(`[^`]*`)/)
    .map((part, index) => (index % 2 === 1 ? part.replaceAll("|", "\\|") : part))
    .join("");
}

/** A fenced code block whose fence is longer than any run of backticks in `text`. */
export function codeBlock(text: string, language = "text"): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text.replace(/\n+$/, "")}\n${fence}`;
}

/** A Markdown table; every cell is already Markdown. */
export function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}
