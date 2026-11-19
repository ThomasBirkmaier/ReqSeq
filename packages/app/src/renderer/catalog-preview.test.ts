import { describe, expect, it } from "vitest";
import { elementBuffer } from "./buffers.js";
import { show } from "./catalog-preview.js";
import { CATALOG, command, setup } from "./catalog-commands.test-helper.js";

describe("the output of a write command (SR-223 AK8)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const entry = (name: string) => ({ command: command(name), given: [], more: false });
  const ANSWER = "Set the status of 2 elements to approved; 1 problem.";
  const output = {
    answer: ANSWER,
    files: ["a.md", "b.md"],
    problems: [{ code: "x", severity: "warning", message: "m" }],
  };

  it("[SR-223/AK-gvv1] keeps the shown buffer after a write command the catalog does not mark showsOutput, says its answer with the number of problems in the command line, and opens the output on a click; one marked showsOutput opens it at once", () => {
    // The catalog marks the write commands with content of their own (SR-224 AK7).
    expect(CATALOG.filter((listed) => listed.showsOutput === true).map((listed) => listed.name)).toEqual(
      expect.arrayContaining(["element.bulkUpdate", "reqif.import", "reqif.export", "evidence.enrichJunit"]),
    );
    const { context, dispatched, reported, echoed } = setup([shown]);
    show(context, entry("element.setStatus"), { refs: ["uuid-1"], status: "approved" }, output, 3);
    expect(dispatched).toEqual([]);
    expect(echoed).toEqual([ANSWER]);
    reported[0]?.open();
    expect(dispatched).toEqual([
      {
        type: "open",
        buffer: expect.objectContaining({
          kind: "result",
          command: "element.setStatus",
          output,
          written: true,
        }) as unknown,
      },
    ]);

    const exported = setup([shown]);
    show(
      exported.context,
      entry("reqif.export"),
      { output: "out.reqif" },
      { answer: "Exported 3 elements." },
      3,
    );
    expect(exported.reported).toEqual([]);
    expect(exported.dispatched).toMatchObject([
      { type: "open", buffer: { command: "reqif.export", written: true } },
    ]);
  });

  it("says the answer without a link where the window reports nothing, and names an output without an answer by its command line", () => {
    const { context, dispatched, echoed } = setup([shown]);
    const { report: _report, ...plain } = context;
    show(plain, entry("element.setStatus"), {}, output, 3);
    show(context, entry("relation.add"), {}, { files: [] }, 3);
    expect(echoed).toEqual([ANSWER, "Create relation"]);
    expect(dispatched).toEqual([]);
    // With a workspace open, Create workspace keeps the shown buffer like any other write command.
    show(context, entry("workspace.init"), {}, { answer: "Created workspace B." }, 3);
    expect(echoed.at(-1)).toBe("Created workspace B.");
    expect(dispatched).toEqual([]);
  });
});
