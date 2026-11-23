import { describe, expect, it } from "vitest";
import { ACCESSES, ACCESS_SYNC_KEY, accessTabs, withoutAccessTabs } from "./access-tabs.js";

const IMPORT = 'import { TabItem, Tabs } from "@astrojs/starlight/components";';
const sections = (labels: readonly string[]): string =>
  labels.map((label) => `## ${label}\n\nIn the ${label}.\n`).join("\n");
const ways = sections(ACCESSES);
/** The page through `accessTabs` and back. */
const roundTrip = (page: string): string => withoutAccessTabs(String(accessTabs(page)));

describe("accessTabs", () => {
  it("leaves a page without the sections in order, and ignores headings in code blocks", () => {
    expect(accessTabs("---\ntitle: A\n---\n\n## Overview\n\nText.\n")).toBeUndefined();
    expect(accessTabs(sections(["Web UI", "CLI", "MCP", "API"]))).toBeUndefined();
    expect(accessTabs(sections(["Web UI", "CLI", "API"]))).toBeUndefined();
    expect(accessTabs(sections(["CLI", "API", "MCP"]))).toBeUndefined();
    expect(accessTabs(`\`\`\`md\n## Web UI\n\`\`\`\n\n${sections(["CLI", "API", "MCP"])}`)).toBeUndefined();
  });

  it("makes the sections tabs without the one on the web UI on a command page only", () => {
    const page = sections(["CLI", "API", "MCP"]);
    expect(accessTabs(page, "page", true)?.match(/<TabItem label="(\w+)">/g)).toEqual([
      '<TabItem label="CLI">',
      '<TabItem label="API">',
      '<TabItem label="MCP">',
    ]);
    expect(withoutAccessTabs(String(accessTabs(page, "page", true)))).toBe(page);
    expect(accessTabs(sections(["CLI", "API"]), "page", true)).toBeUndefined();
    expect(
      accessTabs(`\`\`\`md\n## CLI\n\`\`\`\n\n${sections(["API", "MCP"])}`, "page", true),
    ).toBeUndefined();
    expect(accessTabs(ways, "page", true)?.match(/<TabItem label="([\w ]+)">/g)).toHaveLength(4);
  });

  it("makes the four sections tabs with one sync key and a print label each, up to the next section", () => {
    const page = `---\ntitle: A\n---\n\nIntro.\n\n${ways}\n## Update\n\nLast.\n`;
    const tab = (label: string, before: string) => [
      "",
      before,
      "",
      `<TabItem label="${label}">`,
      "",
      `<p class="access-tab-label">${label}</p>`,
      "",
      "",
      `In the ${label}.`,
      "",
    ];
    expect(accessTabs(page)).toBe(
      [
        "---",
        "title: A",
        "---",
        IMPORT,
        "",
        "",
        "Intro.",
        "",
        ...tab("Web UI", `<Tabs syncKey="${ACCESS_SYNC_KEY}">`),
        ...tab("CLI", "</TabItem>"),
        ...tab("API", "</TabItem>"),
        ...tab("MCP", "</TabItem>"),
        "",
        "</TabItem>",
        "",
        "</Tabs>",
        "",
        "## Update",
        "",
        "Last.",
        "",
      ].join("\n"),
    );
  });

  it("closes the tabs at the end of a page, and keeps sub-headings and code inside a tab", () => {
    const page = `## Web UI\n\nA.\n\n## CLI\n\n### More\n\n\`\`\`sh\n## API\n\`\`\`\n\n## API\n\nB.\n\n## MCP\n\nC.\n`;
    const tabbed = String(accessTabs(page));
    expect(tabbed.startsWith(`${IMPORT}\n\n\n<Tabs syncKey="access">\n\n<TabItem label="Web UI">\n`)).toBe(
      true,
    );
    expect(tabbed).toContain("### More\n\n```sh\n## API\n```\n");
    expect(tabbed.endsWith("C.\n\n\n</TabItem>\n\n</Tabs>\n")).toBe(true);
  });

  it("puts a blank line before each closing tag where a section ends without one", () => {
    const page = "## Web UI\nA.\n## CLI\nB.\n## API\nC.\n## MCP\nD.\n## Next\nE.";
    const tabbed = String(accessTabs(page));
    expect(tabbed).toContain("A.\n\n</TabItem>\n");
    expect(tabbed).toContain("D.\n\n</TabItem>\n\n</Tabs>\n\n## Next\nE.");
    expect(withoutAccessTabs(tabbed)).toBe(page);
    expect(roundTrip("## Web UI\nA.\n## CLI\nB.\n## API\nC.\n## MCP\nD.")).toBe(
      "## Web UI\nA.\n## CLI\nB.\n## API\nC.\n## MCP\nD.",
    );
  });

  it("makes comment lines MDX comments, with indentation and a carriage return", () => {
    const tabbed = String(accessTabs(`<!-- tested: ci-github -->\n  <!-- x -->\r\n${ways}`));
    expect(tabbed).toContain("{/* tested: ci-github */}\n  {/* x */}\r\n");
  });

  it("refuses an HTML comment inside a line, across lines or holding the end of an MDX comment", () => {
    expect(() => accessTabs(`---\ntitle: A\n---\nText <!-- x --> more.\n${ways}`, "how-to/a.md")).toThrow(
      "how-to/a.md:4: an HTML comment that is not a line of its own",
    );
    expect(() => accessTabs(`<!-- start\nend -->\n${ways}`)).toThrow("page:1: an HTML comment");
    expect(() => accessTabs(`<!-- a */ b -->\n${ways}`)).toThrow("page:1: an HTML comment");
    expect(accessTabs(`Write \`<!-- x -->\`.\n${ways}`)).toContain("Write `<!-- x -->`.");
  });

  it("escapes a brace after an even number of backslashes, and leaves an escaped one", () => {
    const tabbed = String(accessTabs(`a { b } c \\{ d \\\\{ e \\\\\\}\n${ways}`));
    expect(tabbed).toContain("a \\{ b \\} c \\{ d \\\\\\{ e \\\\\\}\n");
  });

  it("closes a fence only on the same character, at least as long, and nothing else on the line", () => {
    const page = [
      "````md",
      "```",
      "~~~~",
      "```` x",
      "{ in code }",
      "````",
      "~~~",
      "{ in code }",
      "```",
      "~~~~",
      "{ prose }",
      "",
      ways,
    ].join("\n");
    const tabbed = String(accessTabs(page));
    expect(tabbed).toContain("```` x\n{ in code }\n````\n~~~\n{ in code }\n```\n~~~~\n\\{ prose \\}\n");
    expect(roundTrip(page)).toBe(page);
  });

  it("keeps braces in code spans of any length, and refuses a code span that does not end on its line", () => {
    const tabbed = String(accessTabs(`\`\`a \` {b}\`\` {c} \`{d}\`\n${ways}`));
    expect(tabbed).toContain("``a ` {b}`` \\{c\\} `{d}`\n");
    expect(() => accessTabs(`Use \`a\nb\` here.\n${ways}`, "x.md")).toThrow(
      "x.md:1: a code span that does not end on its line",
    );
  });
});

