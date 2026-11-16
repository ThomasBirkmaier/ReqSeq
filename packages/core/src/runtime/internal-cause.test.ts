import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CommandError } from "../catalog.js";
import {
  MAX_CAUSE_MESSAGE,
  internalCause,
  internalError,
  learnWorkspaceRoots,
  workspaceRoots,
} from "./internal-cause.js";
import { Workspace } from "./workspace.js";

/** A Node file system error as `fs` throws it. */
const fsError = (code: string, message: string, fields: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(message), { code, ...fields });

const posix = { roots: ["/ws"], platform: "linux" } as const;
const windows = { roots: ["C:\\Users\\me\\ws"], platform: "win32" } as const;

describe("internalCause: name and code (#1794)", () => {
  it("names the error and its first line", () => {
    expect(internalCause(new RangeError("Invalid array length"))).toEqual({
      name: "RangeError",
      message: "Invalid array length",
    });
  });

  it("keeps a name of one plain word of up to 40 characters, else says Error", () => {
    const named = (name: unknown): string => {
      const error = new Error("x");
      Object.defineProperty(error, "name", { value: name });
      return internalCause(error).name;
    };
    expect(named("A".repeat(40))).toBe("A".repeat(40));
    expect(named("A".repeat(41))).toBe("Error");
    expect(named("Range Error")).toBe("Error");
    expect(named("<script>")).toBe("Error");
    expect(named("1Error")).toBe("Error");
    expect(named(42)).toBe("Error");
  });

  it("gives Node's code when it has the form of one", () => {
    expect(internalCause(fsError("ERR_STRING_TOO_LONG", "Cannot create a string")).code).toBe(
      "ERR_STRING_TOO_LONG",
    );
    for (const code of ["enoent", "E", `E${"X".repeat(40)}`, "ENO ENT"]) {
      expect([code, internalCause(fsError(code, "x"))]).toEqual([code, { name: "Error", message: "x" }]);
    }
    expect(internalCause(Object.assign(new Error("x"), { code: -2 }))).toEqual({
      name: "Error",
      message: "x",
    });
  });

  it("names only the type of a value that is no Error", () => {
    expect(internalCause("/secret text")).toEqual({ name: "string" });
    expect(internalCause(null)).toEqual({ name: "object" });
    expect(internalCause({ message: "/secret" })).toEqual({ name: "object" });
    expect(internalCause(undefined)).toEqual({ name: "undefined" });
  });

  it("never throws: an error whose properties throw gives what it can", () => {
    const error = new Error("hidden");
    for (const key of ["name", "message", "code", "path"]) {
      Object.defineProperty(error, key, {
        get: () => {
          throw new Error("getter");
        },
      });
    }
    expect(internalCause(error)).toEqual({ name: "Error" });
    const proxy = new Proxy(new Error("x"), {
      getPrototypeOf: () => {
        throw new Error("trap");
      },
    });
    expect(internalCause(proxy)).toEqual({ name: "Error" });
  });
});

describe("internalCause: the message", () => {
  it("takes the first line only and leaves out an empty one", () => {
    expect(internalCause(new Error("first\nsecond")).message).toBe("first");
    expect(internalCause(new Error("first\r\nsecond")).message).toBe("first");
    expect(internalCause(new Error("\nsecond"))).toEqual({ name: "Error" });
    expect(internalCause(new Error("  "))).toEqual({ name: "Error" });
    expect(internalCause(Object.assign(new Error(), { message: 7 }))).toEqual({ name: "Error" });
  });

  it("looks for the end of the first line in the first 4 KB only", () => {
    const long = `${"a".repeat(5000)}\nsecond`;
    expect(internalCause(new Error(long)).message).toBe(`${"a".repeat(MAX_CAUSE_MESSAGE - 1)}…`);
  });

  it("cuts after 160 code points with …, never inside a surrogate pair", () => {
    expect(internalCause(new Error("a".repeat(MAX_CAUSE_MESSAGE))).message).toBe(
      "a".repeat(MAX_CAUSE_MESSAGE),
    );
    const cut = internalCause(new Error("😀".repeat(MAX_CAUSE_MESSAGE + 1))).message ?? "";
    expect(Array.from(cut)).toHaveLength(MAX_CAUSE_MESSAGE);
    expect(cut).toBe(`${"😀".repeat(MAX_CAUSE_MESSAGE - 1)}…`);
  });

  it("drops control characters, format characters and lone surrogates", () => {
    expect(internalCause(new Error("a\u0000b\u0007c\u007fd\u0085e\u200bf\u202eg\ud800h\tI")).message).toBe(
      "abcdefghI",
    );
  });

  it("does not let an invisible character hide a path", () => {
    expect(internalCause(new Error("at C\u200b:\\secret\\x"), posix).message).toBe("at <path>");
  });
});

