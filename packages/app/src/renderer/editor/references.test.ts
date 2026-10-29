import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import { BUILT_IN_RULES, focusState, previewDecorations } from "./preview.js";
import {
  boxReference,
  outdatedKey,
  parseReference,
  referenceAt,
  references,
  referencesIn,
  titleKey,
  titlesField,
} from "./references.js";
import type { OutdatedMark } from "./references.js";
import type { GlyphWidget, LabelWidget } from "./widgets.js";

/** The mark of an outdated reference before its dates are there: the message and the word alone. */
const mark = (message: string): OutdatedMark => ({ message, word: "outdated" });

const ID = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
const THOMAS = `[D-017](reqseq:${ID}?version=n1:1aac78aad3b5e6a8)`;

const stateOf = (doc: string, cursor?: number, titles?: ReadonlyMap<string, string>): EditorState => {
  const state = EditorState.create({
    doc,
    ...(cursor === undefined ? {} : { selection: { anchor: cursor } }),
    extensions: [
      markdownSupport({}),
      focusState,
      ...(titles === undefined ? [] : [titlesField.init(() => titles)]),
    ],
  });
  // `ensureSyntaxTree` parses to the end; the empty update hands that tree to the state, which kept the one of
  // its first parse (cut short after 20 ms on a busy machine, #542).
  ensureSyntaxTree(state, doc.length, 1e9);
  return state.update({}).state;
};

describe("parseReference", () => {
  it("reads the UUID and the version of an inline reference", () => {
    expect(parseReference(`reqseq:${ID}?version=n1:1aac78aad3b5e6a8`)).toEqual({
      id: ID,
      version: "n1:1aac78aad3b5e6a8",
    });
  });

  it("reads the repository, the first of each parameter, and skips empty parameters", () => {
    expect(parseReference(`reqseq:${ID}?version=n1:aa&&repository=other&repository=x&version=n1:bb`)).toEqual(
      {
        id: ID,
        version: "n1:aa",
        repository: "other",
      },
    );
  });

  it("knows a reference without a query, and takes an empty value for none", () => {
    expect(parseReference(`reqseq:${ID}`)).toEqual({ id: ID });
    expect(parseReference(`reqseq:${ID}?`)).toEqual({ id: ID });
    expect(parseReference(`reqseq:${ID}?version=&repository=`)).toEqual({ id: ID });
  });

  it("is undefined for what is no reference", () => {
    expect(parseReference("reqseq:not-a-uuid")).toBeUndefined();
    expect(parseReference("https://example.com")).toBeUndefined();
    expect(parseReference(`xreqseq:${ID}`)).toBeUndefined();
  });
});

describe("referenceAt", () => {
  const doc = `See ${THOMAS} here.`;
  const from = 4;
  const to = from + THOMAS.length;

  it("finds the reference on the label, the brackets and the destination, and right before and after it", () => {
    const state = stateOf(doc);
    for (const pos of [from, from + 1, from + 3, from + 6, from + 10, to - 1, to]) {
      expect(referenceAt(state, pos)).toEqual({
        id: ID,
        version: "n1:1aac78aad3b5e6a8",
        from,
        to,
      });
    }
  });

  it("finds nothing outside the link", () => {
    const state = stateOf(doc);
    expect(referenceAt(state, 0)).toBeUndefined();
    expect(referenceAt(state, from - 1)).toBeUndefined();
    expect(referenceAt(state, to + 1)).toBeUndefined();
    expect(referenceAt(state, doc.length)).toBeUndefined();
  });

  it("finds nothing on an image or on a link that is no reference", () => {
    const image = `![x](reqseq:${ID}?version=n1:aa)`;
    expect(referenceAt(stateOf(image), 3)).toBeUndefined();
    expect(referenceAt(stateOf("[a](https://example.com)"), 2)).toBeUndefined();
    expect(referenceAt(stateOf("[a](reqseq:nope)"), 2)).toBeUndefined();
    expect(referenceAt(stateOf("no link"), 2)).toBeUndefined();
  });
});

