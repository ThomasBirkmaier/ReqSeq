import fs from "node:fs/promises";
import { createFixtureWorkspace, untilWatching } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandName, CommandOutput } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { computeVersion } from "../version/version.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { elementStoreState } from "./store.js";
import { watchWorkspace } from "./watch.js";
import type { TargetContext } from "./targets.js";
import { currentTarget, inlineReferences, setInlineReferences, setRelationTargets } from "./targets.js";

/** The elements of fixtures/SR-021/targets; `text` is the text of the file. */
const PKG = {
  id: "5b0c2f9e-7a41-4c3d-9e2b-1f6a8d3c7e10",
  file: "packages/PKG-1f6a8d3c7e10.md",
  title: "Release 1.0",
  text: "The first release.",
};
const VAR = {
  id: "9d4e6a1b-3c2f-4b8a-a1d7-52e8c0f4b9a3",
  file: "variants/VAR-52e8c0f4b9a3.md",
  title: "Pro",
  text: "The variant with every sensor.",
};
const NEED = {
  id: "0c8a3e5f-2d1b-4f6e-8a9c-7b3d5e1f2a4c",
  file: "needs/N-7b3d5e1f2a4c.md",
  title: "Wind speed visible at a glance",
  text: "The wind speed can be read from three metres.",
};
const SOURCE = { id: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05", file: "requirements/SR-3d8b2c6e1f05.md" };
const SENSOR_NEED = {
  id: "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21",
  file: "needs/N-0e9d7c5b3a21.md",
  text: "The sensor measures gusts.",
};
/** Versions stored in the source file of the fixture; neither is the current one. */
const STORED_VAR = "n1:0000000000000000";
const STORED_NEED = "n1:1111111111111111";
const OTHER = "n1:2222222222222222";

/**
 * The current version of a fixture element, computed from its text alone: none of the fixture's
 * targets has a property that counts to the version (ADR-0005), and the title does not count.
 */
const versionOf = (element: { readonly text: string }): string =>
  computeVersion({ text: element.text, properties: {}, definitions: [], files: [] });

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: FixtureOptions["files"] = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-021/targets", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const run = async <N extends CommandName>(
  opened: Opened,
  name: N,
  input: Record<string, unknown>,
): Promise<CommandOutput<N>> =>
  (await invoke(name, input, { workspace: opened.workspace })) as CommandOutput<N>;

const runError = async (
  opened: Opened,
  name: CommandName,
  input: Record<string, unknown>,
): Promise<CommandError> => {
  try {
    await run(opened, name, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected ${name} to fail`);
};

/** A file of the system repository, or of `repository`. */
const read = (opened: Opened, file: string, repository = "system"): Promise<string> =>
  fs.readFile(opened.fixture.path(`${repository}/${file}`), "utf8");

const context = async (opened: Opened): Promise<TargetContext> => ({
  layout: await opened.workspace.get(workspaceLayoutState),
  metamodel: await opened.workspace.get(metamodelState),
  store: await opened.workspace.get(elementStoreState),
});

const ref = (id: string, version?: string): string =>
  `logreq:${id}${version === undefined ? "" : `?version=${version}`}`;

const UNKNOWN = "11111111-2222-4333-8444-555555555555";

/** The source file of the fixture with another text below the frontmatter. */
const sourceWithText = async (text: string): Promise<string> => {
  const original = await fs.readFile(
    new URL("../../../../fixtures/SR-021/targets/system/requirements/SR-3d8b2c6e1f05.md", import.meta.url),
    "utf8",
  );
  return `${original.slice(0, original.lastIndexOf("---\n") + 4)}\n${text}`;
};

/** Starts the watcher and waits until it reports changes (see model/watch.test.ts). */
const watching = async (opened: Opened): Promise<void> => {
  await opened.workspace.get(elementStoreState);
  await watchWorkspace(opened.workspace).ready;
  await untilWatching({
    probe: (attempt) => opened.fixture.write("system/probe.md", `# Probe ${String(attempt)}\n`),
    seen: async () =>
      (await opened.workspace.get(elementStoreState)).nonElements.some((f) => f.file === "probe.md"),
  });
};

