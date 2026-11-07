// The completion of a typed path (SR-143), without the prompt: which folder is asked, how often, and the
// choices made of its entries. Not tagged: the AKs describe the command prompt, which the Electron specs
// show (test/path-completion.spec.ts).
import { describe, expect, it, vi } from "vitest";
import type { FolderListing } from "../shared/protocol.js";
import type { ListingAnswer } from "./path-completion.js";
import { SHOWN_ENTRIES, entryChoices, pathSeeker, splitPath } from "./path-completion.js";

const ENTRIES: FolderListing["entries"] = [
  { name: "docs", kind: "folder" },
  { name: "out", kind: "link" },
  { name: "export.reqif", kind: "file" },
  { name: "o-notes.md", kind: "file" },
];

const seeker = (answer: ListingAnswer = { folder: "/w", name: "", entries: ENTRIES }, alone?: boolean) => {
  const list = vi.fn(() => Promise.resolve(answer));
  return { list, seek: pathSeeker({ list, windows: false, ...(alone === undefined ? {} : { alone }) }) };
};

describe("path completion", () => {
  it("splits at the last separator, a backslash only on Windows", () => {
    expect(splitPath("~/pro", false)).toEqual({ folder: "~/", name: "pro" });
    expect(splitPath("a\\b", false)).toEqual({ folder: "", name: "a\\b" });
    expect(splitPath("C:\\Work/x\\sp", true)).toEqual({ folder: "C:\\Work/x\\", name: "sp" });
    expect(splitPath("name", true)).toEqual({ folder: "", name: "name" });
  });

  it("narrows the entries by the typed name, folders and links before files, with the letters marked", () => {
    const choices = entryChoices(ENTRIES, "out/", "o", false);
    // "out" and "o-notes.md" match at the start of a word, so each comes first among its kind.
    expect(choices.map((choice) => [choice.name, choice.complete, choice.hint])).toEqual([
      ["out/", "out/out/", "link"],
      ["docs/", "out/docs/", undefined],
      ["o-notes.md", "out/o-notes.md", undefined],
      ["export.reqif", "out/export.reqif", undefined],
    ]);
    expect(choices[0]?.marks).toEqual([[0, 1]]);
    // A folder typed without a separator gets the platform's; one typed gets the one typed last.
    expect(entryChoices(ENTRIES, "", "do", true)[0]?.complete).toBe("docs\\");
    expect(entryChoices(ENTRIES, "", "do", false)[0]?.complete).toBe("docs/");
    expect(entryChoices(ENTRIES, "C:\\w/", "do", true)[0]?.complete).toBe("C:\\w/docs/");
    // Choosing one runs nothing: it only completes.
    expect(choices[0]?.run()).toBeUndefined();
  });

  it("asks ahead for the folder a typed name names, so the separator after it finds its listing", async () => {
    const { list, seek } = seeker();
    await seek("/w/doc");
    expect(list.mock.calls).toEqual([["/w/"]]);
    await seek("/w/docs");
    expect(list.mock.calls).toEqual([["/w/"], ["/w/docs/"]]);
    await seek("/w/docs/");
    expect(list).toHaveBeenCalledTimes(2);
    // Without a folder typed, with the platform's separator; a file is not asked ahead.
    const windows = vi.fn(() =>
      Promise.resolve<ListingAnswer>({ folder: "C:\\w", name: "", entries: ENTRIES }),
    );
    await pathSeeker({ list: windows, windows: true })("out");
    expect(windows.mock.calls).toEqual([[""], ["out\\"]]);
    await pathSeeker({ list: windows, windows: true })("export.reqif");
    expect(windows).toHaveBeenLastCalledWith("");
  });

  it("narrows by the start of the name when the typed name has no letters (a dot)", () => {
    const dotted: FolderListing["entries"] = [
      { name: ".git", kind: "folder" },
      { name: "a.b", kind: "file" },
      { name: ".env", kind: "file" },
    ];
    const choices = entryChoices(dotted, "/w/", ".", false);
    expect(choices.map((choice) => [choice.name, choice.marks])).toEqual([
      [".git/", [[0, 1]]],
      [".env", [[0, 1]]],
    ]);
    expect(entryChoices(dotted, "/w/", "zz", false)).toEqual([]);
  });

  it("matches the NFC form of a name and inserts the spelling on disk", () => {
    const nfd = "U\u0308bersicht";
    const [choice] = entryChoices([{ name: nfd, kind: "folder" }], "/", "\u00dcber", false);
    expect(choice?.name).toBe("\u00dcbersicht/");
    expect(choice?.complete).toBe(`/${nfd}/`);
  });

  it("shows at most SHOWN_ENTRIES, and a row for the others that keeps the text", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ name: `f${String(i)}`, kind: "file" as const }));
    const choices = entryChoices(many, "/d/", "", false);
    expect(choices).toHaveLength(SHOWN_ENTRIES + 1);
    expect(choices.at(-1)).toMatchObject({ id: "more", name: "… 9,800 more", inert: true });
    expect(choices.at(-1)?.complete).toBeUndefined();
    expect(choices.at(-1)?.run()).toBeUndefined();
  });

  it("asks once per folder and dot rule, and only the folder with the first letter's dot", async () => {
    const { list, seek } = seeker();
    expect((await seek("/w/")).choices.map((choice) => choice.name)).toEqual([
      "docs/",
      "out/",
      "export.reqif",
      "o-notes.md",
    ]);
    await seek("/w/o");
    await seek("/w/ou");
    await seek("/w/.g");
    await seek("/w/.gi");
    expect(list.mock.calls).toEqual([["/w/"], ["/w/."]]);
  });

  it("gives a note and no choices for a folder that is missing, not readable or refused, or a failed call", async () => {
    for (const [answer, note] of [
      [{ folder: "/w/gone", name: "", entries: [], problem: "missing" }, "/w/gone is missing"],
      [{ folder: "/w/locked", name: "", entries: [], problem: "unreadable" }, "/w/locked is not readable"],
      [{ name: "", entries: [], problem: "unreadable" }, "/w/ is not readable"],
      [{ name: "", entries: [], problem: "invalid" }, "Not a local folder path"],
      [{ failed: "No workspace is open" }, "No workspace is open"],
    ] as const) {
      expect(await seeker(answer, true).seek("/w/x")).toEqual({ choices: [], note, alone: true });
    }
  });

  it("asks again for a folder that had a problem, so a slow one gives suggestions once it answers", async () => {
    const list = vi
      .fn<(text: string) => Promise<ListingAnswer>>()
      .mockResolvedValueOnce({ folder: "/s", name: "", entries: [], problem: "unreadable" })
      .mockResolvedValueOnce({ failed: "busy" })
      .mockResolvedValue({ folder: "/s", name: "", entries: [{ name: "late", kind: "folder" }] });
    const seek = pathSeeker({ list, windows: false });
    expect((await seek("/s/l")).note).toBe("/s is not readable");
    expect((await seek("/s/la")).note).toBe("busy");
    expect((await seek("/s/lat")).choices.map((choice) => choice.name)).toEqual(["late/"]);
    await seek("/s/late");
    // The third listing is kept; the fourth call asks ahead for "/s/late/".
    expect(list.mock.calls.map(([text]) => text)).toEqual(["/s/", "/s/", "/s/", "/s/late/"]);
    // Two keys that waited for the same listing with a problem drop it once.
    const missing = seeker({ folder: "/m", name: "", entries: [], problem: "missing" });
    await Promise.all([missing.seek("/m/a"), missing.seek("/m/b")]);
    await missing.seek("/m/c");
    expect(missing.list).toHaveBeenCalledTimes(2);
  });

  it("completes ~ to the home folder and a drive to its root, without asking", async () => {
    const { list, seek } = seeker();
    expect((await seek("~")).choices.map((choice) => choice.complete)).toEqual(["~/"]);
    const windows = pathSeeker({ list, windows: true, alone: true });
    expect(await windows("~")).toMatchObject({ choices: [{ complete: "~\\" }], alone: true });
    expect((await windows("C:")).choices.map((choice) => choice.complete)).toEqual(["C:\\"]);
    expect(list).not.toHaveBeenCalled();
    // Elsewhere "C:" is a name like any other.
    await seek("C:");
    expect(list.mock.calls).toEqual([[""]]);
  });
});
