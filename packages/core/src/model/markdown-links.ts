// Inline links and images of a Markdown text (CommonMark subset, ADR-0004): the one scanner that
// inline references (SR-021, SR-066), outdated checks (SR-025) and the embedded images of the
// version (ADR-0005 "Files", #178) use. Pure; no file access. ADR-0005 states the subset the
// version depends on normatively; this comment describes the implementation.
//
// Handled: lines ending with LF, CRLF or CR; inline links `[label](destination "title")` and
// images `![alt](destination)` on one line, labels with nested and escaped brackets, destinations
// in `<…>`, backslash escapes (of ASCII punctuation only, so `[](\ )` has the destination `\`),
// titles with escaped quotes or parentheses. A destination with a parenthesis still open where it
// ends is none (`[](( )`). A line is read from left to right with a stack of open brackets, as
// CommonMark does: a code span binds more tightly than the brackets around it (`` [a `]` b](x) ``
// is a link), while a destination is read as written, also with backticks. Links do not nest: a
// link in the label of another one is the link, the outer one is not (`[a [b](x) c](y)` has the
// link `x`); an image in a link label is found as well, before the link; links and images in the
// alt text of an inline image are not. Not links: anything in fenced code blocks (also inside
// block quotes), indented code blocks (also an indented line right after an ATX heading, a setext
// heading or a thematic break), and code spans on one line.
//
// `markdownImages` also finds reference-style images (`![alt][ref]`, `![alt][]`, `![alt]`) whose
// label a link reference definition defines. A definition is one line `[ref]: destination` with an
// optional title (the destination in `<…>`, or without spaces and with balanced parentheses),
// outside code and not inside a paragraph, also after a list item marker (also after paragraph
// text); the line after it is
// paragraph text, also when indented. The first definition of a label wins; labels match after
// `normalizeLabel`. Definition lines hold no links.
//
// Cost: one pass per line without recursion, so nesting depth costs no stack. Brackets cost linear
// time, destinations about linear time (parentheses nest at most 32 deep in a destination, a `<…>`
// destination ends at the next `<`), titles linear time (at most one destination without `<…>`
// and one in `<…>` end at the same place, and a title that does not close ends at the next
// unescaped quote or parenthesis of its kind), code spans at most O(n·√n).
//
// `markdownLinksAndMentions` also gives where a word (the `reqseq:` scheme) stands in inline text
// outside code spans and links (label and destination), in the same pass: what is written as
// plain text there (also in an autolink `<…>`, which this scanner does not read as a link) and not
// on a definition line.
//
// Not handled: reference-style links (only images), links and definitions that span lines, HTML
// (links in HTML blocks and comments are found), entity references (`&amp;` stays as written).
// Known limitations: links and images in the alt text of a reference image are found; list
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

/** A reference-style image as written; whether its label is defined is known after the text. */
interface ReferenceImage {
  /** The label, normalised (`normalizeLabel`). */
  readonly label: string;
  /** Where the `[` after its `!` is in the text. */
  readonly at: number;
}

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

/** The destination after the `]` at `at` that closes `opener`; undefined when it closes none. */
const destinationAfter = (
  line: Line,
  opener: Opener | undefined,
  at: number,
  inactiveBelow: number,
): Destination | undefined =>
  opener === undefined || (!opener.image && opener.at < inactiveBelow) || line.text[at + 1] !== "("
    ? undefined
    : destinationAt(line, at + 1);

/**
 * A label as definitions and references match it (CommonMark, ADR-0005): what ECMAScript `trim`
 * removes at both ends removed, runs of spaces and tabs as one space, then `toLowerCase` and
 * `toUpperCase` (locale independent), as commonmark.js folds case.
 */
const normalizeLabel = (label: string): string =>
  label
    .trim()
    .replace(/[ \t]+/g, " ")
    .toLowerCase()
    .toUpperCase();

/** The most characters (UTF-16 code units, as written) a link label may have (CommonMark: 999). */
const MAX_LABEL = 999;

/**
 * The reference label of an image whose alt text closes with the `]` at `at`, and where it ends:
 * `[ref]` (full), `[]` (collapsed, the alt text is the label) or nothing (shortcut). A `[` after
 * the alt text that is no label (no `]` before another `[`, only white space, or longer than
 * `MAX_LABEL`) leaves the image a shortcut, and the brackets after it are text (CommonMark).
 */
