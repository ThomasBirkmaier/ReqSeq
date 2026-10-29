// The process side of the binary: output streams that survive a closed pipe, and Ctrl-C (ADR-0009).
import type { TextSink } from "./main.js";
import { EXIT } from "./main.js";

/** The parts of `process.stdout`/`process.stderr` the binary uses. */
export interface OutputStream {
  write(text: string, encoding: "utf8"): unknown;
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  once(event: "drain", listener: () => void): unknown;
}

/** The parts of `process` the binary uses. */
export interface ProcessLike {
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  exitCode?: number | string | null | undefined;
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit(code: number): void;
}

export interface ProcessIo {
  readonly stdout: TextSink;
  readonly stderr: TextSink;
  /** Aborted by the first SIGINT or SIGTERM; the second one ends the process with 130. */
  readonly signal: AbortSignal;
  /** A write failed for another reason than a closed pipe: the run ends with exit code 3. */
  readonly writeFailed: boolean;
}

/**
 * Connect the binary to the process. A closed pipe (`EPIPE`, e.g. `logreq ... | head`) drops the rest of
 * that output quietly and keeps the command's exit code; any other write error makes the exit code 3.
 * A write that the stream buffers beyond its limit returns false, and `drained` waits for the stream's
 * `drain` (back-pressure for a large output, #277); it resolves false once the stream failed.
 */
export function connectProcess(proc: ProcessLike): ProcessIo {
  let writeFailed = false;
  const sink = (stream: OutputStream): TextSink => {
    let open = true;
    /** Waiting `drained` calls: resolved with false when the stream fails. */
    const waiting = new Set<(more: boolean) => void>();
    stream.on("error", (error) => {
      open = false;
      for (const resolve of waiting) {
        resolve(false);
      }
      waiting.clear();
      if (error.code !== "EPIPE") {
        writeFailed = true;
        // Also when the error arrives after the run ended.
        proc.exitCode = EXIT.internal;
      }
    });
    return {
      write: (text) => (open ? stream.write(text, "utf8") : false),
      drained: () =>
        open
          ? new Promise<boolean>((resolve) => {
              waiting.add(resolve);
              stream.once("drain", () => {
                waiting.delete(resolve);
                resolve(open);
              });
            })
          : Promise.resolve(false),
    };
  };
  const controller = new AbortController();
  const onSignal = (): void => {
    if (controller.signal.aborted) {
      proc.exit(EXIT.aborted);
    } else {
      // The command stops at its next check of the signal; the workspace is closed as usual.
      controller.abort();
    }
  };
  proc.on("SIGINT", onSignal);
  proc.on("SIGTERM", onSignal);
  return {
    stdout: sink(proc.stdout),
    stderr: sink(proc.stderr),
    signal: controller.signal,
    get writeFailed() {
      return writeFailed;
    },
  };
}
