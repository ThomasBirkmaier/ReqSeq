import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { LocalPathUse } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { Workspace } from "../runtime/workspace.js";
import type { LocalPathOptions } from "./local-paths.js";
import { OPEN_LOCAL_PATHS, assertInsideRepositories, confinedLocalPaths } from "./local-paths.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The fixture with the repositories `system` (the workspace), `product` and `sensor`, and a folder `outside`. */
const fixture = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-004/three-repositories" });
  onTestFinished(() => ws.cleanup());
  await fs.mkdir(ws.path("outside"));
  await fs.writeFile(ws.path("outside/delivery.reqif"), "<x/>");
  return ws;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The error of checking `paths` (one use per path, fields `p0`, `p1`, ...), or undefined when accepted. */
const refusal = async (
  workspace: Workspace,
  paths: readonly string[],
  options?: LocalPathOptions,
): Promise<CommandError | undefined> => {
  const uses: LocalPathUse[] = paths.map((p, i) => ({ field: `p${String(i)}`, path: p }));
  try {
    await confinedLocalPaths(workspace, "test.command", options).check(uses);
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as CommandError;
  }
};

const reasonOf = async (workspace: Workspace, value: string, options?: LocalPathOptions): Promise<unknown> =>
  (await refusal(workspace, [value], options))?.details?.["reason"];