const referenceAfter = (text: string, opener: number, at: number): { label: string; end: number } => {
  const alt = text.slice(opener + 1, at);
  if (text[at + 1] === "[") {
    for (let i = at + 2; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") {
        i++;
      } else if (c === "[") {
        break;
      } else if (c === "]") {
        const label = text.slice(at + 2, i);
        if (label === "") {
          return { label: alt, end: i };
        }
        return label.trim() === "" || label.length > MAX_LABEL ? { label: alt, end: at } : { label, end: i };
      }
    }
  }
  return { label: alt, end: at };
};

/** An open `[` (or `![`) that no `]` has closed yet. */
interface Opener {
  readonly at: number;
  readonly image: boolean;
}

/** Where a word stands in inline text: `word` as given, its offsets in the text in order. */
interface Mentions {
  readonly word: string;
  readonly at: number[];
}

/** The mentions to look for on a line: none when the line lacks the word, as most lines do. */
const watched = (text: string, mentions: Mentions | undefined): Mentions | undefined =>
  mentions !== undefined && text.includes(mentions.word) ? mentions : undefined;

/** Records the word when it starts at `i` of a line that starts at `offset` in the text. */
const noteMention = (mentions: Mentions, text: string, i: number, offset: number): void => {
  if (text[i] === mentions.word[0] && text.startsWith(mentions.word, i)) {
    mentions.at.push(offset + i);
  }
};

/**
 * Drops the mentions at or after `at` (an offset in the text): they lie in the label of a link or
 * the alt text of an image that just closed, so they are part of a link, not plain text.
 */
const dropMentions = (mentions: Mentions | undefined, at: number): void => {
  while (mentions !== undefined && (mentions.at.at(-1) ?? -1) >= at) {
    mentions.at.pop();
  }
};

/** What one line has given so far: links with where each opens, and reference images. */
interface LineFound {
  readonly links: MarkdownLink[];
  readonly opens: number[];
  readonly references: ReferenceImage[] | undefined;
}

/** Drops what was found since an image opened at `at` (line at `offset`): it is alt text. */
const dropAltText = (found: LineFound, at: number, offset: number): void => {
  while ((found.opens.at(-1) ?? -1) > at) {
    found.opens.pop();
    found.links.pop();
  }
  const { references } = found;
  while (references !== undefined && (references.at(-1)?.at ?? -1) > offset + at) {
    references.pop();
  }
};

/**
 * The links and images of one line of inline content; `offset` is where the line starts in the
 * text. One pass from left to right with a stack of open brackets, as CommonMark does: a `]` closes
 * the nearest open bracket, and when a destination follows it, that is a link or image. A link
 * makes the open link brackets before it text (links do not nest); an image drops what was found
 * in its alt text. No recursion, so nesting depth costs neither time nor stack.
 */
const lineLinks = (
  text: string,
  offset: number,
  references?: ReferenceImage[],
  mentions?: Mentions,
): MarkdownLink[] => {
  const line: Line = { text, lastParen: text.lastIndexOf(")") };
  const word = watched(text, mentions);
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
      if (opener?.image === true && destination === undefined && references !== undefined) {
        const reference = referenceAfter(text, opener.at, i);
        references.push({ label: normalizeLabel(reference.label), at: offset + opener.at });
        i = reference.end;
        continue;
      }
      if (opener === undefined || destination === undefined) {
        continue;
      }
      if (opener.image) {
        dropAltText({ links, opens, references }, opener.at, offset);
      } else {
        inactiveBelow = opener.at;
      }
      dropMentions(word, offset + opener.at);
      links.push({
        image: opener.image,
        label: text.slice(opener.at + 1, i),
        destination: text.slice(destination.start, destination.end),
        start: offset + destination.start,
        end: offset + destination.end,
      });
      opens.push(opener.at);
      i = destination.after - 1;
    } else if (word !== undefined) {
      noteMention(word, text, i, offset);
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
  /** The previous line was a definition, so an indented line is paragraph text, not code. */
  definition: boolean;
  /** Block quote markers of the last line that was not a lazy paragraph continuation. */
  quote: number;
}

/** Whether an unindented line is the underline of a setext heading or a thematic break: no text. */
const isRule = (content: string, paragraph: boolean): boolean =>
  (paragraph && SETEXT_UNDERLINE.test(content)) || THEMATIC_BREAK.test(content);

/**
 * Whether a line that is neither blank nor a fence holds no inline text: a line of an indented code
 * block, the underline of a setext heading or a thematic break. Updates `blocks`.
 */
