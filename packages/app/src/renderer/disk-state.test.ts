import type { DataExportElement } from "@logreq/core";
import { describe, expect, it, vi } from "vitest";
import type { DiskState } from "./disk-state.js";
import {
  DISK_START,
  conflictEnded,
  decided,
  failure,
  fileRead,
  goneRead,
  leaveSaves,
  lockedNote,
  readFailed,
  saveNote,
  showsKept,
  takeFileEdits,
} from "./disk-state.js";
import type { ShownFile } from "./drafts.js";
import type { ConflictField, OutsideChange } from "./outside-change.js";
import { GONE_CONFIRM_MS, RESOLVE_FIRST, deletedOnDisk, unreadable } from "./outside-change.js";

const field = (label: string, input: string, disk: string): ConflictField => ({ label, input, disk });
const conflictOf = (...fields: ConflictField[]): OutsideChange => ({ kind: "conflict", dropped: [], fields });
const FOLLOW: OutsideChange = { kind: "follow", dropped: [] };
const state = (changes: Partial<DiskState>): DiskState => ({ ...DISK_START, ...changes });
const shown: ShownFile = { element: { shortId: "SR-036" } as DataExportElement, sha: "one" };

describe("a change on disk under the input (SR-106 AK2)", () => {
  it("[SR-106/AK2] a conflict stops saving and is said once when it begins, not again while it lasts", () => {
    const first = decided(state({ basis: "one" }), conflictOf(field("Text", "mine", "theirs")), "two");
    expect(first.begins).toBe(true);
    expect(first.disk.basis).toBe("one");
    expect(saveNote(first.disk, false, "SR-036")).toBe(RESOLVE_FIRST);
    const again = decided(first.disk, conflictOf(field("Text", "mine 2", "theirs")), "two");
    expect(again.begins).toBe(false);
    expect(again.disk.conflict).toEqual([field("Text", "mine 2", "theirs")]);
    expect(saveNote(again.disk, false, "SR-036")).toBe(RESOLVE_FIRST);
  });

  it("[SR-106/AK2] input that the file now holds ends the conflict on the bytes read", () => {
    const during = state({ basis: "one", conflict: [field("Text", "mine", "theirs")] });
    const ended = decided(during, FOLLOW, "two");
    expect(ended).toEqual({ disk: state({ basis: "two" }), begins: false });
    expect(saveNote(ended.disk, false, "SR-036")).toBeUndefined();
  });

  it("[SR-106/AK2] Take the file puts the file's value into every field in conflict, in order: an editor, or a choice or relation box as a value", () => {
    const hasEditor = vi.fn((label: string) => label !== "status");
    const conflict = [
      field("Text", "mine", "theirs"),
      field("status", "draft", "accepted"),
      field("Rationale", "a", "b"),
    ];
    expect(takeFileEdits(conflict, hasEditor)).toEqual([
      { label: "Text", doc: "theirs", via: "editor" },
      { label: "status", doc: "accepted", via: "value" },
      { label: "Rationale", doc: "b", via: "editor" },
    ]);
    expect(hasEditor.mock.calls.map(([label]) => label)).toEqual(["Text", "status", "Rationale"]);
  });

  it("takes nothing from the file when there is no conflict", () => {
    expect(takeFileEdits(undefined, () => true)).toEqual([]);
  });

  it("a save ends the conflict on the bytes it wrote; without one only the bytes change", () => {
    const during = state({ basis: "one", conflict: [field("Text", "mine", "theirs")] });
    expect(conflictEnded(during, "three")).toEqual(state({ basis: "three" }));
    expect(conflictEnded(state({ basis: "one" }), undefined)).toEqual(DISK_START);
  });

  it("keeps the identity of what it does not change, and takes a new conflict for each new change", () => {
    const fields = [field("Text", "mine", "theirs")];
    const change: OutsideChange = { kind: "conflict", dropped: [], fields };
    const first = decided(DISK_START, change, "two");
    expect(first.disk.conflict).toBe(fields);
    const next = decided(first.disk, conflictOf(field("Text", "mine", "theirs")), "two");
    expect(next.disk.conflict).not.toBe(first.disk.conflict);
    const quiet = state({ basis: "one" });
    expect(conflictEnded(quiet, "two").conflict).toBe(quiet.conflict);
    const kept = state({ conflict: fields, goneSince: 5 });
    expect(fileRead(kept).disk.conflict).toBe(fields);
    expect(decided(quiet, FOLLOW, "one").disk.conflict).toBeUndefined();
  });
});

