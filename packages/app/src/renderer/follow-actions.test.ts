import { describe, expect, it, vi } from "vitest";
import { ACTIONS, COMMAND_SHORTCUT, FOLLOW_SHORTCUT, actionFor, commandPrompt } from "./actions.js";
import type { ActionContext, FollowControls } from "./actions.js";
import type { Buffers } from "./buffers.js";
import { elementBuffer, graphBuffer, listBuffer, neighbourhoodBuffer, overviewBuffer } from "./buffers.js";
import { matches, shortcutLabel } from "./keys.js";

const controls = (on: boolean): FollowControls => ({ on, start: vi.fn(), stop: vi.fn() });

const context = (
  buffers: Buffers,
  follow: FollowControls | undefined,
  workspace = true,
  mac = false,
): ActionContext => ({
  workspace,
  buffers,
  mac,
  theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
  call: vi.fn(() => new Promise(() => undefined)) as never,
  dispatch: vi.fn(),
  ask: vi.fn(),
  echo: vi.fn(),
  modified: false,
  closeArmed: () => false,
  armClose: vi.fn(),
  discard: vi.fn(),
  drafted: () => false,
  cycleOrder: [],
  cycled: () => undefined,
  leaveEditor: vi.fn(),
  ...(follow === undefined ? {} : { follow }),
});

const action = (id: string) => {
  const found = ACTIONS.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no action ${id}`);
  }
  return found;
};

/** A key press of Ctrl+Shift+O (or Cmd+Shift+O). */
const press = { ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: "O", code: "KeyO" };

const BUFFERS: readonly Buffers[] = [
  [],
  [overviewBuffer()],
  [listBuffer("All elements")],
  [elementBuffer("uuid", "spec", "X")],
  [neighbourhoodBuffer("uuid", "spec", "X")],
  [graphBuffer("uuid", "spec", "X")],
];

describe("Follow agent and Stop following agent (SR-117)", () => {
  it("[SR-117/AK4] only Follow agent and Stop following agent switch the mode, with Ctrl/Cmd+Shift+O and in the command prompt", () => {
    // The only actions that touch the mode's controls.
    for (const candidate of ACTIONS) {
      const off = controls(false);
      const on = controls(true);
      for (const follow of [off, on]) {
        const now = context([elementBuffer("uuid", "spec", "X")], follow);
        if (candidate.available(now)) {
          candidate.run(now);
        }
      }
      const switched =
        vi.mocked(off.start).mock.calls.length +
        vi.mocked(off.stop).mock.calls.length +
        vi.mocked(on.start).mock.calls.length +
        vi.mocked(on.stop).mock.calls.length;
      expect(switched > 0).toBe(["follow-agent", "stop-following-agent"].includes(candidate.id));
    }
    expect(action("follow-agent").title).toBe("Follow agent");
    expect(action("stop-following-agent").title).toBe("Stop following agent");
    expect(FOLLOW_SHORTCUT).toEqual({ mod: true, shift: true, key: "o" });
    // On every buffer, the key turns the mode on, and again off.
    for (const buffers of BUFFERS) {
      const off = controls(false);
      const found = actionFor(context(buffers, off), (shortcut) => matches(press, shortcut, false));
      expect(found?.id).toBe("follow-agent");
      found?.run(context(buffers, off));
      expect(off.start).toHaveBeenCalledTimes(1);
      const on = controls(true);
      const back = actionFor(context(buffers, on), (shortcut) => matches(press, shortcut, false));
      expect(back?.id).toBe("stop-following-agent");
      back?.run(context(buffers, on));
      expect(on.stop).toHaveBeenCalledTimes(1);
      expect(on.start).not.toHaveBeenCalled();
    }
    // macOS (#547): Cmd+Shift+O switches it, the physical Ctrl+Shift+O does not.
    const cmd = { ...press, ctrlKey: false, metaKey: true };
    expect(
      actionFor(context([], controls(false), true, true), (shortcut) => matches(cmd, shortcut, true))?.id,
    ).toBe("follow-agent");
    expect(
      actionFor(context([], controls(false), true, true), (shortcut) => matches(press, shortcut, true)),
    ).toBeUndefined();
    // The command prompt lists the one that applies, with the key as the platform writes it.
    const names = (follow: FollowControls, mac: boolean) =>
      commandPrompt(context([overviewBuffer()], follow, true, mac)).items.filter((item) =>
        /follow.*agent/i.test(item.name),
      );
    expect(names(controls(false), false)).toEqual([
      expect.objectContaining({ name: "Follow agent", hint: "Ctrl+Shift+O" }),
    ]);
    expect(names(controls(true), true)).toEqual([
      expect.objectContaining({ name: "Stop following agent", hint: shortcutLabel(FOLLOW_SHORTCUT, true) }),
    ]);
    expect(shortcutLabel(FOLLOW_SHORTCUT, true)).toBe("⌘⇧O");
    // Not the command prompt's key.
    expect(FOLLOW_SHORTCUT).not.toEqual(COMMAND_SHORTCUT);
  });

  it("is offered only with a workspace and where the window has the mode", () => {
    for (const id of ["follow-agent", "stop-following-agent"]) {
      expect(action(id).available(context([], controls(false), false))).toBe(false);
      expect(action(id).available(context([], controls(true), false))).toBe(false);
      expect(action(id).available(context([], undefined))).toBe(false);
      // Run without the controls: nothing happens.
      expect(() => {
        action(id).run(context([], undefined));
      }).not.toThrow();
    }
  });
});
