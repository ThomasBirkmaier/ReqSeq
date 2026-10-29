import { describe, expect, it } from "vitest";
import type { DataExportElement } from "@reqseq/core";
import type { Draft } from "./drafts.js";
import { boxDrafts, makeDraft, rebased, sameDraft, typedText, withShown } from "./drafts.js";

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

  it("names the bytes of the file the input was typed on", () => {
    expect(makeDraft({ doc: "b", base: "a" }, [], "sha-1")).toEqual({ ...draft("b", "a"), sha: "sha-1" });
  });
});

describe("sameDraft", () => {
  it("compares the input, the file text and the bytes it was typed on", () => {
    expect(sameDraft(undefined, undefined)).toBe(true);
    expect(sameDraft(draft("b", "a"), undefined)).toBe(false);
    expect(sameDraft(undefined, draft("b", "a"))).toBe(false);
    expect(sameDraft(draft("b", "a", [["topic", "y", "x"]]), draft("b", "a", [["topic", "y", "x"]]))).toBe(
      true,
    );
    expect(sameDraft(draft("b", "a", [["topic", "y", "x"]]), draft("b", "a", [["topic", "y", "z"]]))).toBe(
      false,
    );
    expect(sameDraft({ ...draft("b", "a"), sha: "one" }, { ...draft("b", "a"), sha: "two" })).toBe(false);
  });
});

describe("withShown", () => {
  it("[SR-106/AK3] keeps the element the buffer shows with its draft, and nothing without a draft", () => {
    const shown = { element: { id: "uuid-1" } as DataExportElement, sha: "sha-1" };
    expect(withShown(draft("b", "a"), shown)).toEqual({ ...draft("b", "a"), shown });
    expect(withShown(draft("b", "a"), undefined)).toEqual(draft("b", "a"));
    expect(withShown(undefined, shown)).toBeUndefined();
    // The element is no input: two drafts that differ only in it are the same draft.
    expect(sameDraft(withShown(draft("b", "a"), shown), draft("b", "a"))).toBe(true);
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

describe("rebased", () => {
  const element = { id: "uuid-1", title: "T" } as DataExportElement;
  const saved = (text: string, docs: Record<string, string> = {}) => ({
    element,
    sha: "sha-1",
    text,
    docs: new Map(Object.entries(docs)),
  });

  it("[SR-105/AK1] drops the input a save that answered after the buffer was left has written", () => {
    expect(
      rebased(
        { ...draft("a!", "a", [["topic", "Gusts", "Wind"]]), sha: "sha-0" },
        { text: "a!", boxes: new Map([["topic", "Gusts"]]) },
        saved("a!\n", { topic: "Gusts" }),
      ),
    ).toBeUndefined();
  });

  it("keeps the input typed while the save ran, on the bytes it wrote", () => {
    expect(
      rebased(
        {
          ...draft("a!?", "a", [
            ["topic", "Gustsy", "Wind"],
            ["area", "x", ""],
          ]),
          sha: "sha-0",
        },
        { text: "a!", boxes: new Map([["topic", "Gusts"]]) },
        saved("a!\n", { topic: "Gusts" }),
      ),
    ).toEqual({
      text: "a!?",
      base: "a!\n",
      boxes: new Map([
        ["topic", { doc: "Gustsy", base: "Gusts" }],
        ["area", { doc: "x", base: "" }],
      ]),
      sha: "sha-1",
      shown: { element, sha: "sha-1" },
    });
    // The title is a field like a box (#621): sent, it is in the file; typed meanwhile, it stays.
    expect(
      rebased(
        { ...draft("a", "a", [["Title", "New!", "Old"]]), sha: "sha-0" },
        { boxes: new Map([["Title", "New"]]) },
        saved("a", { Title: "New" }),
      ),
    ).toMatchObject({ boxes: new Map([["Title", { doc: "New!", base: "New" }]]), sha: "sha-1" });
    // A text that was not sent and not typed is the file's text.
    expect(
      rebased(draft("a", "a", [["topic", "x", "Wind"]]), { boxes: new Map() }, saved("b")),
    ).toMatchObject({
      text: "b",
      base: "b",
    });
  });
});
