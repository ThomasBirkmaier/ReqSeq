// The MCP stdio framing (one JSON-RPC message per line, UTF-8) over any input stream and text sink, so the
// server runs on the streams of the CLI (`reqseq mcp`) and on in-memory streams in tests. Reading is the
// SDK's (ReadBuffer). Writing gives the bytes of the SDK's `serializeMessage` (`JSON.stringify` and a line
// break), but in chunks of core's `jsonChunks`, since a result such as `data_export` at N-036 is larger
// than V8 holds in one string (#277). Sends go through a queue, each after the one before, so the line of
// one message is never broken by another (a ping answer, a notification); a send waits for the sink to
// drain when it pushes back, and stops when the transport is closed.
import { jsonChunks } from "@reqseq/core";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/server";
import { ReadBuffer } from "@modelcontextprotocol/server";

/**
 * Chunks of standard input (or any stream); strings are UTF-8 text. A stream with `destroy` (a Node
 * stream) is destroyed when the transport closes, so a pending read does not keep the process alive.
 */
export type InputStream = AsyncIterable<string | Uint8Array> & { readonly destroy?: () => unknown };

/** Where messages go, in pieces; the shape of the CLI's stdout. */
export interface TextSink {
  /** `false` when the sink buffers more than it wants (then wait for `drained`) or is closed. */
  write(text: string): unknown;
  /** After a write returned false: true when the sink takes more, false when it is closed. */
  drained?(): Promise<boolean>;
}

/**
 * One message as its line: compact JSON in chunks, the line break on the last one, so a message of one
 * chunk (almost every one) is a single write, as before.
 */
function* lineOf(message: JSONRPCMessage): Generator<string, void, undefined> {
  let held: string | undefined;
  for (const chunk of jsonChunks(message, { indent: 0 })) {
    if (held !== undefined) {
      yield held;
    }
    held = chunk;
  }
  yield `${held ?? ""}\n`;
}

/** Largest incoming message, as for the body of an API request. */
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** The `_meta` keys of a request of protocol revision 2026-07-28, which has no `initialize`. */
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The `name` of an `Implementation` object, as the client sent it (unchecked). */
const nameOf = (info: unknown): unknown => (isRecord(info) ? info["name"] : undefined);

/**
 * The client's name when `message` is the request that connects a client: `initialize` (its
 * `clientInfo`), or a request of revision 2026-07-28 (its envelope, `_meta`); `none` otherwise.
 */
const connectingClient = (message: JSONRPCMessage): { readonly client: unknown } | "none" => {
  if (!("method" in message) || !("id" in message)) {
    return "none";
  }
  const params = isRecord(message.params) ? message.params : {};
  if (message.method === "initialize") {
    return { client: nameOf(params["clientInfo"]) };
  }
  const meta = params._meta;
  return isRecord(meta) && PROTOCOL_VERSION_KEY in meta ? { client: nameOf(meta[CLIENT_INFO_KEY]) } : "none";
};

export interface LineTransportOptions {
  /**
   * Called once, after the successful answer to the first request that connects a client
   * (`initialize`, or the first request of revision 2026-07-28) is written, with the name the client
   * gave (unchecked; SR-228). The MCP server records the connection with it.
   */
  readonly onConnect?: (client: unknown) => void;
}

/** A transport over a line-based stream. Closes when the input ends, fails, or `close()` is called. */
export class LineTransport implements Transport {
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: ((message: JSONRPCMessage) => void) | undefined;

  readonly #input: InputStream;
  readonly #output: TextSink;
  readonly #buffer = new ReadBuffer({ maxBufferSize: MAX_MESSAGE_BYTES });
  readonly #resolveClosed: () => void;
  #onConnect: ((client: unknown) => void) | undefined;
  /** The request that connects the client, until its answer is written. */
  #connecting: { readonly id: unknown; readonly client: unknown } | undefined;
  #started = false;
  #closed = false;
  /** The sends so far, each after the one before; never rejects. */
  #queue: Promise<void> = Promise.resolve();
  /** Fulfilled once the transport is closed, for whatever reason. */
  readonly closed: Promise<void>;

  constructor(input: InputStream, output: TextSink, options: LineTransportOptions = {}) {
    this.#input = input;
    this.#output = output;
    this.#onConnect = options.onConnect;
    let resolveClosed!: () => void;
    this.closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    this.#resolveClosed = resolveClosed;
  }

  start(): Promise<void> {
    if (this.#started) {
      return Promise.reject(new Error("LineTransport already started"));
    }
    this.#started = true;
    void this.#read();
    return Promise.resolve();
  }

  /** Hands every complete line to `onmessage`; a line that is not a JSON-RPC message goes to `onerror`. */
  #deliver(): void {
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.#buffer.readMessage();
      } catch (error) {
        this.onerror?.(asError(error));
        continue;
      }
      if (message === null) {
        return;
      }
      this.#noteConnecting(message);
      this.onmessage?.(message);
    }
  }

  async #read(): Promise<void> {
    try {
      for await (const chunk of this.#input) {
        if (this.#closed) {
          break;
        }
        this.#buffer.append(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
        this.#deliver();
      }
    } catch (error) {
      this.onerror?.(asError(error));
    }
    await this.close();
  }

  /** Keeps the first request that connects a client, while `onConnect` waits for one. */
  #noteConnecting(message: JSONRPCMessage): void {
    if (this.#onConnect === undefined || this.#connecting !== undefined) {
      return;
    }
    const connecting = connectingClient(message);
    if (connecting !== "none") {
      this.#connecting = { id: (message as { id: unknown }).id, client: connecting.client };
    }
  }

  /** After `message` is written: calls `onConnect` when it is the successful answer to the connecting request. */
  #connected(message: JSONRPCMessage): void {
    const connecting = this.#connecting;
    if (
      connecting === undefined ||
      !("id" in message) ||
      message.id !== connecting.id ||
      "method" in message
    ) {
      return;
    }
    this.#connecting = undefined;
    if ("result" in message) {
      const onConnect = this.#onConnect;
      this.#onConnect = undefined;
      onConnect?.(connecting.client);
    }
  }

  /** Queues `message`; resolves when its line is written (or dropped, once closed). */
  send(message: JSONRPCMessage): Promise<void> {
    const sent = this.#queue.then(() => this.#write(message));
    this.#queue = sent.catch(() => undefined);
    return sent;
  }

  async #write(message: JSONRPCMessage): Promise<void> {
    let written = false;
    try {
      for (const chunk of lineOf(message)) {
        if (this.#closed) {
          return;
        }
        written = true;
        if (this.#output.write(chunk) === false && this.#output.drained !== undefined) {
          // Raced against `closed`, so a send does not stay pending once the transport is closed.
          const more = await Promise.race([this.#output.drained(), this.closed.then(() => false)]);
          if (!more) {
            // The reader has gone away (or the transport closed): nothing more can reach the client.
            await this.close();
            return;
          }
        }
      }
      this.#connected(message);
    } catch (error) {
      if (written) {
        // Half a line is out: the next message would be glued onto it, so the stream is unusable.
        await this.close();
      }
      throw error;
    }
  }

  close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#buffer.clear();
      this.#input.destroy?.();
      this.onclose?.();
      this.#resolveClosed();
    }
    return Promise.resolve();
  }
}
