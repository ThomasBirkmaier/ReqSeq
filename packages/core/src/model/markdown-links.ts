// Inline links and images of a Markdown text (CommonMark subset, ADR-0004): the one scanner that
// inline references (SR-021, SR-066), outdated checks (SR-025) and the embedded images of the
// version (ADR-0005, #178) use. Pure; no file access.
//
// Handled: inline links `[label](destination "title")` and images `![alt](destination)` on one
// line, labels with nested and escaped brackets, destinations in `<…>`, backslash escapes (of
// ASCII punctuation only, so `[](\ )` has the destination `\`), titles with escaped quotes or
// parentheses. A destination with a parenthesis still open where it ends is none (`[](( )`). A line
// is read from left to right with a stack of open brackets, as CommonMark does: a code span binds
// more tightly than the brackets around it (`` [a `]` b](x) `` is a link), while a destination is
// read as written, also with backticks. Links do not nest: a link in the label of another one is
// the link, the outer one is not (`[a [b](x) c](y)` has the link `x`); an image in a link label is
// found as well, before the link; links and images in the alt text of an image are not. Not
// links: anything in fenced code blocks (also inside block quotes), indented code blocks (also an
// indented line right after an ATX heading, a setext heading or a thematic break), and code spans
// on one line.
//
// Cost: one pass per line without recursion, so nesting depth costs no stack. Brackets cost linear
// time, destinations about linear time (parentheses nest at most 32 deep in a destination, a `<…>`
// destination ends at the next `<`), titles linear time (at most one destination without `<…>` and
// one in `<…>` end at the same place, and a title that does not close ends at the next unescaped
// quote or parenthesis of its kind), code spans at most O(n·√n).
//
// Not handled: reference-style links, links that span lines, HTML. Known limitation: list
// indentation is not tracked, so a fence indented by 4 or more spaces in a nested list item is not
// recognised and links in it are found.

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
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * The offset after the code span whose backtick run starts at `start`; after the run alone when no
 * run of the same length closes it (the backticks are then literal). Runs that stay unclosed have
 * different lengths, so a line costs at most O(n·√n) here.
 */
const codeSpanEnd = (line: string, start: number): number => {
  let length = 1;
  while (line[start + length] === "`") {
    length++;
  }
  const close = new RegExp(`(?<!\`)${"`".repeat(length)}(?!\`)`, "g");
  close.lastIndex = start + length;
  const found = close.exec(line);
  return found === null ? start + length : found.index + length;
};

/** One line of inline content, with what makes hopeless destinations cheap to refuse. */
interface Line {
  readonly text: string;
  /** The last `)`, or -1: a destination needs one after its `(`. */
  readonly lastParen: number;
}

/**
 * How deeply parentheses may nest in a destination (CommonMark lets implementations limit it, as
 * commonmark.js does with 32). Each `(` that starts a destination counts for the destinations
 * before it, so with the limit a failing destination is read past at most this many others, and a
 * line costs about linear time.
 */
const MAX_PARENTHESES = 32;

interface Destination {
  readonly start: number;
  readonly end: number;
  /** After the closing `)`. */
  readonly after: number;
}

/**
 * An optional title in `"…"`, `'…'` or `(…)`, then `)`. In a title, its own quote or a parenthesis
 * appears only escaped (CommonMark), so a title that does not close ends at the next one of them.
 */
const TITLE_AND_CLOSE =
  /(?:[ \t]+(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^()\\])*\)))?[ \t]*\)/y;

/** What a backslash escapes (CommonMark): ASCII punctuation; before anything else it is text. */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/**
 * The offset of the `>` that ends a `<…>` destination whose text starts at `start`, or -1: an
 * unescaped `<` before it means there is none (CommonMark).
 */
const angleEnd = (text: string, start: number): number => {
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
    } else if (c === ">") {
      return i;
    } else if (c === "<") {
      return -1;
    }
  }
  return -1;
};

/**
 * The end of a destination without `<…>` that starts at `start`: `)` outside parentheses, or the
 * first space or tab when no parenthesis is open; -1 when one is still open there, at the end of
 * the line, or when parentheses nest too deeply (CommonMark).
 */
const plainEnd = (text: string, start: number): number => {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      if (ESCAPABLE.test(text.charAt(i + 1))) {
        i++;
      }
    } else if (c === "(") {
      depth++;
      if (depth > MAX_PARENTHESES) {
        return -1;
      }
    } else if (c === ")") {
      if (depth === 0) {
        return i;
      }
      depth--;
    } else if (c === " " || c === "\t") {
      return depth === 0 ? i : -1;
    }
  }
  // No `)` follows, so there is no link.
  return -1;
};

