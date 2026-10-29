// Starts the built app (out/, `pnpm build:electron`) on a fixture workspace for one test, with its own
// cache folder, and the CLI on the same workspace for comparisons (SR-080).
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import { rememberWorkspace } from "@logreq/core/recent-workspaces";

const execFileAsync = promisify(execFile);

/** How long `close()` waits for the app to end after it closed the window (main waits at most 2 s for the save). */
const CLOSE_WAIT_MS = 5000;
/** How long a call into the main process may take while `close()` ends the app or describes a hang. */
const CALL_WAIT_MS = 1000;
/**
 * What Node writes to standard error when the main process has ended but Playwright's inspector session
 * (`--inspect=0`) is still attached. Node writes it while it frees the main process's JavaScript
 * environment, after Electron's main loop has ended, so after the last event of the app (`quit`): the
 * app's own code is done. Playwright closes its session on this line (as it does in `_electron.launch`),
 * and the process then ends with Chromium's shutdown, which took more than 5 s once on Windows (#304).
 */
const DEBUGGER_WAIT = "Waiting for the debugger to disconnect...";

/** `fixtures/` of the repository (fixtures/README.md). */
const FIXTURES = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));
/**
 * packages/app: Electron starts its package.json "main" (out/main/index.js). Without a trailing separator:
 * on Windows Playwright starts Electron through a shell with each argument in double quotes, and a
 * backslash before the closing quote escapes it, which merged all later arguments into this one (#304).
 */
const APP_FOLDER = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
/** The built CLI (`pnpm build`). */
const CLI = fileURLToPath(new URL("../../../cli/dist/bin.js", import.meta.url));
/** Fails every connection that leaves the machine in a spawned CLI, as in the CLI's end-to-end tests (SR-077). */
const BLOCK_NETWORK = pathToFileURL(
  fileURLToPath(new URL("../../../../scripts/test-support/block-network.mjs", import.meta.url)),
).href;
/** The Electron binary of this package (`pnpm electron:install`). */
const ELECTRON = createRequire(import.meta.url)("electron") as string;

/**
 * A copy of a case folder of `fixtures/` (`fixture`) or of any workspace folder (`folder`, an absolute
 * path), plus `files` (relative path to content), in a temporary folder, as the folder `name` (default
 * `workspace`).
 */
export type Fixture = ({ readonly fixture: string } | { readonly folder: string }) & {
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly name?: string;
};

/** The copied workspace: its root (links resolved) and how to remove it. */
export interface FixtureWorkspace {
  readonly root: string;
  cleanup(): Promise<void>;
}

