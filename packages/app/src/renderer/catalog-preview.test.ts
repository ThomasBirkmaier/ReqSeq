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

  it("[SR-223/AK-qwkc] shows the output of a read command whose elements are its answer as a list of them under its answer, unless the catalog marks it staysOutputPage", () => {
    const { context, dispatched } = setup([shown]);
    const related = { answer: "2 elements are related to SR-1.", elements: [], total: 0 };
    show(context, entry("trace.related"), { refs: ["SR-1"] }, related, 3);
    expect(dispatched).toMatchObject([
      {
        type: "open",
        buffer: {
          kind: "list",
          label: related.answer,
          selection: { output: { command: "trace.related", input: { refs: ["SR-1"] } } },
          // The output of this run, so the list need not run the command again for it.
          answered: { output: related, revision: 3 },
        },
      },
    ]);
    // Without an answer (a test catalog) the list is named by its command line.
    show(context, entry("trace.related"), {}, { elements: [] }, 3);
    expect(dispatched[1]).toMatchObject({ type: "open", buffer: { label: "Show related elements" } });
    // The catalog marks the outputs whose answer is the state of each entry (SR-224 AK8): they stay an output page,
    // with entries and without.
    const status = {
      answer: "Listed the verification status of 1 element.",
      elements: [{ id: "u-1", repository: "spec", shortId: "SR-000001", title: "T", status: "approved" }],
      total: 1,
    };
    show(context, entry("evidence.status"), {}, status, 3);
    show(context, entry("evidence.status"), {}, { ...status, elements: [], total: 0 }, 3);
    show(context, entry("baseline.get"), { baseline: "R1" }, { answer: "R1", elements: [] }, 3);
    expect(dispatched.slice(2)).toMatchObject([
      { type: "open", buffer: { kind: "result", command: "evidence.status", output: status } },
      { type: "open", buffer: { kind: "result", command: "evidence.status" } },
      { type: "open", buffer: { kind: "result", command: "baseline.get" } },
    ]);
    // An answer of the selection of requirements is a list (SR-120 AK2).
    show(context, entry("evidence.withoutPassedTest"), {}, { answer: "a", elements: [], total: 0 }, 3);
    expect(dispatched[5]).toMatchObject({ type: "open", buffer: { kind: "list", label: "a" } });
  });
});
