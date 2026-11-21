// The four ways in as tabs (#2192): a page whose level-2 sections `## App`, `## CLI`, `## API` and `## MCP` follow
// each other, a how-to (SR-140 AK3) or a command page (SR-139 AK1), reaches the site as MDX with one Starlight
// `TabItem` per section in a `Tabs` with a `syncKey`, so the reader's choice holds on every page. Every tab stays in
// the page, and `llms-full.txt` turns the tabs back into the four sections. The sources stay plain Markdown.

/** The section headings of the four ways in, in this order. */
export const ACCESSES: readonly string[] = ["App", "CLI", "API", "MCP"];

/** The key under which Starlight keeps the chosen tab for every page (`localStorage`). */
export const ACCESS_SYNC_KEY = "access";

const IMPORT = 'import { TabItem, Tabs } from "@astrojs/starlight/components";';
const OPEN = `<Tabs syncKey="${ACCESS_SYNC_KEY}">`;
const item = (label: string): string => `<TabItem label="${label}">`;
const HTML_COMMENT = /^<!--(.*)-->$/;
const MDX_COMMENT = /^\{\/\*(.*)\*\/\}$/;
const FRONT_MATTER = /^---\r?\n[^]*?\r?\n---\r?\n/;

/** Each line of `text` with whether it lies outside fenced code blocks (fence lines count as inside). */
function prose(lines: readonly string[]): boolean[] {
  let fence: string | undefined;
  return lines.map((line) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark !== undefined && (fence === undefined || line.trim() === fence)) {
      fence = fence === undefined ? mark : undefined;
      return false;
    }
    return fence === undefined;
  });
}

/**
 * A line of prose as MDX reads it as Markdown: an HTML comment, such as the marker of a tested snippet, as an MDX
 * comment, and a brace outside code spans escaped, since MDX reads it as the start of an expression. Markdown reads
 * `\{` as `{` too, so `llms-full.txt` keeps the escape.
 */
function mdxProse(line: string): string {
  const comment = HTML_COMMENT.exec(line);
  if (comment !== null) {
    return `{/*${String(comment[1])}*/}`;
  }
  return line
    .split(/(`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/(?<!\\)[{}]/g, "\\$&")))
    .join("");
}

/**
 * The MDX page with the sections of the four ways in as tabs, or undefined when `text` has no `## App` followed by
 * `## CLI`, `## API` and `## MCP` as its next level-2 sections. The tabs end at the next level-2 heading.
 */
export function accessTabs(text: string): string | undefined {
  const front = FRONT_MATTER.exec(text)?.[0] ?? "";
  const lines = text.slice(front.length).split("\n");
  const outside = prose(lines);
  const headings = lines.flatMap((line, index) => {
    const heading = outside[index] === true ? /^## (.+?)\s*$/.exec(line)?.[1] : undefined;
    return heading === undefined ? [] : [{ heading, index }];
  });
  const start = headings.findIndex(({ heading }) => heading === ACCESSES[0]);
  const run = headings.slice(start, start + ACCESSES.length);
  if (
    start < 0 ||
    run.length < ACCESSES.length ||
    run.some(({ heading }, position) => heading !== ACCESSES[position])
  ) {
    return undefined;
  }
  const end = headings[start + ACCESSES.length]?.index ?? lines.length;
  const atEnd = end === lines.length;
  const tabs = lines.flatMap((line, index) => {
    const section = run.find((entry) => entry.index === index);
    if (section !== undefined) {
      return [section === run[0] ? OPEN : "</TabItem>", "", item(section.heading)];
    }
    const text = outside[index] === true ? mdxProse(line) : line;
    return index === end ? ["</TabItem>", "", "</Tabs>", "", text] : [text];
  });
  const body = atEnd ? [...tabs, "</TabItem>", "", "</Tabs>", ""] : tabs;
  return `${front}${IMPORT}\n\n${body.join("\n")}`;
}

/** The Markdown of a page that `accessTabs` wrote: the tabs back as the four sections. */
export function withoutAccessTabs(text: string): string {
  const lines = text.split("\n");
  const outside = prose(lines);
  const out: string[] = [];
  const at = (index: number, ...expected: string[]): boolean =>
    expected.every((line, offset) => lines[index + offset] === line && outside[index + offset] === true);
  let skip = 0;
  for (const [index, line] of lines.entries()) {
    const label = /^<TabItem label="(.+)">$/.exec(lines[index + 2] ?? "")?.[1];
    if (skip > 0) {
      skip -= 1;
    } else if (at(index, IMPORT, "")) {
      skip = 1;
    } else if (label !== undefined && (at(index, OPEN, "") || at(index, "</TabItem>", ""))) {
      out.push(`## ${label}`);
      skip = 2;
    } else if (at(index, "</TabItem>", "", "</Tabs>")) {
      skip = lines[index + 3] === "" ? 3 : 2;
    } else {
      out.push(outside[index] === true ? line.replace(MDX_COMMENT, "<!--$1-->") : line);
    }
  }
  return out.join("\n");
}
