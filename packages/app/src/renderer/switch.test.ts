// Saving the unsaved input before another workspace opens in the window (SR-131 AK3, `switch.ts`).
import type { DataExportElement } from "@logreq/core";
import { describe, expect, it, vi } from "vitest";
import type { Buffer, ElementBuffer } from "./buffers.js";
import { elementBuffer, overviewBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { Draft } from "./drafts.js";
import type { PropertyInfo, PropertyModel } from "./element-view.js";
import { CHANGED_ON_DISK, CHANGED_WHILE_SAVING, notSaved, notSavedInTime, saveDrafts } from "./switch.js";

const MODEL: PropertyModel = new Map([
  [
    "need",
    new Map<string, PropertyInfo>([
      ["topic", { kind: "text", many: false, markdown: false }],
      ["criteria", { kind: "text", many: true, markdown: false }],
    ]),
  ],
]);

/** A file of the workspace: the text and the properties of an element, and its type (default `need`). */
interface File {
  text: string;
  properties: Record<string, unknown>;
  type?: string;
  /** The hash of its bytes, as core gives it (`fileSha256`). */
  sha?: string;
}

/** The files of the workspace, by element id. */
type Files = Map<string, File>;

const elementOf = (id: string, file: File): DataExportElement =>
  // An element without text has none in the output.
  ({
    id,
    type: file.type ?? "need",
    ...(file.text === "" ? {} : { text: file.text }),
    properties: file.properties,
    relations: [],
  }) as unknown as DataExportElement;

/** A call on `files`: `element.get` reads them, `element.update` writes them; a failure for the ids in `failing`. */
const fakeCall = (files: Files, failing: ReadonlyMap<string, string> = new Map()) =>
  vi.fn((name: string, input: Record<string, unknown>) => {
    const id = String(input["ref"]);
    const file = files.get(id);
    const failure = failing.get(`${name} ${id}`);
    if (file === undefined || failure !== undefined) {
      return Promise.resolve({ ok: false, code: "x", message: failure ?? `${id} is not found` });
    }
    if (name === "element.update") {
      const set = (input["set"] ?? {}) as Record<string, unknown>;
      const unset = (input["unset"] ?? []) as string[];
      const properties = Object.fromEntries(
        Object.entries({ ...file.properties, ...set }).filter(([key]) => !unset.includes(key)),
      );
      files.set(id, { text: typeof input["text"] === "string" ? input["text"] : file.text, properties });
    }
    const now = files.get(id) ?? file;
    return Promise.resolve({
      ok: true,
      output: { element: elementOf(id, now), ...(now.sha === undefined ? {} : { fileSha256: now.sha }) },
    });
  });

const buffer = (id: string): ElementBuffer => elementBuffer(id, "system", `SR-${id} Title ${id}`);

const setup = (
  buffers: readonly Buffer[],
  drafts: ReadonlyMap<string, Draft>,
  files: Files,
  failing?: ReadonlyMap<string, string>,
) => {
  const call = fakeCall(files, failing);
  const dropped: string[] = [];
  const run = () =>
    saveDrafts({
      call: call as unknown as Call,
      buffers,
      drafts,
      properties: MODEL,
      saved: (key) => dropped.push(key),
      rebased: () => undefined,
    });
  return { call, dropped, run };
};

describe("saving before a switch", () => {
  it("[SR-131/AK3] the drafts of every element buffer are saved before main is asked to open", async () => {
    const files: Files = new Map([
      ["1", { text: "Old one", properties: { topic: "wind" }, sha: "one" }],
      ["2", { text: "Old two", properties: { topic: "rain", criteria: ["a", "b"] } }],
      ["3", { text: "Untouched", properties: {} }],
      ["4", { text: "", properties: {} }],
    ]);
    const [one, two, three, four] = [buffer("1"), buffer("2"), buffer("3"), buffer("4")];
    const drafts = new Map<string, Draft>([
      // The text typed, and an emptied box.
      [
        one.key,
        {
          text: "New one",
          base: "Old one",
          boxes: new Map([["topic", { doc: "", base: "wind" }]]),
          sha: "one",
        },
      ],
      // Boxes only: a changed list, and a box that was added.
      [
        two.key,
        {
          text: "Old two",
          base: "Old two",
          boxes: new Map([
            ["criteria", { doc: "a\nc", base: "a\nb" }],
            ["topic", { doc: "hail", base: "rain" }],
          ]),
        },
      ],
      // A draft that the file holds by now: nothing is left to save.
      [three.key, { text: "Untouched", base: "Before" }],
      // The first words of an element without text.
      [four.key, { text: "First words", base: "" }],
    ]);
    const { call, dropped, run } = setup([one, overviewBuffer(), two, three, four], drafts, files);
    expect(await run()).toEqual({ ok: true });
    expect(files.get("1")).toEqual({ text: "New one", properties: {} });
    expect(files.get("2")).toEqual({ text: "Old two", properties: { topic: "hail", criteria: ["a", "c"] } });
    expect(files.get("3")).toEqual({ text: "Untouched", properties: {} });
    expect(files.get("4")).toEqual({ text: "First words", properties: {} });
    // The shown buffer last; each read before its write; only what changed is written.
    expect(call.mock.calls.map(([name, input]) => `${name} ${String(input["ref"])}`)).toEqual([
      "element.get 2",
      "element.update 2",
      "element.get 3",
      "element.get 4",
      "element.update 4",
      "element.get 1",
      "element.update 1",
    ]);
    expect(call.mock.calls[1]?.[1]).toEqual({ ref: "2", set: { criteria: ["a", "c"], topic: "hail" } });
    // The write carries the bytes it was made on (SR-106).
    expect(call.mock.calls[6]?.[1]).toEqual({
      ref: "1",
      text: "New one",
      unset: ["topic"],
      expectedFileSha256: "one",
    });
    expect(call.mock.calls[0]?.[1]).toEqual({ ref: "2", repository: "system" });
    expect(dropped).toEqual([two.key, three.key, four.key, one.key]);
  });

  it("nothing unsaved: nothing is read or written", async () => {
    const { call, run } = setup([buffer("1"), overviewBuffer()], new Map(), new Map());
    expect(await run()).toEqual({ ok: true });
    expect((await setup([], new Map(), new Map()).run()).ok).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it("a draft that cannot be saved stops the switch, keeps the draft and names the element", async () => {
    const files: Files = new Map([
      ["1", { text: "Old", properties: {} }],
      ["2", { text: "Old", properties: {} }],
      ["3", { text: "Old", properties: {} }],
    ]);
    const [one, two, three] = [buffer("1"), buffer("2"), buffer("3")];
    const typed: Draft = { text: "New", base: "Old" };
    const drafts = new Map([
      [one.key, typed],
      [two.key, typed],
      [three.key, typed],
    ]);
    // A value core does not take (SR-085): the file stays, the rest is not tried.
    const invalid = setup(
      [one, two, three],
      drafts,
      files,
      new Map([["element.update 2", "Text is too long"]]),
    );
    const result = await invalid.run();
    expect(result).toEqual({ ok: false, name: "SR-2 Title 2", message: "Text is too long" });
    expect(notSaved(result as Extract<typeof result, { ok: false }>)).toBe(
      "SR-2 Title 2 could not be saved (Text is too long); the workspace was not changed",
    );
    expect(invalid.dropped).toEqual([]);
    expect(files.get("2")?.text).toBe("Old");
    expect(files.get("3")?.text).toBe("Old");
    expect(files.get("1")?.text).toBe("Old");
    // An element that cannot be read.
    const unreadable = setup(
      [one, two],
      drafts,
      files,
      new Map([["element.get 2", "The file is not readable"]]),
    );
    expect(await unreadable.run()).toEqual({
      ok: false,
      name: "SR-2 Title 2",
      message: "The file is not readable",
    });
  });

  it("a draft whose file changed outside since it was typed on is not saved over that change", async () => {
    const files: Files = new Map([
      ["1", { text: "Changed by Git", properties: { topic: "storm" }, sha: "new" }],
    ]);
    const one = buffer("1");
    const text = setup([one], new Map([[one.key, { text: "Mine", base: "Old", sha: "old" }]]), files);
    expect(await text.run()).toEqual({ ok: false, name: "SR-1 Title 1", message: CHANGED_ON_DISK });
    const box = setup(
      [one],
      new Map([
        [
          one.key,
          {
            text: "Changed by Git",
            base: "Changed by Git",
            boxes: new Map([["topic", { doc: "calm", base: "wind" }]]),
            sha: "old",
          },
        ],
      ]),
      files,
    );
    expect(await box.run()).toEqual({ ok: false, name: "SR-1 Title 1", message: CHANGED_ON_DISK });
    expect(text.call.mock.calls.map(([name]) => name)).toEqual(["element.get"]);
    expect(files.get("1")).toEqual({ text: "Changed by Git", properties: { topic: "storm" }, sha: "new" });
  });

  it("[SR-131/AK3] input typed while its draft was saved is kept, on the file as it was saved, and stops the switch", async () => {
    const files: Files = new Map([["1", { text: "Old", properties: { topic: "wind" }, sha: "old" }]]);
    const one = buffer("1");
    const drafts = new Map<string, Draft>([[one.key, { text: "Mine", base: "Old", sha: "old" }]]);
    const write = fakeCall(files);
    const dropped: string[] = [];
    // What the window types while the save runs: `newer` replaces the draft when the write is asked.
    let newer: Draft | undefined;
    const call = async (name: string, input: Record<string, unknown>) => {
      if (name === "element.update") {
        if (newer === undefined) {
          drafts.delete(one.key);
        } else {
          drafts.set(one.key, newer);
        }
      }
      const answer = await write(name, input);
      // The write gives the file new bytes.
      const file = files.get("1");
      if (name === "element.update" && file !== undefined) {
        const sha = `after ${String(input["text"])}`;
        files.set("1", { ...file, sha });
        return { ok: true, output: { element: elementOf("1", file), fileSha256: sha } };
      }
      return answer;
    };
    const rebased = new Map<string, Draft | undefined>();
    const run = () =>
      saveDrafts({
        call: call as unknown as Call,
        buffers: [one],
        drafts,
        properties: MODEL,
        saved: (key) => dropped.push(key),
        rebased: (key, draft) => rebased.set(key, draft),
      });
    newer = {
      text: "Mine, and more",
      base: "Old",
      sha: "old",
      boxes: new Map([["topic", { doc: "storm", base: "wind" }]]),
    };
    expect(await run()).toEqual({ ok: false, name: "SR-1 Title 1", message: CHANGED_WHILE_SAVING });
    expect(files.get("1")?.text).toBe("Mine");
    // The newer input is not dropped: it is kept on the text and the bytes this save wrote, so the next
    // save or view of it does not take the app's own write for a change on disk.
    expect(dropped).toEqual([]);
    expect(rebased.get(one.key)).toEqual({
      text: "Mine, and more",
      base: "Mine",
      boxes: new Map([["topic", { doc: "storm", base: "wind" }]]),
      sha: "after Mine",
      shown: { element: elementOf("1", { text: "Mine", properties: { topic: "wind" } }), sha: "after Mine" },
    });
    // Boxes alone typed meanwhile: the text is the file's text, not the one the draft was typed on.
    drafts.set(one.key, { text: "Mine again", base: "Mine", sha: "after Mine" });
    newer = {
      text: "Mine",
      base: "Mine",
      sha: "after Mine",
      boxes: new Map([["topic", { doc: "calm", base: "wind" }]]),
    };
    expect(await run()).toEqual({ ok: false, name: "SR-1 Title 1", message: CHANGED_WHILE_SAVING });
    expect(rebased.get(one.key)).toMatchObject({
      text: "Mine again",
      base: "Mine again",
      sha: "after Mine again",
    });
    // Input that is what the file now holds is no input; a draft dropped meanwhile is left alone.
    rebased.clear();
    drafts.set(one.key, { text: "Third", base: "Mine again", sha: "after Mine again" });
    newer = { text: "Third", base: "Mine again", sha: "after Mine again" };
    expect(await run()).toEqual({ ok: false, name: "SR-1 Title 1", message: CHANGED_WHILE_SAVING });
    expect([...rebased]).toEqual([[one.key, undefined]]);
    rebased.clear();
    drafts.set(one.key, { text: "Fourth", base: "Third", sha: "after Third" });
    newer = undefined;
    expect(await run()).toEqual({ ok: false, name: "SR-1 Title 1", message: CHANGED_WHILE_SAVING });
    expect([...rebased]).toEqual([]);
    // A save that empties the text leaves an element without text: the newer input is on the empty text.
    drafts.set(one.key, { text: "", base: "Fourth", sha: "after Fourth" });
    newer = { text: "Fifth", base: "Fourth", sha: "after Fourth" };
    expect(await run()).toEqual({ ok: false, name: "SR-1 Title 1", message: CHANGED_WHILE_SAVING });
    expect(rebased.get(one.key)).toMatchObject({ text: "Fifth", base: "", sha: "after " });
  });

  it("[SR-131/AK3] says that the input was not saved in time, and what stays open", () => {
    expect(notSavedInTime("Weather station")).toBe(
      "The unsaved input was not saved in time; Weather station stays open",
    );
    expect(notSavedInTime(undefined)).toBe("The unsaved input was not saved in time; no workspace is open");
  });

  it("a box of a property the type no longer has stops the switch", async () => {
    const files: Files = new Map([["1", { text: "Old", properties: {} }]]);
    const one = buffer("1");
    const draft: Draft = { text: "Old", base: "Old", boxes: new Map([["colour", { doc: "red", base: "" }]]) };
    const { run, call } = setup([one], new Map([[one.key, draft]]), files);
    expect(await run()).toEqual({
      ok: false,
      name: "SR-1 Title 1",
      message: "its type has no property colour",
    });
    expect(call.mock.calls.map(([name]) => name)).toEqual(["element.get"]);
    // Neither does an element of a type the metamodel does not know.
    files.set("1", { text: "Old", properties: {}, type: "risk" });
    const other = setup([one], new Map([[one.key, draft]]), files);
    expect(await other.run()).toEqual({
      ok: false,
      name: "SR-1 Title 1",
      message: "its type has no property colour",
    });
  });
});
