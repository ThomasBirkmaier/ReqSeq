import { describe, expect, it } from "vitest";
import { isKeyForm, keyFromName, prefixFromName } from "./suggested-key.js";

describe("the key and the prefix the app suggests for a new definition", () => {
  it("[SR-236/AK-n13v] suggests the initials of the words as the prefix of a new type, unless that is no prefix or another type has it", () => {
    expect(prefixFromName("System Requirement", [])).toBe("SR");
    expect(prefixFromName("use-case 2", ["SR"])).toBe("UC2");
    expect(prefixFromName("  glossary   term ", [])).toBe("GT");
    // Another type has it, it starts with a digit, it holds a letter outside A to Z, or the name is empty.
    expect(prefixFromName("Stakeholder Requirement", ["SR"])).toBeUndefined();
    expect(prefixFromName("2nd Need", [])).toBeUndefined();
    expect(prefixFromName("Änderung", [])).toBeUndefined();
    expect(prefixFromName("", [])).toBeUndefined();
  });

  it("[SR-236/AK-n13v] makes the key from the name as the commands make it", () => {
    expect(keyFromName("Größe der Ä-Klasse")).toEqual({ key: "groesse-der-ae-klasse", usable: true });
    expect(keyFromName("2 Wege").usable).toBe(false);
    expect(isKeyForm("a".repeat(65))).toBe(false);
  });
});
