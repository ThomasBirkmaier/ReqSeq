import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png.js";

/** A chunk with a dummy CRC, which the decoder does not read. */
function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

function header(width: number, height: number, colour: number, depth = 8, interlace = 0): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.set([depth, colour, 0, 0, interlace], 8);
  return chunk("IHDR", data);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Encodes `rows` with filter `filters[row]` each, the way an encoder does, split over two IDAT chunks. */
function encode(width: number, channels: 3 | 4, rows: number[][], filters: number[]): Buffer {
  const stride = width * channels;
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const raw = rows.flatMap((row, y) => {
    const filter = filters[y] ?? 0;
    const previous = rows[y - 1] ?? [];
    return [
      filter,
      ...row.map((value, x) => {
        const left = x >= channels ? (row[x - channels] ?? 0) : 0;
        const up = previous[x] ?? 0;
        const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0;
        const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter] ?? 0;
        return (value - predictor) & 0xff;
      }),
    ];
  });
  expect(raw.length).toBe(rows.length * (stride + 1));
  const deflated = deflateSync(Uint8Array.from(raw));
  const half = deflated.length >> 1;
  return Buffer.concat([
    SIGNATURE,
    header(width, rows.length, channels === 3 ? 2 : 6),
    chunk("tEXt", Buffer.from("Software\0test", "latin1")),
    chunk("IDAT", deflated.subarray(0, half)),
    chunk("IDAT", deflated.subarray(half)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("decodePng", () => {
  it("reverses each of the five filters, RGB and RGBA", () => {
    const rows = [0, 1, 2, 3, 4].map((y) => [10 + y, 200, 30 * y, 250, 7 * y, 99, 255, y]);
    const rgba = decodePng(encode(2, 4, rows, [0, 1, 2, 3, 4]));
    expect(rgba).toMatchObject({ width: 2, height: 5, channels: 4 });
    expect(Array.from(rgba.data)).toEqual(rows.flat());
    const rgbRows = rows.map((row) => row.slice(0, 6));
    const rgb = decodePng(encode(2, 3, rgbRows, [4, 3, 2, 1, 0]));
    expect(rgb).toMatchObject({ width: 2, height: 5, channels: 3 });
    expect(Array.from(rgb.data)).toEqual(rgbRows.flat());
  });

  it("reads a committed screenshot of the guide", async () => {
    const png = await readFile(
      fileURLToPath(new URL("../../../docs/guide/images/app-overview.png", import.meta.url)),
    );
    const image = decodePng(png);
    expect(image).toMatchObject({ width: 1024, height: 576, channels: 3 });
    expect(image.data.length).toBe(1024 * 576 * 3);
  });

  it("refuses what is no PNG of 8-bit RGB or RGBA", () => {
    expect(() => decodePng(Buffer.from("GIF89a"))).toThrow("no PNG signature");
    expect(() => decodePng(Buffer.concat([SIGNATURE, chunk("IEND", Buffer.alloc(0))]))).toThrow(
      "no IHDR chunk",
    );
    expect(() => decodePng(Buffer.concat([SIGNATURE, header(1, 1, 2, 16)]))).toThrow(
      "got depth 16, colour type 2",
    );
    expect(() => decodePng(Buffer.concat([SIGNATURE, header(1, 1, 3)]))).toThrow("colour type 3");
    expect(() => decodePng(Buffer.concat([SIGNATURE, header(1, 1, 6, 8, 1)]))).toThrow("interlace 1");
  });

  it("refuses image data that does not fit the size or has an unknown filter", () => {
    const short = Buffer.concat([
      SIGNATURE,
      header(2, 1, 2),
      chunk("IDAT", deflateSync(Uint8Array.from([0, 1, 2]))),
    ]);
    expect(() => decodePng(short)).toThrow("image data of 3 bytes does not fit 2×1");
    const bad = Buffer.concat([
      SIGNATURE,
      header(1, 1, 2),
      chunk("IDAT", deflateSync(Uint8Array.from([5, 1, 2, 3]))),
    ]);
    expect(() => decodePng(bad)).toThrow("unknown filter type 5 in row 0");
  });
});
