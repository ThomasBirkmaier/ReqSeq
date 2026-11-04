import { afterEach, describe, expect, it, vi } from "vitest";

// The ReqIF converter and the Markdown packages only it uses (#178).
const MARKDOWN = [
  "../reqif/xhtml-markdown.js",
  "hast-util-to-mdast",
  "mdast-util-from-markdown",
  "mdast-util-gfm",
  "mdast-util-to-hast",
  "mdast-util-to-markdown",
  "micromark-extension-gfm",
];

afterEach(() => {
  for (const name of MARKDOWN) {
    vi.doUnmock(name);
  }
  vi.resetModules();
});

describe("command list", () => {
  it("does not import the Markdown stack of ReqIF until a ReqIF command runs (#178)", async () => {
    vi.resetModules();
    for (const name of MARKDOWN) {
      vi.doMock(name, () => {
        throw new Error(`${name} was imported`);
      });
    }
    const { commands } = await import("./index.js");
    expect(commands.map((c) => c.name)).toContain("reqif.import");
  });
});
