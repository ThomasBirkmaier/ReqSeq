import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunCliOptions } from "./main.js";

const mocks = vi.hoisted(() => {
  const io = {
    stdout: { write: (): boolean => true },
    stderr: { write: (): boolean => true },
    signal: new AbortController().signal,
    writeFailed: false,
  };
  return {
    io,
    runCli: vi.fn<(options: RunCliOptions) => Promise<number>>(() => Promise.resolve(1)),
    connectProcess: vi.fn(() => io),
  };
});
vi.mock("./main.js", () => ({ EXIT: { internal: 3 }, runCli: mocks.runCli }));
vi.mock("./process.js", () => ({ connectProcess: mocks.connectProcess }));

afterEach(() => {
  process.exitCode = undefined;
  vi.resetModules();
});

describe("bin", () => {
  it("runs the command line with the connected process and sets the exit code", async () => {
    await import("./bin.js");
    expect(mocks.connectProcess).toHaveBeenCalledWith(process);
    expect(process.exitCode).toBe(1);
    const [options] = mocks.runCli.mock.calls[0] ?? [];
    expect(options).toEqual({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      stdin: process.stdin,
      stdout: mocks.io.stdout,
      stderr: mocks.io.stderr,
      signal: mocks.io.signal,
    });
  });

  it("exits 3 when a write failed", async () => {
    mocks.io.writeFailed = true;
    await import("./bin.js");
    expect(process.exitCode).toBe(3);
  });
});
