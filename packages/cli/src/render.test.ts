import { CommandError } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { outcomeExitCode, renderError, renderJson, renderProblem, renderYaml } from "./render.js";

const uuid = "6adc6bad-b94e-40cf-bd99-7ef5e126d1e6";

describe("renderJson", () => {
  it("prints exactly the output", () => {
    const output = { ok: true, problems: [], nested: { list: [1, "ä"] } };
    expect(JSON.parse(renderJson(output))).toEqual(output);
    expect(renderJson(output).endsWith("}\n")).toBe(true);
  });

  it("prints null for a command without output", () => {
    expect(renderJson(undefined)).toBe("null\n");
  });
});

describe("renderProblem", () => {
  it("shows severity, code, file:line, message and element", () => {
    expect(
      renderProblem({
        severity: "error",
        code: "element.unknown-type",
        file: "product/SR-1.md",
        line: 3,
        message: "Unknown type foo",
        elementId: uuid,
      }),
    ).toBe(`error  element.unknown-type  product/SR-1.md:3  Unknown type foo  (element ${uuid})\n`);
  });

  it("names the repository of the file when the problem has one", () => {
    expect(
      renderProblem({
        severity: "error",
        code: "file.invalid-yaml",
        repository: "sensor",
        file: "anemometer/SR-1.md",
        line: 2,
        message: "m",
      }),
    ).toBe("error  file.invalid-yaml  sensor:anemometer/SR-1.md:2  m\n");
    expect(renderProblem({ severity: "info", code: "x.y", repository: "sensor", message: "m" })).toBe(
      "info  x.y  m\n",
    );
  });

  it("leaves out what a problem does not have", () => {
    expect(
      renderProblem({ severity: "warning", code: "file.yaml-warning", file: "a.md", message: "m" }),
    ).toBe("warning  file.yaml-warning  a.md  m\n");
    expect(renderProblem({ severity: "info", code: "x.y", line: 2, message: "m" })).toBe("info  x.y  m\n");
  });

  it("shows something that is not a problem object as JSON", () => {
    expect(renderProblem("odd")).toBe('"odd"\n');
    expect(renderProblem({ severity: true, message: { a: 1 } })).toBe("\n");
  });
});

describe("renderYaml", () => {
  it("renders the output as YAML and the problems one per line", () => {
    const text = renderYaml({
      name: "Weather station",
      repositories: [{ name: "system", available: true }],
      problems: [
        { severity: "error", code: "a.b", message: "first" },
        { severity: "info", code: "c.d", message: "second" },
      ],
    });
    expect(text).toBe(
      [
        "name: Weather station",
        "repositories:",
        "  - name: system",
        "    available: true",
        "error  a.b  first",
        "info  c.d  second",
        "",
      ].join("\n"),
    );
  });

  it("says so when there are no problems", () => {
    expect(renderYaml({ problems: [] })).toBe("No problems.\n");
    expect(renderYaml({ ok: true, problems: [] })).toBe("ok: true\nNo problems.\n");
  });

  it("renders outputs without problems and non-object outputs", () => {
    expect(renderYaml({ text: "line 1\nline 2" })).toBe("text: |-\n  line 1\n  line 2\n");
    expect(renderYaml({})).toBe("");
    expect(renderYaml(undefined)).toBe("");
    expect(renderYaml(["a", "b"])).toBe("- a\n- b\n");
    expect(renderYaml({ problems: "not a list" })).toBe("");
  });

  it("keeps long lines and non-ASCII text unchanged", () => {
    const long = `Größe ${"x".repeat(200)} 測試`;
    expect(renderYaml({ title: long })).toBe(`title: ${long}\n`);
  });
});

describe("renderError", () => {
  const error = new CommandError("element.not-found", "No element SR-46fb54", { ref: "SR-46fb54" });

  it("prints code and message for people", () => {
    expect(renderError(error, false)).toBe("error element.not-found: No element SR-46fb54\n");
  });

  it("prints the error object with --json", () => {
    expect(JSON.parse(renderError(error, true))).toEqual(error.toJSON());
  });
});

describe("outcomeExitCode", () => {
  it("is 1 for an error finding or ok: false", () => {
    expect(outcomeExitCode({ problems: [{ severity: "error" }] })).toBe(1);
    expect(outcomeExitCode({ ok: false, problems: [] })).toBe(1);
    expect(outcomeExitCode({ ok: false })).toBe(1);
  });

  it("is 0 otherwise", () => {
    expect(
      outcomeExitCode({ ok: true, problems: [{ severity: "warning" }, { severity: "info" }, "odd"] }),
    ).toBe(0);
    expect(outcomeExitCode({ problems: "odd" })).toBe(0);
    expect(outcomeExitCode({})).toBe(0);
    expect(outcomeExitCode(undefined)).toBe(0);
    expect(outcomeExitCode([{ severity: "error" }])).toBe(0);
  });
});
