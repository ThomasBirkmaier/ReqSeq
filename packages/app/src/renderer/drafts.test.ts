import { describe, expect, it } from "vitest";
import type { Draft } from "./drafts.js";
import { boxDrafts, makeDraft, reconcile, typedText } from "./drafts.js";

const draft = (text: string, base: string, boxes?: [string, string, string][]): Draft => ({
  text,
  base,
  ...(boxes === undefined
    ? {}
    : { boxes: new Map(boxes.map(([key, doc, boxBase]) => [key, { doc, base: boxBase }])) }),
});

describe("makeDraft", () => {
  it("is none when the text and every box are what is stored", () => {
    expect(makeDraft({ doc: "a", base: "a" }, [])).toBeUndefined();
    expect(makeDraft({ doc: "a", base: "a" }, [["topic", { doc: "x", base: "x" }]])).toBeUndefined();
  });

  it("keeps the text, and only the boxes that differ", () => {
    expect(makeDraft({ doc: "b", base: "a" }, [["topic", { doc: "x", base: "x" }]])).toEqual(draft("b", "a"));
    expect(
      makeDraft({ doc: "a", base: "a" }, [
        ["topic", { doc: "y", base: "x" }],
        ["criteria", { doc: "p", base: "p" }],
      ]),
    ).toEqual(draft("a", "a", [["topic", "y", "x"]]));
  });
});

describe("reconcile", () => {
  const stored = (entries: [string, string][]): Map<string, string> => new Map(entries);

  it("keeps a draft that was typed on what the file holds", () => {
    const kept = draft("mine", "a", [["topic", "y", "x"]]);
    const compared = reconcile(kept, "a", stored([["topic", "x"]]));
    expect(compared).toEqual({ draft: kept, changed: false });
    expect(compared.draft).toBe(kept);
  });

  it("drops the text that the file now holds, and the boxes", () => {
    expect(reconcile(draft("mine", "a"), "mine", stored([]))).toEqual({ draft: undefined, changed: false });
    expect(reconcile(draft("a", "a", [["topic", "y", "x"]]), "a", stored([["topic", "y"]]))).toEqual({
      draft: undefined,
      changed: false,
    });
  });

  it("rebases a draft typed on other text or values, and says the file changed", () => {
    expect(reconcile(draft("mine", "a"), "b", stored([]))).toEqual({
      draft: draft("mine", "b"),
      changed: true,
    });
    expect(reconcile(draft("a", "a", [["topic", "y", "x"]]), "a", stored([["topic", "z"]]))).toEqual({
      draft: draft("a", "a", [["topic", "y", "z"]]),
      changed: true,
    });
  });

  it("drops a box whose property is gone from the file, and says the file changed", () => {
    expect(reconcile(draft("a", "a", [["topic", "y", "x"]]), "a", stored([]))).toEqual({
      draft: undefined,
      changed: true,
    });
  });

  it("follows the file with text that was not typed in, without saying it changed", () => {
    const compared = reconcile(draft("a", "a", [["topic", "y", "x"]]), "b", stored([["topic", "x"]]));
    expect(compared).toEqual({ draft: draft("b", "b", [["topic", "y", "x"]]), changed: false });
  });
});

describe("typedText", () => {
  it("is the text of a draft that was typed on, and none for boxes alone or no draft", () => {
    expect(typedText(draft("mine", "a"))).toBe("mine");
    expect(typedText(draft("a", "a", [["topic", "y", "x"]]))).toBeUndefined();
    expect(typedText(undefined)).toBeUndefined();
  });
});

describe("boxDrafts", () => {
  it("pairs what each editor holds with the stored document it was typed on, and skips a box that is not stored", () => {
    expect(
      boxDrafts(
        new Map([
          ["topic", "a"],
          ["criteria", "b"],
        ]),
        new Map([
          ["topic", "x"],
          ["other", "y"],
        ]),
      ),
    ).toEqual([["topic", { doc: "x", base: "a" }]]);
  });
});
