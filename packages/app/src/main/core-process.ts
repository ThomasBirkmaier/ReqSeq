// The main process's side of the core process (ADR-0010): starts it for the open workspace, hands each
// window load a port to it, relays `reqseq-file:` requests, starts it again when it stops unexpectedly,
// and stops it before another workspace opens or the app quits. It knows no command.
import type { CoreRequest, FileAnswer, WorkspaceChangeReason, WorkspaceMessage } from "../shared/protocol.js";
import { WORKSPACE_CHANNEL, coreMessage } from "../shared/protocol.js";

/** The part of Electron's MessagePortMain the main process hands on. */
export type TransferablePort = object;

/** The part of Electron's UtilityProcess the main process uses. */
export interface CoreChild {
  postMessage(message: CoreRequest, transfer?: TransferablePort[]): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
  kill(): boolean;
}

/** The part of a window's WebContents the main process sends the workspace to. */
export interface WorkspaceTarget {
  postMessage(channel: string, message: WorkspaceMessage, transfer?: TransferablePort[]): void;
  isDestroyed(): boolean;
}

export interface CoreProcessOptions {
  /** Starts a core process (`utilityProcess.fork` of the core entry). */
  readonly fork: () => CoreChild;
  /** A new pair of connected ports (`new MessageChannelMain()`). */
  readonly channel: () => { readonly port1: TransferablePort; readonly port2: TransferablePort };
  readonly log: (line: string) => void;
}

/** A core process that stops this often within RESTART_WINDOW_MS is not started again. */
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 60_000;
/** How long a core process may take to close its workspace after `stop` before it is killed. */
export const STOP_TIMEOUT_MS = 5_000;

interface Running {
  readonly child: CoreChild;
  readonly folder: string;
  /** The folder is a root of the list of recent workspaces: the core process opens it as it is. */
  readonly exact: boolean;
  /** The key of the open workspace in the list of recent workspaces, from the core process's `ready`. */
  key: string | undefined;
  /** Its root, when it belongs in that list (`ready` with `listed`). */
  listedRoot: string | undefined;
  readonly files: Map<number, (answer: FileAnswer) => void>;
  readonly exited: Promise<void>;
  stopping: boolean;
}

const NOT_FOUND: FileAnswer = { status: 404 };

export class CoreProcess {
  readonly #options: CoreProcessOptions;
  #running: Running | undefined;
  #target: WorkspaceTarget | undefined;
  #nextFile = 1;
  #opening: Promise<void> = Promise.resolve();
  /** Times of the unexpected stops of the current workspace's core process. */
  #stops: number[] = [];

  constructor(options: CoreProcessOptions) {
    this.#options = options;
  }

  /** Whether a core process runs. */
  get running(): boolean {
    return this.#running !== undefined;
  }

  /**
   * The key of the workspace the running core process has open (`workspaceKey` of core, from its `ready`
   * message); undefined while none runs or it has not opened its workspace yet.
   */
  get key(): string | undefined {
    return this.#running?.key;
  }

  /**
   * The root of the open workspace when it belongs in the list of recent workspaces; the core process
   * writes it there in the background, so the stored list can lack it for a while (#423).
   */
  get listedRoot(): string | undefined {
    return this.#running?.listedRoot;
  }

  /**
   * Opens `folder` in a new core process, after the current one stopped; the window is told. Opens run
   * one after the other, so two quick choices never leave a core process behind. With `exact` (a root of
   * the list of recent workspaces) the core process opens the folder itself, never a workspace above it.
   */
  open(folder: string, options: { readonly exact?: boolean } = {}): Promise<void> {
    this.#opening = this.#opening
      .then(async () => {
        await this.stop();
        this.#stops = [];
        this.#start(folder, options.exact === true);
        this.#send("opened");
      })
      .catch((error: unknown) => {
        // The chain goes on, so the next open starts afresh; the window learns what is open now.
        this.#options.log(
          `The workspace could not be opened: ${error instanceof Error ? error.message : String(error)}`,
        );
        try {
          this.#send(this.#running === undefined ? "stopped" : "opened");
        } catch {
          // The window cannot be told (it is gone); the next page load asks again (attach).
        }
      });
    return this.#opening;
  }

  /** A window (re)loaded: it gets a port to the core process, or learns that no workspace is open. */
  attach(target: WorkspaceTarget): void {
    this.#target = target;
    this.#send(undefined);
  }

  /** A file of the workspace for `reqseq-file:`; not found without a core process. */
  file(url: string): Promise<FileAnswer> {
    const running = this.#running;
    if (running === undefined) {
      return Promise.resolve(NOT_FOUND);
    }
    const id = this.#nextFile++;
    return new Promise((resolve) => {
      running.files.set(id, resolve);
      running.child.postMessage({ type: "file", id, url });
    });
  }

  /** Closes the workspace and ends the core process; kills it when it takes longer than STOP_TIMEOUT_MS. */
  async stop(): Promise<void> {
    const running = this.#running;
    if (running === undefined) {
      return;
    }
    this.#running = undefined;
    running.stopping = true;
    running.child.postMessage({ type: "stop" });
    const timer = setTimeout(() => {
      running.child.kill();
    }, STOP_TIMEOUT_MS);
    await running.exited;
    clearTimeout(timer);
  }

  #start(folder: string, exact: boolean): void {
    const child = this.#options.fork();
    const files = new Map<number, (answer: FileAnswer) => void>();
    const exited = new Promise<void>((resolve) => {
      child.once("exit", (code) => {
        for (const answer of files.values()) {
          answer(NOT_FOUND);
        }
        files.clear();
        resolve();
        if (!running.stopping) {
          this.#stopped(running, code);
        }
      });
    });
    const running: Running = {
      child,
      folder,
      exact,
      key: undefined,
      listedRoot: undefined,
      files,
      exited,
      stopping: false,
    };
    this.#running = running;
    child.on("message", (data) => {
      const message = coreMessage(data);
      if (message?.type === "ready") {
        running.key = message.key;
        running.listedRoot = message.listed ? message.root : undefined;
        return;
      }
      if (message?.type !== "file") {
        return;
      }
      const { id, type: _type, ...answer } = message;
      files.get(id)?.(answer);
      files.delete(id);
    });
    child.postMessage({ type: "open", folder, ...(exact ? { exact } : {}) });
  }

  /** The core process stopped by itself: start it again, unless it keeps stopping. */
  #stopped(running: Running, code: number): void {
    this.#running = undefined;
    const now = Date.now();
    this.#stops = [...this.#stops.filter((time) => now - time < RESTART_WINDOW_MS), now];
    if (this.#stops.length > MAX_RESTARTS) {
      this.#options.log(
        `The core process stopped with exit code ${String(code)} again; it is not started again`,
      );
      this.#send("stopped");
      return;
    }
    this.#options.log(`The core process stopped with exit code ${String(code)}; starting it again`);
    this.#start(running.folder, running.exact);
    this.#send("restarted");
  }

  #send(reason: WorkspaceChangeReason | undefined): void {
    const target = this.#target;
    if (target === undefined || target.isDestroyed()) {
      return;
    }
    const because = reason === undefined ? {} : { reason };
    const running = this.#running;
    if (running === undefined) {
      target.postMessage(WORKSPACE_CHANNEL, { open: false, ...because });
      return;
    }
    const { port1, port2 } = this.#options.channel();
    running.child.postMessage({ type: "connect" }, [port1]);
    target.postMessage(WORKSPACE_CHANNEL, { open: true, ...because }, [port2]);
  }
}
