# @logreq/api

The local API of LogReq (ADR-0009): HTTP on loopback only, generic over the command catalog of `@logreq/core` (ADR-0002). It has no logic of its own; every request is one `invoke` call. Started by `logreq serve api`.

```sh
logreq serve api                 # any free port; prints the URLs and where api.json is
logreq serve api --port 8123 --workspace ../copy-2
```

```sh
# api.json in the cache folder of the working copy (schemas/api-endpoint.schema.json) has port and token.
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/v1/commands/workspace.status
curl -s -X POST -H "Authorization: Bearer $TOKEN" -d '{"ref":"SR-46fb54"}' http://127.0.0.1:$PORT/v1/commands/element.get
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/v1/commands   # the catalog
```

- Listens on `127.0.0.1` and `::1` (where the machine has IPv6), never elsewhere; there is no option for the address (SR-079).
- `POST /v1/commands/<name>`: body = command input as JSON (empty = `{}`, at most 32 MiB, else 413 at once). 200 with exactly the command output, also with error findings. Errors: the error object of `common.schema.json#/$defs/error` with 400 (`input`), 404 (`not-found`), 409 (`conflict`), 503 (`unavailable`), 500 (`internal`).
- Refused before any command: a `Host` header other than `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`, and any `Origin` header (403); a missing or wrong token (401; the `Bearer` scheme in any case).
- One API per working copy: it does not start while `api.json` names a running process, and it removes its `api.json` when it stops.
- `schemas/generated/openapi.json` describes every endpoint.

## Code

- `src/server.ts`: `startApiServer({ workspace, runtime?, port?, cacheFolder? })` checks that no other API serves the copy, listens, writes `api.json` (mode 0600, through core's `writeCacheFile`) and returns `{ port, addresses, urls, endpointFile, close }`; `close()` removes `api.json` (`removeCacheFile`). `LOOPBACK_HOSTS` is the only bind address list.
- `src/handler.ts`: `createRequestHandler`: Host, Origin and token checks, routes, `HTTP_STATUS_BY_CLASS`.

## Tests

`src/*.test.ts` with a test-only catalog: listening addresses (`[SR-079/AK1]`), the constant bind addresses (`[SR-079/AK3]`), every refusal and status, aborts. The e2e test `packages/cli/test/e2e/servers.test.ts` connects to the addresses of the machine that other machines use and expects no connection (`[SR-079/AK2]`). The cross-access test (`packages/cli/test/cross-access.test.ts`) compares the API with core, CLI and MCP (SR-080).
