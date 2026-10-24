// The MCP stdio framing (one JSON-RPC message per line, UTF-8) over any input stream and text sink, so the
// server runs on the streams of the CLI (`logreq mcp`) and on in-memory streams in tests. Reading and
// writing the messages is the SDK's (ReadBuffer, serializeMessage); this only connects the streams.
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/server";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/server";

/**
 * Chunks of standard input (or any stream); strings are UTF-8 text. A stream with `destroy` (a Node
 * stream) is destroyed when the transport closes, so a pending read does not keep the process alive.
 */
export type InputStream = AsyncIterable<string | Uint8Array> & { readonly destroy?: () => unknown };

/** Where messages go; one call per message. */
export interface TextSink {
  write(text: string): unknown;
}

/** Largest incoming message, as for the body of an API request. */
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** A transport over a line-based stream. Closes when the input ends, fails, or `close()` is called. */
export class LineTransport implements Transport {
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: ((message: JSONRPCMessage) => void) | undefined;

  readonly #input: InputStream;
  readonly #output: TextSink;
  readonly #buffer = new ReadBuffer({ maxBufferSize: MAX_MESSAGE_BYTES });
  readonly #resolveClosed: () => void;
  #started = false;
  #closed = false;
  /** Fulfilled once the transport is closed, for whatever reason. */
  readonly closed: Promise<void>;

  constructor(input: InputStream, output: TextSink) {
    this.#input = input;
    this.#output = output;
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

  send(message: JSONRPCMessage): Promise<void> {
    if (!this.#closed) {
      this.#output.write(serializeMessage(message));
    }
    return Promise.resolve();
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
