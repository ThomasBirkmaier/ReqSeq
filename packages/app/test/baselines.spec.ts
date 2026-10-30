// Baselines on the built app (SR-050, SR-051, SR-094): "Create baseline" on a package page, "Show
// baseline" and "Compare baseline" from the command prompt, each compared with what the CLI gives for the
// same input (SR-080). The workspaces are copies of fixtures made Git repositories here, opened in place:
// `launchApp` would copy them again. fixtures/SR-061/export (repositories `system` and `sensor`): the baseline
// „Release 2“ of the package Display (PKG-0000d1) is written at the first commit; a second commit changes
// SR-0000b1, supersedes SR-0000b2, adds SR-0000b3 to the package and changes N-0000a1, which is in no
// package (so: removed). `release-1.yaml` stores no selection. fixtures/SR-094/baseline for the evidence of
// a baseline (its README). Every rule: core `commands/baseline/`. Keys use ControlOrMeta, so the same tests
// run on Linux and macOS.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { FixtureWorkspace, RunningApp } from "./support/app.js";
import { copyFixture, launchApp } from "./support/app.js";

const execFileAsync = promisify(execFile);
const ID = "61061061-0000-4000-8000-0000000000";

/** A copy of a fixture whose repositories are Git repositories, each with one commit of everything. */
interface GitWorkspace extends FixtureWorkspace {
  /** The absolute path of `relative` (with `/`) in the copy. */
  path(relative: string): string;
  /** Runs Git in `repository` without the user's or the system's configuration; resolves its output. */
  git(args: readonly string[], repository: string): Promise<string>;
  /** Commits everything in `repository`; resolves the new commit. */
  commit(repository: string): Promise<string>;
}

/** Runs `steps` on the copy; when they fail, removes the copy first, since no app owns it yet. */
const settled = async <T>(ws: FixtureWorkspace, steps: () => Promise<T>): Promise<T> => {
  try {
    return await steps();
  } catch (error) {
    await ws.cleanup();
    throw error;
  }
};

const withGit = async (fixture: string, repositories: readonly string[]): Promise<GitWorkspace> => {
  const copy = await copyFixture({ fixture });
  // Inherited GIT_* variables (in a Git hook) would redirect the commands.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );
  // An empty global config of its own: Git on Windows cannot read `os.devNull` (`\\.\nul`) as one.
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-gitconfig-"));
  const gitconfig = path.join(configDir, "gitconfig");
  await fs.writeFile(gitconfig, "");
  const ws: GitWorkspace = {
    ...copy,
    cleanup: async () => {
      await fs.rm(configDir, { recursive: true, force: true });
      await copy.cleanup();
    },
    path: (relative) => path.join(copy.root, ...relative.split("/")),
    git: async (args, repository) =>
      (
        await execFileAsync(
          "git",
          [
            "-c",
            "user.name=ReqSeq Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
            ...args,
          ],
          {
            cwd: ws.path(repository),
            env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig },
          },
        )
      ).stdout,
    commit: async (repository) => {
      await ws.git(["add", "--all"], repository);
      await ws.git(["commit", "--quiet", "--no-verify", "-m", "fixture"], repository);
      return (await ws.git(["rev-parse", "HEAD"], repository)).trim();
    },
  };
  await settled(ws, async () => {
    for (const repository of repositories) {
      await ws.git(["init", "--quiet", "--template=", "--initial-branch=main"], repository);
      await ws.commit(repository);
    }
  });
  return ws;
};

/** Starts the app on `root` of `ws` in place: a baseline needs the Git history of the copy. */
const launchIn = async (ws: GitWorkspace, root: string): Promise<RunningApp> => {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-app-home-")));
  const running = await launchApp(undefined, {
    kept: { home, workspace: { root: ws.path(root), cleanup: () => ws.cleanup() } },
  });
  await expect(running.window.locator(".overview .line").first()).toBeVisible();
  return running;
};

const edit = async (ws: GitWorkspace, file: string, from: string, to: string): Promise<void> => {
  const at = ws.path(`system/${file}`);
  const text = await fs.readFile(at, "utf8");
  // A reworded fixture must fail here, not commit nothing.
  if (!text.includes(from)) {
    throw new Error(`${file} has no ${JSON.stringify(from)}`);
  }
  await fs.writeFile(at, text.replace(from, to));
};

