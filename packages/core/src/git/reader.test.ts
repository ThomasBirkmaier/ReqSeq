import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import type * as ChildProcess from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as reader from "./reader.js";
import { headCommit } from "./reader.js";

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: ExecFileOptions;
}

type Callback = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void;

/** A canned answer instead of running git: an error or stdout. */
type Fake = { readonly error: Error } | { readonly stdout: string };

// Records the calls of the reader (not those of the testkit) and passes them on to the real
// execFile, unless a test sets a fake answer (fake git output, timeouts, a missing program).
const mock = vi.hoisted(() => ({ calls: [] as Call[], fake: undefined as Fake | undefined }));
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const execFile = (
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
    callback: Callback,
  ): unknown => {
    if (args[0] !== "--no-pager") {
      return original.execFile(file, args, options, callback);
    }
    mock.calls.push({ file, args, options });
    const fake = mock.fake;
    if (fake === undefined) {
      return original.execFile(file, args, options, callback);
    }
    queueMicrotask(() => {
      if ("error" in fake) {
        callback(fake.error, "", "");
      } else {
        callback(null, fake.stdout, "");
      }
    });
    return undefined;
  };
  // The testkit uses promisify(execFile): keep the real promisified form for it.
  return {
    ...original,
    execFile: Object.assign(execFile, { [promisify.custom]: promisify(original.execFile) }),
  };
});

const fixture = async (git?: readonly string[]): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({
    files: { "repo/a.md": "a\n", "plain/b.md": "b\n" },
    ...(git ? { git } : {}),
  });
  onTestFinished(() => ws.cleanup());
  return ws;
};

const execError = (message: string, props: Record<string, unknown>): Error =>
  Object.assign(new Error(message), props);

afterEach(() => {
  vi.unstubAllEnvs();
  mock.calls.length = 0;
  mock.fake = undefined;
});

describe("git reader", () => {
  it("exports only typed functions, no way to run another subcommand or argument", () => {
    expect(Object.keys(reader)).toEqual(["headCommit"]);
  });

  it("reads the HEAD commit of a repository", async () => {
    const ws = await fixture(["repo"]);
    expect(await headCommit(ws.path("repo"))).toEqual({ known: true, commit: await ws.head("repo") });
  });

  it("knows no commit for a folder that is not a repository", async () => {
    const ws = await fixture(["repo"]);
    expect(await headCommit(ws.path("plain"))).toMatchObject({ known: false, reason: "not-a-repository" });
  });

  it("knows no commit for a subfolder of a repository", async () => {
    const ws = await fixture(["."]);
    expect(await headCommit(ws.path("repo"))).toEqual({
      known: false,
      reason: "not-a-repository",
      detail: "not the top level of a repository",
    });
    expect(await headCommit(ws.root)).toEqual({ known: true, commit: await ws.head() });
  });

  it("knows no commit for a repository without commits", async () => {
    const ws = await fixture();
    await ws.git(["init", "--quiet"], "plain");
    expect(await headCommit(ws.path("plain"))).toMatchObject({ known: false, reason: "not-a-repository" });
  });

  it("knows no commit when git prints a top level that does not exist", async () => {
    const ws = await fixture(["repo"]);
    mock.fake = { stdout: `${ws.path("gone")}\n${"a".repeat(40)}\n` };
    expect(await headCommit(ws.path("repo"))).toMatchObject({ known: false, reason: "not-a-repository" });
  });

  it("knows no commit when the git program is missing", async () => {
    const ws = await fixture();
    mock.fake = { error: execError("spawn git ENOENT", { code: "ENOENT" }) };
    expect(await headCommit(ws.path("repo"))).toEqual({
      known: false,
      reason: "no-git",
      detail: "spawn git ENOENT",
    });
  });

  it("knows no commit when git times out", async () => {
    const ws = await fixture();
    mock.fake = { error: execError("Command failed", { killed: true, signal: "SIGKILL" }) };
    expect(await headCommit(ws.path("repo"))).toMatchObject({ known: false, reason: "timeout" });
  });

  it("tells when git refuses a repository owned by someone else", async () => {
    const ws = await fixture();
    mock.fake = {
      error: execError("fatal: detected dubious ownership in repository at '/x'", { code: 128 }),
    };
    expect(await headCommit(ws.path("repo"))).toMatchObject({ known: false, reason: "refused" });
  });

  it("is not redirected by inherited repository variables", async () => {
    const ws = await fixture(["repo", "plain"]);
    vi.stubEnv("GIT_DIR", ws.path("plain/.git"));
    expect(await headCommit(ws.path("repo"))).toEqual({ known: true, commit: await ws.head("repo") });
  });

  it("runs git with the fixed command line, environment and time limit of ADR-0006", async () => {
    const ws = await fixture(["repo"]);
    vi.stubEnv("GIT_OPTIONAL_LOCKS", "1");
    vi.stubEnv("GIT_TERMINAL_PROMPT", "1");
    await headCommit(ws.path("repo"));
    expect(mock.calls).toHaveLength(1);
    const [call] = mock.calls;
    expect(call?.file).toBe("git");
    expect(call?.args).toEqual([
      "--no-pager",
      "-c",
      "core.fsmonitor=false",
      "rev-parse",
      "--show-toplevel",
      "--verify",
      "HEAD",
    ]);
    expect(call?.options).toMatchObject({ timeout: 10_000, killSignal: "SIGKILL", cwd: ws.path("repo") });
    expect(call?.options.env?.["GIT_OPTIONAL_LOCKS"]).toBe("0");
    expect(call?.options.env?.["GIT_TERMINAL_PROMPT"]).toBe("0");
  });
});
