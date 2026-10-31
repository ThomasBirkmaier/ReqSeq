// Containers of the app icon (#410): a Windows .ico and a macOS .icns hold PNG images as they are, so both
// are written here without an image library. Pure functions; generate.mjs renders the PNGs.
import { Buffer } from "node:buffer";

/** The size in pixels of a PNG, read from its IHDR chunk. */
export const pngSize = (png) => {
  if (png.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("not a PNG");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

/** A .ico file with one PNG entry per image (Windows Vista and later read PNG entries). */
export const icoFile = (pngs) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map((png) => {
    const { width, height } = pngSize(png);
    const entry = Buffer.alloc(16);
    // 0 stands for 256 px.
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
};

/** The PNG types of an .icns file and the pixel size each one holds. */
export const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];

/** An .icns file from PNGs by pixel size; every size of ICNS_TYPES must be there. */
export const icnsFile = (pngsBySize) => {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const png = pngsBySize.get(size);
    if (png === undefined || pngSize(png).width !== size) {
      throw new Error(`no ${size} px PNG for ${type}`);
    }
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
};

/** The master drawing without the margin of the macOS grid: the rounded square fills the canvas. */
export const fullBleed = (svg) => {
  const cropped = svg.replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"');
  if (cropped === svg) {
    throw new Error("the master drawing has no 1024 px viewBox");
  }
  return cropped;
};
