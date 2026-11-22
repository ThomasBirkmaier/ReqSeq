// The record of programs and files of a process (SR-248 AK2, ADR-0020 "Test seam"): a test starts `reqseq ui`
// with the preload `packages/testkit/preload/record-access.mjs` (`node --import`), which installs the recorder
// below on `child_process`, `fs`, `fs/promises` and `worker_threads`. Each program started and each file opened
// is written as one JSON line with the step that started or opened it. The product has no switch for it.
//
// The step of a call: the innermost frame of the stack that names a step (`stepOfStack`), where the stack is
// the synchronous stack of the call plus that of every asynchronous resource the call descends from. The
// stacks alone lose the step: work that a memoised promise, a timer or a callback of core starts shows only
// core's own frames (the model load, the search index, `git` of a version date), so the recorder carries the
// step along the asynchronous resources as `AsyncLocalStorage` does. A resource created while a step is known
// keeps it; one created where none is known takes the step of the stack at its creation. A program that the
// server starts by itself, from its own request handler or timer, descends from no step and has none, even
// while a command runs at the same time (#2312, #2329). Worker threads start with no resource of the main
// thread: a call in a worker has the step of the place where its `Worker` was created.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** A step that may start a program or open a workspace file (SR-248 AK2). */
export type AccessStep = "command" | "open" | "watcher";

/**
 * The frames that name a step, in built code of this checkout (`dist/`):
 * - `command`: a catalog command, core's `commands/` and `runtime/invoke.js`, which runs every command;
 * - `open`: opening the workspace, `openChecked` of the UI server (at start and on a switch), and the load the
 *   server starts right after, core's `runtime/warm.js`;
 * - `watcher`: detecting and taking over changed files (SR-007), core's `model/watch*.js`.
 */