/** Copies a fixture workspace into a temporary folder (`launchApp` does it for the workspace it opens). */
export const copyFixture = async (source: Fixture): Promise<FixtureWorkspace> => {
  const { files = {} } = source;
  const from = "folder" in source ? source.folder : path.join(FIXTURES, ...source.fixture.split("/"));
  const top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-app-fixture-")));
  const root = path.join(top, source.name ?? "workspace");
  await fs.cp(from, root, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, ...relative.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return { root, cleanup: () => fs.rm(top, { recursive: true, force: true, maxRetries: 3 }) };
};

/** What a later start of the app on the same workspace and the same user data needs (the app restarts). */
export interface Kept {
  readonly home: string;
  readonly workspace: FixtureWorkspace | undefined;
}

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly window: Page;
  /** The fixture workspace; undefined when the app started without one. */
  readonly workspace: FixtureWorkspace | undefined;
  /** What the main process wrote to standard error so far (its log). */
  stderr(): string;
  /** Runs the CLI with `--json` on the workspace, with the app's cache folder. */
  cli(
    argv: readonly string[],
  ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
  /**
   * Starts `logreq mcp` on the workspace with the app's cache folder, as an agent starts it, and connects
   * to it as an MCP client (initialize first). The server ends with the app or with `close()`.
   */
  mcp(): Promise<McpSession>;
  /**
   * Ends the app as a user does: it closes the window, which saves its input first (SR-105 AK1), and
   * waits at most `CLOSE_WAIT_MS` for the app to end. A window that is still open then is destroyed, and
   * `close` throws, so a close that hangs fails the test. With `discard` (or after `discardAtClose()`)
   * the window is destroyed at once, for a test that ends with input that cannot be saved. With `keep`
   * the workspace copy and the user data stay, for `launchApp(..., kept)`.
   */
  close(options?: { readonly keep?: boolean; readonly discard?: boolean }): Promise<void>;
  /** The test ends with input that cannot be saved: the next `close()` discards it (as `discard`). */
  discardAtClose(): void;
  /** The workspace copy and the user data, to start the app on them again after `close({ keep: true })`. */
  readonly kept: Kept;
}

/** An MCP client on a `logreq mcp` process: newline-delimited JSON-RPC on its standard input and output. */
export interface McpSession {
  /** Calls a tool; resolves to its `structuredContent`, rejects with the text of an error result. */
  call(tool: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** The names of the tools the server offers (SR-117 AK4). */
  tools(): Promise<string[]>;
  /** What the server wrote to standard error so far. */
  stderr(): string;
  close(): Promise<void>;
}

/** Starts `logreq mcp` with `args` and `env`, and initializes an MCP session on it. */
const startMcp = async (args: readonly string[], env: NodeJS.ProcessEnv): Promise<McpSession> => {
  const child = spawn(process.execPath, ["--import", BLOCK_NETWORK, CLI, "mcp", ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map<
    number,
    { readonly resolve: (message: Record<string, unknown>) => void; readonly reject: (error: Error) => void }
  >();
  let buffered = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  // One listener for the whole session: a request that is still waiting when the server ends fails.
  child.once("exit", () => {
    for (const { reject } of waiting.values()) {
      reject(new Error(`logreq mcp ended: ${stderr}`));
    }
    waiting.clear();
  });
  const answered = (line: string): void => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Not a JSON-RPC message (a stray line on stdout): it shows with the failure, if one comes.
      stderr += `${line}\n`;
      return;
    }
    if (typeof message["id"] === "number") {
      waiting.get(message["id"])?.resolve(message);
      waiting.delete(message["id"]);
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      answered(line);
    }
  });
  let next = 0;
  const request = (method: string, params: unknown): Promise<Record<string, unknown>> => {
    if (child.exitCode !== null) {
      return Promise.reject(new Error(`logreq mcp ended: ${stderr}`));
    }
    next += 1;
    const id = next;
    const answer = new Promise<Record<string, unknown>>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return answer;
  };
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "logreq-app-e2e", version: "1" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    call: async (tool, toolArgs) => {
      const answer = await request("tools/call", { name: tool, arguments: toolArgs });
      const result = answer["result"] as
        { isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] } | undefined;
      if (result === undefined || result.isError === true) {
        throw new Error(JSON.stringify(answer["error"] ?? result?.content));
      }
      return result.structuredContent;
    },
    tools: async () => {
      const answer = await request("tools/list", {});
      const result = answer["result"] as { tools: { name: string }[] };
      return result.tools.map((tool) => tool.name);
    },
    stderr: () => stderr,
    close: async () => {
      if (child.exitCode === null) {
        const ended = new Promise((resolve) => child.once("exit", resolve));
        child.stdin.end();
        await ended;
      }
    },
  };
};

export interface LaunchOptions {
  /**
   * The colour scheme the pages see (Playwright emulates `prefers-color-scheme` in the renderer only).
   * Default `light`, as Playwright's; `null` leaves it to the system (Electron's nativeTheme).
   */
  readonly colorScheme?: "light" | "dark" | null;
  /** The workspace and the user data of an earlier start (`close({ keep: true })`): the app restarts. */
  readonly kept?: Kept;
  /** With `kept`: start without `--workspace`, as the packaged app starts (SR-131 AK6). */
  readonly withoutWorkspace?: boolean;
  /**
   * Roots to put in the list of recent workspaces before the start, the most recent first (SR-131), as
   * core's core process records them, in the test's OS cache folder.
   */
  readonly recent?: readonly string[];
}

/**
 * Opt-in: `LOGREQ_CPU_THROTTLE=<rate>` slows the window's renderer `rate` times (Chromium's
 * `Emulation.setCPUThrottlingRate`, 10 to 20 is useful), so that races which only show on a busy CI runner
 * show locally (#542). Off by default; CI does not set it. Run e.g.
 * `LOGREQ_CPU_THROTTLE=15 playwright test --config test/playwright.config.ts --repeat-each 20`.
 */
