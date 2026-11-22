// The event stream of the UI server (ADR-0020, Requests and Front end): `GET api/events` as Server-Sent Events,
// read with `fetch` and a stream reader, since `EventSource` sets no bearer header. One stream per browser: the
// tab that holds the lock reads it and passes every event to the other tabs through a BroadcastChannel, so the
// tabs do not use up the browser's connections per origin. When that tab closes, another one takes the lock.
// The first `workspace` event of each connection is marked `connected`: what changed while no stream was read (a
// lost stream, a new tab taking the lock) is read again then. A refused token concerns the tab that holds it only:
// it is not passed on, and the refused tab gives the lock up.

/** An event of the server: a change of the workspace (scope and UUIDs, no texts), or the open workspace's generation. */
export type ServerEvent =
  /** `elements`: the UUIDs added, changed and removed, in that order. */
  | { readonly type: "change"; readonly scope: string; readonly elements: readonly string[] }
  /** `connected`: the first event of a new connection of the stream. */
  | { readonly type: "workspace"; readonly generation: number; readonly connected?: boolean }
  /** The stream ended; the page keeps showing what it has and reads again when the stream is back. */
  | { readonly type: "lost" }
  /** The server refused the token. */
  | { readonly type: "refused" };

/** One Server-Sent Event as it comes: its name and its data. */
export interface RawEvent {
  readonly event: string;
  readonly data: string;
}

/**
 * The complete events at the start of `buffer` (each ends with a blank line) and the rest, which waits for more
 * text. Lines starting with `:` are comments; `data` lines of one event are joined with a line break.
 */
export function parseEvents(buffer: string): { readonly events: readonly RawEvent[]; readonly rest: string } {
  const text = buffer.replace(/\r\n?/g, "\n");
  const blocks = text.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: RawEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") {
        event = value;
      } else if (field === "data") {
        data.push(value);
      }
    }
    if (data.length > 0) {
      events.push({ event, data: data.join("\n") });
    }
  }
  return { events, rest };
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** The server event of `raw`, or undefined for one the page does not know. */
export function toServerEvent(raw: RawEvent): ServerEvent | undefined {
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(raw.data));
  } catch {
    return undefined;
  }
  if (raw.event === "workspace" && typeof data["generation"] === "number") {
    return { type: "workspace", generation: data["generation"] };
  }
  if (raw.event === "change") {
    // `elements` is core's `ChangedElements`: the UUIDs added, changed and removed.
    const groups = record(data["elements"]);
    const elements = ["added", "changed", "removed"].flatMap((key) => {
      const ids = groups[key];
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    });
    return { type: "change", scope: typeof data["scope"] === "string" ? data["scope"] : "", elements };
  }
  return undefined;
}

const CHANNEL = "reqseq-events";
const LOCK = "reqseq-events";
const RETRY_MS = 2000;

/** What a tab sends on the channel: an event for the others, or a new tab asking for the generation. */
type Message = { readonly kind: "event"; readonly event: ServerEvent } | { readonly kind: "hello" };

/** Reads the stream until it ends; resolves false when the server refused the token. */
async function readStream(token: string, deliver: (event: ServerEvent) => void): Promise<boolean> {
  const response = await fetch("api/events", {
    headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
    cache: "no-store",
  });
  if (response.status === 401) {
    return false;
  }
  if (!response.ok || response.body === null) {
    return true;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let first = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return true;
    }
    const parsed = parseEvents(buffer + value);
    buffer = parsed.rest;
    for (const raw of parsed.events) {
      const event = toServerEvent(raw);
      if (event?.type === "workspace" && first) {
        first = false;
        deliver({ ...event, connected: true });
      } else if (event !== undefined) {
        deliver(event);
      }
    }
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts listening: `onEvent` gets every server event in this tab, whichever tab reads the stream. Without Web
 * Locks or BroadcastChannel each tab reads a stream of its own.
 */
export function listen(token: string, onEvent: (event: ServerEvent) => void): void {
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : undefined;
  let last: ServerEvent | undefined;
  let leading = false;
  const deliver = (event: ServerEvent): void => {
    if (event.type === "workspace") {
      last = { type: "workspace", generation: event.generation };
    }
    onEvent(event);
    channel?.postMessage({ kind: "event", event } satisfies Message);
  };
  const lead = async (): Promise<void> => {
    leading = true;
    for (;;) {
      const accepted = await readStream(token, deliver).catch(() => true);
      if (!accepted) {
        // Only this tab's token was refused: the others keep theirs, and one of them takes the lock.
        leading = false;
        onEvent({ type: "refused" });
        return;
      }
      deliver({ type: "lost" });
      await pause(RETRY_MS);
    }
  };
  if (channel === undefined || typeof navigator.locks === "undefined") {
    void lead();
    return;
  }
  channel.onmessage = (message: MessageEvent<Message>) => {
    const data = message.data;
    if (data.kind === "event") {
      if (data.event.type === "workspace") {
        last = { type: "workspace", generation: data.event.generation };
      }
      onEvent(data.event);
    } else if (leading && last !== undefined) {
      channel.postMessage({ kind: "event", event: last } satisfies Message);
    }
  };
  void navigator.locks.request(LOCK, lead);
  channel.postMessage({ kind: "hello" } satisfies Message);
}
