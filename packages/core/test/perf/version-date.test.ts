// The version date (D-013, ADR-0005 "Version date", enabler #260) in the generated workspace of
// N-036 with 50,000 elements and 200,000 relations, each repository a Git repository. After a
// commit that changes 300 targets (100 of them with an embedded image added), the stored and the
// current versions of 300 outdated relations are dated in one call, as SR-025 will ask for them,
// then again from the walks kept per workspace; and `element.get` of a changed target is opened.
// No SR threshold applies to the dates (SR-025 has the 60 s of a whole check; SR-082 AK3 opens without
// the date, which `element.get` gives only on request), so the times are recorded only (ADR-0011).
import type { GeneratedElement, LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import { generateLargeWorkspace, measure, writeLargeWorkspace } from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { parseFileBytes } from "../../src/files/index.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import { versionDates } from "../../src/model/version-date.js";
import type { VersionDateRequest } from "../../src/model/version-date.js";
import { elementVersion } from "../../src/model/view.js";
import { invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";
import { createHash } from "node:crypto";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** Outdated relations, one per changed target. */
const TARGETS = 300;
/** The first of them get an embedded image with the change. */
const WITH_IMAGE = 100;
/** The versions stored in relations do not matter here: the requests name the versions. */
const VERSION: VersionFunction = () => "n1:0000000000000000";

interface Target {
  readonly element: GeneratedElement;
  /** Folder of its repository, relative to the root of the generated tree. */
  readonly folder: string;
  readonly before: string;
  readonly after: string;
  readonly image?: { readonly link: string; readonly file: string; readonly content: string };
}

/** The version of `text` (an element file) with `images` by link path (ADR-0005). */
const versionOf = (
  metamodel: Metamodel,
  text: string,
  images: Readonly<Record<string, string>> = {},
): string => {
  const parsed = parseFileBytes("x.md", Buffer.from(text));
  if (parsed.kind !== "parsed") {
    throw new Error("generated file did not parse");
  }
  const data = parsed.content.data as Readonly<Record<string, unknown>>;
  return elementVersion(
    { type: String(data["type"]), data },
    parsed.content.body,
    metamodel,
    Object.entries(images).map(([path, content]) => ({
      path,
      sha256: createHash("sha256").update(content).digest("hex"),
    })),
  );
};

describe("version date with 50,000 elements and 200,000 relations (N-036, enabler #260)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  let targets: Target[] = [];
  /** The committer dates of the generated and the changing commit, by repository name. */
  const dates = new Map<string, { readonly generated: string; readonly changed: string }>();
  const dateOf = (target: Target | undefined, which: "generated" | "changed"): string =>
    String(dates.get(String(target?.element.repository))?.[which]);

  beforeAll(async () => {
    const tree = generateLargeWorkspace({ version: VERSION, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree, { git: true });
    const written = fixture;
    // Targets spread over the repositories: every 50th element.
    const folders = new Map(tree.repositories.map((r) => [r.name, r.folder]));
    targets = tree.elements
      .filter((_, i) => i % 50 === 0)
      .slice(0, TARGETS)
      .map((element, i): Target => {
        const folder = String(folders.get(element.repository));
        const before = String(tree.files.get(`${folder}/${element.file}`));
        const name = `image-${String(i)}.png`;
        const image =
          i < WITH_IMAGE
            ? {
                link: name,
                file: `${element.file.slice(0, element.file.lastIndexOf("/") + 1)}${name}`,
                content: `png ${String(i)}`,
              }
            : undefined;
        const after = `${before}\nChanged for the version date.${image === undefined ? "" : ` ![d](${image.link})`}\n`;
        return { element, folder, before, after, ...(image === undefined ? {} : { image }) };
      });
    // One commit per repository with its changed targets, checked out.
    for (const { folder } of tree.repositories) {
      const files = Object.fromEntries(
        targets
          .filter((t) => t.folder === folder)
          .flatMap((t) => [
            [t.element.file, t.after] as const,
            ...(t.image === undefined ? [] : [[t.image.file, t.image.content] as const]),
          ]),
      );
      const commit = await written.commitFiles(files, { repository: folder, message: "change targets" });
      await written.git(["reset", "--hard", "--quiet", commit], folder);
    }
    for (const { name, folder } of tree.repositories) {
      const [changed = "", generated = ""] = (await written.git(["log", "-2", "--format=%cI"], folder)).split(
        "\n",
      );
      // ADR-0005: in UTC with "Z", whole seconds.
      const utc = (date: string): string => new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
      dates.set(name, { generated: utc(generated), changed: utc(changed) });
    }
    workspace = new Workspace(fixture.workspaceRoot);
    await warmWorkspace(workspace);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  it("dates the stored and the current versions of 300 outdated relations in one call, cold and kept", async () => {
    const opened = workspace;
    if (opened === undefined) {
      throw new Error("the workspace was not opened");
    }
    const metamodel = await opened.get(metamodelState);
    const context = { workspace: opened, layout: await opened.get(workspaceLayoutState), metamodel };
    const requests = targets.flatMap((t): VersionDateRequest[] => {
      const where = { repository: t.element.repository, file: t.element.file, id: t.element.id };
      return [
        { ...where, version: versionOf(metamodel, t.before) },
        {
          ...where,
          version: versionOf(
            metamodel,
            t.after,
            t.image === undefined ? {} : { [t.image.link]: t.image.content },
          ),
        },
      ];
    });
    const expected = targets.flatMap((t) => [dateOf(t, "generated"), dateOf(t, "changed")]);
    const cold = await measure(
      `version dates of ${String(TARGETS)} outdated relations, stored and current (first walk)`,
      () => versionDates(context, requests),
      { basis: "N-036; ADR-0005 version date for SR-025 AK2 (no threshold)" },
    );
    expect(cold.result).toEqual(expected);
    const kept = await measure(
      `version dates of ${String(TARGETS)} outdated relations, stored and current (walks kept)`,
      () => versionDates(context, requests),
      { basis: "N-036; ADR-0005 version date for SR-025 AK2 (no threshold)" },
    );
    expect(kept.result).toEqual(expected);
  });

  it("opens a changed target with its version date, first and again", async () => {
    const fresh = new Workspace(fixture?.workspaceRoot ?? "");
    try {
      await warmWorkspace(fresh);
      const target = targets[0];
      const open = async (): Promise<CommandOutput<"element.get">["element"]> =>
        (
          (await invoke(
            "element.get",
            { ref: target?.element.id, versionDate: true },
            { workspace: fresh },
          )) as CommandOutput<"element.get">
        ).element;
      const first = await measure(
        "element.get of a changed target with its version date (first walk)",
        open,
        {
          basis: "N-036; element.get with versionDate (D-013), recorded only",
        },
      );
      expect(first.result.versionDate).toBe(dateOf(target, "changed"));
      const again = await measure("element.get of a changed target with its version date (walk kept)", open, {
        basis: "N-036; element.get with versionDate (D-013), recorded only",
      });
      expect(again.result.versionDate).toBe(dateOf(target, "changed"));
    } finally {
      await fresh.close();
    }
  });
});
