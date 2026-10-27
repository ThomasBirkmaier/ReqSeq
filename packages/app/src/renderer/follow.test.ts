import { describe, expect, it } from "vitest";
import type { AgentActivity } from "../shared/protocol.js";
import type { Buffers } from "./buffers.js";
import { elementBuffer, listBuffer, overviewBuffer } from "./buffers.js";
import type { FollowState, Hold } from "./follow.js";
import {
  FOLLOW_OFF,
  accessKey,
  followMark,
  holdOf,
  needsLookup,
  onAccess,
  place,
  promptClosed,
  release,
  resetFollowing,
  seen,
  startFollowing,
  stopFollowing,
} from "./follow.js";

const access = (n: number, extra: Partial<AgentActivity> = {}): AgentActivity => ({
  access: "mcp",
  command: "element.get",
  effect: "read",
  at: `2026-10-27T10:00:0${String(n)}.000Z`,
  element: { id: `uuid-${String(n)}`, repository: "spec" },
  ...extra,
});
const buffer = (n: number) =>
  elementBuffer(`uuid-${String(n)}`, "spec", `SR-${String(n)} Title ${String(n)}`);
const key = (n: number): string => buffer(n).key;
const none = (): boolean => false;
const on = (): FollowState => startFollowing(FOLLOW_OFF);
/** Nothing holds an access back. */
const FREE = undefined;
/** A draft holds it. */
const DRAFT: Hold = { draft: true };
/** Only an open prompt holds it. */
const PROMPT: Hold = { draft: false };

