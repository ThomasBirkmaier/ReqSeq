// Which line keeps which criterion key after one edit in the app's editor (SR-204 AK7, AK8).
import { describe, expect, it } from "vitest";
import type { LineChange } from "./criterion-lines.js";
import {
  carryLineKeys,
  criterionEntries,
  drawCriterionKey,
  isBlankLine,
  lineKeysOf,
} from "./criterion-lines.js";

const LINES = ["alpha", "beta", "gamma"];
const KEYS = ["kaaa", "kbbb", "kccc"];

/** The keys after `changes` on `lines` with `keys`; new keys are `new1`, `new2`, ... in order. */
const edit = (
  changes: readonly LineChange[],
  {
    lines = LINES,
    keys = KEYS,
    move = false,
  }: { lines?: readonly string[]; keys?: readonly (string | undefined)[]; move?: boolean } = {},
): (string | undefined)[] => {
  let count = 0;
  return carryLineKeys({ lines, keys }, changes, move, () => {
    count += 1;
    return `new${String(count)}`;
  });
};

const insert = (at: number, text: string): LineChange => ({ fromA: at, toA: at, insert: text });
const remove = (from: number, to: number): LineChange => ({ fromA: from, toA: to, insert: "" });

describe("carryLineKeys (SR-204 AK7)", () => {
  it("[SR-204/AK-syqv] a reworded line keeps its key, also when its whole text is typed again", () => {
    expect(edit([insert(10, " two")])).toEqual(KEYS);
    expect(edit([{ fromA: 6, toA: 10, insert: "second" }])).toEqual(KEYS);
  });

  it("[SR-204/AK-syqv] a split keeps the key on the first part, and the rest is a new line", () => {
    expect(edit([insert(8, "\n")])).toEqual(["kaaa", "kbbb", "new1", "kccc"]);
    // Enter at the start of a line: the text keeps its key, the blank line above holds none.
    expect(edit([insert(6, "\n")])).toEqual(["kaaa", undefined, "kbbb", "kccc"]);
  });

  it("[SR-204/AK-syqv] two lines merged keep the key of the front one", () => {
    // Backspace at the start of "beta", or Delete at the end of "alpha".
    expect(edit([remove(5, 6)])).toEqual(["kaaa", "kccc"]);
    // A selection across the line break.
    expect(edit([remove(3, 8)])).toEqual(["kaaa", "kccc"]);
  });

  it("[SR-204/AK-syqv] a line moved up or down keeps its key, and so does the line it passes", () => {
    // moveLineDown on "alpha": "beta" is deleted after it and inserted before it.
    const down = [insert(0, "beta\n"), remove(5, 10)];
    expect(edit(down, { move: true })).toEqual(["kbbb", "kaaa", "kccc"]);
    // A drag of "alpha" with its line break to the end, within the editor.
    expect(edit([remove(0, 6), insert(16, "\nalpha")], { move: true })).toEqual(["kbbb", "kccc", "kaaa"]);
  });

  it("a line deleted whole gives its key to none; the next one keeps its own", () => {
    expect(edit([remove(0, 6)])).toEqual(["kbbb", "kccc"]);
    expect(edit([remove(10, 16)])).toEqual(["kaaa", "kbbb"]);
    // Two deletions that touch count as one.
    expect(edit([remove(0, 3), remove(3, 6)])).toEqual(["kbbb", "kccc"]);
    // Lines replaced by one new text.
    expect(edit([{ fromA: 0, toA: 10, insert: "x" }])).toEqual(["new1", "kccc"]);
  });

  it("a line blank after the edit holds no key, and a blank line takes none", () => {
    expect(edit([remove(6, 10)])).toEqual(["kaaa", undefined, "kccc"]);
    expect(edit([insert(0, "x")], { lines: ["", "b"], keys: [undefined, "kbbb"] })).toEqual(["new1", "kbbb"]);
    // A merge into a blank line: the line that is not blank keeps its key.
    expect(edit([remove(0, 1)], { lines: ["", "beta"], keys: [undefined, "kbbb"] })).toEqual(["kbbb"]);
  });

  it("every line without key gets one at the first change (SR-204 AK1)", () => {
    expect(edit([insert(10, "!")], { keys: [undefined, "kbbb", undefined] })).toEqual([
      "new1",
      "kbbb",
      "new2",
    ]);
  });
});

describe("carryLineKeys (SR-204 AK8)", () => {
  it("[SR-204/AK-pks0] new, pasted and dropped lines get new keys, also with the text of an old criterion", () => {
    // A paste of two lines before "alpha": "alpha" keeps its key.
    expect(edit([insert(0, "beta\ngamma\n")])).toEqual(["new1", "new2", "kaaa", "kbbb", "kccc"]);
    // A new line typed with an existing text.
    expect(edit([insert(16, "\ngamma")])).toEqual(["kaaa", "kbbb", "kccc", "new1"]);
  });

  it("[SR-204/AK-pks0] a line cut and pasted back gets a new key: the paste is no move", () => {
    const cut = edit([remove(0, 6)]);
    expect(cut).toEqual(["kbbb", "kccc"]);
    expect(edit([insert(0, "alpha\n")], { lines: ["beta", "gamma"], keys: cut })).toEqual([
      "new1",
      "kbbb",
      "kccc",
    ]);
    // In one edit too, when it is not a move.
    expect(edit([insert(0, "beta\n"), remove(5, 10)])).toEqual(["new1", "kaaa", "kccc"]);
  });
});

describe("the other helpers", () => {
  it("lineKeysOf keeps a key at its first holder in its form", () => {
    expect(
      lineKeysOf([
        { key: "abcd", text: "a" },
        "plain",
        { key: "abcd", text: "b" },
        { key: "Bad!", text: "c" },
        { key: "efgh", text: "d" },
      ]),
    ).toEqual(["abcd", undefined, undefined, undefined, "efgh"]);
  });

  it("criterionEntries sends the lines that are not blank, with their keys", () => {
    expect(criterionEntries(["a", " ", "b", "c"], ["kaaa", undefined, undefined, "kccc"])).toEqual([
      { key: "kaaa", text: "a" },
      "b",
      { key: "kccc", text: "c" },
    ]);
    expect(isBlankLine(" \t")).toBe(true);
  });

  it("drawCriterionKey draws again while the key is taken", () => {
    const draws = [0, 0, 0, 0, 1, 0, 0, 0];
    const random = (): number => draws.shift() ?? 0;
    expect(drawCriterionKey(new Set(["bbbb"]), random)).toBe("cbbb");
  });
});
