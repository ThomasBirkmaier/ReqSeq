// The bundled documentation (SR-141 AK2, AK3): Help > ReqSeq Documentation,
// the action "Open documentation" and F1 on an entry of the command prompt open a page of the documentation site
// of the release in the person's default browser. Main serves the site with the docs server of `reqseq serve docs`
// (`startDocsServer` of `@reqseq/api/docs-server`, 127.0.0.1 only, the bytes of `@reqseq/core/docs-site`), started on the first
// request and stopped when the app quits. The app gets no window and no protocol for it (D-062 unchanged).
//
// The renderer is not trusted: it sends only what it wants help on, a catalog command name or an action ID, never a
// path or a URL. Main checks it (`docsPath`), builds the page path itself and hands `shell.openExternal` only
// `http://127.0.0.1:<port>/<path>`; a page the site does not have opens the start page.
import fs from "node:fs/promises";
import path from "node:path";
import type Electron from "electron";
import type { DocsServer } from "@reqseq/api/docs-server";
import { commandPagePath } from "@reqseq/core/docs-site";
import { DOCS_CHANNEL } from "../shared/protocol.js";
import type { OpenDocsResult } from "../shared/protocol.js";
import type { WindowContents } from "./sender.js";
import { fromReqSeqWindow } from "./sender.js";

/** The parts of the `electron` module the docs handler uses. */
export type DocsElectron = Pick<typeof Electron, "ipcMain" | "shell">;

/** The longest topic the renderer may send. */
export const MAX_DOCS_TOPIC = 200;

/** A catalog command name (`element.get`, `relation.options`). */
const COMMAND_NAME = /^[a-z]+\.[a-zA-Z]+$/;

/** An action ID of the app (`close-all`, `open-documentation`). */
const ACTION_ID = /^[a-z]+(?:-[a-z]+)*$/;

/** The page of the app's keys, which carries an anchor `action-<id>` for every action (`shortcutReference`, `packages/docs`). */
export const SHORTCUTS_PATH = "reference/keyboard-shortcuts/";

/** Where the page of `topic` lies below the site root, with its anchor; the start page is "". */
export interface DocsPath {
  readonly page: string;
  readonly anchor: string;
}

const START: DocsPath = { page: "", anchor: "" };

/**
 * The page of a topic the renderer sent: none (`undefined`) the start page, a catalog command its reference page,
 * an action ID its row on the page of keys. Anything else, also a longer text, is refused (`undefined`).
 */
export const docsPath = (topic: unknown): DocsPath | undefined => {
  if (topic === undefined) {
    return START;
  }
  if (typeof topic !== "string" || topic.length > MAX_DOCS_TOPIC) {
    return undefined;
  }
  if (COMMAND_NAME.test(topic)) {
    return { page: commandPagePath(topic), anchor: "" };
  }
  return ACTION_ID.test(topic) ? { page: SHORTCUTS_PATH, anchor: `#action-${topic}` } : undefined;
};

/**
 * Where the documentation of the app lies: in a release the `docs` folder of its CLI (`resources/cli/docs`, ADR-0014),
 * which `reqseq serve docs` serves too. An unpackaged build takes `--docs-folder <folder>` (a docs build or the fixture
 * site of a test), else `packages/cli/docs` of the checkout; a release ignores the switch.
 */
export const docsFolder = (options: {
  readonly packaged: boolean;
  readonly resources: string;
  /** The folder of the app package (`packages/app` in a checkout). */
  readonly app: string;
  readonly argv: readonly string[];
  readonly cwd: string;
}): string => {
  if (options.packaged) {
    return path.join(options.resources, "cli", "docs");
  }
  const flag = "--docs-folder";
  for (const [index, argument] of options.argv.entries()) {
    const value =
      argument === flag
        ? options.argv[index + 1]
        : argument.startsWith(`${flag}=`)
          ? argument.slice(flag.length + 1)
          : undefined;
    if (value !== undefined && value !== "") {
      return path.resolve(options.cwd, value);
    }
  }
  return path.join(options.app, "..", "cli", "docs");
};

export interface DocsOptions {
  /** The site folder (`docsFolder`). */
  readonly folder: string;
  readonly log: (line: string) => void;
  /** Starts the docs server; default `startDocsServer` of `@reqseq/api`, loaded on the first request. */
  readonly start?: (folder: string) => Promise<DocsServer>;
}

/** The documentation of the app: opens a page in the browser, and stops its server when the app quits. */
export interface Docs {
  open(electron: DocsElectron, topic: unknown): Promise<OpenDocsResult>;
  close(): Promise<void>;
}

const startDocsServer = async (folder: string): Promise<DocsServer> => {
  // Only the docs server and what it needs (`node:*`, core's error class and docs-site rule), not the API's catalog.
  const api = await import("@reqseq/api/docs-server");
  return api.startDocsServer({ folder });
};

/** The message of a failure: core's (`file.folder-missing` when the release has no site), else a plain one. */
const failure = (error: unknown): OpenDocsResult => ({
  ok: false,
  message: error instanceof Error ? error.message : "The documentation could not be opened",
});

/** Whether `file` is a regular file (links followed); never rejects. */
const isFile = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    (stats) => stats.isFile(),
    () => false,
  );

/** The documentation in `options.folder`; its server starts on the first `open`, once, and again after a failure. */
export const docs = (options: DocsOptions): Docs => {
  const start = options.start ?? startDocsServer;
  let running: Promise<DocsServer> | undefined;
  let closed = false;
  const serve = (): Promise<DocsServer> => {
    running ??= start(options.folder);
    // A failed start is tried again on the next request: the site may be there by then.
    running.catch(() => {
      running = undefined;
    });
    return running;
  };
  return {
    open: async (electron, topic) => {
      const wanted = docsPath(topic);
      if (wanted === undefined) {
        return { ok: false, message: "The documentation has no page for this" };
      }
      if (closed) {
        return { ok: false, message: "The app is quitting" };
      }
      try {
        const server = await serve();
        // A page the site lacks (a command added after the documentation was built) opens the start page. The
        // path is main's own (`docsPath`), so a `stat` of its `index.html` is enough; the server serves it.
        const found =
          wanted.page === "" || (await isFile(path.join(options.folder, wanted.page, "index.html")));
        const url = found ? `${server.url}${wanted.page}${wanted.anchor}` : server.url;
        await electron.shell.openExternal(url);
        return { ok: true };
      } catch (error: unknown) {
        options.log(`The documentation could not be opened: ${String(error)}`);
        return failure(error);
      }
    },
    close: async () => {
      closed = true;
      const server = await running?.catch(() => undefined);
      await server?.close();
    },
  };
};

/**
 * Answers DOCS_CHANNEL for the window with these web contents: a topic from its main frame, showing the bundled
 * renderer, opens its page (`Docs.open`); from anywhere else the request is refused and opens nothing.
 */
export const handleDocs = (electron: DocsElectron, contents: WindowContents, documentation: Docs): void => {
  electron.ipcMain.handle(DOCS_CHANNEL, (event, topic: unknown): Promise<OpenDocsResult> => {
    if (!fromReqSeqWindow(event, contents)) {
      return Promise.resolve({ ok: false, message: "Refused" });
    }
    return documentation.open(electron, topic);
  });
};
