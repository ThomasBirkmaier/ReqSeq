// "Write skill file" (SR-229 AK16): `tool.guide` with exactly `skill` and `write`, asking nothing, also while the
// tool refuses writes; a failure of core asks nothing again and goes to the command line,
// which names each place with its result.
import { describe, expect, it } from "vitest";
import { ACTIONS } from "./actions.js";
import { CATALOG, flush, setup } from "./catalog-commands.test-helper.js";
import { writeSkill } from "./write-skill.js";

const refusal = (code: string, message: string): Error => Object.assign(new Error(message), { name: code });

describe("Write skill file", () => {
  it("[SR-229/AK-y65m] runs tool.guide with exactly skill and write and asks nothing", async () => {
    const output = {
      guide: "---\nname: managing-requirements\n---\n",
      places: [
        { path: ".claude/skills/managing-requirements/SKILL.md", action: "created" },
        { path: ".agents/skills/managing-requirements/SKILL.md", action: "created" },
      ],
    };
    const { context, asked, call, dispatched } = setup([], { "tool.guide": () => output });
    writeSkill(context, CATALOG);
    await flush();
    expect(asked).toEqual([]);
    expect(call).toHaveBeenCalledExactlyOnceWith("tool.guide", { skill: true, write: true });
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { kind: "result", command: "tool.guide" },
    });
  });

  it("[SR-229/AK-y65m] a refused write opens no buffer and asks nothing again: the command line says why", async () => {
    for (const code of ["input.invalid", "file.not-written"]) {
      const { context, asked, echoed, dispatched } = setup([], {
        "tool.guide": () =>
          refusal(code, "Not written at every place of the skill file: a: created; b: not written: x"),
      });
      writeSkill(context, CATALOG);
      await flush();
      expect(asked, code).toEqual([]);
      expect(dispatched, code).toEqual([]);
      expect(echoed, code).toEqual([
        "Not written at every place of the skill file: a: created; b: not written: x",
      ]);
    }
  });

  it("[SR-229/AK-y65m] is offered with a workspace open, also while the tool refuses writes", () => {
    const action = ACTIONS.find((candidate) => candidate.id === "write-skill-file");
    const { context } = setup([]);
    const writing = { ...context, writeSkill: () => undefined };
    expect(action?.available(writing)).toBe(true);
    expect(action?.available({ ...writing, readOnly: true })).toBe(true);
    expect(action?.available({ ...writing, workspace: false })).toBe(false);
    expect(action?.available(context)).toBe(false);
  });

  it("says when the catalog has no tool.guide, and nothing more for a catalog that could not be read", () => {
    const { context, echoed, call } = setup([]);
    writeSkill(
      context,
      CATALOG.filter((entry) => entry.name !== "tool.guide"),
    );
    writeSkill(context, []);
    expect(echoed).toEqual(["The command catalog has no tool.guide"]);
    expect(call).not.toHaveBeenCalled();
  });
});
