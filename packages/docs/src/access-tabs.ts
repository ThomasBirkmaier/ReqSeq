// The ways in as tabs (#2192): a page whose level-2 sections `## Web UI`, `## CLI`, `## API` and `## MCP` follow each
// other, a how-to (SR-140 AK3), reaches the site as MDX with one Starlight `TabItem` per section in a `Tabs` with a
// `syncKey`, so the reader's choice holds on every page; so does a command page (SR-139 AK1), whose run starts at
// `## CLI`. Other pages with `## CLI`, `## API` and `## MCP` alone, such as
// the concept page of the three, keep them as headings. Every tab stays in the page, each with a label that only
// print shows (site/src/styles/theme.css prints every tab), and `llms-full.txt` turns the tabs back into the
// sections. The sources stay plain Markdown.

/** The section headings of the ways in, in this order; a command page has them without the first one. */
export const ACCESSES: readonly string[] = ["Web UI", "CLI", "API", "MCP"];

/** The key under which Starlight keeps the chosen tab for every page (`localStorage`). */
export const ACCESS_SYNC_KEY = "access";

/** The class of the label at the top of each tab, shown only in print. */
export const ACCESS_LABEL_CLASS = "access-tab-label";

const IMPORT = 'import { TabItem, Tabs } from "@astrojs/starlight/components";';
const OPEN = `<Tabs syncKey="${ACCESS_SYNC_KEY}">`;
const item = (label: string): string => `<TabItem label="${label}">`;
const printLabel = (label: string): string => `<p class="${ACCESS_LABEL_CLASS}">${label}</p>`;
const ITEM = /^<TabItem label="(.+)">$/;
const LABEL = new RegExp(`^<p class="${ACCESS_LABEL_CLASS}">.+</p>$`);
const HTML_COMMENT = /^(\s*)<!--(.*)-->(\s*)$/;
const MDX_COMMENT = /^(\s*)\{\/\*(.*)\*\/\}(\s*)$/;
const FRONT_MATTER = /^---\r?\n[^]*?\r?\n---\r?\n/;

/**
 * Each line of `lines` with whether it lies outside fenced code blocks (fence lines count as inside). A fence closes
 * on a line of only the same character, at least as many as the opening fence has (CommonMark).
 */
function prose(lines: readonly string[]): boolean[] {
  let fence: string | undefined;
  return lines.map((line) => {
    if (fence === undefined) {
      fence = /^\s*(`{3,}(?!.*`)|~{3,})/.exec(line)?.[1];
      return fence === undefined;
    }
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
    if (close !== undefined && close.startsWith(fence.charAt(0)) && close.length >= fence.length) {
      fence = undefined;
    }
    return false;
  });
}

/**
 * The parts of a line of prose, the odd ones code spans: a run of backticks up to the next run of the same length.
 * A run without its partner on the line, such as a code span across lines, is refused, so a brace in it is never
 * escaped by mistake.
 */
function codeSpans(line: string, where: string): string[] {
  const parts: string[] = [];
  let rest = line;
  for (let run = /`+/.exec(rest); run !== null; run = /`+/.exec(rest)) {
    const after = rest.slice(run.index + run[0].length);
    const close = new RegExp(`(?<!\`)${run[0]}(?!\`)`).exec(after);
    if (close === null) {
      throw new Error(`${where}: a code span that does not end on its line; MDX needs it on one line`);
    }
    const end = run.index + run[0].length + close.index + run[0].length;
    parts.push(rest.slice(0, run.index), rest.slice(run.index, end));
    rest = rest.slice(end);
  }
  return [...parts, rest];
}

/**
 * A line of prose as MDX reads it as Markdown: an HTML comment line, such as the marker of a tested snippet, as an
 * MDX comment, and a brace outside code spans escaped (one not escaped yet: after an even number of backslashes),
 * since MDX reads it as the start of an expression. Any other HTML comment is refused.
 */
function mdxProse(line: string, where: string): string {
  const comment = HTML_COMMENT.exec(line);
  if (comment !== null && !String(comment[2]).includes("*/")) {
    return `${String(comment[1])}{/*${String(comment[2])}*/}${String(comment[3])}`;
  }
  const parts = codeSpans(line, where);
  if (parts.some((part, index) => index % 2 === 0 && part.includes("<!--"))) {
    throw new Error(`${where}: an HTML comment that is not a line of its own; MDX cannot read it`);
  }
  return parts
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/(\\*)([{}])/g, (_all, slashes: string, brace: string) =>
            slashes.length % 2 === 0 ? `${slashes}\\${brace}` : `${slashes}${brace}`,
          ),
    )
    .join("");
}

