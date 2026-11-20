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
    // Other letters with a diacritic lose it; ø has no decomposition and stays another character.
    expect(keyFromName("Café Order")).toEqual({ key: "cafe-order", usable: true });
    expect(keyFromName("Façade ÉTAT").key).toBe("facade-etat");
    expect(keyFromName("Søren").key).toBe("s-ren");
    // An umlaut with a further mark is still the umlaut.
    expect(keyFromName("L\u01D8 Mu\u0308\u0301ll").key).toBe("lue-muell");
    expect(keyFromName("2 Wege").usable).toBe(false);
    expect(isKeyForm("a".repeat(65))).toBe(false);
  });
});
