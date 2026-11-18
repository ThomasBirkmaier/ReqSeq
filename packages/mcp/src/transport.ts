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
 * How `message` connects a client: an `initialize` request (`clientInfo`, connected once its
 * successful answer is written), a request of revision 2026-07-28 with its envelope (`_meta`, which
 * holds the client's name; connected when it arrives, as that revision has no `initialize`), or not.
 */
const connectingClient = (
  message: JSONRPCMessage,
): { readonly era: "initialize" | "envelope"; readonly client: unknown } | undefined => {
  if (!("method" in message) || !("id" in message)) {
    return undefined;
  }
  const params = isRecord(message.params) ? message.params : {};
  if (message.method === "initialize") {
    return { era: "initialize", client: nameOf(params["clientInfo"]) };
  }
  const meta = params._meta;
  return isRecord(meta) && PROTOCOL_VERSION_KEY in meta
    ? { era: "envelope", client: nameOf(meta[CLIENT_INFO_KEY]) }
    : undefined;
};

export interface LineTransportOptions {
  /**
   * Called once when a client is connected, with the name it gave (unchecked; SR-228): after the
   * successful answer to an `initialize` is written, or when the first request of revision 2026-07-28
   * arrives (that revision has no `initialize`, and its first request may get no answer with an id,
   * `subscriptions/listen`, or wait for a long load). The MCP server records the connection with it.
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
  /** The `initialize` requests not answered yet, by id, with the client's name. */
  readonly #initializing = new Map<unknown, unknown>();
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

  /** Calls `onConnect` once; later calls do nothing. */
  #connect(client: unknown): void {
    const onConnect = this.#onConnect;
    this.#onConnect = undefined;
    this.#initializing.clear();
    onConnect?.(client);
  }

  /** Notes an `initialize` request; connects at once on a request of revision 2026-07-28. */
  #noteConnecting(message: JSONRPCMessage): void {
    if (this.#onConnect === undefined) {
      return;
    }
    const connecting = connectingClient(message);
    if (connecting?.era === "envelope") {
      this.#connect(connecting.client);
    } else if (connecting !== undefined) {
      this.#initializing.set((message as { id: unknown }).id, connecting.client);
    }
  }

  /**
   * After `message` is written: connects when it is the successful answer to a noted `initialize`;
   * an error answer only drops that request, so a later `initialize` still connects.
   */
  #connected(message: JSONRPCMessage): void {
    if (!("id" in message) || "method" in message || !this.#initializing.has(message.id)) {
      return;
    }
    const client = this.#initializing.get(message.id);
    this.#initializing.delete(message.id);
    if ("result" in message) {
      this.#connect(client);
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
