// The connected agent in the modeline (SR-228 AK1–AK3): what `workspace.agents` gives, as the modeline shows
// it. Pure display (ADR-0002): core decides who is connected, since when and until when (the beat of each MCP
// server process and its end, also by a crash), and cuts the client's name to 40 characters; the app shows its
// answer, names a client core gives as null "unknown client", and writes the times in local time.
import type { InvokeResult } from "../shared/protocol.js";
import { CONNECT_AI_AGENT } from "./connect-agent.js";

/** The command the modeline asks (SR-228 AK7). */
export const AGENTS_COMMAND = "workspace.agents";

/**
 * How often the window asks `workspace.agents` while a workspace is open: every 500 ms after the last answer.
 * A connection shows within that and the time of one call (AK1: at most 1 s); a crashed server stops counting in
 * core 3 s after its last beat, so it shows grey within about 3.5 s (AK2: at most 5 s).
 */
export const AGENTS_POLL_MS = 500;

export const AGENT_CONNECTED = "Agent connected";
export const NO_AGENT = "No agent connected";
export { CONNECT_AI_AGENT };
/** A client that gave no name, or none that is left as text (SR-228 AK1). */
export const UNKNOWN_CLIENT = "unknown client";

/** What the modeline shows of the agents of the copy. */
export type AgentStatus =
  /** Green dot and "Agent connected"; the hover names each connection (AK1). */
  | { readonly kind: "connected"; readonly hover: string }
  /** Grey dot and "No agent connected"; the hover names the client connected last (AK2). */
  | { readonly kind: "ended"; readonly hover: string }
  /** "Connect AI agent": no agent was ever connected, as far as the cache folder knows (AK3). */
  | { readonly kind: "never" };

interface Connection {
  readonly client: string | null;
  readonly since: string;
}

interface Output {
  readonly recorded: boolean;
  readonly connected: readonly Connection[];
  readonly last: { readonly client: string | null; readonly at: string } | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const two = (value: number): string => String(value).padStart(2, "0");

/** An RFC 3339 time as the local date and time to the second: `2026-11-19 14:03:07`. */
export const localTime = (time: string): string => {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return time;
  }
  const day = `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
};

const clientOf = (client: string | null): string => client ?? UNKNOWN_CLIENT;

/**
 * The modeline's agent part of an answer of `workspace.agents`; undefined, so nothing shows, when the call failed
 * or the copy has no usable cache folder (`recorded: false`, SR-228 AK4).
 */
export const agentStatus = (result: InvokeResult): AgentStatus | undefined => {
  if (!result.ok || !isRecord(result.output) || result.output["recorded"] !== true) {
    return undefined;
  }
  const { connected, last } = result.output as unknown as Output;
  if (connected.length > 0) {
    const lines = connected.map((c) => `${clientOf(c.client)} · connected since ${localTime(c.since)}`);
    return { kind: "connected", hover: lines.join("\n") };
  }
  return last === null
    ? { kind: "never" }
    : { kind: "ended", hover: `${clientOf(last.client)} · last connected ${localTime(last.at)}` };
};

/** Whether two states show the same, so that an answer that changes nothing renders nothing. */
export const sameStatus = (a: AgentStatus | undefined, b: AgentStatus | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
