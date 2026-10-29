import { PassThrough } from "node:stream";
import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import { serializeMessage } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { LineTransport, MAX_MESSAGE_BYTES } from "./transport.js";

const ping = (id: number): JSONRPCMessage => ({ jsonrpc: "2.0", id, method: "ping" });

interface Received {
  readonly messages: JSONRPCMessage[];
  readonly errors: Error[];
  closes: number;
}

const connect = (transport: LineTransport): Received => {
  const received: Received = { messages: [], errors: [], closes: 0 };
  transport.onmessage = (message) => received.messages.push(message);
  transport.onerror = (error) => received.errors.push(error);
  transport.onclose = () => {
    received.closes++;
  };
  return received;
};

async function* chunks(...parts: (string | Uint8Array | Error)[]): AsyncGenerator<string | Uint8Array> {
  for (const part of parts) {
    await Promise.resolve();
    if (part instanceof Error) {
      throw part;
    }
    yield part;
  }
}

describe("LineTransport", () => {
  it("reads one message per line from text and byte chunks and closes at the end of the input", async () => {
    const line = `${JSON.stringify(ping(2))}\r\n`;
    const transport = new LineTransport(
      chunks(`${JSON.stringify(ping(1))}\n${line.slice(0, 5)}`, Buffer.from(line.slice(5))),
      { write: () => true },
    );
    const received = connect(transport);
    await transport.start();
    await transport.closed;
    expect(received).toEqual({ messages: [ping(1), ping(2)], errors: [], closes: 1 });
  });

  it("skips lines that are not JSON and reports lines that are not JSON-RPC", async () => {
    const transport = new LineTransport(chunks(`nope\n{"a":1}\n${JSON.stringify(ping(3))}\n`), {
      write: () => true,
    });
    const received = connect(transport);
    await transport.start();
    await transport.closed;
    expect(received.messages).toEqual([ping(3)]);
    expect(received.errors).toHaveLength(1);
  });

  it("reports a message larger than the limit", async () => {
    const transport = new LineTransport(chunks(Buffer.alloc(MAX_MESSAGE_BYTES + 1, 0x20)), {
      write: () => true,
    });
    const received = connect(transport);
    await transport.start();
    await transport.closed;
    expect(received.errors[0]?.message).toMatch(/exceeded maximum size/);
  });

  it("reports a failing input and closes", async () => {
    const transport = new LineTransport(chunks(new Error("read failed")), { write: () => true });
    const received = connect(transport);
    await transport.start();
    await transport.closed;
    expect(received.errors.map((e) => e.message)).toEqual(["read failed"]);
    expect(received.closes).toBe(1);
  });

  it("turns a thrown value that is no Error into one", async () => {
    // A stream may fail with anything; the SDK wants an Error.
    const reason: unknown = "x";
    const input: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          throw reason;
        },
      }),
    };
    const transport = new LineTransport(input, { write: () => true });
    const received = connect(transport);
    await transport.start();
    await transport.closed;
    expect(received.errors.map((e) => e.message)).toEqual(["x"]);
  });

  it("writes one line per message and nothing after close", async () => {
    const written: string[] = [];
    const input = new PassThrough();
    const transport = new LineTransport(input, { write: (text) => written.push(text) });
    await transport.start();
    await transport.send(ping(4));
    await transport.close();
    await transport.close();
    await transport.send(ping(5));
    expect(written).toEqual([`${JSON.stringify(ping(4))}\n`]);
  });

  it("stops reading once closed", async () => {
    const input = new PassThrough();
    const transport = new LineTransport(input, { write: () => true });
    const received = connect(transport);
    await transport.start();
    await transport.close();
    input.write(`${JSON.stringify(ping(6))}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(received.messages).toEqual([]);
    expect(received.closes).toBe(1);
    // Destroyed, so a pending read of standard input does not keep the process alive.
    expect(input.destroyed).toBe(true);
  });

  it("drops what an input without destroy still delivers after close", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* late(): AsyncGenerator<string> {
      await gate;
      yield `${JSON.stringify(ping(8))}\n`;
    }
    const transport = new LineTransport(late(), { write: () => true });
    const received = connect(transport);
    await transport.start();
    await transport.close();
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(received.messages).toEqual([]);
  });

  it("works without listeners and refuses a second start", async () => {
    const transport = new LineTransport(chunks("nope\n", `${JSON.stringify(ping(7))}\n`, new Error("x")), {
      write: () => true,
    });
    await transport.start();
    await expect(transport.start()).rejects.toThrow("already started");
    await transport.closed;
  });
});

describe("LineTransport: large messages and the send queue (#277)", () => {
  /** A result of about 3 MB of JSON: more than one chunk. */
  const large = (id: number): JSONRPCMessage => ({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: "note" }],
      structuredContent: {
        elements: Array.from({ length: 30_000 }, (_, n) => ({ n, title: `Größe 😀 ${"x".repeat(60)}` })),
      },
    },
  });

  /** A sink that pushes back on every write until `drained` (after a tick) says it takes more. */
  class SlowSink {
    readonly pieces: string[] = [];
    open = true;
    write(text: string): boolean {
      this.pieces.push(text);
      return false;
    }
    drained(): Promise<boolean> {
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve(this.open);
        }, 1),
      );
    }
  }

  it("writes the bytes of the SDK's serialisation in chunks, one write for a small message", async () => {
    const written: string[] = [];
    const transport = new LineTransport(new PassThrough(), { write: (text) => written.push(text) });
    await transport.start();
    await transport.send(large(1));
    expect(written.length).toBeGreaterThan(2);
    expect(written.join("")).toBe(serializeMessage(large(1)));
    written.length = 0;
    await transport.send(ping(2));
    expect(written).toEqual([serializeMessage(ping(2))]);
    await transport.close();
  });

  it("writes two sends started together as two whole lines in order, waiting for the sink (review B4)", async () => {
    const sink = new SlowSink();
    const transport = new LineTransport(new PassThrough(), sink);
    await transport.start();
    await Promise.all([transport.send(large(3)), transport.send(ping(4))]);
    expect(sink.pieces.join("")).toBe(serializeMessage(large(3)) + serializeMessage(ping(4)));
    expect(sink.pieces.at(-1)).toBe(serializeMessage(ping(4)));
    await transport.close();
  });

  it("stops a send when the transport closes, and closes when the reader has gone away (review B4)", async () => {
    const sink = new SlowSink();
    const transport = new LineTransport(new PassThrough(), sink);
    const received = connect(transport);
    await transport.start();
    const sending = transport.send(large(5));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await transport.close();
    await sending;
    const count = sink.pieces.length;
    await transport.send(ping(6));
    expect(sink.pieces).toHaveLength(count);
    expect(sink.pieces.join("").includes("\n")).toBe(false);

    const gone = new SlowSink();
    gone.open = false;
    const other = new LineTransport(new PassThrough(), gone);
    const closes = connect(other);
    await other.start();
    await other.send(large(7));
    expect(gone.pieces).toHaveLength(1);
    expect(closes.closes).toBe(1);
    expect(received.closes).toBe(1);
  });

  it("rejects a send that cannot be serialised and goes on with the next", async () => {
    const written: string[] = [];
    const transport = new LineTransport(new PassThrough(), { write: (text) => written.push(text) });
    await transport.start();
    const bad = { jsonrpc: "2.0", id: 8, result: { n: 1n } } as unknown as JSONRPCMessage;
    await expect(transport.send(bad)).rejects.toThrow(TypeError);
    await transport.send(ping(9));
    expect(written).toEqual([serializeMessage(ping(9))]);
    await transport.close();
  });

  it("closes the transport when a large message fails after its first chunk, so no line is glued on (review S1)", async () => {
    const written: string[] = [];
    const transport = new LineTransport(new PassThrough(), { write: (text) => written.push(text) });
    const received = connect(transport);
    await transport.start();
    const message = large(10) as unknown as { result: { structuredContent: { elements: unknown[] } } };
    message.result.structuredContent.elements.push({ n: 1n });
    await expect(transport.send(message as unknown as JSONRPCMessage)).rejects.toThrow(TypeError);
    expect(written.length).toBeGreaterThan(0);
    expect(received.closes).toBe(1);
    const count = written.length;
    await transport.send(ping(11));
    expect(written).toHaveLength(count);
  });

  it("does not leave a send pending on a drain that never comes once the transport closes", async () => {
    const pieces: string[] = [];
    const sink = {
      write: (text: string): boolean => (pieces.push(text), false),
      drained: (): Promise<boolean> => new Promise<boolean>(() => undefined),
    };
    const transport = new LineTransport(new PassThrough(), sink);
    await transport.start();
    const sending = transport.send(large(12));
    await new Promise((resolve) => setTimeout(resolve, 1));
    await transport.close();
    await sending;
    expect(pieces).toHaveLength(1);
  });
});
