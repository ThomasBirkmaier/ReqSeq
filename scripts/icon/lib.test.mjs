import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { ICNS_TYPES, fullBleed, icnsFile, icoFile, pngSize } from "./lib.mjs";

/** The first 24 bytes of a PNG of the given size: signature, IHDR length and type, width and height. */
const png = (size) => {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(size, 16);
  bytes.writeUInt32BE(size, 20);
  return bytes;
};

describe("app icon containers", () => {
  it("reads the size of a PNG and refuses other data", () => {
    expect(pngSize(png(48))).toEqual({ width: 48, height: 48 });
    expect(() => pngSize(Buffer.alloc(24))).toThrow("not a PNG");
  });

  it("writes an .ico with one entry per PNG, 256 px as 0", () => {
    const ico = icoFile([png(16), png(256)]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico.readUInt8(6)).toBe(16);
    expect(ico.readUInt8(22)).toBe(0);
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 32);
    expect(ico.readUInt32LE(22 + 12)).toBe(6 + 32 + 24);
    expect(ico.length).toBe(6 + 32 + 48);
  });

  it("writes an .icns with every type and refuses a missing size", () => {
    const sizes = new Map([16, 32, 64, 128, 256, 512, 1024].map((size) => [size, png(size)]));
    const icns = icnsFile(sizes);
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns.toString("ascii", 8, 12)).toBe(ICNS_TYPES[0][0]);
    sizes.delete(1024);
    expect(() => icnsFile(sizes)).toThrow("no 1024 px PNG for ic10");
  });

  it("crops the macOS margin off the master drawing", () => {
    expect(fullBleed('<svg viewBox="0 0 1024 1024"/>')).toBe('<svg viewBox="100 100 824 824"/>');
    expect(() => fullBleed("<svg/>")).toThrow("no 1024 px viewBox");
  });
});
