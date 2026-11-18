import { describe, expect, it, vi } from "vitest";
import { commandPrompt, runAction } from "./actions.js";
import { fakeTheme, setup, action, list, element, titles } from "./actions.test-helper.js";

describe("light and dark", () => {
  it('[SR-113/AK-szv3] "Toggle dark mode" switches to the other scheme and says so', () => {
    const light = setup([list], {}, true, { theme: fakeTheme(false) });
    runAction(action("toggle-dark-mode"), light.context);
    expect(light.context.theme.shown()).toBe("dark");
    runAction(action("toggle-dark-mode"), light.context);
    expect(light.context.theme.shown()).toBe("light");
    expect(light.echoed).toEqual(["Dark mode until the app quits", "Light mode until the app quits"]);
    const dark = setup([list], {}, true, { theme: fakeTheme(true) });
    runAction(action("toggle-dark-mode"), dark.context);
    expect(dark.context.theme.shown()).toBe("light");
  });

  it('[SR-113/AK-szv3] "Follow system light or dark mode" is offered only after a choice, and drops it', () => {
    const theme = fakeTheme(true);
    const { context, echoed } = setup([list], {}, true, { theme });
    expect(titles(context)).toContain("Toggle dark mode");
    expect(titles(context)).not.toContain("Follow system light or dark mode");
    runAction(action("toggle-dark-mode"), context);
    expect(titles(context)).toContain("Follow system light or dark mode");
    runAction(action("follow-system-theme"), context);
    expect(theme.choice()).toBeUndefined();
    expect(theme.shown()).toBe("dark");
    expect(echoed.at(-1)).toBe("Light or dark as the system says");
    expect(titles(context)).not.toContain("Follow system light or dark mode");
  });

  it("offers neither without a workspace, where the prompt cannot be opened", () => {
    const theme = fakeTheme();
    theme.toggle();
    expect(titles(setup([], {}, false, { theme }).context)).toEqual([]);
  });
});

describe("Open documentation (SR-141)", () => {
  it("is offered with and without a workspace where the app can open the documentation, and opens its start page", () => {
    for (const open of [true, false]) {
      const docs = vi.fn();
      const { context } = setup([], {}, open, { docs });
      expect(commandPrompt(context).items.some((item) => item.name === "Open documentation")).toBe(true);
      runAction(action("open-documentation"), context);
      expect(docs).toHaveBeenCalledExactlyOnceWith();
    }
    const { context } = setup([], {}, true);
    expect(action("open-documentation").available(context)).toBe(false);
    // Without `docs` it does nothing.
    action("open-documentation").run(context);
  });
});

describe("Open workspace (SR-131)", () => {
  const workspaces = {
    name: "Weather station",
    list: () => Promise.resolve([{ root: "/req/buoy", state: "found" as const }]),
    open: () => Promise.resolve({ ok: true as const }),
  };

  it("Open workspace is offered with and without an open workspace", async () => {
    for (const open of [true, false]) {
      const { context, asked } = setup(open ? [list] : [], {}, open, { workspaces });
      const items = commandPrompt(context).items;
      expect(
        items.some((item) => item.name === "Open workspace"),
        String(open),
      ).toBe(true);
      if (!open) {
        // Without a workspace it is the one action that applies.
        expect(items.map((item) => item.name)).toEqual(["Open workspace"]);
      }
      runAction(action("open-workspace"), context);
      expect(asked.at(-1)?.label).toBe("Workspace");
      expect((await asked.at(-1)?.fill)?.items?.map((item) => item.name)).toEqual(["/req/buoy"]);
    }
  });

  it("is not offered where the window has no workspaces to offer, and does nothing there", () => {
    const { context, asked } = setup([list]);
    expect(action("open-workspace").available(context)).toBe(false);
    action("open-workspace").run(context);
    expect(asked).toEqual([]);
  });

  it("asks main to open also while a buffer has unsaved input: main has the window save it first (SR-131 AK3)", async () => {
    const open = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { context, asked, echoed } = setup([element, list], {}, true, {
      workspaces: { ...workspaces, open },
      drafted: (key) => key === element.key,
    });
    runAction(action("open-workspace"), context);
    (await asked[0]?.fill)?.items?.[0]?.run();
    expect(open).toHaveBeenCalledExactlyOnceWith("/req/buoy");
    expect(echoed).toEqual([]);
  });
});

describe("Choose view (SR-043 AK1)", () => {
  const coast = { view: "u-coast", title: "Coast", shortId: "VAR-0000c1" };
  const answers = {
    "metamodel.get": { types: [{ key: "variant", meaning: "variant" }] },
    "element.list": { elements: [{ id: "u-coast", shortId: "VAR-0000c1", title: "Coast" }] },
  };

  it("offers all elements, the core and each variant, marks the one shown, and chooses one", async () => {
    const choose = vi.fn();
    const { context, asked, echoed } = setup([list], answers, true, { views: { shown: coast, choose } });
    expect(titles(context)).toContain("Choose view");
    runAction(action("choose-view"), context);
    expect(asked.at(-1)?.label).toBe("View");
    const items = (await asked.at(-1)?.fill)?.items ?? [];
    expect(items.map((item) => [item.name, item.hint])).toEqual([
      ["All elements", undefined],
      ["Core", undefined],
      ["VAR-0000c1 Coast", "shown"],
    ]);
    items[1]?.run();
    items[0]?.run();
    expect(choose.mock.calls).toEqual([[{ view: "core", title: "Core" }], [undefined]]);
    expect(echoed).toEqual(["Showing the view Core", "Showing all elements"]);
  });

  it("offers all elements alone, with the reason, when the views cannot be read", async () => {
    const { context, asked, echoed } = setup([list], { "metamodel.get": new Error("no metamodel") }, true, {
      views: { shown: undefined, choose: vi.fn() },
    });
    runAction(action("choose-view"), context);
    const items = (await asked.at(-1)?.fill)?.items ?? [];
    expect(items.map((item) => [item.name, item.hint])).toEqual([["All elements", "shown"]]);
    expect(echoed).toEqual(["no metamodel"]);
  });

  it("is not offered where the window shows no view, and does nothing there", () => {
    const { context, asked } = setup([list]);
    expect(action("choose-view").available(context)).toBe(false);
    action("choose-view").run(context);
    expect(asked).toEqual([]);
  });
});
