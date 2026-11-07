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
  Category: {
    id: "F-type",
    options: [
      { id: "O-task", name: "Task" },
      { id: "O-bug", name: "Bug" },
    ],
  },
  Area: {
    id: "F-area",
    options: [
      { id: "O-core", name: "Core" },
      { id: "O-cli", name: "CLI" },
    ],
  },
  "Agent state": {
    id: "F-state",
    options: [
      { id: "O-ready", name: "Ready" },
      { id: "O-work", name: "Working" },
      { id: "O-human", name: "Needs human" },
    ],
  },
  Note: { id: "F-note" },
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
      [1, { id: "P1", values: { Category: "Task", Area: "Core", "Agent state": "Ready" } }],
    ]);
    expect(plan([issue(1, ["task", "core"])], items, fields)).toEqual([]);
  });

  it("writes only the changed field of an item", () => {
    const items = new Map([
      [1, { id: "P1", values: { Category: "Task", Area: "Core", "Agent state": "Ready" } }],
    ]);
    expect(plan([issue(1, ["task", "core", "agent:working"])], items, fields)).toEqual([
      { op: "set", number: 1, field: "F-state", value: { singleSelectOptionId: "O-work" } },
    ]);
  });

  it("adds a missing issue, sets its values and clears a value whose label is gone", () => {
    const items = new Map([
      [2, { id: "P2", values: { Category: "Bug", Area: "CLI", "Agent state": "Ready" } }],
    ]);
    const ops = plan([issue(1, [{ name: "bug" }, "cli", "needs-human"]), issue(2, ["bug"])], items, fields);
    expect(ops).toEqual([
      { op: "add", issue: issue(1, [{ name: "bug" }, "cli", "needs-human"]) },
      { op: "set", number: 1, field: "F-type", value: { singleSelectOptionId: "O-bug" } },
      { op: "set", number: 1, field: "F-area", value: { singleSelectOptionId: "O-cli" } },
      { op: "set", number: 1, field: "F-state", value: { singleSelectOptionId: "O-human" } },
      { op: "clear", number: 2, field: "F-area" },
    ]);
  });

  it("shows an epic as Epic whatever type label it also has", () => {
    const f = {
      Category: { id: "F-type", options: [{ id: "O-epic", name: "Epic" }, ...fields.Category.options] },
    };
    expect(plan([issue(1, ["bug", "epic"])], new Map([[1, { id: "P1", values: {} }]]), f)).toEqual([
      { op: "set", number: 1, field: "F-type", value: { singleSelectOptionId: "O-epic" } },
    ]);
  });

  it("skips a value without an option and writes a text field", () => {
    const f = { Category: fields.Category, Priority: { id: "F-prio" } };
    expect(plan([issue(1, ["feature", "P2"])], new Map([[1, { id: "P1", values: {} }]]), f)).toEqual([
      { op: "set", number: 1, field: "F-prio", value: { text: "P2" } },
    ]);
  });

  it("sets the built-in Status from the state and the priority from its label", () => {
    const f = {
      Status: { id: "F-status", options: ["Todo", "In Progress", "Done"].map((n) => ({ id: n, name: n })) },
      Priority: { id: "F-prio", options: [{ id: "O-p1", name: "P1" }] },
      Category: fields.Category,
    };
    const closed = { ...issue(2, ["epic"]), state: "closed" };
    const ops = plan(
      [issue(1, ["agent:working", "P1"]), closed],
      new Map([
        [1, { id: "P1", values: {} }],
        [2, { id: "P2", values: { Category: "Epic" } }],
      ]),
      f,
    );
    expect(ops).toEqual([
      { op: "set", number: 1, field: "F-status", value: { singleSelectOptionId: "In Progress" } },
      { op: "set", number: 1, field: "F-prio", value: { singleSelectOptionId: "O-p1" } },
      { op: "set", number: 2, field: "F-status", value: { singleSelectOptionId: "Done" } },
    ]);
  });

  it("reads select and text values of an item and skips other field types", () => {
    expect(
      itemValues([{ name: "Task", field: { name: "Category" } }, { text: "x", field: { name: "Note" } }, {}]),
    ).toEqual({
      Category: "Task",
      Note: "x",
    });
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
