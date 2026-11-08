// The verification badges of a requirement's page on the built app (SR-157), on fixtures/SR-034/indirect,
// which has no variants (one badge for the core) and a requirement for each status: S11 verified, P1
// indirect, C22 open, C21 failed, C23 outdated, P2 open with three missing children; and on
// fixtures/SR-030/record with a requirement of two acceptance criteria, one recorded with the CLI. The
// colours and the contrast of both halves are measured on the page in light and dark, and saved as
// screenshots to `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS). Keys use ControlOrMeta, so the
// same tests run on Linux and macOS.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** A page of fixtures/SR-034/indirect for each status. */
const PAGES = [
  { title: "Show wind speed", status: "verified" },
  { title: "Show the wind", status: "indirect" },
  { title: "Warn of hail", status: "open" },
  { title: "Warn of gusts", status: "failed" },
  { title: "Warn of lightning", status: "outdated" },
] as const;

const openElement = async (window: Page, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

const verification = (window: Page): Locator =>
  window.locator("article").getByRole("group", { name: "Verification", exact: true });

type Rgb = readonly [number, number, number];

/** The text colour and the background of a half, as the page computes them. */
const colours = (half: Locator): Promise<{ readonly text: Rgb; readonly ground: Rgb }> =>
  half.evaluate((element) => {
    const rgb = (value: string): Rgb => {
      const [r = 0, g = 0, b = 0] = (/rgba?\(([^)]*)\)/.exec(value)?.[1] ?? "").split(/[\s,/]+/).map(Number);
      return [r, g, b];
    };
    const style = getComputedStyle(element);
    return { text: rgb(style.color), ground: rgb(style.backgroundColor) };
  });

/** WCAG 2.2 contrast ratio of two colours. */
const ratio = (a: Rgb, b: Rgb): number => {
  const luminance = (rgb: Rgb): number => {
    const [r = 0, g = 0, b = 0] = rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high = 0, low = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

/**
 * Whether a colour is a grey: its channels lie close together. The greys of the sheet are slightly cool
 * (a spread of up to 17 of 255), a colour such as the accent spreads over 150.
 */
const grey = (rgb: Rgb): boolean => Math.max(...rgb) - Math.min(...rgb) <= 32;

test.describe("the verification badges", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-157/AK1] the right half gives the status with its details: the missing children, and the verified criteria", async () => {
    running = await launchApp({ fixture: "SR-034/indirect" });
    await openElement(running.window, "Warn of storms");
    await expect(verification(running.window).locator(".badge-status")).toHaveText([
      "open (missing SR-00b121 Warn of gusts, SR-00b122 Warn of hail, SR-00b123 Warn of lightning)",
    ]);
    await running.close();
    // S3 has two criteria; one record proves the first.
    running = await launchApp({
      fixture: "SR-030/record",
      files: {
        "requirements/SR-00000000c003.md":
          "---\nid: 30303030-3030-4030-8030-00000000c003\ntype: system-requirement\nstatus: draft\n" +
          "title: Show gust speed\nrequirement-type: functional\nacceptance-criteria:\n" +
          "  - Given the station runs, when a gust comes, then it shows its speed.\n" +
          "  - Given the station runs, when two gusts come, then it shows the faster.\n" +
          "derives-from:\n" +
          "  - { id: 30303030-3030-4030-8030-00000000a001, version: n1:0bb580565f4c2d88, title: Know the wind }\n" +
          "---\n",
      },
    });
    const written = await running.cli([
      ...["evidence", "record", "SR-00c003", "verification", "passed"],
      ...["--method", "test", "--item", "build-157", "--criteria", "1"],
    ]);
    expect(written.code, written.stderr).toBe(0);
    await openElement(running.window, "Show gust speed");
    await expect(verification(running.window).locator(".badge-name")).toHaveText(["Core"]);
    await expect(verification(running.window).locator(".badge-status")).toHaveText([
      "open (1 of 2 criteria, AK2 not verified)",
    ]);
  });

  test("[SR-157/AK2] a requirement no variant applies to shows one badge for the core", async () => {
    running = await launchApp({ fixture: "SR-034/indirect" });
    for (const page of PAGES) {
      await openElement(running.window, page.title);
      await expect(verification(running.window).locator(".badge")).toHaveCount(1);
      await expect(verification(running.window).locator(".badge-name")).toHaveText(["Core"]);
      await expect(verification(running.window).locator(".badge-status")).toHaveText([page.status]);
    }
  });

  test("[SR-157/AK3] the left half is grey, the right one coloured only when failed or outdated, the others grey and told apart by their text", async () => {
    running = await launchApp({ fixture: "SR-034/indirect" });
    const grounds = new Map<string, Rgb>();
    for (const page of PAGES) {
      await openElement(running.window, page.title);
      const badge = verification(running.window).locator(".badge");
      await expect(badge.locator(".badge-status")).toHaveText(page.status);
      const name = await colours(badge.locator(".badge-name"));
      const status = await colours(badge.locator(".badge-status"));
      expect([grey(name.text), grey(name.ground)], `name of ${page.status}`).toEqual([true, true]);
      const coloured = page.status === "failed" || page.status === "outdated";
      expect(grey(status.ground), `status ${page.status}`).toBe(!coloured);
      grounds.set(page.status, status.ground);
    }
    // Open, verified and indirect share one grey; failed and outdated each have a colour of their own.
    expect(grounds.get("verified")).toEqual(grounds.get("open"));
    expect(grounds.get("indirect")).toEqual(grounds.get("open"));
    expect(grounds.get("failed")).not.toEqual(grounds.get("outdated"));
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`[SR-157/AK4] the text and the background of each half have a contrast of at least 4.5:1 (${scheme})`, async () => {
      running = await launchApp({ fixture: "SR-034/indirect" }, { colorScheme: scheme });
      for (const page of PAGES) {
        await openElement(running.window, page.title);
        const badge = verification(running.window).locator(".badge");
        await expect(badge.locator(".badge-status")).toHaveText(page.status);
        for (const half of [".badge-name", ".badge-status"]) {
          const { text, ground } = await colours(badge.locator(half));
          expect(ratio(text, ground), `${half} of ${page.status}`).toBeGreaterThanOrEqual(4.5);
        }
        if (page.status === "failed" || page.status === "outdated") {
          await verification(running.window).screenshot({
            path: path.join(OUT, `sr-157-${page.status}-${scheme}.png`),
          });
        }
      }
    });
  }
});
