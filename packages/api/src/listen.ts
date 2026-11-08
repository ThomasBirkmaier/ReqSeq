// Listening on loopback for the local API and the docs server (ADR-0009, ADR-0017): one server per address on one
// port, with the bounds for a slow sender. Imports only `node:*` and core's `CommandError` module, so the app's main
// process can start the docs server (`@reqseq/api/docs-server`) without loading the catalog runtime.
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { CommandError } from "@reqseq/core/command-error";
import type { RequestHandler } from "./handler.js";

/** Tries with a new free port when port 0 was asked for and a later address has the first one taken. */
export const PORT_ATTEMPTS = 5;

/**
 * Bounds for a slow sender (ThomasBirkmaier/ReqSeq-archive#200): a request whose headers do not arrive within HEADERS_TIMEOUT_MS, or
 * whose body does not arrive within REQUEST_TIMEOUT_MS, gets 408 and the connection is closed. A 32 MiB
 * body over loopback takes milliseconds.
 */
export const HEADERS_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 30_000;

/** Listen errors that mean "this machine has no such address", e.g. no IPv6: skip that address. */
const NO_ADDRESS: readonly string[] = ["EADDRNOTAVAIL", "EAFNOSUPPORT"];

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

const listen = (server: Server, host: string, port: number): Promise<AddressInfo> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => {
      server.off("error", reject);
      resolve(server.address() as AddressInfo);
    });
  });

/** Stops listening and closes every connection of `server`. */
export const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
    server.closeAllConnections();
  });

/** A listen failure as a CommandError: a port in use or reserved is the caller's to fix. */
const listenError = (error: unknown, host: string, port: number): CommandError => {
  const code = errorCode(error);
  return code === "EADDRINUSE" || code === "EACCES"
    ? new CommandError("input.invalid", `Cannot listen on ${host} port ${String(port)} (${code})`, { port })
    : new CommandError(
        "internal",
        `Cannot listen on ${host} port ${String(port)}`,
        { port },
        { cause: error },
      );
};

/** The servers listening, at least one, and their common port. */
export interface Listening {
  readonly servers: readonly Server[];
  readonly port: number;
}

/** A later address has the port that the first one picked taken already: try again with a new one. */
class PortTaken extends Error {
  readonly failure: CommandError;

  constructor(failure: CommandError) {
    super(failure.message);
    this.failure = failure;
  }
}

/** One try of listenOnAll. */
const listenOnce = async (
  hosts: readonly string[],
  port: number,
  handler: RequestHandler,
): Promise<Listening> => {
  const servers: Server[] = [];
  let actual = port;
  try {
    for (const [index, host] of hosts.entries()) {
      const server = createServer(
        { headersTimeout: HEADERS_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS },
        handler,
      );
      try {
        actual = (await listen(server, host, actual)).port;
        servers.push(server);
      } catch (error) {
        if (index === 0 || !NO_ADDRESS.includes(String(errorCode(error)))) {
          const failure = listenError(error, host, actual);
          throw port === 0 && index > 0 && errorCode(error) === "EADDRINUSE"
            ? new PortTaken(failure)
            : failure;
        }
      }
    }
  } catch (error) {
    await Promise.all(servers.map(closeServer));
    throw error;
  }
  return { servers, port: actual };
};

/**
 * One server per address, all on the same port, each with `handler`: the first one picks the port when
 * `port` is 0, and when a later address has that port taken, it tries again with a new one (PORT_ATTEMPTS).
 * An address the machine does not have (after the first) is skipped. On failure every server opened so far
 * is closed.
 */
export async function listenOnAll(
  hosts: readonly string[],
  port: number,
  handler: RequestHandler,
): Promise<Listening> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await listenOnce(hosts, port, handler);
    } catch (error) {
      if (!(error instanceof PortTaken)) {
        throw error;
      }
      if (attempt === PORT_ATTEMPTS) {
        throw error.failure;
      }
    }
  }
}

/** `port` when it is a TCP port (0 for any free one); else `input.invalid`. */
export const checkPort = (port: number): number => {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CommandError(
      "input.invalid",
      `Port must be a whole number from 0 to 65535, not ${String(port)}`,
      {
        port,
      },
    );
  }
  return port;
};