describe("relation targets with ID and version (SR-021)", () => {
  it("[SR-021/AK1] element.create stores UUID and current version of a new target in the source file", async () => {
    const opened = await open();
    const out = await run(opened, "element.create", {
      type: "system-requirement",
      title: "Show gusts",
      // The caller gives only the UUID, or a version and title that are not stored: the tool sets them.
      properties: {
        packages: [{ id: PKG.id }],
        validity: [{ id: VAR.id, version: OTHER, title: "Old name" }],
      },
    });
    const file = await read(opened, out.element.file);
    expect(file).toContain(
      `validity:\n  - { id: ${VAR.id}, version: ${versionOf(VAR)}, title: ${VAR.title} }\n`,
    );
    expect(file).toContain(
      `packages:\n  - { id: ${PKG.id}, version: ${versionOf(PKG)}, title: ${PKG.title} }\n`,
    );
    expect(out.element.properties["packages"]).toEqual([
      { id: PKG.id, version: versionOf(PKG), title: PKG.title },
    ]);
  });

  it("[SR-021/AK1] element.update stores the current version of new targets and keeps stored ones, whatever version is sent", async () => {
    const opened = await open();
    const before = await read(opened, SOURCE.file);
    await run(opened, "element.update", {
      ref: SOURCE.id,
      set: {
        // Already stored: set earlier, so its outdated version stays; only confirming changes it (D-042).
        validity: [{ id: VAR.id, version: "n1:0000000000000001" }],
        packages: [{ id: PKG.id }],
      },
    });
    const after = await read(opened, SOURCE.file);
    expect(after).toContain(
      `validity:\n  - { id: ${VAR.id}, version: ${STORED_VAR}, title: ${VAR.title} }\n`,
    );
    expect(after.split("\n").filter((l) => !before.split("\n").includes(l))).toEqual([
      "packages:",
      `  - { id: ${PKG.id}, version: ${versionOf(PKG)}, title: ${PKG.title} }`,
    ]);
  });

  it("[SR-021/AK1] gives a relation target in another repository UUID, version and repository, no title (D-058)", async () => {
    const opened = await open();
    const ctx = await context(opened);
    expect(await currentTarget(ctx, "system", { id: SENSOR_NEED.id, repository: "sensor" })).toEqual({
      id: SENSOR_NEED.id,
      version: versionOf(SENSOR_NEED),
      repository: "sensor",
    });
    // Naming the source's own repository is the same as naming none.
    expect(await currentTarget(ctx, "system", { id: NEED.id, repository: "system" })).toEqual({
      id: NEED.id,
      version: versionOf(NEED),
      title: NEED.title,
    });
    expect(await currentTarget(ctx, "sensor", { id: NEED.id, repository: "system" })).toEqual({
      id: NEED.id,
      version: versionOf(NEED),
      repository: "system",
    });
  });

  it("[SR-021/AK1] stores the version the element view shows for a target with properties that count", async () => {
    const opened = await open();
    const ctx = await context(opened);
    // The source of the fixture has requirement type, acceptance criteria and validity, which count.
    const shown = (await run(opened, "element.update", { ref: SOURCE.id })).element.version;
    expect(shown).not.toBe(versionOf({ text: "x" }));
    expect((await currentTarget(ctx, "system", { id: SOURCE.id })).version).toBe(shown);
    const text = (await read(opened, SOURCE.file)).split("---\n")[2] ?? "";
    expect(shown).not.toBe(versionOf({ text }));
  });

  it("[SR-021/AK1] keys stored targets by UUID and repository, keeps single values and items that are no targets", async () => {
    const opened = await open();
    const ctx = await context(opened);
    const stored = { id: NEED.id, version: STORED_NEED, title: NEED.title };
    expect(await setRelationTargets(ctx, "system", { id: NEED.id }, stored)).toBe(stored);
    expect(await setRelationTargets(ctx, "system", { id: NEED.id, version: OTHER }, [stored])).toBe(stored);
    expect(await setRelationTargets(ctx, "system", ["text"], [stored, "x"])).toEqual(["text"]);
    // A malformed stored entry with the UUID is kept as it is; the value-kind check reports it.
    const malformed = { id: NEED.id, version: "old" };
    expect(await setRelationTargets(ctx, "system", { id: NEED.id }, malformed)).toBe(malformed);
    // The same UUID, but stored for another repository: a new target.
    expect(
      await setRelationTargets(
        ctx,
        "sensor",
        { id: NEED.id, repository: "system" },
        { id: NEED.id, version: STORED_NEED },
      ),
    ).toEqual({ id: NEED.id, version: versionOf(NEED), repository: "system" });
  });

  it("[SR-021/AK1] stores the version of a target changed by another editor, as the watcher reports it", async () => {
    const opened = await open();
    await watching(opened);
    const sha = async (): Promise<string | undefined> =>
      (await opened.workspace.get(elementStoreState)).byId.get(PKG.id)?.[0]?.snapshot.sha256;
    const before = await sha();
    await opened.fixture.write(
      `system/${PKG.file}`,
      (await read(opened, PKG.file)).replace(PKG.text, "Changed."),
    );
    await vi.waitFor(
      async () => {
        expect(await sha()).not.toBe(before);
      },
      { timeout: 5000, interval: 10 },
    );
    await run(opened, "element.update", { ref: SOURCE.id, set: { packages: [{ id: PKG.id }] } });
    expect(await read(opened, SOURCE.file)).toContain(
      `{ id: ${PKG.id}, version: ${versionOf({ text: "Changed." })}, title: ${PKG.title} }`,
    );
  });

  it("[SR-021/AK2] element.create stores UUID and version of the target in a reference in the text", async () => {
    const opened = await open();
    const out = await run(opened, "element.create", {
      type: "need",
      title: "Gusts",
      text: `Like [the wind](${ref(NEED.id)}), see [${PKG.title}](${ref(PKG.id, OTHER)}).\n`,
    });
    expect(await read(opened, out.element.file)).toContain(
      `\nLike [the wind](${ref(NEED.id, versionOf(NEED))}), see [${PKG.title}](${ref(PKG.id, versionOf(PKG))}).\n`,
    );
  });

  it("[SR-021/AK2] element.update keeps references as stored and gives every other one the current version", async () => {
    const opened = await open();
    const text = [
      `The display follows [${NEED.title}](${ref(NEED.id, STORED_NEED)}).`,
      `Shipped in [${PKG.title}](${ref(PKG.id)}) and [again](${ref(NEED.id, OTHER)}).`,
      `A reference across repositories: [N-0e9d7c](${ref(SENSOR_NEED.id)}).`,
      "",
    ].join("\n");
    const out = await run(opened, "element.update", { ref: SOURCE.id, text });
    expect(out.element.text).toBe(
      [
        `The display follows [${NEED.title}](${ref(NEED.id, STORED_NEED)}).`,
        `Shipped in [${PKG.title}](${ref(PKG.id, versionOf(PKG))}) and [again](${ref(NEED.id, versionOf(NEED))}).`,
        `A reference across repositories: [N-0e9d7c](${ref(SENSOR_NEED.id, versionOf(SENSOR_NEED))}).`,
        "",
      ].join("\n"),
    );
    expect((await read(opened, SOURCE.file)).endsWith(`---\n${out.element.text ?? ""}`)).toBe(true);
  });

  it("[SR-021/AK2] finds references with any label and keeps other query parameters", async () => {
    const opened = await open();
    const text = [
      `[Release [1.0]](${ref(PKG.id)}) and [a \\] b](<${ref(NEED.id)}> "title")`,
      `[x](logreq:${PKG.id}?view=pro&version=${OTHER}&y=1) [y](logreq:${NEED.id}?view=pro)`,
      "",
    ].join("\n");
    const out = await run(opened, "element.update", { ref: SOURCE.id, text });
    expect(out.element.text).toBe(
      [
        `[Release [1.0]](${ref(PKG.id, versionOf(PKG))}) and [a \\] b](<${ref(NEED.id, versionOf(NEED))}> "title")`,
        `[x](logreq:${PKG.id}?view=pro&version=${versionOf(PKG)}&y=1) [y](logreq:${NEED.id}?view=pro&version=${versionOf(NEED)})`,
        "",
      ].join("\n"),
    );
  });

  it("[SR-021/AK2] leaves links in code, images, escaped links and links that name no UUID as they are", async () => {
    const opened = await open();
    const text = [
      `Code: \`[x](${ref(NEED.id)})\` and \`\`[y](${ref(PKG.id)})\`\`.`,
      `![an image](${ref(NEED.id)}) and \\[escaped](${ref(NEED.id)})`,
      "````md",
      `[in a fence](${ref(NEED.id)})`,
      "```",
      `[still in the fence](${ref(NEED.id)})`,
      "````",
      "> ~~~",
      `> [fence in a quote](${ref(PKG.id)})`,
      "> ~~~",
      "",
      `    [indented code](${ref(PKG.id)})`,
      "",
      "[no UUID](logreq:SR-3d8b2c) and [upper case](logreq:0C8A3E5F-2D1B-4F6E-8A9C-7B3D5E1F2A4C)",
      `> [in a quote](${ref(PKG.id)})`,
      "",
    ].join("\n");
    const out = await run(opened, "element.update", { ref: SOURCE.id, text });
    expect(out.element.text).toBe(
      text.replace(`[in a quote](${ref(PKG.id)})`, `[in a quote](${ref(PKG.id, versionOf(PKG))})`),
    );
  });

  it("[SR-021/AK2] keeps a stored reference without version whose target cannot be found, and refuses a new one", async () => {
    const stored = `Old [gone](${ref(UNKNOWN)}) and [shared](${ref(VAR.id)}) stay.\n`;
    const opened = await open({
      [`system/${SOURCE.file}`]: await sourceWithText(stored),
      // A copied file: the variant's UUID names two files (SR-088).
      "system/variants/copy-of-VAR.md": `---\nid: ${VAR.id}\ntype: variant\nstatus: draft\ntitle: Pro\n---\n`,
    });
    const out = await run(opened, "element.update", {
      ref: SOURCE.id,
      text: `${stored}New [wind](${ref(NEED.id)}).\n`,
    });
    expect(out.element.text).toBe(`${stored}New [wind](${ref(NEED.id, versionOf(NEED))}).\n`);
    const error = await runError(opened, "element.update", {
      ref: SOURCE.id,
      text: `${stored}[again](${ref(UNKNOWN, OTHER)})\n`,
    });
    expect([error.code, error.details]).toEqual(["ref.unknown", { ref: UNKNOWN }]);
  });

  it("finds references with their offsets", () => {
    const text = `a [b](${ref(NEED.id, OTHER)})\n[c](${ref(PKG.id)})`;
    const references = inlineReferences(text);
    expect(references.map((r) => [r.id, r.version, text.slice(r.start, r.end) === r.destination])).toEqual([
      [NEED.id, OTHER, true],
      [PKG.id, undefined, true],
    ]);
  });

  it("refuses a target that is unknown, ambiguous or in a repository that is not available, and writes nothing", async () => {
    // A copied file: two files share the UUID of the variant (SR-088).
    const opened = await open({
      "system/variants/copy-of-VAR.md": `---\nid: ${VAR.id}\ntype: variant\nstatus: draft\ntitle: Pro\n---\n`,
    });
    const before = await read(opened, SOURCE.file);
    const cases: [Record<string, unknown>, string, Record<string, unknown>][] = [
      [{ set: { packages: [{ id: UNKNOWN }] } }, "ref.unknown", { ref: UNKNOWN, repository: "system" }],
      [
        { set: { packages: [{ id: SENSOR_NEED.id }] } },
        "ref.unknown",
        { ref: SENSOR_NEED.id, repository: "system" },
      ],
      [{ text: `[x](${ref(UNKNOWN)})` }, "ref.unknown", { ref: UNKNOWN }],
      [
        { set: { packages: [{ id: VAR.id }] } },
        "ref.ambiguous",
        {
          ref: VAR.id,
          repository: "system",
          candidates: [
            { id: VAR.id, repository: "system", file: "variants/VAR-52e8c0f4b9a3.md" },
            { id: VAR.id, repository: "system", file: "variants/copy-of-VAR.md" },
          ],
        },
      ],
      [
        { text: `[x](${ref(VAR.id)})` },
        "ref.ambiguous",
        { ref: VAR.id, candidates: expect.any(Array) as unknown },
      ],
    ];
    for (const [input, code, details] of cases) {
      const error = await runError(opened, "element.update", { ref: SOURCE.id, ...input });
      expect([error.code, error.details]).toEqual([code, details]);
    }
    expect(await read(opened, SOURCE.file)).toBe(before);
    await fs.rm(opened.fixture.path("sensor"), { recursive: true });
    await opened.workspace.reset(workspaceLayoutState);
    const missing = await runError(opened, "element.update", {
      ref: SOURCE.id,
      set: { packages: [{ id: SENSOR_NEED.id, repository: "sensor" }] },
    });
    expect([missing.code, missing.details]).toEqual([
      "ref.unknown",
      { ref: SENSOR_NEED.id, repository: "sensor", reason: "repository-not-available" },
    ]);
    expect(missing.message).toBe(
      `Repository sensor is not on this machine, so the version of ${SENSOR_NEED.id} cannot be read and stored`,
    );
  });

  it("stores the version of a target file as it is now, and refuses one that is gone or no longer the target", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    await fs.appendFile(opened.fixture.path(`system/${PKG.file}`), "More.\n");
    const out = await run(opened, "element.update", { ref: SOURCE.id, text: `[p](${ref(PKG.id)})\n` });
    expect(out.element.text).toBe(`[p](${ref(PKG.id, versionOf({ text: `${PKG.text}\nMore.` }))})\n`);
    await opened.workspace.get(elementStoreState);
    await fs.rm(opened.fixture.path(`system/${NEED.file}`));
    await fs.writeFile(
      opened.fixture.path(`system/${VAR.file}`),
      `---\nid: ${UNKNOWN}\ntype: variant\nstatus: draft\ntitle: Pro\n---\n`,
    );
    for (const id of [NEED.id, VAR.id]) {
      const error = await runError(opened, "element.update", { ref: SOURCE.id, text: `[n](${ref(id)})` });
      expect([error.code, error.details?.["ref"]]).toEqual(["ref.unknown", id]);
    }
    await fs.writeFile(opened.fixture.path(`system/${VAR.file}`), "no frontmatter\n");
    expect(
      (await runError(opened, "element.update", { ref: SOURCE.id, text: `[n](${ref(VAR.id)})` })).code,
    ).toBe("ref.unknown");
  });

  it("stores no title when the target has none or no property holds titles", async () => {
    const opened = await open({
      [`system/${PKG.file}`]: `---\nid: ${PKG.id}\ntype: package\nstatus: draft\ntitle: 42\n---\n${PKG.text}\n`,
    });
    const ctx = await context(opened);
    expect(await currentTarget(ctx, "system", { id: PKG.id })).toEqual({
      id: PKG.id,
      version: versionOf(PKG),
    });
    const untitled = {
      ...ctx,
      metamodel: {
        ...ctx.metamodel,
        properties: ctx.metamodel.properties.filter((p) => p.meaning !== "title"),
      },
    };
    expect(await currentTarget(untitled, "system", { id: NEED.id })).toEqual({
      id: NEED.id,
      version: versionOf(NEED),
    });
  });

  it("reports a target in a repository the layout does not list as a bug", async () => {
    const opened = await open();
    const ctx = await context(opened);
    const error = await currentTarget({ ...ctx, layout: { ...ctx.layout, repositories: [] } }, "system", {
      id: NEED.id,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe("internal");
  });

  it("gives every reference to the same target the same version", async () => {
    const opened = await open();
    const ctx = await context(opened);
    const text = `[a](${ref(NEED.id)}) [b](${ref(NEED.id)})`;
    expect(await setInlineReferences(ctx, text, text)).toBe(
      `[a](${ref(NEED.id, versionOf(NEED))}) [b](${ref(NEED.id, versionOf(NEED))})`,
    );
  });
});