/** fixtures/SR-061/export with „Release 2“ and the changes of the file comment, committed; the commits of `system`. */
const changedSince = async (): Promise<{ ws: GitWorkspace; first: string; second: string }> => {
  const ws = await withGit("SR-061/export", ["system", "sensor"]);
  return settled(ws, async () => {
    const first = (await ws.git(["rev-parse", "HEAD"], "system")).trim();
    await fs.writeFile(
      ws.path("system/baselines/Release-2.yaml"),
      [
        "reqseq-baseline: 1",
        "name: Release 2",
        "date: 2026-11-02T13:00:00Z",
        "selection:",
        `  package: { id: ${ID}d1, title: Display }`,
        "repositories:",
        `  - { name: system, commit: ${first} }`,
        "elements:",
        `  - { id: ${ID}a1, version: n1:9d97d0ccf9b75591 }`,
        `  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }`,
        `  - { id: ${ID}b2, version: n1:077d46fbf1a6a93d }`,
        "",
      ].join("\n"),
    );
    await edit(ws, "requirements/SR-0000000000b1.md", "shows the speed.", "shows the speed in knots.");
    await edit(ws, "requirements/SR-0000000000b2.md", "status: draft", "status: obsolete");
    await edit(
      ws,
      "requirements/SR-0000000000b3.md",
      "validity:",
      `packages:\n  - { id: ${ID}d1, version: n1:5862e4d618683af6 }\nvalidity:`,
    );
    await edit(ws, "needs/N-0000000000a1.md", "a1: the need", "a1: the changed need");
    const second = await ws.commit("system");
    return { ws, first, second };
  });
};

const candidates = (window: Page): Locator => window.locator('.candidates [role="option"] .name');

/** Runs the catalog command `title` from the command prompt and takes the baseline `name`; `more` offers the optional arguments. */
const runOnBaseline = async (window: Page, title: string, name: string, more = false): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(candidates(window).first()).toHaveText(title);
  await window.keyboard.press("Enter");
  await expect(window.getByLabel("Minibuffer").locator("label")).toContainText("baseline:");
  await window.keyboard.type(name);
  await expect(candidates(window).first()).toHaveText(name);
  await window.keyboard.press(more ? "ControlOrMeta+Enter" : "Enter");
};

/** The lines of the result buffer as "<label> <text>", indented by two spaces per level. */
const resultLines = async (window: Page): Promise<string[]> => {
  const lines = window.locator(".result .line");
  await expect(lines.first()).toBeVisible();
  return lines.evaluateAll((all) =>
    all.map((line) => {
      const depth = (Number.parseFloat((line as HTMLElement).style.paddingLeft) - 0.75) / 1.25;
      const parts = [...line.querySelectorAll(".label, .text")].map((part) => part.textContent);
      return `${"  ".repeat(Math.round(depth))}${parts.join(" ").trim()}`;
    }),
  );
};

/** The lines under the element row `row` (its fields), up to the next line at its depth or above. */
const fieldsOf = (lines: readonly string[], row: string): string[] => {
  const at = lines.findIndex((line) => line.trim() === row);
  expect(at, `no row ${row} in\n${lines.join("\n")}`).toBeGreaterThanOrEqual(0);
  const indent = (line: string): number => line.length - line.trimStart().length;
  const own = indent(lines[at] ?? "");
  const end = lines.findIndex((line, index) => index > at && indent(line) <= own);
  return lines.slice(at + 1, end < 0 ? undefined : end).map((line) => line.trim());
};

interface Shown {
  readonly selectionKnown: boolean;
  readonly elements: readonly {
    readonly id: string;
    readonly state: string;
    readonly version?: string;
    readonly versionDate?: string | null;
    readonly current?: string;
    readonly verification?: { readonly status: string };
  }[];
}

/** `reqseq baseline get` of the same workspace (SR-080). */
const cliGet = async (running: RunningApp, argv: readonly string[]): Promise<Shown> => {
  const result = await running.cli(["baseline", "get", ...argv]);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Shown;
};

const entry = (shown: Shown, tail: string): Shown["elements"][number] | undefined =>
  shown.elements.find((element) => element.id === `${ID}${tail}`);

