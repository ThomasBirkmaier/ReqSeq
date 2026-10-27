// `window.logreq` (ADR-0010): the only thing the sandboxed renderer can reach. The main process sends
// the window's workspace on WORKSPACE_CHANNEL, with a port to the core process when one is open; every
// call goes over that port. The bridge is generic over the catalog: `invoke(name, input)` for every
// command, the catalog for the command palette, and `on` for the events of `BridgeEvents`. The one facility of the window is
// `copyText` (SR-128), which asks the main process to write the clipboard. Nothing rejects across the
// context bridge, which would keep only an error's message: a failure is the error object of every access.
import type {
  CommandListing,
  InvokeResult,
  LogReqBridge,
  PortEvent,
  PortRequest,
  WorkspaceMessage,
} from "../shared/protocol.js";
import { COPY_CHANNEL, WORKSPACE_CHANNEL, isBridgeEvent, portMessage } from "../shared/protocol.js";

/** The part of Electron's `ipcRenderer` the bridge uses. */
export interface IpcRendererLike {
  on(
    channel: string,
    listener: (event: { readonly ports: readonly MessagePort[] }, message: WorkspaceMessage) => void,
  ): unknown;
  invoke(channel: string, ...args: readonly unknown[]): Promise<unknown>;
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

  constructor(port: MessagePort, onEvent: (event: PortEvent) => void) {
    this.#port = port;
    port.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = portMessage(event.data);
      if (message === undefined) {
        return;
      }
      if ("event" in message) {
        onEvent(message);
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
  /** The listeners of each event; the data of an event is checked by `portMessage` before it gets here. */
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const emit = ({ event, data }: PortEvent): void => {
    for (const listener of listeners.get(event) ?? []) {
      listener(data);
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
        emit({ event: "workspace-changed", data: { reason: message.reason } });
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
    // The main process answers `true` for a copy; anything else, also a refusal, is a failure.
    copyText: async (text) => {
      try {
        return (await ipc.invoke(COPY_CHANNEL, text)) === true;
      } catch {
        return false;
      }
    },
    // The renderer is not trusted to keep to the types: any other name subscribes nothing.
    on: (event: string, listener: (data: never) => void) => {
      if (!isBridgeEvent(event)) {
        return () => undefined;
      }
      const subscribed = listeners.get(event) ?? new Set();
      listeners.set(event, subscribed);
      // Each subscription is its own, even when the same function subscribes twice. The data is that
      // of `event`, which `portMessage` checked.
      const own = (data: unknown): void => {
        listener(data as never);
      };
      subscribed.add(own);
      return () => {
        subscribed.delete(own);
      };
    },
  };
};
