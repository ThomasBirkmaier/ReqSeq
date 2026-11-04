import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../reqif/xhtml-markdown.js");
  vi.resetModules();
});

describe("command list", () => {
  it("does not import the ReqIF Markdown converter until a ReqIF command runs (#178)", async () => {
    vi.resetModules();
    vi.doMock("../reqif/xhtml-markdown.js", () => {
      throw new Error("reqif/xhtml-markdown.js was imported");
    });
    const { commands } = await import("./index.js");
    expect(commands.map((c) => c.name)).toContain("reqif.import");
  });
});