const isNoText = (content: string, indented: boolean, blocks: Blocks, afterDefinition: boolean): boolean => {
  if (indented) {
    return !blocks.paragraph && !blocks.list && !afterDefinition;
  }
  if (isRule(content, blocks.paragraph)) {
    // No paragraph goes on after it.
    blocks.paragraph = false;
    return true;
  }
  return false;
};

/**
 * A link reference definition on one line (CommonMark): `[label]: destination` with an optional
 * title, the destination in `<…>` or without spaces. Group 1 is the label, 2 or 3 the
 * destination.
 */
const DEFINITION =
  /^ {0,3}\[((?:\\[\s\S]|[^\\[\]])+)\]:[ \t]*(?:<((?:\\[\s\S]|[^\\<>])*)>|([^\s<]\S*))(?:[ \t]+(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^()\\])*\)))?[ \t]*$/;

/** A link reference definition: its normalised label and its destination as written. */
interface Definition {
  readonly label: string;
  readonly destination: string;
}

/**
 * Whether the parentheses of a destination without `<…>` are balanced (CommonMark): every
 * unescaped `(` closed by a `)`, nested at most `MAX_PARENTHESES` deep.
 */
const balanced = (destination: string): boolean => {
  let depth = 0;
  for (let i = 0; i < destination.length; i++) {
    const c = destination[i];
    if (c === "\\") {
      i++;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    }
    if (depth < 0 || depth > MAX_PARENTHESES) {
      return false;
    }
  }
  return depth === 0;
};

/**
 * Where a definition may start in `content`: after a list item marker; else not in a paragraph,
 * and in a list also after any indentation. Undefined when no definition can start there.
 */
const definitionText = (content: string, indented: boolean, blocks: Blocks): string | undefined => {
  // A list item marker starts a new block, also after paragraph text.
  if (LIST_ITEM.test(content)) {
    return content.replace(LIST_ITEM, "");
  }
  if (blocks.paragraph) {
    return undefined;
  }
  if (indented) {
    return blocks.list ? content.trimStart() : undefined;
  }
  return content;
};

/** The definition `content` is (`definitionText`, `DEFINITION`, `balanced`), or undefined. */
const definitionOf = (content: string, indented: boolean, blocks: Blocks): Definition | undefined => {
  const text = definitionText(content, indented, blocks);
  const match = text === undefined ? null : DEFINITION.exec(text);
  if (match === null) {
    return undefined;
  }
  // Group 1 always matches, and group 3 whenever group 2 does not.
  const label = String(match[1]);
  const destination = match[2] ?? String(match[3]);
  return label.trim() === "" || label.length > MAX_LABEL || (match[2] === undefined && !balanced(destination))
    ? undefined
    : { label: normalizeLabel(label), destination };
};

/** Whether a line is a definition; records it in `definitions` when given. */
const isDefinition = (
  content: string,
  indented: boolean,
  blocks: Blocks,
  definitions: Map<string, string> | undefined,
): boolean => {
  const definition = definitionOf(content, indented, blocks);
  if (definition === undefined) {
    return false;
  }
  if (LIST_ITEM.test(content)) {
    blocks.list = true;
  }
  blocks.definition = true;
  // The first definition of a label wins (CommonMark).
  if (definitions !== undefined && !definitions.has(definition.label)) {
    definitions.set(definition.label, definition.destination);
  }
  return true;
};

/**
 * The marker of a fence that `content` opens, also after a list item marker; none for a backtick
 * fence whose info string holds a backtick (CommonMark).
 */
const openingFence = (content: string): string | undefined => {
  const inner = content.replace(LIST_ITEM, "");
  const marker = FENCE.exec(inner)?.[1];
  return marker?.startsWith("`") === true && inner.slice(inner.indexOf(marker) + marker.length).includes("`")
    ? undefined
    : marker;
};

/** Whether `content` is a fence line, inside a fenced code block, or blank; updates `blocks`. */
const isFenceOrBlank = (content: string, blocks: Blocks): boolean => {
  if (blocks.fence !== undefined) {
    const marker = FENCE.exec(content)?.[1];
    if (marker?.startsWith(blocks.fence) === true && content.trim() === marker) {
      delete blocks.fence;
    }
    return true;
  }
  const marker = openingFence(content);
  if (marker === undefined && content.trim() !== "") {
    return false;
  }
  if (marker !== undefined) {
    blocks.fence = marker;
  }
  blocks.paragraph = false;
  return true;
};

