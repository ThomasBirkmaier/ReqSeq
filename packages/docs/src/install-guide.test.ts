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
    const linux = /^- Linux: .*$/m.exec(sections(text).get("First start") ?? "")?.[0] ?? "";
    // The one place the package is named is the Linux line of the first start.
    expect(text.split("libwebkit2gtk-4.1-0").length - 1).toBe(linux.split("libwebkit2gtk-4.1-0").length - 1);
    expect(linux).toContain("Linux: nothing to do.");
    expect(linux).toContain("The desktop shell alone needs");
    expect(linux).toContain("on Ubuntu 24.04 the package `libwebkit2gtk-4.1-0`");
    expect(linux).toContain("It is no step of the installation");
    // Without it the web UI runs in the browser, and the shell ends as SR-252 AK8 says.
    expect(linux).toContain("without it, `reqseq ui` runs in your browser");
    expect(linux).toContain("`ReqSeq` ends with a message that names the package");
  });
});
