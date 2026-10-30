import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { checkExamples, pageSteps, readGuidePages, runReqseq, runSteps } from "./examples.js";
import { ACCESSES, accessNames, checkHowTos, howToProblems } from "./how-to.js";
import { readGeneratedContracts } from "./reference.js";

const guideDir = fileURLToPath(new URL("../../../docs/guide/", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("guide", () => {
  it("[SR-140/AK1] the steps of Get started, run in order, create a workspace, a first element and a first chain", async () => {
    const path = "start/get-started.md";
    const steps = pageSteps({ path, text: await readFile(join(guideDir, path), "utf8") });
    const cwd = await mkdtemp(join(tmpdir(), "reqseq-get-started-"));
    try {
      expect(await runSteps(path, steps, cwd, runReqseq)).toEqual([]);
      await access(join(cwd, "reqseq-workspace.yaml"));
      const [need] = await readdir(join(cwd, "need"));
      expect(need).toMatch(/^N-[0-9a-f]{12}\.md$/);
      const chain = await runReqseq(
        ["trace", "chain", `N-${need?.slice(-9, -3) ?? ""}`, "--json"],
        cwd,
        new AbortController().signal,
      );
      expect(chain.exitCode).toBe(0);
      const { nodes } = JSON.parse(chain.stdout) as { nodes: { depth: number }[] };
      expect(nodes.length).toBe(2);
      expect(nodes.some((node) => node.depth !== 0)).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("[SR-140/AK2] every example of the guide runs with this version, and a failing one stops the build", async () => {
    const pages = await readGuidePages(guideDir);
    expect(await checkExamples(pages, runReqseq)).toBeGreaterThanOrEqual(6);
    const broken = {
      path: "start/broken.md",
      text: "```sh\nreqseq workspace init . W\nreqseq element get N-000000\n```",
    };
    await expect(checkExamples([...pages, broken], runReqseq)).rejects.toThrow(
      "start/broken.md:3: reqseq element get N-000000: exit code",
    );
    const changed = {
      path: "start/changed.md",
      text: '```sh\nreqseq workspace init . W\n```\n\n```text title="Output"\nNo files.\n```',
    };
    await expect(checkExamples([changed], runReqseq)).rejects.toThrow("the output differs from the page");
  });

  it("[SR-140/AK3] every how-to shows its task in the app, the CLI, the API and MCP, with names that exist", async () => {
    const pages = await readGuidePages(guideDir);
    const names = accessNames(getCommandRuntime().contracts.commands, await readGeneratedContracts(repoRoot));
    expect(checkHowTos(pages, names)).toBeGreaterThanOrEqual(4);
    const howTo = pages.find((page) => page.path === "how-to/trace-a-requirement.md");
    expect(howTo).toBeDefined();
    const text = howTo?.text ?? "";
    for (const access of ACCESSES) {
      const without = { path: howTo?.path ?? "", text: text.replace(`\n## ${access}\n`, "\n## Other\n") };
      expect(howToProblems(without, names)).toEqual([
        `how-to/trace-a-requirement.md: no section "## ${access}" with its steps, or why it is not possible there`,
      ]);
    }
  });
});