/**
 * The MDX page with the sections of the ways in as tabs, or undefined when `text` has no `## Web UI` followed by
 * `## CLI`, `## API` and `## MCP` as its next level-2 sections; with `withoutApp` (a command page), the run of
 * `## CLI`, `## API` and `## MCP` counts as well. The tabs end at the next level-2 heading. `path` names the page in an
 * error.
 */
export function accessTabs(text: string, path = "page", withoutApp = false): string | undefined {
  const front = FRONT_MATTER.exec(text)?.[0] ?? "";
  const lines = text.slice(front.length).split("\n");
  const outside = prose(lines);
  const headings = lines.flatMap((line, index) => {
    const heading = outside[index] === true ? /^## (.+?)\s*$/.exec(line)?.[1] : undefined;
    return heading === undefined ? [] : [{ heading, index }];
  });
  const allowed = withoutApp ? ACCESSES : ACCESSES.slice(0, 1);
  const first = headings.findIndex(({ heading }) => allowed.includes(heading));
  const ways = headings[first]?.heading === ACCESSES[0] ? ACCESSES : ACCESSES.slice(1);
  const run = headings.slice(first, first + ways.length);
  if (
    first < 0 ||
    run.length < ways.length ||
    run.some(({ heading }, position) => heading !== ways[position])
  ) {
    return undefined;
  }
  const end = headings[first + ways.length]?.index ?? lines.length;
  // Each tag has a blank line on both sides, so that MDX reads the Markdown between them as blocks.
  const close = ["", "</TabItem>", "", "</Tabs>", ""];
  const frontLines = front.split("\n").length - 1;
  const tabs = lines.flatMap((line, index) => {
    const section = run.find((entry) => entry.index === index);
    if (section !== undefined) {
      const before = section === run[0] ? OPEN : "</TabItem>";
      return ["", before, "", item(section.heading), "", printLabel(section.heading), ""];
    }
    const where = `${path}:${String(frontLines + index + 1)}`;
    const mdx = outside[index] === true ? mdxProse(line, where) : line;
    return index === end ? [...close, mdx] : [mdx];
  });
  const body = end === lines.length ? [...tabs, ...close] : tabs;
  return `${front}${IMPORT}\n\n${body.join("\n")}`;
}

/**
 * The Markdown of a page that `accessTabs` wrote: the tabs back as the sections, its comments as HTML comments
 * and its braces without the escape. A brace escaped in the source loses its escape too, which Markdown reads alike.
 */
export function withoutAccessTabs(text: string): string {
  const lines = text.split("\n");
  const outside = prose(lines);
  const out: string[] = [];
  const at = (index: number, ...expected: (string | RegExp)[]): boolean =>
    expected.every((want, offset) => {
      const line = lines[index + offset];
      const same = typeof want === "string" ? line === want : want.test(line ?? "");
      return same && outside[index + offset] === true;
    });
  let skip = 0;
  for (const [index, line] of lines.entries()) {
    const label = ITEM.exec(lines[index + 2] ?? "")?.[1];
    if (skip > 0) {
      skip -= 1;
    } else if (at(index, IMPORT, "")) {
      skip = 1;
    } else if (
      label !== undefined &&
      (at(index, OPEN) || at(index, "</TabItem>")) &&
      at(index + 1, "", ITEM, "", LABEL, "")
    ) {
      // The blank line before the tag is one that `accessTabs` added; the print label and its blank lines follow.
      out.pop();
      out.push(`## ${label}`);
      skip = 5;
    } else if (at(index, "</TabItem>", "", "</Tabs>", "")) {
      out.pop();
      skip = 3;
    } else if (outside[index] === true) {
      out.push(
        MDX_COMMENT.test(line)
          ? line.replace(MDX_COMMENT, "$1<!--$2-->$3")
          : codeSpans(line, `line ${String(index + 1)}`)
              .map((part, position) =>
                position % 2 === 1
                  ? part
                  : part.replace(/(\\*)\\([{}])/g, (all, slashes: string, brace: string) =>
                      slashes.length % 2 === 0 ? `${slashes}${brace}` : all,
                    ),
              )
              .join(""),
      );
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}
