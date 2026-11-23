// How the Windows recorder names a write (record-windows.ts); no Windows needed.
import { describe, expect, it } from "vitest";
import { fileEvents, parseFileLines } from "./record-windows.js";

const named = (raw: string): string => raw.toLowerCase();

describe("the Windows recorder's file events", () => {
  it("names a write after the Create before it, though the kernel reuses the file object later", () => {
    const lines = parseFileLines(
      [
        "12\t100\t0xA\t0xK1\t0x01000000\t\\Device\\HarddiskVolume3\\x\\secret.log",
        "16\t100\t0xA\t0xK1\t\t",
        "12\t100\t0xA\t0xK2\t0x01000000\t\\Device\\HarddiskVolume3\\x\\other.txt",
      ].join("\r\n"),
    );
    const { writes } = fileEvents(lines, new Set([100]), named);
    expect(writes).toEqual([
      {
        pid: 100,
        path: "\\device\\harddiskvolume3\\x\\secret.log",
        raw: "\\Device\\HarddiskVolume3\\x\\secret.log",
        write: true,
        unnamed: false,
      },
    ]);
  });

  it("names a write through its file key when its process created no file object, and marks one with no name", () => {
    const lines = parseFileLines(
      [
        "10\t4\t\t0xK1\t\t\\Device\\HarddiskVolume3\\x\\a.txt",
        "16\t100\t0xB\t0xK1\t\t",
        "10\t4\t\t0xK1\t\t\\Device\\HarddiskVolume3\\x\\b.txt",
        "16\t100\t0xC\t0xK9\t\t",
        "16\t200\t0xD\t0xK1\t\t",
      ].join("\n"),
    );
    const { writes } = fileEvents(lines, new Set([100]), named);
    expect(writes.map((w) => [w.path, w.unnamed])).toEqual([
      ["\\device\\harddiskvolume3\\x\\a.txt", false],
      [undefined, true],
    ]);
  });

  it("counts a Create that may write as a write, and one with FILE_OPEN as an open only", () => {
    const lines = parseFileLines(
      [
        "12\t100\t0xA\t\t0x01000000\tC:\\x\\opened.txt",
        "12\t100\t0xB\t\t0x05000000\tC:\\x\\replaced.txt",
        "30\t100\t0xC\t\t0x02000000\tC:\\x\\new.txt",
      ].join("\n"),
    );
    const { opens, writes } = fileEvents(lines, new Set([100]), named);
    expect(opens.map((o) => o.path)).toEqual(["c:\\x\\opened.txt", "c:\\x\\replaced.txt", "c:\\x\\new.txt"]);
    expect(writes.map((w) => [w.path, w.write])).toEqual([
      ["c:\\x\\replaced.txt", false],
      ["c:\\x\\new.txt", false],
    ]);
  });
});
