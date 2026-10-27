import { describe, expect, it, vi } from "vitest";
import type { Draft } from "./drafts.js";
import type { PropertyInfo } from "./element-view.js";
import {
  DISK_DIFF_MAX_LINES,
  GONE_CONFIRM_MS,
  KEEP_INPUT,
  RESOLVE_TITLE,
  TAKE_FILE,
  changedOnDisk,
  deletedOnDisk,
  diskLines,
  diskMark,
  draftInput,
  fieldLines,
  goneWait,
  isGone,
  keptBoxes,
  onDisk,
  outsideChange,
  resolvePrompt,
} from "./outside-change.js";

const docs = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries));
const file = (sha: string, entries: Record<string, string>) => ({ sha, docs: docs(entries) });

describe("outsideChange", () => {
  it("[SR-106/AK1] follows the file when there is no input", () => {
    expect(outsideChange(new Map(), "one", file("two", { Text: "new" }))).toEqual({
      kind: "follow",
      dropped: [],
    });
  });

  it("[SR-106/AK2] stops saving when the file's bytes are no longer those the input was typed on, with both versions of each field with input", () => {
    const input = docs({ Text: "mine", topic: "Gusts" });
    expect(outsideChange(input, "one", file("two", { Text: "theirs", topic: "Wind" }))).toEqual({
      kind: "conflict",
      dropped: [],
      fields: [
        { label: "Text", input: "mine", disk: "theirs" },
        { label: "topic", input: "Gusts", disk: "Wind" },
      ],
    });
  });

  it("[SR-106/AK2] stops saving also when the change from outside touched another field than the input (spec question #488, 1)", () => {
    expect(outsideChange(docs({ Text: "mine" }), "one", file("two", { Text: "base", title: "New" }))).toEqual(
      {
        kind: "conflict",
        dropped: [],
        fields: [{ label: "Text", input: "mine", disk: "base" }],
      },
    );
  });

  it("drops the input that the file now holds, and has no conflict when no input is left", () => {
    expect(outsideChange(docs({ Text: "mine" }), "one", file("two", { Text: "mine" }))).toEqual({
      kind: "follow",
      dropped: ["Text"],
    });
    expect(
      outsideChange(
        docs({ Text: "mine", topic: "Gusts" }),
        "one",
        file("two", { Text: "mine", topic: "Wind" }),
      ),
    ).toEqual({
      kind: "conflict",
      dropped: ["Text"],
      fields: [{ label: "topic", input: "Gusts", disk: "Wind" }],
    });
  });

  it("has no conflict on the bytes the input was typed on: the same file, or one that came back to them", () => {
    expect(outsideChange(docs({ Text: "mine" }), "one", file("one", { Text: "base" }))).toEqual({
      kind: "follow",
      dropped: [],
    });
  });

  it("takes a property that is not in the file as the empty document", () => {
    expect(outsideChange(docs({ topic: "" }), "one", file("two", {}))).toEqual({
      kind: "follow",
      dropped: ["topic"],
    });
    expect(outsideChange(docs({ topic: "Gusts" }), "one", file("two", {}))).toMatchObject({
      fields: [{ label: "topic", input: "Gusts", disk: "" }],
    });
  });
});

describe("a draft that comes back", () => {
  const kept = (text: string, base: string, boxes: Record<string, [string, string]> = {}): Draft => ({
    text,
    base,
    boxes: new Map(Object.entries(boxes).map(([key, [doc, boxBase]]) => [key, { doc, base: boxBase }])),
    sha: "one",
  });

  it("has the text as input only when it was typed in, and every box", () => {
    expect([...draftInput(kept("mine", "base", { topic: ["Gusts", "Wind"] }))]).toEqual([
      ["Text", "mine"],
      ["topic", "Gusts"],
    ]);
    expect([...draftInput({ text: "base", base: "base" })]).toEqual([]);
  });

  it("[SR-106/AK2] keeps the boxes with input on the stored values now; a property gone from the file keeps its input as an added box", () => {
    expect(
      keptBoxes(
        kept("base", "base", { topic: ["Gusts", "Wind"], rationale: ["Mine", "Old"], criteria: ["a", "b"] }),
        ["criteria"],
        docs({ topic: "Calm" }),
      ),
    ).toEqual([
      ["topic", { doc: "Gusts", base: "Calm" }],
      ["rationale", { doc: "Mine", base: "" }],
    ]);
    expect(keptBoxes({ text: "a", base: "a" }, [], new Map())).toEqual([]);
  });
});

