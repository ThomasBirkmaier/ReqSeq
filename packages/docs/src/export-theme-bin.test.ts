import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const exportTheme = vi.fn((_paths: unknown, check: boolean) =>
  Promise.resolve(check ? { ok: false, message: "differs\n" } : { ok: true, message: "wrote\n" }),
);
vi.mock("./export-theme.js", () => ({ exportTheme }));

afterEach(() => {
  vi.resetModules();
  process.exitCode = undefined;
});

describe("export-theme-bin", () => {
  it("writes the theme from the offline site into core", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await import("./export-theme-bin.js");
    expect(exportTheme).toHaveBeenCalledWith(
      {
        site: fileURLToPath(new URL("../site/dist", import.meta.url)),
        starlight: fileURLToPath(new URL("../site/node_modules/@astrojs/starlight", import.meta.url)),
        module: fileURLToPath(new URL("../../core/src/html-export/docs-theme.generated.ts", import.meta.url)),
      },
      false,
    );
    expect(write).toHaveBeenCalledWith("wrote\n");
    expect(process.exitCode).toBe(0);
    write.mockRestore();
  });

  it("fails with --check when the module differs", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const argv = process.argv;
    process.argv = [...argv, "--check"];
    try {
      await import("./export-theme-bin.js");
    } finally {
      process.argv = argv;
    }
    expect(write).toHaveBeenCalledWith("differs\n");
    expect(process.exitCode).toBe(1);
    write.mockRestore();
  });
});
