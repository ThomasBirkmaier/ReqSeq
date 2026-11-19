// What the modeline shows of the answer of `workspace.agents` (SR-228): the state, the hover and the local times.
import { describe, expect, it } from "vitest";
import { agentStatus, localTime, sameStatus } from "./agent-status.js";

const ok = (output: unknown) => ({ ok: true as const, output });

describe("agentStatus", () => {
  it("shows nothing for a failed call, a broken answer or a cache folder that records nothing", () => {
    expect(agentStatus({ ok: false, error: { code: "internal", message: "x" } })).toBeUndefined();
    expect(agentStatus(ok(undefined))).toBeUndefined();
    expect(agentStatus(ok({ recorded: false, connected: [], last: null }))).toBeUndefined();
  });

  it("names each connection with its client and since when, a client without a name as unknown client", () => {
    const status = agentStatus(
      ok({
        recorded: true,
        connected: [
          { client: "Claude Code", since: "2026-11-19T10:00:00Z" },
          { client: null, since: "2026-11-19T10:00:05Z" },
        ],
        last: { client: "cursor", at: "2026-11-19T09:00:00Z" },
      }),
    );
    expect(status).toEqual({
      kind: "connected",
      hover: [
        `Claude Code · connected since ${localTime("2026-11-19T10:00:00Z")}`,
        `unknown client · connected since ${localTime("2026-11-19T10:00:05Z")}`,
      ].join("\n"),
    });
  });

  it("names the client connected last and when, and says when none was ever connected", () => {
    expect(
      agentStatus(ok({ recorded: true, connected: [], last: { client: null, at: "2026-11-19T09:00:00Z" } })),
    ).toEqual({
      kind: "ended",
      hover: `unknown client · last connected ${localTime("2026-11-19T09:00:00Z")}`,
    });
    expect(agentStatus(ok({ recorded: true, connected: [], last: null }))).toEqual({ kind: "never" });
  });
});

describe("localTime", () => {
  it("writes the local date and time to the second, and a time it cannot read as it is", () => {
    const date = new Date(2026, 10, 9, 8, 7, 6);
    expect(localTime(date.toISOString())).toBe("2026-11-09 08:07:06");
    expect(localTime("soon")).toBe("soon");
  });
});

describe("sameStatus", () => {
  it("is the same for the same kind and hover only", () => {
    expect(sameStatus(undefined, undefined)).toBe(true);
    expect(sameStatus({ kind: "never" }, undefined)).toBe(false);
    expect(sameStatus(undefined, { kind: "never" })).toBe(false);
    expect(sameStatus({ kind: "never" }, { kind: "never" })).toBe(true);
    expect(sameStatus({ kind: "ended", hover: "a" }, { kind: "ended", hover: "a" })).toBe(true);
    expect(sameStatus({ kind: "ended", hover: "a" }, { kind: "ended", hover: "b" })).toBe(false);
    expect(sameStatus({ kind: "ended", hover: "a" }, { kind: "connected", hover: "a" })).toBe(false);
  });
});
