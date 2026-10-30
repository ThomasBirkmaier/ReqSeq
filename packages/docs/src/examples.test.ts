import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CliRun, GuidePage } from "./examples.js";
import {
  WORD_BUDGET,
  checkExamples,
  commandWords,
  pageSteps,
  proseWords,
  readGuidePages,
  runReqseq,
  runSteps,
  wordWarnings,
} from "./examples.js";

const page = (text: string, path = "page.md"): GuidePage => ({ path, text });
const ok = (stdout = ""): ReturnType<CliRun> => Promise.resolve({ exitCode: 0, stdout, stderr: "" });

describe("commandWords", () => {
  it("splits at blanks and joins quoted parts into one word", () => {
    expect(commandWords(`reqseq  element create need "See it" --text 'a "b"'x`)).toEqual([
      "reqseq",
      "element",
      "create",
      "need",
      "See it",
      "--text",
      'a "b"x',
    ]);
    expect(commandWords("  reqseq ")).toEqual(["reqseq"]);
  });

  it("ends a command at a comment, and keeps `#` inside a word and `$` in single quotes", () => {
    expect(commandWords("reqseq a#b 'c$d' # the rest")).toEqual(["reqseq", "a#b", "c$d"]);
  });

  it("refuses an unclosed quote and shell features", () => {
    for (const line of ['reqseq "a$b"', 'reqseq "a`b`"', 'reqseq "a\\b"']) {
      expect(() => commandWords(line), line).toThrow("shell feature");
    }
    expect(() => commandWords('reqseq "open')).toThrow("unclosed quote");
    for (const line of ["reqseq a | b", "reqseq $X", "reqseq a > b", "reqseq a && b", "reqseq C:\\x"]) {
      expect(() => commandWords(line), line).toThrow("shell feature");
    }
  });
});

describe("pageSteps", () => {
  it("takes the reqseq commands of sh blocks, in order, with the output block right after a block", () => {
    const text = [
      "---",
      "title: T",
      "---",
      "```sh",
      "# a comment",
      "reqseq workspace init . W",
      "",
      "reqseq workspace check",
      "```",
      "",
      '```text title="Output"',
      "ok: true",
      "```",
      "~~~sh",
      "reqseq --version",
      "~~~",
      "Some prose.",
      '```text title="Output"',
      "not this one",
      "```",
      "```sh",
      "ls",
      "```",
      "```js",
      "// reqseq never runs here",
      "```",
      "````text",
      "```",
      "not this: reqseq",
      "````",
      "```sh",
      "reqseq a",
      "",
      "reqseq b",
      "```",
      "```sh",
      "reqseq unclosed",
    ].join("\r\n");
    expect(pageSteps(page(text))).toEqual([
      { line: 6, argv: ["workspace", "init", ".", "W"] },
      { line: 8, argv: ["workspace", "check"], expected: ["ok: true"] },
      { line: 15, argv: ["--version"] },
      { line: 32, argv: ["a"] },
      { line: 34, argv: ["b"] },
      { line: 37, argv: ["unclosed"] },
    ]);
  });

  it("runs bash, shell and zsh blocks and blocks indented in list items, without their indent", () => {
    const text = [
      "1. First:",
      "",
      "   ```bash",
      "   reqseq a",
      "   ```",
      "",
      '   ```text title="Output"',
      "     indented",
      " less",
      "   ```",
      "```zsh",
      "reqseq b",
      "```",
    ].join("\n");
    expect(pageSteps(page(text))).toEqual([
      { line: 4, argv: ["a"], expected: ["  indented", "less"] },
      { line: 12, argv: ["b"] },
    ]);
  });

  it("refuses a reqseq command in a block that does not run, also after a prompt", () => {
    for (const block of [
      "```console\n$ reqseq a\n```",
      "```text\nreqseq a\n```",
      "```powershell\nPS> reqseq a\n```",
    ]) {
      expect(() => pageSteps(page(block, "how-to/x.md")), block).toThrow(
        /^how-to\/x\.md:1: a `reqseq` command in a `\w+` block would not run; write examples in a `sh` block$/,
      );
    }
    expect(pageSteps(page('```text title="Output"\nreqseq-workspace.yaml\n```'))).toEqual([]);
  });

  it("refuses a block that mixes reqseq with other commands", () => {
    expect(() => pageSteps(page("```sh\nreqseq a\ncd b\n```", "start/x.md"))).toThrow(
      "start/x.md:1: a block with `reqseq` commands has other commands too",
    );
  });
});

