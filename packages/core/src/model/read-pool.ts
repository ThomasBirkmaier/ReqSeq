// The worker threads of a cold load (ADR-0008, N-036): each worker reads, parses and classifies
// chunks of files with blocking calls (`contributionSync`) and sends back what they contribute as
// plain data; the main thread only collects. A worker runs `read-worker.ts`, which serves
// `serveReads` on its port. Results equal those of `contribution` on the main thread.
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Contribution, RepositoryPlace } from "./contribution.js";
import { contributionSync } from "./contribution.js";

/** Files a worker reads per message: few messages, and work stays spread when one chunk is slow. */
export const READ_CHUNK = 250;

/**
 * `workerData` of a read worker. `serveReads` serves only a thread started with it, so the module
 * loaded in any other thread (a test runner's worker, say) never answers on a port not its own.
 */
export const READ_WORKER = "logreq-read-worker";

/** One message to a worker: files of a repository, tagged so that the answer finds its call. */
export interface ReadJob {
  readonly id: number;
  readonly repository: RepositoryPlace;
  readonly files: readonly string[];
}

/** The answer to job `id`: what each file contributes, in the order of the job. */
export interface ReadAnswer {
  readonly id: number;
  readonly contributions: readonly (readonly [string, Contribution])[];
}

/** The side of a message port a worker serves on (`parentPort` in a worker thread). */
export interface ReadPort {
  on(event: "message", listener: (job: ReadJob) => void): unknown;
  postMessage(answer: ReadAnswer): void;
}

/**
 * Answers each job on `port` with the contributions of its files, in a thread started by
 * `openReadPool` (`workerData` is `READ_WORKER`). Anywhere else (no port, or another thread's
 * data) it does nothing.
 */
export const serveReads = (port: ReadPort | null, workerData: unknown): void => {
  if (port === null || workerData !== READ_WORKER) {
    return;
  }
  port.on("message", ({ id, repository, files }) => {
    port.postMessage({
      id,
      contributions: files.map((file) => [file, contributionSync(repository, file)] as const),
    });
  });
};

/** Worker threads of a read: one per core minus one, at least one (ADR-0008). */
export const readWorkers = (cores: number = availableParallelism()): number => Math.max(1, cores - 1);

/** Files of one repository to read. */
export interface ReadRequest {
  readonly repository: RepositoryPlace;
  readonly files: readonly string[];
}

/** The worker threads of one load; `close` when done. */
export interface ReadPool {
  /** The number of worker threads. */
  readonly size: number;
  /**
   * What each file of each request contributes, with its request, in the order of `requests`
   * (the answers of a request in the order they came). All files go into one queue that every
   * worker takes chunks from. With `signal` aborted no further chunk is sent and the call rejects
   * with its reason. A worker that fails or stops rejects the call and every later one. Calls may
   * overlap; each answer finds its call by the id of its job.
   */
  read<R extends ReadRequest>(
    requests: readonly R[],
    signal?: AbortSignal,
  ): Promise<(readonly [R, ReadonlyMap<string, Contribution>])[]>;
  /** Stops every worker at once (`terminate`), work still running included. */
  close(): Promise<void>;
}

const READ_WORKER_ENTRY = new URL("./read-worker.js", import.meta.url);

interface Pending {
  readonly resolve: (answer: ReadAnswer) => void;
  readonly reject: (error: Error) => void;
}

interface Slot {
  readonly worker: Worker;
  /** Calls waiting for their answer, by job id. */
  readonly pending: Map<number, Pending>;
  /** Why the worker cannot answer any more. */
  failure: Error | undefined;
}

const stopped = (code: number): Error => new Error(`A read worker stopped with exit code ${String(code)}`);

const fail = (slot: Slot, error: Error): void => {
  slot.failure ??= error;
  for (const { reject } of slot.pending.values()) {
    reject(slot.failure);
  }
  slot.pending.clear();
};

const spawn = (entry: URL): Slot => {
  const worker = new Worker(entry, { workerData: READ_WORKER });
  const slot: Slot = { worker, pending: new Map(), failure: undefined };
  worker.on("message", (answer: ReadAnswer) => {
    slot.pending.get(answer.id)?.resolve(answer);
    slot.pending.delete(answer.id);
  });
  worker.on("error", (error) => {
    fail(slot, error);
  });
  worker.on("exit", (code) => {
    fail(slot, stopped(code));
  });
  return slot;
};

/** Sends one job to a worker and waits for its answer. */
const call = (slot: Slot, job: ReadJob): Promise<ReadAnswer> => {
  if (slot.failure !== undefined) {
    return Promise.reject(slot.failure);
  }
  return new Promise((resolve, reject) => {
    slot.pending.set(job.id, { resolve, reject });
    slot.worker.postMessage(job);
  });
};

/**
 * A structured clone drops `Object.freeze`; snapshots are frozen as `makeSnapshot` makes them. A
 * clone keeps shared objects shared, so the element's snapshot is this one too.
 */
const revive = (contribution: Contribution): Contribution => {
  if (contribution.snapshot !== undefined) {
    Object.freeze(contribution.snapshot);
  }
  return contribution;
};

/** Starts `size` worker threads (at least one) running `entry` (default: `read-worker.js`). */
export const openReadPool = (size: number, entry: URL = READ_WORKER_ENTRY): ReadPool => {
  const slots = Array.from({ length: Math.max(1, size) }, () => spawn(entry));
  let jobs = 0;
  return {
    size: slots.length,
    read: async (requests, signal) => {
      const results: (readonly [(typeof requests)[number], Map<string, Contribution>])[] = [];
      const chunks: {
        readonly repository: RepositoryPlace;
        readonly files: readonly string[];
        readonly into: Map<string, Contribution>;
      }[] = [];
      for (const request of requests) {
        const { repository, files } = request;
        const into = new Map<string, Contribution>();
        results.push([request, into]);
        const place: RepositoryPlace = { name: repository.name, folder: repository.folder };
        for (let start = 0; start < files.length; start += READ_CHUNK) {
          chunks.push({ repository: place, files: files.slice(start, start + READ_CHUNK), into });
        }
      }
      // One shared iterator: each worker takes the next chunk until none are left.
      const queue = chunks.values();
      await Promise.all(
        slots.map(async (slot) => {
          for (const { repository, files, into } of queue) {
            signal?.throwIfAborted();
            jobs += 1;
            const answer = await call(slot, { id: jobs, repository, files });
            for (const [file, contribution] of answer.contributions) {
              into.set(file, revive(contribution));
            }
          }
        }),
      );
      return results;
    },
    close: async () => {
      await Promise.all(slots.map((slot) => slot.worker.terminate()));
    },
  };
};
