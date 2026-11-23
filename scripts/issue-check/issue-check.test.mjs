import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkIssues, criterionCounts, parseArgs, parseSrLine, run } from "./issue-check.mjs";

const counts = new Map([
  ["SR-901", 7],
  ["SR-902", 3],
]);
const issue = (number, sr) => ({ number, body: `Text.\n\nSR: ${sr}\n` });

describe("parseSrLine", () => {
  it("reads numbers, ranges with either dash, and an SR without parentheses", () => {
    const parsed = parseSrLine("Intro\nSR: SR-901 (AK1–AK3, AK5), SR-902 (AK2-3), SR-903\n");
    expect([...parsed.get("SR-901")]).toEqual([1, 2, 3, 5]);
    expect([...parsed.get("SR-902")]).toEqual([2, 3]);
    expect(parsed.get("SR-903")).toBe("all");
  });

  it("returns an empty map without an SR line and skips parts it cannot read", () => {
    expect(parseSrLine("no line").size).toBe(0);
    expect(parseSrLine(undefined).size).toBe(0);
    const unreadable = [];
    expect([...parseSrLine("SR: SR-901 (AK2, see below, AK3–AK1)", unreadable).get("SR-901")]).toEqual([2]);
    expect(unreadable).toEqual(["SR-901 (see below)", "SR-901 (AK3–AK1)"]);
  });

  it("merges two entries of one SR and keeps all when one has no parentheses", () => {
    expect([...parseSrLine("SR: SR-901 (AK1), SR-901 (AK4)").get("SR-901")]).toEqual([1, 4]);
    expect(parseSrLine("SR: SR-901, SR-901 (AK4)").get("SR-901")).toBe("all");
  });
});

describe("checkIssues", () => {
  it("finds a criterion of the epic that no sub-issue carries", () => {
    const epic = issue(10, "SR-901 (AK1–AK7)");
    const subs = [issue(11, "SR-901 (AK1–AK4)"), issue(12, "SR-901 (AK6, AK7)")];
    expect(checkIssues({ epic, subs, counts })).toEqual([
      "#10 names SR-901 AK5, but no sub-issue carries it",
    ]);
  });

  it("finds a criterion in a sub-issue that the epic does not name, and numbers beyond the spec", () => {
    const epic = issue(10, "SR-902 (AK1)");
    const subs = [issue(11, "SR-902 (AK1, AK2, AK4)")];
    expect(checkIssues({ epic, subs, counts })).toEqual([
      "a sub-issue carries SR-902 AK2, AK4, but #10 does not name it",
      "SR-902 has 3 criteria in spec/, not AK4",
    ]);
  });

  it("checks a required SR against all its criteria, and an SR line without parentheses as all", () => {
    const epic = issue(10, "SR-902");
    const subs = [issue(11, "SR-902 (AK1, AK2)")];
    const required = new Map([
      ["SR-902", "all"],
      ["SR-999", "all"],
    ]);
    expect(checkIssues({ epic, subs, required, counts })).toEqual([
      "#10 names SR-902 AK3, but no sub-issue carries it",
      "SR-999 is not in spec/",
      "SR-902 AK3 is in no sub-issue",
    ]);
    const all = new Map([["SR-902", "all"]]);
    expect(checkIssues({ epic, subs: [issue(11, "SR-902")], required: all, counts })).toEqual([]);
  });

  it("requires only the named criteria of a changed SR, and reports a number beyond the spec in the epic", () => {
    const epic = issue(10, "SR-901 (AK2), SR-902 (AK1, AK4)");
    const subs = [issue(11, "SR-901 (AK2), SR-902 (AK1)")];
    const required = new Map([["SR-901", new Set([2])]]);
    expect(checkIssues({ epic, subs, required, counts })).toEqual([
      "#10 names SR-902 AK4, but no sub-issue carries it",
      "SR-902 has 3 criteria in spec/, not AK4",
    ]);
  });

  it("reports a part of an SR line it cannot read", () => {
    expect(checkIssues({ epic: issue(10, "SR-901 (AK 2)"), subs: [], counts })).toEqual([
      "cannot read SR-901 (AK 2) in an SR line",
    ]);
  });

  it("treats an SR unknown to spec/ without parentheses as having no criteria", () => {
    expect(checkIssues({ epic: issue(10, "SR-999"), subs: [], counts })).toEqual([]);
  });

  it("checks the issues of a cut without an epic against the required SRs and spec/ only", () => {
    const subs = [issue(11, "SR-901 (AK1, AK2)"), issue(12, "SR-901 (AK4), SR-902 (AK1, AK5)")];
    const required = new Map([
      ["SR-901", new Set([1, 2, 3, 4])],
      ["SR-902", new Set([1])],
    ]);
    expect(checkIssues({ subs, required, counts })).toEqual([
      "SR-901 AK3 is in no issue",
      "SR-902 has 3 criteria in spec/, not AK5",
    ]);
    const met = new Map([["SR-901", new Set([1, 2, 4])]]);
    expect(
      checkIssues({ subs: subs.slice(0, 1).concat(issue(12, "SR-901 (AK4)")), required: met, counts }),
    ).toEqual([]);
  });
});

