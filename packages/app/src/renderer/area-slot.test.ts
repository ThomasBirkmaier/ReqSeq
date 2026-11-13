// @vitest-environment happy-dom
// The layers of an area that hold a view (SR-212 AK5): when the reads of a hidden view may go, what it holds
// back until it is shown, and what it does when it is shown.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeldCalls, ReadGate, SlotContext, drawnBy, useHidden, useReveal } from "./area-slot.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Whether `promise` settled by now. */
const settled = async (promise: Promise<void>): Promise<boolean> => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

describe("the gate of the reads drawn in advance", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[SR-212/AK-tfck] opens once the shown buffer reported its drawing, closes for the next one, and stays closed while a slide runs", async () => {
    const gate = new ReadGate(1000);
    const first = gate.pass();
    expect(await settled(first)).toBe(false);
    gate.show("a", false);
    gate.drawn("other");
    expect(await settled(first)).toBe(false);
    gate.drawn("a");
    expect(gate.open).toBe(true);
    expect(await settled(first)).toBe(true);
    expect(await settled(gate.pass())).toBe(true);
    // The same buffer shown again keeps it open; another one closes it until it is drawn.
    gate.show("a", false);
    expect(gate.open).toBe(true);
    gate.show("b", false);
    const second = gate.pass();
    gate.slide(true);
    gate.drawn("b");
    gate.drawn("b");
    expect(await settled(second)).toBe(false);
    gate.slide(false);
    expect(await settled(second)).toBe(true);
    // A buffer drawn in advance is drawn when it is shown.
    gate.show("c", true);
    expect(gate.open).toBe(true);
    gate.dispose();
  });

  it("[SR-212/AK-tfck] lets nothing through when a slide ends and the next starts in the same task, as a held Alt+P does", async () => {
    const gate = new ReadGate(1000);
    gate.show("a", true);
    gate.slide(true);
    const waiting = gate.pass();
    gate.slide(false);
    gate.slide(true);
    expect(await settled(waiting)).toBe(false);
    gate.slide(false);
    expect(await settled(waiting)).toBe(true);
    gate.dispose();
  });

  it("[SR-212/AK-tfck] stays closed while a prompt is open, where the reader may choose the next buffer", async () => {
    const gate = new ReadGate(1000);
    gate.show("a", true);
    gate.prompt(true);
    expect(gate.open).toBe(false);
    const waiting = gate.pass();
    expect(await settled(waiting)).toBe(false);
    gate.prompt(false);
    expect(await settled(waiting)).toBe(true);
    gate.dispose();
  });

  it("[SR-212/AK-tfck] opens after the deadline when the shown buffer never reports", async () => {
    vi.useFakeTimers();
    const gate = new ReadGate(1000);
    gate.show("a", false);
    const waiting = gate.pass();
    vi.advanceTimersByTime(999);
    expect(await settled(waiting)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await settled(waiting)).toBe(true);
    // Disposed, nothing waits for a deadline any more.
    gate.show("b", false);
    gate.dispose();
    vi.advanceTimersByTime(1000);
    expect(gate.open).toBe(false);
  });
});

describe("what a hidden view holds back", () => {
  it("[SR-212/AK-tfck] runs its actions in order and says its last message once it is shown", () => {
    const held = new HeldCalls();
    const done: string[] = [];
    held.hold(() => done.push("rename"));
    held.hold(() => done.push("gone"));
    held.say("first");
    held.say("last");
    const said: string[] = [];
    held.flush((message) => said.push(message));
    expect(done).toEqual(["rename", "gone"]);
    expect(said).toEqual(["last"]);
    held.flush((message) => said.push(message));
    expect(said).toEqual(["last"]);
  });

  it("counts data without rows as drawn; a list says so itself", () => {
    expect(drawnBy(undefined)).toBe(false);
    expect(drawnBy({ kind: "neighbourhood", incomplete: false })).toBe(true);
    expect(drawnBy({ kind: "list", total: 0, incomplete: false, rows: [] })).toBe(false);
  });
});

describe("a view shown after it was drawn in advance", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
  });

  it("[SR-212/AK-tfck] knows it is hidden, and runs its reveal once when it is shown, not at a mount that is shown", () => {
    const revealed: boolean[] = [];
    const View = (): null => {
      const hidden = useHidden();
      useReveal(() => revealed.push(hidden));
      return null;
    };
    const container = document.createElement("div");
    root = createRoot(container);
    const show = (hidden: boolean): void => {
      act(() =>
        root?.render(createElement(SlotContext.Provider, { value: { hidden } }, createElement(View))),
      );
    };
    show(false);
    expect(revealed).toEqual([]);
    act(() => root?.unmount());
    root = createRoot(container);
    show(true);
    show(true);
    expect(revealed).toEqual([]);
    show(false);
    show(false);
    expect(revealed).toEqual([false]);
  });
});