describe("withoutAccessTabs", () => {
  it("gives back the page with the four sections, its comments as HTML comments and its braces as written", () => {
    const page = `---\ntitle: A\n---\n\n<!-- marker -->\n\n{ a } \`{ b }\` \\\\{ c\n\n${ways}\n## Update\n\nLast.\n`;
    expect(roundTrip(page)).toBe(page);
    const atEnd = `Intro.\n\n${ways}`;
    expect(roundTrip(atEnd)).toBe(atEnd);
    expect(roundTrip(`\\{ escaped\n\n${ways}`)).toBe(`{ escaped\n\n${ways}`);
  });

  it("leaves the same lines in a code block, cut-off tags and a brace it did not escape", () => {
    const code = `\`\`\`mdx\n${IMPORT}\n\n<Tabs syncKey="access">\n\n<TabItem label="Web UI">\n{/* x */}\n\`\`\`\n`;
    expect(withoutAccessTabs(code)).toBe(code);
    expect(withoutAccessTabs('<TabItem label="Web UI">\n\nA.')).toBe('<TabItem label="Web UI">\n\nA.');
    const cut = '<Tabs syncKey="access">\n\n<TabItem label="Web UI">\n';
    expect(withoutAccessTabs(cut)).toBe(cut);
    expect(withoutAccessTabs("\\\\{ stays")).toBe("\\\\{ stays");
  });
});