describe("run and parseArgs", () => {
  it("reads the epic and its sub-issues through the API", () => {
    const api = (route) =>
      route.endsWith("/sub_issues?per_page=100") ? [issue(11, "SR-901 (AK1)")] : issue(10, "SR-902");
    const { problems, lines } = run({ epicNumber: 10, required: new Map(), api, counts });
    expect(problems).toEqual([
      "#10 names SR-902 AK1, AK2, AK3, but no sub-issue carries it",
      "a sub-issue carries SR-901 AK1, but #10 does not name it",
    ]);
    expect(lines[0]).toBe("epic #10, sub-issues #11");
    const none = run({
      epicNumber: 10,
      required: [],
      api: (r) => (r.includes("sub_issues") ? [] : issue(10, "")),
      counts,
    });
    expect(none.lines).toEqual(["epic #10, sub-issues none", "every criterion is in a sub-issue"]);
  });

  it("reads the given issues through the API when there is no epic", () => {
    const routes = [];
    const api = (route) => {
      routes.push(route);
      return route.endsWith("/11") ? issue(11, "SR-902 (AK1, AK2)") : issue(12, "SR-902 (AK3)");
    };
    const required = new Map([["SR-902", "all"]]);
    const { problems, lines } = run({ issueNumbers: [11, 12], required, api, counts });
    expect(routes).toEqual([
      "repos/ThomasBirkmaier/ReqSeq/issues/11",
      "repos/ThomasBirkmaier/ReqSeq/issues/12",
    ]);
    expect(problems).toEqual([]);
    expect(lines).toEqual(["issues #11, #12", "every criterion is in an issue"]);
    const gap = run({ issueNumbers: [11], required, api, counts });
    expect(gap.lines).toEqual(["issues #11", "SR-902 AK3 is in no issue"]);
  });

  it("counts the criteria of each SR in the spec of this repository", () => {
    expect(criterionCounts(path.join(process.cwd(), "spec")).get("SR-001")).toBeGreaterThan(0);
  });

  it("parses the epic number and the required SRs in the format of an SR line", () => {
    const { epicNumber, required, error } = parseArgs([
      "--epic",
      "1601",
      "--require",
      "SR-901, SR-902 (AK2)",
    ]);
    expect(epicNumber).toBe(1601);
    expect(error).toBeUndefined();
    expect(required.get("SR-901")).toBe("all");
    expect([...required.get("SR-902")]).toEqual([2]);
  });

  it("joins every --require and refuses a repeated --epic or a flag without a value", () => {
    const { required, error } = parseArgs([
      "--require",
      "SR-901 (AK1), SR-902 (AK1)",
      "--require",
      "SR-901 (AK3)",
      "--require",
      "SR-902, SR-903 (AK2)",
    ]);
    expect(error).toBeUndefined();
    expect([...required.get("SR-901")]).toEqual([1, 3]);
    expect(required.get("SR-902")).toBe("all");
    expect([...required.get("SR-903")]).toEqual([2]);
    expect(parseArgs(["--epic", "5", "--epic", "6"]).error).toBe("--epic given twice");
    expect(parseArgs(["--epic", "5", "--require"]).error).toBe("--require needs a value");
    expect(parseArgs(["--epic", "--require", "SR-901"]).error).toBe("--epic needs a value");
    expect(parseArgs(["--epic", ""]).error).toBe("--epic needs a value");
  });

  it("parses repeated --issue with --require, and refuses --issue with --epic, without --require or a number", () => {
    const parsed = parseArgs([
      "--issue",
      "2428",
      "--require",
      "SR-901 (AK3)",
      "--issue",
      "#2429",
      "--issue",
      "2428",
    ]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.epicNumber).toBeUndefined();
    expect(parsed.issueNumbers).toEqual([2428, 2429]);
    expect([...parsed.required.get("SR-901")]).toEqual([3]);
    expect(parseArgs(["--epic", "5"]).issueNumbers).toEqual([]);
    expect(parseArgs(["--epic", "5", "--issue", "6", "--require", "SR-901"]).error).toBe(
      "--issue checks a cut without an epic; give --epic or --issue",
    );
    expect(parseArgs(["--issue", "6"]).error).toBe("--issue needs --require");
    expect(parseArgs(["--issue", "six", "--require", "SR-901"]).error).toBe(
      "--issue needs an issue number, not six",
    );
    expect(parseArgs(["--issue", "0", "--require", "SR-901"]).error).toBe(
      "--issue needs an issue number, not 0",
    );
    expect(parseArgs(["--issue", "--require", "SR-901"]).error).toBe("--issue needs a value");
  });

  it("refuses an unknown argument and a part of --require it cannot read", () => {
    expect(parseArgs(["--epic", "5", "--sr", "SR-901"]).error).toBe("unknown argument --sr");
    expect(parseArgs(["--epic", "5", "--require", "SR-901 (AK x)"]).error).toBe(
      "cannot read SR-901 (AK x) in --require",
    );
  });
});

describe("the command line", () => {
  it("prints the usage for --help and exits with 0", () => {
    const script = path.join(import.meta.dirname, "issue-check.mjs");
    const output = execFileSync(process.execPath, [script, "--help"], { encoding: "utf8" });
    expect(output).toMatch(/^usage: node scripts\/issue-check\/issue-check\.mjs --epic <n>/);
    expect(output).toMatch(/--issue <n> \[--issue <n>\]\.\.\. --require/);
  });

  it("refuses --issue without --require with exit code 2", () => {
    const script = path.join(import.meta.dirname, "issue-check.mjs");
    let failure;
    try {
      execFileSync(process.execPath, [script, "--issue", "5"], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      failure = error;
    }
    expect(failure?.status).toBe(2);
    expect(failure?.stderr).toBe("--issue needs --require\n");
  });
});
