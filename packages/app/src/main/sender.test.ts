import { describe, expect, it } from "vitest";
import { RENDERER_URL } from "./protocols.js";
import { fromLogReqWindow } from "./sender.js";

const windowAt = (url: string) => ({ mainFrame: { url } });

describe("fromLogReqWindow: who may send to the main process", () => {
  it("accepts the main frame of the LogReq window showing the bundled renderer", () => {
    const contents = windowAt(RENDERER_URL);
    expect(fromLogReqWindow({ sender: contents, senderFrame: contents.mainFrame }, contents)).toBe(true);
  });

  it("refuses another sender, another frame, a frame that is gone, and another page", () => {
    const contents = windowAt(RENDERER_URL);
    const other = windowAt(RENDERER_URL);
    expect(fromLogReqWindow({ sender: other, senderFrame: other.mainFrame }, contents)).toBe(false);
    expect(fromLogReqWindow({ sender: contents, senderFrame: { url: RENDERER_URL } }, contents)).toBe(false);
    expect(fromLogReqWindow({ sender: contents, senderFrame: null }, contents)).toBe(false);
    for (const url of [
      "https://example.org/",
      "logreq-file://logreq/x.png",
      "app://other/index.html",
      "not a url",
    ]) {
      const elsewhere = windowAt(url);
      expect(fromLogReqWindow({ sender: elsewhere, senderFrame: elsewhere.mainFrame }, elsewhere), url).toBe(
        false,
      );
    }
  });
});
