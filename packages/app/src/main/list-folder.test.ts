// Main's listing of a path typed in "Open workspace" (SR-143): only for the main frame of the window, only
// a bounded string, with core's function in main's slot for typed paths. Not tagged: the AKs describe the
// command prompt, which the Electron specs show (test/path-completion.spec.ts).
import { describe, expect, it, vi } from "vitest";
import type { FolderListing } from "../shared/protocol.js";
import { LIST_FOLDER_CHANNEL, MAX_ROOT_LENGTH } from "../shared/protocol.js";
import type { ListFolderElectron, ListFolderModule, ListFolderOptions } from "./list-folder.js";
import { handleListFolder, loadListFolder } from "./list-folder.js";
import { RENDERER_URL } from "./protocols.js";

type Handler = (event: unknown, text: unknown) => unknown;

const contents = { mainFrame: { url: RENDERER_URL } };
const fromWindow = { sender: contents, senderFrame: contents.mainFrame };
const LISTED: FolderListing = {
  folder: "/home/u",
  name: "pro",
  entries: [{ name: "projects", kind: "folder" }],
};

/** The handler with fakes; `bare`: with this process's home and platform. */
const setup = (options: Partial<ListFolderOptions> = {}, bare = false) => {
  const handlers = new Map<string, Handler>();
  const electron = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
    },
  };
  const run = vi.fn();
  const listTypedFolder = vi.fn(() => Promise.resolve(LISTED));
  const module = { listTypedFolder, typedPathRun: run } as unknown as ListFolderModule;
  const load = vi.fn(() => Promise.resolve(module));
  const log = vi.fn();
  handleListFolder(electron as unknown as ListFolderElectron, contents, {
    load,
    log,
    ...(bare ? {} : { home: () => "/home/u", platform: "linux" as const }),
    ...options,
  });
  const list = (event: unknown, text: unknown): Promise<unknown> =>
    Promise.resolve(handlers.get(LIST_FOLDER_CHANNEL)?.(event, text));
  return { list, listTypedFolder, load, log, run };
};

describe("main's folder listing", () => {
  it("lists the folders of a typed path with core's function, in the slot for typed paths", async () => {
    const { list, listTypedFolder, load, run } = setup();
    expect(await list(fromWindow, "~/pro")).toEqual(LISTED);
    expect(await list(fromWindow, "/x/".padEnd(MAX_ROOT_LENGTH, "y"))).toEqual(LISTED);
    expect(listTypedFolder).toHaveBeenCalledWith("~/pro", {
      files: false,
      home: "/home/u",
      platform: "linux",
      run,
    });
    // Loaded once.
    expect(load).toHaveBeenCalledOnce();
  });

  it("reads nothing for another sender or a text that is no bounded path", async () => {
    const { list, load } = setup();
    const other = { mainFrame: { url: RENDERER_URL } };
    for (const [event, text] of [
      [{ sender: other, senderFrame: other.mainFrame }, "/"],
      [fromWindow, 3],
      [fromWindow, "/a\0b"],
      [fromWindow, "/".repeat(MAX_ROOT_LENGTH + 1)],
    ] as const) {
      expect(await list(event, text)).toEqual({ name: "", entries: [], problem: "invalid" });
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("says not readable when core's module cannot be loaded, and tries again on the next request", async () => {
    const load = vi.fn<() => Promise<ListFolderModule>>().mockRejectedValueOnce(new Error("gone"));
    const { list, log } = setup({ load });
    expect(await list(fromWindow, "/")).toEqual({ name: "", entries: [], problem: "unreadable" });
    expect(log).toHaveBeenCalledWith("The folder could not be listed: gone");
    load.mockRejectedValueOnce("plain");
    expect(await list(fromWindow, "/")).toEqual({ name: "", entries: [], problem: "unreadable" });
    expect(log).toHaveBeenLastCalledWith("The folder could not be listed: plain");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("uses this process's home and platform by default, and loads core's own module", async () => {
    const { list, listTypedFolder } = setup({}, true);
    await list(fromWindow, "/");
    expect(listTypedFolder).toHaveBeenCalledWith(
      "/",
      expect.objectContaining({ platform: process.platform, home: expect.any(String) as string }),
    );
    const core = await loadListFolder();
    expect(typeof core.listTypedFolder).toBe("function");
  });
});
