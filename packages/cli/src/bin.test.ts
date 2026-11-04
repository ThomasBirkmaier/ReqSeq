import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunCliOptions } from "./main.js";

const mocks = vi.hoisted(() => {
  const io = {
    stdout: { write: (): boolean => true },
    stderr: { write: (): boolean => true },
    signal: new AbortController().signal,
    writeFailed: false,
  };
  const order: string[] = [];
  return {
    io,
    order,
    enableCompileCache: vi.fn((folder: string) => {
      order.push(`cache ${folder}`);
      return { status: 1 };
    }),
    runCli: vi.fn<(options: RunCliOptions) => Promise<number>>(() => Promise.resolve(1)),
    connectProcess: vi.fn(() => io),
  };
});
vi.mock("node:module", () => ({ enableCompileCache: mocks.enableCompileCache }));
vi.mock("@reqseq/core/os-cache", () => ({ compileCacheFolder: () => "/cache/reqseq/node-compile-cache" }));
vi.mock("./main.js", () => ({ EXIT: { internal: 3 }, runCli: mocks.runCli }));
vi.mock("./process.js", () => ({ connectProcess: mocks.connectProcess }));

afterEach(() => {
  process.exitCode = undefined;
  mocks.order.length = 0;
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

  it("enables Node's compile cache in the per-user folder before it loads the rest of the CLI (#178)", async () => {
    // Fresh factories, so that they run when bin.js loads the modules.
    vi.doMock("./main.js", () => {
      mocks.order.push("main.js");
      return { EXIT: { internal: 3 }, runCli: mocks.runCli };
    });
    vi.doMock("./process.js", () => {
      mocks.order.push("process.js");
      return { connectProcess: mocks.connectProcess };
    });
    await import("./bin.js");
    expect(mocks.order).toEqual(["cache /cache/reqseq/node-compile-cache", "main.js", "process.js"]);
  });

  it("exits 3 when a write failed", async () => {
    mocks.io.writeFailed = true;
    await import("./bin.js");
    expect(process.exitCode).toBe(3);
  });
});
