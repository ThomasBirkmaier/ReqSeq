// isImage (SR-207 AK3): an image of a type ReqSeq embeds, by its content.
import { describe, expect, it } from "vitest";
import { isImage } from "./image-type.js";

const bytes = (...parts: (string | readonly number[] | Uint8Array)[]): Uint8Array =>
  Buffer.concat(
    parts.map((part) => (typeof part === "string" ? Buffer.from(part, "utf8") : Uint8Array.from(part))),
  );
/** An `ftyp` box of `size` bytes with major brand `major` and the compatible brands `rest`. */
const ftyp = (size: number, major: string, ...rest: string[]): Uint8Array =>
  bytes([0, 0, 0, size], "ftyp", major, [0, 0, 0, 0], ...rest);

describe("isImage", () => {
  it.each([
    ["PNG", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest")],
    ["JPEG", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["GIF 87a", bytes("GIF87a")],
    ["GIF 89a", bytes("GIF89a")],
    ["BMP", bytes("BM", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 0, 0, 0])],
    ["WebP", bytes("RIFF", [1, 0, 0, 0], "WEBPVP8 ")],
    ["AVIF major brand", ftyp(16, "avif")],
    ["AVIF compatible brand", ftyp(28, "mif1", "miaf", "avis", "mif1")],
    ["AVIF box to the end of the file", ftyp(0, "avif")],
    [
      "AVIF box with a 64-bit size",
      bytes([0, 0, 0, 1], "ftyp", [0, 0, 0, 0, 0, 0, 0, 32], "avif", [0, 0, 0, 0]),
    ],
    ["SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    [
      "SVG with prolog",
      bytes(
        '\uFEFF\n<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [ <!ENTITY a "b"> ]>\n<?pi?>\n<svg>',
      ),
    ],
  ])("takes %s", (_name, content) => {
    expect(isImage(content)).toBe(true);
  });

  it.each([
    ["text", bytes("notes\n")],
    ["text starting with BM", bytes("BMW notes, long enough\n")],
    ["BM with a DIB header of no known size", bytes("BM", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 41, 0, 0, 0])],
    ["an unclosed comment", bytes("<!-- <svg>")],
    ["an unclosed declaration", bytes("<?xml <svg>")],
    ["an unclosed document type", bytes("<!DOCTYPE svg [ <svg>")],
    ["a document type without its end", bytes("<!DOCTYPE svg")],
    ["a document type whose subset has no end", bytes("<!DOCTYPE svg [ ] <svg>")],
    ["an element named svgx", bytes("<svgx/>")],
    ["empty", bytes("")],
    ["RIFF that is no WebP", bytes("RIFF", [1, 0, 0, 0], "WAVEfmt ")],
    ["ftyp without an AVIF brand", ftyp(24, "mp41", "isom", "mp42")],
    ["AVIF brand after the box", bytes(ftyp(16, "mp41"), "avif")],
    ["short ftyp", bytes([0, 0, 0, 12], "ftypavif")],
    ["XML of another root", bytes('<?xml version="1.0"?><html><svg/></html>')],
    ["a long prolog", bytes(`<!--${"x".repeat(70_000)}-->`, "<svg>")],
  ])("refuses %s", (_name, content) => {
    expect(isImage(content)).toBe(false);
  });

  it("stays linear on a long run of comments that ends in no SVG", () => {
    const started = performance.now();
    expect(isImage(bytes("<!---->".repeat(5_000), "<?a?>".repeat(5_000), "x"))).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
