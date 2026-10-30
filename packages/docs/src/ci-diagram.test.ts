import { describe, expect, it } from "vitest";
import { ciDiagram, expandMatrix, parseWorkflow } from "./ci-diagram.js";

const WORKFLOW = `
name: Sample
on:
  pull_request:
    types: [opened, closed]
    branches: main
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch:
    inputs:
      tag: { type: string }
jobs:
  lint:
    runs-on: ubuntu-24.04
  test:
    name: test (\${{ matrix.os }})
    needs: lint
    strategy:
      matrix:
        os: [ubuntu-24.04, macos-14, windows-2025]
    runs-on: \${{ matrix.os }}
  gate:
    needs: [test]
    strategy:
      matrix:
        os: [windows-2025]
    runs-on: ubuntu-24.04
  publish:
    needs: gate
    uses: ./.github/workflows/other.yml
`;

describe("expandMatrix", () => {
  it("is one empty combination without a matrix", () => {
    expect(expandMatrix(undefined)).toEqual([{}]);
  });

  it("takes the product, removes exclude, extends matching combinations and adds the rest from include", () => {
    const matrix = {
      os: ["a", "b"],
      n: [1, 2],
      exclude: [{ os: "b", n: 2 }],
      include: [{ os: "a", extra: "x" }, { os: "c" }],
    };
    expect(expandMatrix(matrix)).toEqual([
      { os: "a", n: 1, extra: "x" },
      { os: "a", n: 2, extra: "x" },
      { os: "b", n: 1 },
      { os: "c" },
    ]);
    expect(expandMatrix({ include: [{ os: "a" }, { os: "b" }] })).toEqual([{ os: "a" }, { os: "b" }]);
  });
});

describe("parseWorkflow", () => {
  it("reads the triggers and one run per matrix combination, named as GitHub names its check", () => {
    const workflow = parseWorkflow("sample.yml", WORKFLOW);
    expect(workflow.name).toBe("Sample");
    expect(workflow.triggers).toEqual([
      { event: "pull_request", details: ["opened, closed", "branches: main"] },
      { event: "schedule", details: ["cron 0 2 * * * (UTC)"] },
      { event: "workflow_dispatch", details: ["inputs: tag"] },
    ]);
    expect(workflow.runs.map(({ name, lane, runsOn, depth }) => [name, lane, runsOn, depth])).toEqual([
      ["lint", "ubuntu-24.04", "ubuntu-24.04", 0],
      ["test (ubuntu-24.04)", "ubuntu-24.04", "ubuntu-24.04", 1],
      ["test (macos-14)", "macos-14", "macos-14", 1],
      ["test (windows-2025)", "windows-2025", "windows-2025", 1],
      ["gate (windows-2025)", "windows-2025", "ubuntu-24.04", 2],
      ["publish", "reusable workflow", "calls ./.github/workflows/other.yml", 3],
    ]);
  });

  it("takes `on` as a single event or a list, and the file name when the workflow has no name", () => {
    const jobs = "jobs:\n  a:\n    runs-on: ubuntu-24.04\n";
    expect(parseWorkflow("a.yml", `on: push\n${jobs}`)).toMatchObject({
      name: "a.yml",
      triggers: [{ event: "push" }],
    });
    expect(parseWorkflow("b.yml", `on: [push, issues]\n${jobs}`).triggers.map((t) => t.event)).toEqual([
      "push",
      "issues",
    ]);
  });
});

describe("ciDiagram", () => {
  it("draws every run, marks the required ones, and links each run to the runs it needs", () => {
    const svg = ciDiagram([parseWorkflow("sample.yml", WORKFLOW)], ["lint", "gate (windows-2025)"]);
    for (const name of [
      "lint",
      "test (macos-14)",
      "gate (windows-2025)",
      "publish",
      "MACOS-14",
      "REUSABLE WORKFLOW",
    ]) {
      expect(svg).toContain(`>${name}<`);
    }
    expect(svg).toContain("job gate · runs on ubuntu-24.04");
    expect(svg.match(/>required</g)).toHaveLength(2);
    // Bus to lint, lint to three test runs, three test runs to gate, gate to publish.
    expect(svg.match(/marker-end/g)).toHaveLength(1 + 3 + 3 + 1);
  });

  it("orders lanes Ubuntu, macOS, Windows, then the others by name", () => {
    const jobs = ["zeta", "alpha", "windows-2025", "ubuntu-24.04"].map(
      (os, i) => `  j${String(i)}:\n    runs-on: ${os}\n`,
    );
    const svg = ciDiagram([parseWorkflow("x.yml", `on: push\njobs:\n${jobs.join("")}`)]);
    const order = ["UBUNTU-24.04", "WINDOWS-2025", "ALPHA", "ZETA"].map((lane) => svg.indexOf(`>${lane}<`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
