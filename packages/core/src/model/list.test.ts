// The text of a listed element (`textNow`, element.list `withText`): read only while the file still
// has the bytes of the element listed, so text and version agree.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { elementStoreState } from "./store.js";
import { textNow } from "./list.js";

describe("textNow", () => {
  it("gives the text while the file has the bytes of the record, else none", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const store = await workspace.get(elementStoreState);
    const record = store.elements.find((e) => e.file === "needs/N-0000000000a1.md");
    if (record === undefined) {
      throw new Error("fixture without N1");
    }
    const folders = new Map([["system", fixture.root]]);
    expect(textNow(folders, record)).toEqual({ text: "N1: parent of SR-0000b1 and SR-0000b2.\n" });
    // A repository the list does not know.
    expect(textNow(new Map(), record)).toEqual({});
    // A write in between: the version of the record is no longer the file's.
    await fs.appendFile(fixture.path(record.file), "More.\n");
    expect(textNow(folders, record)).toEqual({});
    // A file that is gone: no text either, and nothing fails.
    await fs.rm(fixture.path(record.file));
    expect(textNow(folders, record)).toEqual({});
  });
});
