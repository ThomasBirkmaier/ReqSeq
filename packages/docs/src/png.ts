// A decoder for the PNG files the app's Electron tests write (Chromium screenshots: 8 bits per channel, RGB or RGBA,
// not interlaced), so that guide-images.ts can compare pixels without a dependency (#1258). Other PNG kinds throw.
import { inflateSync } from "node:zlib";

/** The pixels of an image, row by row, `channels` bytes per pixel. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** 3 for RGB, 4 for RGBA. */
  readonly channels: 3 | 4;
  readonly data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Bytes per pixel of the colour types this decoder reads: 2 is RGB, 6 is RGBA. */
const CHANNELS: Readonly<Record<number, 3 | 4>> = { 2: 3, 6: 4 };

/** The Paeth predictor of the PNG specification (filter type 4). */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
}

/** Reverses the per-row filters of the inflated image data (PNG specification, section 9). */
function unfilter(inflated: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  if (inflated.length !== height * (stride + 1)) {
    throw new Error(
      `PNG: image data of ${String(inflated.length)} bytes does not fit ${String(width)}×${String(height)}`,
    );
  }
  const data = new Uint8Array(height * stride);
  // DataView reads give numbers, not `number | undefined`: every offset below is inside the arrays.
  const input = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
  const output = new DataView(data.buffer);
  for (let row = 0; row < height; row += 1) {
    const filter = input.getUint8(row * (stride + 1));
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let at = 0; at < stride; at += 1) {
      const left = at >= channels ? output.getUint8(target + at - channels) : 0;
      const up = row > 0 ? output.getUint8(target + at - stride) : 0;
      const upLeft = row > 0 && at >= channels ? output.getUint8(target + at - stride - channels) : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (predictor === undefined) {
        throw new Error(`PNG: unknown filter type ${String(filter)} in row ${String(row)}`);
      }
      output.setUint8(target + at, (input.getUint8(source + at) + predictor) & 0xff);
    }
  }
  return data;
}

/** Decodes a PNG file of 8 bits per channel, RGB or RGBA, not interlaced. */
export function decodePng(bytes: Uint8Array): Pixels {
  if (SIGNATURE.some((byte, at) => bytes[at] !== byte)) {
    throw new Error("PNG: no PNG signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let header: { width: number; height: number; channels: 3 | 4 } | undefined;
  // Each chunk: length, type, data and CRC, which this decoder does not check (zlib checks the image data).
  for (let at = SIGNATURE.length; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      const [depth, colour, interlace] = [
        view.getUint8(at + 16),
        view.getUint8(at + 17),
        view.getUint8(at + 20),
      ];
      const channels = CHANNELS[colour];
      if (depth !== 8 || channels === undefined || interlace !== 0) {
        throw new Error(
          `PNG: only 8-bit RGB or RGBA without interlacing, got depth ${String(depth)}, colour type ${String(colour)}, interlace ${String(interlace)}`,
        );
      }
      header = { width: view.getUint32(at + 8), height: view.getUint32(at + 12), channels };
    } else if (type === "IDAT") {
      parts.push(data);
    }
    at += 12 + length;
  }
  if (header === undefined) {
    throw new Error("PNG: no IHDR chunk");
  }
  const { width, height, channels } = header;
  return {
    width,
    height,
    channels,
    data: unfilter(inflateSync(Buffer.concat(parts)), width, height, channels),
  };
}
