// The CI picture of docs/architecture/ci.svg, from .github/workflows/*.yml: per workflow its triggers, its jobs (one
// box per matrix combination, named as GitHub names the check), their `needs`, and the required checks.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  arrow,
  box,
  compareCodeUnits,
  num,
  boxHeight,
  family,
  rect,
  requiredBadge,
  svgDocument,
  text,
  textWidth,
  wrap,
} from "./svg.js";

/**
 * The checks the ruleset of `main` requires, as .claude/skills/lead-run/merge.md and CLAUDE.md list them. GitHub
 * keeps the ruleset outside the repository, so this is its one copy here; diagrams.test.ts fails when a name is no
 * longer the name of a job of ci.yml.
 */
export const REQUIRED_CHECKS: readonly string[] = [
  "static",
  ...["ubuntu-24.04", "macos-14", "windows-2025"].flatMap((os) => [`checks (${os})`, `electron (${os})`]),
];

type Combination = Readonly<Record<string, unknown>>;

export interface Trigger {
  readonly event: string;
  readonly details: readonly string[];
}

export interface JobRun {
  readonly id: string;
  readonly name: string;
  /** The runner label, or the called workflow of a reusable job. */
  readonly runsOn: string;
  /** The lane: `matrix.os` where the matrix has it, else the runner. */
  readonly lane: string;
  readonly needs: readonly string[];
  readonly depth: number;
}

export interface Workflow {
  readonly file: string;
  readonly name: string;
  readonly triggers: readonly Trigger[];
  readonly runs: readonly JobRun[];
}

interface Job {
  readonly name?: string;
  readonly "runs-on"?: unknown;
  readonly uses?: string;
  readonly needs?: string | string[];
  readonly strategy?: { readonly matrix?: Readonly<Record<string, unknown>> };
}

const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];
const matches = (combo: Combination, pattern: Combination, keys: readonly string[]): boolean =>
  keys.every((key) => !(key in pattern) || combo[key] === pattern[key]);

/** The combinations of a matrix as GitHub expands them: the product of its keys, then `exclude`, then `include`. */
export function expandMatrix(matrix: Readonly<Record<string, unknown>> | undefined): Combination[] {
  const { include, exclude, ...axes } = matrix ?? {};
  const keys = Object.keys(axes);
  let combos: Combination[] = keys.length === 0 ? [] : [{}];
  for (const key of keys) {
    combos = combos.flatMap((combo) => list(axes[key]).map((value) => ({ ...combo, [key]: value })));
  }
  combos = combos.filter(
    (combo) => !list(exclude).some((pattern) => matches(combo, pattern as Combination, keys)),
  );
  for (const extra of list(include) as Combination[]) {
    const targets = combos.filter((combo) => keys.length > 0 && matches(combo, extra, keys));
    if (targets.length === 0) {
      combos.push(extra);
    } else {
      combos = combos.map((combo) => (targets.includes(combo) ? { ...combo, ...extra } : combo));
    }
  }
  return combos.length === 0 ? [{}] : combos;
}

const expand = (value: string, combo: Combination): string =>
  value.replaceAll(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_, key: string) => String(combo[key]));

/** The name GitHub gives a job's check run: its `name` with the matrix values put in, else its ID with them. */
function runName(id: string, job: Job, combo: Combination): string {
  const values = Object.values(combo).map(String);
  if (job.name?.includes("matrix.") === true) {
    return expand(job.name, combo);
  }
  return values.length === 0 ? (job.name ?? id) : `${job.name ?? id} (${values.join(", ")})`;
}

function triggerDetails(event: string, value: unknown): string[] {
  if (event === "schedule") {
    return list(value).map((entry) => `cron ${(entry as { cron: string }).cron} (UTC)`);
  }
  const config = (value ?? {}) as Readonly<Record<string, unknown>>;
  return Object.entries(config).map(([key, entry]) => {
    const items = key === "inputs" ? Object.keys(entry as object) : list(entry).map(String);
    return key === "types" ? items.join(", ") : `${key}: ${items.join(", ")}`;
  });
}

/** One workflow file's triggers and job runs. */
export function parseWorkflow(file: string, source: string): Workflow {
  const doc = YAML.parse(source, { version: "1.2", schema: "core" }) as {
    name?: string;
    on: unknown;
    jobs: Readonly<Record<string, Job>>;
  };
  const on: Readonly<Record<string, unknown>> =
    typeof doc.on === "object" && doc.on !== null && !Array.isArray(doc.on)
      ? (doc.on as Record<string, unknown>)
      : Object.fromEntries(list(doc.on).map((event) => [String(event), null]));
  const depths = new Map<string, number>();
  const depth = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) {
      return known;
    }
    const needs = list(doc.jobs[id]?.needs).map(String);
    const value = needs.length === 0 ? 0 : 1 + Math.max(...needs.map(depth));
    depths.set(id, value);
    return value;
  };
  const runs = Object.entries(doc.jobs).flatMap(([id, job]) =>
    expandMatrix(job.strategy?.matrix).map((combo): JobRun => {
      const runsOn =
        job.uses === undefined
          ? expand(list(job["runs-on"]).map(String).join(", "), combo)
          : `calls ${job.uses}`;
      const os = combo["os"];
      return {
        id,
        name: runName(id, job, combo),
        runsOn,
        lane: typeof os === "string" ? os : job.uses === undefined ? runsOn : "reusable workflow",
        needs: list(job.needs).map(String),
        depth: depth(id),
      };
    }),
  );
  const triggers = Object.entries(on).map(([event, value]) => ({
    event,
    details: triggerDetails(event, value),
  }));
  return { file, name: doc.name ?? file, triggers, runs };
}

