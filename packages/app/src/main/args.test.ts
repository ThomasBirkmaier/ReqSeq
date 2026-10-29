import path from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceArgument } from "./args.js";

describe("workspaceArgument", () => {
  const cwd = path.resolve("/home/me");

  it("takes --workspace <folder> and --workspace=<folder>, relative to the current folder", () => {
    expect(workspaceArgument(["electron", ".", "--workspace", "ws"], cwd)).toBe(path.join(cwd, "ws"));
    expect(workspaceArgument(["reqseq", `--workspace=${path.resolve("/abs")}`], cwd)).toBe(
      path.resolve("/abs"),
    );
  });

  it("is undefined without a folder", () => {
    expect(workspaceArgument(["electron", "."], cwd)).toBeUndefined();
    expect(workspaceArgument(["electron", ".", "--workspace"], cwd)).toBeUndefined();
    expect(workspaceArgument(["electron", "--workspace="], cwd)).toBeUndefined();
  });
});
