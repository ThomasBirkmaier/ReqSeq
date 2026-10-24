// The local API (ADR-0009): an adapter over the command catalog of @logreq/core (ADR-0002) on loopback only.
export {
  COMMANDS_PATH,
  DRAIN_BYTES,
  HTTP_STATUS_BY_CLASS,
  MAX_BODY_BYTES,
  createRequestHandler,
} from "./handler.js";
export type { HandlerOptions, RequestHandler } from "./handler.js";
export { ENDPOINT_FILE, LOOPBACK_HOSTS, startApiServer } from "./server.js";
export type { ApiServer, ApiServerOptions } from "./server.js";
