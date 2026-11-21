import { describe, expect, it } from "vitest";
import { ACCESSES, ACCESS_SYNC_KEY, accessTabs, withoutAccessTabs } from "./access-tabs.js";

const IMPORT = 'import { TabItem, Tabs } from "@astrojs/starlight/components";';
const sections = (labels: readonly string[]): string =>
  labels.map((label) => `## ${label}\n\nIn the ${label}.\n`).join("\n");

describe("accessTabs", () => {
  it("leaves a page without the four sections in order, and ignores headings in code blocks", () => {
    expect(accessTabs("---\ntitle: A\n---\n\n## Overview\n\nText.\n")).toBeUndefined();
    expect(accessTabs(sections(["App", "CLI", "MCP", "API"]))).toBeUndefined();
    expect(accessTabs(sections(["App", "CLI", "API"]))).toBeUndefined();
    expect(accessTabs(`\`\`\`md\n## App\n\`\`\`\n\n${sections(["CLI", "API", "MCP"])}`)).toBeUndefined();
  });

  it("makes the four sections tabs with one sync key, up to the next section, and keeps every tab's text", () => {
    const page = `---\ntitle: A\n---\n\nIntro.\n\n${sections(ACCESSES)}\n## Update\n\nLast.\n`;
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
        `<Tabs syncKey="${ACCESS_SYNC_KEY}">`,
        "",
        '<TabItem label="App">',
        "",
        "In the App.",
        "",
        "</TabItem>",
        "",
        '<TabItem label="CLI">',
        "",
        "In the CLI.",
        "",
        "</TabItem>",
        "",
        '<TabItem label="API">',
        "",
        "In the API.",
        "",
        "</TabItem>",
        "",
        '<TabItem label="MCP">',
        "",
        "In the MCP.",
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
    const page = `## App\n\nA.\n\n## CLI\n\n### More\n\n\`\`\`sh\n## API\n\`\`\`\n\n## API\n\nB.\n\n## MCP\n\nC.\n`;
    const tabbed = String(accessTabs(page));
    expect(tabbed.startsWith(`${IMPORT}\n\n<Tabs syncKey="access">\n\n<TabItem label="App">\n`)).toBe(true);
    expect(tabbed).toContain('<TabItem label="CLI">\n\n### More\n\n```sh\n## API\n```\n');
    expect(tabbed.endsWith("C.\n\n</TabItem>\n\n</Tabs>\n")).toBe(true);
  });

  it("makes the page readable as MDX: comments as MDX comments, braces outside code escaped", () => {
    const page = [
      "<!-- tested: ci-github -->",
      "Use { a: 1 } or `{ b: 2 }`, not \\{ c \\}.",
      "```json",
      '{ "x": 1 }',
      "<!-- in code -->",
      "```",
      "",
      sections(ACCESSES),
    ].join("\n");
    const tabbed = String(accessTabs(page));
    expect(tabbed).toContain(
      '{/* tested: ci-github */}\nUse \\{ a: 1 \\} or `{ b: 2 }`, not \\{ c \\}.\n```json\n{ "x": 1 }\n<!-- in code -->\n```\n',
    );
  });
});

describe("withoutAccessTabs", () => {
  it("gives back the page with the four sections, its comments as HTML comments", () => {
    const page = `---\ntitle: A\n---\n\n<!-- marker -->\n\n${sections(ACCESSES)}\n## Update\n\nLast.\n`;
    expect(withoutAccessTabs(String(accessTabs(page)))).toBe(page);
    const atEnd = `Intro.\n\n${sections(ACCESSES)}`;
    expect(withoutAccessTabs(String(accessTabs(atEnd)))).toBe(atEnd);
  });

  it("leaves the same lines in a code block, and a tab end not followed by a blank line", () => {
    const code = `\`\`\`mdx\n${IMPORT}\n\n<Tabs syncKey="access">\n\n<TabItem label="App">\n{/* x */}\n\`\`\`\n`;
    expect(withoutAccessTabs(code)).toBe(code);
    expect(withoutAccessTabs("A.\n\n</TabItem>\n\n</Tabs>")).toBe("A.\n");
  });
});
