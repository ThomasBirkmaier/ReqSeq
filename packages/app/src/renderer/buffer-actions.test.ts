import { describe, expect, it, vi } from "vitest";
import { actionFor, commandPrompt, runAction } from "./actions.js";
import { NEXT_BUFFER_SHORTCUT, PREVIOUS_BUFFER_SHORTCUT } from "./buffer-actions.js";
import type { Prompt } from "./action-types.js";
import type { BufferAction, Buffers } from "./buffers.js";
import { elementBuffer, overviewBuffer, searchBuffer } from "./buffers.js";
import { matches, shortcutLabel } from "./keys.js";
import { rank } from "./fuzzy.js";
import { flush, setup, action, list, filtered, element, titles } from "./actions.test-helper.js";

describe("close buffer", () => {
  it("closes the shown buffer, and does nothing without one", () => {
    const { context, dispatched } = setup([element, list]);
    action("close").run(context);
    expect(dispatched).toEqual([{ type: "close", key: element.key }]);
    const none = setup([]);
    action("close").run(none.context);
    expect(none.dispatched).toEqual([]);
  });
});

describe("close buffer with unsaved changes", () => {
  it("asks once, with the key that saves, and discards and closes when closing is repeated", () => {
    const first = setup([element, list], {}, true, { modified: true });
    action("close").run(first.context);
    expect(first.dispatched).toEqual([]);
    expect(first.armed).toEqual([element.key]);
    expect(first.echoed).toEqual([
      "SR-036 Title has unsaved changes: Ctrl+S saves them, closing again discards them",
    ]);
    const again = setup([element, list], {}, true, { modified: true, closeArmed: () => true });
    action("close").run(again.context);
    expect(again.discarded).toEqual([element.key]);
    expect(again.dispatched).toEqual([{ type: "close", key: element.key }]);
    const mac = setup([element], {}, true, { modified: true, mac: true });
    action("close").run(mac.context);
    expect(mac.echoed[0]).toContain("⌘S saves them");
  });

  it("[SR-105/AK-p4gn] saves the input first and closes; asks once only when it could not be saved", async () => {
    const saved = setup([element, list], {}, true, {
      modified: true,
      saveDraft: () => Promise.resolve(true),
    });
    action("close").run(saved.context);
    expect(saved.dispatched).toEqual([]);
    await flush();
    expect(saved.dispatched).toEqual([{ type: "close", key: element.key }]);
    expect(saved.echoed).toEqual([]);
    const refused = setup([element, list], {}, true, {
      modified: true,
      saveDraft: () => Promise.resolve(false),
    });
    action("close").run(refused.context);
    await flush();
    expect(refused.dispatched).toEqual([]);
    expect(refused.armed).toEqual([element.key]);
    expect(refused.echoed).toEqual([
      "SR-036 Title has unsaved changes that were not saved: closing again discards them",
    ]);
  });

  it("any other action ends the question", () => {
    const { context, armed } = setup([element, list]);
    runAction(action("search"), context);
    runAction(action("close"), context);
    expect(armed).toEqual([undefined]);
  });
});

