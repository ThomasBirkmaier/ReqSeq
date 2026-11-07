// A typed local path checked by its text alone (`path-text.ts`, SR-143, SR-078): no file-system call.
import { describe, expect, it } from "vitest";
import { MAX_PATH_LENGTH, isPathText, localFolder, unsafeOnWindows } from "./path-text.js";

const linux = { platform: "linux" } as const;
const windows = { platform: "win32" } as const;

describe("a typed folder by its text", () => {
  it("resolves a relative path from the base and keeps ~ an ordinary name without a home", () => {
    expect(localFolder("", { ...linux, base: "/ws" })).toBe("/ws");
    expect(localFolder("out/", { ...linux, base: "/ws" })).toBe("/ws/out");
    expect(localFolder("../x/./y", { ...linux, base: "/ws/a" })).toBe("/ws/x/y");
    expect(localFolder("~/", { ...linux, base: "/ws" })).toBe("/ws/~");
    expect(localFolder("/etc/", { ...linux, base: "/ws" })).toBe("/etc");
    expect(localFolder("~/", { ...linux, home: "/home/ada" })).toBe("/home/ada");
    expect(localFolder("~", { ...linux, home: "/home/ada" })).toBe("/home/ada");
    expect(localFolder("out/", linux)).toBeUndefined();
    expect(localFolder("~/", linux)).toBeUndefined();
    expect(localFolder("a\0b/", { ...linux, base: "/ws" })).toBeUndefined();
    expect(localFolder("x".repeat(MAX_PATH_LENGTH + 1), { ...linux, base: "/" })).toBeUndefined();
    expect(localFolder("x".repeat(MAX_PATH_LENGTH - 1), { ...linux, base: "/ws" })).toBeUndefined();
    // `\` is a name character on POSIX, and device names mean nothing there.
    expect(localFolder("a\\b/CON/", { ...linux, base: "/ws" })).toBe("/ws/a\\b/CON");
  });

  it("on Windows refuses UNC, device, NT and current-drive paths, device names and streams", () => {
    expect(localFolder("C:\\Work\\", windows)).toBe("C:\\Work");
    expect(localFolder("C:/Work/", windows)).toBe("C:\\Work");
    expect(localFolder("~\\", { ...windows, home: "C:\\Users\\ada" })).toBe("C:\\Users\\ada");
    expect(localFolder("out\\", { ...windows, base: "C:\\ws" })).toBe("C:\\ws\\out");
    // The workspace already lies on a share: a relative path stays on it.
    expect(localFolder("out\\", { ...windows, base: "\\\\host\\share\\ws" })).toBe(
      "\\\\host\\share\\ws\\out",
    );
    for (const text of [
      "\\\\host\\share\\",
      "//host/share/",
      "\\\\?\\C:\\x\\",
      "\\\\.\\pipe\\",
      "\\??\\C:\\x\\",
      "/??/C:/x/",
      "\\foo\\",
      "/foo/",
      "C:foo\\",
      "C:\\CON\\",
      "C:\\nul.txt\\",
      "C:\\a:b\\",
      "C:\\com1\\x\\",
    ]) {
      expect(localFolder(text, { ...windows, base: "C:\\ws", home: "C:\\Users\\ada" }), text).toBeUndefined();
    }
    expect(localFolder("CON\\", { ...windows, base: "C:\\ws" })).toBeUndefined();
  });

  it("names the texts it takes and the Windows names it refuses", () => {
    expect([isPathText("a"), isPathText(1), isPathText("a\0")]).toEqual([true, false, false]);
    expect(["con", "Aux.txt", "lpt²", "a:b", "...", "a.", "console"].map(unsafeOnWindows)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
