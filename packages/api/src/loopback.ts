// The Host rule of every loopback server of ReqSeq (the API, ADR-0009, and the docs server, SR-141).
import type { IncomingMessage } from "node:http";

/** Host names of loopback; the Host header must be one of them with the port of the connection. */
const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

/** The Host header names loopback and the local port of the connection (DNS rebinding protection). */
export const loopbackHost = (request: IncomingMessage): boolean => {
  const host = request.headers.host?.toLowerCase();
  const port = String(request.socket.localPort);
  return LOOPBACK_NAMES.some((name) => host === `${name}:${port}`);
};
