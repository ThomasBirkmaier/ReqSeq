// The core process (ADR-0010): `@logreq/core` in an Electron utility process, plain Node, so a long
// command never blocks a window. The main process sends `open` with the folder the person chose, then
// one `connect` with a port per window load. The workspace opens as `logreq serve api` opens it: the
// root found upwards from the folder (else the folder itself, so `workspace.init` works there), the
// model cache in the cache folder of the copy, the watcher first and then the load (SR-007, SR-082).
// It also watches the accesses that agents make through the API or MCP on the copy (SR-117), and the
// host sends each to the windows.
import type { CommandRuntime, Workspace } from "@logreq/core";
import {
  Workspace as CoreWorkspace,
  cacheFolder,
  findWorkspaceRoot,
  warmWorkspace,
  watchActivity,
  watchWorkspace,
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

/** Serves the main process on `parentPort` until it sends `stop`. */
export const serveCoreProcess = (options: CoreProcessOptions): void => {
  const { parentPort, runtime } = options;
  const openWorkspace = options.openWorkspace ?? cachedWorkspace;
  /** The host of the open workspace; undefined inside when it could not be opened. */
  let host: Promise<CoreHost | undefined> | undefined;

  const open = async (folder: string): Promise<CoreHost> => {
    const root = (await findWorkspaceRoot(folder)) ?? folder;
    const workspace = openWorkspace(root);
    // The workspace loads only once the folders are watched, so a change during the load is seen.
    await watchWorkspace(workspace).ready;
    // A cold load can take up to 30 s at 50,000 elements (SR-082 AK2); the first command waits for it.
    void warmWorkspace(workspace);
    parentPort.postMessage({ type: "ready", root });
    // Why agents cannot be followed (no cache folder outside the repositories, no watch) is a log line.
    return createCoreHost({
      runtime,
      workspace,
      activity: (onAccess) => watchActivity(workspace, { onAccess, log: options.log }),
    });
  };

  parentPort.on("message", ({ data, ports }) => {
    const request = coreRequest(data);
    switch (request?.type) {
      case "open":
        // A workspace that cannot be opened ends the process; the main process starts it again or
        // tells the window that it keeps stopping.
        host ??= open(request.folder).catch((error: unknown) => {
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
        // The process ends either way; a disposal that fails has nobody left to tell.
        void (host ?? Promise.resolve(undefined))
          .then((h) => h?.close())
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
