import { describe, expect, it, vi } from "vitest";

const serveCoreProcess = vi.fn();
vi.mock("./process.js", () => ({ serveCoreProcess }));

describe("core process entry", () => {
  it("serves the parent port with the shared runtime and exits after stop", async () => {
    const parentPort = { on: vi.fn(), postMessage: vi.fn() };
    Object.defineProperty(process, "parentPort", { value: parentPort, configurable: true });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    try {
      await import("./main.js");
      expect(serveCoreProcess).toHaveBeenCalledOnce();
      const [options] = serveCoreProcess.mock.calls[0] as [
        {
          parentPort: unknown;
          runtime: { contracts: unknown };
          exit: (code: number) => void;
          log: (line: string) => void;
        },
      ];
      expect(options.parentPort).toBe(parentPort);
      expect(options.runtime.contracts).toBeDefined();
      options.exit(1);
      expect(exit).toHaveBeenCalledWith(1);
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      options.log("The core process could not open the workspace: x");
      expect(write).toHaveBeenCalledWith("The core process could not open the workspace: x\n");
      write.mockRestore();
    } finally {
      exit.mockRestore();
      Reflect.deleteProperty(process, "parentPort");
    }
  });
});
