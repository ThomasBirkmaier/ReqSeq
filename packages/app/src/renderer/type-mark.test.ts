// The type mark (SR-215 AK5), which the condition prompt and "Filter list" share.
import { describe, expect, it, vi } from "vitest";
import type { Prompt } from "./actions.js";
import type { Call } from "./call.js";
import type { TypeAsk } from "./type-mark.js";
import { askTypes, takeTypesName, typeKeysOf, typeMark, typeMarkAt } from "./type-mark.js";

const METAMODEL = {
  types: [
    { key: "need", name: "Need" },
    { key: "decision", name: "Decision" },
    { key: "Use", name: "Use" },
  ],
};

/** A type step that asks into `asked`, with metamodel.get answering `answer`. */
const step = (answer: unknown, extra: Partial<TypeAsk> = {}) => {
  const asked: Prompt[] = [];
  const call = vi.fn((name: string) =>
    Promise.resolve(
      answer instanceof Error
        ? { ok: false, message: answer.message }
        : { ok: true, output: name === "metamodel.get" ? answer : {} },
    ),
  ) as unknown as Call;
  const take = vi.fn();
  const back = vi.fn();
  const ask: TypeAsk = {
    ask: (prompt) => asked.push(prompt),
    call,
    label: "Type:",
    keys: [],
    marks: (keys) => (keys.length === 0 ? [] : [{ label: typeMark(keys).label, remove: () => undefined }]),
    take,
    back,
    ...extra,
  };
  return { asked, ask, take, back };
};

/** The prompt with its parts filled in, as the command prompt shows them once they are read. */
const filled = async (prompt: Prompt | undefined): Promise<Prompt> => {
  if (prompt === undefined) {
    throw new Error("nothing asked");
  }
  return { ...prompt, ...(await prompt.fill) };
};

describe("the type mark (SR-215 AK5)", () => {
  it("[SR-215/AK-w8q6] labels the types by their keys separated by commas and selects the elements of one of them", () => {
    expect(typeMark(["need", "decision"])).toEqual({
      label: "type: need, decision",
      condition: { type: ["need", "decision"] },
    });
    expect(takeTypesName(1)).toBe("Take 1 type");
    expect(takeTypesName(2)).toBe("Take 2 types");
  });

  it("knows a type mark by its condition: type alone, with keys", () => {
    expect(typeKeysOf({ type: ["need"] })).toEqual(["need"]);
    expect(typeKeysOf({ type: ["need"], subtypes: false })).toBeUndefined();
    expect(typeKeysOf({ type: [] })).toBeUndefined();
    expect(typeKeysOf({ type: [1] })).toBeUndefined();
    expect(typeKeysOf({ type: "need" })).toBeUndefined();
    expect(typeKeysOf([{ type: ["need"] }])).toBeUndefined();
    expect(typeKeysOf(null)).toBeUndefined();
    expect(typeKeysOf("{a")).toBeUndefined();
    const status = { label: "status: draft", condition: { status: ["draft"] } };
    expect(typeMarkAt([status, typeMark(["need"]), typeMark(["decision"])])).toBe(1);
    expect(typeMarkAt([status])).toBe(-1);
  });

  it("[SR-215/AK-w8q6] adds a chosen type and stays; Take N types comes first and takes the keys; back keeps them", async () => {
    const { asked, ask, take, back } = step(METAMODEL);
    askTypes(ask);
    const first = await filled(asked[0]);
    expect(first.items.map((choice) => [choice.name, choice.hint])).toEqual([
      ["Need", "need"],
      ["Decision", "decision"],
      ["Use", undefined],
    ]);
    // Without an explanation line given, the step has none.
    expect(first.explain).toBeUndefined();
    first.items[1]?.run();
    const second = await filled(asked[1]);
    expect(second.marks?.map((mark) => mark.label)).toEqual(["type: decision"]);
    // Nothing is marked before the types are read: "Take 1 type" comes with them.
    expect(asked[1]?.items).toEqual([]);
    expect(second.items.map((choice) => choice.name)).toEqual(["Take 1 type", "Need", "Use"]);
    second.items[0]?.run();
    expect(take).toHaveBeenCalledWith(["decision"]);
    second.back?.();
    expect(back).toHaveBeenCalledWith(["decision"]);
  });

  it("says why the types cannot be read", async () => {
    const { asked, ask } = step(new Error("The metamodel is faulty"), { keys: ["need"] });
    askTypes(ask);
    const failed = await asked[0]?.fill;
    expect(failed?.label).toBe("The metamodel is faulty · Type:");
    // The mark can still be taken.
    expect(failed?.items?.map((choice) => choice.name)).toEqual(["Take 1 type"]);
  });
});
