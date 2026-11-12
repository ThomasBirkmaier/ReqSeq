import { describe, expect, it, vi } from "vitest";
import type { ActionContext, Prompt } from "./actions.js";
import { ACTIONS } from "./actions.js";
import { foldSection, unfoldSection } from "./editor/folding.js";
import type { Heading } from "./editor/folding.js";
import type { HeadingControls } from "./heading-actions.js";
import { HEADING_ACTIONS } from "./heading-actions.js";

const HEADINGS: readonly Heading[] = [
  { level: 1, name: "Übersicht", from: 0, end: 11, to: 40 },
  { level: 2, name: "Zweck", from: 13, end: 21, to: 40 },
];

const contextOf = (kind: string, headings?: HeadingControls) => {
  const ask = vi.fn<(prompt: Prompt) => void>();
  const echo = vi.fn<(message: string) => void>();
  const context = {
    buffers: [{ kind }],
    ask,
    echo,
    ...(headings === undefined ? {} : { element: { headings } }),
  } as unknown as ActionContext;
  return { context, ask, echo };
};

const action = (title: string) => {
  const found = HEADING_ACTIONS.find((entry) => entry.title === title);
  if (found === undefined) {
    throw new Error(title);
  }
  return found;
};

const controls = (list: readonly Heading[] = HEADINGS) => ({
  list: vi.fn(() => list),
  run: vi.fn<HeadingControls["run"]>(),
  goTo: vi.fn<HeadingControls["goTo"]>(),
});

describe("the heading actions", () => {
  it("are in the command prompt, on an element buffer with headings controls only", () => {
    expect(ACTIONS.filter((entry) => HEADING_ACTIONS.includes(entry))).toHaveLength(3);
    for (const entry of HEADING_ACTIONS) {
      expect(entry.available(contextOf("element", controls()).context)).toBe(true);
      expect(entry.available(contextOf("element").context)).toBe(false);
      expect(entry.available(contextOf("list", controls()).context)).toBe(false);
    }
  });

  it("[SR-191/AK-twyq] Fold section and [SR-191/AK-wyyz] Unfold section run their command on the text", () => {
    const headings = controls();
    action("Fold section").run(contextOf("element", headings).context);
    expect(headings.run).toHaveBeenCalledWith(foldSection, "No section to fold here");
    action("Unfold section").run(contextOf("element", headings).context);
    expect(headings.run).toHaveBeenCalledWith(unfoldSection, "No folded section here");
  });

  it("[SR-191/AK-hgpr] Go to heading offers the headings in their order, and the choice moves the cursor there", () => {
    const headings = controls();
    const { context, ask } = contextOf("element", headings);
    action("Go to heading").run(context);
    const prompt = ask.mock.calls[0]?.[0];
    expect(prompt?.label).toBe("Go to heading");
    expect(prompt?.items.map((item) => [item.name, item.hint])).toEqual([
      ["Übersicht", "H1"],
      ["Zweck", "H2"],
    ]);
    prompt?.items[1]?.run();
    expect(headings.goTo).toHaveBeenCalledWith(13);
    expect(headings.run).not.toHaveBeenCalled();
  });

  it("says so when the text has no heading", () => {
    const { context, ask, echo } = contextOf("element", controls([]));
    action("Go to heading").run(context);
    expect(ask).not.toHaveBeenCalled();
    expect(echo).toHaveBeenCalledWith("The text has no heading");
    const without = contextOf("element");
    action("Go to heading").run(without.context);
    expect(without.echo).toHaveBeenCalledWith("The text has no heading");
  });
});
