// Delivery test of the desktop shell without its web engine (SR-252 AK8, ADR-0021, #2379). It runs last on Linux,
// after scripts/package/delivery-tests.sh has removed the package `libwebkit2gtk-4.1-0`, which it marks with
// REQSEQ_DELIVERY_NO_ENGINE=1; anywhere else it is skipped with its reason.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliveryNames } from "@reqseq/testkit";
import { deliveryArtifactName, deliveryLayout, installDelivery } from "@reqseq/testkit";
import { afterAll, describe, expect, it } from "vitest";
import { processes } from "./processes.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const names = JSON.parse(
  readFileSync(path.join(repo, "toolchain", "packaging", "names.json"), "utf8"),
) as DeliveryNames;
const { version } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string };
const deliveryDir = process.env["REQSEQ_DELIVERY_DIR"] ?? path.join(repo, "delivery");
const artifact = path.join(deliveryDir, deliveryArtifactName(names, "linux", version));

const temps: string[] = [];
afterAll(async () => {
  await Promise.all(temps.splice(0).map((f) => fs.rm(f, { recursive: true, force: true, maxRetries: 3 })));
});

describe("SR-252: the desktop shell without its web engine", () => {
  it("[SR-252/AK-ts68] on Ubuntu 24.04 without libwebkit2gtk-4.1-0 the shell ends with 1, names the package and the reason, and starts no server", async (ctx) => {
    if (process.platform !== "linux" || process.env["REQSEQ_DELIVERY_NO_ENGINE"] !== "1") {
      ctx.skip("runs on Linux after the engine is removed (scripts/package/delivery-tests.sh)");
      return;
    }
    expect(existsSync(artifact), `not built: ${artifact}`).toBe(true);
    // The package is gone, so the library the shell links cannot be found.
    expect(existsSync("/usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0")).toBe(false);
    const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "shell-no-engine-")));
    temps.push(folder);
    const installed = await installDelivery(artifact, folder);
    const layout = deliveryLayout(names, "linux");
    const shell = spawn(path.join(installed, layout.shellStart), [], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    shell.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const code = await new Promise<number | null>((resolve) => shell.on("exit", resolve));
    expect(code).toBe(1);
    expect(stderr).toContain("the web engine is missing");
    expect(stderr).toContain("libwebkit2gtk-4.1-0");
    expect(stderr).toMatch(/^Reason: .*libwebkit2gtk-4\.1\.so\.0/m);
    expect(stderr).toMatch(/^[\x20-\x7e\n]*$/);
    const cli = path.join(installed, layout.lib, "dist", "bin.js");
    expect(processes().filter((p) => p.args.includes(cli))).toEqual([]);
  });
});
