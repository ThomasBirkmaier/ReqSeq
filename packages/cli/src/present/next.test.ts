import path from "node:path";
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import type { CallSite } from "./next.js";
import { callOf, isNextSteps, nextLines, nextPart } from "./next.js";

const cwd = path.resolve("/work/here");
const site: CallSite = { commands: getCommandRuntime().contracts.commands, cwd, platform: "linux" };

describe("next steps as calls (SR-226)", () => {
  it("fills known positionals, marks open ones and flags, and names another workspace", () => {
    expect(callOf({ command: "workspace.init", input: { path: cwd }, open: ["name"] }, site)).toBe(
      "reqseq workspace init . <name>",
    );
    expect(
      callOf({ command: "workspace.init", input: { path: path.join(cwd, "a b") }, open: ["name"] }, site),
    ).toBe("reqseq workspace init 'a b' <name>");
    expect(
      callOf(
        { command: "workspace.connectAgent", input: {}, open: ["client"], workspace: path.join(cwd, "ws") },
        site,
      ),
    ).toBe("reqseq workspace connect-agent --client <client> --workspace ws");
    // The workspace of the current folder needs no --workspace; one elsewhere is absolute.
    expect(
      callOf({ command: "element.create", input: {}, open: ["type", "title"], workspace: cwd }, site),
    ).toBe("reqseq element create <type> <title>");
    const away = path.resolve("/elsewhere");
    expect(callOf({ command: "element.create", input: {}, open: ["type"], workspace: away }, site)).toBe(
      `reqseq element create <type> --workspace ${away}`,
    );
  });

  it("gives known flags with their values and stops the positionals at the first one not given", () => {
    expect(callOf({ command: "element.list", input: { limit: 5, withText: false }, open: [] }, site)).toMatch(
      /--no-with-text .*--limit 5|--limit 5 .*--no-with-text/,
    );
    // `title` is positional after `type`: without `type` it is given as its flag.
    expect(callOf({ command: "element.create", input: { title: "T" }, open: [] }, site)).toBe(
      "reqseq element create --title T",
    );
    expect(callOf({ command: "no.such", input: {}, open: [] }, site)).toBe("no.such");
  });

  it("lists the steps with the titles of their commands, and only the shape of steps counts", () => {
    const steps = [
      { command: "workspace.init", input: {}, open: ["path", "name"] },
      { command: "no.such", input: {}, open: [] },
    ];
    expect(nextLines(steps, site)).toEqual([
      "next:",
      "  reqseq workspace init <path> <name>  Create workspace",
      "  no.such",
    ]);
    expect(isNextSteps([])).toBe(false);
    expect(isNextSteps([{ command: "x", input: {}, open: [1] }])).toBe(false);
    expect(nextPart({ files: [], steps }, site).keys).toEqual(["steps"]);
    expect(nextPart({ files: [] }, site)).toEqual({ keys: [], text: "" });
    expect(nextPart({ steps }, undefined)).toEqual({ keys: [], text: "" });
  });
});
