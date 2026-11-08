import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { EDIT_CHANNEL } from "../shared/protocol.js";
import type { EditElectron, EditInput } from "./edit.js";
import { INPUT_WINDOW_MS, handleEdit, runsCommand } from "./edit.js";
import { RENDERER_URL } from "./protocols.js";

type Handler = (event: unknown, request: unknown) => unknown;

class FakeContents extends EventEmitter {
  readonly mainFrame: { readonly url: string };
  readonly paste = vi.fn();

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
  handleEdit(electron as unknown as EditElectron, contents, () => time);
  const fromWindow = { sender: contents, senderFrame: contents.mainFrame };
  const edit = (request: unknown, event: unknown = fromWindow): unknown =>
    handlers.get(EDIT_CHANNEL)?.(event, request);
  const later = (ms: number): void => {
    time += ms;
  };
  return { electron, contents, edit, later, fromWindow };
};

describe("the edit channel", () => {
  it("[SR-195/AK3] pastes once right after a click on an entry, as the Edit menu's Paste does", () => {
    const { electron, contents, edit, later } = setup();
    expect(electron.ipcMain.handle).toHaveBeenCalledOnce();
    contents.input(CLICK);
    later(INPUT_WINDOW_MS);
    expect(edit("paste")).toBe(true);
    expect(contents.paste).toHaveBeenCalledOnce();
    // One paste for each input: a second message without a new input pastes nothing.
    expect(edit("paste")).toBe(false);
    expect(contents.paste).toHaveBeenCalledOnce();
    // Moves between the click and the message do not count, and do not take the click away.
    contents.input(CLICK);
    contents.input({ type: "mouseMove" });
    expect(edit("paste")).toBe(true);
    expect(contents.paste).toHaveBeenCalledTimes(2);
  });

  it("[SR-195/AK3] pastes after Enter or Space, the keys that run a command", () => {
    for (const input of [
      { type: "rawKeyDown", key: "Enter" },
      { type: "keyDown", keyCode: "Return" },
      { type: "rawKeyDown", key: " " },
      { type: "keyDown", keyCode: "Space" },
    ]) {
      const { contents, edit } = setup();
      contents.input(input);
      expect(edit("paste"), JSON.stringify(input)).toBe(true);
    }
  });

  it("[SR-195/AK3] pastes nothing without such an input, or once it is more than a second old", () => {
    const { contents, edit, later } = setup();
    expect(edit("paste")).toBe(false);
    for (const input of [
      { type: "mouseUp", button: "right" },
      { type: "mouseDown", button: "left" },
      { type: "mouseMove" },
      { type: "keyUp", key: "Enter" },
      { type: "char", key: "Enter" },
      { type: "rawKeyDown", key: "v" },
      { type: "rawKeyDown" },
    ]) {
      contents.input(input);
      expect(edit("paste"), JSON.stringify(input)).toBe(false);
    }
    contents.input(CLICK);
    later(INPUT_WINDOW_MS + 1);
    expect(edit("paste")).toBe(false);
    // A clock that went back counts as too old.
    contents.input(CLICK);
    later(-1);
    expect(edit("paste")).toBe(false);
    expect(contents.paste).not.toHaveBeenCalled();
  });

  it("[SR-195/AK3] pastes nothing for another request, another sender, another frame or another page", () => {
    const { contents, edit } = setup();
    const other = new FakeContents();
    for (const request of [undefined, "cut", "copy", "PASTE", ["paste"], { paste: true }]) {
      contents.input(CLICK);
      expect(edit(request), JSON.stringify(request)).toBe(false);
    }
    for (const event of [
      { sender: other, senderFrame: other.mainFrame },
      { sender: contents, senderFrame: { url: RENDERER_URL } },
      { sender: contents, senderFrame: null },
    ]) {
      contents.input(CLICK);
      expect(edit("paste", event)).toBe(false);
    }
    expect(contents.paste).not.toHaveBeenCalled();
    for (const url of ["https://example.org/", "app://other/index.html"]) {
      const elsewhere = setup(new FakeContents(url));
      elsewhere.contents.input(CLICK);
      expect(elsewhere.edit("paste"), url).toBe(false);
      expect(elsewhere.contents.paste).not.toHaveBeenCalled();
    }
  });

  it("knows the inputs that run a command", () => {
    expect(runsCommand(CLICK)).toBe(true);
    expect(runsCommand({ type: "mouseUp" })).toBe(false);
    expect(runsCommand({ type: "keyDown", key: "Escape", keyCode: "Escape" })).toBe(false);
  });
});
