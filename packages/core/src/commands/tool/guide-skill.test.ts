// tool.guide with `skill` and `write` (SR-229 AK6, AK7, AK8): the skill file and its places of D-079, each written
// on its own; a place not written makes the call fail after the others were written.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { CommandCatalog } from "../../generated/types.js";
import { STANDARD_MODEL_TEXT } from "../../metamodel/index.js";
import { PRODUCT_VERSION } from "../../product.js";
import { contractsBundle } from "../../runtime/contracts.js";
import { getCommandRuntime, invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { OPEN_LOCAL_PATHS } from "../../workspace/local-paths.js";
import { commandLineName, mcpToolName, renderCall } from "./guide/calls.js";
import {
  SKILL_DESCRIPTION,
  SKILL_FILES,
  SKILL_NAME,
  SKILL_PRECEDENCE,
  SKILL_WORKFLOWS,
  compareVersions,
  identifySkill,
  skillChecksum,
  skillFile,
} from "./guide/skill.js";
import {
  SKILL_READ_MAX,
  readSkillFiles,
  skillLocations,
  writeSkillFiles,
  writtenOrThrow,
} from "./guide/skill-file.js";
import { GUIDE_RULES, GUIDE_TAIL, GUIDE_WRITING_RULES, METAMODEL_CHANGES } from "./guide/text.js";

const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;
const NO_PERMISSIONS = process.platform === "win32" || process.getuid?.() === 0;

/** A temporary folder with `files`, removed after the test; its real path. */
const folder = async (files: Readonly<Record<string, string>> = {}): Promise<string> => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-skill-")));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), text);
  }
  return root;
};

const WORKSPACE_FILE =
  "reqseq-workspace: 1\nname: Station\nrepositories:\n  - { name: main, url: '', main: true }\nmetamodel: { repository: main, path: metamodel }\n";

/** The files of a workspace with the standard model in `at` (`""` for the root). */
const workspaceFiles = (at = ""): Record<string, string> => ({
  [path.posix.join(at, "reqseq-workspace.yaml")]: WORKSPACE_FILE,
  [path.posix.join(at, "metamodel/standard-model.yaml")]: STANDARD_MODEL_TEXT,
});

