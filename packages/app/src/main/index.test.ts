import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const startShell = vi.fn<(electron: unknown, options: unknown) => Promise<void>>(() => Promise.resolve());
vi.mock("./shell.js", () => ({ startShell }));
vi.mock("electron", () => ({ default: { app: "the electron module" } }));

describe("main process entry", () => {
  it("starts the shell with the built files next to it and logs to standard error", async () => {
    await import("./index.js");
    expect(startShell).toHaveBeenCalledOnce();
    const [electron, options] = startShell.mock.calls[0] as [
      unknown,
      { argv: string[]; cwd: string; paths: Record<string, string>; log: (line: string) => void },
    ];
    expect(electron).toEqual({ app: "the electron module" });
    expect(options.argv).toBe(process.argv);
    expect(options.cwd).toBe(process.cwd());
    const here = import.meta.dirname;
    expect(options.paths).toEqual({
      preload: path.join(here, "..", "preload", "index.cjs"),
      renderer: path.join(here, "..", "renderer"),
      core: path.join(here, "core.js"),
    });
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    options.log("Blocked a request to https://example.com");
    expect(write).toHaveBeenCalledWith("Blocked a request to https://example.com\n");
    write.mockRestore();
  });
});