/** Every workflow of `.github/workflows/` of the repository at `repoRoot`, in file name order. */
export async function readWorkflows(repoRoot: string): Promise<Workflow[]> {
  const dir = join(repoRoot, ".github", "workflows");
  const files = (await readdir(dir)).filter((file) => /\.ya?ml$/.test(file)).sort();
  return Promise.all(files.map(async (file) => parseWorkflow(file, await readFile(join(dir, file), "utf8"))));
}

const ORDER = { u: 0, m: 1, w: 2, o: 3 } as const;
const laneOrder = (a: string, b: string): number =>
  ORDER[family(a)] - ORDER[family(b)] || compareCodeUnits(a, b);
const subLine = (run: JobRun): string =>
  run.runsOn.startsWith("calls ")
    ? run.runsOn
    : `job ${run.id}${run.runsOn === run.lane ? "" : ` · runs on ${run.runsOn}`}`;

const PAD = 20;
const JOB_H = boxHeight(2);
const GAP = 10;
const COL_GAP = 56;
const LANE_HEAD = 26;
const WRAP = 34;

/** The SVG of all workflows, one band each, with the required checks marked. */
export function ciDiagram(
  workflows: readonly Workflow[],
  required: readonly string[] = REQUIRED_CHECKS,
): string {
  const all = workflows.flatMap((workflow) => workflow.runs);
  const jobW =
    Math.max(...all.flatMap((run) => [textWidth(run.name, "name") + 70, textWidth(subLine(run), "sub")])) +
    20;
  const trigLines = workflows.flatMap((workflow) =>
    workflow.triggers.flatMap((t) => t.details.flatMap((d) => wrap(d, WRAP))),
  );
  const trigW = Math.max(150, ...trigLines.map((line) => textWidth(line, "sub") + 20));
  const bus = PAD + trigW + 24;
  const x0 = bus + 30;
  const columnX = (depth: number): number => x0 + 12 + depth * (jobW + COL_GAP);
  const width = Math.max(...all.map((run) => columnX(run.depth) + jobW + 12 + PAD), 640);
  const parts: string[] = [
    text(PAD, PAD + 14, "ReqSeq CI: workflows, triggers, jobs and required checks", "h"),
    text(
      PAD,
      PAD + 32,
      "Generated from .github/workflows/*.yml by pnpm docs:diagrams. Lanes are the runner systems.",
      "s",
    ),
  ];
  let y = PAD + 52;
  for (const workflow of workflows) {
    parts.push(`<line class="sep" x1="${num(PAD)}" y1="${num(y)}" x2="${num(width - PAD)}" y2="${num(y)}"/>`);
    parts.push(text(PAD, y + 22, `${workflow.name} · ${workflow.file}`, "h"));
    const top = y + 36;
    const centers: number[] = [];
    let ty = top;
    for (const trigger of workflow.triggers) {
      const lines = [trigger.event, ...trigger.details.flatMap((d) => wrap(d, WRAP))];
      const h = boxHeight(lines.length);
      parts.push(box(PAD, ty, trigW, h, "trig", lines));
      parts.push(
        arrow(
          [
            [PAD + trigW, ty + h / 2],
            [bus, ty + h / 2],
          ],
          "arr",
          false,
        ),
      );
      centers.push(ty + h / 2);
      ty += h + GAP;
    }
    const at = new Map<JobRun, { x: number; y: number }>();
    let ly = top;
    for (const lane of [...new Set(workflow.runs.map((run) => run.lane))].sort(laneOrder)) {
      const rows = new Map<number, number>();
      const laneParts: string[] = [];
      for (const run of workflow.runs.filter((r) => r.lane === lane)) {
        const row = rows.get(run.depth) ?? 0;
        rows.set(run.depth, row + 1);
        const position = { x: columnX(run.depth), y: ly + LANE_HEAD + row * (JOB_H + GAP) };
        at.set(run, position);
        laneParts.push(
          box(position.x, position.y, jobW, JOB_H, `box ${family(run.runsOn)}`, [run.name, subLine(run)]),
        );
        if (required.includes(run.name)) {
          laneParts.push(requiredBadge(position.x + jobW, position.y));
        }
        if (run.depth === 0) {
          centers.push(position.y + JOB_H / 2);
          laneParts.push(
            arrow([
              [bus, position.y + JOB_H / 2],
              [position.x, position.y + JOB_H / 2],
            ]),
          );
        }
      }
      const laneH = LANE_HEAD + Math.max(...rows.values()) * (JOB_H + GAP) + 2;
      parts.push(rect(x0, ly, width - PAD - x0, laneH, `lane ${family(lane)}`, 8));
      parts.push(text(x0 + 12, ly + 17, lane.toUpperCase(), `lh ${family(lane)}`), ...laneParts);
      ly += laneH + GAP;
    }
    parts.push(
      arrow(
        [
          [bus, Math.min(...centers)],
          [bus, Math.max(...centers)],
        ],
        "arr",
        false,
      ),
    );
    for (const [run, to] of at) {
      for (const [source, from] of at) {
        if (!run.needs.includes(source.id)) {
          continue;
        }
        const mid = to.x - COL_GAP / 2;
        const [fy, toY] = [from.y + JOB_H / 2, to.y + JOB_H / 2];
        parts.push(
          arrow([
            [from.x + jobW, fy],
            [mid, fy],
            [mid, toY],
            [to.x, toY],
          ]),
        );
      }
    }
    y = Math.max(ty, ly) + 14;
  }
  return svgDocument(width, y + PAD, "ReqSeq CI workflows", parts);
}
