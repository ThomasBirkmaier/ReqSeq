import { describe, expect, it } from "vitest";
import {
  TransientError,
  itemValues,
  plan,
  transientGraphqlErrors,
  transientStatus,
  withRetry,
} from "./sync-lib.mjs";

const fields = {
  Stage: {
    id: "F-stage",
    options: [
      { id: "O-5", name: "5" },
      { id: "O-q", name: "Querschnitt" },
    ],
  },
  Kind: {
    id: "F-kind",
    options: [
      { id: "O-sr", name: "SR" },
      { id: "O-en", name: "Enabler" },
    ],
  },
  "Agent state": {
    id: "F-state",
    options: [
      { id: "O-ready", name: "Ready" },
      { id: "O-work", name: "Working" },
    ],
  },
  SR: { id: "F-sr" },
};
const issue = (number, labels, title = "x") => ({
  number,
  labels,
  title,
  state: "open",
  node_id: `I${number}`,
});

describe("project sync plan", () => {
  it("writes nothing when the board matches the labels", () => {
    const items = new Map([
      [1, { id: "P1", values: { Stage: "5", Kind: "SR", "Agent state": "Ready", SR: "SR-051" } }],
    ]);
    expect(plan([issue(1, ["sr", "stage:5"], "SR-051 Baseline")], items, fields)).toEqual([]);
  });

  it("writes only the changed field of an item", () => {
    const items = new Map([
      [1, { id: "P1", values: { Stage: "5", Kind: "SR", "Agent state": "Ready", SR: "SR-051" } }],
    ]);
    expect(plan([issue(1, ["sr", "stage:5", "agent:working"], "SR-051 Baseline")], items, fields)).toEqual([
      { op: "set", number: 1, field: "F-state", value: { singleSelectOptionId: "O-work" } },
    ]);
  });

  it("adds a missing issue, sets its values and clears a value whose label is gone", () => {
    const items = new Map([
      [2, { id: "P2", values: { Stage: "5", Kind: "Enabler", "Agent state": "Ready" } }],
    ]);
    const ops = plan([issue(1, ["enabler", "querschnitt"]), issue(2, ["enabler"])], items, fields);
    expect(ops).toEqual([
      { op: "add", issue: issue(1, ["enabler", "querschnitt"]) },
      { op: "set", number: 1, field: "F-stage", value: { singleSelectOptionId: "O-q" } },
      { op: "set", number: 1, field: "F-kind", value: { singleSelectOptionId: "O-en" } },
      { op: "set", number: 1, field: "F-state", value: { singleSelectOptionId: "O-ready" } },
      { op: "clear", number: 2, field: "F-stage" },
    ]);
  });

  it("reads select and text values of an item and skips other field types", () => {
    expect(
      itemValues([{ name: "5", field: { name: "Stage" } }, { text: "SR-051", field: { name: "SR" } }, {}]),
    ).toEqual({ Stage: "5", SR: "SR-051" });
  });
});

describe("project sync retry", () => {
  it("tells transient answers from permanent ones", () => {
    expect(transientStatus(502, "", null)).toBe(true);
    expect(transientStatus(403, "You have exceeded a secondary rate limit", null)).toBe(true);
    expect(transientStatus(403, "Resource not accessible", null)).toBe(false);
    expect(
      transientGraphqlErrors([{ message: "Something went wrong while executing your query on 2026-10-30" }]),
    ).toBe(true);
    expect(transientGraphqlErrors([{ type: "NOT_FOUND", message: "Could not resolve" }])).toBe(false);
  });

  it("retries a transient error until it succeeds and waits at least retry-after", async () => {
    const waits = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw new TransientError("busy", calls === 2 ? 30 : undefined);
        }
        return "ok";
      },
      { delays: [1000, 2000, 4000], sleep: async (ms) => waits.push(ms), log: () => {} },
    );
    expect(result).toBe("ok");
    expect(waits).toEqual([1000, 30_000]);
  });

  it("gives up after the last delay and never retries a permanent error", async () => {
    const opts = { delays: [1], sleep: async () => {}, log: () => {} };
    await expect(withRetry(async () => Promise.reject(new TransientError("down")), opts)).rejects.toThrow(
      "down",
    );
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("invalid");
      }, opts),
    ).rejects.toThrow("invalid");
    expect(calls).toBe(1);
  });
});
