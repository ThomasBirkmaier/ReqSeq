// Delivery tests of the desktop shell without its web engine (SR-252 AK8, ADR-0021, #2379). The Linux test runs last,
// after scripts/package/delivery-tests.sh has removed the package `libwebkit2gtk-4.1-0`, which it marks with
// REQSEQ_DELIVERY_NO_ENGINE=1. The Windows test makes the WebView2 runtime unusable for the started program only, with
// WEBVIEW2_BROWSER_EXECUTABLE_FOLDER set to an empty folder (A3). Anywhere else they are skipped with their reason.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliveryNames } from "@reqseq/testkit";
import { deliveryArtifactName, deliveryLayout, installDelivery } from "@reqseq/testkit";
import { afterAll, describe, expect, it } from "vitest";
import { ended, processes, serverOf } from "./processes.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const names = JSON.parse(
  readFileSync(path.join(repo, "toolchain", "packaging", "names.json"), "utf8"),
) as DeliveryNames;
const { version } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string };
const deliveryDir = process.env["REQSEQ_DELIVERY_DIR"] ?? path.join(repo, "delivery");
const artifact = path.join(deliveryDir, deliveryArtifactName(names, "linux", version));
const windowsArtifact = path.join(deliveryDir, deliveryArtifactName(names, "win", version));

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
    const { code, stderr } = await ended(shell);
    expect(code).toBe(1);
    expect(stderr).toContain("the web engine is missing");
    expect(stderr).toContain("libwebkit2gtk-4.1-0");
    expect(stderr).toMatch(/^Reason: .*libwebkit2gtk-4\.1\.so\.0/m);
    expect(stderr).toMatch(/^[\x20-\x7e\n]*$/);
    expect(serverOf(processes(), path.join(installed, layout.lib, "dist", "bin.js"))).toBeUndefined();
  });

  it("[SR-252/AK-ts68] on Windows without a usable WebView2 runtime the shell ends with an exit code other than 0, gives the reason, and starts no server", async (ctx) => {
    if (process.platform !== "win32") {
      ctx.skip("runs on Windows");
      return;
    }
    expect(existsSync(windowsArtifact), `not built: ${windowsArtifact}`).toBe(true);
    const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "shell-no-webview2-")));
    temps.push(folder);
    const installed = await installDelivery(windowsArtifact, folder);
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "no-webview2-runtime-"));
    temps.push(empty);
    const layout = deliveryLayout(names, "win");
    const shell = spawn(path.join(installed, layout.shellStart), [], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: empty },
    });
    // A window that opens after all must not leave the shell behind: it ends with its server (Job Object).
    const timer = setTimeout(() => {
      shell.kill();
    }, 60_000);
    const { code, stderr } = await ended(shell).finally(() => {
      clearTimeout(timer);
    });
    // AK8: an exit code other than 0 and an English reason; a panic before the server gives the fixed line.
    expect(code, stderr).not.toBe(0);
    expect(code, stderr).not.toBeNull();
    expect(stderr).toMatch(/^ReqSeq: the window could not open/m);
    expect(stderr).toMatch(/^[\x20-\x7e\r\n]*$/);
    expect(serverOf(processes(), path.join(installed, layout.lib, "dist", "bin.js"))).toBeUndefined();
  });
});
