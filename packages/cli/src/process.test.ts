import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { OutputStream, ProcessLike } from "./process.js";
import { connectProcess } from "./process.js";

class FakeStream extends EventEmitter implements OutputStream {
  readonly written: string[] = [];
  write(text: string, encoding: "utf8"): boolean {
    expect(encoding).toBe("utf8");
    this.written.push(text);
    return true;
  }
}

class FakeProcess extends EventEmitter implements ProcessLike {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  exitCode: number | string | null | undefined = undefined;
  readonly exit = vi.fn<(code: number) => void>();
}

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("connectProcess", () => {
  it("writes UTF-8 text to the process streams", () => {
    const proc = new FakeProcess();
    const io = connectProcess(proc);
    io.stdout.write("out ä");
    io.stderr.write("err ä");
    expect(proc.stdout.written).toEqual(["out ä"]);
    expect(proc.stderr.written).toEqual(["err ä"]);
    expect(io.writeFailed).toBe(false);
  });

  it("drops the rest of the output quietly when the reader closed the pipe", () => {
    const proc = new FakeProcess();
    const io = connectProcess(proc);
    io.stdout.write("first");
    proc.stdout.emit("error", errno("EPIPE"));
    io.stdout.write("second");
    io.stderr.write("still there");
    expect(proc.stdout.written).toEqual(["first"]);
    expect(proc.stderr.written).toEqual(["still there"]);
    expect(io.writeFailed).toBe(false);
    expect(proc.exitCode).toBeUndefined();
  });

  it("makes any other write error exit code 3", () => {
    const proc = new FakeProcess();
    const io = connectProcess(proc);
    proc.stderr.emit("error", errno("EIO"));
    io.stderr.write("lost");
    expect(proc.stderr.written).toEqual([]);
    expect(io.writeFailed).toBe(true);
    expect(proc.exitCode).toBe(3);
  });

  it("aborts on the first SIGINT or SIGTERM and exits 130 on the second", () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const proc = new FakeProcess();
      const io = connectProcess(proc);
      expect(io.signal.aborted).toBe(false);
      proc.emit(signal);
      expect(io.signal.aborted).toBe(true);
      expect(proc.exit).not.toHaveBeenCalled();
      proc.emit("SIGINT");
      expect(proc.exit).toHaveBeenCalledWith(130);
    }
  });
});
