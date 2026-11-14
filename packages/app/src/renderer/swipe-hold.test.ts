// The hold of a swipe's target (SR-212 AK5, `swipe-hold.ts`); on the built app `test/buffer-neighbours.spec.ts`.
import { expect, it } from "vitest";
import { heldIn, holdWhenShown, releaseHold } from "./swipe-hold.js";

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

it("[SR-212/AK-tfck] a held buffer shown with nothing moving toward it is held no longer; while a slide or drag moves, it stays held", () => {
  expect(holdWhenShown(HOLD, "left", "two", false)).toBeUndefined();
  expect(holdWhenShown(HOLD, "left", "two", true)).toBe(HOLD);
  expect(holdWhenShown(HOLD, "left", "one", false)).toBe(HOLD);
  expect(holdWhenShown(HOLD, "right", "two", false)).toBe(HOLD);
  expect(holdWhenShown(undefined, "left", "two", false)).toBeUndefined();
});
