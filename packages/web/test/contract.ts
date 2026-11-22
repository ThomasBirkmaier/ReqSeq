// What the contract tests of the web UI share (SR-248, SR-078 AK3; ADR-0020, Tests): the built `reqseq ui` as a
// process, the record of the page's command calls, and a recorder that refuses every request of a browser
// context to another machine.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, Page, Request } from "@playwright/test";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
/** The built CLI (`pnpm build`). */
export const BIN = path.join(ROOT, "packages", "cli", "dist", "bin.js");
/** The preload that records programs and files with their step (SR-248 AK2), `--import` URL. */
export const RECORD_ACCESS = pathToFileURL(
  path.join(ROOT, "packages", "testkit", "preload", "record-access.mjs"),
).href;
/**
 * The network block of the tests (SR-078 AK1), `--import` URL: it refuses every connection to another machine and,
 * with `REQSEQ_NETWORK_LOG` naming a file, writes each attempt there.
 */
export const BLOCK_NETWORK = pathToFileURL(
  path.join(ROOT, "scripts", "test-support", "block-network.mjs"),
).href;

export interface CliUi {
  /** The address `reqseq ui` printed, with the token. */
  readonly url: string;
  /** Ends the process and resolves when it has ended. */
  readonly stop: () => Promise<void>;
}

/** How long `reqseq ui` may take to print its address. */
const START_MS = 30_000;

const ADDRESS = /^ReqSeq UI on (http:\/\/127\.0\.0\.1:\d+\/#token=[\w-]+)$/m;

/** A folder of its own, removed by `done`. */
export async function scratch(): Promise<{ readonly dir: string; readonly done: () => Promise<void> }> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-contract-")));
  return { dir, done: () => fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }) };
}

const ended = (child: ChildProcessWithoutNullStreams): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => {
      resolve();
    });
  });

/**
 * `reqseq ui --no-open --workspace <root>` as a process of its own, started with `node --import <preload>` for
 * each of `preloads`, with home and OS cache folder in `home` and `env` added to the environment. Resolves once
 * it printed its address; rejects with its output when it ends before.
 */
export async function startCliUi(options: {
  readonly root: string;
  readonly home: string;
  readonly preloads?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}): Promise<CliUi> {
  const child = spawn(
    process.execPath,
    [
      ...(options.preloads ?? []).flatMap((p) => ["--import", p]),
      BIN,
      "ui",
      "--no-open",
      "--workspace",
      options.root,
    ],
    {
      cwd: options.root,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: options.home,
        USERPROFILE: options.home,
        XDG_CACHE_HOME: options.home,
        LOCALAPPDATA: options.home,
        ...options.env,
      },
    },
  );
  let out = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  const url = await new Promise<string>((resolve, reject) => {
    const late = setTimeout(() => {
      child.kill();
      reject(new Error(`reqseq ui printed no address within ${String(START_MS)} ms:\n${out}`));
    }, START_MS);
    const check = (): void => {
      const found = ADDRESS.exec(out);
      if (found?.[1] !== undefined) {
        clearTimeout(late);
        resolve(found[1]);
      }
    };
    child.stdout.on("data", check);
    child.once("exit", (code) => {
      clearTimeout(late);
      reject(new Error(`reqseq ui ended with ${String(code)} before it printed its address:\n${out}`));
    });
  });
  return {
    url,
    stop: async () => {
      child.kill();
      await ended(child);
    },
  };
}

/** One call of a catalog command by the page: its name and its input. */
export interface CommandCall {
  readonly name: string;
  readonly input: unknown;
}

/** Records every command call of `page` (`POST api/<command>`) into the list it returns, in their order. */
export function recordCommandCalls(page: Page): CommandCall[] {
  const calls: CommandCall[] = [];
  page.on("request", (request: Request) => {
    const { pathname } = new URL(request.url());
    if (request.method() === "POST" && pathname.startsWith("/api/")) {
      calls.push({ name: decodeURIComponent(pathname.slice("/api/".length)), input: request.postDataJSON() });
    }
  });
  return calls;
}

/** Whether `url` names a loopback address (SR-078: a connection on the same machine is none to another). */
export const isLoopback = (url: URL): boolean =>
  ["[::1]", "localhost"].includes(url.hostname) || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);

/**
 * Refuses every request of `context` to an address other than loopback and records it, also a request the
 * route does not see (`request` events, a WebSocket); the list it returns names their URLs. `data:` and `blob:`
 * URLs load nothing from a machine.
 */
export async function refuseRemote(context: BrowserContext): Promise<string[]> {
  const recorded: string[] = [];
  const remote = (raw: string): boolean => {
    const url = new URL(raw);
    return !["data:", "blob:", "about:"].includes(url.protocol) && !isLoopback(url);
  };
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (remote(url)) {
      recorded.push(url);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  context.on("request", (request) => {
    if (remote(request.url()) && !recorded.includes(request.url())) {
      recorded.push(request.url());
    }
  });
  const sockets = (page: Page): void => {
    page.on("websocket", (socket) => {
      if (remote(socket.url())) {
        recorded.push(socket.url());
      }
    });
  };
  context.pages().forEach(sockets);
  context.on("page", sockets);
  return recorded;
}
