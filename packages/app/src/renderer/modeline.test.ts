import { describe, expect, it } from "vitest";
import { workspaceView } from "./modeline.js";

describe("workspaceView", () => {
  it("shows the name, and read-only, errors and warnings only when there are any", () => {
    expect(workspaceView({ ok: true, output: { name: "Weather station", readOnly: false } })).toEqual({
      name: "Weather station",
      marks: [],
      message: "",
    });
    expect(
      workspaceView({
        ok: true,
        output: {
          name: "Weather station",
          readOnly: true,
          problems: [
            { severity: "error" },
            { severity: "warning" },
            { severity: "warning" },
            { severity: "info" },
          ],
        },
      }),
    ).toEqual({ name: "Weather station", marks: ["read-only", "1 error", "2 warnings"], message: "" });
    expect(
      workspaceView({
        ok: true,
        output: { name: "W", readOnly: false, problems: [{ severity: "error" }, { severity: "error" }] },
      }).marks,
    ).toEqual(["2 errors"]);
  });

  it("shows no workspace, and the error message in the minibuffer", () => {
    expect(
      workspaceView({
        ok: false,
        error: { code: "workspace.not-found", message: "No workspace file in /x" },
      }),
    ).toEqual({ name: undefined, marks: [], message: "No workspace file in /x" });
  });
});
