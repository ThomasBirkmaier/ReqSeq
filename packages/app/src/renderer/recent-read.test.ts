// The overview reads its recent elements with element.list, and with element.get only where a list cannot
// answer (#1670, SR-082 AK1, SR-118 AK1).
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

const failed = (code: string): Answer => ({ ok: false, code, message: code });

/** A call that answers element.list by the joined UUIDs from `lists` and element.get by `ref` from `gets`. */
const callWith = (lists: Readonly<Record<string, Answer>>, gets: Readonly<Record<string, Answer>> = {}) => {
  const fn = vi.fn((name: string, input: Record<string, unknown>) => {
    const ids = ((input["selection"] as { ids?: string[] } | undefined)?.ids ?? []).join(",");
    return Promise.resolve(
      name === "element.list"
        ? (lists[ids] ?? failed("ref.unknown"))
        : (gets[String(input["ref"])] ?? failed("ref.unknown")),
    );
  });
  return { fn, call: fn as unknown as Call };
};

const at = (id: string, repository = "system") => ({ id, repository });

describe("readRecent", () => {
  it("reads every recent element with one element.list, without element.get", async () => {
    const { fn, call } = callWith({
      "a,b": { ok: true, output: { elements: [element("a"), element("b", "sensor")] } },
    });
    const reads = await readRecent(call, [at("a"), at("b", "sensor")]);
    expect(fn.mock.calls).toEqual([["element.list", { selection: { ids: ["a", "b"] } }]]);
    expect(reads.get(entryKey(at("b", "sensor")))).toEqual({ ok: true, element: element("b", "sensor") });
    expect(reads.size).toBe(2);
  });

  it("with one element gone lists the others alone, and tells the gone one apart, without element.get", async () => {
    const { fn, call } = callWith({
      a: { ok: true, output: { elements: [element("a")] } },
      gone: failed("ref.unknown"),
    });
    const reads = await readRecent(call, [at("a"), at("gone")]);
    expect(fn.mock.calls.map(([name]) => name)).toEqual(["element.list", "element.list", "element.list"]);
    expect(reads.get(entryKey(at("a")))).toEqual({ ok: true, element: element("a") });
    expect(reads.get(entryKey(at("gone")))).toEqual({ ok: false, code: "ref.unknown" });
  });

  it("reads a UUID in two repositories with element.get in the repository of each entry", async () => {
    const { fn, call } = callWith(
      { a: failed("ref.ambiguous") },
      { a: { ok: true, output: { element: element("a", "display") } } },
    );
    const reads = await readRecent(call, [at("a", "display")]);
    expect(fn.mock.calls.at(-1)).toEqual(["element.get", { ref: "a", repository: "display" }]);
    expect(reads.get(entryKey(at("a", "display")))).toEqual({ ok: true, element: element("a", "display") });
  });

  it("reads an entry the list gave only in another repository with element.get, and keeps its failure", async () => {
    const { call } = callWith(
      { a: { ok: true, output: { elements: [element("a", "system")] } } },
      { a: failed("internal") },
    );
    const reads = await readRecent(call, [at("a", "display")]);
    expect(reads.get(entryKey(at("a", "display")))).toEqual({ ok: false, code: "internal" });
  });

  it("reads nothing without recent elements", async () => {
    const { fn, call } = callWith({});
    expect((await readRecent(call, [])).size).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });
});
