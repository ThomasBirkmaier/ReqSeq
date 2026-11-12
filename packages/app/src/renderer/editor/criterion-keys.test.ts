// The criterion keys of the criteria box through edits, undo and redo (SR-204 AK7, AK8, AK9).
import { history, moveLineDown, redo, undo } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { KEY_MARK } from "../criterion-doc.js";
import { criterionKeys, lineKeys, setKeys, webRandom } from "./criterion-keys.js";

const STORED = ["kaaa", "kbbb", "kccc"]
  .map((key, i) => `${key}${KEY_MARK}${["alpha", "beta", "gamma"][i] ?? ""}`)
  .join("\n");

/** A box with `doc` whose new keys are drawn in order from a counter (`bbbb`, `bbbc`, ...). */
const box = (doc = STORED) => {
  let next = 0;
  const codec = criterionKeys((below) => {
    const value = Math.floor(next / 1) % below;
    next += 1;
    return value;
  });
  const { text, init } = codec.decode(doc);
  let state = EditorState.create({ doc: text, extensions: [init, history(), codec.extension] });
  const run = (spec: TransactionSpec): void => {
    state = state.update(spec).state;
  };
  const command = (step: typeof undo): void => {
    step({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
  };
  return {
    codec,
    run,
    command,
    keys: () => lineKeys(state),
    text: () => state.doc.toString(),
    doc: () => codec.encode(state),
  };
};

/** A step that is no undo step of its own: it joins the one before (CodeMirror groups adjacent typing). */
const typed = (spec: TransactionSpec): TransactionSpec => ({ ...spec, userEvent: "input.type" });

describe("criterion keys in the criteria box", () => {
  it("[SR-204/AK-syqv] keeps the key of a reworded, split and moved line, and of the front of two merged", () => {
    const b = box();
    b.run(typed({ changes: { from: 10, insert: " two" } }));
    expect(b.keys()).toEqual(["kaaa", "kbbb", "kccc"]);
    b.run(typed({ changes: { from: 8, insert: "\n" } }));
    expect(b.keys().slice(0, 2)).toEqual(["kaaa", "kbbb"]);
    expect(b.keys()[2]).toMatch(/^[a-z][a-z0-9]{3}$/);
    // Backspace at the start of the new line merges it back: the front one keeps its key.
    b.run({ changes: { from: 8, to: 9 } });
    expect(b.keys()).toEqual(["kaaa", "kbbb", "kccc"]);
    b.command(moveLineDown);
    expect(b.text()).toBe("beta two\nalpha\ngamma");
    expect(b.keys()).toEqual(["kbbb", "kaaa", "kccc"]);
    // A drag within the box is a move too.
    b.run({
      changes: [
        { from: 0, to: 9 },
        { from: 20, insert: "\nbeta two" },
      ],
      userEvent: "move.drop",
    });
    expect(b.keys()).toEqual(["kaaa", "kccc", "kbbb"]);
  });

  it("[SR-204/AK-pks0] gives a pasted or dropped line a new key, also with the text of a line cut before", () => {
    const b = box();
    b.run({ changes: { from: 0, to: 6 }, userEvent: "delete.cut" });
    b.run({ changes: { from: 0, insert: "alpha\n" }, userEvent: "input.paste" });
    expect(b.text()).toBe("alpha\nbeta\ngamma");
    expect(b.keys()[0]).not.toBe("kaaa");
    expect(b.keys().slice(1)).toEqual(["kbbb", "kccc"]);
    b.run({ changes: { from: 0, insert: "gamma\n" }, userEvent: "input.drop" });
    expect(new Set(b.keys()).size).toBe(4);
    // A blank line holds no key.
    b.run({ changes: { from: 0, insert: "\n" } });
    expect(b.keys()[0]).toBeUndefined();
    expect(b.doc().split("\n")[0]).toBe("");
  });

  it("[SR-204/AK-gnnw] undo and redo bring back the keys, also of grouped typing", () => {
    const b = box();
    b.run(typed({ changes: { from: 16, insert: "\nd" } }));
    const added = b.keys()[3];
    b.run(typed({ changes: { from: 18, insert: "elta" } }));
    b.command(undo);
    expect(b.doc()).toBe(STORED);
    b.command(redo);
    expect(b.text()).toBe("alpha\nbeta\ngamma\ndelta");
    expect(b.keys()[3]).toBe(added);
  });

  it("[SR-204/AK-gnnw] undo brings back a deleted line with its key after a change put in without an undo step", () => {
    const b = box();
    b.run({ changes: { from: 6, to: 11 } });
    expect(b.keys()).toEqual(["kaaa", "kccc"]);
    // The file changed outside: "alpha" became "alpha one", put in as `replace` does.
    b.run({ changes: { from: 5, insert: " one" }, annotations: Transaction.addToHistory.of(false) });
    b.command(undo);
    expect(b.text()).toBe("alpha one\nbeta\ngamma");
    expect(b.keys()).toEqual(["kaaa", "kbbb", "kccc"]);
  });

  it("[SR-204/AK-gnnw] undo brings back a deleted line with its key after the file changed at or after it", () => {
    const outside = (from: number, insert: string): ReturnType<typeof box> => {
      const b = box();
      b.run({ changes: { from: 6, to: 11 } });
      b.run({ changes: { from, insert }, annotations: Transaction.addToHistory.of(false) });
      b.command(undo);
      return b;
    };
    // At the start of "gamma": CodeMirror puts the outside text in front of the line that comes back.
    const start = outside(6, "new ");
    expect(start.text()).toBe("alpha\nnew beta\ngamma");
    expect(start.keys()).toEqual(["kaaa", "kbbb", "kccc"]);
    expect(outside(8, "X").keys()).toEqual(["kaaa", "kbbb", "kccc"]);
    const added = outside(11, "\nomega");
    expect(added.text()).toBe("alpha\nbeta\ngamma\nomega");
    expect(added.keys().slice(0, 3)).toEqual(["kaaa", "kbbb", "kccc"]);
    expect(added.keys()[3]).toMatch(/^[a-z][a-z0-9]{3}$/);
  });

  it("[SR-204/AK-gnnw] undo of a change of the keys alone brings back the keys before it", () => {
    const b = box();
    // "Take the file" with other keys and the same text: a step of its own.
    const { effects } = b.codec.decode(STORED.replace("kbbb", "kzzz"));
    b.run({ effects, userEvent: "input.set" });
    expect(b.keys()).toEqual(["kaaa", "kzzz", "kccc"]);
    b.command(undo);
    expect(b.doc()).toBe(STORED);
    b.command(redo);
    expect(b.keys()).toEqual(["kaaa", "kzzz", "kccc"]);
  });

  it("[SR-204/AK-gnnw] undo after a merge that was saved gives both lines their keys again", () => {
    const b = box();
    b.run({ changes: { from: 5, to: 6 } });
    const saved = b.doc();
    expect(saved).toBe(`kaaa${KEY_MARK}alphabeta\nkccc${KEY_MARK}gamma`);
    // The save answered: the file's document is put in again with the smallest change (none), no undo step.
    const { effects } = b.codec.decode(saved);
    b.run({ effects, annotations: Transaction.addToHistory.of(false) });
    b.command(undo);
    expect(b.doc()).toBe(STORED);
  });

  it("starts without keys for lines that have none, and draws keys with Web Crypto", () => {
    const b = box("plain\n\nkbbb\u001fbeta");
    expect(b.keys()).toEqual([undefined, undefined, "kbbb"]);
    expect(b.doc()).toBe("\u001fplain\n\nkbbb\u001fbeta");
    b.run({ changes: { from: 0, insert: "a " } });
    expect(b.keys()[0]).toBeDefined();
    const draws = Array.from({ length: 200 }, () => webRandom(20));
    expect(draws.every((n) => n >= 0 && n < 20)).toBe(true);
    // An effect whose line start was deleted drops that key; a change without effect keeps the keys at their starts.
    const mapped = setKeys
      .of([{ pos: 7, key: "kbbb" }])
      .map(EditorState.create({ doc: "plain\n\nbeta" }).update({ changes: { from: 6, to: 10 } }).changes);
    expect(mapped?.value).toEqual([]);
  });
});
