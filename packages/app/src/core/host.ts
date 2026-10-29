// The core side of the app's IPC (ADR-0010): it runs in the core process (a utility process), holds the
// one open workspace and answers the windows' requests by calling the command catalog, nothing else
// (ADR-0002). Outputs and error objects go back unchanged, so the app gives what CLI, API and MCP give
// (SR-080 AK2). Transport only: which command runs and with which input is the renderer's choice, and
// every check is core's. Besides the answers it pushes the events (`BridgeEvents`): `workspace-changed`
// after a write of a window (`written`) and for each batch of core's watcher, which reports only changes
// made outside the app (`external`, SR-116, SR-106); and `agent-activity` for an access of an agent
// through the API or MCP (SR-117) that the activity watch reports.
import fs from "node:fs/promises";
import path from "node:path";
import type { AccessName, CatalogEntry, CommandErrorObject, CommandRuntime, Workspace } from "@reqseq/core";
import { CommandError } from "@reqseq/core";
import type {
  AgentActivity,
  ChangeScope,
  ChangedElements,
  CommandListing,
  FileAnswer,
  InvokeResult,
  PortMessage,
} from "../shared/protocol.js";
import { decodedPath, isInside } from "../shared/paths.js";
import { externalChange, portRequest } from "../shared/protocol.js";

