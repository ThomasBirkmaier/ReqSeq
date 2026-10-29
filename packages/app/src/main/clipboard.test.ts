import { describe, expect, it, vi } from "vitest";
import { COPY_CHANNEL, MAX_COPY_LENGTH } from "../shared/protocol.js";
import type { ClipboardElectron } from "./clipboard.js";
import { handleCopy } from "./clipboard.js";
import { RENDERER_URL } from "./protocols.js";

type Handler = (event: unknown, text: unknown) => unknown;

const windowAt = (url: string) => ({ mainFrame: { url } });
const contents = windowAt(RENDERER_URL);

const setup = (window = contents) => {
  const handlers = new Map<string, Handler>();
  const electron = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
    },
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  };
  handleCopy(electron as unknown as ClipboardElectron, window);
  const copy = (event: unknown, text: unknown): Promise<unknown> =>
    Promise.resolve(handlers.get(COPY_CHANNEL)?.(event, text));
  return { electron, copy, fromWindow: { sender: window, senderFrame: window.mainFrame } };
};

describe("the copy channel", () => {
  it("[SR-128/AK2] writes the text it gets from the main frame of the window to the clipboard", async () => {
    const { electron, copy, fromWindow } = setup();
    expect(electron.ipcMain.handle).toHaveBeenCalledOnce();
    expect(await copy(fromWindow, "one\ntwo")).toBe(true);
    expect(electron.clipboard.writeText).toHaveBeenCalledExactlyOnceWith("one\ntwo");
    // Also the empty text and the longest one.
    expect(await copy(fromWindow, "")).toBe(true);
    expect(await copy(fromWindow, "x".repeat(MAX_COPY_LENGTH))).toBe(true);
    expect(electron.clipboard.writeText).toHaveBeenCalledTimes(3);
  });

  it("[SR-128/AK2] writes nothing for anything but a string of bounded length", async () => {
    const { electron, copy, fromWindow } = setup();
    for (const text of [
      undefined,
      null,
      3,
      { toString: () => "x" },
      ["x"],
      "x".repeat(MAX_COPY_LENGTH + 1),
    ]) {
      expect(await copy(fromWindow, text)).toBe(false);
    }
    expect(electron.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("[SR-128/AK2] writes nothing for a message of another sender, another frame or a frame that is gone", async () => {
    const { electron, copy, fromWindow } = setup();
    const other = windowAt(RENDERER_URL);
    // another web contents, a subframe of the window, a frame that is gone
    expect(await copy({ sender: other, senderFrame: other.mainFrame }, "x")).toBe(false);
    expect(await copy({ sender: contents, senderFrame: { url: RENDERER_URL } }, "x")).toBe(false);
    expect(await copy({ sender: contents, senderFrame: null }, "x")).toBe(false);
    expect(electron.clipboard.writeText).not.toHaveBeenCalled();
    expect(await copy(fromWindow, "x")).toBe(true);
  });

  it("[SR-128/AK2] writes nothing when the main frame shows another page than the bundled renderer", async () => {
    for (const url of [
      "https://example.org/",
      "reqseq-file://reqseq/x.png",
      "app://other/index.html",
      "not a url",
    ]) {
      const { electron, copy, fromWindow } = setup(windowAt(url));
      expect(await copy(fromWindow, "x"), url).toBe(false);
      expect(electron.clipboard.writeText).not.toHaveBeenCalled();
    }
  });

  it("[SR-128/AK2] answers false when the system clipboard cannot be written", async () => {
    const { electron, copy, fromWindow } = setup();
    electron.clipboard.writeText.mockRejectedValueOnce(new Error("no clipboard"));
    expect(await copy(fromWindow, "x")).toBe(false);
    expect(await copy(fromWindow, "x")).toBe(true);
  });
});
