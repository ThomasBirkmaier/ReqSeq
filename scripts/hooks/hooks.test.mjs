import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { prettierArgs, run as format } from "./format-file.mjs";
import { check as guardGh } from "./guard-gh.mjs";
import { pinnedPnpm, run as sessionStart } from "./session-start.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const remote = { CLAUDE_CODE_REMOTE: "true" };

describe("guard-gh hook", () => {
  const bash = (command, env = remote) => guardGh({ tool_input: { command } }, env);

  it("blocks gh issue and gh pr in a cloud session", () => {
    expect(bash("gh issue view 12").code).toBe(2);
    expect(bash("cd x && gh pr list").message).toMatch(/gh api/);
    expect(bash("echo $(gh issue list)").code).toBe(2);
  });

  it("allows gh api, other commands and every command on a local machine", () => {
    expect(bash("gh api repos/ThomasBirkmaier/ReqSeq/issues/12")).toEqual({ code: 0 });
    expect(bash("echo nogh issue")).toEqual({ code: 0 });
    expect(bash('git commit -m "so gh pr fails" && gh api x -f body="see gh issue view"')).toEqual({
      code: 0,
    });
    expect(bash("gh pr list", {})).toEqual({ code: 0 });
    expect(guardGh({ tool_input: {} }, remote)).toEqual({ code: 0 });
  });

  it("blocks a new issue without a milestone, through gh api and the MCP tool", () => {
    const create = "gh api repos/ThomasBirkmaier/ReqSeq/issues -f title='Save fails' -f body=x";
    expect(bash(create, {}).message).toMatch(/milestone/);
    expect(bash(`${create} -F milestone=3`, {})).toEqual({ code: 0 });
    expect(bash("gh api -X POST repos/ThomasBirkmaier/ReqSeq/issues/12/comments -f body='title=x'")).toEqual({
      code: 0,
    });
    const mcp = (tool_input) => guardGh({ tool_name: "mcp__github__issue_write", tool_input }, {});
    expect(mcp({ method: "create", title: "x" }).code).toBe(2);
    expect(mcp({ method: "create", title: "x", milestone: 3 })).toEqual({ code: 0 });
    expect(mcp({ method: "update", issue_number: 12 })).toEqual({ code: 0 });
  });
});

describe("format-file hook", () => {
  it("formats files inside the checkout only", () => {
    expect(prettierArgs({ cwd: root, tool_input: { file_path: "package.json" } })).toContain(
      path.join(root, "package.json"),
    );
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "format-")), "x.ts");
    fs.writeFileSync(outside, "");
    try {
      expect(prettierArgs({ tool_input: { file_path: outside } })).toBeUndefined();
    } finally {
      fs.rmSync(path.dirname(outside), { recursive: true, force: true });
    }
    expect(prettierArgs({ cwd: root, tool_input: { file_path: "does-not-exist.ts" } })).toBeUndefined();
    expect(prettierArgs({ tool_input: {} })).toBeUndefined();
  });

  it("runs Prettier and ignores its errors", () => {
    const input = { cwd: root, tool_input: { file_path: "package.json" } };
    const exec = vi.fn();
    expect(format(input, exec)).toBe(true);
    expect(exec).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["--write"]),
      expect.anything(),
    );
    expect(
      format(input, () => {
        throw new Error("syntax error");
      }),
    ).toBe(false);
    expect(format({ tool_input: {} }, exec)).toBe(false);
  });
});

describe("session-start hook", () => {
  it("reads the pinned pnpm without its hash", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-start-"));
    try {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@12.14.0+sha512.ab" }),
      );
      expect(pinnedPnpm(dir)).toBe("pnpm@12.14.0");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs pnpm only in the cloud and only when it does not start", () => {
    const exec = vi.fn();
    expect(sessionStart({}, exec)).toBe("local");
    expect(sessionStart(remote, exec)).toBe("ok");
    const failing = vi.fn((cmd) => {
      if (cmd === "pnpm") {
        throw new Error("Cannot find module");
      }
    });
    expect(sessionStart(remote, failing)).toBe("installed");
    expect(failing).toHaveBeenLastCalledWith(
      "npm",
      ["install", "-g", pinnedPnpm(), "--force"],
      expect.anything(),
    );
  });
});
