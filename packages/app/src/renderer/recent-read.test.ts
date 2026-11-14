// The overview reads its recent elements with one element.list, and with element.get only where the list
// cannot answer (#1670, SR-082 AK1, SR-118 AK1).
import { describe, expect, it, vi } from "vitest";
import type { Call } from "./call.js";
import { entryKey, readRecent } from "./recent-read.js";

const element = (id: string, repository = "system") => ({
  id,
  repository,
  shortId: `SR-${id}`,
  identifier: `SR-0${id}`,
  title: `Title ${id}`,
  type: "system-requirement",
});

type Answer = { ok: true; output: unknown } | { ok: false; code: string; message: string };

/** A call that answers element.list with `list` and element.get by `ref` from `gets`. */
const callWith = (list: Answer, gets: Readonly<Record<string, Answer>> = {}) => {
  const fn = vi.fn((name: string, input: Record<string, unknown>) =>
    Promise.resolve(
      name === "element.list"
        ? list
        : (gets[String(input["ref"])] ?? { ok: false, code: "ref.unknown", message: "unknown" }),
    ),
  );
  return { fn, call: fn as unknown as Call };
};

describe("readRecent", () => {
  it("reads every recent element with one element.list, without element.get", async () => {
    const { fn, call } = callWith({ ok: true, output: { elements: [element("a"), element("b", "sensor")] } });
    const reads = await readRecent(call, [
      { id: "a", repository: "system" },
      { id: "b", repository: "sensor" },
    ]);
    expect(fn.mock.calls).toEqual([["element.list", { selection: { ids: ["a", "b"] } }]]);
    expect(reads.get(entryKey({ id: "b", repository: "sensor" }))).toEqual({
      ok: true,
      element: element("b", "sensor"),
    });
    expect(reads.size).toBe(2);
  });

  it("reads each with element.get when the list fails, telling a gone element from the others", async () => {
    const { fn, call } = callWith(
      { ok: false, code: "ref.unknown", message: "unknown" },
      { a: { ok: true, output: { element: element("a") } } },
    );
    const reads = await readRecent(call, [
      { id: "a", repository: "system" },
      { id: "gone", repository: "system" },
    ]);
    expect(fn.mock.calls.slice(1)).toEqual([
      ["element.get", { ref: "a", repository: "system" }],
      ["element.get", { ref: "gone", repository: "system" }],
    ]);
    expect(reads.get(entryKey({ id: "a", repository: "system" }))).toEqual({
      ok: true,
      element: element("a"),
    });
    expect(reads.get(entryKey({ id: "gone", repository: "system" }))).toEqual({
      ok: false,
      code: "ref.unknown",
    });
  });

  it("reads an entry the list did not give with element.get in its repository", async () => {
    const { fn, call } = callWith(
      { ok: true, output: { elements: [element("a", "system")] } },
      { a: { ok: true, output: { element: element("a", "display") } } },
    );
    const reads = await readRecent(call, [
      { id: "a", repository: "system" },
      { id: "a", repository: "display" },
    ]);
    expect(fn.mock.calls).toEqual([
      ["element.list", { selection: { ids: ["a"] } }],
      ["element.get", { ref: "a", repository: "display" }],
    ]);
    expect(reads.size).toBe(2);
  });

  it("reads nothing without recent elements", async () => {
    const { fn, call } = callWith({ ok: true, output: { elements: [] } });
    expect((await readRecent(call, [])).size).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });
});
