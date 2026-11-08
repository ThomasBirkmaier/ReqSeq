// `reqseq serve api` (ADR-0009): the local API over `node:http`, on loopback only (SR-079). The bind
// addresses are the constant LOOPBACK_HOSTS; there is no option or setting to listen anywhere else.
import { randomBytes } from "node:crypto";
import { get } from "node:http";
import type { AddressInfo } from "node:net";
import type { ApiEndpointFile, CommandRuntime, Workspace } from "@reqseq/core";
import {
  CommandError,
  cacheFolder,
  getCommandRuntime,
  lockCacheFile,
  processRuns,
  readCacheFile,
  removeCacheFile,
  writeCacheFile,
} from "@reqseq/core";
import { COMMANDS_PATH, createRequestHandler } from "./handler.js";
import { checkPort, closeServer, listenOnAll } from "./listen.js";

export {
  HEADERS_TIMEOUT_MS,
  PORT_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  checkPort,
  closeServer,
  listenOnAll,
} from "./listen.js";
export type { Listening } from "./listen.js";

/** The only addresses the API listens on (SR-079 AK1, AK3). `::1` only where the machine has IPv6. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;

/** Name of the endpoint file (`api-endpoint.schema.json`) in the cache folder of the working copy. */
export const ENDPOINT_FILE = "api.json";
export interface ApiServerOptions {
  /** The workspace every request runs on; the caller closes it after `close()`. */
  readonly workspace: Workspace;
  /** Default: the runtime of this process (`getCommandRuntime()`). */
  readonly runtime?: CommandRuntime;
  /** TCP port, 0 (default) for any free one. */
  readonly port?: number;
  /**
   * Folder of `api.json`. Default: the cache folder of the workspace (`workspace.cacheFolder`, else
   * `cacheFolder(workspace.root)`).
   */
  readonly cacheFolder?: string;
}

export interface ApiServer {
  readonly port: number;
  /** The addresses listened on: 127.0.0.1, and ::1 where the machine has IPv6. */
  readonly addresses: readonly AddressInfo[];
  /** Base URL per address, as in `api.json`. */
  readonly urls: readonly string[];
  /** Absolute path of `api.json` (port and token). */
  readonly endpointFile: string;
  /**
   * Stops listening, aborts running commands, closes all connections and removes `api.json`. Leaves the
   * workspace open.
   */
  close(): Promise<void>;
}

/** The base URL of an address the API listens on. */
export const urlOf = (address: AddressInfo): string =>
  address.family === "IPv6"
    ? `http://[${address.address}]:${String(address.port)}`
    : `http://${address.address}:${String(address.port)}`;

/** The fields of `text` (api.json, untrusted), or `undefined` when it is no JSON object. */
const endpointOf = (text: string): Readonly<Record<string, unknown>> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

/** How long a URL of `api.json` may take to answer before the API there counts as stopped. */
export const PROBE_TIMEOUT_MS = 1000;

/**
 * A URL as urlOf writes it: loopback only, so the check below never connects to another machine, whatever
 * the file says.
 */
const LOOPBACK_URL = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d{1,5}$/;

/**
 * Whether the API at `url` runs: it answers `GET /v1/commands` with 200 for `token`, or it accepts the
 * connection and does not answer within PROBE_TIMEOUT_MS (an API that is busy). Any other answer or failure
 * is false.
 */
const answers = (url: string, token: string): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    let accepted = false;
    const request = get(
      `${url}${COMMANDS_PATH}`,
      {
        // A fresh agent, never one that HTTP_PROXY or NODE_USE_ENV_PROXY set up: the request goes straight
        // to the loopback URL and never through a proxy on another machine (SR-078).
        agent: false,
        headers: { authorization: `Bearer ${token}` },
        signal,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("socket", (socket) => {
      socket.once("connect", () => {
        accepted = true;
      });
    });
    request.on("error", () => {
      resolve(accepted && signal.aborted);
    });
  }).catch(() => false);

/**
 * Refuse to start while the API of `api.json` in `folder` runs. When the process of the file does not run,
 * the file is stale and replaced at once. When it runs (it may be another process with a reused ID), the
 * loopback URLs of the file are asked (`answers`): that API serves this working copy already, and a second
 * one would replace its token. Otherwise the file is replaced.
 */
