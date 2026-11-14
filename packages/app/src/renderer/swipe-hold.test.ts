// The hold of a swipe's target (SR-212 AK5, `swipe-hold.ts`); on the built app `test/buffer-swipe.spec.ts`.
import { expect, it } from "vitest";
import { heldIn, releaseHold } from "./swipe-hold.js";

const HOLD = { side: "left", key: "two" };

it("an end releases the hold only of its own key: a late end of an earlier switch keeps a later hold", () => {
  expect(releaseHold(HOLD, "two")).toBeUndefined();
  expect(releaseHold(HOLD, "one")).toBe(HOLD);
  expect(releaseHold(HOLD, undefined)).toBe(HOLD);
  expect(releaseHold(undefined, "two")).toBeUndefined();
});

it("only the area of the drag holds the target (SR-211 AK9)", () => {
  expect(heldIn(HOLD, "left")).toBe("two");
  expect(heldIn(HOLD, "right")).toBeUndefined();
  expect(heldIn(undefined, "left")).toBeUndefined();
});
