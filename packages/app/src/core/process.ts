// The core process (ADR-0010): `@logreq/core` in an Electron utility process, plain Node, so a long
// command never blocks a window. The main process sends `open` with the folder the person chose, then
// one `connect` with a port per window load. The workspace opens as `logreq serve api` opens it: the
// root found upwards from the folder (else the folder itself, so `workspace.init` works there), the
// model cache in the cache folder of the copy, the watcher first and then the load (SR-007, SR-082).
// It also watches the accesses that agents make through the API or MCP on the copy (SR-117), and the
// host sends each to the windows, as it sends each batch of the watcher (SR-116, SR-106). Once
// open, it records the root in the list of recent workspaces (SR-131), which "Open workspace"
// shows; `stop` waits for that write.
import type { CommandRuntime, Workspace } from "@logreq/core";
import {
  Workspace as CoreWorkspace,
  WORKSPACE_FILE,
  cacheFolder,
  findWorkspaceRoot,
  recordOpenedWorkspace,
  warmWorkspace,
  watchActivity,
  watchWorkspace,
  workspaceExists,
  workspaceKey,
} from "@logreq/core";
import type { CoreMessage } from "../shared/protocol.js";
import { coreRequest } from "../shared/protocol.js";
import type { Channel, CoreHost } from "./host.js";
import { createCoreHost } from "./host.js";

/** The part of Electron's MessagePortMain the core process uses. */
export interface MainPort {
  on(event: "message", listener: (event: { readonly data: unknown }) => void): this;
  on(event: "close", listener: () => void): this;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

/** The part of Electron's `process.parentPort` the core process uses. */
export interface ParentPort {
  on(
    event: "message",
    listener: (event: { readonly data: unknown; readonly ports: readonly MainPort[] }) => void,
  ): unknown;
  postMessage(message: CoreMessage): void;
}

export interface CoreProcessOptions {
  readonly parentPort: ParentPort;
  readonly runtime: CommandRuntime;
  /** Ends the process: 0 once the workspace is closed after `stop`, 1 when it could not be opened. */
  readonly exit: (code: number) => void;
  /** Local log lines (standard error). */
  readonly log: (line: string) => void;
  /** Default: the workspace with the model cache in the cache folder of the copy, as the CLI opens it. */
  readonly openWorkspace?: (root: string) => Workspace;
  /** Default: core's `recordOpenedWorkspace` (the list of recent workspaces in the OS cache folder). */
  readonly record?: (workspace: Workspace, key: string) => Promise<unknown>;
}

/** A window's MessagePortMain as a channel of the host. */
export const channelOfPort = (port: MainPort): Channel => ({
  post: (message) => {
    port.postMessage(message);
  },
  onMessage: (listener) => {
    port.on("message", (event) => {
      listener(event.data);
    });
    port.start();
  },
  onClose: (listener) => {
    port.on("close", listener);
  },
  close: () => {
    port.close();
  },
});

const cachedWorkspace = (root: string): Workspace =>
  new CoreWorkspace(root, { cacheFolder: cacheFolder(root) });

const recordWorkspace = (workspace: Workspace, key: string): Promise<unknown> =>
  recordOpenedWorkspace(workspace, { key });

/** The root to open for `folder`: itself for an exact open, which needs its workspace file, else found upwards. */
const rootOf = async (folder: string, exact: boolean): Promise<string | undefined> => {
  if (!exact) {
    return findWorkspaceRoot(folder);
  }
  if (!(await workspaceExists(folder))) {
    throw new Error(`${folder} holds no ${WORKSPACE_FILE}`);
  }
  return folder;
};

/** Serves the main process on `parentPort` until it sends `stop`. */
export const serveCoreProcess = (options: CoreProcessOptions): void => {
  const { parentPort, runtime } = options;
  const openWorkspace = options.openWorkspace ?? cachedWorkspace;
  const record = options.record ?? recordWorkspace;
  /** The host of the open workspace; undefined inside when it could not be opened. */
  let host: Promise<CoreHost | undefined> | undefined;
  /** The record in the list of recent workspaces; `stop` waits for it. */
  let recorded: Promise<unknown> = Promise.resolve();

  const open = async (folder: string, exact: boolean): Promise<CoreHost> => {
    const found = await rootOf(folder, exact);
    const root = found ?? folder;
    const workspace = openWorkspace(root);
    // The workspace loads only once the folders are watched, so a change during the load is seen.
    const watcher = watchWorkspace(workspace);
    await watcher.ready;
    // A cold load can take up to 30 s at 50,000 elements (SR-082 AK2); the first command waits for it.
    void warmWorkspace(workspace);
    const key = workspaceKey(root);
    parentPort.postMessage({ type: "ready", root, key });
    // A folder without a workspace (opened for `workspace.init`) is no recent workspace. The record is a
    // convenience: nothing waits for it but `stop`, and a failure is a log line.
    if (found !== undefined) {
      recorded = record(workspace, key).catch((error: unknown) => {
        options.log(
          `The workspace could not be recorded as opened: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    // Why agents cannot be followed (no cache folder outside the repositories, no watch) is a log line.
    return createCoreHost({
      runtime,
      workspace,
      activity: (onAccess) => watchActivity(workspace, { onAccess, log: options.log }),
      changes: (listener) => watcher.onChange(listener),
    });
  };

  parentPort.on("message", ({ data, ports }) => {
    const request = coreRequest(data);
    switch (request?.type) {
      case "open":
        // A workspace that cannot be opened ends the process; the main process starts it again or
        // tells the window that it keeps stopping.
        host ??= open(request.folder, request.exact === true).catch((error: unknown) => {
          options.log(
            `The core process could not open the workspace: ${error instanceof Error ? error.message : String(error)}`,
          );
          options.exit(1);
          return undefined;
        });
        return;
      case "connect":
        for (const port of ports) {
          void (host ?? Promise.resolve(undefined)).then((h) => {
            if (h === undefined) {
              port.close();
            } else {
              h.connect(channelOfPort(port));
            }
          });
        }
        return;
      case "file":
        void (host ?? Promise.resolve(undefined))
          .then((h) => h?.file(request.url) ?? ({ status: 404 } as const))
          .then((answer) => {
            parentPort.postMessage({ type: "file", id: request.id, ...answer });
          });
        return;
      case "stop":
        // The process ends either way; a disposal that fails has nobody left to tell. The record of the
        // open workspace finishes first.
        void (host ?? Promise.resolve(undefined))
          .then(async (h) => {
            await recorded;
            await h?.close();
          })
          .then(
            () => {
              options.exit(0);
            },
            () => {
              options.exit(0);
            },
          );
        return;
      case undefined:
        return;
    }
  });
};