export const STEP_FRAMES: readonly { readonly step: AccessStep; readonly frame: RegExp }[] = [
  {
    step: "command",
    frame: /[\\/]packages[\\/]core[\\/]dist[\\/](?:commands[\\/]|runtime[\\/]invoke\.js:)/u,
  },
  { step: "open", frame: /\bopenChecked \(\S*[\\/]packages[\\/]api[\\/]dist[\\/]ui-server\.js:/u },
  { step: "open", frame: /[\\/]packages[\\/]core[\\/]dist[\\/]runtime[\\/]warm\.js:/u },
  { step: "watcher", frame: /[\\/]packages[\\/]core[\\/]dist[\\/]model[\\/]watch(?:-tree|-change)?\.js:/u },
];

/** The step of the innermost frame of `stack` (an `Error#stack`) that names one, or undefined. */
export const stepOfStack = (stack: string): AccessStep | undefined => {
  for (const line of stack.split("\n").slice(1)) {
    const found = STEP_FRAMES.find(({ frame }) => frame.test(line));
    if (found !== undefined) {
      return found.step;
    }
  }
  return undefined;
};

/** One line of the record. `thread` is the thread of the call (0 the main thread); `step` null for none. */
export type AccessRecord =
  | { readonly kind: "process"; readonly thread: number; readonly execPath: string }
  | {
      readonly kind: "program";
      readonly thread: number;
      readonly call: string;
      readonly program: string;
      readonly step: AccessStep | null;
      readonly stack?: string;
    }
  | {
      readonly kind: "file";
      readonly thread: number;
      readonly call: string;
      /** The absolute path, or null when the call names an open file (a descriptor or handle). */
      readonly file: string | null;
      readonly step: AccessStep | null;
      readonly stack?: string;
    }
  | {
      readonly kind: "worker";
      readonly thread: number;
      readonly worker: number;
      readonly step: AccessStep | null;
    };

/** The calls that start a program (`child_process`). */
export const PROGRAM_CALLS = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"];
/** The calls of `fs` that open, read or write a file. */
export const FILE_CALLS = [
  "open",
  "openSync",
  "readFile",
  "readFileSync",
  "createReadStream",
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
];
/** The calls of `fs/promises` that open, read or write a file. */
export const FILE_PROMISE_CALLS = ["open", "readFile", "writeFile", "appendFile"];

type Module = Record<string, unknown>;
type Call = (this: unknown, ...args: unknown[]) => unknown;
type WorkerClass = new (...args: never[]) => { readonly threadId: number };

/** The modules the recorder wraps, and what it needs of `async_hooks`. */
export interface RecorderModules {
  readonly childProcess: Module;
  readonly fs: Module;
  readonly fsPromises: Module;
  readonly workerThreads: { Worker: WorkerClass };
  readonly asyncHooks: {
    readonly createHook: (callbacks: {
      init: (asyncId: number, type: string, triggerAsyncId: number, resource: object) => void;
    }) => { enable(): unknown; disable(): unknown };
    readonly executionAsyncResource: () => object;
  };
}

export interface RecorderOptions {
  /** Writes one line of the record; it must not call a wrapped function. */
  readonly write: (line: string) => void;
  /** The thread the recorder runs in (`worker_threads.threadId`). */
  readonly thread: number;
  /** The Node program of this process (`process.execPath`). */
  readonly execPath: string;
  /** The folder a relative path starts from. */
  readonly cwd: () => string;
  /** The synchronous stack here. Default: `new Error().stack`. */
  readonly stack?: () => string;
}

const STEP = Symbol("reqseq.access-step");

/** The path a file call names: a string, a `file:` URL or a buffer; null for a descriptor or handle. */
const fileOf = (target: unknown, cwd: string): string | null => {
  if (typeof target === "string") {
    return path.resolve(cwd, target);
  }
  if (target instanceof URL) {
    return fileURLToPath(target);
  }
  if (Buffer.isBuffer(target)) {
    return path.resolve(cwd, target.toString("utf8"));
  }
  return null;
};

/**
 * Wraps the calls of `modules` so that each one first writes its record; resolves nothing, changes no
 * argument and no result. Returns the function that puts the original calls back and stops the hook.
 */
export function installAccessRecorder(modules: RecorderModules, options: RecorderOptions): () => void {
  const stack = options.stack ?? ((): string => String(new Error().stack));
  // Set while the recorder itself runs: what it creates (a stack, say) takes no step and writes no record.
  let busy = false;
  const stepHere = (): AccessStep | undefined => {
    const current = modules.asyncHooks.executionAsyncResource() as { [STEP]?: AccessStep };
    if (current[STEP] !== undefined) {
      return current[STEP];
    }
    busy = true;
    try {
      return stepOfStack(stack());
    } finally {
      busy = false;
    }
  };
  const hook = modules.asyncHooks.createHook({
    init(_asyncId, _type, _trigger, resource) {
      if (busy) {
        return;
      }
      const step = stepHere();
      if (step !== undefined) {
        (resource as { [STEP]?: AccessStep })[STEP] = step;
      }
    },
  });
  // `write` may reach a wrapped call itself (`fs.appendFileSync` calls `fs.writeFileSync`): that one is not
  // recorded.
  const write = (record: AccessRecord): void => {
    busy = true;
    try {
      options.write(`${JSON.stringify(record)}\n`);
    } finally {
      busy = false;
    }
  };
  /** The step of the call, with the stack when it has none (to show where it came from). */
  const stepOfCall = (): { step: AccessStep | null; stack?: string } => {
    const step = stepHere();
    return step === undefined ? { step: null, stack: stack() } : { step };
  };
  const restore: (() => void)[] = [];
  const wrap = (
    module: Module,
    names: readonly string[],
    record: (name: string, args: unknown[]) => void,
  ): void => {
    for (const name of names) {
      const original = module[name];
      if (typeof original !== "function") {
        continue;
      }
      const call = original as Call;
      module[name] = function (this: unknown, ...args: unknown[]): unknown {
        if (!busy) {
          record(name, args);
        }
        return call.apply(this, args);
      };
      restore.push(() => {
        module[name] = original;
      });
    }
  };
  const program = (name: string, args: unknown[]): void => {
    write({
      kind: "program",
      thread: options.thread,
      call: name,
      program: name === "fork" ? options.execPath : String(args[0]),
      ...stepOfCall(),
    });
  };
  const file = (name: string, args: unknown[]): void => {
    write({
      kind: "file",
      thread: options.thread,
      call: name,
      file: fileOf(args[0], options.cwd()),
      ...stepOfCall(),
    });
  };
  write({ kind: "process", thread: options.thread, execPath: options.execPath });
  wrap(modules.childProcess, PROGRAM_CALLS, program);
  wrap(modules.fs, FILE_CALLS, file);
  wrap(modules.fsPromises, FILE_PROMISE_CALLS, file);
  const { Worker } = modules.workerThreads;
  modules.workerThreads.Worker = class extends Worker {
    constructor(...args: never[]) {
      super(...args);
      write({ kind: "worker", thread: options.thread, worker: this.threadId, step: stepOfCall().step });
    }
  };
  restore.push(() => {
    modules.workerThreads.Worker = Worker;
  });
  hook.enable();
  return () => {
    hook.disable();
    for (const undo of restore.splice(0)) {
      undo();
    }
  };
}

/** The records of a record file's text, one JSON object per line. */
export const parseAccessRecords = (text: string): AccessRecord[] =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as AccessRecord);

const isBelow = (file: string, folder: string): boolean => {
  const relative = path.relative(folder, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * The records that break SR-248 AK2: a program started, or a file below one of `repositories` opened, by no
 * step. A call in a worker thread without a step of its own has the step of the creation of its worker. A
 * program without a step is allowed only when it is the Node program of the process (the tool's own process,
 * no Git).
 */
export function accessViolations(
  records: readonly AccessRecord[],
  repositories: readonly string[],
): AccessRecord[] {
  const workers = new Map<number, AccessStep | null>();
  const nodes = new Set<string>();
  for (const record of records) {
    if (record.kind === "worker") {
      workers.set(record.worker, record.step);
    } else if (record.kind === "process") {
      nodes.add(record.execPath);
    }
  }
  const stepOf = (record: { readonly thread: number; readonly step: AccessStep | null }): AccessStep | null =>
    record.step ?? (record.thread === 0 ? null : (workers.get(record.thread) ?? null));
  return records.filter((record) => {
    if (record.kind === "program") {
      return stepOf(record) === null && !nodes.has(record.program);
    }
    if (record.kind === "file") {
      const { file } = record;
      return stepOf(record) === null && file !== null && repositories.some((folder) => isBelow(file, folder));
    }
    return false;
  });
}