describe("internalCause: paths", () => {
  const said = (message: string, options: Parameters<typeof internalCause>[1] = posix): string | undefined =>
    internalCause(new Error(message), options).message;

  it("shows a path in the workspace as <workspace>/… and any other absolute path as <path>", () => {
    expect(
      said("ENOENT: no such file or directory, open '/ws/requirements/SR-1.md'", {
        roots: ["/ws"],
        platform: "linux",
      }),
    ).toBe("ENOENT: no such file or directory, open '<workspace>/requirements/SR-1.md'");
    expect(said("ENOENT: no such file or directory, open '/home/me/secret.yaml'")).toBe(
      "ENOENT: no such file or directory, open '<path>'",
    );
    expect(said("/ws")).toBe("<workspace>");
  });

  it("shows a path that leaves the root through .. as <path>", () => {
    expect(said("open /ws/../home/x")).toBe("open <path>");
    expect(said("open C:\\Users\\me\\ws\\..\\other", windows)).toBe("open <path>");
    expect(said("open /ws/a..b/x")).toBe("open <workspace>/a..b/x");
  });

  it("hides the error's own path with a quote inside it", () => {
    const tom = "/home/me/Tom's projects/other/secret-plan.yaml";
    const posixError = fsError("ENOENT", `ENOENT: no such file or directory, open '${tom}'`, { path: tom });
    expect(internalCause(posixError, posix).message).toBe("ENOENT: no such file or directory, open '<path>'");
    const brien = "C:\\Users\\O'Brien\\other\\x.yaml";
    const windowsError = fsError("ENOENT", `ENOENT: no such file or directory, open '${brien}'`, {
      path: brien,
    });
    expect(internalCause(windowsError, windows).message).toBe(
      "ENOENT: no such file or directory, open '<path>'",
    );
    const inside = "C:\\Users\\me\\ws\\O'Brien\\x.yaml";
    const insideError = fsError("EPERM", `EPERM: operation not permitted, open '${inside}'`, {
      path: inside,
    });
    expect(internalCause(insideError, windows).message).toBe(
      "EPERM: operation not permitted, open '<workspace>/O'Brien/x.yaml'",
    );
  });

  it("matches a root only on a folder boundary, the longest root first", () => {
    expect(said("read /ws2/x")).toBe("read <path>");
    expect(said("read /ws/a/x", { roots: ["/ws", "/ws/a"], platform: "linux" })).toBe("read <workspace>/x");
    expect(said("read /ws/x", { roots: ["/ws/"], platform: "linux" })).toBe("read <workspace>/x");
  });

  it("takes a root that is the file system root", () => {
    expect(said("read /etc/x", { roots: ["/"], platform: "linux" })).toBe("read <workspace>/etc/x");
    expect(said("read C:\\x", { roots: ["C:\\"], platform: "win32" })).toBe("read <workspace>/x");
    expect(said("read /x", { roots: [""], platform: "linux" })).toBe("read <path>");
  });

  it("replaces the error's own path and dest exactly, blanks included", () => {
    const error = fsError("EXDEV", "EXDEV: cross-device link, rename /ws/a b -> /tmp/c d", {
      path: "/ws/a b",
      dest: "/tmp/c d",
    });
    expect(internalCause(error, posix).message).toBe(
      "EXDEV: cross-device link, rename <workspace>/a b -> <path>",
    );
    const special = fsError("EISDIR", "EISDIR: illegal operation, open /ws/a (1).[b]+", {
      path: "/ws/a (1).[b]+",
    });
    expect(internalCause(special, posix).message).toBe(
      "EISDIR: illegal operation, open <workspace>/a (1).[b]+",
    );
    // An exact path counts only between quotes, blanks or the edges of the line: /ws/a is not in /ws/ab/x.
    const prefix = fsError("ENOENT", "ENOENT: open /ws/a then /ws/ab/secret", { path: "/ws/a" });
    expect(internalCause(prefix, posix).message).toBe(
      "ENOENT: open <workspace>/a then <workspace>/ab/secret",
    );
    const outside = fsError("ENOENT", "ENOENT: open /etc/a then /etc/ab/secret", { path: "/etc/a" });
    expect(internalCause(outside, posix).message).toBe("ENOENT: open <path> then <path>");
    // A relative path of the error is no path to hide, and never replaces text inside a word.
    const relative = fsError("ENOENT", "ENOENT: no such file, open 'a'", { path: "a" });
    expect(internalCause(relative, posix).message).toBe("ENOENT: no such file, open 'a'");
  });

  it("runs a quoted path to its quote and a bare path to the next blank", () => {
    expect(said(`open "/ws/a b/c" now`)).toBe(`open "<workspace>/a b/c" now`);
    expect(said("open `/x y` now")).toBe("open `<path>` now");
    expect(said("open '/x it's' now")).toBe("open '<path>'s' now");
    expect(said("open '/x y now")).toBe("open '<path> y now");
    expect(said("open /x/y, then")).toBe("open <path>, then");
    expect(said("failed (at /x/y)")).toBe("failed (at <path>)");
  });

  it("leaves slashes inside words and relative paths alone", () => {
    expect(said("a/b and/or ./c ../d ~/e x-/f")).toBe("a/b and/or ./c ../d ~/e x-/f");
  });

  it("knows the Windows forms on every platform", () => {
    expect(said("open 'D:\\data\\x'")).toBe("open '<path>'");
    expect(said("open d:/data/x")).toBe("open <path>");
    expect(said("open \\\\server\\share\\x")).toBe("open <path>");
    expect(said("open \\\\?\\C:\\x")).toBe("open <path>");
    expect(said("open \\\\.\\pipe\\x")).toBe("open <path>");
    expect(said("not abc:\\x")).toBe("not abc:\\x");
  });

  it("matches Windows roots in either case and with either separator", () => {
    expect(said("open 'c:/users/ME/ws/r/x.md'", windows)).toBe("open '<workspace>/r/x.md'");
    expect(said("open C:\\Users\\me\\ws\\r\\x.md", windows)).toBe("open <workspace>/r/x.md");
    expect(said("open \\\\?\\C:\\Users\\me\\ws\\x", windows)).toBe("open <workspace>/x");
    expect(said("open \\\\?\\UNC\\srv\\share\\x", { roots: ["\\\\srv\\share"], platform: "win32" })).toBe(
      "open <workspace>/x",
    );
    expect(said("open C:\\Users\\me\\ws2\\x", windows)).toBe("open <path>");
  });

  it("folds case on macOS, not on Linux", () => {
    expect(said("open /WS/x", { roots: ["/ws"], platform: "darwin" })).toBe("open <workspace>/x");
    expect(said("open /WS/x", { roots: ["/ws"], platform: "linux" })).toBe("open <path>");
  });

  it("takes file: URLs as paths and removes credentials from other URLs", () => {
    expect(said("load file:///ws/a%20b.md")).toBe("load <workspace>/a b.md");
    expect(said("load 'file:///C:/Users/me/ws/x'", windows)).toBe("load '<workspace>/x'");
    expect(said("load file://host/share/x")).toBe("load <path>");
    expect(said("load file:///ws/%E0%A4%A")).toBe("load <workspace>/%E0%A4%A");
    expect(said("fetch https://user:token@example.org/r.git failed")).toBe(
      "fetch https://example.org/r.git failed",
    );
    expect(said("fetch https://example.org/r.git")).toBe("fetch https://example.org/r.git");
    expect(said("fetch https://example.org/r?token=abc#x done")).toBe("fetch https://example.org/r done");
  });

  it("uses the platform of the process by default", () => {
    expect(
      internalCause(new Error(`open ${path.join(path.resolve("/ws"), "x")}`), {
        roots: [path.resolve("/ws")],
      }).message,
    ).toBe("open <workspace>/x");
  });
});