/**
 * Ends a list at an unindented, non-blank line outside a fence that is no list item and does not
 * continue paragraph text lazily: a fence, a thematic break or a heading interrupts the paragraph,
 * and any line ends the list when no paragraph is open (a definition or a thematic break after a
 * blank line, CommonMark).
 */
const endList = (content: string, blocks: Blocks): void => {
  if (
    blocks.fence !== undefined ||
    content.trim() === "" ||
    INDENTED.test(content) ||
    LIST_ITEM.test(content)
  ) {
    return;
  }
  const lazy =
    blocks.paragraph &&
    openingFence(content) === undefined &&
    !THEMATIC_BREAK.test(content) &&
    !HEADING.test(content);
  if (!lazy) {
    blocks.list = false;
  }
};

/**
 * Whether `content` (a line without its block quote markers) is inline text; updates `blocks`. A
 * definition line is none; it goes to `definitions` when given.
 */
const isInline = (content: string, blocks: Blocks, definitions?: Map<string, string>): boolean => {
  const afterDefinition = blocks.definition;
  blocks.definition = false;
  endList(content, blocks);
  if (isFenceOrBlank(content, blocks)) {
    return false;
  }
  const indented = INDENTED.test(content);
  if (isNoText(content, indented, blocks, afterDefinition)) {
    return false;
  }
  if (isDefinition(content, indented, blocks, definitions)) {
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

/** The block quote markers in front of `content` on `line`. */
const countQuotes = (line: string, content: string): number =>
  line.slice(0, line.length - content.length).split(">").length - 1;

/**
 * Follows the block quote depth (`quote` markers on this line): a new marker starts a new block,
 * so paragraph text ends; a line with fewer markers that continues paragraph text keeps the depth
 * (a lazy continuation, CommonMark).
 */
const enterQuote = (blocks: Blocks, quote: number, content: string): void => {
  if (quote > blocks.quote) {
    blocks.paragraph = false;
  }
  if (quote >= blocks.quote || !blocks.paragraph || content.trim() === "" || LIST_ITEM.test(content)) {
    blocks.quote = quote;
  }
};

/** What one pass over a text finds; references and definitions only when asked for. */
interface Scan {
  readonly links: MarkdownLink[];
  readonly references?: ReferenceImage[];
  readonly definitions?: Map<string, string>;
  readonly mentions?: Mentions;
}

const scan = (text: string, found: Scan): Scan => {
  const blocks: Blocks = { paragraph: false, list: false, definition: false, quote: 0 };
  let offset = 0;
  // Lines end with LF, CRLF or CR (CommonMark).
  for (const raw of text.split(/(?<=\n|\r(?!\n))/)) {
    const line = raw.replace(/\r?\n$|\r$/, "");
    const content = line.replace(BLOCK_QUOTE, "");
    enterQuote(blocks, countQuotes(line, content), content);
    if (isInline(content, blocks, found.definitions)) {
      // One by one: spreading the links of a long line into `push` exceeds the argument limit.
      const start = offset + line.length - content.length;
      for (const link of lineLinks(content, start, found.references, found.mentions)) {
        found.links.push(link);
      }
    }
    offset += raw.length;
  }
  return found;
};

/** The inline links and images of a Markdown text, in order, outside code (see file comment). */
export const markdownLinks = (text: string): MarkdownLink[] => scan(text, { links: [] }).links;

/**
 * The inline links and images of a Markdown text as `markdownLinks` gives them, and in the same pass
 * the offsets where `word` stands in inline text outside code spans and links, in order
 * (see the file comment).
 */
export const markdownLinksAndMentions = (
  text: string,
  word: string,
): { links: MarkdownLink[]; mentions: number[] } => {
  const at: number[] = [];
  const { links } = scan(text, { links: [], mentions: { word, at } });
  return { links, mentions: at };
};

/**
 * The destinations of the images of a Markdown text as written (without `<…>`), outside code:
 * inline images in order, then reference-style images whose label is defined, in order (see the
 * file comment). An image embedded twice is given twice.
 */
export const markdownImages = (text: string): string[] => {
  const references: ReferenceImage[] = [];
  const definitions = new Map<string, string>();
  const { links } = scan(text, { links: [], references, definitions });
  return [
    ...links.filter((l) => l.image).map((l) => l.destination),
    ...references.flatMap((r) => {
      const destination = definitions.get(r.label);
      return destination === undefined ? [] : [destination];
    }),
  ];
};