describe("the preview of references", () => {
  const KEY = outdatedKey(ID, "n1:1aac78aad3b5e6a8");
  const decorate = (
    doc: string,
    outdated: ReadonlyMap<string, OutdatedMark>,
    cursor?: number,
    titles?: ReadonlyMap<string, string>,
  ) => {
    const state = stateOf(doc, cursor, titles);
    const rules = [...BUILT_IN_RULES, ...(references({ outdated, follow: () => undefined }).rules ?? [])];
    const set: DecorationSet = previewDecorations(state, rules, cursor !== undefined);
    const found: {
      from: number;
      to: number;
      class?: string;
      title?: string;
      widget?: string;
      text?: string;
      glyph?: string;
      hint?: string;
    }[] = [];
    set.between(0, doc.length, (start, end, value) => {
      const spec = value.spec as {
        class?: string;
        attributes?: { title?: string };
        widget?: GlyphWidget | LabelWidget;
      };
      const widget = spec.widget;
      found.push({
        from: start,
        to: end,
        ...(spec.class === undefined ? {} : { class: spec.class }),
        ...(spec.attributes?.title === undefined ? {} : { title: spec.attributes.title }),
        ...(widget === undefined ? {} : { widget: widget.className }),
        ...(widget !== undefined && "text" in widget ? { text: widget.text } : {}),
        ...(widget !== undefined && "glyph" in widget ? { glyph: widget.glyph } : {}),
        ...(widget !== undefined && "hint" in widget && widget.hint !== undefined
          ? { hint: widget.hint }
          : {}),
      });
    });
    return found;
  };
  const label = { from: 1, to: 6 };

  it("marks the label of a reference", () => {
    const found = decorate(THOMAS, new Map());
    expect(found.filter((entry) => entry.class === "cm-lr-ref")).toEqual([{ ...label, class: "cm-lr-ref" }]);
    expect(found.some((entry) => entry.class?.includes("cm-lr-outdated") === true)).toBe(false);
    expect(found.some((entry) => entry.widget === "cm-lr-outdated-word")).toBe(false);
  });

  it("marks an outdated reference with the accent, the hint as title and the word after it", () => {
    const found = decorate(THOMAS, new Map([[KEY, mark("points to an older version")]]));
    expect(found.filter((entry) => entry.class === "cm-lr-ref cm-lr-outdated")).toEqual([
      { ...label, class: "cm-lr-ref cm-lr-outdated", title: "points to an older version" },
    ]);
    expect(found.filter((entry) => entry.widget === "cm-lr-outdated-word")).toEqual([
      { from: THOMAS.length, to: THOMAS.length, widget: "cm-lr-outdated-word", glyph: " outdated" },
    ]);
  });

  it("[SR-110/AK2] shows the date of the version the reference stores in the word, and the dated hint as title", () => {
    const message =
      "points to an older version: stored version from 2026-03-04T10:00:00Z, current version from …";
    const found = decorate(THOMAS, new Map([[KEY, { message, word: "outdated · version of 2026-03-04" }]]));
    expect(found.filter((entry) => entry.class === "cm-lr-ref cm-lr-outdated")).toEqual([
      { ...label, class: "cm-lr-ref cm-lr-outdated", title: message },
    ]);
    expect(found.filter((entry) => entry.widget === "cm-lr-outdated-word")).toEqual([
      {
        from: THOMAS.length,
        to: THOMAS.length,
        widget: "cm-lr-outdated-word",
        glyph: " outdated · version of 2026-03-04",
      },
    ]);
  });

  it("shows no word on a line whose source is shown", () => {
    const found = decorate(THOMAS, new Map([[KEY, mark("old")]]), 3);
    expect(found.some((entry) => entry.class === "cm-lr-ref cm-lr-outdated")).toBe(true);
    expect(found.some((entry) => entry.widget === "cm-lr-outdated-word")).toBe(false);
  });

  it("takes the repository of the link into account, and a reference without a version is never outdated", () => {
    const withRepository = `[x](reqseq:${ID}?version=n1:aa&repository=other repo)`;
    const outdated = new Map([[outdatedKey(ID, "n1:aa", "other%20repo"), mark("old")]]);
    // A space ends a Markdown destination, so the repository is written with %20.
    const encoded = `[x](reqseq:${ID}?version=n1:aa&repository=other%20repo)`;
    expect(decorate(withRepository, outdated).some((entry) => entry.title === "old")).toBe(false);
    expect(
      decorate(encoded, new Map([[outdatedKey(ID, "n1:aa", "other%2520repo"), mark("old")]])).length,
    ).toBeGreaterThan(0);
    expect(
      decorate(encoded, new Map([[outdatedKey(ID, "n1:aa"), mark("old")]])).some(
        (entry) => entry.title !== undefined,
      ),
    ).toBe(false);
    expect(
      decorate(`[x](reqseq:${ID})`, new Map([[outdatedKey(ID, "n1:aa"), mark("old")]])).some(
        (entry) => entry.title === "old",
      ),
    ).toBe(false);
  });

  describe("a reference to another repository whose target is here (D-058)", () => {
    const ACROSS = `[N-0e9d](reqseq:${ID}?version=n1:aa&repository=sensor)`;
    const TITLES = new Map([[titleKey(ID, "sensor"), "Measure gusts"]]);
    const across = { from: 1, to: 7 };

    it("[SR-066/AK2] shows the title of the target in place of the short ID, with the look of the label", () => {
      expect(
        decorate(ACROSS, new Map(), undefined, TITLES).filter((entry) => entry.text !== undefined),
      ).toEqual([{ ...across, widget: "cm-lr-link cm-lr-ref cm-lr-title", text: "Measure gusts" }]);
    });

    it("[SR-066/AK2] shows the short ID on the line that shows its source, and for a target without a title", () => {
      expect(decorate(ACROSS, new Map(), 3, TITLES).some((entry) => entry.text !== undefined)).toBe(false);
      // The same reference off the source line shows the title.
      expect(
        decorate(`${ACROSS}\n\nnext`, new Map(), ACROSS.length + 3, TITLES).some(
          (entry) => entry.text !== undefined,
        ),
      ).toBe(true);
      expect(decorate(ACROSS, new Map()).some((entry) => entry.text !== undefined)).toBe(false);
      expect(
        decorate(
          `[N-0e9d](reqseq:${ID}?version=n1:aa)`,
          new Map(),
          undefined,
          new Map([[titleKey(ID, ""), "x"]]),
        ).some((entry) => entry.text !== undefined),
      ).toBe(false);
    });

    it("keeps the accent, the hint and the word of an outdated reference on the title", () => {
      const outdated = new Map([[outdatedKey(ID, "n1:aa", "sensor"), mark("old")]]);
      expect(
        decorate(ACROSS, outdated, undefined, TITLES).filter((entry) => entry.widget !== undefined),
      ).toEqual([
        {
          ...across,
          widget: "cm-lr-link cm-lr-ref cm-lr-outdated cm-lr-title",
          text: "Measure gusts",
          hint: "old",
        },
        { from: ACROSS.length, to: ACROSS.length, widget: "cm-lr-outdated-word", glyph: " outdated" },
      ]);
    });
  });

  it("marks nothing for a link that is no reference or has no label", () => {
    const found = decorate(`[a](https://example.com) [](reqseq:${ID}?version=n1:aa)`, new Map());
    expect(found.some((entry) => entry.class === "cm-lr-ref")).toBe(false);
  });
});

