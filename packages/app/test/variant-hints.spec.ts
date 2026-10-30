// The hints about changed core requirements on the built app, each compared with the CLI (SR-080).
// SR-045 on fixtures/SR-045/core-changed: Coast (VAR-0000c1) replaces K (SR-0000a1) by SR-A (SR-0000b1);
// here the text of K changed, so the `replaces` row on the page of SR-A is marked, and "List hints" of Coast
// lists the hint. SR-103 on a Git copy of fixtures/SR-103/since-baseline: the baseline R1 of the view of
// Coast (VAR-0000c1) is written with the CLI, then K1 (SR-0000a1) changes and K5 (SR-0000a5) is added and
// committed; the page of Coast names both, Mountain (VAR-0000c2) has no baseline. Every rule is core's
// (`packages/core/src/hints/`). Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { copyFixture, launchApp } from "./support/app.js";

const execFileAsync = promisify(execFile);

/** A hint as the CLI gives it with `--json`. */
interface Hint {
  readonly code: string;
  readonly message: string;
  readonly storedVersion?: string;
  readonly currentVersion?: string;
}

const CORE_CHANGED = "variant.core-changed";
const COAST = "10310310-0000-4000-8000-0000000000c1";
const SINCE_BASELINE = ["variant.core-changed-since-baseline", "variant.core-new-since-baseline"];

const names = (window: Page): Locator => window.locator('.candidates [role="option"] .name');
const label = (window: Page): Locator => window.locator("label.prompt-label");

/** Opens the element `title` with "Go to". */
const open = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

/** Chooses the catalog command `title` in the command prompt. */
const command = async (window: Page, title: string, more = false): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(names(window).first()).toHaveText(title);
  await window.keyboard.press(more ? "ControlOrMeta+Enter" : "Enter");
};

/** The CLI's output of `argv` as JSON; fails on another exit code than `code`. */
const cliJson = async <T>(running: RunningApp, argv: readonly string[], code = 0): Promise<T> => {
  const run = await running.cli(argv);
  expect(run.code, run.stderr).toBe(code);
  return JSON.parse(run.stdout) as T;
};

/** The hints of the element `ref` as `element get` with `hintDates` gives them, of the codes `codes`. */
const elementHints = async (
  running: RunningApp,
  ref: string,
  codes: readonly string[],
): Promise<readonly Hint[]> => {
  const got = await cliJson<{ element: { problems?: readonly Hint[] } }>(running, [
    "element",
    "get",
    "--input",
    JSON.stringify({ ref, hintDates: true }),
  ]);
  return (got.element.problems ?? []).filter((hint) => codes.includes(hint.code));
};

/** The hints `hint list` gives for `args`. */
const listed = async (running: RunningApp, ...args: string[]): Promise<readonly Hint[]> =>
  (await cliJson<{ hints: readonly Hint[] }>(running, ["hint", "list", ...args])).hints;