/** The destination of a link whose `(` is at `open`, or undefined when there is no valid one. */
const destinationAt = (line: Line, open: number): Destination | undefined => {
  const { text } = line;
  if (open >= line.lastParen) {
    return undefined;
  }
  let i = open + 1;
  while (text[i] === " " || text[i] === "\t") {
    i++;
  }
  const angle = text[i] === "<";
  const start = angle ? i + 1 : i;
  const end = angle ? angleEnd(text, start) : plainEnd(text, start);
  if (end < 0) {
    return undefined;
  }
  TITLE_AND_CLOSE.lastIndex = angle ? end + 1 : end;
  const rest = TITLE_AND_CLOSE.exec(text);
  return rest === null ? undefined : { start, end, after: rest.index + rest[0].length };
};

/** The destination after the `]` at `at` that closes `opener`, or undefined when it closes no link or image. */
const destinationAfter = (
  line: Line,
  opener: Opener | undefined,
  at: number,
  inactiveBelow: number,
): Destination | undefined =>
  opener === undefined || (!opener.image && opener.at < inactiveBelow) || line.text[at + 1] !== "("
    ? undefined
    : destinationAt(line, at + 1);

/** An open `[` (or `![`) that no `]` has closed yet. */
interface Opener {
  readonly at: number;
  readonly image: boolean;
}

/**
 * The links and images of one line of inline content; `offset` is where the line starts in the
 * text. One pass from left to right with a stack of open brackets, as CommonMark does: a `]` closes
 * the nearest open bracket, and when a destination follows it, that is a link or image. A link makes
 * the open link brackets before it text (links do not nest); an image drops what was found in its
 * alt text. No recursion, so nesting depth costs neither time nor stack.
 */
const lineLinks = (text: string, offset: number): MarkdownLink[] => {
  const line: Line = { text, lastParen: text.lastIndexOf(")") };
  const links: MarkdownLink[] = [];
  /** Where each link of `links` opens. */
  const opens: number[] = [];
  const openers: Opener[] = [];
  /** Open link brackets before this offset are text: a link follows them. */
  let inactiveBelow = -1;
  /** The last `!` that is not escaped (-2: none, so no `[` follows it). */
  let bang = -2;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
    } else if (c === "`") {
      i = codeSpanEnd(text, i) - 1;
    } else if (c === "!") {
      bang = i;
    } else if (c === "[") {
      openers.push({ at: i, image: bang === i - 1 });
    } else if (c === "]") {
      const opener = openers.pop();
      const destination = destinationAfter(line, opener, i, inactiveBelow);
      if (opener === undefined || destination === undefined) {
        continue;
      }
      if (opener.image) {
        // What was found since the image opened is in its alt text.
        while ((opens.at(-1) ?? -1) > opener.at) {
          opens.pop();
          links.pop();
        }
      } else {
        inactiveBelow = opener.at;
      }
      links.push({
        image: opener.image,
        label: text.slice(opener.at + 1, i),
        destination: text.slice(destination.start, destination.end),
        start: offset + destination.start,
        end: offset + destination.end,
      });
      opens.push(opener.at);
      i = destination.after - 1;
    }
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

/** Whether an unindented line is the underline of a setext heading or a thematic break: no text. */
const isRule = (content: string, paragraph: boolean): boolean =>
  (paragraph && SETEXT_UNDERLINE.test(content)) || THEMATIC_BREAK.test(content);

/**
 * Whether a line that is neither blank nor a fence holds no inline text: a line of an indented code
 * block, the underline of a setext heading or a thematic break. Updates `blocks`.
 */
const isNoText = (content: string, indented: boolean, blocks: Blocks): boolean => {
  if (indented) {
    return !blocks.paragraph && !blocks.list;
  }
  if (isRule(content, blocks.paragraph)) {
    // No paragraph goes on after it.
    blocks.paragraph = false;
    return true;
  }
  return false;
};

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
  if (isNoText(content, indented, blocks)) {
    return false;
  }
  if (LIST_ITEM.test(content)) {
    blocks.list = true;
  } else if (!indented && !blocks.paragraph) {
    blocks.list = false;
  }
  // A heading is a block of its own: an indented line after it starts an indented code block.
  blocks.paragraph = !HEADING.test(content);
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
      // One by one: spreading the links of a long line into `push` exceeds the argument limit.
      for (const link of lineLinks(content, offset + line.length - content.length)) {
        links.push(link);
      }
    }
    offset += raw.length;
  }
  return links;
};
