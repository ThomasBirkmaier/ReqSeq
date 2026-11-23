// How the Windows recorder names a write (record-windows.ts); no Windows needed.
import { describe, expect, it } from "vitest";
import { descendants, fileEvents, parseFileLines } from "./record-windows.js";

const named = (raw: string): string => raw.toLowerCase();

describe("the Windows recorder's process tree", () => {
  it("takes a parent as the process that held its ID when the child started, as Windows reuses IDs", () => {
    const at = (pid: number, parent: number, program: string) => ({ pid, parent, program, commandLine: "" });
    const created = [
      at(7, 1, "control.exe"), // before the shell, under the ID the shell gets later
      at(9, 7, "child-of-control.exe"),
      at(7, 1, "reqseq-shell.exe"),
      at(8, 7, "server.exe"),
      at(5, 1, "other.exe"), // under an ID that a process of the tree takes later
      at(5, 8, "git.exe"),
      at(6, 5, "conhost.exe"),
    ];
    expect([...descendants(created, 2)].map((i) => created[i]?.program)).toEqual([
      "reqseq-shell.exe",
      "server.exe",
      "git.exe",
      "conhost.exe",
    ]);
  });
});

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

  it("names a write on an inherited handle from the Create of the process that made it, and reports no open for it", () => {
    const lines = parseFileLines(
      ["12\t1\t0xP\t\t0x02000000\t\\Device\\NamedPipe\\uv\\stdout", "16\t100\t0xP\t0xKP\t\t"].join("\n"),
    );
    const { opens, writes } = fileEvents(lines, new Set([100]), named);
    expect(opens).toEqual([]);
    expect(writes.map((w) => [w.raw, w.write, w.unnamed])).toEqual([
      ["\\Device\\NamedPipe\\uv\\stdout", true, false],
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
