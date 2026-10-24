import { PassThrough } from "node:stream";
import type { JSONRPCMessage } from "@modelcontextprotocol/server";
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
