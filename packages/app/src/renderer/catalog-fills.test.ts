// The typed text of an element argument of the command prompt (`catalog-fills.ts`): a criterion reference
// that element.resolve resolves is named by its requirement and criterion, and the requirement is listed once.
import { describe, expect, it, vi } from "vitest";
import type { ActionContext, Choice } from "./action-types.js";
import type { Call } from "./call.js";
import { withTypedReference } from "./catalog-fills.js";

const choice = (id: string, name: string): Choice => ({ id, name, run: vi.fn() });

/** A context whose element.resolve gives `output`, or fails with `message`. */
const contextOf = (answer: { output: unknown } | { message: string }) => {
  const call = vi.fn(() =>
    Promise.resolve(
      "output" in answer
        ? { ok: true, output: answer.output }
        : { ok: false, code: "input.invalid", message: answer.message },
    ),
  );
  return { context: { call: call as unknown as Call } as Pick<ActionContext, "call">, call };
};

const resolved = {
  element: { id: "u1", repository: "spec", shortId: "SR-000001", identifier: "SR-036", title: "Wind" },
  criterion: { criterion: 2, key: "k7f3", text: "Given a gust.", reference: "[SR-036/AK-k7f3]" },
  current: null,
};

describe("withTypedReference", () => {
  const hits = [
    choice("element:spec:u1", "SR-000001 (SR-036) Wind"),
    choice("element:spec:u7", "SR-000007 Gust"),
  ];

  it("[SR-222/AK-znd8] names the requirement of a resolved criterion reference with the criterion's number and text, and lists it once", async () => {
    const { context, call } = contextOf({ output: resolved });
    const take = vi.fn();
    const found = await withTypedReference(context, () => Promise.resolve(hits), take)(" [SR-036/AK-k7f3] ");
    expect(call).toHaveBeenCalledWith("element.resolve", { ref: "[SR-036/AK-k7f3]" });
    expect(found.map((entry) => [entry.id, entry.name])).toEqual([
      ["reference:[SR-036/AK-k7f3]", "SR-000001 (SR-036) Wind · AK2 (k7f3) · Given a gust."],
      ["element:spec:u7", "SR-000007 Gust"],
    ]);
    // It takes the reference, which element.resolve reads; Ctrl/Cmd+Enter takes it with more arguments.
    found[0]?.run();
    found[0]?.more?.();
    expect(take.mock.calls).toEqual([
      ["[SR-036/AK-k7f3]", false],
      ["[SR-036/AK-k7f3]", true],
    ]);
  });

  it("[SR-222/AK-znd8] offers the reference as typed beside every hit when element.resolve does not resolve it to a criterion", async () => {
    const take = vi.fn();
    for (const answer of [
      { message: "SR-036 has no criterion zzzz" },
      { output: { element: resolved.element, current: null } },
    ]) {
      const { context } = contextOf(answer);
      const found = await withTypedReference(context, () => Promise.resolve(hits), take)("SR-036/AK-zzzz");
      expect(found.map((entry) => entry.name)).toEqual([
        "Use SR-036/AK-zzzz",
        ...hits.map((hit) => hit.name),
      ]);
    }
  });

  it("asks element.resolve nothing for other text, a reference by number, or an argument that takes no reference", async () => {
    const { context, call } = contextOf({ output: resolved });
    expect(await withTypedReference(context, () => Promise.resolve(hits), vi.fn())("wind")).toEqual(hits);
    expect(
      await withTypedReference(context, () => Promise.resolve(hits), undefined)("[SR-036/AK-k7f3]"),
    ).toEqual(hits);
    expect(call).not.toHaveBeenCalled();
    // A reference by number is taken as typed, and core refuses it when it runs.
    const byNumber = await withTypedReference(context, () => Promise.resolve(hits), vi.fn())("[SR-036/AK2]");
    expect(byNumber.map((entry) => entry.name)).toEqual(["Use [SR-036/AK2]", ...hits.map((hit) => hit.name)]);
    expect(call).not.toHaveBeenCalled();
  });
});
