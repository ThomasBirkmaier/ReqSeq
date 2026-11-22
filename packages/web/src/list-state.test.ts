import { describe, expect, it } from "vitest";
import {
  EMPTY,
  allOf,
  changesList,
  isPicked,
  parseState,
  pickConditions,
  queryOf,
  stateParams,
  toggle,
  withoutPicks,
} from "./list-state.js";

describe("list state", () => {
  it("reads picks, sort, group and query from the parameters, and writes them back", () => {
    const params = new URLSearchParams(
      "q=brake&type=req&type=req&status=draft&p.prio=%22high%22&p.prio=null&p.size=3&sort=title&order=desc&group=status&other=1",
    );
    const state = parseState(params);
    expect([...state.picks]).toEqual([
      ["type", ["req"]],
      ["status", ["draft"]],
      ["p.prio", ["high", null]],
      ["p.size", [3]],
    ]);
    expect(state.sort).toEqual({ by: "title", order: "desc" });
    expect(state.group).toBe("status");
    expect(state.query).toBe("brake");
    expect(stateParams(state).toString()).toBe(
      "q=brake&type=req&status=draft&p.prio=%22high%22&p.prio=null&p.size=3&sort=title&order=desc&group=status",
    );
  });

  it("keeps a property value that is not JSON as text, and leaves out blanks", () => {
    const state = parseState(new URLSearchParams("p.x=plain&p.y=%5B1%5D&p.=1&sort=&q=%20"));
    expect([...state.picks]).toEqual([
      ["p.x", ["plain"]],
      ["p.y", ["[1]"]],
    ]);
    expect(state.sort).toBeUndefined();
    expect(state.query).toBeUndefined();
    expect(queryOf(EMPTY)).toBe("");
    expect(queryOf({ ...EMPTY, sort: { by: "id", order: "asc" } })).toBe("?sort=id");
  });

  it("toggles a value on and off", () => {
    const one = toggle(EMPTY, "status", "draft");
    expect(isPicked(one, "status", "draft")).toBe(true);
    const two = toggle(one, "status", "approved");
    expect(two.picks.get("status")).toEqual(["draft", "approved"]);
    const back = toggle(toggle(two, "status", "draft"), "status", "approved");
    expect(back.picks.size).toBe(0);
    expect(changesList(back)).toBe(false);
    expect(changesList(two)).toBe(true);
    expect(withoutPicks(two).picks.size).toBe(0);
  });

  it("builds one condition per facet, and leaves one out on request", () => {
    const state = parseState(new URLSearchParams("type=a&status=s&p.k=1&p.k=null&p.m=null&p.n=%22x%22"));
    expect(pickConditions(state)).toEqual([
      { type: ["a"], subtypes: false },
      { status: ["s"] },
      {
        any: [
          { property: "k", op: "in", value: [1] },
          { property: "k", op: "missing" },
        ],
      },
      { property: "m", op: "missing" },
      { property: "n", op: "in", value: ["x"] },
    ]);
    expect(pickConditions(state, "status")).toHaveLength(4);
  });

  it("joins conditions", () => {
    expect(allOf([])).toEqual({ all: [] });
    expect(allOf([undefined, { status: ["s"] }])).toEqual({ status: ["s"] });
    expect(allOf([{ status: ["s"] }, { invalid: false }])).toEqual({
      all: [{ status: ["s"] }, { invalid: false }],
    });
  });
});