describe("local paths of an API or MCP call (SR-142)", () => {
  it("accepts paths inside the repositories, existing or not, and through .. into another repository", async () => {
    const ws = await fixture();
    const workspace = open(ws.path("system"));
    for (const inside of [
      "requirements/SR-4b4da63a2dd1.md",
      "new/folder/file.xml",
      ".",
      "../product/N-929eca5f9cf4.md",
      "../sensor/anemometer/new.xml",
      ws.path("product/new.xml"),
      "requirements/../metamodel",
    ]) {
      expect(await refusal(workspace, [inside]), inside).toBeUndefined();
    }
  });

  it("refuses a path outside the repositories the same way whether it exists or not", async () => {
    const ws = await fixture();
    const workspace = open(ws.path("system"));
    const existing = await refusal(workspace, [ws.path("outside/delivery.reqif")]);
    const missing = await refusal(workspace, [ws.path("outside/missing/delivery.reqif")]);
    expect(existing?.code).toBe("input.invalid");
    expect(existing?.details).toEqual({
      command: "test.command",
      reason: "outside-repositories",
      fields: ["p0"],
      files: ["delivery.reqif"],
    });
    expect(missing?.details).toEqual(existing?.details);
    expect(missing?.message).toBe(existing?.message);
    expect(existing?.message).toBe(
      "p0 (delivery.reqif): delivery.reqif does not lie inside the repositories of the workspace. Through the API and the MCP server ReqSeq accepts only local paths inside the repositories of the workspace; copy the file into a repository, or use the command line",
    );
    expect(existing?.message).not.toContain(ws.root);
    expect(await reasonOf(workspace, "../outside/delivery.reqif")).toBe("outside-repositories");
    expect(await reasonOf(workspace, "..")).toBe("outside-repositories");
    expect(await reasonOf(workspace, "/")).toBe("outside-repositories");
  });

  it("refuses a link inside a repository that leads out, or that cannot be followed", async () => {
    const ws = await fixture();
    await fs.symlink(ws.path("outside"), ws.path("system/out"), "junction");
    await fs.symlink(ws.path("product"), ws.path("system/product-link"), "junction");
    await fs.symlink(ws.path("outside/new.xml"), ws.path("system/dangling.xml"), "file");
    const workspace = open(ws.path("system"));
    expect(await reasonOf(workspace, "out/delivery.reqif")).toBe("outside-repositories");
    expect(await reasonOf(workspace, "out/missing/new.xml")).toBe("outside-repositories");
    expect(await reasonOf(workspace, ws.path("system/out/delivery.reqif"))).toBe("outside-repositories");
    expect(await reasonOf(workspace, "dangling.xml")).toBe("outside-repositories");
    expect(await reasonOf(workspace, "product-link/N-929eca5f9cf4.md")).toBeUndefined();
  });

  it("accepts paths of a workspace opened through a link, relative and absolute in either form", async () => {
    const ws = await fixture();
    await fs.symlink(ws.root, ws.path("outside/linked"), "junction");
    const workspace = open(ws.path("outside/linked/system"));
    expect(await reasonOf(workspace, "../product/N-929eca5f9cf4.md")).toBeUndefined();
    expect(await reasonOf(workspace, ws.path("outside/linked/system/new.xml"))).toBeUndefined();
    expect(await reasonOf(workspace, ws.path("product/new.xml"))).toBeUndefined();
    expect(await reasonOf(workspace, ws.path("outside/linked/outside/delivery.reqif"))).toBe(
      "outside-repositories",
    );
  });

  it("names every refused path in one error", async () => {
    const ws = await fixture();
    const error = await refusal(open(ws.path("system")), [
      "requirements",
      "~/Downloads/lieferung.reqif",
      "bad\0name",
      ws.path("outside/delivery.reqif"),
    ]);
    expect(error?.details).toEqual({
      command: "test.command",
      reason: "outside-repositories",
      fields: ["p1", "p2", "p3"],
      files: ["lieferung.reqif", "bad?name", "delivery.reqif"],
    });
    expect(error?.message).toContain(
      "p1 (lieferung.reqif): ~ is not expanded; give the path from the workspace root; ",
    );
    expect(error?.message).toContain("p2 (bad?name): bad?name is not a valid local path; ");
  });

  it("refuses `~` as the first name and a NUL byte", async () => {
    const workspace = open((await fixture()).path("system"));
    expect(await reasonOf(workspace, "~")).toBe("outside-repositories");
    expect(await reasonOf(workspace, "~\\x")).toBe("outside-repositories");
    expect(await reasonOf(workspace, "~name/x")).toBeUndefined();
    expect(await reasonOf(workspace, "a\0b")).toBe("invalid-path");
  });

  it("refuses names Windows does not open as written", async () => {
    const workspace = open((await fixture()).path("system"));
    const win32: LocalPathOptions = { platform: "win32" };
    for (const name of ["NUL", "x/con.txt", "x/COM1", "x/file.xml:stream", "x/...", "x/ . "]) {
      expect(await reasonOf(workspace, name, win32), name).toBe("invalid-path");
    }
    expect(await reasonOf(workspace, "x/console.xml", win32)).toBeUndefined();
    expect(await reasonOf(workspace, "x/NUL")).toBeUndefined();
  });

  it("gives path-unreadable when a folder cannot be looked at", async () => {
    const workspace = open((await fixture()).path("system"));
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    const lstat = fs.lstat.bind(fs);
    const spy = vi.spyOn(fs, "lstat").mockImplementation(async (p) => {
      if (String(p).endsWith("requirements")) {
        throw denied;
      }
      return lstat(p);
    });
    expect(await reasonOf(workspace, "requirements")).toBe("path-unreadable");
    spy.mockRestore();
    expect(await refusal(workspace, ["requirements"])).toBeUndefined();
    const realpath = fs.realpath.bind(fs);
    vi.spyOn(fs, "realpath").mockImplementation(async (p) => {
      if (String(p).endsWith("requirements")) {
        throw denied;
      }
      return realpath(p);
    });
    expect(await reasonOf(open(workspace.root), "requirements")).toBe("path-unreadable");
  });

  it("leaves out a repository that is not there, and takes the root alone without a workspace file", async () => {
    const ws = await fixture();
    await fs.rm(ws.path("sensor"), { recursive: true });
    expect(await reasonOf(open(ws.path("system")), "../sensor/new.xml")).toBe("outside-repositories");
    const plain = open(ws.path("outside"));
    expect(await reasonOf(plain, "new/x.xml")).toBeUndefined();
    expect(await reasonOf(plain, "../system/x.xml")).toBe("outside-repositories");
    const missing = open(ws.path("not-there"));
    expect(await reasonOf(missing, "x.xml")).toBeUndefined();
    // A root that ends with a separator: the root of the file system.
    expect(await reasonOf(open(path.parse(ws.root).root), ws.path("outside"))).toBeUndefined();
  });

  it("checks nothing for no paths, and the open rule accepts every path", async () => {
    const workspace = open(path.join((await fixture()).root, "not-there"));
    await expect(assertInsideRepositories(workspace, "test.command", [])).resolves.toBeUndefined();
    await expect(OPEN_LOCAL_PATHS.check([{ field: "file", path: "/etc/passwd" }])).resolves.toBeUndefined();
  });
});