const throttle = async (window: Page): Promise<void> => {
  const rate = Number(process.env["LOGREQ_CPU_THROTTLE"] ?? "1");
  if (!(rate > 1)) {
    return;
  }
  const session = await window.context().newCDPSession(window);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** `promise`, or `fallback` when it rejects or takes longer than `ms`. */
const within = async <T, F>(
  promise: Promise<T>,
  ms: number,
  fallback: (error: unknown) => F,
): Promise<T | F> => {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<F>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback(new Error(`no answer within ${String(ms)} ms`)));
    }, ms);
  });
  try {
    return await Promise.race([promise.catch(fallback), late]);
  } finally {
    clearTimeout(timer);
  }
};

/** The state of an app that did not end after its window was closed, for the error of the test. */
const hangState = async (app: ElectronApplication, window: Page, stderr: string): Promise<string> => {
  const windows = await within(
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    CALL_WAIT_MS,
    (error: unknown) => `unknown (${String(error)})`,
  );
  const minibuffer = await window
    .getByLabel("Minibuffer")
    .innerText({ timeout: 1000 })
    .catch(() => "(not readable)");
  const log = stderr.trim().split(/\r?\n/).slice(-10).join(" | ");
  return `Open windows: ${String(windows)}. Minibuffer: ${JSON.stringify(minibuffer)}. Last log lines: ${log}`;
};

