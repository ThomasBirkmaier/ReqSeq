import { describe, expect, it } from "vitest";
import { normalizeText } from "../version/version.js";
import { bodyForText, elementText } from "./text.js";

describe("elementText", () => {
  it("leaves out the one blank line after the closing frontmatter line (#308)", () => {
    expect(elementText("\nText\n")).toBe("Text\n");
    expect(elementText("\r\nText\r\n")).toBe("Text\r\n");
    expect(elementText("\n\nText\n")).toBe("\nText\n");
    expect(elementText("\n")).toBe("");
  });

  it("keeps a body without that blank line as it is", () => {
    expect(elementText("Text\n")).toBe("Text\n");
    expect(elementText("Text")).toBe("Text");
    expect(elementText(" \nText\n")).toBe(" \nText\n");
    expect(elementText("")).toBe("");
  });
});

describe("bodyForText", () => {
  it("changes nothing when the text is the stored one, also when only line breaks differ", () => {
    for (const body of ["\nText\n", "Text\n", "Text", "\r\nOne\r\nTwo", "\n", "", "\n\nText"]) {
      expect(bodyForText(body, elementText(body))).toBe(body);
    }
    expect(bodyForText("\r\nOne\r\nTwo\r\n", "One\nTwo\n")).toBe("\r\nOne\r\nTwo\r\n");
  });

  it("adds the final newline to a new text (#308)", () => {
    expect(bodyForText("\nOld\n", "New")).toBe("\nNew\n");
    expect(bodyForText("\nOld\n", "New\n")).toBe("\nNew\n");
  });

  it("writes LF for CR and CRLF in a new text", () => {
    expect(bodyForText("\nOld\n", "One\r\nTwo\rThree")).toBe("\nOne\nTwo\nThree\n");
  });

  it("keeps the layout of the file: with the blank line, or without it as written by hand", () => {
    expect(bodyForText("\nOld\n", "New")).toBe("\nNew\n");
    expect(bodyForText("\r\nOld\r\n", "New")).toBe("\r\nNew\n");
    expect(bodyForText("Old\n", "New")).toBe("New\n");
    // A text that starts with a blank line needs the separator, else it would read back without it.
    expect(bodyForText("Old\n", "\nNew")).toBe("\n\nNew\n");
  });

  it("gives a file without text the blank line, and writes an empty text as nothing", () => {
    expect(bodyForText("", "New")).toBe("\nNew\n");
    expect(bodyForText("\nOld\n", "")).toBe("");
    expect(bodyForText("", "")).toBe("");
  });

  it("round-trips: the text of the new body is the given text with a final newline", () => {
    for (const body of ["", "\nOld\n", "Old"]) {
      for (const text of ["New", "New\n", "\nNew\n", "\n"]) {
        const written = bodyForText(body, text);
        expect(elementText(written)).toBe(text.endsWith("\n") ? text : `${text}\n`);
        expect(bodyForText(written, elementText(written))).toBe(written);
      }
    }
  });

  it("never changes what counts to the version: the blank line and the final newline are no content (ADR-0005)", () => {
    for (const text of ["New", "One\r\nTwo"]) {
      expect(normalizeText(bodyForText("", text))).toBe(normalizeText(text));
      expect(normalizeText(bodyForText("Old", text))).toBe(normalizeText(text));
    }
  });
});