const refuseWhileRunning = async (folder: string): Promise<void> => {
  const text = await readCacheFile(folder, ENDPOINT_FILE);
  const endpoint = text === undefined ? undefined : endpointOf(text);
  const token = endpoint?.["token"];
  const stored = endpoint?.["urls"];
  const urls = Array.isArray(stored)
    ? stored.filter((url): url is string => typeof url === "string" && LOOPBACK_URL.test(url))
    : [];
  if (typeof token !== "string" || urls.length === 0 || !processRuns(endpoint?.["pid"])) {
    return;
  }
  const answered = await Promise.all(urls.map((url) => answers(url, token)));
  const url = urls.find((_, index) => answered[index] === true);
  if (url !== undefined) {
    throw new CommandError(
      "input.invalid",
      `A ReqSeq API for this working copy runs already at ${url}. Stop it first. ` +
        `If it does not answer, remove ${ENDPOINT_FILE} in ${folder}.`,
      { url, folder },
    );
  }
};

/** The folder of `api.json` for these options. */
const endpointFolder = (options: Pick<ApiServerOptions, "workspace" | "cacheFolder">): string =>
  options.cacheFolder ?? options.workspace.cacheFolder ?? cacheFolder(options.workspace.root);

/**
 * Rejects as `startApiServer` would when an API for this working copy runs or is starting: with the
 * lock of `api.json` taken by another process, or an `api.json` that names a running API. Nothing is
 * written. `reqseq serve api` asks before it loads the workspace (SR-082), so a second start does not
 * load 50,000 elements only to be refused; `startApiServer` checks again under the lock.
 */
export async function refuseRunningApi(
  options: Pick<ApiServerOptions, "workspace" | "cacheFolder">,
): Promise<void> {
  const folder = endpointFolder(options);
  const lock = await lockCacheFile(folder, ENDPOINT_FILE);
  if (lock === undefined) {
    throw starting(folder);
  }
  try {
    await refuseWhileRunning(folder);
  } finally {
    await lock.release();
  }
}

/** The error of a start while another API holds the lock. */
const starting = (folder: string): CommandError =>
  new CommandError(
    "input.invalid",
    `A ReqSeq API for this working copy runs already or is starting. Stop it first. ` +
      `If none runs, remove ${ENDPOINT_FILE}.lock in ${folder}.`,
    { folder },
  );

/**
 * Start the local API: take the lock of `api.json` (`lockCacheFile`), so that of two starts at the same time
 * only one goes on; refuse while `api.json` names a running API; listen on LOOPBACK_HOSTS; write `api.json`
 * (port, a new 256-bit token) with mode 0600 into the cache folder; give the lock back. Rejects with a
 * CommandError when another API runs or starts, or it cannot listen, and with the Node error when the file
 * or its lock cannot be read or written (nothing is left listening then).
 */
export async function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const runtime = options.runtime ?? getCommandRuntime();
  const requested = checkPort(options.port ?? 0);
  const folder = endpointFolder(options);
  const lock = await lockCacheFile(folder, ENDPOINT_FILE);
  if (lock === undefined) {
    throw starting(folder);
  }
  try {
    return await startLocked(options, runtime, requested, folder);
  } finally {
    await lock.release();
  }
}

/** startApiServer while it holds the lock of `api.json`. */
const startLocked = async (
  options: ApiServerOptions,
  runtime: CommandRuntime,
  requested: number,
  folder: string,
): Promise<ApiServer> => {
  await refuseWhileRunning(folder);
  const token = randomBytes(32).toString("base64url");
  const closing = new AbortController();
  const handler = createRequestHandler({
    runtime,
    workspace: options.workspace,
    token,
    signal: closing.signal,
  });
  const { servers, port } = await listenOnAll(LOOPBACK_HOSTS, requested, handler);
  const addresses = servers.map((server) => server.address() as AddressInfo);
  const urls = addresses.map(urlOf);
  const stop = async (): Promise<void> => {
    closing.abort();
    await Promise.all(servers.map(closeServer));
  };
  const endpoint: ApiEndpointFile = { "reqseq-api": 1, port, token, urls, pid: process.pid };
  let endpointFile: string;
  try {
    endpointFile = await writeCacheFile(folder, ENDPOINT_FILE, `${JSON.stringify(endpoint, null, 2)}\n`);
  } catch (error) {
    await stop();
    throw error;
  }
  const close = async (): Promise<void> => {
    await stop();
    // Only our own file: never one that another API wrote after this one was started.
    const text = await readCacheFile(folder, ENDPOINT_FILE);
    if (text !== undefined && endpointOf(text)?.["token"] === token) {
      await removeCacheFile(folder, ENDPOINT_FILE);
    }
  };
  return { port, addresses, urls, endpointFile, close };
};