/** One window's end of a port, whatever kind of port it is (Electron's MessagePortMain, Node's MessagePort). */
export interface Channel {
  post(message: PortMessage): void;
  onMessage(listener: (data: unknown) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

export interface CoreHost {
  /**
   * Serves the requests of one window until its port closes. A closed port aborts the window's running
   * read commands; a write command runs to its end, so no write is cut off.
   */
  connect(channel: Channel): void;
  /** A file of the workspace for the `reqseq-file:` protocol (`reqseq-file://workspace/<repository>/<path>`). */
  file(url: string): Promise<FileAnswer>;
  /**
   * Aborts the running read commands, waits for the running write commands, then closes every port and
   * the workspace. The main process kills the core process when this takes too long (STOP_TIMEOUT_MS).
   */
  close(): Promise<void>;
}

/** A batch of core's watcher (core's `WorkspaceChange`). */
export interface WatchedChange {
  readonly scope: ChangeScope;
  readonly elements: ChangedElements;
}

export interface CoreHostOptions {
  readonly runtime: CommandRuntime;
  readonly workspace: Workspace;
  /**
   * Starts the watch of the accesses agents make through the API or MCP on this copy (SR-117; the core
   * process passes core's `watchActivity`). The host sends each access to every window as the event
   * `agent-activity` and closes the watch first on `close`. Without it, no window hears of agents.
   */
  readonly activity?: (onAccess: (activity: AgentActivity) => void) => { close(): void };
  /**
   * Subscribes to the batches of core's watcher (the core process passes `watchWorkspace(...).onChange`)
   * and returns the function that unsubscribes. The host sends each to every window as
   * `workspace-changed` with the reason `external` and unsubscribes first on `close`. Without it, no
   * window hears of changes from outside.
   */
  readonly changes?: (listener: (change: WatchedChange) => void) => () => void;
}

/**
 * Images only: the renderer shows files of the workspace as images (CSP `img-src reqseq-file:`), and
 * nothing else may leave the workspace through the protocol.
 */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const NOT_FOUND: FileAnswer = { status: 404 };

/**
 * The host of every `reqseq-file:` URL. The repository is the first name of the path, because Chromium
 * changes hosts such as `1.2` or `0x1f` into IPv4 addresses and refuses `a..b`.
 */
export const FILE_HOST = "workspace";

/**
 * The file `relative` names in `folder`, decided on the names alone, before the file system is asked:
 * no `\`, `:` or NUL (a UNC path or a drive on Windows would open a network share), and inside the
 * folder (a path through `/net` on macOS would mount one). Undefined otherwise.
 */
export const lexicalTarget = (
  folder: string,
  relative: string,
  paths: path.PlatformPath = path,
): string | undefined => {
  if (/[\\:\0]/.test(relative)) {
    return undefined;
  }
  const target = paths.resolve(folder, relative);
  return isInside(folder, target, paths) ? target : undefined;
};

/** The repository and the path below it of a `reqseq-file:` URL, or undefined. */
const fileOf = (url: string): { readonly repository: string; readonly relative: string } | undefined => {
  const parsed = URL.parse(url);
  const decoded =
    parsed?.protocol === "reqseq-file:" && parsed.host === FILE_HOST ? decodedPath(parsed) : undefined;
  const slash = decoded?.indexOf("/") ?? -1;
  return decoded === undefined || slash < 1
    ? undefined
    : { repository: decoded.slice(0, slash), relative: decoded.slice(slash + 1) };
};

/** The error object of a failed call; `invoke` gives a CommandError for every failure. */
const errorObject = (error: unknown): CommandErrorObject =>
  error instanceof CommandError ? error.toJSON() : { code: "internal", message: "Internal error in the app" };

/** The access of every call of the app (ADR-0002 rule 4); core does not record it (SR-117). */
const ACCESS: AccessName = "app";

export const createCoreHost = ({ runtime, workspace, activity, changes }: CoreHostOptions): CoreHost => {
  const entries = new Map<string, CatalogEntry>(runtime.contracts.commands.map((e) => [e.name, e]));
  const channels = new Map<Channel, AbortController>();
  /** The requests being answered, so that close waits for the writes among them. */
  const running = new Set<Promise<void>>();
  let folders: Promise<ReadonlyMap<string, string>> | undefined;

  /** The folders of the available repositories by name, from `workspace.status`; kept until a write. */
  const repositoryFolders = (): Promise<ReadonlyMap<string, string>> => {
    if (folders === undefined) {
      const loading = (async () => {
        const status = (await runtime.invoke("workspace.status", {}, { workspace, access: ACCESS })) as {
          readonly repositories: readonly { name: string; available: boolean; path?: string }[];
        };
        return new Map(
          status.repositories.flatMap((r) =>
            r.available && r.path !== undefined
              ? [[r.name, path.resolve(workspace.root, r.path)] as const]
              : [],
          ),
        );
      })();
      // A failed status (no workspace file) is asked again on the next request.
      loading.catch(() => {
        folders = undefined;
      });
      folders = loading;
    }
    return folders;
  };

  /** Sends `message` to every window; a port that is gone already (and throws) does not stop the others. */
  const broadcast = (message: PortMessage): void => {
    for (const channel of channels.keys()) {
      try {
        channel.post(message);
      } catch {
        // Its close event follows and removes the channel; nobody there waits for the event.
      }
    }
  };

  // Transport only (ADR-0002): which views read again and what is highlighted is the renderer's choice.
  const unsubscribe = changes?.((change) => {
    // The repositories may have moved with the layout (the workspace file, a folder gone).
    if (change.scope !== "elements") {
      folders = undefined;
    }
    broadcast({ event: "workspace-changed", data: externalChange(change) });
  });

  const watch = activity?.((access) => {
    broadcast({ event: "agent-activity", data: access });
  });

  const isWrite = (name: string): boolean => entries.get(name)?.effect === "write-files";

  const invoke = async (name: string, input: unknown, signal: AbortSignal): Promise<InvokeResult> => {
    // A write gets no abort signal: it runs to its end even when its window goes away.
    const context = isWrite(name) ? { workspace, access: ACCESS } : { workspace, access: ACCESS, signal };
    try {
      return { ok: true, output: await runtime.invoke(name, input, context) };
    } catch (error) {
      return { ok: false, error: errorObject(error) };
    }
  };

  const answer = async (channel: Channel, data: unknown, signal: AbortSignal): Promise<void> => {
    const request = portRequest(data);
    if (request === undefined) {
      return;
    }
    if (request.kind === "commands") {
      const commands: CommandListing[] = runtime.contracts.commands.map((entry) => ({
        ...entry,
        implemented: runtime.commands.has(entry.name),
      }));
      channel.post({ id: request.id, commands });
      return;
    }
    const result = await invoke(request.name, request.input, signal);
    // A closed port has nobody to answer; the files a write changed are still news for the other windows.
    if (!signal.aborted) {
      channel.post({ id: request.id, result });
    }
    if (result.ok && isWrite(request.name)) {
      folders = undefined;
      broadcast({ event: "workspace-changed", data: { reason: "written" } });
    }
  };

  return {
    connect: (channel) => {
      const controller = new AbortController();
      channels.set(channel, controller);
      channel.onClose(() => {
        controller.abort();
        channels.delete(channel);
      });
      channel.onMessage((data) => {
        const task = answer(channel, data, controller.signal);
        running.add(task);
        void task.then(() => running.delete(task));
      });
    },

    file: async (url) => {
      const file = fileOf(url);
      const mimeType =
        file === undefined ? undefined : IMAGE_TYPES[path.extname(file.relative).toLowerCase()];
      if (file === undefined || mimeType === undefined) {
        return NOT_FOUND;
      }
      try {
        const folder = (await repositoryFolders()).get(file.repository);
        const lexical = folder === undefined ? undefined : lexicalTarget(folder, file.relative);
        if (folder === undefined || lexical === undefined) {
          return NOT_FOUND;
        }
        // Only now the file system: links inside the folder may still point outside it.
        const [root, target] = await Promise.all([fs.realpath(folder), fs.realpath(lexical)]);
        if (!isInside(root, target) || !(await fs.stat(target)).isFile()) {
          return NOT_FOUND;
        }
        return { status: 200, mimeType, data: new Uint8Array(await fs.readFile(target)) };
      } catch {
        return NOT_FOUND;
      }
    },

    close: async () => {
      watch?.close();
      unsubscribe?.();
      for (const controller of channels.values()) {
        controller.abort();
      }
      await Promise.all(running);
      for (const channel of channels.keys()) {
        channel.close();
      }
      channels.clear();
      await workspace.close();
    },
  };
};