test.describe("the hint at a replacement when its core requirement changed (SR-045)", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    // The text of K changed after SR-A stored its version.
    const text = await fs.readFile(
      fileURLToPath(
        new URL("../../../fixtures/SR-045/core-changed/requirements/SR-0000000000a1.md", import.meta.url),
      ),
      "utf8",
    );
    running = await launchApp({
      fixture: "SR-045/core-changed",
      files: {
        "requirements/SR-0000000000a1.md": text.replace(
          "The station answers within 10 ms.",
          "The station answers within 10 ms, also at night.",
        ),
      },
    });
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-045/AK1] the page of SR-A marks its replaces row with the one hint, and List hints of A lists it", async () => {
    const { window } = running;
    const [hint, ...others] = await elementHints(running, "SR-0000b1", [CORE_CHANGED, "relation.outdated"]);
    expect(others).toEqual([]);
    expect(hint?.code).toBe(CORE_CHANGED);
    // Both versions of K, the message names them by their dates (D-013).
    expect([hint?.storedVersion, hint?.currentVersion]).toEqual([
      expect.stringMatching(/^n1:/),
      expect.stringMatching(/^n1:/),
    ]);
    expect(hint?.message).toMatch(/stored version from .+, current version from .+$/);
    await open(window, "Response time at most 20 ms");
    const mark = window.locator("article .relation .outdated");
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute("title", hint?.message ?? "");
    await expect(mark).toContainText("outdated");
    // One hint, counted once (SR-114 AK2), not a second one beside it.
    await expect(window.getByLabel("Modeline")).toContainText("1 outdated");
    await expect(window.getByLabel("Modeline")).not.toContainText("hints");
    // The list of the hints of Coast, as `hint list --variant` gives it.
    const ofCoast = (await listed(running, "--variant", "VAR-0000c1")).filter((h) => h.code === CORE_CHANGED);
    expect(ofCoast.map((h) => h.message)).toEqual([hint?.message]);
    await command(window, "List hints", true);
    await expect(label(window)).toHaveText("List hints · more arguments:");
    await window.keyboard.type("variant");
    await expect(names(window).first()).toHaveText("variant");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Coast");
    await expect(names(window).first()).toHaveText("VAR-0000c1 Coast");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("List hints VAR-0000c1 · more arguments:");
    await expect(names(window).first()).toHaveText("Run");
    await window.keyboard.press("Enter");
    const result = window.locator(".result");
    await expect(result.locator(".line").filter({ hasText: CORE_CHANGED })).toHaveCount(1);
    await expect(result).toContainText(ofCoast[0]?.message ?? "-");
  });

  test("[SR-045/AK2] Confirm hints on SR-A writes the current version of K and the hint is gone", async () => {
    const { window } = running;
    await open(window, "Response time at most 20 ms");
    await expect(window.locator("article .relation .outdated")).toHaveCount(1);
    await command(window, "Confirm hints");
    await expect(label(window)).toHaveText("Confirm hints · ref:");
    await expect(names(window).first()).toHaveText("SR-0000b1 Response time at most 20 ms");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Confirm hints SR-0000b1 · hintIds:");
    // The hint is offered by its message.
    const [hint] = await elementHints(running, "SR-0000b1", [CORE_CHANGED]);
    await expect(names(window).first()).toHaveText(hint?.message ?? "-");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toContainText("confirmed");
    await open(window, "Response time at most 20 ms");
    await expect(window.locator("article .relation .outdated")).toHaveCount(0);
    expect(await elementHints(running, "SR-0000b1", [CORE_CHANGED, "relation.outdated"])).toEqual([]);
    const k = await cliJson<{ element: { version: string } }>(running, ["element", "get", "SR-0000a1"]);
    const file = await fs.readFile(
      path.join(running.workspace?.root ?? "", "requirements", "SR-0000000000b1.md"),
      "utf8",
    );
    expect(file).toContain(
      `{ id: 45045045-0000-4000-8000-0000000000a1, version: ${k.element.version}, title: Response time at most 10 ms }`,
    );
  });
});

/** A Git copy of fixtures/SR-103/since-baseline; resolves the folder and a Git runner on it. */
const gitCopy = async (): Promise<{
  root: string;
  git: (args: readonly string[]) => Promise<string>;
  cleanup: () => Promise<void>;
}> => {
  const copy = await copyFixture({ fixture: "SR-103/since-baseline" });
  // Inherited GIT_* variables (in a Git hook) would redirect the commands.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );
  // An empty global config of its own: Git on Windows cannot read `os.devNull` (`\\.\nul`) as one.
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-gitconfig-"));
  const gitconfig = path.join(configDir, "gitconfig");
  const cleanup = async (): Promise<void> => {
    await fs.rm(configDir, { recursive: true, force: true });
    await copy.cleanup();
  };
  const git = async (args: readonly string[]): Promise<string> =>
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
        { cwd: copy.root, env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig } },
      )
    ).stdout;
  try {
    await fs.writeFile(gitconfig, "");
    await git(["init", "--quiet", "--template=", "--initial-branch=main"]);
    await git(["add", "--all"]);
    await git(["commit", "--quiet", "--no-verify", "-m", "fixture"]);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { root: copy.root, git, cleanup };
};

