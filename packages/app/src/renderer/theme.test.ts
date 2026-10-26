// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createTheme } from "./theme.js";

const setup = (dark: boolean) => {
  const root = document.createElement("html");
  const system = { matches: dark };
  return { root, system, theme: createTheme(root, system) };
};

describe("the theme", () => {
  it("follows the system while nothing was chosen, also when the system changes", () => {
    const { theme, system, root } = setup(false);
    expect(theme.shown()).toBe("light");
    expect(theme.chosen()).toBe(false);
    system.matches = true;
    expect(theme.shown()).toBe("dark");
    expect(root.dataset["theme"]).toBeUndefined();
  });

  it("toggles to the other scheme than the system's and back", () => {
    const light = setup(false);
    expect(light.theme.toggle()).toBe("dark");
    expect(light.root.dataset["theme"]).toBe("dark");
    expect(light.theme.chosen()).toBe(true);
    expect(light.theme.toggle()).toBe("light");
    expect(light.root.dataset["theme"]).toBe("light");
    const dark = setup(true);
    expect(dark.theme.toggle()).toBe("light");
    expect(dark.theme.shown()).toBe("light");
  });

  it("keeps its choice when the system changes, and follows the system again after follow()", () => {
    const { theme, system, root } = setup(false);
    theme.toggle();
    system.matches = true;
    expect(theme.shown()).toBe("dark");
    theme.toggle();
    expect(theme.shown()).toBe("light");
    theme.follow();
    expect(root.dataset["theme"]).toBeUndefined();
    expect(theme.chosen()).toBe(false);
    expect(theme.shown()).toBe("dark");
  });

  it("ignores an attribute that is not a scheme", () => {
    const { theme, root } = setup(true);
    root.dataset["theme"] = "sepia";
    expect(theme.shown()).toBe("dark");
  });
});