/** Starts the app on a new fixture workspace (`undefined`: without a workspace), or on `options.kept`. */
export const launchApp = async (
  fixture: Fixture | undefined,
  options: LaunchOptions = {},
): Promise<RunningApp> => {
  const { kept } = options;
  const workspace =
    kept === undefined ? (fixture === undefined ? undefined : await copyFixture(fixture)) : kept.workspace;
  // The OS cache folder (model cache, ADR-0008) and the user data of Electron (its local storage, where
  // the recent elements of the overview and the use of the command prompt are, SR-118, SR-121) lie in a
  // temporary folder on every OS. The environment below moves the cache folder; the user data folder needs
  // Chromium's `--user-data-dir` switch, because on macOS Electron takes `appData` from Foundation
  // (~/Library/Application Support of the account), which does not follow HOME (#505). Without it, every
  // test on a Mac shared the real user data of the LogReq app of that account.
  const home =
    kept === undefined
      ? await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-app-home-")))
      : kept.home;
  const userData = path.join(home, "user-data");
  const recent = options.recent ?? [];
  for (const [index, root] of recent.toReversed().entries()) {
    await rememberWorkspace(root, {
      environment: { platform: process.platform, env: { XDG_CACHE_HOME: home, LOCALAPPDATA: home }, home },
      now: new Date(Date.now() - (recent.length - index) * 60_000),
    });
  }
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: home,
    XDG_CONFIG_HOME: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    LOGREQ_VALIDATE_OUTPUT: "1",
  };
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [
      APP_FOLDER,
      `--user-data-dir=${userData}`,
      ...(workspace === undefined || options.withoutWorkspace === true
        ? []
        : ["--workspace", workspace.root]),
    ],
    env,
    ...(options.colorScheme === undefined ? {} : { colorScheme: options.colorScheme }),
  });
  let stderr = "";
  const sessions: McpSession[] = [];
  // The app's code has ended once Node waits for the debugger, even before its process has ended.
  let debuggerWait: (() => void) | undefined;
  const codeEnded = new Promise<void>((resolve) => {
    debuggerWait = resolve;
  });
  app.process().stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (stderr.includes(DEBUGGER_WAIT)) {
      debuggerWait?.();
    }
  });
  const window = await app.firstWindow();
  await throttle(window);
  // A test never runs on the user data of a real installation, and a restart finds what the start before kept.
  const used = await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
  const same = await fs.realpath(used).then(
    (real) => real === userData,
    () => false,
  );
  if (!same) {
    await app.close();
    throw new Error(`The app uses the user data folder ${used}, not the test's ${userData}`);
  }
  let discard = false;
  // Whether the app ended: its process ended, or its code did and the process is shutting down (a test of
  // quitting ends it itself).
  let ended = false;
  const end = Promise.race([new Promise<void>((resolve) => app.once("close", resolve)), codeEnded]).then(
    () => {
      ended = true;
      return true as const;
    },
  );
  return {
    app,
    window,
    workspace,
    stderr: () => stderr,
    cli: async (argv) => {
      const args = [
        CLI,
        ...argv,
        "--json",
        ...(workspace === undefined ? [] : ["--workspace", workspace.root]),
      ];
      try {
        const { stdout, stderr: err } = await execFileAsync(process.execPath, args, { env });
        return { code: 0, stdout, stderr: err };
      } catch (error) {
        const failed = error as { code: number; stdout: string; stderr: string };
        return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
      }
    },
    mcp: async () => {
      const session = await startMcp(workspace === undefined ? [] : ["--workspace", workspace.root], env);
      sessions.push(session);
      return session;
    },
    kept: { home, workspace },
    discardAtClose: () => {
      discard = true;
    },
    close: async (options) => {
      await Promise.all(sessions.splice(0).map((session) => session.close()));
      let hung = false;
      if (options?.discard !== true && !discard && !ended) {
        // Closing the window quits the app (one window), after the window saved its input (SR-105 AK1).
        let timer: NodeJS.Timeout | undefined;
        const late = new Promise<false>((resolve) => {
          timer = setTimeout(() => {
            resolve(false);
          }, CLOSE_WAIT_MS);
        });
        // Not awaited on its own: a main process that does not answer is a hang, within the same wait.
        void app
          .evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0]?.close();
          })
          .catch(() => undefined);
        hung = !(await Promise.race([end, late]));
        clearTimeout(timer);
      }
      // What a hang leaves, for its error: whether the window is still open (it kept itself open, and its
      // minibuffer says why) or closed while the app did not end, and the app's last log lines.
      const left = hung ? await hangState(app, window, stderr) : "";
      // A window that keeps itself open (input it cannot save asks once, SR-105 AK1) is destroyed:
      // `destroy()` closes it without a `close` event, so without a save.
      if (!ended) {
        await within(
          app.evaluate(({ BrowserWindow }) => {
            for (const open of BrowserWindow.getAllWindows()) {
              open.destroy();
            }
          }),
          CALL_WAIT_MS,
          () => undefined,
        );
      }
      // How long a hung app still took to end by itself after its windows were destroyed, for the error.
      const started = Date.now();
      const endedLate = hung
        ? await Promise.race([
            end.then(() => `${String(Date.now() - started)} ms`),
            delay(10_000).then(() => "no"),
          ])
        : "";
      await app.close();
      if (options?.keep !== true) {
        await workspace?.cleanup();
        await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
      }
      if (hung) {
        throw new Error(
          `The app did not end within ${String(CLOSE_WAIT_MS)} ms after its window was closed; it was destroyed. A test that ends with input that cannot be saved closes with \`discard\`. ${left}. Ended by itself after the destroy: ${endedLate}.`,
        );
      }
    },
  };
};

/**
 * The modifier of the app's shortcuts for `window`: Meta (Cmd) when the renderer is on macOS, also when a
 * test emulates it by `navigator.platform` on another OS, else `ControlOrMeta`. Under macOS the app takes
 * only Cmd (#543), and Playwright's `ControlOrMeta` follows the OS of the runner, not the emulated one.
 */
export const modifier = async (window: Page): Promise<"Meta" | "ControlOrMeta"> =>
  (await window.evaluate(() => navigator.platform.startsWith("Mac"))) ? "Meta" : "ControlOrMeta";

/** The app starts with the overview; this opens the list of all elements, as a person does (SR-118 AK4). */
export const listAll = async (window: Page): Promise<void> => {
  // Keys count once the workspace is open and its first buffer is shown.
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press(`${await modifier(window)}+Shift+P`);
  await window.keyboard.type("List all elements");
  await window.keyboard.press("Enter");
  await window.locator(".row").first().waitFor();
};

/**
 * The sort the lists of the app start with (#418), as the CLI takes it: a test that compares a list with
 * `element list` gives the CLI this input. A unit test pins the real `DEFAULT_SORT` of the renderer.
 */
export const DEFAULT_SORT = [
  { by: "type", order: "asc" },
  { by: "identifier", order: "asc" },
] as const;
