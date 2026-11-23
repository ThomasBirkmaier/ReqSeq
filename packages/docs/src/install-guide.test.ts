import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = fileURLToPath(new URL("../../../docs/guide/how-to/install-reqseq.md", import.meta.url));

/** The level-2 sections of a page by heading, each with its text. */
const sections = (text: string): Map<string, string> =>
  new Map(
    text
      .split(/^## /m)
      .slice(1)
      .map((part) => [part.slice(0, part.indexOf("\n")).trim(), part.slice(part.indexOf("\n") + 1)]),
  );

describe("the install guide", () => {
  it("[SR-249/AK-g4xk] names libwebkit2gtk-4.1-0 for Linux as a prerequisite of the desktop shell only, not as a step, and says what runs without it", async () => {
    const text = await readFile(page, "utf8");
    const parts = sections(text);
    // The one-time steps of the installation (SR-249 AK1) say nothing more for Linux.
    expect(/^- Linux: .*$/m.exec(parts.get("First start") ?? "")?.[0]).toBe("- Linux: nothing to do.");
    // The package is named once, in a paragraph of its own under Web UI, outside every list of steps.
    const named = [...parts].filter(([, body]) => body.includes("libwebkit2gtk-4.1-0"));
    expect(named.map(([heading]) => heading)).toEqual(["Web UI"]);
    const paragraph =
      (parts.get("Web UI") ?? "").split(/\n\n/).find((p) => p.includes("libwebkit2gtk-4.1-0")) ?? "";
    expect(paragraph.split("libwebkit2gtk-4.1-0")).toHaveLength(2);
    expect(paragraph).not.toMatch(/^\s*[-*\d]/m);
    expect(paragraph).toContain("On Linux the desktop shell alone needs");
    expect(paragraph).toContain("on Ubuntu 24.04 the package `libwebkit2gtk-4.1-0`");
    expect(paragraph).toContain("a prerequisite and no step of the installation");
    // Without it the web UI runs in the browser, and the shell ends as SR-252 AK8 says.
    expect(paragraph).toContain("without it, `reqseq ui` runs in your browser");
    expect(paragraph).toContain("`ReqSeq` ends with a message that names the package");
  });
});
