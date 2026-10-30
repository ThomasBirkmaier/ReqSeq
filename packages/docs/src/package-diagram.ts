// The package picture of docs/architecture/packages.svg, from packages/*/package.json: the workspace packages in
// layers (a package stands above every package it depends on) and their dependencies on each other.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { arrow, compareCodeUnits, box, boxHeight, svgDocument, text, textWidth, wrap } from "./svg.js";

export interface WorkspacePackage {
  readonly dir: string;
  readonly name: string;
  /** Workspace packages it depends on, by name, with `dev` for a devDependency only. */
  readonly uses: readonly { readonly name: string; readonly dev: boolean }[];
  /** Its runtime dependencies outside the workspace. */
  readonly external: readonly string[];
}

interface Manifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/** The workspace packages from their manifests (`dir` is the folder under packages/). */
export function workspacePackages(
  manifests: readonly { dir: string; manifest: Manifest }[],
): WorkspacePackage[] {
  const names = new Set(manifests.map(({ manifest }) => manifest.name));
  return manifests.map(({ dir, manifest }) => {
    const runtime = Object.keys(manifest.dependencies ?? {});
    const dev = Object.keys(manifest.devDependencies ?? {}).filter((name) => !runtime.includes(name));
    return {
      dir,
      name: manifest.name,
      uses: [
        ...runtime.filter((name) => names.has(name)).map((name) => ({ name, dev: false })),
        ...dev.filter((name) => names.has(name)).map((name) => ({ name, dev: true })),
      ].sort((a, b) => compareCodeUnits(a.name, b.name)),
      external: runtime.filter((name) => !names.has(name)).sort(),
    };
  });
}

/** The packages of `packages/*` of the repository at `repoRoot` that have a package.json, in folder order. */
export async function readPackages(repoRoot: string): Promise<WorkspacePackage[]> {
  const root = join(repoRoot, "packages");
  const dirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const manifests = await Promise.all(
    dirs.map(async ({ name: dir }) => {
      const text = await readFile(join(root, dir, "package.json"), "utf8").catch(() => undefined);
      return text === undefined ? [] : [{ dir, manifest: JSON.parse(text) as Manifest }];
    }),
  );
  return workspacePackages(manifests.flat().sort((a, b) => compareCodeUnits(a.dir, b.dir)));
}

const PAD = 20;
const ROW_GAP = 56;
const COL_GAP = 28;
const WRAP = 40;

/** The SVG: one row per layer, the arrows of the dependencies that no path through another package implies. */
export function packageDiagram(packages: readonly WorkspacePackage[]): string {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const pkg = (name: string): WorkspacePackage => {
    const found = byName.get(name);
    if (found === undefined) {
      throw new Error(`${name} is not a workspace package`);
    }
    return found;
  };
  const reach = (from: string, seen = new Set<string>()): Set<string> => {
    for (const { name } of pkg(from).uses) {
      if (!seen.has(name)) {
        reach(name, seen.add(name));
      }
    }
    return seen;
  };
  const layer = (name: string): number => Math.max(-1, ...pkg(name).uses.map((use) => layer(use.name))) + 1;
  const lines = (p: WorkspacePackage): string[] => [
    p.name,
    p.uses.length === 0
      ? "uses no workspace package"
      : `uses ${p.uses.map((use) => `${pkg(use.name).dir}${use.dev ? " (dev)" : ""}`).join(", ")}`,
    ...wrap(p.external.length === 0 ? "external: none" : `external: ${p.external.join(", ")}`, WRAP),
  ];
  const w =
    Math.max(
      ...packages.flatMap((p) => [
        textWidth(p.name, "name"),
        ...lines(p)
          .slice(1)
          .map((l) => textWidth(l, "sub")),
      ]),
    ) + 20;
  const top = Math.max(...packages.map((p) => layer(p.name)));
  const rows = Array.from({ length: top + 1 }, (_, i) => packages.filter((p) => layer(p.name) === top - i));
  const width = PAD * 2 + Math.max(...rows.map((row) => row.length * w + (row.length - 1) * COL_GAP), 560);
  const at = new Map<string, { x: number; y: number; h: number }>();
  const place = (name: string): { x: number; y: number; h: number } =>
    at.get(name) as { x: number; y: number; h: number };
  let y = PAD + 64;
  for (const row of rows) {
    const h = Math.max(...row.map((p) => boxHeight(lines(p).length)));
    const left = (width - (row.length * w + (row.length - 1) * COL_GAP)) / 2;
    row.forEach((p, i) => at.set(p.name, { x: left + i * (w + COL_GAP), y, h: boxHeight(lines(p).length) }));
    y += h + ROW_GAP;
  }
  const parts = [
    text(PAD, PAD + 14, "ReqSeq workspace packages and their dependencies", "h"),
    text(
      PAD,
      PAD + 32,
      "Generated from packages/*/package.json by pnpm docs:diagrams. An arrow points to a dependency;",
      "s",
    ),
    text(
      PAD,
      PAD + 46,
      "dashed: devDependency only. Dependencies implied through another package have no arrow.",
      "s",
    ),
  ];
  for (const p of packages) {
    const from = place(p.name);
    const direct = p.uses.filter(
      (use) => !p.uses.some((other) => other !== use && reach(other.name).has(use.name)),
    );
    direct.forEach((use, i) => {
      const to = place(use.name);
      const fx = from.x + w / 2 + (i - (direct.length - 1) / 2) * 18;
      parts.push(
        arrow(
          [
            [fx, from.y + from.h],
            [to.x + w / 2, to.y],
          ],
          use.dev ? "arr dev" : "arr",
        ),
      );
    });
  }
  for (const p of packages) {
    const { x, y: by, h } = place(p.name);
    parts.push(box(x, by, w, h, "box w", lines(p)));
  }
  return svgDocument(width, y - ROW_GAP + PAD, "ReqSeq workspace packages", parts);
}
