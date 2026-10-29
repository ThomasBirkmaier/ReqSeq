import { CommandError } from "@logreq/core";
import { describe, expect, it } from "vitest";
import {
  outcomeExitCode,
  problemsEnd,
  renderError,
  renderJson,
  renderProblem,
  renderYaml,
  YAML_OPTIONS,
  jsonOutput,
  yamlPieces,
} from "./render.js";
import { stringify } from "yaml";

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

describe("jsonOutput and yamlPieces: the whole text in pieces (#277)", () => {
  const shared = { name: "case", steps: ["a", "b"] };
  const value = {
    "key: with colon": [1, 2],
    empty: [],
    nothing: undefined,
    nested: [[1, [2, []]], { a: { b: [] } }],
    text: [{ block: "line 1\n\nline 3\n", plain: "x" }, "two\nlines"],
    twice: [shared, { last: shared }],
    "": [null],
    map: { a: 1 },
  };

  it("joins jsonOutput to JSON.stringify with indent 2 and a line break, in more than one chunk when large", () => {
    expect([...jsonOutput(value)].join("")).toBe(`${JSON.stringify(value, null, 2)}\n`);
    const large = Array.from({ length: 20_000 }, (_, n) => ({ n, text: "x".repeat(60) }));
    const chunks = [...jsonOutput(large)];
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join("")).toBe(`${JSON.stringify(large, null, 2)}\n`);
  });

  it("joins yamlPieces to the YAML of the whole, without anchors", () => {
    for (const v of [value, [value, value], [], {}, "text", 1, null, value.text]) {
      expect([...yamlPieces(v)].join("")).toBe(stringify(v, YAML_OPTIONS));
    }
    expect([...yamlPieces(value)].join("")).not.toMatch(/[&*]a1/);
    expect([...yamlPieces(value)].length).toBeGreaterThan(Object.keys(value).length);
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

  it("names the element by its short ID when the problem has one (#315)", () => {
    expect(
      renderProblem({
        severity: "warning",
        code: "element.unknown-property",
        file: "requirements/SR-825b7146fb54.md",
        message: "m",
        elementId: uuid,
        elementShortId: "SR-46fb54",
      }),
    ).toBe("warning  element.unknown-property  requirements/SR-825b7146fb54.md  m  (element SR-46fb54)\n");
  });

  it("names the identifier of the element next to its short ID (#305)", () => {
    expect(
      renderProblem({
        severity: "warning",
        code: "relation.outdated",
        message: "m",
        elementId: "u1",
        elementShortId: "SR-0b0036",
        elementIdentifier: "SR-036",
      }),
    ).toBe("warning  relation.outdated  m  (element SR-0b0036, identifier SR-036)\n");
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

  it("says how many findings the output left out instead of No problems (#304)", () => {
    const hidden = { below: "error", warning: 3, info: 0 };
    expect(renderYaml({ ok: true, problems: [], hidden })).toBe(
      "ok: true\nhidden:\n  below: error\n  warning: 3\n  info: 0\nNo problems at or above error; 3 warnings not shown.\n",
    );
    const problem = { code: "file.invalid-yaml", severity: "error", message: "Bad" };
    expect(renderYaml({ problems: [problem], hidden: { below: "error", warning: 1, info: 2 } })).toBe(
      "hidden:\n  below: error\n  warning: 1\n  info: 2\nerror  file.invalid-yaml  Bad\n1 warning and 2 info below error not shown.\n",
    );
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

describe("problemsEnd", () => {
  it("is No problems. when nothing is shown or left out, and nothing after shown problems", () => {
    expect(problemsEnd({}, 0)).toBe("No problems.\n");
    expect(problemsEnd({}, 2)).toBe("");
  });

  it("counts the findings left out by severity (#304)", () => {
    expect(problemsEnd({ hidden: { below: "warning", warning: 0, info: 1 } }, 0)).toBe(
      "No problems at or above warning; 1 info not shown.\n",
    );
    expect(problemsEnd({ hidden: { below: "error", warning: 2, info: 3 } }, 1)).toBe(
      "2 warnings and 3 info below error not shown.\n",
    );
  });

  it("ignores a hidden that leaves nothing out or has another shape", () => {
    expect(problemsEnd({ hidden: { below: "error", warning: 0, info: 0 } }, 0)).toBe("No problems.\n");
    expect(problemsEnd({ hidden: { below: "error", warning: "3", info: 0 } }, 0)).toBe("No problems.\n");
    expect(problemsEnd({ hidden: "3 warnings" }, 1)).toBe("");
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
