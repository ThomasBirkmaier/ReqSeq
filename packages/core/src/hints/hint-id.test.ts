// The hint IDs of outdated relations (SR-025) and of changed core requirements at a replacement
// (SR-045), which hint.confirm (SR-027) resolves: every ID parses back to what it names, and nothing
// else parses.
import { describe, expect, it } from "vitest";
import type { HintTarget } from "./hint-id.js";
import { hintIdOf, parseHintId } from "./hint-id.js";

const S = "5e025a7d-2b4f-4c61-9d08-0b0000000001";
const T = "5e025a7d-2b4f-4c61-9d08-0a0000000001";
const VERSION = "n1:323df2732ed684b0";
const AT = {
  code: "relation.outdated",
  sourceRepository: "system",
  file: "requirements/SR-0b0000000001.md",
  source: S,
} as const;
/** The place as an ID writes it. */
const PLACE = `system/requirements%2FSR-0b0000000001.md/${S}`;

describe("hint IDs of outdated relations (SR-025, D-042)", () => {
  it("parses every ID back to the relation item or reference it names", () => {
    const targets: HintTarget[] = [
      { kind: "relation", ...AT, key: "derives-from", target: T, version: VERSION },
      { kind: "relation", ...AT, key: "validity", target: T, repository: "sensor", version: VERSION },
      { kind: "reference", ...AT, target: T, version: VERSION, occurrence: 1 },
      { kind: "reference", ...AT, target: T, repository: "a b&c=d/é", version: VERSION, occurrence: 12 },
      { kind: "reference", ...AT, target: T, repository: "", version: VERSION, occurrence: 2 },
      {
        kind: "reference",
        ...AT,
        target: T,
        version: VERSION,
        occurrence: 3,
        property: "acceptance-criteria",
      },
      {
        kind: "reference",
        ...AT,
        target: T,
        repository: "sensor",
        version: VERSION,
        occurrence: 1,
        property: "text",
      },
      {
        kind: "relation",
        ...AT,
        sourceRepository: "a b/c",
        file: "x y/z.md",
        key: "refines",
        target: T,
        version: VERSION,
      },
    ];
    const ids = targets.map(hintIdOf);
    expect(ids.slice(0, 3)).toEqual([
      `relation.outdated/${PLACE}/derives-from/${T}?version=${VERSION}`,
      `relation.outdated/${PLACE}/validity/${T}?version=${VERSION}&repository=sensor`,
      `relation.outdated/${PLACE}/@text/${T}?version=${VERSION}&n=1`,
    ]);
    expect(ids.map(parseHintId)).toEqual(targets);
  });

  it("[SR-127/AK3] names the property of a reference in a Markdown property behind @text:, apart from the text", () => {
    const id = (place: string, query = ""): string =>
      `relation.outdated/${PLACE}/${place}/${T}?version=${VERSION}${query}`;
    expect(
      hintIdOf({ kind: "reference", ...AT, target: T, version: VERSION, occurrence: 3, property: "text" }),
    ).toBe(id("@text:text", "&n=3"));
    expect(parseHintId(id("@text:acceptance-criteria", "&n=2"))).toEqual({
      kind: "reference",
      ...AT,
      target: T,
      version: VERSION,
      occurrence: 2,
      property: "acceptance-criteria",
    });
    // The text keeps its own ID, and a property of the same key is another place.
    expect(parseHintId(id("@text", "&n=2"))).not.toHaveProperty("property");
  });

  it("names a changed core requirement at the replaces item of a variant requirement (SR-045)", () => {
    const target: HintTarget = {
      kind: "relation",
      ...AT,
      code: "variant.core-changed",
      key: "replaces",
      target: T,
      repository: "core",
      version: VERSION,
    };
    const id = `variant.core-changed/${PLACE}/replaces/${T}?version=${VERSION}&repository=core`;
    expect(hintIdOf(target)).toBe(id);
    expect(parseHintId(id)).toEqual(target);
    // The same place with the other code is another hint.
    expect(parseHintId(id.replace("variant.core-changed", "relation.outdated"))).toMatchObject({
      code: "relation.outdated",
    });
  });

  it.each([
    ["no query", `relation.outdated/${PLACE}/derives-from/${T}`],
    ["another code", `relation.missing-target/${PLACE}/derives-from/${T}?version=${VERSION}`],
    ["too few segments", `relation.outdated/${PLACE}/${T}?version=${VERSION}`],
    ["the code only", `relation.outdated?version=${VERSION}`],
    ["no source repository", `relation.outdated//f.md/${S}/derives-from/${T}?version=${VERSION}`],
    ["no source file", `relation.outdated/system//${S}/derives-from/${T}?version=${VERSION}`],
    [
      "a source file that cannot be decoded",
      `relation.outdated/system/%E0/${S}/derives-from/${T}?version=${VERSION}`,
    ],
    [
      "a source repository that cannot be decoded",
      `relation.outdated/%E0/f.md/${S}/derives-from/${T}?version=${VERSION}`,
    ],
    ["too many segments", `relation.outdated/${PLACE}/derives-from/${T}/x?version=${VERSION}`],
    ["a source that is no UUID", `relation.outdated/system/f.md/SR-1/derives-from/${T}?version=${VERSION}`],
    ["a target that is no UUID", `relation.outdated/${PLACE}/derives-from/x?version=${VERSION}`],
    ["an unknown parameter", `relation.outdated/${PLACE}/derives-from/${T}?version=${VERSION}&line=3`],
    ["a parameter without value", `relation.outdated/${PLACE}/derives-from/${T}?version=${VERSION}&n`],
    ["no version", `relation.outdated/${PLACE}/derives-from/${T}?repository=x`],
    ["a version twice", `relation.outdated/${PLACE}/derives-from/${T}?version=${VERSION}&version=${VERSION}`],
    ["a malformed version", `relation.outdated/${PLACE}/derives-from/${T}?version=n1:xyz`],
    [
      "a repository that cannot be decoded",
      `relation.outdated/${PLACE}/derives-from/${T}?version=${VERSION}&repository=%E0`,
    ],
    ["a key that is no key", `relation.outdated/${PLACE}/Derives/${T}?version=${VERSION}`],
    ["a relation with a place", `relation.outdated/${PLACE}/derives-from/${T}?version=${VERSION}&n=1`],
    ["a reference without its place", `relation.outdated/${PLACE}/@text/${T}?version=${VERSION}`],
    ["a property reference without its key", `relation.outdated/${PLACE}/@text:/${T}?version=${VERSION}&n=1`],
    [
      "a property reference with a key that is no key",
      `relation.outdated/${PLACE}/@text:Notes/${T}?version=${VERSION}&n=1`,
    ],
    [
      "a property reference without its place",
      `relation.outdated/${PLACE}/@text:notes/${T}?version=${VERSION}`,
    ],
    [
      "a changed core requirement in the text",
      `variant.core-changed/${PLACE}/@text/${T}?version=${VERSION}&n=1`,
    ],
    [
      "a changed core requirement in a Markdown property",
      `variant.core-changed/${PLACE}/@text:notes/${T}?version=${VERSION}&n=1`,
    ],
    ["an unknown code prefix", `variant.nested/${PLACE}/replaces/${T}?version=${VERSION}`],
    ["a reference with place 0", `relation.outdated/${PLACE}/@text/${T}?version=${VERSION}&n=0`],
  ])("rejects an ID with %s", (_case, id) => {
    expect(parseHintId(id)).toBeUndefined();
  });
});