/** A `.git` folder that git (and `workTreeOf`) takes for a repository, without running git. */
const gitEntry = async (at: string): Promise<void> => {
  await fs.mkdir(path.join(at, ".git", "objects"), { recursive: true });
  await fs.mkdir(path.join(at, ".git", "refs"), { recursive: true });
  await fs.writeFile(path.join(at, ".git", "HEAD"), "ref: refs/heads/main\n");
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The output with the answer sentence, which the runtime adds (SR-224 AK1). */
type Output = CommandOutput<"tool.guide"> & { readonly answer: string };

const run = async (
  root: string,
  input: Readonly<Record<string, unknown>>,
  access?: "mcp" | "api" | "cli",
): Promise<Output> =>
  (await invoke("tool.guide", input, {
    workspace: open(root),
    ...(access === undefined ? {} : { access }),
  })) as Output;

const refusal = async (
  root: string,
  input: Readonly<Record<string, unknown>>,
  access?: "mcp" | "api",
): Promise<CommandError> => {
  const error = await run(root, input, access).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

const WRITE = { skill: true, write: true } as const;
const [CLAUDE, AGENTS] = SKILL_FILES;
const skillAt = (root: string, file: string = CLAUDE): string => path.join(root, ...file.split("/"));
const read = (root: string, file: string = CLAUDE): Promise<string> =>
  fs.readFile(skillAt(root, file), "utf8");
/** Writes `text` at the place `file` of `root`, with its folders. */
const put = async (root: string, text: string, file: string = CLAUDE): Promise<void> => {
  await fs.mkdir(path.dirname(skillAt(root, file)), { recursive: true });
  await fs.writeFile(skillAt(root, file), text);
};
/** Both places with the same action. */
const both = (action: string, previousVersion?: string): unknown[] =>
  SKILL_FILES.map((file) => ({
    path: file,
    action,
    ...(previousVersion === undefined ? {} : { previousVersion }),
  }));

interface Place {
  readonly path: string;
  readonly action?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}
/** The places of a failed write, from its details. */
const placesOf = (error: CommandError): readonly Place[] => (error.details as { places: Place[] }).places;

/** The workflow sections of the skill, by heading, each with its numbered steps. */
const workflows = (text: string): { heading: string; steps: string[] }[] =>
  text
    .split(/^## /m)
    .slice(1)
    .map((part) => ({
      heading: part.slice(0, part.indexOf("\n")),
      steps: [...part.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => `${m[1] ?? ""}. ${m[2] ?? ""}`),
    }));

/** The names a metamodel gives, from `metamodel.get`: type keys and names, prefixes, statuses, relation kinds. */
const metamodelNames = async (root: string): Promise<{ keys: string[]; names: string[] }> => {
  const out = (await invoke(
    "metamodel.get",
    {},
    { workspace: open(root) },
  )) as CommandOutput<"metamodel.get">;
  const types = out.types;
  const statuses = out.statuses;
  return {
    keys: [...types.map((t) => t.key), ...statuses.map((s) => s.key), ...out.relations.map((k) => k.key)],
    names: [
      ...types.map((t) => t.name),
      ...types.map((t) => `${t.prefix}-`),
      ...statuses.map((s) => s.name),
      ...out.relations.map((k) => k.name),
    ],
  };
};

/** A metamodel of its own, with names found in no other. */
const OWN_MODEL = `reqseq-metamodel: 1
statuses:
  - { key: entwurf-x, name: Entwurf X, initial: true }
  - { key: freigabe-x, name: Freigabe X }
types:
  - key: wunsch-x
    name: Kundenwunsch X
    prefix: KWX
    meaning: need
    properties: [title]
  - key: anforderung-x
    name: Anforderung X
    prefix: ANX
    meaning: requirement
    properties: [title]
properties:
  - { key: title, name: Title, kind: text, meaning: title }
relations:
  - { key: leitet-ab-x, name: Leitet ab X, meaning: derivation }
`;

describe("tool.guide with skill", () => {
  it("[SR-229/AK-nrf2] gives the skill file managing-requirements with its description, the guide step, the five workflows as numbered steps, version and checksum", async () => {
    const text = (await run(await folder(), { skill: true })).guide;
    expect(text).toBe(skillFile(ENTRIES));
    // Agent Skills frontmatter: name, a description of at most 1,024 characters, metadata.
    expect(
      text.startsWith(`---\nname: ${SKILL_NAME}\ndescription: ${JSON.stringify(SKILL_DESCRIPTION)}\n`),
    ).toBe(true);
    expect(SKILL_NAME).toBe("managing-requirements");
    expect(SKILL_DESCRIPTION.length).toBeLessThanOrEqual(1024);
    expect(SKILL_DESCRIPTION).toMatch(/^Works with .*\. Use when /);
    expect(text).toContain(`  generator: "ReqSeq"\n  reqseq-version: "${PRODUCT_VERSION}"\n`);
    const { stated, actual } = skillChecksum(text);
    expect(stated).toMatch(/^[0-9a-f]{64}$/);
    expect(stated).toBe(actual);
    expect(identifySkill(text)).toEqual({
      own: true,
      version: PRODUCT_VERSION,
      intact: true,
    });
    expect(text.endsWith(".\n")).toBe(true);
    expect(text).not.toContain("\r");

    const sections = workflows(text);
    expect(sections.map((s) => s.heading)).toEqual(["First", ...SKILL_WORKFLOWS]);
    expect(SKILL_WORKFLOWS).toEqual([
      "Create a requirement",
      "Implement a requirement up to its evidence",
      "Check before finishing",
      "Change an element whose status is not the initial status",
      "Change the metamodel",
    ]);
    for (const { steps } of sections) {
      expect(steps.length).toBeGreaterThan(0);
      steps.forEach((step, index) => {
        expect(step.startsWith(`${String(index + 1)}. `)).toBe(true);
      });
    }
    // The first step names both ways to the agent guide and what to do when neither is reachable.
    const [first] = sections[0]?.steps ?? [];
    expect(first).toContain("`tool_guide` or `reqseq tool guide`");
    expect(first).toContain("If neither is reachable");
    // Step 1 of three workflows is the impact check with the commands of AK12, both ways.
    const byHeading = new Map(sections.map((s) => [s.heading, s.steps]));
    for (const heading of [SKILL_WORKFLOWS[0], SKILL_WORKFLOWS[1], SKILL_WORKFLOWS[3]]) {
      const step = byHeading.get(heading)?.[0] ?? "";
      expect(step).toContain("Check the impact first");
      for (const command of [
        "element.get",
        "hint.list",
        "trace.affected",
        "element.search",
        "evidence.list",
      ]) {
        expect(step).toContain(`\`${mcpToolName(command)}\``);
        expect(step).toContain(`\`${commandLineName(command)}`);
      }
    }
    expect(byHeading.get(SKILL_WORKFLOWS[0])?.[0]).toContain(
      "each element the new requirement will point to",
    );
    // In the change workflow, the question to the person comes after the check and names both ways.
    const ask = byHeading.get(SKILL_WORKFLOWS[3])?.[1] ?? "";
    expect(ask).toContain("Ask the person");
    expect(ask).toContain("`element_update`");
    expect(ask).toContain("`element_supersede`");
    expect(ask).toContain("`reqseq element supersede ");
    expect(ask).toContain("the rules of the agent guide");
    const finish = (byHeading.get(SKILL_WORKFLOWS[2]) ?? []).join("\n");
    for (const command of ["workspace.check", "evidence.degree", "evidence.withoutPassedTest"]) {
      expect(finish).toContain(`\`${mcpToolName(command)}\` or \`${commandLineName(command)}\``);
    }
  });

  it("[SR-229/AK-nrf2] says at its start, before the first workflow, that project rules take precedence over it and the agent guide", async () => {
    const text = (await run(await folder(), { skill: true })).guide;
    expect(SKILL_PRECEDENCE).toBe("Project rules take precedence over this skill and the agent guide.");
    const body = text.slice(text.indexOf("\n---\n") + 5);
    const at = body.indexOf(SKILL_PRECEDENCE);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(body.indexOf("\n## "));
    expect(body.indexOf(SKILL_PRECEDENCE, at + 1)).toBe(-1);
    // It is the rule of AK5 that project rules go first, extended to the skill: the one rule the skill states.
    expect(GUIDE_RULES).toContain("Project rules take precedence over the agent guide.");
  });

  it("[SR-229/AK-qdn4] has the workflow to change the metamodel: propose, wait for the decision, run the command, check, read the guide again", async () => {
    const text = (await run(await folder(), { skill: true })).guide;
    const steps = new Map(workflows(text).map((s) => [s.heading, s.steps])).get("Change the metamodel") ?? [];
    expect(steps).toHaveLength(5);
    const [propose, decide, carry, check, again] = steps;
    expect(propose).toContain(
      "Read the metamodel (`metamodel_get` or `reqseq metamodel get`), then propose the change with its rationale",
    );
    expect(decide).toContain("Wait for the person's explicit decision");
    for (const command of METAMODEL_CHANGES) {
      expect(carry).toContain(`\`${mcpToolName(command)}\` with `);
      expect(carry).toContain(`\`${commandLineName(command)} `);
    }
    expect(carry).toContain(
      '`metamodel_addType` with `{"name":"<name>","prefix":"<prefix>"}` or `reqseq metamodel add-type',
    );
    expect(check).toContain("`workspace_check` or `reqseq workspace check`");
    expect(again).toContain("Read the agent guide again (`tool_guide` or `reqseq tool guide`)");
  });

  it("[SR-229/AK-nrf2] names every command both ways and repeats neither the rules nor the pipeline paragraph", async () => {
    const text = (await run(await folder(), { skill: true })).guide;
    // Each call: the MCP tool, then " or ", then the command line of the same command.
    const pairs = [...text.matchAll(/`([a-z]+)_([A-Za-z]+)`(?: with `[^`]+`)? or `(reqseq [a-z]+ [a-z-]+)/g)];
    expect(pairs.length).toBeGreaterThan(15);
    for (const [, group, action, cli] of pairs) {
      expect(cli?.startsWith(commandLineName(`${group ?? ""}.${action ?? ""}`))).toBe(true);
    }
    expect([...text.matchAll(/`[a-z]+_[A-Za-z]+`/g)].length).toBe(pairs.length);
    expect([...text.matchAll(/`reqseq /g)].length).toBe(pairs.length);
    // No rule of the guide (SR-229 AK5, AK13), nor any sentence or clause of one, appears in the skill,
    // apart from the sentence that project rules go first, which AK7 asks for at its start.
    const parts = [...GUIDE_RULES, ...GUIDE_WRITING_RULES].flatMap((rule) =>
      rule.split(/[.;:]\s+/).filter((part) => part.length > 30),
    );
    expect(parts.length).toBeGreaterThan(GUIDE_RULES.length + GUIDE_WRITING_RULES.length);
    const rest = text.replace(SKILL_PRECEDENCE, "");
    expect(parts.filter((part) => rest.includes(part))).toEqual([]);
    const pipeline = GUIDE_TAIL.lines({
      workspace: undefined,
      facts: { reason: "", noWorkspace: true },
      names: "cli",
      call: () => "",
      cli: () => "",
    }).join("\n");
    expect(text).not.toContain(pipeline.slice(0, 60));
    expect(text).not.toContain("pipeline");
  });

  it("[SR-229/AK-nrf2] holds no name of a metamodel: the same text without a workspace, with the standard model and with another", async () => {
    const standard = await folder(workspaceFiles());
    const own = await folder({ "reqseq-workspace.yaml": WORKSPACE_FILE, "metamodel/model.yaml": OWN_MODEL });
    const texts = [
      (await run(await folder(), { skill: true })).guide,
      (await run(standard, { skill: true })).guide,
      (await run(own, { skill: true })).guide,
      (await run(standard, { skill: true, names: "mcp" })).guide,
    ];
    expect(new Set(texts).size).toBe(1);
    const [text = ""] = texts;
    const spans = [...text.matchAll(/`[^`]+`/g)].map((m) => m[0]).join("\n");
    const word = (name: string): RegExp =>
      new RegExp(
        `(^|[^\\p{L}\\p{N}-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}-])`,
        "u",
      );
    for (const root of [standard, own]) {
      const { keys, names } = await metamodelNames(root);
      expect(keys.length).toBeGreaterThanOrEqual(5);
      // A key in a call would be a name of the metamodel; in prose `need` is the term, not the type.
      expect(keys.filter((key) => word(key).test(spans))).toEqual([]);
      expect(
        names.filter((name) => word(name).test(text) || text.includes(name.endsWith("-") ? name : "\0")),
      ).toEqual([]);
    }
    expect((await metamodelNames(own)).keys.filter((key) => word(key).test(text))).toEqual([]);
  });

  it("[SR-229/AK-j7mz] names only commands of the command catalog, which this version implements", async () => {
    const text = (await run(await folder(), { skill: true })).guide;
    const runtime = getCommandRuntime();
    const byCli = new Map(ENTRIES.map((e) => [commandLineName(e.name), e.name]));
    const named = [
      ...[...text.matchAll(/`(reqseq [a-z]+ [a-z-]+)/g)].map((m) => byCli.get(m[1] ?? "") ?? m[1]),
      ...[...text.matchAll(/`([a-z]+)_([A-Za-z]+)`/g)].map((m) => `${m[1] ?? ""}.${m[2] ?? ""}`),
    ].map(String);
    expect(named.length).toBeGreaterThan(30);
    expect(named.filter((name) => runtime.contracts.entry(name) === undefined)).toEqual([]);
    expect(named.filter((name) => !runtime.commands.has(name))).toEqual([]);
  });

  it("refuses write without skill and replace without write, naming the field", async () => {
    const root = await folder(workspaceFiles());
    for (const [input, field] of [
      [{ write: true }, "write"],
      [{ skill: true, replace: true }, "replace"],
    ] as const) {
      const error = await refusal(root, input);
      expect(error.code).toBe("input.invalid");
      expect(error.details).toMatchObject({ errors: [{ field }] });
    }
    await expect(fs.stat(path.join(root, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("tool.guide with write", () => {
  it("[SR-229/AK-v09f] creates the file at both places in the workspace folder without Git, then leaves them, and replaces its own file of another version", async () => {
    const root = await folder(workspaceFiles());
    const created = await run(root, WRITE);
    expect(created.places).toEqual(both("created"));
    expect(created.answer).toBe(`Created the skill file ${CLAUDE}, and created the skill file ${AGENTS}.`);
    expect(await read(root)).toBe(created.guide);
    expect(await read(root, AGENTS)).toBe(created.guide);
    const again = await run(root, WRITE);
    expect(again.places).toEqual(both("unchanged"));
    expect(again.answer).toBe(
      `Left the skill file ${CLAUDE} unchanged, and left the skill file ${AGENTS} unchanged.`,
    );
    // A copy with CRLF line endings (a Git checkout on Windows) is still the file of this version.
    await fs.writeFile(skillAt(root), created.guide.replaceAll("\n", "\r\n"));
    expect((await run(root, WRITE)).places).toEqual(both("unchanged"));
    // ReqSeq's own unchanged file of another version, older or newer, is replaced without `replace`, at each place.
    for (const version of ["0.0.1", "99.0.0"]) {
      await fs.writeFile(skillAt(root), skillFile(ENTRIES, version));
      const replaced = await run(root, WRITE);
      expect(replaced.places).toEqual([
        { path: CLAUDE, action: "replaced", previousVersion: version },
        { path: AGENTS, action: "unchanged" },
      ]);
      expect(replaced.answer).toBe(
        `Replaced the skill file ${CLAUDE}, and left the skill file ${AGENTS} unchanged.`,
      );
      expect(await read(root)).toBe(created.guide);
    }
    // A missing file in its folders is created.
    await fs.rm(skillAt(root, AGENTS));
    expect((await run(root, WRITE)).places?.[1]).toEqual({ path: AGENTS, action: "created" });
    await fs.writeFile(skillAt(root, AGENTS), skillFile(ENTRIES, "0.0.1"));
    expect((await run(root, WRITE)).places).toEqual([
      { path: CLAUDE, action: "unchanged" },
      { path: AGENTS, action: "replaced", previousVersion: "0.0.1" },
    ]);
    // The written files are no elements, and the workspace check stays clean (SR-003 AK2).
    const check = (await invoke(
      "workspace.check",
      {},
      { workspace: open(root) },
    )) as CommandOutput<"workspace.check">;
    expect(check.problems).toEqual([]);
  });

  it("[SR-229/AK-v09f] writes the other place over a file ReqSeq did not write or that was changed, fails naming each place, and replaces it only with replace", async () => {
    for (const [text, reason] of [
      ["---\nname: managing-requirements\ndescription: Mine.\n---\n\n# Mine\n", "foreign"],
      [`${skillFile(ENTRIES, "0.0.1")}One more line.\n`, "changed"],
      [`x${"y".repeat(SKILL_READ_MAX)}`, "foreign"],
    ] as const) {
      const root = await folder(workspaceFiles());
      await put(root, text);
      const error = await refusal(root, WRITE);
      const what = reason === "foreign" ? "was not written by ReqSeq" : "was changed since ReqSeq wrote it";
      const why = `the skill file ${CLAUDE} ${what}; ReqSeq replaces it only on request: \`reqseq tool guide --skill --write --replace\``;
      expect(error.code).toBe("file.exists");
      expect(error.message).toBe(
        `Not written at every place of the skill file: ${CLAUDE}: not written: ${why}; ${AGENTS}: created`,
      );
      expect(error.details).toEqual({
        command: "tool.guide",
        places: [
          {
            path: CLAUDE,
            error: { code: "file.exists", message: `Not written: ${why}`, details: { path: CLAUDE, reason } },
          },
          { path: AGENTS, action: "created" },
        ],
      });
      expect(await read(root)).toBe(text);
      expect(await read(root, AGENTS)).toBe((await run(root, { skill: true })).guide);
      const replaced = await run(root, { ...WRITE, replace: true });
      expect(replaced.places).toEqual([
        {
          path: CLAUDE,
          action: "replaced",
          ...(reason === "changed" ? { previousVersion: "0.0.1" } : {}),
        },
        { path: AGENTS, action: "unchanged" },
      ]);
      expect(await read(root)).toBe(replaced.guide);
    }
    // `replace` holds for every place; the code of a failed call is that of the first place not written.
    const root = await folder(workspaceFiles());
    await put(root, "# Mine\n", AGENTS);
    await put(root, "# Mine too\n");
    const failed = await refusal(root, WRITE);
    expect([failed.code, placesOf(failed).map((place) => place.error?.code)]).toEqual([
      "file.exists",
      ["file.exists", "file.exists"],
    ]);
    expect((await run(root, { ...WRITE, replace: true })).places).toEqual(both("replaced"));
  });

  it("[SR-229/AK-v09f] writes both places at the Git root above the workspace folder, shared by several workspaces, also through a linked workspace root", async () => {
    const top = await folder({ ...workspaceFiles("spec"), ...workspaceFiles("product/model") });
    await gitEntry(top);
    const shared = SKILL_FILES.map((file) => `../${file}`);
    expect((await run(path.join(top, "spec"), WRITE)).places).toEqual(
      shared.map((file) => ({ path: file, action: "created" })),
    );
    expect((await run(path.join(top, "product/model"), WRITE)).places).toEqual(
      shared.map((file) => ({ path: `../${file}`, action: "unchanged" })),
    );
    await expect(fs.stat(skillAt(path.join(top, "spec")))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(skillAt(path.join(top, "spec"), AGENTS))).rejects.toMatchObject({ code: "ENOENT" });
    // A workspace root reached through a link: the path counts from its real folder.
    const links = await folder();
    await fs.symlink(path.join(top, "spec"), path.join(links, "spec"), "dir");
    expect((await run(path.join(links, "spec"), WRITE)).places).toEqual(
      shared.map((file) => ({ path: file, action: "unchanged" })),
    );
    expect((await skillLocations(open(path.join(links, "spec")))).map((place) => place.root)).toEqual([
      top,
      top,
    ]);
    // The workspace folder at the Git root: the same places as without Git.
    const atRoot = await folder(workspaceFiles());
    await gitEntry(atRoot);
    expect((await run(atRoot, WRITE)).places).toEqual(both("created"));
  });

  it("[SR-229/AK-v09f] through API and MCP writes inside the repositories, and outside fails naming both places and the command line once, without an absolute path", async () => {
    const atRoot = await folder(workspaceFiles());
    await gitEntry(atRoot);
    expect((await run(atRoot, WRITE, "mcp")).places).toEqual(both("created"));
    const top = await folder(workspaceFiles("spec"));
    await gitEntry(top);
    const outside = (file: string): string =>
      `the skill file ../${file} lies outside the repositories of the workspace, and through the API and the MCP server ReqSeq writes only inside them; run \`reqseq tool guide --skill --write\` in the workspace folder`;
    for (const access of ["api", "mcp"] as const) {
      const error = await refusal(path.join(top, "spec"), WRITE, access);
      expect(error.code).toBe("input.invalid");
      expect(error.message).toBe(
        `Not written at every place of the skill file: ../${CLAUDE}: not written: ${outside(CLAUDE)}; ../${AGENTS}: not written, for the same reason`,
      );
      expect(placesOf(error).map((place) => [place.path, place.error?.details])).toEqual(
        SKILL_FILES.map((file) => [
          `../${file}`,
          { command: "tool.guide", reason: "outside-repositories", field: "skill file", path: `../${file}` },
        ]),
      );
      expect(JSON.stringify(error.details)).not.toContain(top);
      expect(error.message).not.toContain(top);
    }
    await expect(fs.stat(path.join(top, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(top, ".agents"))).rejects.toMatchObject({ code: "ENOENT" });
    // The command line writes there.
    expect((await run(path.join(top, "spec"), WRITE, "cli")).places?.map((place) => place.action)).toEqual([
      "created",
      "created",
    ]);
    // Once a file is there, API and MCP still refuse before they look at it: nothing outside is read.
    for (const text of [undefined, "# Mine\n"]) {
      if (text !== undefined) {
        await fs.writeFile(skillAt(top), text);
      }
      for (const access of ["api", "mcp"] as const) {
        const error = await refusal(path.join(top, "spec"), WRITE, access);
        expect(placesOf(error).map((place) => [place.error?.code, place.error?.details?.["reason"]])).toEqual(
          [
            ["input.invalid", "outside-repositories"],
            ["input.invalid", "outside-repositories"],
          ],
        );
      }
    }
  });

  it("[SR-229/AK-v09f] names a reason once for the places it holds for", () => {
    const refused = new CommandError("input.invalid", "Not written: the place cannot be checked");
    expect(() =>
      writtenOrThrow([
        { path: CLAUDE, refused },
        { path: AGENTS, refused },
      ]),
    ).toThrow(
      `Not written at every place of the skill file: ${CLAUDE}: not written: the place cannot be checked; ${AGENTS}: not written, for the same reason`,
    );
    const written = [
      { path: CLAUDE, action: "created" },
      { path: AGENTS, action: "unchanged" },
    ] as const;
    expect(writtenOrThrow(written)).toEqual(written);
  });

  it("[SR-229/AK-v09f] refuses a link at the file, a folder linked out of the root or into .git, and a file under a linked folder, and writes the other place", async () => {
    const outside = await folder();
    const cases: [string, (root: string) => Promise<void>, string][] = [
      [
        "a link at the file",
        async (root) => {
          await fs.mkdir(path.dirname(skillAt(root)), { recursive: true });
          await fs.writeFile(path.join(outside, "x.md"), "x");
          await fs.symlink(path.join(outside, "x.md"), skillAt(root));
        },
        "file.not-regular",
      ],
      [
        "a folder at the file",
        async (root) => {
          await fs.mkdir(skillAt(root), { recursive: true });
        },
        "file.not-regular",
      ],
      [
        ".claude linked out",
        (root) => fs.symlink(outside, path.join(root, ".claude"), "dir"),
        "input.invalid",
      ],
      [
        ".claude linked into .git",
        async (root) => {
          await gitEntry(root);
          await fs.symlink(path.join(root, ".git"), path.join(root, ".claude"), "dir");
        },
        "input.invalid",
      ],
      [
        "a file under a folder linked out",
        async (root) => {
          await fs.mkdir(path.join(outside, "linked/skills/managing-requirements"), { recursive: true });
          await fs.writeFile(path.join(outside, "linked/skills/managing-requirements/SKILL.md"), "mine");
          await fs.symlink(path.join(outside, "linked"), path.join(root, ".claude"), "dir");
        },
        "input.invalid",
      ],
      [
        ".claude holding a .git entry",
        async (root) => {
          await gitEntry(path.join(root, ".claude"));
        },
        "input.invalid",
      ],
      [
        "a loop of links",
        (root) => fs.symlink(path.join(root, ".claude"), path.join(root, ".claude"), "dir"),
        "file.faulty",
      ],
      [".claude as a file", (root) => fs.writeFile(path.join(root, ".claude"), "x"), "file.not-regular"],
    ];
    for (const [name, prepare, code] of cases) {
      const root = await folder(workspaceFiles());
      await prepare(root);
      const outcome = await run(root, { ...WRITE, replace: true }).then(
        () => ["written"],
        (e: unknown) => (e instanceof CommandError ? [e.code, placesOf(e)[1]?.action] : [String(e)]),
      );
      expect([name, outcome]).toEqual([name, [code, "created"]]);
    }
    await expect(fs.readdir(path.join(outside))).resolves.not.toContain("skills");
    expect(await fs.readdir(outside)).toEqual(expect.not.arrayContaining(["skills"]));
  });

  it("[SR-229/AK-v09f] refuses only the place a file stands in the way of, and finds the first place's file through a folder linked to it", async () => {
    const root = await folder(workspaceFiles());
    await fs.writeFile(path.join(root, ".agents"), "my own notes\n");
    const error = await refusal(root, WRITE);
    expect([error.code, placesOf(error)]).toEqual([
      "file.not-regular",
      [
        { path: CLAUDE, action: "created" },
        {
          path: AGENTS,
          error: {
            code: "file.not-regular",
            message: `Not written: a path above the skill file ${AGENTS} is a file, not a folder`,
            details: { path: AGENTS, reason: "file-in-the-way" },
          },
        },
      ],
    ]);
    expect(await fs.readFile(path.join(root, ".agents"), "utf8")).toBe("my own notes\n");
    // `.agents/skills` linked to `.claude/skills` inside the repository: one file, left at the second place.
    const linked = await folder(workspaceFiles());
    await fs.mkdir(path.join(linked, ".claude", "skills"), { recursive: true });
    await fs.mkdir(path.join(linked, ".agents"));
    await fs.symlink(path.join(linked, ".claude", "skills"), path.join(linked, ".agents", "skills"), "dir");
    expect((await run(linked, WRITE)).places).toEqual([
      { path: CLAUDE, action: "created" },
      { path: AGENTS, action: "unchanged" },
    ]);
  });

  it("[SR-229/AK-v09f] refuses a place whose folders cannot be looked at", async () => {
    const root = await folder(workspaceFiles());
    const stat = fs.stat.bind(fs);
    vi.spyOn(fs, "stat").mockImplementation(((at: string, ...rest: never[]) =>
      at === path.join(root, ".agents")
        ? Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }))
        : stat(at, ...rest)) as typeof fs.stat);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const error = await refusal(root, WRITE);
    expect([error.code, placesOf(error)[1]?.error?.details]).toEqual([
      "file.faulty",
      { path: AGENTS, reason: "EACCES" },
    ]);
  });

  it("[SR-229/AK-v09f] refuses a loop of links also where lstat of the file says only that it is not there, as on Windows", async () => {
    const root = await folder(workspaceFiles());
    await fs.symlink(path.join(root, ".claude"), path.join(root, ".claude"), "dir");
    const lstat = fs.lstat.bind(fs);
    // Windows answers lstat below a link that points to itself with ENOENT, not ELOOP.
    vi.spyOn(fs, "lstat").mockImplementation(((at: string, ...rest: never[]) =>
      at === skillAt(root)
        ? Promise.reject(Object.assign(new Error("no such file"), { code: "ENOENT" }))
        : lstat(at, ...rest)) as typeof fs.lstat);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const error = await refusal(root, WRITE);
    expect([error.code, placesOf(error)[0]?.error?.details]).toEqual([
      "file.faulty",
      { path: CLAUDE, reason: "ELOOP" },
    ]);
  });

  it("[SR-229/AK-v09f] refuses a file it cannot look at or read, also a large one it reads only to replace it", async () => {
    const root = await folder(workspaceFiles());
    await fs.mkdir(path.dirname(skillAt(root)), { recursive: true });
    const denied = (): Error => Object.assign(new Error("permission denied"), { code: "EACCES" });
    const lstat = fs.lstat.bind(fs);
    const readFile = fs.readFile.bind(fs);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    await fs.writeFile(skillAt(root), "# Mine\n");
    const lstatSpy = vi
      .spyOn(fs, "lstat")
      .mockImplementation(((at: string, ...rest: never[]) =>
        at === skillAt(root) ? Promise.reject(denied()) : lstat(at, ...rest)) as typeof fs.lstat);
    expect(placesOf(await refusal(root, WRITE))[0]?.error?.details).toEqual({
      path: CLAUDE,
      reason: "EACCES",
    });
    lstatSpy.mockRestore();
    const readSpy = vi
      .spyOn(fs, "readFile")
      .mockImplementation(((at: string, ...rest: never[]) =>
        at === skillAt(root) ? Promise.reject(denied()) : readFile(at, ...rest)) as typeof fs.readFile);
    for (const [text, input] of [
      ["# Mine\n", WRITE],
      ["y".repeat(SKILL_READ_MAX + 1), { ...WRITE, replace: true }],
    ] as const) {
      await fs.writeFile(skillAt(root), text);
      const error = await refusal(root, input);
      expect(error.code).toBe("file.faulty");
      expect(error.message).toContain(`${CLAUDE}: not written: the skill file ${CLAUDE} cannot be read`);
    }
    readSpy.mockRestore();
    expect(await read(root)).toBe("y".repeat(SKILL_READ_MAX + 1));
  });

  it("[SR-229/AK-v09f] writes nothing into a repository that lies in a .git folder", async () => {
    const holder = await folder();
    const root = path.join(holder, ".git", "work");
    await fs.mkdir(path.join(root, "metamodel"), { recursive: true });
    for (const [name, text] of Object.entries(workspaceFiles())) {
      await fs.writeFile(path.join(root, name), text);
    }
    await gitEntry(root);
    const error = await refusal(root, WRITE);
    expect(placesOf(error).map((place) => [place.error?.code, place.error?.details?.["reason"]])).toEqual([
      ["input.invalid", "git-folder"],
      ["input.invalid", "git-folder"],
    ]);
    await expect(fs.stat(path.join(root, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(root, ".agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(NO_PERMISSIONS)(
    "[SR-229/AK-v09f] names the path when the skill folder is not writable",
    async () => {
      const root = await folder(workspaceFiles());
      await fs.mkdir(path.join(root, ".claude"));
      await fs.chmod(path.join(root, ".claude"), 0o555);
      onTestFinished(() => fs.chmod(path.join(root, ".claude"), 0o755));
      const error = await refusal(root, WRITE);
      expect(error.code).toBe("file.read-only");
      expect(error.message).toContain(".claude");
      expect(placesOf(error)[1]).toEqual({ path: AGENTS, action: "created" });
    },
  );

  it("needs a workspace to write, and says so once, not per place", async () => {
    const error = await refusal(await folder(), WRITE);
    expect(error.code).toBe("workspace.not-found");
    expect(error.details).not.toHaveProperty("places");
  });

  /**
   * While the metamodel of `root` cannot be read, a write command is refused (SR-011 AK3, AK4) and the
   * skill file is written by the rules of SR-229 AK8: created, then left, a foreign file only replaced with `replace`.
   */
  const writesWhileReadOnly = async (root: string): Promise<void> => {
    const status = (await invoke(
      "workspace.status",
      {},
      { workspace: open(root) },
    )) as CommandOutput<"workspace.status">;
    expect(status.readOnly).toBe(true);
    await expect(
      invoke("element.create", { type: "requirement", title: "Wind" }, { workspace: open(root) }),
    ).rejects.toMatchObject({ code: "workspace.read-only" });
    expect((await run(root, WRITE)).places).toEqual(both("created"));
    expect((await run(root, WRITE)).places).toEqual(both("unchanged"));
    await fs.writeFile(skillAt(root), "# Mine\n");
    const error = await refusal(root, WRITE);
    expect(error.code).toBe("file.exists");
    expect(await read(root)).toBe("# Mine\n");
    expect((await run(root, { ...WRITE, replace: true })).places?.[0]?.action).toBe("replaced");
    expect(await read(root)).toBe((await run(root, { skill: true })).guide);
  };

  it("[SR-229/AK-v09f] [SR-011/AK-jt29] writes the skill file while a metamodel file is faulty and other write commands are refused", async () => {
    await writesWhileReadOnly(
      await folder({ "reqseq-workspace.yaml": WORKSPACE_FILE, "metamodel/model.yaml": "types: [" }),
    );
  });

  it("[SR-229/AK-v09f] [SR-011/AK-vhvd] writes the skill file while the metamodel folder is missing and other write commands are refused", async () => {
    await writesWhileReadOnly(await folder({ "reqseq-workspace.yaml": WORKSPACE_FILE }));
  });
});

describe("the skill file's helpers", () => {
  it("reads what lies at each place of the skill, for the workspace check of a later version", async () => {
    const root = await folder(workspaceFiles());
    const workspace = open(root);
    expect(await readSkillFiles(workspace, ENTRIES)).toEqual(
      SKILL_FILES.map((file) => ({ state: "missing", path: file })),
    );
    await run(root, WRITE);
    const own = {
      state: "own",
      version: PRODUCT_VERSION,
      intact: true,
      current: true,
      sameContent: true,
    };
    expect(await readSkillFiles(workspace, ENTRIES)).toEqual(
      SKILL_FILES.map((file) => ({ ...own, path: file })),
    );
    await fs.writeFile(skillAt(root), skillFile(ENTRIES, "0.0.1"));
    expect((await readSkillFiles(workspace, ENTRIES))[0]).toMatchObject({
      state: "own",
      version: "0.0.1",
      current: false,
      sameContent: true,
    });
    await fs.writeFile(skillAt(root), "# Mine\n");
    // A link at the file is a place nothing can be written at.
    await fs.rm(skillAt(root, AGENTS));
    await fs.symlink("../../../reqseq-workspace.yaml", skillAt(root, AGENTS));
    expect(await readSkillFiles(workspace, ENTRIES)).toEqual([
      { state: "foreign", path: CLAUDE },
      { state: "blocked", path: AGENTS },
    ]);
    // So is a place that meets Git, unless it holds ReqSeq's own unchanged file of this version, which a write leaves.
    await gitEntry(path.join(root, ".claude"));
    expect((await readSkillFiles(workspace, ENTRIES))[0]).toEqual({ state: "blocked", path: CLAUDE });
    await fs.writeFile(skillAt(root), skillFile(ENTRIES));
    expect((await readSkillFiles(workspace, ENTRIES))[0]).toEqual({ ...own, path: CLAUDE });
    expect(placesOf(await refusal(root, WRITE))[0]).toEqual({ path: CLAUDE, action: "unchanged" });
    // A root that does not exist is taken as given.
    const gone = path.join(root, "gone");
    expect((await skillLocations(new Workspace(gone))).map((place) => place.root)).toEqual([gone, gone]);
  });

  it("returns a refusal of a place as a value, and passes on an error that is not ReqSeq's", async () => {
    const root = await folder(workspaceFiles());
    const workspace = open(root);
    const refused = await writeSkillFiles(workspace, ENTRIES, {
      replace: false,
      localPaths: { check: () => Promise.reject(new CommandError("input.invalid", "no", {})) },
    });
    expect(refused.map((place) => "refused" in place && place.refused.details)).toEqual(
      SKILL_FILES.map((file) => ({
        command: "tool.guide",
        reason: undefined,
        field: "skill file",
        path: file,
      })),
    );
    await expect(
      writeSkillFiles(workspace, ENTRIES, {
        replace: false,
        localPaths: { check: () => Promise.reject(new Error("broken")) },
      }),
    ).rejects.toThrow("broken");
    expect(
      await writeSkillFiles(workspace, ENTRIES, { replace: false, localPaths: OPEN_LOCAL_PATHS }),
    ).toEqual(both("created"));
  });

  it("tells ReqSeq's own file by its marks, and a changed one by its checksum", () => {
    const own = skillFile(ENTRIES, "1.2.3");
    expect(identifySkill(own)).toEqual({ own: true, version: "1.2.3", intact: true });
    expect(identifySkill(`\uFEFF${own.replaceAll("\n", "\r\n")}`)).toEqual({
      own: true,
      version: "1.2.3",
      intact: true,
    });
    expect(identifySkill(own.replace("Check the workspace", "Check it"))).toMatchObject({ intact: false });
    expect(identifySkill(own.replace('  generator: "ReqSeq"\n', ""))).toEqual({ own: false });
    expect(identifySkill(own.replace(/ {2}reqseq-checksum: .*\n/, ""))).toEqual({ own: false });
    expect(identifySkill(own.replace(/ {2}reqseq-version: .*\n/, ""))).toEqual({ own: false });
    expect(identifySkill(own.replace("---\nname", "name"))).toEqual({ own: false });
    expect(identifySkill("# no frontmatter\n")).toEqual({ own: false });
    expect(skillChecksum("text")).toEqual({ actual: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown });
  });

  it("writes a boolean as a flag of the command line, --x for true and --no-x for false", () => {
    expect(renderCall({ command: "tool.guide", input: { skill: true, write: false } }, "cli", ENTRIES)).toBe(
      "`reqseq tool guide --skill --no-write`",
    );
  });

  it("orders versions as Semantic Versioning does, pre-releases before their release", () => {
    const ordered = [
      "0.9.9",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.0.1",
      "1.1.0",
      "2.0.0",
    ];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        expect([ordered[i], ordered[j], compareVersions(ordered[i] ?? "", ordered[j] ?? "")]).toEqual([
          ordered[i],
          ordered[j],
          Math.sign(i - j),
        ]);
      }
    }
    expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
    // Numbers of any length, beyond the safe integers of JavaScript.
    expect(compareVersions("1.0.0-9007199254740993", "1.0.0-9007199254740992")).toBe(1);
    expect(compareVersions("9007199254740993.0.0", "9007199254740992.0.0")).toBe(1);
    expect(compareVersions("01.0.0", "1.0.0")).toBeUndefined();
    expect(compareVersions("1.0", "1.0.0")).toBeUndefined();
    expect(compareVersions("1.0.0", "next")).toBeUndefined();
  });
});