describe("internalError and the roots of a workspace", () => {
  it("builds the internal error with the cause and the command", () => {
    const error = internalError("Internal error in x.y", new TypeError("bad /a"), { command: "x.y" });
    expect(error).toBeInstanceOf(CommandError);
    expect(error.toJSON()).toEqual({
      code: "internal",
      message: "Internal error in x.y",
      details: { command: "x.y", cause: { name: "TypeError", message: "bad <path>" } },
    });
    expect(internalError("Internal error in the app", "text").toJSON()).toEqual({
      code: "internal",
      message: "Internal error in the app",
      details: { cause: { name: "string" } },
    });
  });

  it("names the root as given and in its real form", async () => {
    // The root is a link (a junction on Windows) to a folder beside it, so its real form differs everywhere.
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cause-"));
    await fs.mkdir(path.join(base, "target"));
    const given = path.join(base, "link");
    await fs.symlink(path.join(base, "target"), given, "junction");
    const real = await fs.realpath(given);
    const workspace = new Workspace(given);
    try {
      expect(workspaceRoots(workspace)).toEqual([given]);
      await learnWorkspaceRoots(workspace);
      await learnWorkspaceRoots(workspace);
      expect(workspaceRoots(workspace)).toEqual([given, real]);
      for (const root of [given, real]) {
        const error = fsError(
          "ENOENT",
          `ENOENT: no such file or directory, open '${path.join(root, "a", "b.md")}'`,
        );
        expect(internalError("Internal error in x", error, { workspace }).details?.["cause"]).toEqual({
          name: "Error",
          code: "ENOENT",
          message: "ENOENT: no such file or directory, open '<workspace>/a/b.md'",
        });
      }
    } finally {
      await workspace.close();
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("names a root under the temporary folder in its real form (a link on macOS, maybe a short name on Windows)", async () => {
    const given = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cause-"));
    const workspace = new Workspace(given);
    try {
      await learnWorkspaceRoots(workspace);
      const error = new Error(`failed at ${path.join(await fs.realpath(given), "x.md")}`);
      expect(internalError("Internal error in x", error, { workspace }).details?.["cause"]).toEqual({
        name: "Error",
        message: "failed at <workspace>/x.md",
      });
    } finally {
      await workspace.close();
      await fs.rm(given, { recursive: true, force: true });
    }
  });

  it("learns the real form of a root created after the first call (workspace.init)", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cause-"));
    await fs.mkdir(path.join(base, "target"));
    const given = path.join(base, "link");
    const workspace = new Workspace(given);
    try {
      await learnWorkspaceRoots(workspace);
      expect(workspaceRoots(workspace)).toEqual([given]);
      await fs.symlink(path.join(base, "target"), given, "junction");
      await learnWorkspaceRoots(workspace);
      expect(workspaceRoots(workspace)).toEqual([given, await fs.realpath(given)]);
    } finally {
      await workspace.close();
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("does nothing on a closed workspace", async () => {
    const workspace = new Workspace(os.tmpdir());
    await workspace.close();
    await expect(learnWorkspaceRoots(workspace)).resolves.toBeUndefined();
    expect(workspaceRoots(workspace)).toEqual([workspace.root]);
  });
});
