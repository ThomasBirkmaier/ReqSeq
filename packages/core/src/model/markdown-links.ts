// Inline links and images of a Markdown text (CommonMark subset, ADR-0004): the one scanner that
// inline references (SR-021, SR-066), outdated checks (SR-025) and the embedded images of the
// version (ADR-0005, #178) use. Pure; no file access.
//
// Handled: inline links `[label](destination "title")` and images `![alt](destination)` on one
// line, labels with nested and escaped brackets, destinations in `<…>`, backslash escapes. Not
// links: anything in fenced code blocks (also inside block quotes), indented code blocks, and code
// spans on one line. Not handled: reference-style links, links that span lines, HTML.

/** One inline link or image. */
export interface MarkdownLink {
  readonly image: boolean;
  /** The label as written, without the brackets. */
  readonly label: string;
  /** The destination as written, without `<…>`. */
  readonly destination: string;
  /** Offsets of the destination in the text (inside `<…>` when wrapped), end exclusive. */
  readonly start: number;
  readonly end: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BLOCK_QUOTE = /^(?: {0,3}> ?)*/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const INDENTED = /^(?: {4}|\t)/;

/** The offset after the bracket that closes the label opened at `open`, or -1. */
const labelEnd = (line: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      i++;
    } else if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
};

interface Destination {
  readonly start: number;
  readonly end: number;
  /** After the closing `)`. */
  readonly after: number;
}

/** The destination of a link whose `(` is at `open`, or undefined when there is no valid one. */
const destinationAt = (line: string, open: number): Destination | undefined => {
  let i = open + 1;
  while (line[i] === " " || line[i] === "\t") {
    i++;
  }
  let start: number;
  let end: number;
  if (line[i] === "<") {
    start = i + 1;
    const close = line.indexOf(">", start);
    if (close < 0) {
      return undefined;
    }
    end = close;
    i = close + 1;
  } else {
    start = i;
    let depth = 0;
    for (; i < line.length; i++) {
      const c = line.charAt(i);
      if (c === "\\") {
        i++;
      } else if (c === "(") {
        depth++;
      } else if (c === ")") {
        if (depth === 0) {
          break;
        }
        depth--;
      } else if (c === " " || c === "\t") {
        break;
      }
    }
    end = Math.min(i, line.length);
  }
  // An optional title in quotes, then `)`.
  const rest = /^(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*\)/.exec(line.slice(i));
  return rest === null ? undefined : { start, end, after: i + rest[0].length };
};

/** The links and images of one line of inline content; `offset` is where the line starts. */
const lineLinks = (line: string, offset: number): MarkdownLink[] => {
  const links: MarkdownLink[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") {
      let length = 1;
      while (line[i + length] === "`") {
        length++;
      }
      const run = "`".repeat(length);
      const close = new RegExp(`(?<!\`)${run}(?!\`)`).exec(line.slice(i + run.length));
      i += run.length - 1 + (close === null ? 0 : close.index + run.length);
      continue;
    }
    if (c !== "[") {
      continue;
    }
    const close = labelEnd(line, i);
    const destination = close < 0 || line[close] !== "(" ? undefined : destinationAt(line, close);
    if (destination === undefined) {
      continue;
    }
    links.push({
      image: i > 0 && line[i - 1] === "!" && (i < 2 || line[i - 2] !== "\\"),
      label: line.slice(i + 1, close - 1),
      destination: line.slice(destination.start, destination.end),
      start: offset + destination.start,
      end: offset + destination.end,
    });
    i = destination.after - 1;
  }
  return links;
};

/** Where the block structure is after the lines read so far. */
interface Blocks {
  /** The marker of the open fenced code block. */
  fence?: string;
  /** The previous line was paragraph text, so an indented line continues it. */
  paragraph: boolean;
  /** Inside a list: indented lines are list content, not code. */
  list: boolean;
}

/** Whether `content` (a line without its block quote markers) is inline text; updates `blocks`. */
const isInline = (content: string, blocks: Blocks): boolean => {
  const marker = FENCE.exec(content)?.[1];
  if (blocks.fence !== undefined) {
    if (marker?.startsWith(blocks.fence) === true && content.trim() === marker) {
      delete blocks.fence;
    }
    return false;
  }
  if (marker !== undefined || content.trim() === "") {
    if (marker !== undefined) {
      blocks.fence = marker;
    }
    blocks.paragraph = false;
    return false;
  }
  const indented = INDENTED.test(content);
  if (indented && !blocks.paragraph && !blocks.list) {
    // An indented code block.
    return false;
  }
  if (LIST_ITEM.test(content)) {
    blocks.list = true;
  } else if (!indented && !blocks.paragraph) {
    blocks.list = false;
  }
  blocks.paragraph = true;
  return true;
};

/** The inline links and images of a Markdown text, in order, outside code (see the file comment). */
export const markdownLinks = (text: string): MarkdownLink[] => {
  const links: MarkdownLink[] = [];
  const blocks: Blocks = { paragraph: false, list: false };
  let offset = 0;
  for (const raw of text.split(/(?<=\n)/)) {
    const line = raw.replace(/\r?\n$/, "");
    const content = line.replace(BLOCK_QUOTE, "");
    if (isInline(content, blocks)) {
      links.push(...lineLinks(content, offset + line.length - content.length));
    }
    offset += raw.length;
  }
  return links;
};
