import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { FOLDER_DIALOG_CHANNEL } from "../shared/protocol.js";
import type { EditInput } from "./edit.js";
import { INPUT_WINDOW_MS } from "./edit.js";
import type { FolderDialogElectron } from "./folder-dialog.js";
import { handleFolderDialog } from "./folder-dialog.js";
import { RENDERER_URL } from "./protocols.js";

type Handler = (event: unknown) => unknown;

class FakeContents extends EventEmitter {
  readonly mainFrame: { readonly url: string };

  constructor(url = RENDERER_URL) {
    super();
    this.mainFrame = { url };
  }

  input(input: EditInput): void {
    this.emit("input-event", {}, input);
  }
}

const CLICK: EditInput = { type: "mouseUp", button: "left" };

const setup = (contents = new FakeContents()) => {
  let time = 1000;
  const handlers = new Map<string, Handler>();
  const electron = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
    },
  };
  // The dialog stays open until the test closes it.
  let close: () => void = () => undefined;
  const open = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        close = resolve;
      }),
  );
  handleFolderDialog(electron as unknown as FolderDialogElectron, contents, open, () => time);
  const fromWindow = { sender: contents, senderFrame: contents.mainFrame };
  const ask = (event: unknown = fromWindow): unknown => handlers.get(FOLDER_DIALOG_CHANNEL)?.(event);
  const later = (ms: number): void => {
    time += ms;
  };
  return {
    contents,
    open,
    ask,
    later,
    close: () => {
      close();
    },
    fromWindow,
  };
};

describe("the folder dialog channel", () => {
  it("shows the dialog once right after a click or Enter, and not again while it is open", async () => {
    const { contents, open, ask, later, close } = setup();
    contents.input(CLICK);
    later(INPUT_WINDOW_MS);
    expect(ask()).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    // One dialog for each input, and none while one is open.
    expect(ask()).toBe(false);
    contents.input({ type: "keyDown", key: "Enter" });
    expect(ask()).toBe(false);
    close();
    await vi.waitFor(() => {
      expect(ask()).toBe(true);
    });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("shows nothing without an input of the person, too late after it, or for another sender", () => {
    const { contents, open, ask, later, fromWindow } = setup();
    expect(ask()).toBe(false);
    // Space and a typed letter run no command.
    contents.input({ type: "keyDown", key: " " });
    contents.input({ type: "keyDown", key: "a" });
    expect(ask()).toBe(false);
    contents.input(CLICK);
    later(INPUT_WINDOW_MS + 1);
    expect(ask()).toBe(false);
    // A clock that went back does not count either.
    contents.input(CLICK);
    later(-1);
    expect(ask()).toBe(false);
    contents.input(CLICK);
    expect(ask({ ...fromWindow, senderFrame: null })).toBe(false);
    expect(ask({ ...fromWindow, sender: {} })).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("refuses a window that shows another page", () => {
    const { contents, open, ask } = setup(new FakeContents("https://example.org/"));
    contents.input(CLICK);
    expect(ask()).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
