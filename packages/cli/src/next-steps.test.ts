// The next steps on the command line (SR-226): after `workspace init`, for a folder without a workspace, and
// the section "Get started" of `reqseq` itself, with the runtime of the process.
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT, runCli } from "./main.js";
import { quoted } from "./present/next.js";

class Sink {
  text = "";
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((ws) => ws.cleanup()));
});

const folder = async (files: Record<string, string> = { ".keep": "" }): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ files });
  fixtures.push(ws);
  return ws;
};

const run = async (
  argv: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const stdout = new Sink();
  const stderr = new Sink();
  const code = await runCli({ argv, cwd, stdin: Readable.from([]), stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
};

/** A path as the calls show it on this system. */
const shown = (value: string): string => quoted(value, process.platform);

const NEXT = [
  "next:",
  "  reqseq workspace connect-agent --client <client>  Connect AI agent",
  "  reqseq element create <type> <title>              Create element",
];

describe("next steps on the command line (SR-226)", () => {
  it("[SR-226/AK-mjh8] names workspace init with the folder for a folder without a workspace", async () => {
    const ws = await folder();
    const empty = ws.path("empty");
    await fs.mkdir(empty);
    const result = await run(["element", "list", "--workspace", empty], ws.root);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toBe(
      [
        "error workspace.not-found: No reqseq-workspace.yaml in the workspace folder",
        "next:",
        "  reqseq workspace init empty <name>  Create workspace",
        "",
      ].join("\n"),
    );
    // Outside the current folder, the path is absolute; in the current folder, `.`.
    const outside = await run(["element", "list", "--workspace", empty], (await folder()).root);
    expect(outside.stderr).toContain(`  reqseq workspace init ${shown(empty)} <name>  Create workspace\n`);
    const here = await run(["element", "list"], empty);
    expect(here.stderr).toContain("  reqseq workspace init . <name>  Create workspace\n");
  });

  it("[SR-226/AK-sz63] names connecting an agent and creating an element after workspace init, with --workspace when it lies elsewhere", async () => {
    const ws = await folder();
    const here = await run(["workspace", "init", ".", "W"], ws.root);
    expect(here.code).toBe(EXIT.ok);
    expect(here.stdout).toContain(`No problems.\n${NEXT.join("\n")}\n`);
    // In a subfolder of the workspace of the current folder: without --workspace the call would hit the outer one.
    const sub = await run(["workspace", "init", "sub dir", "Inner"], ws.root);
    expect(sub.stdout).toContain(
      [
        "next:",
        `  reqseq workspace connect-agent --client <client> --workspace ${shown("sub dir")}  Connect AI agent`,
        `  reqseq element create <type> <title> --workspace ${shown("sub dir")}              Create element`,
      ].join("\n"),
    );
    // Above the current folder, the workspace is named by its absolute path.
    const other = await folder();
    const away = await run(["workspace", "init", other.path("x"), "Away"], ws.root);
    expect(away.stdout).toContain(`--workspace ${shown(other.path("x"))}`);
    // The new workspace as the workspace of the call, from another folder: the calls still name it.
    const named = other.path("y");
    const given = await run(["workspace", "init", named, "Named", "--workspace", named], ws.root);
    expect(given.stdout).toContain(`reqseq element create <type> <title> --workspace ${shown(named)}`);
  });

  it("[SR-226/AK-whxq] gives the same steps with --json as core gives every access", async () => {
    const ws = await folder();
    const init = await run(["workspace", "init", "sub", "W", "--json"], ws.root);
    const at = path.join(ws.root, "sub");
    expect((JSON.parse(init.stdout) as { next: unknown }).next).toEqual([
      { command: "workspace.connectAgent", input: {}, open: ["client"], workspace: at },
      { command: "element.create", input: {}, open: ["type", "title"], workspace: at },
    ]);
    const empty = await folder();
    const missing = await run(["element", "list", "--json"], empty.root);
    expect(JSON.parse(missing.stderr)).toMatchObject({
      code: "workspace.not-found",
      details: { next: [{ command: "workspace.init", input: { path: empty.root }, open: ["name"] }] },
    });
  });

  it("shows Get started before the command groups of reqseq alone and of reqseq --help only", async () => {
    const ws = await folder();
    const section = [
      "Get started:",
      "  reqseq workspace init <path> <name>               Create workspace",
      "  reqseq workspace connect-agent --client <client>  Connect AI agent",
      "  reqseq element create <type> <title>              Create element",
      "",
      "Commands:",
    ].join("\n");
    const help = await run(["--help"], ws.root);
    expect([help.code, help.stderr]).toEqual([EXIT.ok, ""]);
    expect(help.stdout).toContain(section);
    // Without a command, commander shows the help on stderr and ends with a usage error, as before.
    const alone = await run([], ws.root);
    expect([alone.code, alone.stdout]).toEqual([EXIT.usage, ""]);
    expect(alone.stderr).toContain(section);
    expect((await run(["workspace", "--help"], ws.root)).stdout).not.toContain("Get started");
  });
});

describe("quoted", () => {
  it("keeps a plain token and quotes the others for the shell of the system", () => {
    expect(quoted("a/b-c.d", "linux")).toBe("a/b-c.d");
    expect(quoted("it's $x \\y", "darwin")).toBe("'it'\\''s $x \\y'");
    expect(quoted("~/x", "linux")).toBe("'~/x'");
    expect(quoted("C:\\Users\\RUNNER~1\\x", "win32")).toBe("C:\\Users\\RUNNER~1\\x");
    expect(quoted("C:\\my dir\\it's", "win32")).toBe("'C:\\my dir\\it''s'");
    expect(quoted("C:\\a,b", "win32")).toBe("'C:\\a,b'");
  });
});
