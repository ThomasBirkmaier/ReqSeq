// The heartbeat of an agent connection (SR-228, model/agents.ts): a worker thread of the MCP process
// renews the modification time of its connection file every `everyMs`, so a main thread that is
// blocked for a while (a cold load at 50,000 elements, N-036) does not stop it. A file that is gone
// (a removed cache folder, ADR-0008, or another process that pruned it) is written again. The thread
// runs `agent-beat-worker.ts`, which serves `serveBeat` on its port; nothing else is done there.
import fs from "node:fs/promises";
import { errorCode, writePrivateFile } from "../files/index.js";

/**
 * `workerData.marker` of a beat worker. `serveBeat` serves only a thread started with it, so the
 * module loaded in any other thread never beats.
 */
export const AGENT_BEAT_WORKER = "reqseq-agent-beat";

/** What a beat worker gets as `workerData`. */
export interface BeatData {
  readonly marker: typeof AGENT_BEAT_WORKER;
  /** The connection file (absolute path). */
  readonly file: string;
  /** Its text, to write it again when it is gone. */
  readonly text: string;
  readonly everyMs: number;
}

/** The side of a message port a worker serves on (`parentPort` in a worker thread). */
export interface BeatPort {
  on(event: "message", listener: (message: unknown) => void): unknown;
  postMessage(message: "stopped"): void;
  close(): void;
}

const isBeatData = (data: unknown): data is BeatData =>
  typeof data === "object" && data !== null && (data as { marker?: unknown }).marker === AGENT_BEAT_WORKER;

/**
 * Renews the modification time of `file` to now; writes `text` again when the file is gone. Every
 * other failure is dropped: the next beat tries again. Never rejects.
 */
export const beat = async (file: string, text: string): Promise<void> => {
  try {
    const now = new Date();
    await fs.utimes(file, now, now);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      return;
    }
    try {
      await writePrivateFile(file, text);
    } catch {
      // A cache folder that cannot be written: the next beat tries again.
    }
  }
};

/**
 * Beats every `everyMs` in a thread started with `BeatData`, one beat at a time; on any message it
 * stops, waits for a beat that runs, answers "stopped" and closes `port`, so the thread ends.
 * Anywhere else (no port, or another thread's data) it does nothing.
 */
export const serveBeat = (port: BeatPort | null, data: unknown): void => {
  if (port === null || !isBeatData(data)) {
    return;
  }
  let running: Promise<void> | undefined;
  const timer = setInterval(() => {
    running ??= beat(data.file, data.text).finally(() => {
      running = undefined;
    });
  }, data.everyMs);
  port.on("message", () => {
    clearInterval(timer);
    void (running ?? Promise.resolve()).then(() => {
      port.postMessage("stopped");
      port.close();
    });
  });
};
