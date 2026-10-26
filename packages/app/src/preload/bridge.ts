// `window.logreq` (ADR-0010): the only thing the sandboxed renderer can reach. The main process sends
// the window's workspace on WORKSPACE_CHANNEL, with a port to the core process when one is open; every
// call goes over that port. The bridge is generic over the catalog: `invoke(name, input)` for every
// command, the catalog for the command palette, and one event. It never rejects across the context
// bridge, which would keep only an error's message: a failure is the error object of every access.
import type {
  CommandListing,
  InvokeResult,
  LogReqBridge,
  PortRequest,
  WorkspaceChange,
  WorkspaceMessage,
} from "../shared/protocol.js";
import { WORKSPACE_CHANNEL, portMessage } from "../shared/protocol.js";

/** The part of Electron's `ipcRenderer` the bridge uses. */
export interface IpcRendererLike {
  on(
    channel: string,
    listener: (event: { readonly ports: readonly MessagePort[] }, message: WorkspaceMessage) => void,
  ): unknown;
}

const NO_WORKSPACE: InvokeResult = {
  ok: false,
  error: {
    code: "workspace.not-found",
    message: "No workspace is open. Open one with File > Open Workspace.",
  },
};

const STOPPED: InvokeResult = {
  ok: false,
  error: {
    code: "internal",
    message: "The core process stopped before it answered",
    details: { aborted: true },
  },
};

/** A request without its id, which the connection gives it. */
type Unnumbered<T> = T extends unknown ? Omit<T, "id"> : never;

type Pending = (answer: InvokeResult | readonly CommandListing[] | undefined) => void;

/** The port to the core process of the open workspace, and the calls that wait for its answers. */
class Connection {
  readonly #port: MessagePort;
  readonly #pending = new Map<number, Pending>();
  #next = 1;

  constructor(port: MessagePort, onChange: (change: WorkspaceChange) => void) {
    this.#port = port;
    port.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = portMessage(event.data);
      if (message === undefined) {
        return;
      }
      if ("event" in message) {
        onChange(message.change);
        return;
      }
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      pending?.("commands" in message ? message.commands : message.result);
    });
    port.addEventListener("close", () => {
      this.close();
    });
    port.start();
  }

  request(request: Unnumbered<PortRequest>): Promise<InvokeResult | readonly CommandListing[] | undefined> {
    const id = this.#next++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#port.postMessage({ ...request, id });
    });
  }

  /** Ends the calls that wait: their core process is gone. */
  close(): void {
    for (const pending of this.#pending.values()) {
      pending(undefined);
    }
    this.#pending.clear();
    this.#port.close();
  }
}

export const createBridge = (ipc: IpcRendererLike): LogReqBridge => {
  const listeners = new Set<(change: WorkspaceChange) => void>();
  const emit = (change: WorkspaceChange): void => {
    for (const listener of listeners) {
      listener(change);
    }
  };
  let received = false;
  // Calls before the first message of the main process wait for it.
  let current = new Promise<Connection | undefined>((first) => {
    ipc.on(WORKSPACE_CHANNEL, (event, message) => {
      const [port] = event.ports;
      const next = message.open && port !== undefined ? new Connection(port, emit) : undefined;
      if (!received) {
        received = true;
        first(next);
        return;
      }
      void current.then((previous) => previous?.close());
      current = Promise.resolve(next);
      if (message.reason !== undefined) {
        emit({ reason: message.reason });
      }
    });
  });

  return {
    invoke: async (name, input = {}) => {
      const connection = await current;
      if (connection === undefined) {
        return NO_WORKSPACE;
      }
      const answer = await connection.request({ kind: "invoke", name, input });
      return answer === undefined || Array.isArray(answer) ? STOPPED : (answer as InvokeResult);
    },
    commands: async () => {
      const connection = await current;
      const answer = await connection?.request({ kind: "commands" });
      return Array.isArray(answer) ? (answer as readonly CommandListing[]) : [];
    },
    // The renderer is not trusted to keep to the types: any other event has no listeners.
    on: (event: string, listener: (change: WorkspaceChange) => void) => {
      if (event !== "workspace-changed") {
        return () => undefined;
      }
      // Each subscription is its own, even when the same function subscribes twice.
      const own = (change: WorkspaceChange): void => {
        listener(change);
      };
      listeners.add(own);
      return () => {
        listeners.delete(own);
      };
    },
  };
};
