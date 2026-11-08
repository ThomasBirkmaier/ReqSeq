import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocsServer } from "@reqseq/api";
import { DOCS_CHANNEL } from "../shared/protocol.js";
import { RENDERER_URL } from "./protocols.js";
import type { DocsElectron } from "./docs.js";
import { MAX_DOCS_TOPIC, docs, docsFolder, docsPath, handleDocs } from "./docs.js";

let top: string;
let site: string;

beforeEach(async () => {
  top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-app-docs-")));
  site = path.join(top, "site");
  for (const page of ["", "reference/commands/relation-options/", "reference/keyboard-shortcuts/"]) {
    await fs.mkdir(path.join(site, page), { recursive: true });
    await fs.writeFile(path.join(site, page, "index.html"), `<title>${page}</title>`);
  }
});

afterEach(async () => {
  await fs.rm(top, { recursive: true, force: true });
});

const fakeElectron = () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
  const electron = {
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    },
    shell: { openExternal },
  } as unknown as DocsElectron;
  return { electron, handlers, openExternal };
};

/** A docs server that serves nothing, on port 4321; `closed` counts its closes. */
const fakeServer = (): DocsServer & { readonly closed: () => number } => {
  let closes = 0;
  return {
    port: 4321,
    url: "http://127.0.0.1:4321/",
    close: () => {
      closes += 1;
      return Promise.resolve();
    },
    closed: () => closes,
  };
};

describe("docsPath", () => {
  it("names the start page, a command's reference page and an action's row of keys", () => {
    expect(docsPath(undefined)).toEqual({ page: "", anchor: "" });
    expect(docsPath("relation.options")).toEqual({
      page: "reference/commands/relation-options/",
      anchor: "",
    });
    expect(docsPath("element.setStatus")).toEqual({
      page: "reference/commands/element-set-status/",
      anchor: "",
    });
    expect(docsPath("close-all")).toEqual({
      page: "reference/keyboard-shortcuts/",
      anchor: "#action-close-all",
    });
  });

  it("refuses anything that is no command name or action ID, so no path or URL of the renderer is used", () => {
    for (const topic of [
      "",
      null,
      1,
      { name: "element.get" },
      "../etc/passwd",
      "element.get/../../x",
      "%2e%2e",
      "http://example.com",
      "//example.com",
      "a.b.c",
      "Close-All",
      "close-",
      "-close",
      "element.get\0",
      "element.get#x",
      "element.get?x",
      "a\\b",
      "x".repeat(MAX_DOCS_TOPIC + 1),
    ]) {
      expect(docsPath(topic), JSON.stringify(topic)).toBeUndefined();
    }
    expect(docsPath("x".repeat(MAX_DOCS_TOPIC))).toBeDefined();
  });
});

describe("docsFolder", () => {
  const base = { resources: "/opt/ReqSeq/resources", app: "/src/packages/app", cwd: "/home/me" };

  it("is the docs folder of the delivery's CLI in a delivery, whatever the command line says", () => {
    expect(docsFolder({ ...base, packaged: true, argv: ["reqseq", "--docs-folder", "/x"] })).toBe(
      path.join("/opt/ReqSeq/resources", "cli", "docs"),
    );
  });

  it("takes --docs-folder in an unpackaged build, else the docs folder of the CLI package beside the app", () => {
    expect(docsFolder({ ...base, packaged: false, argv: ["electron", ".", "--docs-folder", "site"] })).toBe(
      path.resolve("/home/me", "site"),
    );
    expect(docsFolder({ ...base, packaged: false, argv: ["electron", "--docs-folder=/s"] })).toBe(
      path.resolve("/s"),
    );
    expect(docsFolder({ ...base, packaged: false, argv: ["electron", "--docs-folder="] })).toBe(
      path.join("/src/packages/app", "..", "cli", "docs"),
    );
    expect(docsFolder({ ...base, packaged: false, argv: ["electron", "--docs-folder"] })).toBe(
      path.join("/src/packages/app", "..", "cli", "docs"),
    );
  });
});