describe("close all buffers", () => {
  const other = elementBuffer("u2", "spec", "SR-037 Other");
  const closes = (dispatched: BufferAction[]): BufferAction[] =>
    dispatched.filter((entry) => entry.type === "close");
  const choices = (prompt: Prompt | undefined) => {
    if (prompt === undefined) {
      throw new Error("nothing was asked");
    }
    return prompt.items;
  };

  it("[SR-123/AK-grm4] closes every open buffer and says so", () => {
    const { context, dispatched, discarded, echoed, asked } = setup([element, other, list]);
    action("close-all").run(context);
    expect(closes(dispatched)).toEqual([
      { type: "close", key: element.key },
      { type: "close", key: other.key },
      { type: "close", key: list.key },
    ]);
    expect(discarded).toEqual([element.key, other.key, list.key]);
    expect(echoed).toEqual(["Closed 3 buffers"]);
    expect(asked).toEqual([]);
    const one = setup([list]);
    action("close-all").run(one.context);
    expect(one.echoed).toEqual(["Closed 1 buffer"]);
  });

  it("[SR-123/AK-xbx2] with unsaved text it asks in the minibuffer: keep the unsaved buffers, or discard and close all", () => {
    const drafted = (key: string): boolean => key === other.key;
    const { context, dispatched, discarded, echoed, asked } = setup([element, other, list], {}, true, {
      drafted,
    });
    action("close-all").run(context);
    // Nothing is closed before a choice; the question is in the minibuffer, not a dialog.
    expect(dispatched).toEqual([]);
    expect(echoed).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.label).toBe("1 buffer with unsaved changes (SR-037 Other)");
    expect(choices(asked[0]).map((item) => item.name)).toEqual([
      "Close all but the buffers with unsaved changes",
      "Close all and discard the unsaved changes",
    ]);
    // The first choice is the one Enter takes: it keeps the unsaved text.
    choices(asked[0])[0]?.run();
    expect(closes(dispatched)).toEqual([
      { type: "close", key: element.key },
      { type: "close", key: list.key },
    ]);
    expect(discarded).toEqual([element.key, list.key]);
    expect(echoed).toEqual(["Closed 2 buffers"]);
    choices(asked[0])[1]?.run();
    expect(closes(dispatched).slice(2)).toEqual([
      { type: "close", key: element.key },
      { type: "close", key: other.key },
      { type: "close", key: list.key },
    ]);
    expect(discarded.slice(2)).toEqual([element.key, other.key, list.key]);
    expect(echoed.at(-1)).toBe("Closed 3 buffers");
  });

  it("[SR-105/AK-p4gn] [SR-123/AK-xbx2] saves the unsaved text first; closes all when it is saved, and asks only about what could not be", async () => {
    const drafted = (key: string): boolean => key !== list.key;
    const saving: string[] = [];
    const all = setup([element, other, list], {}, true, {
      drafted,
      saveDraft: (key) => {
        saving.push(key);
        return Promise.resolve(true);
      },
    });
    action("close-all").run(all.context);
    await flush();
    expect(saving).toEqual([element.key, other.key]);
    expect(closes(all.dispatched)).toHaveLength(3);
    expect(all.asked).toEqual([]);
    const some = setup([element, other, list], {}, true, {
      drafted,
      saveDraft: (key) => Promise.resolve(key === element.key),
    });
    action("close-all").run(some.context);
    await flush();
    expect(some.dispatched).toEqual([]);
    expect(some.asked[0]?.label).toBe("1 buffer with unsaved changes (SR-037 Other)");
  });

  it("names at most three of the buffers with unsaved text", () => {
    const many = [1, 2, 3, 4, 5].map((n) => elementBuffer(`u${String(n)}`, "spec", `SR-00${String(n)} T`));
    const { context, asked } = setup(many, {}, true, { drafted: () => true });
    action("close-all").run(context);
    expect(asked[0]?.label).toBe("5 buffers with unsaved changes (SR-001 T, SR-002 T, SR-003 T and 2 more)");
    const three = setup(many.slice(0, 3), {}, true, { drafted: () => true });
    action("close-all").run(three.context);
    expect(three.asked[0]?.label).toBe("3 buffers with unsaved changes (SR-001 T, SR-002 T, SR-003 T)");
  });

  it('[SR-123/AK-h0hj] "cab" ranks Close all buffers first in the command prompt', () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const { context } = setup([element, other, filtered], {}, true, { element: controls });
    const items = commandPrompt(context).items;
    expect(rank(items, (item) => item.name, "cab")[0]?.item.name).toBe("Close all buffers");
  });

  it("is offered with buffers only", () => {
    expect(action("close-all").available(setup([list]).context)).toBe(true);
    expect(action("close-all").available(setup([]).context)).toBe(false);
  });

  it("[SR-118/AK-yggg] leaves the overview open and out of the count; the lone overview has nothing to close", () => {
    const overview = overviewBuffer();
    const { context, dispatched, discarded, echoed } = setup([element, overview]);
    action("close-all").run(context);
    expect(closes(dispatched)).toEqual([{ type: "close", key: element.key }]);
    expect(discarded).toEqual([element.key]);
    expect(echoed).toEqual(["Closed 1 buffer"]);
    const lone = setup([overview]).context;
    expect(action("close-all").available(lone)).toBe(false);
    expect(action("close").available(lone)).toBe(false);
    expect(action("close").available(setup([element, overview]).context)).toBe(true);
    // With unsaved text only the other buffers are asked about and closed.
    const drafted = setup([element, other, overview], {}, true, { drafted: (key) => key === other.key });
    action("close-all").run(drafted.context);
    expect(drafted.asked[0]?.label).toBe("1 buffer with unsaved changes (SR-037 Other)");
    choices(drafted.asked[0])[0]?.run();
    expect(closes(drafted.dispatched)).toEqual([{ type: "close", key: element.key }]);
  });

  it("any other action ends a question that Close buffer asked, Close all buffers too", () => {
    const { context, armed } = setup([element]);
    runAction(action("close-all"), context);
    expect(armed).toEqual([undefined]);
  });
});

