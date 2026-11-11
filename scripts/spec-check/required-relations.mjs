// CI fails when an element of the spec that is not a draft lacks a relation the metamodel requires (#1306):
// `workspace check` reports it as the warning `relation.too-few` (SR-152 AK2), and CI stays green on warnings.
// A draft is an idea, so its finding stays a warning; an element with an invalid status gets no such finding
// (SR-152 AK5), so a superseded source stays open as the product owner decided on 2026-11-09 (`spec-change`).
// Every other source fails, with no allow-list of single elements (ADR-0016).
//
// `pnpm spec:check` runs it after `workspace check`, through the built command line, as CI does.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The finding this check makes an error. */
export const CODE = "relation.too-few";

/**
 * The `relation.too-few` findings of `problems` whose element has a status other than the initial one of
 * `statuses`, one line each. `elements` are those of `element.list`; an element without a status counts as not
 * a draft, as a current glossary term has none.
 */
export function blockingFindings(problems, elements, statuses) {
  const initial = new Set(statuses.filter((s) => s.initial === true).map((s) => s.key));
  const status = new Map(elements.map((e) => [e.id, e.status]));
  return problems
    .filter((p) => p.code === CODE && !initial.has(status.get(p.elementId)))
    .map((p) => {
      const name = p.elementIdentifier ?? p.elementShortId ?? p.elementId;
      return `${p.file}: ${name} (${status.get(p.elementId) ?? "no status"}): ${p.message}`;
    });
}

/** The output of a `reqseq` command with `--json` on the workspace `spec`; the exit code does not count. */
function reqseqJson(cli, root, args) {
  try {
    return JSON.parse(
      execFileSync(process.execPath, [cli, ...args, "--workspace", "spec", "--json"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }),
    );
  } catch (error) {
    // `workspace check` exits with 1 when it found errors, with its JSON on stdout all the same.
    if (typeof error?.stdout === "string" && error.stdout.trim() !== "") {
      return JSON.parse(error.stdout);
    }
    throw error;
  }
}

/** Runs the check in the repository at `root` with the built command line; returns the lines of the findings. */
export function requiredRelations(root, run = reqseqJson) {
  const cli = path.join(root, "packages", "cli", "dist", "bin.js");
  const { problems } = run(cli, root, ["workspace", "check"]);
  const { statuses } = run(cli, root, ["metamodel", "get"]);
  const elements = [];
  for (let offset = 0; ; offset += 5000) {
    const page = run(cli, root, ["element", "list", "--limit", "5000", "--offset", String(offset)]);
    elements.push(...page.elements);
    if (offset + 5000 >= page.total) {
      break;
    }
  }
  return blockingFindings(problems, elements, statuses);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const lines = requiredRelations(process.cwd());
  if (lines.length > 0) {
    console.error(
      `spec: ${String(lines.length)} element(s) that are not drafts lack a relation the metamodel requires:\n${lines.join("\n")}`,
    );
    process.exit(1);
  }
  console.log("spec: every element that is not a draft has the relations the metamodel requires");
}
