import { describe, expect, it, vi } from "vitest";
import type { Choice } from "./actions.js";
import { elementBuffer } from "./buffers.js";
import type { PropertyInfo } from "./element-view.js";
import { addPropertyPrompt, choicePrompt, relationPrompt } from "./property-prompts.js";
import type { Row } from "./rows.js";

const run = (choice: Choice | undefined): void => {
  expect(choice).toBeDefined();
  choice?.run();
};

describe("addPropertyPrompt", () => {
  it("[SR-104/AK2] lists the properties by name with the key as hint, and adds the one taken", () => {
    const add = vi.fn();
    const prompt = addPropertyPrompt(
      [
        { key: "verification-method", name: "Verification Method" },
        { key: "topic", name: "Topic" },
      ],
      add,
    );
    expect(prompt.label).toBe("Add property");
    expect(prompt.items.map((item) => [item.name, item.hint])).toEqual([
      ["Verification Method", "verification-method"],
      ["Topic", "topic"],
    ]);
    expect(prompt.text).toBeUndefined();
    expect(prompt.find).toBeUndefined();
    run(prompt.items[1]);
    expect(add).toHaveBeenCalledWith({ key: "topic", name: "Topic" });
  });
});

describe("choicePrompt", () => {
  const method: PropertyInfo = {
    kind: "choice",
    many: false,
    markdown: false,
    choices: [
      { key: "test", name: "Test" },
      { key: "analysis", name: "Analysis" },
      { key: "inspection", name: "Inspection" },
      { key: "demonstration", name: "Demonstration" },
    ],
  };
  const tags: PropertyInfo = { ...method, many: true };

  it("[SR-104/AK3] offers only the choices of the metamodel and takes no free text", () => {
    const prompt = choicePrompt("Verification Method", method, [], vi.fn(), vi.fn());
    expect(prompt.label).toBe("Verification Method");
    expect(prompt.items.map((item) => item.name)).toEqual([
      "Test",
      "Analysis",
      "Inspection",
      "Demonstration",
    ]);
    expect(prompt.text).toBeUndefined();
    expect(prompt.find).toBeUndefined();
  });

  it("[SR-104/AK3] hands the keys back that the choice gives, then lets the focus go back to the box", () => {
    const apply = vi.fn();
    const done = vi.fn();
    const prompt = choicePrompt("Method", method, ["test"], apply, done);
    run(prompt.items[2]);
    expect(apply).toHaveBeenCalledWith(["inspection"]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("[SR-104/AK3] toggles a value of a list: a set one is first, with the hint set, and taking it removes it", () => {
    const apply = vi.fn();
    const prompt = choicePrompt("Tags", tags, ["analysis"], apply, vi.fn());
    expect(prompt.items.map((item) => [item.name, item.hint])).toEqual([
      ["Analysis", "set"],
      ["Test", "test"],
      ["Inspection", "inspection"],
      ["Demonstration", "demonstration"],
    ]);
    run(prompt.items[0]);
    expect(apply).toHaveBeenLastCalledWith([]);
    run(prompt.items[1]);
    expect(apply).toHaveBeenLastCalledWith(["analysis", "test"]);
  });

  it("[SR-104/AK2] lets the focus go back to the box on Escape", () => {
    const done = vi.fn();
    const prompt = choicePrompt("Method", method, [], vi.fn(), done);
    prompt.cancel?.();
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("relationPrompt", () => {
  const info: PropertyInfo = { kind: "relation", many: true, markdown: false };
  const single: PropertyInfo = { ...info, many: false };
  const one = { id: "p1", repository: "spec", label: "PKG-1 One" };
  const row = (id: string, label = "PKG-2", title = "Two"): Row => ({
    open: elementBuffer(id, "spec", `${label} ${title}`),
    label,
    title,
    shortId: label,
    status: undefined,
    depth: 0,
    terms: [],
    markLabel: false,
  });

  it("lists the targets that are set with the hint set; taking one removes it", () => {
    const apply = vi.fn();
    const done = vi.fn();
    const prompt = relationPrompt("Package", info, [one], apply, undefined, done);
    expect(prompt.label).toBe("Package");
    expect(prompt.items.map((item) => [item.name, item.hint])).toEqual([["PKG-1 One", "set"]]);
    expect(prompt.items[0]?.id).toBe(elementBuffer("p1", "spec", "x").key);
    run(prompt.items[0]);
    expect(apply).toHaveBeenCalledWith([]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("finds elements with the search of the caller: a hit is appended to a list and replaces the target of a single relation", () => {
    let take: ((found: Row) => void) | undefined;
    const search = vi.fn((run: (found: Row) => void) => {
      take = run;
      return () => Promise.resolve([]);
    });
    const apply = vi.fn();
    const done = vi.fn();
    const many = relationPrompt("Package", info, [one], apply, search, done);
    expect(many.find).toBeDefined();
    take?.(row("p2"));
    expect(apply).toHaveBeenLastCalledWith([one, { id: "p2", repository: "spec", label: "PKG-2 Two" }]);
    const replacing = relationPrompt("Parent", single, [one], apply, search, done);
    expect(replacing.find).toBeDefined();
    take?.(row("p2"));
    expect(apply).toHaveBeenLastCalledWith([{ id: "p2", repository: "spec", label: "PKG-2 Two" }]);
    // A hit that is set already is taken out.
    take?.(row("p1", "PKG-1", "One"));
    expect(apply).toHaveBeenLastCalledWith([]);
    expect(done).toHaveBeenCalledTimes(3);
  });

  it("has no search when the property may point at no type, and lets the focus go back on Escape", () => {
    const done = vi.fn();
    const prompt = relationPrompt("Package", info, [], vi.fn(), undefined, done);
    expect(prompt.find).toBeUndefined();
    prompt.cancel?.();
    expect(done).toHaveBeenCalledTimes(1);
  });
});