describe("Next buffer and Previous buffer (SR-115 AK5)", () => {
  const overview = overviewBuffer();
  const search = searchBuffer("wind");
  // Shown last first: the element, the search, the list, the overview.
  const cycleOrder = [element.key, search.key, list.key, overview.key];
  const used: Buffers = [element, search, list, overview];

  it("[SR-115/AK-m5pg] Previous buffer shows the buffer shown before the shown one, after the oldest the newest; Next buffer the one after", () => {
    const previous = setup(used, {}, true, { cycleOrder });
    runAction(action("previous-buffer"), previous.context);
    expect(previous.dispatched).toEqual([{ type: "switch", key: search.key }]);
    expect(previous.cycledTo).toEqual([search.key]);
    // Walking back: the list is shown, the order stays.
    const further = setup([list, element, search, overview], {}, true, { cycleOrder });
    runAction(action("previous-buffer"), further.context);
    expect(further.dispatched).toEqual([{ type: "switch", key: overview.key }]);
    const oldest = setup([overview, element, search, list], {}, true, { cycleOrder });
    runAction(action("previous-buffer"), oldest.context);
    expect(oldest.dispatched).toEqual([{ type: "switch", key: element.key }]);
    const next = setup([list, element, search, overview], {}, true, { cycleOrder });
    runAction(action("next-buffer"), next.context);
    expect(next.dispatched).toEqual([{ type: "switch", key: search.key }]);
    const newest = setup(used, {}, true, { cycleOrder });
    runAction(action("next-buffer"), newest.context);
    expect(newest.dispatched).toEqual([{ type: "switch", key: overview.key }]);
  });

  it("[SR-115/AK-m5pg] the focus leaves a text editor before the switch, so that the editor gets nothing of the key", () => {
    const { context, left, dispatched } = setup(used, {}, true, { cycleOrder });
    runAction(action("next-buffer"), context);
    expect(left).toEqual([true]);
    expect(dispatched).toHaveLength(1);
  });

  it("[SR-115/AK-m5pg] are commands of the prompt with their keys while several buffers are open", () => {
    const linux = commandPrompt(setup(used, {}, true, { cycleOrder }).context).items;
    expect(linux.find((item) => item.name === "Next buffer")?.hint).toBe("Alt+N");
    expect(linux.find((item) => item.name === "Previous buffer")?.hint).toBe("Alt+P");
    const mac = commandPrompt(setup(used, {}, true, { cycleOrder, mac: true }).context).items;
    expect(mac.find((item) => item.name === "Next buffer")?.hint).toBe("⌥N");
    expect(mac.find((item) => item.name === "Previous buffer")?.hint).toBe("⌥P");
    const names = titles(setup(used, {}, true, { cycleOrder }).context);
    expect(names.indexOf("Next buffer")).toBe(names.indexOf("Close all buffers") + 1);
    expect(names.indexOf("Previous buffer")).toBe(names.indexOf("Next buffer") + 1);
  });

  it("[SR-115/AK-m5pg] are not offered and take no key with one buffer, or without a workspace", () => {
    expect(titles(setup([overview]).context)).not.toContain("Next buffer");
    expect(titles(setup([list]).context)).not.toContain("Previous buffer");
    const alone = setup([overview]).context;
    expect(actionFor(alone, (shortcut) => shortcut === NEXT_BUFFER_SHORTCUT)).toBeUndefined();
    const none = setup([], {}, false).context;
    expect(actionFor(none, (shortcut) => shortcut === PREVIOUS_BUFFER_SHORTCUT)).toBeUndefined();
  });

  it("[SR-115/AK-m5pg] [SR-145/AK-kbdf] Alt+N and Alt+P find the actions, Option+N and Option+P by the physical key", () => {
    const { context } = setup(used, {}, true, { cycleOrder });
    const press = (key: string, code: string) => ({
      key,
      code,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    const found = (key: string, code: string) =>
      actionFor(context, (shortcut) => matches(press(key, code), shortcut, false))?.id;
    expect(found("n", "KeyN")).toBe("next-buffer");
    expect(found("p", "KeyP")).toBe("previous-buffer");
    expect(found("Dead", "KeyN")).toBe("next-buffer");
    expect(found("π", "KeyP")).toBe("previous-buffer");
  });

  it("[SR-115/AK-m5pg] switches nothing when the shown buffer is not in the order, and leaves the focus where it is", () => {
    const { context, dispatched, left, cycledTo } = setup(used, {}, true, {
      cycleOrder: [list.key, search.key],
    });
    runAction(action("next-buffer"), context);
    runAction(action("previous-buffer"), context);
    expect(dispatched).toEqual([]);
    expect(cycledTo).toEqual([]);
    expect(left).toEqual([]);
  });
});

describe("Split window (SR-115 AK3)", () => {
  const overview = overviewBuffer();
  const layoutOf = (other: string | undefined) => {
    const calls: string[] = [];
    return {
      calls,
      layout: {
        other,
        split: () => calls.push("split"),
        unsplit: () => calls.push("unsplit"),
        beside: (side: "left" | "right", buffer: { readonly key: string }) =>
          calls.push(`${side} ${buffer.key}`),
      },
    };
  };

  it("[SR-150/AK-mpfv] Other pane, id other-window, has the key Alt+O on every platform", () => {
    expect(action("other-window").title).toBe("Other pane");
    expect(action("other-window").shortcut).toEqual({ mod: false, shift: false, alt: true, key: "o" });
    expect(shortcutLabel({ mod: false, shift: false, alt: true, key: "o" }, true)).toBe("⌥O");
  });

  it("[SR-115/AK-cycg] Split window, Other pane and Unsplit window are prompt commands, available only when they apply", () => {
    for (const id of ["split-window", "unsplit-window"]) {
      expect(action(id).shortcut).toBeUndefined();
      expect(action(id).covers).toBeUndefined();
    }
    // One area: Split window, with a buffer that is not the lone overview, in a workspace.
    const one = layoutOf(undefined);
    const unsplit = setup([element, overview], {}, true, { layout: one.layout });
    expect(titles(unsplit.context)).toContain("Split window");
    expect(titles(unsplit.context)).not.toContain("Other pane");
    expect(titles(unsplit.context)).not.toContain("Unsplit window");
    runAction(action("split-window"), unsplit.context);
    expect(one.calls).toEqual(["split"]);
    expect(action("split-window").available(setup([element], {}, true, { layout: one.layout }).context)).toBe(
      true,
    );
    expect(
      action("split-window").available(setup([overview], {}, true, { layout: one.layout }).context),
    ).toBe(false);
    expect(action("split-window").available(setup([], {}, true, { layout: one.layout }).context)).toBe(false);
    expect(
      action("split-window").available(setup([element], {}, false, { layout: one.layout }).context),
    ).toBe(false);
    // Where the window offers no areas (no layout), nothing of it is offered.
    expect(titles(setup([element, overview]).context)).not.toContain("Split window");
    // Split: Other pane switches to the inactive area's buffer, Unsplit window joins the areas.
    const two = layoutOf(overview.key);
    const split = setup([element, overview], {}, true, { layout: two.layout });
    expect(titles(split.context)).not.toContain("Split window");
    expect(titles(split.context)).toEqual(expect.arrayContaining(["Other pane", "Unsplit window"]));
    runAction(action("other-window"), split.context);
    expect(split.dispatched).toEqual([{ type: "switch", key: overview.key }]);
    runAction(action("unsplit-window"), split.context);
    expect(two.calls).toEqual(["unsplit"]);
    // Run with no split (a stale prompt), Other pane does nothing.
    const stale = setup([element, overview], {}, true, { layout: one.layout });
    runAction(action("other-window"), stale.context);
    expect(stale.dispatched).toEqual([]);
    runAction(action("unsplit-window"), setup([element]).context);
    runAction(action("split-window"), setup([element]).context);
  });

  it("[SR-150/AK-skw8] Open to the right and Open to the left open the marked element beside, prompt commands without a key", () => {
    const marked = elementBuffer("u2", "spec", "SR-037 Other");
    const one = layoutOf(undefined);
    const shown = setup([overview], {}, true, { layout: one.layout, marked });
    expect(titles(shown.context)).toEqual(expect.arrayContaining(["Open to the right", "Open to the left"]));
    expect(action("open-right").shortcut).toBeUndefined();
    runAction(action("open-right"), shown.context);
    runAction(action("open-left"), shown.context);
    expect(one.calls).toEqual([`right ${marked.key}`, `left ${marked.key}`]);
    // Nothing marked, no workspace or no areas: not offered.
    expect(titles(setup([overview], {}, true, { layout: one.layout }).context)).not.toContain(
      "Open to the right",
    );
    expect(
      action("open-left").available(setup([overview], {}, false, { layout: one.layout, marked }).context),
    ).toBe(false);
    expect(action("open-left").available(setup([overview], {}, true, { marked }).context)).toBe(false);
    // Run from a stale prompt with nothing marked, it does nothing.
    runAction(action("open-left"), setup([overview], {}, true, { layout: one.layout }).context);
    expect(one.calls).toHaveLength(2);
  });
});