describe("follow agent (SR-117)", () => {
  it("[SR-117/AK2] an access while not following changes nothing, and the mode starts off", () => {
    expect(FOLLOW_OFF.on).toBe(false);
    expect(onAccess(FOLLOW_OFF, access(1), FREE)).toEqual({ state: FOLLOW_OFF });
    expect(followMark(FOLLOW_OFF, 0)).toBeUndefined();
    // Turned off again: the view stays as it is, and the next access changes nothing.
    const shown = onAccess(on(), access(1), FREE).state;
    const off = stopFollowing(shown);
    expect(off.on).toBe(false);
    expect(onAccess(off, access(2), FREE)).toEqual({ state: off });
    // A lookup still running when the mode went off shows nothing.
    expect(place(off, shown.generation, access(1), buffer(1), [], FREE, none)).toEqual({
      state: off,
      actions: [],
      refresh: false,
    });
  });

  it("[SR-117/AK1] an access while following switches to its open buffer, else opens it and closes the buffer the mode opened before", () => {
    // Not open: looked up and opened; the mode owns it.
    const first = onAccess(on(), access(1), FREE);
    expect(first.show).toEqual(access(1));
    const buffers: Buffers = [listBuffer("All elements")];
    expect(needsLookup(access(1), buffers)).toBe(true);
    const opened = place(first.state, first.state.generation, access(1), buffer(1), buffers, FREE, none);
    expect(opened.actions).toEqual([{ type: "open", buffer: buffer(1) }]);
    expect(opened.refresh).toBe(false);
    expect(opened.state.opened).toBe(key(1));
    // The next access opens its element and closes the buffer the mode opened before, in one batch.
    const second = onAccess(opened.state, access(2), FREE);
    const afterFirst: Buffers = [buffer(1), listBuffer("All elements")];
    const next = place(second.state, second.state.generation, access(2), buffer(2), afterFirst, FREE, none);
    expect(next.actions).toEqual([
      { type: "open", buffer: buffer(2) },
      { type: "close", key: key(1) },
    ]);
    expect(next.state.opened).toBe(key(2));
    // A read of an element whose buffer is open switches to it without a lookup; that buffer is the user's.
    const third = onAccess(next.state, access(3), FREE);
    const withThree: Buffers = [buffer(2), listBuffer("All elements"), buffer(3)];
    expect(needsLookup(access(3), withThree)).toBe(false);
    const switched = place(third.state, third.state.generation, access(3), undefined, withThree, FREE, none);
    expect(switched.actions).toEqual([
      { type: "switch", key: key(3) },
      { type: "close", key: key(2) },
    ]);
    expect(switched.state.opened).toBeUndefined();
    expect(switched.state.showing).toBe(key(3));
  });

  it("[SR-117/AK1] a change of the shown element asks it again, and a read of it does nothing", () => {
    const write = access(1, { command: "element.update", effect: "write-files" });
    const shown: Buffers = [buffer(1)];
    // A change is always looked up: its name may have changed.
    expect(needsLookup(write, shown)).toBe(true);
    const step = onAccess(on(), write, FREE);
    const placed = place(step.state, step.state.generation, write, buffer(1), shown, FREE, none);
    expect(placed.actions).toEqual([{ type: "open", buffer: buffer(1) }]);
    expect(placed.refresh).toBe(true);
    // A read of the shown element: nothing moves, nothing asks again.
    const later = access(2, { element: write.element });
    const read = onAccess(placed.state, later, FREE);
    const again = place(read.state, read.state.generation, later, undefined, shown, FREE, none);
    expect(again.actions).toEqual([]);
    expect(again.refresh).toBe(false);
  });

  it("keeps the buffer the mode opened when the next access is the same element, and never closes one with a draft", () => {
    const first = onAccess(on(), access(1), FREE);
    const opened = place(first.state, first.state.generation, access(1), buffer(1), [], FREE, none).state;
    // The same element again (a later read): still the mode's buffer.
    const later = access(5, { element: access(1).element });
    const again = onAccess(opened, later, FREE);
    const same = place(again.state, again.state.generation, later, undefined, [buffer(1)], FREE, none);
    expect(same.actions).toEqual([]);
    expect(same.state.opened).toBe(key(1));
    // A draft in it: the buffer stays when the mode moves on.
    const drafted = (candidate: string): boolean => candidate === key(1);
    const next = onAccess(same.state, access(6), FREE);
    const moved = place(next.state, next.state.generation, access(6), buffer(6), [buffer(1)], FREE, drafted);
    expect(moved.actions).toEqual([{ type: "open", buffer: buffer(6) }]);
    // A buffer the mode opened that the user closed is not closed again.
    const gone = onAccess(moved.state, access(7), FREE);
    expect(place(gone.state, gone.state.generation, access(7), buffer(7), [], FREE, none).actions).toEqual([
      { type: "open", buffer: buffer(7) },
    ]);
  });

  it("[SR-117/AK5] with a draft or an open prompt the latest access waits and is shown once the input is saved", () => {
    expect(holdOf(0, false)).toBeUndefined();
    expect(holdOf(1, false)).toEqual(DRAFT);
    expect(holdOf(0, true)).toEqual(PROMPT);
    const held = onAccess(on(), access(1), DRAFT);
    expect(held.show).toBeUndefined();
    expect(held.state.pending).toEqual(access(1));
    expect(followMark(held.state, 1)).toBe("following agent: waits for save");
    // An open prompt holds it too, without words: there is nothing to save.
    expect(followMark(held.state, 0)).toBe("following agent");
    // Only the latest waits.
    const later = onAccess(held.state, access(2), PROMPT);
    expect(later.state.pending).toEqual(access(2));
    // Still held: nothing yet.
    expect(release(later.state, DRAFT, none).show).toBeUndefined();
    // Saved, also after a choice in a prompt meanwhile: a draft held it, so the latest is shown (AK5).
    const released = release(promptClosed(later.state, false), FREE, none);
    expect(released.show).toEqual(access(2));
    expect(released.state.pending).toBeUndefined();
    expect(released.state.shown).toEqual(access(2));
    expect(followMark(released.state, 0)).toBe("following agent");
  });

  it("drops an access that only a prompt held when the user chose something in it (A3); Escape shows it", () => {
    const held = onAccess(on(), access(1), PROMPT);
    expect(held.state.heldOn).toEqual({ draft: false, chosen: false });
    // He chose something in the prompt (a buffer, a command, a filter in place): his choice is newer.
    const chose = promptClosed(held.state, false);
    const dropped = release(chose, FREE, none);
    expect(dropped.show).toBeUndefined();
    expect(dropped.state.pending).toBeUndefined();
    expect(dropped.state.heldOn).toBeUndefined();
    // The dropped access counts as shown: a pull after a restart does not bring it back.
    expect(dropped.state.shown).toEqual(access(1));
    expect(onAccess(dropped.state, access(1), FREE).show).toBeUndefined();
    // Closed with Escape: the access is shown.
    expect(release(promptClosed(held.state, true), FREE, none).show).toEqual(access(1));
    // A prompt that asks the next argument keeps the hold; only the last close counts.
    const asking = release(chose, PROMPT, none).state;
    expect(asking.heldOn).toEqual({ draft: false, chosen: true });
    expect(release(promptClosed(asking, true), FREE, none).show).toEqual(access(1));
    // A newer access after the choice is not dropped for it.
    const newer = onAccess(asking, access(3), PROMPT).state;
    expect(newer.heldOn).toEqual({ draft: false, chosen: false });
    expect(release(promptClosed(newer, true), FREE, none).show).toEqual(access(3));
    // A draft that came while the prompt was open counts: shown after the save, whatever was chosen.
    const drafted = release(held.state, DRAFT, none).state;
    expect(drafted.heldOn).toEqual({ draft: true, chosen: false });
    expect(release(promptClosed(drafted, false), FREE, none).show).toEqual(access(1));
    // Nothing held: a closed prompt changes nothing.
    expect(promptClosed(on(), false)).toEqual(on());
    // A held access without its record of what held it is shown, and is held again by input.
    expect(release({ ...on(), pending: access(2) }, FREE, none).show).toEqual(access(2));
    expect(release({ ...on(), pending: access(2) }, PROMPT, none).state.heldOn).toEqual({
      draft: false,
      chosen: false,
    });
  });

  it("[SR-117/AK5] input that comes while the element is looked up holds it back", () => {
    const step = onAccess(on(), access(1), FREE);
    const held = place(step.state, step.state.generation, access(1), buffer(1), [], DRAFT, none);
    expect(held.actions).toEqual([]);
    expect(held.state.pending).toEqual(access(1));
    // A newer access held meanwhile stays the one that waits.
    const newer = { ...step.state, pending: access(2) };
    expect(place(newer, newer.generation, access(1), buffer(1), [], DRAFT, none).state.pending).toEqual(
      access(2),
    );
  });

  it("drops an access that is not newer than the one shown or held, and a lookup a newer one replaced", () => {
    const first = onAccess(on(), access(2), FREE);
    // The same access again (the pull when the mode is turned on, and its event) and an older one.
    expect(onAccess(first.state, access(2), FREE)).toEqual({ state: first.state });
    expect(onAccess(first.state, access(1), FREE)).toEqual({ state: first.state });
    const held = onAccess(first.state, access(3), DRAFT);
    expect(onAccess(held.state, access(3), DRAFT)).toEqual({ state: held.state });
    // At the same time, another element is another access.
    expect(
      onAccess(first.state, access(2, { element: { id: "uuid-9", repository: "spec" } }), FREE).show,
    ).toBeDefined();
    expect(onAccess(first.state, access(2, { command: "element.update" }), FREE).show).toBeDefined();
    expect(
      onAccess(first.state, access(2, { element: { id: "uuid-2", repository: "other" } }), FREE).show,
    ).toBeDefined();
    // A lookup of the first, answered after the second was shown, does nothing.
    const second = onAccess(first.state, access(4), FREE);
    expect(place(second.state, first.state.generation, access(2), buffer(2), [], FREE, none)).toEqual({
      state: second.state,
      actions: [],
      refresh: false,
    });
  });

  it("turning the mode on starts afresh; another workspace ends it", () => {
    const shown = onAccess(on(), access(1), FREE).state;
    const placed = place(shown, shown.generation, access(1), buffer(1), [], FREE, none).state;
    const off = stopFollowing(placed);
    // The buffer the mode opened is the user's once the mode is off; the shown one is still being shown.
    expect(off.opened).toBeUndefined();
    expect(off.showing).toBe(key(1));
    const again = startFollowing(off);
    expect(again.on).toBe(true);
    expect(again.shown).toBeUndefined();
    expect(again.generation).toBeGreaterThan(off.generation);
    // The access shown before is shown again when `workspace.activity` gives it (Q3).
    expect(onAccess(again, access(1), FREE).show).toEqual(access(1));
    expect(startFollowing(FOLLOW_OFF).showing).toBeUndefined();
    expect(stopFollowing(on()).showing).toBeUndefined();
    const reset = resetFollowing(placed);
    expect(reset).toEqual({ on: false, generation: placed.generation + 1 });
  });

  it("tells which shown buffer the mode put there, and makes the mode's buffer the user's when he shows or types in it", () => {
    const step = onAccess(on(), access(1), FREE);
    const placed = place(
      step.state,
      step.state.generation,
      access(1),
      buffer(1),
      [overviewBuffer()],
      FREE,
      none,
    );
    expect(placed.state.showing).toBe(key(1));
    // The app shows it: the mode's doing, no recent element.
    const shown = seen(placed.state, key(1));
    expect(shown.byMode).toBe(true);
    expect(shown.state.showing).toBeUndefined();
    expect(shown.state.opened).toBe(key(1));
    // The user goes elsewhere: still the mode's buffer.
    const elsewhere = seen(shown.state, "overview");
    expect(elsewhere).toEqual({ state: shown.state, byMode: false });
    expect(seen(shown.state, undefined)).toEqual({ state: shown.state, byMode: false });
    // And back himself: now it is his.
    const back = seen(elsewhere.state, key(1));
    expect(back.byMode).toBe(false);
    expect(back.state.opened).toBeUndefined();
    // A draft in the mode's buffer makes it his too.
    const drafted = release(shown.state, DRAFT, (candidate) => candidate === key(1));
    expect(drafted.state.opened).toBeUndefined();
    expect(release(FOLLOW_OFF, FREE, none)).toEqual({ state: FOLLOW_OFF });
  });

  it("names the element buffer of an access", () => {
    expect(accessKey(access(1))).toBe("element:spec:uuid-1");
  });
});
