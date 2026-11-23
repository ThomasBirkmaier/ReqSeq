// The words of the element graph (SR-111 AK4, SR-136, SR-084 AK4, SR-151 AK1).
import { describe, expect, it } from "vitest";
import type { CommandOutput } from "../catalog.js";
import type { Verifiable } from "./words.js";
import {
  MARK_WORDS,
  REFERENCE_NAME,
  kindName,
  relationNames,
  idTitle,
  ringOf,
  shownId,
  shownIdTitle,
  statusOf,
  typeName,
  verificationWords,
} from "./words.js";

type Edge = CommandOutput<"trace.graph">["edges"][number];

const edge = (link: Partial<Edge>): Edge => ({
  source: "a",
  sourceRepository: "spec",
  target: "b",
  targetRepository: "spec",
  link: "relation",
  outdated: false,
  ...link,
});

describe("graph words", () => {
  it("[SR-136/AK-kvvw] names the status and ring of a requirement and the degree of a need", () => {
    const requirement: Verifiable = {
      verification: [{ view: "core", status: "open" }],
      criteria: { verified: 2, total: 3, notVerified: [{ criterion: 3 }] },
    };
    expect([statusOf(requirement), ringOf(requirement)]).toEqual(["open", { part: 2 / 3, text: "2 of 3" }]);
    expect(verificationWords(requirement)).toEqual(["verification", "open", "2 of 3"]);
    const need: Verifiable = {
      degree: { share: 0.6, total: 5, counts: { open: 2, verified: 3, indirect: 0, failed: 0, outdated: 0 } },
    };
    expect([statusOf(need), ringOf(need), verificationWords(need)]).toEqual([
      undefined,
      { part: 0.6, text: "60 %" },
      ["verification", "60 %"],
    ]);
    expect([ringOf({}), verificationWords({})]).toEqual([undefined, []]);
    expect(MARK_WORDS).toEqual({ outdated: "outdated", superseded: "superseded" });
  });

  it("[SR-084/AK-c2s2] shows the short ID with the identifier, and a type by its name or key", () => {
    expect([shownId("SR-3c90b0", "SR-036"), shownId("SR-3c90b0", " "), shownId("SR-3c90b0")]).toEqual([
      "SR-3c90b0 (SR-036)",
      "SR-3c90b0",
      "SR-3c90b0",
    ]);
    const names = new Map([["need", "Need"]]);
    expect([typeName(names, "need"), typeName(names, "other")]).toEqual(["Need", "other"]);
  });

  it("names an element by its shown ID and title, the title left out when it is the ID's or identifier's text (#545)", () => {
    expect(shownIdTitle("SR-3c90b0", "SR-036", "Title")).toBe("SR-3c90b0 (SR-036) Title");
    expect(shownIdTitle("PKG-1a2b3c", "Später", "Später")).toBe("PKG-1a2b3c (Später)");
    expect(shownIdTitle("N-1a2b3c", undefined, "")).toBe("N-1a2b3c");
    expect([idTitle("VAR-002", "Linux"), idTitle("Später", "Später"), idTitle("N-1")]).toEqual([
      "VAR-002 Linux",
      "Später",
      "N-1",
    ]);
  });

  it("[SR-151/AK-qv2x] names a kind or relation property by the metamodel, else its key, a reference by its word", () => {
    const names = relationNames({
      relations: [{ key: "derives-from", name: "Derives from" }],
      properties: [
        { key: "packages", name: "Package", kind: "relation" },
        { key: "title", name: "Title", kind: "text" },
      ],
    });
    expect([...names]).toEqual([
      ["derives-from", "Derives from"],
      ["property:packages", "Package"],
    ]);
    expect(
      [
        edge({ kind: "derives-from" }),
        edge({ kind: "packages", property: true }),
        edge({ kind: "based-on" }),
        edge({ link: "reference" }),
      ].map((link) => kindName(link, names)),
    ).toEqual(["Derives from", "Package", "based-on", REFERENCE_NAME]);
  });
});
