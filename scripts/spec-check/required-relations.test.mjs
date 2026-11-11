import path from "node:path";
import { describe, expect, it } from "vitest";
import { blockingFindings, requiredRelations } from "./required-relations.mjs";

const statuses = [{ key: "draft", initial: true }, { key: "approved" }, { key: "accepted" }];
const finding = (elementId, extra = {}) => ({
  code: "relation.too-few",
  message: "has 0 relations Derives from; at least 1",
  file: `system-requirement/${elementId}.md`,
  elementId,
  ...extra,
});

describe("blockingFindings (#1306)", () => {
  it("fails a missing required relation of an approved, accepted or status-less element, not of a draft", () => {
    const elements = [
      { id: "a", status: "approved" },
      { id: "b", status: "draft" },
      { id: "c", status: "accepted" },
      { id: "d" },
    ];
    const problems = [
      finding("a", { elementIdentifier: "SR-146" }),
      finding("b", { elementIdentifier: "SR-147" }),
      finding("c", { elementShortId: "D-1a2b3c" }),
      finding("d"),
      { ...finding("a"), code: "relation.too-many" },
    ];
    expect(blockingFindings(problems, elements, statuses)).toEqual([
      "system-requirement/a.md: SR-146 (approved): has 0 relations Derives from; at least 1",
      "system-requirement/c.md: D-1a2b3c (accepted): has 0 relations Derives from; at least 1",
      "system-requirement/d.md: d (no status): has 0 relations Derives from; at least 1",
    ]);
  });
});

describe("requiredRelations", () => {
  it("reads the check, the metamodel and every page of elements through the built command line", () => {
    const calls = [];
    const pages = [
      { elements: [{ id: "a", status: "approved" }], total: 5001 },
      { elements: [{ id: "b", status: "draft" }], total: 5001 },
    ];
    const run = (cli, root, args) => {
      calls.push([cli, root, args.join(" ")]);
      if (args[0] === "workspace") {
        return { problems: [finding("a"), finding("b")] };
      }
      return args[0] === "metamodel" ? { statuses } : pages.shift();
    };
    expect(requiredRelations("/repo", run)).toEqual([
      "system-requirement/a.md: a (approved): has 0 relations Derives from; at least 1",
    ]);
    const cli = path.join("/repo", "packages", "cli", "dist", "bin.js");
    expect(calls).toEqual([
      [cli, "/repo", "workspace check"],
      [cli, "/repo", "metamodel get"],
      [cli, "/repo", "element list --limit 5000 --offset 0"],
      [cli, "/repo", "element list --limit 5000 --offset 5000"],
    ]);
  });
});
