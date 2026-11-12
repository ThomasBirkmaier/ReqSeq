// Whether bytes are an image of a type ReqSeq embeds (`IMAGE_EXTENSIONS`: AVIF, BMP, GIF, JPEG, PNG,
// SVG, WebP), told by their content, not by a file name (SR-207 AK3:
// the export recognises an image by its file signature, since a copy always carries the
// name of its image). Binary types by their leading bytes; SVG as text whose first element, after an
// optional byte order mark, XML declaration, comments, processing instructions and a document type
// declaration, is `<svg`. Nothing is decoded or rendered.

/** Bytes looked at for an SVG's first element; a longer prolog is no image. */
const SVG_PROLOG_BYTES = 64 * 1024;

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/**
 * An ISO base media file whose `ftyp` box names AVIF (`avif`, `avis`) as its major or a compatible
 * brand. A box size of 0 (to the end of the file) or 1 (a 64-bit size follows) reads to the end of
 * the bytes; brands then start after the larger header.
 */
const isAvif = (bytes: Uint8Array): boolean => {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") {
    return false;
  }
  const size = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  const header = size === 1 ? 16 : 8;
  const end = size < 8 ? bytes.length : Math.min(bytes.length, size);
  // The major brand, then the minor version (no brand), then the compatible brands.
  for (let at = header; at + 4 <= end; at += at === header ? 8 : 4) {
    const brand = ascii(bytes, at, at + 4);
    if (brand === "avif" || brand === "avis") {
      return true;
    }
  }
  return false;
};

/** A BMP file: `BM`, the reserved bytes 6 to 9 zero, and a DIB header of a known size at 14. */
const isBmp = (bytes: Uint8Array): boolean =>
  bytes.length >= 18 &&
  ascii(bytes, 0, 2) === "BM" &&
  startsWith(bytes, [0, 0, 0, 0], 6) &&
  [12, 40, 52, 56, 64, 108, 124].includes(
    new DataView(bytes.buffer, bytes.byteOffset + 14, 4).getUint32(0, true),
  );

/** The offset after the next `token` from `from`, or 0 when there is none. */
const after = (text: string, token: string, from: number): number => {
  const found = text.indexOf(token, from);
  return found === -1 ? 0 : found + token.length;
};

/** The offset after the `>` that ends a document type declaration whose name starts at `from`, or 0. */
const doctypeEnd = (text: string, from: number): number => {
  const close = text.indexOf(">", from);
  const open = text.indexOf("[", from);
  if (open === -1 || (close !== -1 && close < open)) {
    return close + 1;
  }
  const subset = text.indexOf("]", open);
  return subset === -1 ? 0 : after(text, ">", subset);
};

/**
 * SVG text: after whitespace, an XML declaration, comments, processing instructions and a document
 * type declaration (with an internal subset in `[...]`), the first element is `<svg`. Scanned once
 * from the front (no backtracking), so a hostile prolog costs linear time.
 */
const isSvg = (bytes: Uint8Array): boolean => {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, SVG_PROLOG_BYTES));
  let at = 0;
  for (;;) {
    while (at < text.length && /\s/u.test(text.charAt(at))) {
      at++;
    }
    if (text.startsWith("<svg", at)) {
      return /[\s/>]/u.test(text.charAt(at + 4));
    }
    const skip = text.startsWith("<?", at)
      ? after(text, "?>", at + 2)
      : text.startsWith("<!--", at)
        ? after(text, "-->", at + 4)
        : text.startsWith("<!DOCTYPE", at)
          ? doctypeEnd(text, at + 9)
          : 0;
    if (skip <= at) {
      return false;
    }
    at = skip;
  }
};

/** Whether `bytes` are an image of a type ReqSeq embeds, by their content. */
export const isImage = (bytes: Uint8Array): boolean =>
  startsWith(bytes, PNG) ||
  startsWith(bytes, JPEG) ||
  ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)) ||
  isBmp(bytes) ||
  (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") ||
  isAvif(bytes) ||
  isSvg(bytes);