describe("the block On disk", () => {
  it("[SR-106/AK2] shows the file's lines and marks those the input lacks", () => {
    expect(diskLines(["one", "two", "three"], ["one", "2", "three", "four"])).toEqual([
      { text: "one", differs: false },
      { text: "two", differs: true },
      { text: "three", differs: false },
    ]);
    expect(diskLines(["a", "b"], ["b", "a"])).toEqual([
      { text: "a", differs: true },
      { text: "b", differs: false },
    ]);
    expect(diskLines(["b", "a"], ["a", "c"])).toEqual([
      { text: "b", differs: true },
      { text: "a", differs: false },
    ]);
    expect(diskLines([], ["a"])).toEqual([]);
    expect(diskLines(["a"], [])).toEqual([{ text: "a", differs: true }]);
  });

  it("shows a long value without marks", () => {
    const long = Array.from({ length: DISK_DIFF_MAX_LINES + 1 }, (_, at) => String(at));
    expect(diskLines(long, ["x"]).every((line) => !line.differs)).toBe(true);
    expect(diskLines(["x"], long)).toEqual([{ text: "x", differs: false }]);
    expect(diskLines(long.slice(1), long.slice(1)).every((line) => !line.differs)).toBe(true);
  });

  it("shows the lines of the text and of a text box, the names of a choice and the labels of a relation", () => {
    const choice: PropertyInfo = {
      kind: "choice",
      many: true,
      markdown: false,
      choices: [{ key: "test", name: "Test" }],
    };
    const relation: PropertyInfo = { kind: "relation", many: true, markdown: false };
    expect(fieldLines(undefined, "a\nb")).toEqual(["a", "b"]);
    expect(fieldLines(undefined, "a\n\nb\n")).toEqual(["a", "", "b"]);
    expect(fieldLines(undefined, "")).toEqual([]);
    expect(fieldLines({ kind: "text", many: false, markdown: false }, "a")).toEqual(["a"]);
    expect(fieldLines(choice, "test\nother")).toEqual(["Test", "other"]);
    expect(fieldLines({ ...choice, choices: undefined } as unknown as PropertyInfo, "test")).toEqual([
      "test",
    ]);
    expect(fieldLines(relation, "id-1\tspec\tSR-1 One\nid-2\t\tSR-2 Two")).toEqual(["SR-1 One", "SR-2 Two"]);
    expect(onDisk({ label: "verification", input: "test", disk: "test\nother" }, choice)).toEqual([
      { text: "Test", differs: false },
      { text: "other", differs: true },
    ]);
  });
});

describe("what the buffer says and asks", () => {
  it("[SR-106/AK3] takes only ref.unknown as a file that is gone", () => {
    expect(isGone("ref.unknown")).toBe(true);
    expect(isGone("file.faulty")).toBe(false);
  });

  it("[SR-106/AK3] says a file is deleted only when it is still gone after a batch of the watcher (a pull removes and adds it)", () => {
    expect(GONE_CONFIRM_MS).toBeGreaterThan(1000);
    expect(goneWait(undefined, 5000)).toBe(GONE_CONFIRM_MS);
    expect(goneWait(5000, 5200)).toBe(GONE_CONFIRM_MS - 200);
    expect(goneWait(5000, 5000 + GONE_CONFIRM_MS)).toBe(0);
    expect(goneWait(5000, 9000)).toBe(0);
  });

  it("[SR-106/AK2] [SR-106/AK3] marks the modeline: deleted before changed", () => {
    const fields = [{ label: "Text", input: "a", disk: "b" }];
    expect(diskMark(false, undefined)).toBeUndefined();
    expect(diskMark(false, fields)).toBe("changed");
    expect(diskMark(true, fields)).toBe("deleted");
  });

  it("[SR-106/AK2] [SR-106/AK3] names the element and the deletion, and how to resolve", () => {
    expect(changedOnDisk("SR-1 One")).toBe('SR-1 One changed on disk. Resolve with "Resolve change on disk"');
    expect(deletedOnDisk("SR-1 One")).toBe(
      "SR-1 One was deleted on disk; its content stays here until you close the buffer",
    );
  });

  it("[SR-106/AK2] lets the user choose which version holds: the input or the file", () => {
    const keep = vi.fn();
    const take = vi.fn();
    const prompt = resolvePrompt(keep, take);
    expect(prompt.label).toBe(RESOLVE_TITLE);
    expect(prompt.items.map((item) => item.name)).toEqual([KEEP_INPUT, TAKE_FILE]);
    prompt.items[0]?.run();
    expect(keep).toHaveBeenCalledOnce();
    prompt.items[1]?.run();
    expect(take).toHaveBeenCalledOnce();
  });
});
