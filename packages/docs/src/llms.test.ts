import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LLMS_FILE, LLMS_FULL_FILE, llmsFull, llmsIndex, pageUrl, textPage, writeLlmsFiles } from "./llms.js";

const page = (title: string, extra = "", body = "Text.") => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;

let folder = "";
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("llms.txt", () => {
  it("reads title, description, order and body of a page, CRLF too, and refuses a page without a title", () => {
    const read = textPage(
      "how-to/a.md",
      "---\r\ntitle: A\r\ndescription: Does a.\r\nsidebar:\r\n  order: 2\r\n---\r\n\r\nOne.\r\nTwo.\r\n",
    );
    expect(read).toEqual({
      path: "how-to/a.md",
      title: "A",
      description: "Does a.",
      order: 2,
      body: "One.\nTwo.",
    });
    expect(textPage("b.md", page("B")).description).toBe("");
    expect(textPage("b.md", page("B")).order).toBe(0);
    expect(() => textPage("c.md", "No front matter.")).toThrow("c.md: no title in the front matter");
    expect(() => textPage("d.md", "---\n\n---\nText.")).toThrow("d.md: no title");
  });

  it("gives each page its address below the base", () => {
    expect(pageUrl("index.md", "/ReqSeq")).toBe("/ReqSeq/");
    expect(pageUrl("how-to/install-reqseq.md", "/ReqSeq")).toBe("/ReqSeq/how-to/install-reqseq/");
    expect(pageUrl("reference/commands/index.md", "/")).toBe("/reference/commands/");
  });

  it("lists the pages by section in sidebar order and leaves out an empty section and a landing page without description", () => {
    expect(() => llmsIndex([textPage("other/x.md", page("X"))], "/", "R")).toThrow(
      "other/x.md: in no section of llms.txt",
    );
    const text = llmsIndex([textPage("start/x.md", page("X"))], "/", "ReqSeq 1.0");
    expect(text).toBe(
      "# ReqSeq 1.0\n\nAll pages as Markdown in one file: [llms-full.txt](/llms-full.txt).\n\n## Get started\n\n- [X](/start/x/)\n",
    );
  });

  it("writes the full file without a landing page", () => {
    expect(llmsFull([textPage("concepts/y.md", page("Y"))], "/", "ReqSeq 1.0")).toBe(
      "# ReqSeq 1.0\n\n# Y\n\nPage: /concepts/y/\n\nText.\n",
    );
  });

  it("writes both files into the built site from the content folder", async () => {
    folder = await mkdtemp(join(tmpdir(), "llms-"));
    const content = join(folder, "content");
    const dist = join(folder, "dist");
    await mkdir(join(content, "how-to"), { recursive: true });
    await mkdir(join(content, "reference", "commands"), { recursive: true });
    await mkdir(dist);
    await writeFile(
      join(content, "index.md"),
      page("ReqSeq", "description: Requirements offline.\n", "Welcome."),
    );
    await writeFile(
      join(content, "how-to", "b.md"),
      page(
        "B",
        "description: Does b.\nsidebar:\n  order: 2\n",
        "Text.\n\n![Shot](../images/b.png) ![Web](https://x/y.png) `![c](./c.png)`",
      ),
    );
    await writeFile(join(content, "how-to", "a.md"), page("A", "sidebar:\n  order: 3\n"));
    await writeFile(join(content, "how-to", "c.md"), page("C", "sidebar:\n  order: 2\n"));
    await writeFile(join(content, "reference", "commands", "index.md"), page("Commands", "", "All."));
    await writeFile(join(content, "reference", "commands", "image.png"), "");
    expect(await writeLlmsFiles(content, dist, "/ReqSeq", "ReqSeq 1.0")).toBe(4);
    expect(await readFile(join(dist, LLMS_FILE), "utf8")).toBe(
      [
        "# ReqSeq 1.0",
        "",
        "> Requirements offline.",
        "",
        "All pages as Markdown in one file: [llms-full.txt](/ReqSeq/llms-full.txt).",
        "",
        "## How-to",
        "",
        "- [B](/ReqSeq/how-to/b/): Does b.",
        "- [C](/ReqSeq/how-to/c/)",
        "- [A](/ReqSeq/how-to/a/)",
        "",
        "## Commands",
        "",
        "- [Commands](/ReqSeq/reference/commands/)",
        "",
      ].join("\n"),
    );
    const full = await readFile(join(dist, LLMS_FULL_FILE), "utf8");
    expect(
      full.startsWith(
        "# ReqSeq 1.0\n\n# ReqSeq\n\nPage: /ReqSeq/\n\nWelcome.\n\n# B\n\nPage: /ReqSeq/how-to/b/\n\nText.\n\n![Shot](/ReqSeq/images/b.png) ![Web](https://x/y.png) `![c](/ReqSeq/how-to/c.png)`\n",
      ),
    ).toBe(true);
    expect(full.indexOf("# A\n")).toBeGreaterThan(full.indexOf("# C\n"));
    expect(full.endsWith("# Commands\n\nPage: /ReqSeq/reference/commands/\n\nAll.\n")).toBe(true);
  });
});