describe("referencesIn", () => {
  it("[SR-127/AK3] gives the inline references of the document in order, and none for other links or images", () => {
    const other = "[x](https://example.com) ![i](reqseq:" + ID + ")";
    const doc = `${other} ${THOMAS} and [w](reqseq:${ID}?repository=r)`;
    const found = referencesIn(stateOf(doc));
    expect(found.map((reference) => [reference.id, reference.version, reference.repository])).toEqual([
      [ID, "n1:1aac78aad3b5e6a8", undefined],
      [ID, undefined, "r"],
    ]);
    expect(referencesIn(stateOf("plain"))).toEqual([]);
  });
});

describe("boxReference", () => {
  const doc = `see ${THOMAS} and [B](reqseq:${ID}?version=n1:2)`;
  const box = (cursor: number, focused: boolean) => {
    const state = stateOf(doc, cursor);
    return { state: () => state, hasFocus: () => focused };
  };

  it("takes the reference at the caret of a Markdown box with the focus, else the first one; none in a plain box", () => {
    expect(boxReference(box(6, true), true)).toEqual(referenceAt(stateOf(doc, 6), 6));
    expect(boxReference(box(6, true), true)).toBeDefined();
    expect(boxReference(box(0, true), true)).toBeUndefined();
    expect(boxReference(box(0, false), true)).toEqual(referencesIn(stateOf(doc, 0))[0]);
    expect(boxReference(box(6, true), false)).toBeUndefined();
  });
});
