// The verification in the rows of a list (SR-137) on the built app, on fixtures/SR-136/graph: the package
// page of P1 shows right of each row's status what the element's graph node shows, the status word and the
// ring, as `reqseq element list` gives it with `withVerification` (SR-080, AK3), and the statuses of its
// rows count as the degree line under its title (AK2). A screenshot in the light scheme goes to
// `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { degreePercent } from "@reqseq/core/verification-degree";
import { launchApp } from "./support/app.js";

const P1 = "37373737-3737-4737-8737-00000000d001";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

interface ListOutput {
  readonly elements: readonly { readonly title: string }[];
  readonly rowVerification: readonly {
    readonly verification?: readonly { readonly status: string }[];
    readonly criteria?: { readonly verified: number; readonly total: number };
    readonly degree?: { readonly share?: number };
  }[];
}

type Running = Awaited<ReturnType<typeof launchApp>>;

/** Opens the package page of P1 and waits until every row has its verification as `expected` says. */
const openP1 = async (running: Running): Promise<{ title: string; verification: string }[]> => {
  const { window } = running;
  await expect(window.getByLabel("Modeline")).toContainText("Weather station", { timeout: 0 });
  await running.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
  });
  const result = await running.cli([
    "element",
    "list",
    "--input",
    JSON.stringify({ selection: { where: { package: P1 } }, withVerification: true, limit: 5000 }),
  ]);
  expect(result.code).toBe(0);
  const output = JSON.parse(result.stdout) as ListOutput;
  const expected = output.elements
    .map((element, at) => {
      const row = output.rowVerification[at];
      const status = row?.verification?.[0]?.status ?? "";
      const ring =
        row?.criteria === undefined
          ? row?.degree?.share === undefined
            ? ""
            : degreePercent(row.degree.share)
          : `${String(row.criteria.verified)} of ${String(row.criteria.total)}`;
      return { title: element.title, verification: `${status}${ring}` };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type("PKG-00d001");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("PKG-00d001");
  await window.keyboard.press("Enter");
  const shown = (): Promise<{ title: string; verification: string }[]> =>
    window.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".members .row")]
        .map((row) => ({
          title: row.querySelector(".title")?.textContent ?? "",
          verification: row.querySelector(".verification")?.textContent ?? "",
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    );
  await expect.poll(shown).toEqual(expected);
  return expected;
};

test("[SR-137/AK3] the rows of a package page show the status and ring of their nodes, as the CLI gives them", async () => {
  const running = await launchApp({ fixture: "SR-136/graph" }, { colorScheme: "light" });
  try {
    const rows = await openP1(running);
    expect(rows.some(({ verification }) => verification.includes(" of "))).toBe(true);
    await fs.mkdir(OUT, { recursive: true });
    await running.window.screenshot({ path: path.join(OUT, "sr-137-light.png") });
  } finally {
    await running.close();
  }
});

test("[SR-137/AK2] the statuses in the rows of a package page count as its degree line", async () => {
  const running = await launchApp({ fixture: "SR-136/graph" }, { colorScheme: "light" });
  try {
    const rows = await openP1(running);
    const counted = new Map<string, number>();
    for (const { verification } of rows) {
      const status = /^(open|verified|indirect|failed|outdated)/.exec(verification)?.[1];
      if (status !== undefined) {
        counted.set(status, (counted.get(status) ?? 0) + 1);
      }
    }
    const line = running.window.locator(".package-summary");
    await expect(line).toContainText("Degree");
    // "Degree (core) 60 % (6 verified, 1 failed, 1 outdated, 2 open)": the count of each status that occurs.
    const text = (await line.textContent()) ?? "";
    const named = new Map(
      [...text.matchAll(/(\d+) (open|verified|indirect|failed|outdated)/g)].map(([, n, status]) => [
        status ?? "",
        Number(n),
      ]),
    );
    expect(Object.fromEntries(counted)).toEqual(Object.fromEntries(named));
    expect(counted.size).toBeGreaterThan(1);
  } finally {
    await running.close();
  }
});

/** An edge of the cells a selector finds in each row of P1's page, one per row that has it. */
const edges = (running: Running, cell: string, side: "left" | "right"): Promise<number[]> =>
  running.window.evaluate(
    ([selector, edge]) =>
      [...document.querySelectorAll<HTMLElement>(".members .row")]
        .map((row) => row.querySelector(selector)?.getBoundingClientRect()[edge])
        .filter((at): at is number => at !== undefined),
    [cell, side] as const,
  );

/** The edges, rounded to pixels; all the same when the cells stand in one line. */
const line = async (running: Running, cell: string, side: "left" | "right"): Promise<Set<number>> => {
  const found = await edges(running, cell, side);
  expect(found.length, cell).toBeGreaterThan(1);
  return new Set(found.map((at) => Math.round(at)));
};

for (const colorScheme of ["light", "dark"] as const) {
  test(`[SR-137/AK3] the status, verification status and ring stand in one line in every row (${colorScheme})`, async () => {
    const running = await launchApp({ fixture: "SR-136/graph" }, { colorScheme });
    try {
      const rows = await openP1(running);
      // The rows carry status words and ring texts of different widths ("verified", "failed", "1 of 1").
      expect(new Set(rows.map(({ verification }) => verification.length)).size).toBeGreaterThan(1);
      for (const cell of [":scope > .status", ".verification .status", ".graph-ring svg"]) {
        expect((await line(running, cell, "left")).size, cell).toBe(1);
      }
      // The ring's text stands right-aligned before the ring.
      const textEnds = await line(running, ".ring-text", "right");
      expect(textEnds.size).toBe(1);
      const [ring] = await line(running, ".graph-ring svg", "left");
      const [textEnd] = textEnds;
      expect(textEnd).toBeLessThan(ring ?? 0);
      await fs.mkdir(OUT, { recursive: true });
      await running.window.screenshot({ path: path.join(OUT, `sr-137-aligned-${colorScheme}.png`) });
    } finally {
      await running.close();
    }
  });
}
