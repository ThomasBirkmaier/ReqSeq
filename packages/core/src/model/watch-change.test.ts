import { describe, expect, it } from "vitest";
import type { ElementRecord } from "./elements.js";
import type { ElementStore } from "./store.js";
import { changedElements } from "./watch-change.js";

const A = "00000000-0000-4000-8000-00000000000a";

/** A store without `repositories`: nothing tells which of its records are those of another store. */
const bare = (records: readonly ElementRecord[]): ElementStore => ({
  elements: records,
  byId: new Map(records.map((r) => [r.id, [r]])),
  nonElements: [],
  problems: [],
});

describe("changedElements (#331)", () => {
  it("names nothing for stores without what each file contributed: every element may have changed", () => {
    const record = { id: A } as unknown as ElementRecord;
    expect(changedElements(bare([record]), bare([]))).toBeUndefined();
  });
});