const K5 =
  "---\nid: 10310310-0000-4000-8000-0000000000a5\ntype: system-requirement\nstatus: draft\n" +
  "title: Measure the wind\nrequirement-type: functional\nacceptance-criteria:\n" +
  "  - Given wind, when it blows, then the station measures it.\n---\n\nThe station measures the wind.\n";

test.describe("the hints at a variant since its newest baseline (SR-103)", () => {
  let running: RunningApp;
  let ws: Awaited<ReturnType<typeof gitCopy>>;
  test.beforeEach(async () => {
    ws = await gitCopy();
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-app-home-")));
    running = await launchApp(undefined, {
      kept: { home, workspace: { root: ws.root, cleanup: ws.cleanup } },
    });
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
    // R1 of the view of Coast, then K1 changed and K5 added, committed.
    await cliJson(running, ["baseline", "create", "R1", "--input", '{"selection":{"view":"VAR-0000c1"}}']);
    const k1 = path.join(ws.root, "requirements", "SR-0000000000a1.md");
    const text = await fs.readFile(k1, "utf8");
    expect(text).toContain("every minute.\n");
    await fs.writeFile(k1, text.replace("every minute.\n", "every 30 seconds.\n"));
    await fs.writeFile(path.join(ws.root, "requirements", "SR-0000000000a5.md"), K5);
    await ws.git(["add", "--all"]);
    await ws.git(["commit", "--quiet", "--no-verify", "-m", "change"]);
    // The app has read the change from outside once "Go to" finds K5, written after K1.
    const { window } = running;
    await expect(async () => {
      await window.keyboard.press("Escape");
      await window.keyboard.press("ControlOrMeta+P");
      await window.keyboard.type("Measure the wind");
      await expect(window.locator('.candidates [role="option"]').first()).toContainText("Measure the wind", {
        timeout: 1000,
      });
    }).toPass();
    await window.keyboard.press("Escape");
  });
  test.afterEach(async () => {
    await running.close();
  });

  /** The lines of the hints since the newest baseline on the page shown. */
  const sinceBaseline = (window: Page): Locator => window.locator("article .since-baseline");

  test("[SR-103/AK1] the page of A names the adopted core requirement changed since its newest baseline with both versions", async () => {
    const { window } = running;
    const hints = await elementHints(running, "VAR-0000c1", SINCE_BASELINE);
    expect(hints.map((h) => h.code)).toEqual(SINCE_BASELINE);
    const [changed] = hints;
    expect(changed?.message).toContain(`version ${changed?.storedVersion ?? "-"} there`);
    expect(changed?.message).toContain(`version ${changed?.currentVersion ?? "-"} now`);
    // `hint list` of Coast gives the same.
    const ofCoast = await listed(running, "--variant", "VAR-0000c1");
    expect(ofCoast.filter((h) => SINCE_BASELINE.includes(h.code)).map((h) => h.message)).toEqual(
      hints.map((h) => h.message),
    );
    await open(window, "Coast");
    await expect(
      window
        .locator("article")
        .getByRole("group", { name: "Changed since the newest baseline", exact: true }),
    ).toHaveText(changed?.message ?? "-");
    await expect(window.getByLabel("Modeline")).toContainText("2 hints");
  });

  test("[SR-103/AK7] the page of A names a core requirement new in its view since the baseline, with its current version only", async () => {
    const { window } = running;
    const [, added] = await elementHints(running, "VAR-0000c1", SINCE_BASELINE);
    expect(added?.code).toBe("variant.core-new-since-baseline");
    expect(added?.storedVersion).toBeUndefined();
    expect(added?.message).toContain(`version ${added?.currentVersion ?? "-"} now`);
    await open(window, "Coast");
    await expect(
      window.locator("article").getByRole("group", { name: "New since the newest baseline", exact: true }),
    ).toHaveText(added?.message ?? "-");
  });

  test("[SR-103/AK3] the page of a variant without baseline shows no such hint", async () => {
    const { window } = running;
    expect(await elementHints(running, "VAR-0000c2", SINCE_BASELINE)).toEqual([]);
    await open(window, "Coast");
    await expect(sinceBaseline(window)).toHaveCount(2);
    await open(window, "Mountain");
    await expect(window.locator("article")).toContainText("The station for the mountains.");
    await expect(sinceBaseline(window)).toHaveCount(0);
  });

  test("[SR-103/AK2] after a new baseline of A the open page of A shows the hints no more", async () => {
    const { window } = running;
    await open(window, "Coast");
    await expect(sinceBaseline(window)).toHaveCount(2);
    // A core requirement changed from outside shows on the open page, the modeline's count too.
    const k2 = path.join(ws.root, "requirements", "SR-0000000000a2.md");
    await fs.writeFile(k2, `${await fs.readFile(k2, "utf8")}Also at night.\n`);
    await ws.git(["commit", "--quiet", "--no-verify", "--all", "-m", "K2"]);
    const changed = await elementHints(running, "VAR-0000c1", SINCE_BASELINE);
    expect(changed).toHaveLength(3);
    await expect(sinceBaseline(window)).toHaveText(changed.map((h) => h.message));
    await expect(window.getByLabel("Modeline")).toContainText("3 hints");
    // R2 of the view of Coast, made in the app from the list in that view beside the open page of Coast.
    await command(window, "Choose view");
    await window.keyboard.type("Coast");
    await expect(names(window).first()).toHaveText("VAR-0000c1 Coast");
    await window.keyboard.press("Enter");
    await command(window, "List all elements");
    await expect(window.locator(".list")).toBeVisible();
    await command(window, "Split window");
    const page = window.locator('[data-area="right"]');
    await expect(page.locator("article h1")).toHaveText("Coast");
    await expect(page.locator(".since-baseline")).toHaveCount(3);
    await command(window, "Create baseline");
    await expect(label(window)).toContainText("Create baseline");
    await window.keyboard.type("R2");
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toContainText("R2");
    const r2 = await fs.readFile(path.join(ws.root, "baselines", "R2.yaml"), "utf8");
    expect(r2).toContain(COAST);
    expect(await elementHints(running, "VAR-0000c1", SINCE_BASELINE)).toEqual([]);
    // The page of Coast, open beside it all the time, shows none.
    await expect(page.locator(".since-baseline")).toHaveCount(0);
  });

  test("[SR-103/AK5] Confirm hints on A offers none of them and shows core's refusal with its reason", async () => {
    const { window } = running;
    const before = await fs.readFile(path.join(ws.root, "variants", "VAR-0000000000c1.md"), "utf8");
    const refused = await cliJson<{ problems: readonly { code: string; message: string }[] }>(
      running,
      // The app names Coast by its UUID, and core's message names the element as it was given.
      ["hint", "confirm", "--ref", COAST],
      1,
    );
    const reason = refused.problems.find((problem) => problem.code === "hint.not-confirmable");
    expect(reason?.message).toContain("settled only by a new baseline");
    await open(window, "Coast");
    await expect(sinceBaseline(window)).toHaveCount(2);
    await command(window, "Confirm hints");
    await expect(label(window)).toHaveText("Confirm hints · ref:");
    await expect(names(window).first()).toHaveText("VAR-0000c1 Coast");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Confirm hints VAR-0000c1 · hintIds:");
    // Neither hint has a hint ID to confirm: nothing is offered.
    await expect(names(window)).toHaveCount(0);
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toContainText(reason?.message ?? "-");
    expect(await fs.readFile(path.join(ws.root, "variants", "VAR-0000000000c1.md"), "utf8")).toBe(before);
    await open(window, "Coast");
    await expect(sinceBaseline(window)).toHaveCount(2);
  });
});