test.describe("baselines in the app", () => {
  let running: RunningApp | undefined;
  test.afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  test("[SR-050/AK1] baseline.create writes a file in the baseline folder with name, date, commits and id plus version", async () => {
    const ws = await withGit("SR-061/export", ["system", "sensor"]);
    const head = (await ws.git(["rev-parse", "HEAD"], "system")).trim();
    running = await launchIn(ws, "system");
    const { window } = running;
    // The package Display: Ctrl+P, its title, Enter; its page lists SR-0000b1 and SR-0000b2.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Display");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Display");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Display");
    await expect(window.locator(".members .row")).toHaveCount(2);
    // "Create baseline" asks only the name: the selection is the package of the page.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Create baseline");
    await expect(candidates(window).first()).toHaveText("Create baseline");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Create baseline · name:");
    await window.keyboard.type("Release 3");
    await window.keyboard.press("Enter");
    const lines = await resultLines(window);
    expect(lines).toContain("files 1");
    expect(lines).toContain("  baselines/Release-3.yaml");
    expect(lines).toContain("  name Release 3");
    expect(lines).toContain("  elements 2");
    // The file in the baselines folder: name, date, the commit of `system` and ID and version of b1, b2.
    const file = await fs.readFile(ws.path("system/baselines/Release-3.yaml"), "utf8");
    expect(file).toContain("name: Release 3\n");
    expect(file).toMatch(/\ndate: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n/u);
    expect(file).toContain(`selection:\n  package: { id: ${ID}d1, title: Display }\n`);
    expect(file).toContain(`  - { name: system, commit: ${head} }\n`);
    expect(file).toContain(`  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }\n`);
    expect(file).toContain(`  - { id: ${ID}b2, version: n1:077d46fbf1a6a93d }\n`);
    // The CLI writes the same file for the same selection, apart from name and date (SR-080).
    const cli = await running.cli([
      "baseline",
      "create",
      "Release 4",
      "--input",
      JSON.stringify({ selection: { package: `${ID}d1` } }),
    ]);
    expect(cli.code, cli.stderr).toBe(0);
    const unnamed = (text: string): string =>
      text.replace(/^name: .*$/mu, "name: -").replace(/^date: .*$/mu, "date: -");
    expect(unnamed(await fs.readFile(ws.path("system/baselines/Release-4.yaml"), "utf8"))).toBe(
      unnamed(file),
    );
    // The CLI reads the baseline of the app back, with both elements unchanged.
    const shown = await cliGet(running, ["Release 3"]);
    expect(shown.elements.map((element) => [element.id, element.state])).toEqual([
      [`${ID}b1`, "unchanged"],
      [`${ID}b2`, "unchanged"],
    ]);
  });

  test("[SR-051/AK1] baseline.get shows each element with its baseline version and that version's date", async () => {
    const { ws, first } = await changedSince();
    running = await launchIn(ws, "system");
    const seconds = Number((await ws.git(["log", "-1", "--format=%ct", first], "system")).trim());
    const date = `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
    await runOnBaseline(running.window, "Show baseline", "Release 2");
    const lines = await resultLines(running.window);
    expect(fieldsOf(lines, "SR-0000b1 Show the wind speed")).toEqual(
      expect.arrayContaining(["version n1:697a2ad17ed49170", `versionDate ${date}`]),
    );
    // No old content: Git shows it (D-033).
    await expect(running.window.locator(".result")).not.toContainText("then it shows the speed.");
    expect(entry(await cliGet(running, ["Release 2"]), "b1")).toMatchObject({
      version: "n1:697a2ad17ed49170",
      versionDate: date,
    });
  });

  test("[SR-051/AK2] baseline.get marks SR-X changed, SR-Y superseded, SR-Z added; without stored selection no added and it says so", async () => {
    const { ws } = await changedSince();
    running = await launchIn(ws, "system");
    const { window } = running;
    await runOnBaseline(window, "Show baseline", "Release 2");
    const lines = await resultLines(window);
    expect(lines).toContain("selectionKnown true");
    expect(fieldsOf(lines, "SR-0000b1 Show the wind speed")).toContain("state changed");
    expect(fieldsOf(lines, "SR-0000b2 Show the gusts")).toContain("state superseded");
    expect(fieldsOf(lines, "SR-0000b3 Show the wind direction")).toContain("state added");
    const shown = await cliGet(running, ["Release 2"]);
    expect(["b1", "b2", "b3"].map((tail) => entry(shown, tail)?.state)).toEqual([
      "changed",
      "superseded",
      "added",
    ]);
    // Without a stored selection: nothing added, and the result says so.
    await runOnBaseline(window, "Show baseline", "Release 1");
    await expect(window.locator(".result .line").filter({ hasText: "selectionKnown" })).toHaveText(
      "selectionKnownfalse",
    );
    const without = await resultLines(window);
    expect(without.filter((line) => line.trim() === "state added")).toEqual([]);
    expect(without).toContain("  added 0");
    expect((await cliGet(running, ["release-1"])).selectionKnown).toBe(false);
  });

  test("[SR-051/AK3] baseline.get marks SR-W removed; without stored selection no removed", async () => {
    const { ws } = await changedSince();
    running = await launchIn(ws, "system");
    const { window } = running;
    await runOnBaseline(window, "Show baseline", "Release 2");
    const a1 = fieldsOf(await resultLines(window), "N-0000a1 Know the wind");
    expect(a1).toContain("state removed");
    expect(a1).toContain("version n1:9d97d0ccf9b75591");
    const cli = entry(await cliGet(running, ["Release 2"]), "a1");
    expect(cli).toMatchObject({ state: "removed", version: "n1:9d97d0ccf9b75591" });
    // The current version next to the one in the baseline.
    expect(a1).toContain(`current ${String(cli?.current)}`);
    await runOnBaseline(window, "Show baseline", "Release 1");
    await expect(window.locator(".result .line").filter({ hasText: "selectionKnown" })).toHaveText(
      "selectionKnownfalse",
    );
    const without = await resultLines(window);
    expect(without.filter((line) => line.trim() === "state removed")).toEqual([]);
    expect(without).toContain("  removed 0");
  });

  test("[SR-051/AK4] baseline.compare gives both commits and the git command", async () => {
    const { ws, first, second } = await changedSince();
    running = await launchIn(ws, "system");
    const { window } = running;
    await runOnBaseline(window, "Compare baseline", "Release 2");
    await expect(window.getByLabel("Minibuffer").locator("label")).toContainText("ref:");
    await window.keyboard.type("SR-0000b1");
    await expect(candidates(window).first()).toContainText("SR-0000b1");
    await window.keyboard.press("Enter");
    const file = "requirements/SR-0000000000b1.md";
    const command = ["git", "-C", ".", "diff", first, second, "--", file];
    const lines = await resultLines(window);
    expect(lines).toEqual([
      "repository system",
      `from ${first}`,
      `to ${second}`,
      `file ${file}`,
      `command ${String(command.length)}`,
      ...command.map((part) => `  ${part}`),
    ]);
    const cli = await running.cli(["baseline", "compare", "Release 2", "SR-0000b1"]);
    expect(JSON.parse(cli.stdout)).toMatchObject({ from: first, to: second, command });
    // The command, run in the workspace root, shows the change of SR-0000b1.
    const [program, ...args] = command;
    const diff = await execFileAsync(String(program), args, { cwd: ws.path("system") });
    expect(diff.stdout).toContain(
      "+  - Given wind, when the station measures it, then it shows the speed in knots.",
    );
  });

  test("[SR-094/AK1] baseline.get withEvidence gives each requirement's status for its baseline version", async () => {
    const ws = await withGit("SR-094/baseline", ["."]);
    running = await launchIn(ws, ".");
    const { window } = running;
    // Ctrl/Cmd+Enter on the baseline offers the optional arguments: withEvidence yes, then Run.
    await runOnBaseline(window, "Show baseline", "Release 1", true);
    await expect(candidates(window).first()).toHaveText("Run");
    await window.keyboard.type("withEvidence");
    await expect(candidates(window).first()).toHaveText("withEvidence");
    await window.keyboard.press("Enter");
    await window.keyboard.type("yes");
    await expect(candidates(window).first()).toHaveText("yes");
    await window.keyboard.press("Enter");
    await expect(candidates(window).first()).toHaveText("Run");
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toContainText("verification");
    const lines = await resultLines(window);
    /** The status under the row of `shortId`, as "Show baseline" gives it. */
    const status = (shortId: string): string | undefined => {
      const row = lines.find((line) => line.trim().startsWith(`${shortId} `))?.trim() ?? shortId;
      return fieldsOf(lines, row)
        .find((line) => line.startsWith("status "))
        ?.slice("status ".length);
    };
    const tails = ["b1", "b2", "b3", "b5", "b6"];
    const app = tails.map((tail) => status(`SR-0000${tail}`));
    expect(app).toEqual(["verified", "outdated", "open", "open", "verified"]);
    const shown = await cliGet(running, ["Release 1", "--with-evidence"]);
    expect(app).toEqual(
      tails.map((tail) => shown.elements.find((element) => element.id.endsWith(tail))?.verification?.status),
    );
    // The need has no verification status here: only requirements have one.
    expect(status("N-0000a1")).toBeUndefined();
  });
});
