// The verification in the graph of an element (SR-136) on the built app, on fixtures/SR-136/graph: each
// requirement node shows its status word and the ring of its verified acceptance criteria, the need its
// degree, each as `reqseq trace graph` gives it for the same input (SR-080). A screenshot in the light
// scheme goes to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { launchApp } from "./support/app.js";

const N1 = "37373737-3737-4737-8737-00000000a001";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

interface GraphOutput {
  readonly nodes: readonly {
    readonly id: string;
    readonly repository: string;
    readonly verification?: readonly { readonly status: string }[];
    readonly criteria?: { readonly verified: number; readonly total: number };
    readonly degree?: { readonly share?: number };
  }[];
}

test("[SR-136/AK-h2xg] each requirement shows its status and ring, the need its degree, as the CLI gives them", async () => {
  const running = await launchApp({ fixture: "SR-136/graph" }, { colorScheme: "light" });
  const { window } = running;
  try {
    await expect(window.getByLabel("Modeline")).toContainText("Weather station", { timeout: 0 });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    const result = await running.cli([
      "trace",
      "graph",
      "--input",
      JSON.stringify({ ref: N1, maxDepth: 1, limit: 500 }),
    ]);
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout) as GraphOutput;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("N-00a001");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("See the weather");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("See the weather");
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", String(output.nodes.length));
    const shown = await window.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".graph-node")].map((node) => ({
        key: node.dataset["node"],
        status: node.querySelector(".graph-marks .status")?.textContent ?? null,
        accent: node.querySelector(".graph-marks .status.accent") !== null,
        ring: node.querySelector(".graph-ring")?.textContent ?? null,
      })),
    );
    expect(shown).toEqual(
      output.nodes.map((node) => {
        const status = node.verification?.[0]?.status ?? null;
        const { criteria, degree } = node;
        return {
          key: `${node.repository}:${node.id}`,
          status,
          accent: status === "failed" || status === "outdated",
          ring:
            criteria === undefined
              ? degree?.share === undefined
                ? null
                : `${String(Math.floor(degree.share * 1000 + 1e-9) / 10)} %`
              : `${String(criteria.verified)} of ${String(criteria.total)}`,
        };
      }),
    );
    // The fixture's need: 60 % of its ten derived requirements; one failed, one outdated in the accent colour.
    expect(shown.find((node) => node.key === `system:${N1}`)?.ring).toBe("60 %");
    expect(shown.filter((node) => node.accent)).toHaveLength(2);
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "sr-136-light.png") });
  } finally {
    await running.close();
  }
});
