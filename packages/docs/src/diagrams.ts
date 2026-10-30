// The architecture pictures for developers in docs/architecture/ (README there), generated from the repository so
// they cannot drift: `pnpm docs:diagrams` writes them, diagrams.test.ts fails when a committed one is stale. They are
// for GitHub only, not for the user site (ADR-0017).
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ciDiagram, readWorkflows } from "./ci-diagram.js";
import { packageDiagram, readPackages } from "./package-diagram.js";

/** The command that writes the pictures, named by the drift test. */
export const DIAGRAMS_COMMAND = "pnpm docs:diagrams";

/** Each picture's path relative to the repository root and its SVG text. */
export async function architectureDiagrams(repoRoot: string): Promise<{ path: string; text: string }[]> {
  return [
    { path: "docs/architecture/ci.svg", text: ciDiagram(await readWorkflows(repoRoot)) },
    { path: "docs/architecture/packages.svg", text: packageDiagram(await readPackages(repoRoot)) },
  ];
}

/** Writes the pictures into the repository at `repoRoot` and returns their paths. */
export async function writeDiagrams(repoRoot: string): Promise<string[]> {
  const diagrams = await architectureDiagrams(repoRoot);
  await Promise.all(diagrams.map(({ path, text }) => writeFile(join(repoRoot, path), text)));
  return diagrams.map(({ path }) => path);
}