describe("docs", () => {
  it("opens the reference page of a command, on 127.0.0.1, starting its server once", async () => {
    const { electron, openExternal } = fakeElectron();
    const server = fakeServer();
    const start = vi.fn(() => Promise.resolve(server));
    const documentation = docs({ folder: site, log: vi.fn(), start });
    expect(await documentation.open(electron, "relation.options")).toEqual({ ok: true });
    expect(openExternal).toHaveBeenLastCalledWith(
      "http://127.0.0.1:4321/reference/commands/relation-options/",
    );
    expect(await documentation.open(electron, undefined)).toEqual({ ok: true });
    expect(openExternal).toHaveBeenLastCalledWith("http://127.0.0.1:4321/");
    expect(await documentation.open(electron, "toggle-dark-mode")).toEqual({ ok: true });
    expect(openExternal).toHaveBeenLastCalledWith(
      "http://127.0.0.1:4321/reference/keyboard-shortcuts/#action-toggle-dark-mode",
    );
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(site);
    await documentation.close();
    expect(server.closed()).toBe(1);
    expect(await documentation.open(electron, undefined)).toEqual({
      ok: false,
      message: "The app is quitting",
    });
  });

  it("opens the start page for a command the site has no page for, and nothing for a refused topic", async () => {
    const { electron, openExternal } = fakeElectron();
    const documentation = docs({ folder: site, log: vi.fn(), start: () => Promise.resolve(fakeServer()) });
    expect(await documentation.open(electron, "element.newCommand")).toEqual({ ok: true });
    expect(openExternal).toHaveBeenLastCalledWith("http://127.0.0.1:4321/");
    expect(await documentation.open(electron, "../x")).toEqual({
      ok: false,
      message: "The documentation has no page for this",
    });
    expect(openExternal).toHaveBeenCalledOnce();
  });

  it("says core's message when the delivery has no site, and tries again on the next request", async () => {
    const { electron, openExternal } = fakeElectron();
    const log = vi.fn();
    const documentation = docs({ folder: path.join(top, "missing"), log });
    const answer = await documentation.open(electron, undefined);
    expect(answer).toEqual({
      ok: false,
      message: `No documentation in ${path.join(top, "missing")}: the folder or its index.html is missing`,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("The documentation could not be opened"));
    // The site is there now (the folder of the first attempt is used again).
    await fs.cp(site, path.join(top, "missing"), { recursive: true });
    expect(await documentation.open(electron, undefined)).toEqual({ ok: true });
    const [url] = openExternal.mock.calls[0] ?? [];
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    // The real docs server of `reqseq serve docs` serves the page the browser gets.
    const page = await fetch(String(url));
    expect(await page.text()).toBe("<title></title>");
    await documentation.close();
    await expect(fetch(String(url))).rejects.toThrow();
  });

  it("stops a server whose site went away after it started, and says a plain message for an odd failure", async () => {
    const { electron } = fakeElectron();
    const server = fakeServer();
    const gone = docs({ folder: path.join(top, "gone"), log: vi.fn(), start: () => Promise.resolve(server) });
    expect(await gone.open(electron, undefined)).toEqual({
      ok: false,
      message: `No documentation in ${path.join(top, "gone")}: the folder or its index.html is missing`,
    });
    expect(server.closed()).toBe(1);
    const odd = docs({ folder: site, log: vi.fn(), start: () => Promise.reject(new Error("x")) });
    expect(await odd.open(electron, undefined)).toEqual({ ok: false, message: "x" });
    const odder = docs({
      folder: site,
      log: vi.fn(),
      // A rejection with no error, as no caller should give.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
      start: () => Promise.reject("no error"),
    });
    expect(await odder.open(electron, undefined)).toEqual({
      ok: false,
      message: "The documentation could not be opened",
    });
    // Closing before any request stops nothing.
    await odder.close();
  });
});

describe("handleDocs", () => {
  it("opens a page only for the main frame of the window on the bundled renderer", async () => {
    const { electron, handlers, openExternal } = fakeElectron();
    const contents = { mainFrame: { url: RENDERER_URL } };
    const documentation = docs({ folder: site, log: vi.fn(), start: () => Promise.resolve(fakeServer()) });
    handleDocs(electron, contents, documentation);
    const handler = handlers.get(DOCS_CHANNEL);
    expect(await handler?.({ sender: {}, senderFrame: contents.mainFrame }, "relation.options")).toEqual({
      ok: false,
      message: "Refused",
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(
      await handler?.({ sender: contents, senderFrame: contents.mainFrame }, "relation.options"),
    ).toEqual({
      ok: true,
    });
    expect(openExternal).toHaveBeenCalledWith("http://127.0.0.1:4321/reference/commands/relation-options/");
  });
});