describe("a file that is gone (SR-106 AK3)", () => {
  it("[SR-106/AK3] the first read that finds the file gone waits GONE_CONFIRM_MS and asks again; a file still gone then is deleted", () => {
    const first = goneRead(DISK_START, 5000);
    expect(first).toEqual({ kind: "wait", disk: state({ goneSince: 5000 }), wait: GONE_CONFIRM_MS });
    const early = goneRead(first.disk, 5500);
    expect(early).toEqual({ kind: "wait", disk: state({ goneSince: 5000 }), wait: GONE_CONFIRM_MS - 500 });
    const late = goneRead(early.disk, 5000 + GONE_CONFIRM_MS);
    expect(late).toEqual({ kind: "deleted", disk: state({ goneSince: 5000, deleted: true }) });
  });

  it("[SR-106/AK3] a read that fails for another reason starts the count again", () => {
    const waiting = state({ basis: "one", goneSince: 5000 });
    expect(readFailed(waiting, "ref.unknown")).toBe(waiting);
    expect(readFailed(waiting, "io.failed")).toEqual(state({ basis: "one" }));
    expect(goneRead(readFailed(waiting, "io.failed"), 9000)).toMatchObject({
      kind: "wait",
      wait: GONE_CONFIRM_MS,
    });
  });

  it("[SR-106/AK3] a deleted file and a file that cannot be read now lock the element with their note; read-only comes first", () => {
    expect(lockedNote(DISK_START, false, "SR-036")).toBeUndefined();
    expect(lockedNote(state({ goneSince: 5 }), false, "SR-036")).toBe(unreadable("SR-036"));
    expect(lockedNote(state({ deleted: true, goneSince: 5 }), false, "SR-036")).toBe(deletedOnDisk("SR-036"));
    expect(lockedNote(state({ deleted: true }), true, "SR-036")).toBe("SR-036 is read-only");
    // The lock speaks before the conflict.
    const all = state({ deleted: true, conflict: [field("Text", "a", "b")] });
    expect(saveNote(all, false, "SR-036")).toBe(deletedOnDisk("SR-036"));
  });

  it("[SR-106/AK3] a buffer shown again with a draft after its file was deleted shows the draft's element, then follows the gone rule", () => {
    expect(showsKept(false, "ref.unknown", shown)).toBe(true);
    // Once the kept element is applied, the buffer has loaded: the failure is the gone rule.
    expect(failure(true, "ref.unknown", false)).toBe("gone");
    expect(showsKept(false, "ref.unknown", undefined)).toBe(false);
    expect(showsKept(false, "io.failed", shown)).toBe(false);
    expect(showsKept(true, "ref.unknown", shown)).toBe(false);
  });

  it("says why before the first load, echoes another failure after it, and does nothing more for a deleted file", () => {
    expect(failure(false, "ref.unknown", false)).toBe("error");
    expect(failure(false, "io.failed", false)).toBe("error");
    expect(failure(true, "io.failed", false)).toBe("echo");
    expect(failure(true, "io.failed", true)).toBe("echo");
    expect(failure(true, "ref.unknown", true)).toBe("none");
  });

  it("the file read again unlocks the buffer and reports that it is back", () => {
    expect(fileRead(state({ basis: "one", goneSince: 5 }))).toEqual({
      disk: state({ basis: "one" }),
      back: true,
    });
    expect(fileRead(state({ deleted: true, goneSince: 5 }))).toEqual({ disk: DISK_START, back: true });
    expect(fileRead(state({ deleted: true }))).toEqual({ disk: DISK_START, back: true });
    expect(fileRead(state({ basis: "one" }))).toEqual({ disk: state({ basis: "one" }), back: false });
  });
});

describe("leaving the buffer", () => {
  it("[SR-105/AK1] leaving the buffer saves its input", () => {
    expect(leaveSaves(DISK_START)).toBe(true);
    expect(leaveSaves(state({ basis: "one" }))).toBe(true);
  });

  it("[SR-106/AK2] [SR-106/AK3] leaving the buffer saves nothing over a change on disk, a deleted file or a file that cannot be read now", () => {
    expect(leaveSaves(state({ conflict: [field("Text", "a", "b")] }))).toBe(false);
    expect(leaveSaves(state({ deleted: true }))).toBe(false);
    expect(leaveSaves(state({ goneSince: 5 }))).toBe(false);
  });
});