describe("runSteps", () => {
  it("binds sample IDs of an expected output to the IDs of the run and uses them in later commands", async () => {
    const run = vi.fn<CliRun>((argv) =>
      argv[0] === "create"
        ? ok("N-abc123  draft  T\nfiles:\n  need/N-000000abc123.md\nwarning  x\nwarning  y\n\n")
        : ok("N-abc123  draft  T\r\n"),
    );
    const steps = [
      {
        line: 1,
        argv: ["create"],
        expected: ["N-7fe707  draft  T", "files:", "  need/N-d0e44b7fe707.md", "..."],
      },
      {
        line: 2,
        argv: ["get", "N-7fe707", "need/N-d0e44b7fe707.md", "SR-111111"],
        expected: ["N-7fe707  ...  T"],
      },
    ];
    expect(await runSteps("p.md", steps, "/w", run)).toEqual([]);
    expect(run).toHaveBeenLastCalledWith(
      ["get", "N-abc123", "need/N-000000abc123.md", "SR-111111"],
      "/w",
      expect.any(AbortSignal),
    );
  });

  it("reports a non-zero exit code and stops", async () => {
    const run = vi.fn<CliRun>(() => Promise.resolve({ exitCode: 3, stdout: "out\n", stderr: "err\n" }));
    expect(
      await runSteps(
        "p.md",
        [
          { line: 4, argv: ["a"] },
          { line: 5, argv: ["b"] },
        ],
        "/w",
        run,
      ),
    ).toEqual(["p.md:4: reqseq a: exit code 3\nerr\nout\n"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports an output that differs from the page", async () => {
    const differs = async (expected: string[], stdout: string): Promise<string[]> =>
      runSteps("p.md", [{ line: 1, argv: ["a"], expected }], "/w", () => ok(stdout));
    expect(await differs(["one"], "two\n")).toEqual([
      "p.md:1: reqseq a: the output differs from the page\ntwo\n",
    ]);
    expect(await differs(["one", "two"], "one\n")).toHaveLength(1);
    expect(await differs(["one"], "one\ntwo\n")).toHaveLength(1);
    expect(await differs(["...", "end"], "a\nb\n")).toHaveLength(1);
    expect(await differs(["N-7fe707 N-7fe707"], "N-aaaaaa N-bbbbbb\n")).toHaveLength(1);
    expect(await differs(["N-7fe707"], "SR-aaaaaa\n")).toHaveLength(1);
    expect(await differs([], "")).toEqual([]);
  });
});

describe("runSteps timeout", () => {
  it("stops a command that does not end in time and reports it", async () => {
    let stopped: AbortSignal | undefined;
    const run: CliRun = (_argv, _cwd, signal) => {
      stopped = signal;
      return new Promise(() => undefined);
    };
    expect(await runSteps("p.md", [{ line: 3, argv: ["serve", "api"] }], "/w", run, 10)).toEqual([
      "p.md:3: reqseq serve api: did not end within 10 ms",
    ]);
    expect(stopped?.aborted).toBe(true);
    await expect(checkExamples([page("```sh\nreqseq mcp\n```")], run, 10)).rejects.toThrow(
      "did not end within 10 ms",
    );
  });
});

describe("checkExamples", () => {
  it("runs each page with examples in its own empty folder, which it removes, and counts the commands", async () => {
    const folders: string[] = [];
    const run = vi.fn<CliRun>(async (_argv, cwd) => {
      folders.push(cwd);
      expect(await readdir(cwd)).toEqual([]);
      return ok();
    });
    const pages = [
      page("```sh\nreqseq a\nreqseq b\n```", "a.md"),
      page("No examples.", "b.md"),
      page("```sh\nreqseq c\n```"),
    ];
    expect(await checkExamples(pages, run)).toBe(3);
    expect(new Set(folders).size).toBe(2);
    for (const folder of folders) {
      await expect(readdir(folder)).rejects.toThrow();
    }
  });

  it("throws with the failures of every page", async () => {
    const pages = [page("```sh\nreqseq a\n```", "a.md"), page("```sh\nreqseq b\n```", "b.md")];
    await expect(
      checkExamples(pages, () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "" })),
    ).rejects.toThrow(
      "docs: failing examples\na.md:2: reqseq a: exit code 1\n\nb.md:2: reqseq b: exit code 1\n",
    );
  });
});

describe("readGuidePages", () => {
  it("reads the Markdown pages below the folder, with `/` paths, sorted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reqseq-guide-"));
    try {
      await mkdir(join(dir, "start"));
      await writeFile(join(dir, "start", "b.md"), "B");
      await writeFile(join(dir, "index.md"), "I");
      await writeFile(join(dir, "logo.svg"), "<svg/>");
      expect(await readGuidePages(dir)).toEqual([
        { path: "index.md", text: "I" },
        { path: "start/b.md", text: "B" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runReqseq", () => {
  it("runs the command line of this build in-process and returns its output and exit code", async () => {
    const version = await runReqseq(["--version"], tmpdir(), new AbortController().signal);
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
    const unknown = await runReqseq(
      ["element", "get", "N-000000", "--workspace", "missing-folder"],
      tmpdir(),
      new AbortController().signal,
    );
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stderr).not.toBe("");
  });
});

describe("word budget", () => {
  it("counts the words of the prose only and warns above the budget", () => {
    expect(proseWords("---\ntitle: A b c\n---\nOne two, three.\n\n```sh\nreqseq a b c\n```\n- four\n")).toBe(
      4,
    );
    const long = `---\ntitle: T\n---\n${"word ".repeat(WORD_BUDGET + 1)}`;
    expect(wordWarnings([page("Short.", "a.md"), page(long, "b.md")])).toEqual([
      `b.md has ${String(WORD_BUDGET + 1)} words, above the budget of ${String(WORD_BUDGET)}`,
    ]);
  });
});
